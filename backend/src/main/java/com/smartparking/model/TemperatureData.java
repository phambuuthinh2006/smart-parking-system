package com.smartparking.model;

import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public final class TemperatureData {

  private TemperatureData() {}

  public enum Status {
    NORMAL,
    ALARM,
    UNKNOWN,
  }

  public record Report(
    @NotBlank @Pattern(regexp = "esp8266-01") String deviceId,
    @NotNull
    @DecimalMin("-40")
    @DecimalMax("150")
    @Digits(integer = 3, fraction = 2)
    BigDecimal temperatureCelsius,
    Instant observedAt
  ) {}

  public record Event(
    long id,
    String deviceId,
    Status previousStatus,
    Status status,
    BigDecimal temperatureCelsius,
    BigDecimal thresholdCelsius,
    BigDecimal clearThresholdCelsius,
    Boolean gateOpenRequested,
    Instant time,
    String source
  ) {}

  public record Reading(
    long id,
    String deviceId,
    BigDecimal temperatureCelsius,
    BigDecimal thresholdCelsius,
    BigDecimal clearThresholdCelsius,
    Boolean gateOpenRequested,
    Status status,
    Instant recordedAt,
    Instant observedAt
  ) {}

  public record State(
    BigDecimal temperatureCelsius,
    BigDecimal thresholdCelsius,
    BigDecimal clearThresholdCelsius,
    int blinkIntervalMs,
    boolean fireOpensGate,
    boolean alarmActive,
    boolean gateOpenRequested,
    Status status,
    Instant updatedAt,
    List<Event> events
  ) {}
}
