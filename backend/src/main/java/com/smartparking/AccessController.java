package com.smartparking;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class AccessController {

  private final ParkingService parking;

  public AccessController(ParkingService parking) {
    this.parking = parking;
  }

  @PostMapping("/device/vehicle-detections")
  public AccessData.Result detect(
    @Valid @RequestBody AccessData.Detection report
  ) {
    return parking.vehicleDetection(report, "CAMERA");
  }

  // Explicitly enabled prototype controls. These never dispatch hardware commands.
  @PostMapping("/access/simulation/detections")
  public AccessData.Result simulate(
    @Valid @RequestBody AccessData.Detection report
  ) {
    return parking.vehicleDetection(report, "SIMULATION");
  }

  @PostMapping("/access/simulation/barrier")
  public AccessData.Result command(
    @Valid @RequestBody AccessData.Command command
  ) {
    return parking.virtualBarrierCommand(command);
  }

  @GetMapping("/access/status")
  public AccessData.State status() {
    return parking.snapshot().access();
  }

  @PostMapping("/device/barrier-feedback")
  public AccessData.Result hardware(@Valid @RequestBody AccessData.HardwareReport report) {
    return parking.hardwareFeedback(report);
  }
}
