#ifndef GATE_LOGIC_H
#define GATE_LOGIC_H
#include <math.h>

// State describes the requested servo position, not a measured limit switch.
struct GateLogic {
  bool open = false;
  bool alarm = false;
  bool temperatureValid = false;
  bool initialized = false;

  void sample(float temperature) {
    temperatureValid = isfinite(temperature) && temperature >= -40 && temperature <= 150;
    initialized = true;
    if (temperatureValid) {
      if (temperature >= 50) alarm = true;
      else if (temperature <= 45) alarm = false;
    }
    // Sensor loss never clears an active alarm; cooling never closes the gate.
    if (alarm) open = true;
  }

  bool command(bool wantOpen, bool clearConfirmed) {
    if (!wantOpen && (!initialized || !temperatureValid || alarm || !clearConfirmed)) return false;
    open = wantOpen;
    return true;
  }
};
#endif
