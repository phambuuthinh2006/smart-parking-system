package com.smartparking.model;

import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class AccessData {

  private AccessData() {}

  public enum Direction {
    AUTO,
    ENTRY,
    EXIT,
  }

  public enum Action {
    PASSAGE,
    OPEN,
    CLOSE,
  }

  public record Detection(
    @NotNull UUID eventId,
    @NotBlank @Size(max = 24) String plate,
    @NotNull Direction direction,
    @NotNull
    @DecimalMin("0.75")
    @DecimalMax("1")
    @Digits(integer = 1, fraction = 4)
    BigDecimal confidence,
    @NotBlank @Pattern(regexp = "[A-Za-z0-9_-]{1,40}") String cameraId,
    Instant observedAt
  ) {}

  public record Command(
    @NotNull UUID eventId,
    @NotNull Action action,
    @NotNull @Min(0) Long expectedVersion
  ) {}

  // Only the authenticated hardware bridge may finish a sensor cycle.
  public record HardwareReport(
    UUID requestId,
    @NotNull @Min(0) Long expectedVersion,
    @Min(1) Long visitId,
    @NotBlank @Pattern(regexp = "OPEN|CLOSED") String gate,
    @NotBlank @Pattern(regexp = "IDLE|WAITING|OPEN|PASSED|CANCELLED|BLOCKED") String phase,
    @NotNull @Min(0) @Max(2000) Integer sampleAgeMs,
    @NotNull ParkingData.Status slotStatus,
    @NotNull Boolean gatePresent,
    @NotNull Boolean gateSensorValid
  ) {}

  public record Visit(
    long id,
    String plate,
    String status,
    String source,
    Instant createdAt,
    Instant entryAt,
    Instant exitAt,
    Instant gateEnteredAt,
    Instant slotLeftAt
  ) {}

  public record Event(
    long id,
    UUID eventId,
    String kind,
    String plate,
    String direction,
    BigDecimal confidence,
    String cameraId,
    String source,
    String outcome,
    Long visitId,
    Instant time
  ) {}

  public record Barrier(
    String position,
    long version,
    Long pendingVisitId,
    String pendingPlate,
    String direction,
    String reason,
    boolean fireOverride,
    boolean hardwareConnected,
    String actualPosition,
    String hardwarePhase,
    Instant hardwareSeenAt,
    UUID requestId
  ) {}

  public record Stats(
    long inside,
    long pendingEntry,
    long pendingExit,
    long pendingParking,
    long exited,
    int capacity
  ) {}

  public record State(
    Barrier barrier,
    Stats stats,
    List<Visit> visits,
    List<Event> events,
    boolean simulationEnabled
  ) {}

  public record Applied(String outcome, Long visitId, boolean duplicate) {}

  public record Result(
    String outcome,
    Long visitId,
    boolean duplicate,
    ParkingData.Snapshot snapshot
  ) {}
}
