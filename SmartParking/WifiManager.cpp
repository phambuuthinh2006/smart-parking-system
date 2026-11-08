#include "WifiManager.h"
#include "Config.h"
#include <WiFi.h>
#include <WebServer.h>
#include <math.h>

static WebServer server(80);
static bool gateOpen = false, slotValid = false, slotOccupied = false, fireAlarm = false;
static float slotDistance = NAN, currentTemperature = NAN;
static int currentLightValue = 0;
static unsigned long sampledAt = 0;

static bool authorized() {
  if (String(PARKING_API_KEY).length() < 24 || String(PARKING_API_KEY).startsWith("REPLACE") ||
      server.header("X-Device-Key") != PARKING_API_KEY) {
    server.send(401, "application/json", "{\"message\":\"Invalid device key\"}");
    return false;
  }
  return true;
}
static String number(float value) { return isfinite(value) ? String(value, 2) : String("null"); }
static String slot() { return !slotValid ? "UNKNOWN" : slotOccupied ? "OCCUPIED" : "AVAILABLE"; }
static void command(bool open) {
  if (!authorized()) return;
  // Closing requires an explicit operator confirmation that the passage is clear.
  bool clear = server.arg("clear") == "true";
  if (!applyGateCommand(open, clear)) {
    server.send(409, "application/json", "{\"message\":\"Close blocked: confirm clear passage, valid temperature and no fire\"}");
    return;
  }
  server.send(200, "application/json", String("{\"status\":\"APPLIED\",\"gate\":\"") +
    (gateOpen ? "OPEN" : "CLOSED") + "\",\"positionFeedback\":false}");
}

bool setupWiFi() {
  if (String(PARKING_AP_PASSWORD).length() < 8 || String(PARKING_AP_PASSWORD) == "CHANGE-ME-WIFI" ||
      String(PARKING_API_KEY).length() < 24 || String(PARKING_API_KEY).startsWith("REPLACE")) {
    Serial.println("Configure private AP password and API key in Config.h; HTTP disabled.");
    return false;
  }
  WiFi.mode(WIFI_AP);
  if (!WiFi.softAP(PARKING_AP_SSID, PARKING_AP_PASSWORD)) {
    Serial.println("Wi-Fi AP failed; local sensors and alarm remain active.");
    return false;
  }
  Serial.print("ESP32 IP: "); Serial.println(WiFi.softAPIP());
  const char* headers[] = {"X-Device-Key"};
  server.collectHeaders(headers, 1);
  server.on("/open", HTTP_POST, []() { command(true); });
  server.on("/close", HTTP_POST, []() { command(false); });
  server.on("/slot", HTTP_GET, []() {
    if (!authorized()) return;
    server.send(200, "application/json", String("{\"slot_id\":1,\"status\":\"") + slot() +
      "\",\"distance\":" + number(slotDistance) + "}");
  });
  server.on("/status", HTTP_GET, []() {
    if (!authorized()) return;
    String json = String("{\"gate\":\"") + (gateOpen ? "OPEN" : "CLOSED") +
      "\",\"positionFeedback\":false,\"slot\":\"" + slot() + "\",\"distance\":" + number(slotDistance) +
      ",\"temperature\":" + number(currentTemperature) + ",\"temperatureValid\":" +
      (isfinite(currentTemperature) ? "true" : "false") + ",\"fireAlarm\":" + (fireAlarm ? "true" : "false") +
      ",\"light\":" + String(currentLightValue) + ",\"sampleAgeMs\":" + String(millis() - sampledAt) + "}";
    server.sendHeader("Cache-Control", "no-store");
    server.send(200, "application/json", json);
  });
  server.on("/", HTTP_GET, []() { server.send(200, "text/plain", "Smart Parking ESP32"); });
  server.begin();
  return true;
}
void handleWiFi() { server.handleClient(); }
void updateGateStatus(bool open) { gateOpen = open; }
void updateParkingStatus(bool valid, bool occupied, float distance) {
  slotValid = valid; slotOccupied = occupied; slotDistance = valid ? distance : NAN;
}
void updateSensorStatus(float temperature, int lightValue, bool alarm) {
  currentTemperature = temperature; currentLightValue = lightValue; fireAlarm = alarm; sampledAt = millis();
}
