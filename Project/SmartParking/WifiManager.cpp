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

// API mở cổng: POST /open (hoặc GET /open để test qua trình duyệt)
void handleOpen() {
  pendingCommand = GATE_OPEN;

  server.send(
    200,
    "application/json",
    "{\"status\":\"COMMAND_RECEIVED\",\"command\":\"OPEN\"}"
  );
}

// API đóng cổng: POST /close (hoặc GET /close)
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
  String status = slotOccupied ? "OCCUPIED" : "AVAILABLE";

  String json = "{";
  json += "\"slot_id\":1,";
  json += "\"status\":\"" + status + "\",";
  json += "\"distance\":" + String(slotDistance, 2);
  json += "}";

  server.send(200, "application/json", json);
}

// API lấy toàn bộ trạng thái hệ thống: GET /status
void handleStatus() {
  String gateStatus = gateOpen ? "OPEN" : "CLOSED";
  String slotStatus = slotOccupied ? "OCCUPIED" : "AVAILABLE";
  bool isFire = (currentTemperature >= 45.0);

  String json = "{";
  json += "\"gate\":\"" + gateStatus + "\",";
  json += "\"slot\":\"" + slotStatus + "\",";
  json += "\"distance\":" + String(slotDistance, 2) + ",";
  json += "\"temperature\":" + String(currentTemperature, 2) + ",";
  json += "\"temperatureValid\":true,";
  json += "\"fireAlarm\":" + String(isFire ? "true" : "false") + ",";
  json += "\"light\":" + String(currentLightValue);
  json += "}";

  server.send(200, "application/json", json);
}


// ================= WIFI FUNCTIONS =================

void setupWiFi() {
  Serial.println();
  Serial.println("Khoi dong Wi-Fi Access Point ESP32...");

  // Bật chế độ SoftAP, cho phép tối đa 8 thiết bị kết nối cùng lúc (Laptop 1, Laptop 2, điện thoại)
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASSWORD, 1, 0, 8);

  // In địa chỉ IP cố định của ESP32
  Serial.print("Wi-Fi SSID : ");
  Serial.println(AP_SSID);
  Serial.print("Mat khau   : ");
  Serial.println(AP_PASSWORD);
  Serial.print("ESP32 IP   : ");
  Serial.println(WiFi.softAPIP()); // Luôn là 192.168.4.1

  // Bật CORS để hỗ trợ Web/Dashboard kết nối trực tiếp không bị chặn
  server.enableCORS(true);

  // Đăng ký các API Endpoint
  server.on("/open", HTTP_POST, handleOpen);
  server.on("/open", HTTP_GET, handleOpen);
  server.on("/close", HTTP_POST, handleClose);
  server.on("/close", HTTP_GET, handleClose);
  server.on("/slot", HTTP_GET, handleSlot);
  server.on("/status", HTTP_GET, handleStatus);

  // Trang kiểm tra kết nối qua trình duyệt
  server.on("/", HTTP_GET, []() {
    server.send(
      200,
      "text/plain",
      "Smart Parking ESP32 AP is READY at 192.168.4.1!"
    );
  });

  // Khởi động Web Server
  server.begin();

  Serial.println("ESP32 Web Server da san sang nhan lenh!");
}


// Xử lý yêu cầu HTTP liên tục trong hàm loop
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


// Cập nhật trạng thái cổng (Mở / Đóng)
void updateGateStatus(bool isOpen) {
  gateOpen = isOpen;
}
