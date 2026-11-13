#pragma once
#include <stdint.h>
#include <string.h>

// Demo inference: present -> open immediately on backend approval -> detect vehicle passage -> lower.
// Ngưỡng cảm biến cổng calibrated: < 10.0cm là có xe đứng trước/dưới cổng (độ nhạy lý tưởng cho mô hình bàn học).
static const float GATE_THRESHOLD = 10.0f;
static const uint32_t MIN_OPEN_MS = 1200;            // Thời gian tối thiểu sau khi mở (1.2s)
static const uint32_t CLEAR_PASSAGE_MS = 2500;       // Trống liên tục >= 5000ms để xác nhận xe đã qua (PASSED)
static const uint32_t TIMEOUT_CANCEL_MS = 20000;     // Timeout không có xe qua (20s)
// static const uint32_t FORCE_LOWER_MS = 36000000;        // Hạ bắt buộc tối đa (10h)
static const uint32_t MANUAL_CLOSE_CLEAR_MS = 1000;  // Đóng thủ công chỉ khi trống liên tục >= 1000ms

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
    clearSince = 0;
    lastSampleAt = now;
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
    clearSince = 0;
    lastSampleAt = now;
    isExit = true;
    carSeen = false;
    return true;
  }

  Action sample(float cm, uint32_t now) {
    uint32_t delta = (lastSampleAt > 0 && now >= lastSampleAt) ? (now - lastSampleAt) : 0;
    lastSampleAt = now;

    distance = cm;
    valid = cm > 0 && cm <= 400;
    if (!valid) {
      detected = cleared = 0;
      if (opened) phase = "BLOCKED";
      // Đọc lỗi (0 / mất echo / >400) -> tạm dừng bộ đếm, KHÔNG xóa mốc
      if (clearSince > 0) {
        clearSince += delta;
      }
    } else if (cm < GATE_THRESHOLD) {
      carSeen = true;
      if (detected < 2) ++detected;
      cleared = 0;
      clearSince = 0; // Thấy xe (< 10cm) -> xóa mốc thời gian trống
      if (detected >= 2) present = true;
      if (opened) phase = "OPEN";
    } else {
      if (cleared < 2) ++cleared;
      detected = 0;
      if (cleared >= 2) present = false;
      // Thấy trống hợp lệ -> nếu chưa có mốc thì ghi now, có rồi thì giữ
      if (clearSince == 0) {
        clearSince = now;
      }
    }

    if (opened) {
      uint32_t clearDuration = (clearSince > 0 && now >= clearSince) ? (now - clearSince) : 0;

      // 1. Kiểm tra xe đã qua (PASSED) TRƯỚC timeout CANCELLED:
      // Xe đã đi qua cổng (đã thấy xe carSeen và sau đó cảm biến cổng trống liên tục >= 5000ms)
      // Chờ tối thiểu 1.2s sau khi mở để servo hoàn thành góc quay
      if (carSeen && clearDuration >= CLEAR_PASSAGE_MS && (now - openedAt >= MIN_OPEN_MS)) {
        opened = false;
        isExit = false;
        carSeen = false;
        clearSince = 0;
        lastSampleAt = 0;
        phase = "PASSED";
        return LOWER;
      }

      // 2. Timeout không có xe qua (!carSeen) -> CANCELLED sau 20s và trống liên tục >= 5000ms
      if (!carSeen && (now - openedAt >= TIMEOUT_CANCEL_MS) && clearDuration >= CLEAR_PASSAGE_MS) {
        opened = false;
        isExit = false;
        carSeen = false;
        clearSince = 0;
        lastSampleAt = 0;
        phase = "CANCELLED";
        return LOWER;
      }

      // 3. Hạ bắt buộc sau 30 giây để tránh kẹt vĩnh viễn
      // if (now - openedAt >= FORCE_LOWER_MS) {
      //   opened = false;
      //   isExit = false;
      //   carSeen = false;
      //   clearSince = 0;
      //   lastSampleAt = 0;
      //   phase = "CANCELLED";
      //   return LOWER;
      // }
    }

    return NONE;
  }

  // Manual close cancels a cycle; chỉ cho đóng khi trống liên tục >= 1000ms
  bool cancel(uint32_t now = 0) {
    if (now == 0) now = lastSampleAt;
    uint32_t clearDuration = (clearSince > 0 && now >= clearSince) ? (now - clearSince) : 0;
    if (opened && (!valid || clearDuration < MANUAL_CLOSE_CLEAR_MS)) return false;
    opened = false;
    isExit = false;
    carSeen = false;
    clearSince = 0;
    lastSampleAt = 0;
    phase = "CANCELLED";
    return true;
  }

 private:
  uint8_t detected = 0, cleared = 0;
  uint32_t requestedAt = 0, openedAt = 0;
  uint32_t clearSince = 0;
  uint32_t lastSampleAt = 0;
};
