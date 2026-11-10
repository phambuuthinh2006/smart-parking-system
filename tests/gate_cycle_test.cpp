#include "../Project/SmartParking_Uno/GateCycle.h"
#include <assert.h>
#include "../Project/SmartParking_Uno/SlotSensor.h"

int main() {
  SlotSensor slot;
  slot.sample(10); slot.sample(10);
  assert(strcmp(slot.status, "UNKNOWN") == 0);
  slot.sample(10); assert(strcmp(slot.status, "OCCUPIED") == 0);
  slot.sample(16); assert(strcmp(slot.status, "OCCUPIED") == 0);
  slot.sample(-1); assert(strcmp(slot.status, "UNKNOWN") == 0);
  slot.sample(30); slot.sample(30); slot.sample(30);
  assert(strcmp(slot.status, "AVAILABLE") == 0);

  const char* id = "11111111-2222-3333-8444-555555555555";
  GateCycle c;
  assert(!c.request("partial-uart-id", 0));
  assert(c.request(id, 0));
  assert(!c.request(id, 1));
  for (int i = 0; i < 3; ++i) assert(c.sample(-1, i*100) == GateCycle::NONE);
  assert(!c.opened);  // No echo cannot authorize opening.
  c.sample(10, 300); c.sample(10, 400);
  assert(c.sample(10, 500) == GateCycle::RAISE);
  // Timeout or disconnected sensor must never close or report a passage.
  assert(c.sample(-1, 26000) == GateCycle::NONE);
  assert(c.opened && strcmp(c.phase, "BLOCKED") == 0);
  assert(!c.cancel());
  c.sample(30, 26100); c.sample(30, 26200);
  assert(c.sample(30, 26300) == GateCycle::LOWER);
  assert(!c.opened && strcmp(c.phase, "PASSED") == 0);
  assert(!c.request(id, 27000));  // Retrying ACK cannot open the same cycle again.
  assert(c.request("22222222-2222-3333-8444-555555555555", 28000));
  c.sample(30, 29000);
  c.sample(30, 58000);
  assert(strcmp(c.phase, "CANCELLED") == 0); // No arrival, no visit counted.
  assert(!c.opened);
  GateCycle shortCycle;
  assert(shortCycle.request(id, 0));
  shortCycle.sample(10, 10); shortCycle.sample(10, 20);
  assert(shortCycle.sample(10, 30) == GateCycle::RAISE);
  shortCycle.sample(30, 40); shortCycle.sample(30, 50);
  assert(shortCycle.sample(30, 60) == GateCycle::NONE); // Minimum open time.
  assert(shortCycle.sample(30, 1230) == GateCycle::LOWER);
}
