#pragma once
#include <stdint.h>
#include <string.h>

// Demo inference: present -> open immediately on backend approval -> detect vehicle passage -> lower.
// Ngưỡng cảm biến cổng calibrated: < 8.0cm là có xe đứng trước/dưới cổng.
static const float GATE_THRESHOLD = 8.0f;

class GateCycle {
 public:
  enum Action { NONE, RAISE, LOWER };
  const char* phase = "IDLE";
  char requestId[37] = "";
  bool opened = false;
  bool valid = false;
  bool present = false;
  float distance = -1;
  bool isExit = false;
  bool carSeen = false;

  // Lệnh mở chiều VÀO (ENTRY): Mở ngay khi Backend duyệt, không bắt đợi detected == 3
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
    phase = "OPEN";
    opened = true;
    openedAt = now;
    cleared = 0;
    detected = 0;
    isExit = false;
    carSeen = present; // Nếu xe đã đứng trước cổng thì ghi nhận ngay
    return true;
  }

  // Lệnh mở chiều RA (EXIT): Mở ngay đón xe từ trong bãi đi ra
  bool requestExit(const char* id, uint32_t now) {
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
    phase = "OPEN";
    opened = true;
    openedAt = now;
    cleared = 0;
    detected = 0;
    present = false;
    isExit = true;
    carSeen = false;
    return true;
  }

  Action sample(float cm, uint32_t now) {
    distance = cm;
    valid = cm > 0 && cm <= 400;
    if (!valid) {
      detected = cleared = 0;
      if (opened) phase = "BLOCKED";
    } else if (cm < GATE_THRESHOLD) {
      carSeen = true;
      if (detected < 2) ++detected;
      cleared = 0;
      if (detected >= 2) present = true;
      if (opened) phase = "OPEN";
    } else {
      if (cleared < 2) ++cleared;
      detected = 0;
      if (cleared >= 2) present = false;
    }

    if (opened) {
      // 1. Timeout 15 giây nếu xe không đi qua -> Tự động đóng và hủy lệnh
      if (now - openedAt >= 15000) {
        opened = false;
        isExit = false;
        carSeen = false;
        phase = "CANCELLED";
        return LOWER;
      }

      // 2. Xe đã đi qua cổng (đã thấy xe carSeen và sau đó cảm biến cổng thoáng cleared >= 2 lần)
      // Chờ tối thiểu 1.2s sau khi mở để servo hoàn thành góc quay
      if (valid && carSeen && cleared >= 2 && now - openedAt >= 1200) {
        opened = false;
        isExit = false;
        carSeen = false;
        phase = "PASSED";
        return LOWER;
      }
    }

    return NONE;
  }

  // Manual close cancels a cycle; it must never fabricate a passage or crush a vehicle.
  bool cancel() {
    if (opened && (!valid || cleared < 2)) return false;
    opened = false;
    isExit = false;
    carSeen = false;
    phase = "CANCELLED";
    return true;
  }

 private:
  uint8_t detected = 0, cleared = 0;
  uint32_t requestedAt = 0, openedAt = 0;
};
