package com.smartparking.controller;

import static com.smartparking.model.ParkingData.*;

import com.smartparking.model.ParkingData.*;
import com.smartparking.service.ParkingService;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.List;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
@Validated
public class ParkingController {

  private final ParkingService parking;

  public ParkingController(ParkingService parking) {
    this.parking = parking;
  }

  @PostMapping("/device/status")
  public Snapshot report(@Valid @RequestBody Report report) {
    return parking.report(report);
  }

  @PostMapping("/device/heartbeat")
  public Snapshot heartbeat(@Valid @RequestBody Heartbeat heartbeat) {
    return parking.heartbeat(heartbeat);
  }

  @GetMapping("/parking/status")
  public Snapshot status() {
    return parking.snapshot();
  }

  @GetMapping("/parking/history")
  public List<Event> history(
    @RequestParam(defaultValue = "100") @Min(1) @Max(100) int limit
  ) {
    return parking.history(limit);
  }
}
