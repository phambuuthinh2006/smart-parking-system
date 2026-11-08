
#include "WifiManager.h"

#include <WiFi.h>
#include <WebServer.h>

// ================= WIFI ACCESS POINT =================

const char* AP_SSID = "SMART_PARKING_ESP32";
const char* AP_PASSWORD = "12345678";

// Web Server chạy tại cổng 80
WebServer server(80);

// ================= SHARED STATUS =================

// Trạng thái cổng
bool gateOpen = false;

// Trạng thái chỗ đỗ xe
bool slotOccupied = false;
float slotDistance = 0;

// Dữ liệu cảm biến
float currentTemperature = 0;
int currentLightValue = 0;

// Lệnh điều khiển đang chờ xử lý
GateCommand pendingCommand = GATE_NONE;


// ================= API HANDLERS =================

// API mở cổng: POST /open
void handleOpen() {
  pendingCommand = GATE_OPEN;

  server.send(
    200,
    "application/json",
    "{\"status\":\"COMMAND_RECEIVED\",\"command\":\"OPEN\"}"
  );
}

// API đóng cổng: POST /close
void handleClose() {
  pendingCommand = GATE_CLOSE;

  server.send(
    200,
    "application/json",
    "{\"status\":\"COMMAND_RECEIVED\",\"command\":\"CLOSE\"}"
  );
}

// API lấy trạng thái chỗ đỗ xe: GET /slot
void handleSlot() {
  String status = slotOccupied ? "OCCUPIED" : "EMPTY";

  String json = "{";
  json += "\"slot_id\":1,";
  json += "\"status\":\"" + status + "\",";
  json += "\"distance\":" + String(slotDistance, 2);
  json += "}";

  server.send(200, "application/json", json);
}

// API lấy toàn bộ trạng thái: GET /status
void handleStatus() {
  String gateStatus = gateOpen ? "OPEN" : "CLOSED";
  String slotStatus = slotOccupied ? "OCCUPIED" : "EMPTY";

  String json = "{";
  json += "\"gate\":\"" + gateStatus + "\",";
  json += "\"slot\":\"" + slotStatus + "\",";
  json += "\"distance\":" + String(slotDistance, 2) + ",";
  json += "\"temperature\":" + String(currentTemperature, 2) + ",";
  json += "\"light\":" + String(currentLightValue);
  json += "}";

  server.send(200, "application/json", json);
}


// ================= WIFI FUNCTIONS =================

void setupWiFi() {
  Serial.println();
  Serial.println("Starting Wi-Fi Access Point...");

  // Tạo mạng Wi-Fi do ESP32 phát
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASSWORD);

  // In địa chỉ IP
  Serial.print("Wi-Fi SSID: ");
  Serial.println(AP_SSID);

  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.softAPIP());

  // Đăng ký các API
  server.on("/open", HTTP_POST, handleOpen);
  server.on("/close", HTTP_POST, handleClose);
  server.on("/slot", HTTP_GET, handleSlot);
  server.on("/status", HTTP_GET, handleStatus);

  // Trang kiểm tra kết nối
  server.on("/", HTTP_GET, []() {
    server.send(
      200,
      "text/plain",
      "Smart Parking ESP32 is running!"
    );
  });

  // Khởi động Web Server
  server.begin();

  Serial.println("Web Server started!");
}


// Xử lý yêu cầu HTTP liên tục
void handleWiFi() {
  server.handleClient();
}


// Lấy lệnh điều khiển và xóa lệnh đã nhận
GateCommand consumeGateCommand() {
  GateCommand command = pendingCommand;
  pendingCommand = GATE_NONE;

  return command;
}


// Cập nhật dữ liệu chỗ đỗ xe
void updateParkingStatus(bool occupied, float distance) {
  slotOccupied = occupied;
  slotDistance = distance;
}


// Cập nhật dữ liệu cảm biến
void updateSensorStatus(float temperature, int lightValue) {
  currentTemperature = temperature;
  currentLightValue = lightValue;
}
