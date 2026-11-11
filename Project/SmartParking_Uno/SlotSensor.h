#pragma once
#include <stdint.h>

// Ngưỡng cảm biến ô đỗ Slot 1 (P01):
// - Dưới 10.0cm: Có xe đỗ trong ô (OCCUPIED)
// - Trên 13.0cm: Ô đỗ trống (AVAILABLE)
// - 10cm - 13cm: Vùng trễ (Hysteresis chống rung nhiễu)
class SlotSensor {
 public:
  const char* status = "UNKNOWN";
  bool valid = false;
  void sample(float cm) {
    valid = cm > 0 && cm <= 400;
    if (!valid) { occupied = clear = 0; status = "UNKNOWN"; return; }
    if (cm < 10) {
      clear = 0;
      if (occupied < 2) ++occupied;
      if (occupied >= 2) status = "OCCUPIED";
    } else if (cm >= 13) {
      occupied = 0;
      if (clear < 2) ++clear;
      if (clear >= 2) status = "AVAILABLE";
    } else { occupied = clear = 0; }
  }
 private:
  uint8_t occupied = 0, clear = 0;
};
