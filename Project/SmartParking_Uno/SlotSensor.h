#pragma once
#include <stdint.h>

class SlotSensor {
 public:
  const char* status = "UNKNOWN";
  bool valid = false;
  void sample(float cm) {
    valid = cm > 0 && cm <= 400;
    if (!valid) { occupied = clear = 0; status = "UNKNOWN"; return; }
    if (cm < 15) {
      clear = 0;
      if (occupied < 3) ++occupied;
      if (occupied == 3) status = "OCCUPIED";
    } else if (cm >= 18) {
      occupied = 0;
      if (clear < 3) ++clear;
      if (clear == 3) status = "AVAILABLE";
    } else { occupied = clear = 0; }
  }
 private:
  uint8_t occupied = 0, clear = 0;
};
