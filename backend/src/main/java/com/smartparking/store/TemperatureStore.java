package com.smartparking.store;

import static com.smartparking.model.TemperatureData.*;
import com.smartparking.model.TemperatureData;

import java.math.BigDecimal;
import java.sql.*;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@Service
public class TemperatureStore {

  private final JdbcTemplate db;

  public TemperatureStore(JdbcTemplate db) {
    this.db = db;
  }

  private static Instant instant(ResultSet rs, String column)
    throws SQLException {
    var value = rs.getTimestamp(column);
    return value == null ? null : value.toInstant();
  }

  // ParkingService holds the common device lock and owns commit/revision/publication.
  @Transactional(propagation = Propagation.MANDATORY)
  public void receive(Report report, Instant now, int staleSeconds) {
    Instant observed =
      report.observedAt() == null
        ? null
        : report.observedAt().truncatedTo(ChronoUnit.MICROS);
    if (observed != null) {
      Instant last = db.queryForObject(
        "SELECT last_observed_at FROM temperature_sensor WHERE device_id=?",
        (rs, row) -> instant(rs, "last_observed_at"),
        report.deviceId()
      );
      if (
        observed.isAfter(now.plusSeconds(30)) ||
        observed.isBefore(now.minusSeconds(staleSeconds))
      ) throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "Temperature observation outside freshness window"
      );
      if (
        last != null && !observed.isAfter(last)
      ) throw new ResponseStatusException(
        HttpStatus.CONFLICT,
        "Temperature observation already processed or out of order"
      );
    }
    var current = stateRow();
    BigDecimal threshold = current.thresholdCelsius();
    boolean active = current.alarmActive()
      ? report.temperatureCelsius().compareTo(current.clearThresholdCelsius()) >
        0
      : report.temperatureCelsius().compareTo(threshold) >= 0;
    boolean gate = active && current.fireOpensGate();
    Status next = active ? Status.ALARM : Status.NORMAL;
    db.update(
      "INSERT INTO temperature_reading(device_id,value_celsius,threshold_celsius,clear_threshold_celsius,gate_open_requested,status,recorded_at,observed_at) VALUES (?,?,?,?,?,?,?,?)",
      report.deviceId(),
      report.temperatureCelsius(),
      threshold,
      current.clearThresholdCelsius(),
      gate,
      next.name(),
      Timestamp.from(now),
      observed == null ? null : Timestamp.from(observed)
    );
    if (current.status() != next) event(
      current.status(),
      next,
      report.temperatureCelsius(),
      current,
      gate,
      now,
      "DEVICE"
    );
    db.update(
      "UPDATE temperature_sensor SET value_celsius=?,status=?,alarm_active=?,last_reported_at=? WHERE device_id=?",
      report.temperatureCelsius(),
      next.name(),
      active,
      Timestamp.from(now),
      report.deviceId()
    );
    if (observed != null) db.update(
      "UPDATE temperature_sensor SET last_observed_at=? WHERE device_id=?",
      Timestamp.from(observed),
      report.deviceId()
    );
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public boolean expire(Instant now, int staleSeconds) {
    var current = stateRow();
    if (
      current.status() == Status.UNKNOWN ||
      current.updatedAt() == null ||
      !current.updatedAt().isBefore(now.minusSeconds(staleSeconds))
    ) return false;
    db.update(
      "UPDATE temperature_sensor SET status='UNKNOWN' WHERE device_id='esp8266-01'"
    );
    // Lost data is UNKNOWN, never a confirmation that the heat alert has cleared.
    event(
      current.status(),
      Status.UNKNOWN,
      null,
      current,
      current.gateOpenRequested(),
      now,
      "TIMEOUT"
    );
    return true;
  }

  private void event(
    Status before,
    Status after,
    BigDecimal temperature,
    State policy,
    boolean gate,
    Instant now,
    String source
  ) {
    db.update(
      "INSERT INTO fire_alarm_event(device_id,previous_status,status,value_celsius,threshold_celsius,clear_threshold_celsius,gate_open_requested,created_at,source) VALUES ('esp8266-01',?,?,?,?,?,?,?,?)",
      before.name(),
      after.name(),
      temperature,
      policy.thresholdCelsius(),
      policy.clearThresholdCelsius(),
      gate,
      Timestamp.from(now),
      source
    );
  }

  private State stateRow() {
    return db.queryForObject(
      "SELECT * FROM temperature_sensor WHERE device_id='esp8266-01'",
      (rs, row) -> {
        Status status = Status.valueOf(rs.getString("status"));
        return new State(
          status == Status.UNKNOWN ? null : rs.getBigDecimal("value_celsius"),
          rs.getBigDecimal("threshold_celsius"),
          rs.getBigDecimal("clear_threshold_celsius"),
          rs.getInt("blink_interval_ms"),
          rs.getBoolean("fire_opens_gate"),
          rs.getBoolean("alarm_active"),
          rs.getBoolean("fire_opens_gate") && rs.getBoolean("alarm_active"),
          status,
          instant(rs, "last_reported_at"),
          List.of()
        );
      }
    );
  }

  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
  public State snapshot() {
    var current = stateRow();
    return new State(
      current.temperatureCelsius(),
      current.thresholdCelsius(),
      current.clearThresholdCelsius(),
      current.blinkIntervalMs(),
      current.fireOpensGate(),
      current.alarmActive(),
      current.gateOpenRequested(),
      current.status(),
      current.updatedAt(),
      events(20)
    );
  }

  @Transactional(readOnly = true)
  public List<Event> events(int limit) {
    return db.query(
      "SELECT * FROM fire_alarm_event ORDER BY id DESC LIMIT ?",
      (rs, row) ->
        new Event(
          rs.getLong("id"),
          rs.getString("device_id"),
          Status.valueOf(rs.getString("previous_status")),
          Status.valueOf(rs.getString("status")),
          rs.getBigDecimal("value_celsius"),
          rs.getBigDecimal("threshold_celsius"),
          rs.getBigDecimal("clear_threshold_celsius"),
          (Boolean) rs.getObject("gate_open_requested"),
          instant(rs, "created_at"),
          rs.getString("source")
        ),
      limit
    );
  }

  @Transactional(readOnly = true)
  public List<Reading> readings(int limit) {
    return db.query(
      "SELECT * FROM temperature_reading ORDER BY id DESC LIMIT ?",
      (rs, row) ->
        new Reading(
          rs.getLong("id"),
          rs.getString("device_id"),
          rs.getBigDecimal("value_celsius"),
          rs.getBigDecimal("threshold_celsius"),
          rs.getBigDecimal("clear_threshold_celsius"),
          (Boolean) rs.getObject("gate_open_requested"),
          Status.valueOf(rs.getString("status")),
          instant(rs, "recorded_at"),
          instant(rs, "observed_at")
        ),
      limit
    );
  }
}
