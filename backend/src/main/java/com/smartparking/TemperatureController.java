package com.smartparking;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.List;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
@Validated
public class TemperatureController {

  private final ParkingService parking;
  private final TemperatureStore temperature;

  public TemperatureController(
    ParkingService parking,
    TemperatureStore temperature
  ) {
    this.parking = parking;
    this.temperature = temperature;
  }

  @PostMapping("/device/temperature")
  public ParkingData.Snapshot receive(
    @Valid @RequestBody TemperatureData.Report report
  ) {
    return parking.temperatureReport(report);
  }

  @GetMapping("/temperature/status")
  public TemperatureData.State status() {
    return temperature.snapshot();
  }

  @GetMapping("/temperature/readings")
  public List<TemperatureData.Reading> readings(
    @RequestParam(defaultValue = "100") @Min(1) @Max(100) int limit
  ) {
    return temperature.readings(limit);
  }

  @GetMapping("/temperature/events")
  public List<TemperatureData.Event> events(
    @RequestParam(defaultValue = "100") @Min(1) @Max(100) int limit
  ) {
    return temperature.events(limit);
  }
}
