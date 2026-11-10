/*
 * ==================================================================================
 * DỰ ÁN: SMART PARKING SYSTEM - ESP8266 (CARD WI-FI & WEB GATEWAY)
 * ==================================================================================
 * Nhiệm vụ:
 *  - Phát Wi-Fi Access Point (SSID: SMART_PARKING_ESP32, IP: 192.168.4.1).
 *  - Chạy WebServer (cổng 80) nhận các yêu cầu HTTP từ Laptop (Camera/Dashboard).
 *  - Chuyển tiếp lệnh HTTP (/open, /close) qua cổng Serial cho Arduino Uno R3.
 *  - Nhận chuỗi trạng thái cảm biến từ Uno R3 và phản hồi JSON cho các API (/status, /slot).
 * ==================================================================================
 */

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>

// ================= CẤU HÌNH WI-FI ACCESS POINT =================

// Giữ nguyên tên Wi-Fi để Laptop 1 và Laptop 2 không cần đổi cấu hình
const char* AP_SSID = "SMART_PARKING_ESP32";
const char* AP_PASSWORD = "12345678";

ESP8266WebServer server(80);

// ================= DỮ LIỆU ĐỒNG BỘ VỚI UNO R3 =================

bool gateOpen = false;
bool slotOccupied = false;
float slotDistance = 0.0;
float currentTemperature = 0.0;
int currentLightValue = 0;
String cycleRequestId = "";
String cyclePhase = "IDLE";
float gateDistance = -1;
bool gateSensorValid = false;
bool telemetryReceived = false;
unsigned long lastTelemetryAt = 0;
String serialLine;


// ================= HTTP API HANDLERS =================

// API mở barrier: POST hoặc GET /open
void handleOpen() {
  String id = server.arg("requestId");
  if (id.length()) {
    bool valid = id.length() == 36;
    for (unsigned int i = 0; valid && i < id.length(); ++i)
      valid = (i == 8 || i == 13 || i == 18 || i == 23) ? id[i] == '-' : isxdigit(id[i]);
    if (!valid) { server.send(400, "application/json", "{\"error\":\"Invalid requestId\"}"); return; }
  }
  Serial.println(id.length() ? "OPEN:" + id : "OPEN");
  server.send(200, "application/json", "{\"status\":\"COMMAND_RECEIVED\",\"requestId\":\"" + id + "\"}");
}

// API đóng barrier: POST hoặc GET /close
void handleClose() {
  // Gửi lệnh đóng cho Uno R3 qua Serial
  Serial.println("CLOSE");

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
  json += "\"distance\":" + String(slotDistance, 1);
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
  json += "\"distance\":" + String(slotDistance, 1) + ",";
  json += "\"temperature\":" + String(currentTemperature, 1) + ",";
  json += "\"temperatureValid\":true,";
  json += "\"fireAlarm\":" + String(isFire ? "true" : "false") + ",";
  json += "\"light\":" + String(currentLightValue) + ",";
  json += "\"protocolVersion\":2,";
  json += "\"telemetryValid\":" + String(telemetryReceived && millis() - lastTelemetryAt <= 2000 ? "true" : "false") + ",";
  json += "\"sampleAgeMs\":" + String(telemetryReceived ? millis() - lastTelemetryAt : 4294967295UL) + ",";
  json += "\"requestId\":\"" + cycleRequestId + "\",";
  json += "\"phase\":\"" + cyclePhase + "\",";
  json += "\"gateDistance\":" + String(gateDistance, 1) + ",";
  json += "\"gateSensorValid\":" + String(gateSensorValid ? "true" : "false");
  json += "}";

  server.send(200, "application/json", json);
}


// ================= XỬ LÝ DỮ LIỆU TỪ ARDUINO UNO R3 =================

// Chuỗi gửi từ Uno có định dạng:
// STATUS:<slot_occupied>,<slot_distance>,<gate_state>,<temp>,<ldr>\n
void processUnoLine(String line) {
  line.trim();
  if (!line.startsWith("STATUS:")) return;
  String fields[9];
  int start = 7;
  for (int i = 0; i < 9; ++i) {
    int end = line.indexOf(',', start);
    if (i < 8 && end < 0) return;  // Old firmware is not valid cycle telemetry.
    fields[i] = i == 8 ? line.substring(start) : line.substring(start, end);
    start = end + 1;
  }
  if (fields[5].length() > 36 || fields[6].length() > 12) return;
  slotOccupied = fields[0] == "1";
  slotDistance = fields[1].toFloat();
  gateOpen = fields[2] == "1";
  currentTemperature = fields[3].toFloat();
  currentLightValue = fields[4].toInt();
  cycleRequestId = fields[5];
  cyclePhase = fields[6];
  gateDistance = fields[7].toFloat();
  gateSensorValid = fields[8] == "1";
  telemetryReceived = true;
  lastTelemetryAt = millis();
}

void readDataFromUno() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n') { processUnoLine(serialLine); serialLine = ""; }
    else if (ch != '\r') {
      serialLine += ch;
      if (serialLine.length() > 160) serialLine = "";
    }
  }
}


// ================= SETUP =================

void setup() {
  // Serial giao tiếp với Uno R3 ở tốc độ 9600 baud
  Serial.begin(9600);

  // Cấu hình Wi-Fi Access Point
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASSWORD);

  // Bật CORS cho Web Dashboard
  server.enableCORS(true);

  // Đăng ký các API Endpoint
  server.on("/open", HTTP_POST, handleOpen);
  server.on("/open", HTTP_GET, handleOpen);
  server.on("/close", HTTP_POST, handleClose);
  server.on("/close", HTTP_GET, handleClose);
  server.on("/slot", HTTP_GET, handleSlot);
  server.on("/status", HTTP_GET, handleStatus);

  server.on("/", HTTP_GET, []() {
    server.send(200, "text/plain", "Smart Parking ESP8266 Gateway is READY at 192.168.4.1!");
  });

  server.begin();
}


// ================= MAIN LOOP =================

void loop() {
  // 1. Lắng nghe và cập nhật dữ liệu từ Uno R3
  readDataFromUno();

  // 2. Phục vụ các yêu cầu HTTP từ Laptop
  server.handleClient();
}

