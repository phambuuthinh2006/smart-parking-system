#pragma once
#include <stdint.h>
#include <string.h>

// Demo inference: present -> open -> stable valid clear. A single sensor cannot
// distinguish driving through from reversing; no echo is UNKNOWN, never clear.
class GateCycle {
 public:
  enum Action { NONE, RAISE, LOWER };
  const char* phase = "IDLE";
  char requestId[37] = "";
  bool opened = false;
  bool valid = false;
  bool present = false;
  float distance = -1;

  bool request(const char* id, uint32_t now) {
    if (opened || (id[0] && strcmp(id, requestId) == 0)) return false;
    if (id[0]) {
      if (strlen(id) != 36) return false;
      for (uint8_t i = 0; i < 36; ++i) {
        char c = id[i];
        if (i == 8 || i == 13 || i == 18 || i == 23) { if (c != '-') return false; }
        else if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) return false;
      }
    }
    strcpy(requestId, id);
    phase = "WAITING";
    requestedAt = now;
    detected = cleared = 0;
    return true;
  }

  Action sample(float cm, uint32_t now) {
    distance = cm;
    valid = cm > 0 && cm <= 400;
    if (!valid) {
      detected = cleared = 0;
      if (opened) phase = "BLOCKED";
    } else if (cm < 15) {
      if (detected < 3) ++detected;
      cleared = 0;
      if (detected == 3) present = true;
      if (opened) phase = "OPEN";
    } else {
      if (cleared < 3) ++cleared;
      detected = 0;
      if (cleared == 3) present = false;
    }
    if (!opened && strcmp(phase, "WAITING") == 0) {
      if (now - requestedAt >= 30000) phase = "CANCELLED";
      else if (valid && detected == 3) {
        opened = true;
        openedAt = now;
        cleared = 0;
        phase = "OPEN";
        return RAISE;
      }
    } else if (opened && valid && cleared == 3 && now - openedAt >= 1200) {
      opened = false;
      phase = "PASSED";
      return LOWER;
    }
    return NONE;
  }

  // Manual close cancels a cycle; it must never fabricate a passage.
  bool cancel() {
    if (opened && (!valid || cleared < 3)) return false;
    opened = false;
    phase = "CANCELLED";
    return true;
  }

 private:
  uint8_t detected = 0, cleared = 0;
  uint32_t requestedAt = 0, openedAt = 0;
};
