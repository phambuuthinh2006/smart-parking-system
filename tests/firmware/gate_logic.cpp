#include "../../SmartParking/GateLogic.h"
#include <cassert>
int main() {
  GateLogic g;
  assert(!g.command(false, true)); // no valid sensor sample yet
  g.sample(49); assert(!g.alarm);
  g.sample(50); assert(g.alarm && g.open);
  assert(!g.command(false, true));
  g.sample(47); assert(g.alarm);
  g.sample(NAN); assert(g.alarm && g.open && !g.temperatureValid);
  assert(!g.command(false, true));
  g.sample(45); assert(!g.alarm && g.open); // cooling does not close
  assert(!g.command(false, false));
  assert(g.command(false, true) && !g.open);
  g.sample(47); assert(!g.alarm);
  g.sample(NAN); assert(!g.command(false, true));
  assert(g.command(true, false)); // evacuation open permitted with sensor fault
  g.sample(151); assert(!g.temperatureValid);
  GateLogic reboot; reboot.alarm = true; reboot.open = true;
  reboot.sample(NAN); assert(reboot.alarm && reboot.open);
  reboot.sample(47); assert(reboot.alarm);
  reboot.sample(45); assert(!reboot.alarm && reboot.open);
}
