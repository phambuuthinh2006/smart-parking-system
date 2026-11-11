#include <cassert>
#include <iostream>
#include <cstring>
#include "GateCycle.h"

int main() {
  std::cout << "Starting GateCycle Time-based Verification Tests..." << std::endl;

  // UUID helper
  const char* uuid1 = "11111111-1111-1111-1111-111111111111";
  const char* uuid2 = "22222222-2222-2222-2222-222222222222";
  const char* uuid3 = "33333333-3333-3333-3333-333333333333";
  const char* uuid4 = "44444444-4444-4444-4444-444444444444";
  const char* uuid5 = "55555555-5555-5555-5555-555555555555";
  const char* uuid6 = "66666666-6666-6666-6666-666666666666";
  const char* uuid7 = "77777777-7777-7777-7777-777777777777";

  // =========================================================================
  // Test 1 & 2: Khe trống < 5s không đóng; trống đủ 5s -> PASSED
  // =========================================================================
  {
    GateCycle cycle;
    uint32_t now = 1000;
    // Car at gate
    cycle.sample(5.0f, now);
    now += 70;
    cycle.sample(5.0f, now);
    assert(cycle.present);

    assert(cycle.request(uuid1, now));
    assert(cycle.opened);
    assert(cycle.carSeen);

    // Car moving through gate for 1500ms
    for (int i = 0; i < 20; ++i) {
      now += 70;
      GateCycle::Action a = cycle.sample(5.0f, now);
      assert(a == GateCycle::NONE);
      assert(cycle.opened);
    }

    // Car clears: First sample >= 10cm sets clearSince = now
    now += 70;
    cycle.sample(25.0f, now);
    uint32_t clearStart = now;

    // Test < 5s clear does NOT close gate
    while (now - clearStart < 4900) {
      now += 70;
      GateCycle::Action a = cycle.sample(25.0f, now);
      assert(a == GateCycle::NONE);
      assert(cycle.opened);
    }
    std::cout << "  [PASS] Test 1: Khe trống < 5s không đóng gate" << std::endl;

    // Advance until closed: must trigger LOWER and PASSED
    GateCycle::Action a = GateCycle::NONE;
    while (cycle.opened) {
      now += 70;
      a = cycle.sample(25.0f, now);
    }
    assert(a == GateCycle::LOWER);
    assert(!cycle.opened);
    assert(strcmp(cycle.phase, "PASSED") == 0);
    std::cout << "  [PASS] Test 2: Trống đủ 5s -> PASSED" << std::endl;
  }

  // =========================================================================
  // Test 3: Xe quay lại giữa chừng -> reset bộ đếm
  // =========================================================================
  {
    GateCycle cycle;
    uint32_t now = 1000;
    assert(cycle.request(uuid2, now));
    now += 100;
    cycle.sample(5.0f, now);
    assert(cycle.carSeen);

    // Clears for 3 seconds
    now += 70;
    cycle.sample(25.0f, now);
    uint32_t clearStart = now;
    while (now - clearStart < 3000) {
      now += 70;
      cycle.sample(25.0f, now);
      assert(cycle.opened);
    }

    // Car body part / obstacle appears again at 3s! (e.g. trailer or reversing)
    now += 70;
    cycle.sample(6.0f, now); // Obstacle detected! Resets clearSince!

    // Clears again: must wait another full 5 seconds!
    now += 70;
    cycle.sample(25.0f, now);
    uint32_t newClearStart = now;
    while (now - newClearStart < 4900) {
      now += 70;
      GateCycle::Action a = cycle.sample(25.0f, now);
      assert(a == GateCycle::NONE);
      assert(cycle.opened);
    }

    // Reach 5s after the second clear
    GateCycle::Action a = GateCycle::NONE;
    while (cycle.opened) {
      now += 70;
      a = cycle.sample(25.0f, now);
    }
    assert(a == GateCycle::LOWER);
    assert(!cycle.opened);
    assert(strcmp(cycle.phase, "PASSED") == 0);
    std::cout << "  [PASS] Test 3: Xe quay lại giữa chừng -> reset bộ đếm và phải chờ đủ 5s mới đóng" << std::endl;
  }

  // =========================================================================
  // Test 4: Đọc lỗi xen giữa không xóa bộ đếm (chỉ tạm dừng bộ đếm)
  // =========================================================================
  {
    GateCycle cycle;
    uint32_t now = 1000;
    assert(cycle.request(uuid3, now));
    now += 100;
    cycle.sample(5.0f, now); // seen

    // 2 seconds of valid clear
    now += 70;
    cycle.sample(25.0f, now);
    uint32_t clearStart = now;
    while (now - clearStart < 2000) {
      now += 70;
      cycle.sample(25.0f, now);
    }

    // 1 second of sensor errors (e.g. echo timeout returning -1)
    for (int i = 0; i < 14; ++i) { // 14 * 70 = 980ms of error
      now += 70;
      GateCycle::Action a = cycle.sample(-1.0f, now);
      assert(a == GateCycle::NONE);
      assert(cycle.opened);
    }

    // Valid clear resumes: because 1s was error, we still need 3s more of valid clear (total 5s valid clear)
    uint32_t resumeStart = now;
    while (now - resumeStart < 2900) {
      now += 70;
      GateCycle::Action a = cycle.sample(25.0f, now);
      assert(a == GateCycle::NONE); // Still open!
    }

    // Reach 5s of accumulated valid clear
    GateCycle::Action a = GateCycle::NONE;
    while (cycle.opened) {
      now += 70;
      a = cycle.sample(25.0f, now);
    }
    assert(a == GateCycle::LOWER);
    assert(!cycle.opened);
    assert(strcmp(cycle.phase, "PASSED") == 0);
    std::cout << "  [PASS] Test 4: Đọc lỗi xen giữa không xóa bộ đếm, tạm dừng và tích lũy đủ 5s -> PASSED" << std::endl;
  }

  // =========================================================================
  // Test 5: Xe qua sau giây 15 vẫn ra PASSED (không CANCELLED)
  // =========================================================================
  {
    GateCycle cycle;
    uint32_t now = 1000;
    assert(cycle.request(uuid4, now));

    // Car stands under gate until 16 seconds after opening
    while (now - 1000 < 16000) {
      now += 70;
      cycle.sample(5.0f, now); // Car seen and standing under gate
      assert(cycle.opened);
    }
    assert(cycle.carSeen);

    // At 16s, car starts clearing. Trống liên tục 5s -> lúc này now - openedAt = 21s (đã qua mốc 20s)!
    GateCycle::Action a = GateCycle::NONE;
    while (cycle.opened) {
      now += 70;
      a = cycle.sample(25.0f, now);
    }

    assert(a == GateCycle::LOWER);
    assert(!cycle.opened);
    // MUST BE PASSED, NEVER CANCELLED!
    assert(strcmp(cycle.phase, "PASSED") == 0);
    std::cout << "  [PASS] Test 5: Xe qua sau giây 15 vẫn ra PASSED (không bị CANCELLED)" << std::endl;
  }

  // =========================================================================
  // Test 6: Không có xe 20s + trống -> CANCELLED
  // =========================================================================
  {
    GateCycle cycle;
    uint32_t now = 1000;
    assert(cycle.request(uuid5, now));
    assert(!cycle.carSeen);

    // Gate opens but no car ever approaches (< 19.9s: should NOT cancel)
    while (now - 1000 < 19900) {
      now += 70;
      GateCycle::Action a = cycle.sample(30.0f, now);
      assert(a == GateCycle::NONE);
      assert(cycle.opened);
    }

    // Reach 20s + clear >= 5s -> must trigger LOWER and CANCELLED
    GateCycle::Action a = GateCycle::NONE;
    while (cycle.opened) {
      now += 70;
      a = cycle.sample(30.0f, now);
    }
    assert(a == GateCycle::LOWER);
    assert(!cycle.opened);
    assert(strcmp(cycle.phase, "CANCELLED") == 0);
    std::cout << "  [PASS] Test 6: Không có xe 20s + trống -> CANCELLED" << std::endl;
  }

  // =========================================================================
  // Test 7: 30s hạ bắt buộc (Force lower)
  // =========================================================================
  {
    GateCycle cycle;
    uint32_t now = 1000;
    assert(cycle.request(uuid6, now));

    // Car or obstacle permanently blocks gate (< 10cm) until < 29.9s
    while (now - 1000 < 29900) {
      now += 70;
      GateCycle::Action a = cycle.sample(5.0f, now);
      assert(a == GateCycle::NONE);
      assert(cycle.opened);
    }

    // At 30s, force lower kicks in
    GateCycle::Action a = GateCycle::NONE;
    while (cycle.opened) {
      now += 70;
      a = cycle.sample(5.0f, now);
    }
    assert(a == GateCycle::LOWER);
    assert(!cycle.opened);
    assert(strcmp(cycle.phase, "CANCELLED") == 0);
    std::cout << "  [PASS] Test 7: 30s hạ bắt buộc kể cả khi có vật cản" << std::endl;
  }

  // =========================================================================
  // Test 8: Đóng tay chỉ khi trống liên tục >= 1000ms
  // =========================================================================
  {
    GateCycle cycle;
    uint32_t now = 1000;
    assert(cycle.request(uuid7, now));

    // Car is under gate: manual close MUST be refused!
    now += 100;
    cycle.sample(5.0f, now);
    assert(!cycle.cancel(now));
    assert(cycle.opened);

    // Car clears: first sample
    now += 70;
    cycle.sample(25.0f, now);
    // After 500ms (< 1000ms): manual close MUST be refused!
    now += 500;
    cycle.sample(25.0f, now);
    assert(!cycle.cancel(now));
    assert(cycle.opened);

    // After 1100ms (>= 1000ms): manual close is accepted!
    now += 600;
    cycle.sample(25.0f, now);
    assert(cycle.cancel(now));
    assert(!cycle.opened);
    assert(strcmp(cycle.phase, "CANCELLED") == 0);
    std::cout << "  [PASS] Test 8: Đóng tay bị từ chối khi trống < 1s, chấp nhận khi trống >= 1s" << std::endl;
  }

  std::cout << "\n>>> ALL 8/8 GATECYCLE VERIFICATION TESTS PASSED 100%! <<<\n" << std::endl;
  return 0;
}
