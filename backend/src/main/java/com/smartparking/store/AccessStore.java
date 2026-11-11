package com.smartparking.store;

import static com.smartparking.model.AccessData.*;
import com.smartparking.model.AccessData;
import com.smartparking.model.ParkingData;

import java.sql.*;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AccessStore {

  private final JdbcTemplate db;
  private final boolean simulationEnabled;

  public AccessStore(
    JdbcTemplate db,
    @Value(
      "${parking.access-simulation-enabled:false}"
    ) boolean simulationEnabled
  ) {
    this.db = db;
    this.simulationEnabled = simulationEnabled;
  }

  public void requireSimulation() {
    if (!simulationEnabled) throw new ResponseStatusException(
      HttpStatus.FORBIDDEN,
      "Server simulation is disabled"
    );
  }

  public static String normalizePlate(String value) {
    String plate = value.toUpperCase(Locale.ROOT).replaceAll("[\\s.-]", "");
    if (
      !plate.matches("[0-9]{2}[A-Z]{1,2}[0-9]{4,6}")
    ) throw new ResponseStatusException(
      HttpStatus.BAD_REQUEST,
      "Use a supported plate such as 43A-123.45"
    );
    return plate;
  }

  private static Instant instant(ResultSet r, String key) throws SQLException {
    var t = r.getTimestamp(key);
    return t == null ? null : t.toInstant();
  }

  private static Long number(ResultSet r, String key) throws SQLException {
    long n = r.getLong(key);
    return r.wasNull() ? null : n;
  }

  private static ResponseStatusException conflict(String text) {
    return new ResponseStatusException(HttpStatus.CONFLICT, text);
  }

  private record Saved(
    String kind,
    String plate,
    String direction,
    java.math.BigDecimal confidence,
    String cameraId,
    Instant observedAt,
    String source,
    String outcome,
    Long visitId,
    Long expectedVersion,
    String requestedDirection,
    UUID encounterId
  ) {}

  private Saved saved(UUID eventId) {
    return db
      .query(
        "SELECT * FROM vehicle_access_event WHERE event_id=?",
        (r, n) ->
          new Saved(
            r.getString("kind"),
            r.getString("plate"),
            r.getString("direction"),
            r.getBigDecimal("confidence"),
            r.getString("camera_id"),
            instant(r, "observed_at"),
            r.getString("source"),
            r.getString("outcome"),
            number(r, "visit_id"),
            number(r, "expected_version"),
            r.getString("requested_direction"),
            r.getObject("encounter_id", UUID.class)
          ),
        eventId
      )
      .stream()
      .findFirst()
      .orElse(null);
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public Applied detect(
    Detection report,
    String source,
    boolean fireOverride,
    Instant now
  ) {
    return detect(report, source, fireOverride, now, null);
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public Applied detect(Detection report, String source, boolean fireOverride, Instant now, UUID encounterId) {
    if (source.equals("SIMULATION")) requireSimulation();
    boolean auto = report.direction() == Direction.AUTO;
    if (auto && encounterId == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "AUTO requires a camera encounterId");
    String plate = normalizePlate(report.plate());
    Instant observed =
      report.observedAt() == null
        ? null
        : report.observedAt().truncatedTo(ChronoUnit.MICROS);
    Saved prior = saved(report.eventId());
    if (prior != null) {
      if (
        !prior.kind.equals("DETECTION") ||
        !Objects.equals(prior.plate, plate) ||
        !Objects.equals(prior.requestedDirection == null ? prior.direction : prior.requestedDirection, report.direction().name()) ||
        !Objects.equals(prior.encounterId, encounterId) ||
        (prior.confidence == null ? report.confidence() != null : report.confidence() == null || prior.confidence.compareTo(report.confidence()) != 0) ||
        !Objects.equals(prior.cameraId, report.cameraId()) ||
        !Objects.equals(prior.observedAt, observed) ||
        !prior.source.equals(source)
      ) throw conflict("Event ID was already used for different data");
      return new Applied(prior.outcome, prior.visitId, true);
    }
    if (
      observed != null &&
      (observed.isBefore(now.minusSeconds(60)) ||
        observed.isAfter(now.plusSeconds(30)))
    ) throw new ResponseStatusException(
      HttpStatus.BAD_REQUEST,
      "Detection outside freshness window"
    );
    var barrier = barrierRow(false);
    Long visitId = null;
    String outcome;
    var matches = db.query(
      "SELECT * FROM vehicle_visit WHERE plate=? AND status IN ('PENDING_ENTRY','PENDING_PARKING','INSIDE','PENDING_EXIT')",
      this::visit,
      plate
    );
    Visit current = matches.isEmpty() ? null : matches.get(0);
    Direction direction = auto ? (current != null && (current.status().equals("INSIDE") || current.status().equals("PENDING_EXIT")) ? Direction.EXIT : Direction.ENTRY) : report.direction();
    boolean opened = false;
    boolean registered = Boolean.TRUE.equals(db.queryForObject(
      "SELECT EXISTS(SELECT 1 FROM registered_plate WHERE plate=? AND enabled)", Boolean.class, plate));
    if (fireOverride) outcome = "FIRE_OVERRIDE";
    else if (!registered) outcome = "NOT_REGISTERED";
    else if (auto && Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM camera_encounter WHERE encounter_id=?)", Boolean.class, encounterId))) outcome = "ENCOUNTER_USED";
    else if (current != null && current.status().equals("PENDING_PARKING")) {
      outcome = "WAITING_PARKING"; visitId = current.id();
    }
    else if (auto && current != null && (current.status().equals("PENDING_ENTRY") || (current.status().equals("PENDING_EXIT") && barrier.position().equals("OPEN")))) {
      outcome = current.status().equals("PENDING_ENTRY") ? "ENTRY_PENDING" : "EXIT_PENDING"; visitId = current.id();
    }
    else if (auto && direction == Direction.ENTRY && !gateReady()) outcome = "WAITING_GATE_SENSOR";
    else if (auto && direction == Direction.ENTRY && !slotIs("AVAILABLE")) outcome = "SLOT_NOT_READY";
    else if (auto && direction == Direction.EXIT && (!slotIs("AVAILABLE") || current == null || current.slotLeftAt() == null)) outcome = "SLOT_STILL_OCCUPIED";
    else if (direction == Direction.ENTRY && current != null) {
      outcome = current.status().equals("PENDING_ENTRY")
        ? "ENTRY_PENDING"
        : "ALREADY_INSIDE";
      visitId = current.id();
    } else if (
      direction == Direction.EXIT && current == null
    ) outcome = "NOT_INSIDE";
    else if (barrier.position().equals("OPEN")) outcome = "BARRIER_BUSY";
    else if (direction == Direction.ENTRY) {
      long count = db.queryForObject(
        "SELECT count(*) FROM vehicle_visit WHERE status IN ('PENDING_ENTRY','PENDING_PARKING','INSIDE','PENDING_EXIT')",
        Long.class
      );
      if (count >= 1) outcome = "CAPACITY_REACHED";
      else {
        visitId = db.queryForObject(
          "INSERT INTO vehicle_visit(plate,status,source,created_at) VALUES (?,'PENDING_ENTRY',?,?) RETURNING id",
          Long.class,
          plate,
          source,
          Timestamp.from(now)
        );
        open(visitId, "ENTRY", now);
        opened = true;
        outcome = "ENTRY_PENDING";
      }
    } else {
      visitId = current.id();
      db.update(
        "UPDATE vehicle_visit SET status='PENDING_EXIT' WHERE id=?",
        visitId
      );
      open(visitId, "EXIT", now);
      opened = true;
      outcome = "EXIT_PENDING";
    }
    if (auto && opened) db.update("INSERT INTO camera_encounter(encounter_id,plate,visit_id,created_at) VALUES (?,?,?,?)", encounterId, plate, visitId, Timestamp.from(now));
    db.update(
      "INSERT INTO vehicle_access_event(event_id,kind,plate,direction,confidence,camera_id,observed_at,source,outcome,visit_id,created_at,requested_direction,encounter_id) VALUES (?,'DETECTION',?,?,?,?,?,?,?,?,?,?,?)",
      report.eventId(),
      plate,
      direction.name(),
      report.confidence(),
      report.cameraId(),
      observed == null ? null : Timestamp.from(observed),
      source,
      outcome,
      visitId,
      Timestamp.from(now),
      report.direction().name(),
      encounterId
    );
    return new Applied(outcome, visitId, false);
  }

  private void open(Long visitId, String direction, Instant now) {
    db.update(
      "UPDATE virtual_barrier SET position='OPEN',version=version+1,pending_visit_id=?,direction=?,reason=?,updated_at=? WHERE id=1",
      visitId,
      direction,
      direction == null ? "MANUAL" : direction,
      Timestamp.from(now)
    );
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public Applied command(Command command, boolean fireOverride, Instant now) {
    requireSimulation();
    return applyCommand(command, fireOverride, now, "SIMULATION", null);
  }

  private Applied applyCommand(Command command, boolean fireOverride, Instant now, String source, Long requiredVisit) {
    Saved prior = saved(command.eventId());
    if (prior != null) {
      if (
        !prior.kind.equals(command.action().name()) ||
        !Objects.equals(prior.expectedVersion, command.expectedVersion()) ||
        !prior.source.equals(source) ||
        (requiredVisit != null && !Objects.equals(requiredVisit, prior.visitId))
      ) throw conflict("Command ID was already used for different data");
      return new Applied(prior.outcome, prior.visitId, true);
    }
    var b = barrierRow(false);
    if (requiredVisit != null && !Objects.equals(requiredVisit, b.pendingVisitId()))
      throw conflict("Hardware cycle belongs to another visit");
    if (b.version() != command.expectedVersion()) throw conflict(
      "Barrier changed. Refresh before retrying"
    );
    if (fireOverride) throw conflict(
      "Fire override holds the virtual barrier open"
    );
    Long visitId = b.pendingVisitId();
    String plate = b.pendingPlate(),
      direction = b.direction(),
      outcome;
    if (command.action() == Action.OPEN) {
      if (b.position().equals("OPEN")) throw conflict(
        "Virtual barrier already open"
      );
      open(null, null, now);
      outcome = "MANUAL_OPEN";
    } else {
      if (!b.position().equals("OPEN")) throw conflict(
        "Virtual barrier is already closed"
      );
      if (visitId != null) {
        if (command.action() == Action.PASSAGE) {
          if ("ENTRY".equals(direction)) db.update(
            "UPDATE vehicle_visit SET status='PENDING_PARKING',gate_entered_at=? WHERE id=? AND status='PENDING_ENTRY'",
            Timestamp.from(now),
            visitId
          );
          else db.update(
            "UPDATE vehicle_visit SET status='EXITED',exit_at=? WHERE id=? AND status='PENDING_EXIT'",
            Timestamp.from(now),
            visitId
          );
        } else {
          db.update(
            "UPDATE vehicle_visit SET status=? WHERE id=?",
            "ENTRY".equals(direction) ? "CANCELLED" : "INSIDE",
            visitId
          );
        }
      }
      db.update(
        "UPDATE virtual_barrier SET position='CLOSED',version=version+1,pending_visit_id=NULL,direction=NULL,reason='IDLE',updated_at=? WHERE id=1",
        Timestamp.from(now)
      );
      outcome =
        command.action() == Action.PASSAGE
          ? "PASSAGE_CONFIRMED"
          : "CANCELLED_CLOSE";
      if (source.equals("DEVICE")) outcome = command.action() == Action.PASSAGE
        ? "AUTO_PASSAGE_CONFIRMED" : "AUTO_CANCELLED_CLOSE";
      if (command.action() == Action.PASSAGE && "ENTRY".equals(direction)) outcome = "GATE_ENTERED";
    }
    db.update(
      "INSERT INTO vehicle_access_event(event_id,kind,plate,direction,source,outcome,visit_id,expected_version,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      command.eventId(),
      command.action().name(),
      plate,
      direction,
      source,
      outcome,
      visitId,
      command.expectedVersion(),
      Timestamp.from(now)
    );
    return new Applied(outcome, visitId, false);
  }

  public static UUID requestId(long version, Long visitId) {
    return visitId == null ? null : UUID.nameUUIDFromBytes(
      ("smart-parking:" + version + ":" + visitId).getBytes(java.nio.charset.StandardCharsets.UTF_8));
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public Applied hardwareFeedback(HardwareReport report, boolean fire, Instant now) {
    db.update("UPDATE barrier_hardware SET position=?,phase=?,request_id=?,last_seen_at=?,gate_present=?,gate_sensor_valid=? WHERE id=1",
      report.gate(), report.phase(), report.requestId(), Timestamp.from(now), report.gatePresent(), report.gateSensorValid());
    boolean passed = report.phase().equals("PASSED");
    if (!passed && !report.phase().equals("CANCELLED"))
      return new Applied("HARDWARE_UPDATED", null, false);
    if (!report.gate().equals("CLOSED") || report.visitId() == null ||
        !Objects.equals(report.requestId(), requestId(report.expectedVersion(), report.visitId())))
      return new Applied("STALE_CYCLE", null, false);
    var command = new Command(report.requestId(), passed ? Action.PASSAGE : Action.CLOSE, report.expectedVersion());
    Saved prior = saved(report.requestId());
    if (prior != null) return applyCommand(command, fire, now, "DEVICE", report.visitId());
    var barrier = barrierRow(false);
    if (fire || barrier.version() != report.expectedVersion() ||
        !Objects.equals(barrier.pendingVisitId(), report.visitId()) || !barrier.position().equals("OPEN"))
      return new Applied("STALE_CYCLE", null, false);
    var applied = applyCommand(command, false, now, "DEVICE", report.visitId());
    db.update("UPDATE camera_latest SET outcome=? WHERE id=1 AND plate=?", applied.outcome(), barrier.pendingPlate());
    return applied;
  }

  private boolean slotIs(String status) {
    return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM parking_space WHERE id='P01' AND status=? AND last_reported_at > now()-interval '5 seconds')", Boolean.class, status));
  }

  // Ngưỡng phát hiện xe trước cổng đã được hiệu chỉnh < 8cm (trên Uno firmware)
  // và phản ánh qua cột gate_present (boolean) trong barrier_hardware.
  private boolean gateReady() {
    return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM barrier_hardware WHERE id=1 AND position='CLOSED' AND gate_present AND gate_sensor_valid AND last_seen_at > now()-interval '5 seconds')", Boolean.class));
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public void reconcileSlot(Instant now) {
    if (slotIs("OCCUPIED")) {
      // A single P01 sensor can only identify the one outstanding arrival.
      var pending = db.query("SELECT * FROM vehicle_visit WHERE status='PENDING_PARKING'", this::visit);
      if (pending.size() == 1) {
        Visit visit = pending.get(0);
        boolean arrived = Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM vehicle_visit WHERE id=? AND slot_clear_confirmed_at>=gate_entered_at)", Boolean.class, visit.id()));
        if (arrived) {
          int updated = db.update("UPDATE vehicle_visit SET status='INSIDE',entry_at=?,slot_left_at=NULL WHERE id=? AND status='PENDING_PARKING'", Timestamp.from(now), visit.id());
          if (updated > 0) {
            db.update("INSERT INTO vehicle_access_event(event_id,kind,plate,direction,source,outcome,visit_id,created_at) VALUES (?,'SLOT',?,'ENTRY','DEVICE','SLOT_PARKED',?,?)", UUID.randomUUID(), visit.plate(), visit.id(), Timestamp.from(now));
            db.update("UPDATE camera_latest SET outcome='SLOT_PARKED' WHERE plate=?", visit.plate());
          }
        }
      }
      db.update("UPDATE vehicle_visit SET slot_left_at=NULL WHERE status='INSIDE'");
    } else if (slotIs("AVAILABLE")) {
      db.update("UPDATE vehicle_visit SET slot_clear_confirmed_at=? WHERE status='PENDING_PARKING' AND slot_clear_confirmed_at IS NULL AND gate_entered_at<=?", Timestamp.from(now), Timestamp.from(now));
      var leaving = db.query("SELECT * FROM vehicle_visit WHERE status='INSIDE'", this::visit);
      for (Visit v : leaving) {
        int updated = db.update("UPDATE vehicle_visit SET status='PENDING_EXIT', slot_left_at=? WHERE id=? AND status='INSIDE'", Timestamp.from(now), v.id());
        if (updated > 0) {
          db.update("INSERT INTO vehicle_access_event(event_id,kind,plate,direction,source,outcome,visit_id,created_at) VALUES (?,'SLOT',?,'EXIT','DEVICE','SLOT_LEFT',?,?)",
            UUID.randomUUID(), v.plate(), v.id(), Timestamp.from(now));
          db.update("UPDATE camera_latest SET outcome='SLOT_LEFT' WHERE plate=?", v.plate());
        }
      }
    }
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public void resetActiveVisits(Instant now) {
    db.update("UPDATE vehicle_visit SET status='CANCELLED' WHERE status IN ('PENDING_ENTRY','PENDING_PARKING','INSIDE','PENDING_EXIT')");
    db.update("UPDATE virtual_barrier SET position='CLOSED',version=version+1,pending_visit_id=NULL,direction=NULL,reason='RESET',updated_at=? WHERE id=1", Timestamp.from(now));
    db.update("UPDATE barrier_hardware SET position='CLOSED',phase='IDLE',request_id=NULL WHERE id=1");
    db.update("DELETE FROM camera_encounter");
    db.update("UPDATE camera_latest SET outcome='RESET', received_at=? WHERE id=1", Timestamp.from(now));
  }

  private Visit visit(ResultSet r, int row) throws SQLException {
    return new Visit(
      r.getLong("id"),
      r.getString("plate"),
      r.getString("status"),
      r.getString("source"),
      instant(r, "created_at"),
      instant(r, "entry_at"),
      instant(r, "exit_at"),
      instant(r, "gate_entered_at"),
      instant(r, "slot_left_at")
    );
  }

  private Barrier barrierRow(boolean fire) {
    var hardware = db.queryForMap("SELECT * FROM barrier_hardware WHERE id=1");
    var seen = (Timestamp) hardware.get("last_seen_at");
    boolean connected = seen != null && seen.toInstant().isAfter(Instant.now().minusSeconds(5));
    return db.queryForObject(
      "SELECT b.*,v.plate FROM virtual_barrier b LEFT JOIN vehicle_visit v ON v.id=b.pending_visit_id WHERE b.id=1",
      (r, n) ->
        new Barrier(
          fire ? "OPEN" : r.getString("position"),
          r.getLong("version"),
          number(r, "pending_visit_id"),
          r.getString("plate"),
          r.getString("direction"),
          fire ? "FIRE_OVERRIDE" : r.getString("reason"),
          fire,
          connected,
          connected ? (String) hardware.get("position") : "UNKNOWN",
          connected ? (String) hardware.get("phase") : "OFFLINE",
          seen == null ? null : seen.toInstant(),
          requestId(r.getLong("version"), number(r, "pending_visit_id"))
        )
    );
  }

  @Transactional(readOnly = true)
  public State snapshot(boolean fire) {
    var stats = db.queryForObject(
      "SELECT count(*) FILTER(WHERE status IN ('INSIDE','PENDING_EXIT')) AS inside,count(*) FILTER(WHERE status='PENDING_ENTRY') AS pending_entry,count(*) FILTER(WHERE status='PENDING_EXIT') AS pending_exit,count(*) FILTER(WHERE status='PENDING_PARKING') AS pending_parking,count(*) FILTER(WHERE status='EXITED') AS exited FROM vehicle_visit",
      (r, n) ->
        new Stats(
          r.getLong("inside"),
          r.getLong("pending_entry"),
          r.getLong("pending_exit"),
          r.getLong("pending_parking"),
          r.getLong("exited"),
          1
        )
    );
    var visits = db.query(
      "SELECT * FROM vehicle_visit ORDER BY CASE WHEN status IN ('PENDING_ENTRY','PENDING_PARKING','INSIDE','PENDING_EXIT') THEN 0 ELSE 1 END,id DESC LIMIT 100",
      this::visit
    );
    var events = db.query(
      "SELECT * FROM vehicle_access_event ORDER BY id DESC LIMIT 30",
      (r, n) ->
        new Event(
          r.getLong("id"),
          (UUID) r.getObject("event_id"),
          r.getString("kind"),
          r.getString("plate"),
          r.getString("direction"),
          r.getBigDecimal("confidence"),
          r.getString("camera_id"),
          r.getString("source"),
          r.getString("outcome"),
          number(r, "visit_id"),
          instant(r, "created_at")
        )
    );
    return new State(
      barrierRow(fire),
      stats,
      visits,
      events,
      simulationEnabled
    );
  }
}
