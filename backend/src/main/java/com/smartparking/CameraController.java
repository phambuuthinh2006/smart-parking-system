package com.smartparking;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class CameraController {
  public record Reading(@NotNull UUID eventId, @NotBlank @Size(max=100) String plateText,
                        @NotNull AccessData.Direction direction, Instant observedAt, UUID encounterId) {
    public Reading(UUID eventId, String plateText, AccessData.Direction direction, Instant observedAt) {
      this(eventId, plateText, direction, observedAt, null);
    }
  }
  public record Registration(@NotBlank @Size(max=24) String plate, boolean enabled) {}
  public record Registered(String plate, boolean enabled) {}
  public record Latest(UUID eventId, String plateText, String plate, String outcome, Instant receivedAt) {}
  private final ParkingService parking;
  private final JdbcTemplate db;
  public CameraController(ParkingService parking, JdbcTemplate db) { this.parking=parking; this.db=db; }

  @PostMapping("/device/plate-readings")
  public Latest receive(@Valid @RequestBody Reading reading) { return parking.cameraReading(reading); }

  @GetMapping("/camera/latest")
  public Latest latest() {
    return db.queryForObject("SELECT * FROM camera_latest WHERE id=1", (r,n) ->
      new Latest(r.getObject("event_id", UUID.class),r.getString("plate_text"),r.getString("plate"),
        r.getString("outcome"), r.getTimestamp("received_at")==null ? null : r.getTimestamp("received_at").toInstant()));
  }

  @GetMapping("/camera/registered-plates")
  public List<Registered> registered() {
    return db.query("SELECT plate,enabled FROM registered_plate ORDER BY plate", (r,n)->new Registered(r.getString(1),r.getBoolean(2)));
  }

  @PostMapping("/camera/registered-plates")
  public Registered registerFromWeb(@Valid @RequestBody Registration registration) {
    return parking.registerPlate(registration);
  }

  @DeleteMapping("/camera/registered-plates/{plate}")
  public void delete(@PathVariable String plate) {
    parking.deletePlate(plate);
  }

  // Management uses the configured device key; never ship it to browser bundles.
  @PostMapping("/device/registered-plates")
  public Registered register(@Valid @RequestBody Registration registration) {
    return parking.registerPlate(registration);
  }
}
