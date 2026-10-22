package com.smartparking;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.Instant;
import java.util.List;

public final class ParkingData {

  private ParkingData() {}

  public enum Status {
    AVAILABLE,
    OCCUPIED,
    UNKNOWN,
  }

  public record Reading(
    @NotBlank @Pattern(regexp = "P0[1-4]") String spaceId,
    @NotNull Status status
  ) {}

  public record Report(
    @NotBlank @Pattern(regexp = "esp8266-01") String deviceId,
    @NotEmpty @Size(max = 4) List<@NotNull @Valid Reading> spaces,
    Instant observedAt
  ) {}

  public record Heartbeat(
    @NotBlank @Pattern(regexp = "esp8266-01") String deviceId
  ) {}

  public record Device(String id, boolean online, Instant lastSeenAt) {}

  public record Space(String id, Status status, Instant updatedAt) {}

  public record Event(
    long id,
    String spaceId,
    Status previousStatus,
    Status status,
    Instant time,
    String source
  ) {}

  public record Stats(int total, long available, long occupied, long unknown) {}

  public record Snapshot(
    long revision,
    Instant generatedAt,
    int staleAfterSeconds,
    Device device,
    List<Space> spaces,
    Stats stats,
    List<Event> events
  ) {}

  public record Changed(Snapshot snapshot) {}
}
