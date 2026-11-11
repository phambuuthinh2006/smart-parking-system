#include "../Project/SmartParking_Uno/GateCycle.h"
#include <assert.h>
#include "../Project/SmartParking_Uno/SlotSensor.h"

int main() {
  SlotSensor slot;
  slot.sample(9);
  assert(strcmp(slot.status, "UNKNOWN") == 0);
  slot.sample(9); assert(strcmp(slot.status, "OCCUPIED") == 0);
  slot.sample(16); assert(strcmp(slot.status, "OCCUPIED") == 0);
  slot.sample(-1); assert(strcmp(slot.status, "UNKNOWN") == 0);
  slot.sample(30); slot.sample(30); slot.sample(30);
  assert(strcmp(slot.status, "AVAILABLE") == 0);

  const char* id = "11111111-2222-3333-8444-555555555555";
  // Request-ID rules. Timing rules are covered in gate_cycle_time_test.cpp.
  GateCycle c;
  assert(!c.request("partial-uart-id", 0));  // Malformed ID is rejected.
  assert(!c.opened);
  assert(c.request(id, 0));                  // Valid ID opens immediately.
  assert(c.opened && strcmp(c.phase, "OPEN") == 0);
  assert(!c.request(id, 1));                 // Duplicate while open is ignored.
  c.sample(9, 100); c.sample(9, 200);        // Car passes under the barrier.
  c.sample(30, 300);
  assert(c.sample(30, 5300) == GateCycle::LOWER);
  assert(!c.opened && strcmp(c.phase, "PASSED") == 0);
  assert(!c.request(id, 6000));              // Retried ACK cannot reopen the same cycle.
  assert(c.request("22222222-2222-3333-8444-555555555555", 7000));
  assert(c.opened);
}
