package com.smartparking;

import static com.smartparking.ParkingData.*;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class ParkingService {

  private final JdbcTemplate db;
  private final ApplicationEventPublisher publisher;
  private final int staleSeconds;

  public ParkingService(
    JdbcTemplate db,
    ApplicationEventPublisher publisher,
    @Value("${parking.stale-after-seconds}") int staleSeconds
  ) {
    if (staleSeconds < 1) throw new IllegalArgumentException(
      "Device timeout must be positive"
    );
    this.db = db;
    this.publisher = publisher;
    this.staleSeconds = staleSeconds;
  }

  private static Instant instant(ResultSet rs, String column)
    throws SQLException {
    var timestamp = rs.getTimestamp(column);
    return timestamp == null ? null : timestamp.toInstant();
  }

  private void lockDevice() {
    db.queryForObject(
      "SELECT id FROM device WHERE id='esp8266-01' FOR UPDATE",
      String.class
    );
  }

  @Transactional
  public Snapshot report(Report report) {
    if (
      !"esp8266-01".equals(report.deviceId())
    ) throw new ResponseStatusException(
      HttpStatus.BAD_REQUEST,
      "Unknown device"
    );
    var ids = new HashSet<String>();
    for (var reading : report.spaces()) {
      if (!ids.add(reading.spaceId())) throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "Duplicate space ID"
      );
    }
    lockDevice();
    Instant now = Instant.now();
    if (report.observedAt() != null) {
      Instant observed = report
        .observedAt()
        .truncatedTo(java.time.temporal.ChronoUnit.MICROS);
      var last = db.queryForObject(
        "SELECT last_observed_at FROM device WHERE id='esp8266-01'",
        (rs, row) -> instant(rs, "last_observed_at")
      );
      if (
        observed.isAfter(now.plusSeconds(30)) ||
        observed.isBefore(now.minusSeconds(staleSeconds))
      ) throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "Observation outside freshness window"
      );
      if (
        last != null && !observed.isAfter(last)
      ) throw new ResponseStatusException(
        HttpStatus.CONFLICT,
        "Observation already processed or out of order"
      );
      db.update(
        "UPDATE device SET last_observed_at=? WHERE id='esp8266-01'",
        java.sql.Timestamp.from(observed)
      );
    }
    for (var reading : report.spaces())
      updateSpace(reading.spaceId(), reading.status(), now, "DEVICE");
    touch(now);
    return publish();
  }

  @Transactional
  public Snapshot heartbeat(Heartbeat heartbeat) {
    if (
      !"esp8266-01".equals(heartbeat.deviceId())
    ) throw new ResponseStatusException(
      HttpStatus.BAD_REQUEST,
      "Unknown device"
    );
    lockDevice();
    touch(Instant.now());
    return publish();
  }

  private void touch(Instant now) {
    db.update(
      "UPDATE device SET online=true,last_seen_at=?,revision=revision+1 WHERE id='esp8266-01'",
      java.sql.Timestamp.from(now)
    );
  }

  private void updateSpace(String id, Status next, Instant now, String source) {
    Status before = Status.valueOf(
      db.queryForObject(
        "SELECT status FROM parking_space WHERE id=?",
        String.class,
        id
      )
    );
    if (before != next) db.update(
      "INSERT INTO parking_event(space_id,previous_status,status,created_at,source) VALUES (?,?,?,?,?)",
      id,
      before.name(),
      next.name(),
      java.sql.Timestamp.from(now),
      source
    );
    if (source.equals("DEVICE")) db.update(
      "UPDATE parking_space SET status=?,last_reported_at=? WHERE id=?",
      next.name(),
      java.sql.Timestamp.from(now),
      id
    );
    else db.update(
      "UPDATE parking_space SET status=? WHERE id=?",
      next.name(),
      id
    );
  }

  @Scheduled(fixedDelayString = "${parking.expiry-check-ms}")
  @Transactional
  public void expire() {
    lockDevice();
    Instant now = Instant.now();
    var threshold = java.sql.Timestamp.from(now.minusSeconds(staleSeconds));
    int changed = db.update(
      "UPDATE device SET online=false WHERE online AND last_seen_at < ?",
      threshold
    );
    var stale = db.queryForList(
      "SELECT id FROM parking_space WHERE status <> 'UNKNOWN' AND last_reported_at < ?",
      String.class,
      threshold
    );
    for (String id : stale) updateSpace(id, Status.UNKNOWN, now, "TIMEOUT");
    if (changed > 0 || !stale.isEmpty()) {
      db.update("UPDATE device SET revision=revision+1 WHERE id='esp8266-01'");
      publish();
    }
  }

  private Snapshot publish() {
    Snapshot snapshot = readSnapshot();
    publisher.publishEvent(new Changed(snapshot));
    return snapshot;
  }

  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
  public Snapshot snapshot() {
    return readSnapshot();
  }

  private Snapshot readSnapshot() {
    var device = db.queryForObject(
      "SELECT * FROM device WHERE id='esp8266-01'",
      (rs, row) ->
        new Device(
          rs.getString("id"),
          rs.getBoolean("online"),
          instant(rs, "last_seen_at")
        )
    );
    long revision = db.queryForObject(
      "SELECT revision FROM device WHERE id='esp8266-01'",
      Long.class
    );
    List<Space> spaces = db.query(
      "SELECT * FROM parking_space ORDER BY id",
      (rs, row) ->
        new Space(
          rs.getString("id"),
          Status.valueOf(rs.getString("status")),
          instant(rs, "last_reported_at")
        )
    );
    var stats = new Stats(
      spaces.size(),
      count(spaces, Status.AVAILABLE),
      count(spaces, Status.OCCUPIED),
      count(spaces, Status.UNKNOWN)
    );
    return new Snapshot(
      revision,
      Instant.now(),
      staleSeconds,
      device,
      spaces,
      stats,
      history(100)
    );
  }

  private long count(List<Space> spaces, Status status) {
    return spaces
      .stream()
      .filter(s -> s.status() == status)
      .count();
  }

  @Transactional(readOnly = true)
  public List<Event> history(int limit) {
    return db.query(
      "SELECT * FROM parking_event ORDER BY id DESC LIMIT ?",
      (rs, row) ->
        new Event(
          rs.getLong("id"),
          rs.getString("space_id"),
          Status.valueOf(rs.getString("previous_status")),
          Status.valueOf(rs.getString("status")),
          instant(rs, "created_at"),
          rs.getString("source")
        ),
      limit
    );
  }
}
