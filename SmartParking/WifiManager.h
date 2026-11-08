#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H
#include <Arduino.h>

bool setupWiFi();
void handleWiFi();
void updateParkingStatus(bool valid, bool occupied, float distance);
void updateSensorStatus(float temperature, int lightValue, bool alarm);
void updateGateStatus(bool open);
// Implemented by the sketch; true means servo setpoint applied, not measured position.
bool applyGateCommand(bool open, bool clearConfirmed);
#endif
