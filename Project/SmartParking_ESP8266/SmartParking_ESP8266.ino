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


// ================= HTTP API HANDLERS =================

// API mở barrier: POST hoặc GET /open
void handleOpen() {
  // Gửi lệnh mở cho Uno R3 qua Serial
  Serial.println("OPEN");

  server.send(
    200,
    "application/json",
    "{\"status\":\"COMMAND_RECEIVED\",\"command\":\"OPEN\"}"
  );
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
  json += "\"light\":" + String(currentLightValue);
  json += "}";

  server.send(200, "application/json", json);
}


// ================= XỬ LÝ DỮ LIỆU TỪ ARDUINO UNO R3 =================

// Chuỗi gửi từ Uno có định dạng:
// STATUS:<slot_occupied>,<slot_distance>,<gate_state>,<temp>,<ldr>\n
void readDataFromUno() {
  while (Serial.available() > 0) {
    String line = Serial.readStringUntil('\n');
    line.trim();

    if (line.startsWith("STATUS:")) {
      String data = line.substring(7); // Bỏ tiền tố "STATUS:"
      
      // Tách chuỗi theo dấu phẩy
      int idx1 = data.indexOf(',');
      int idx2 = data.indexOf(',', idx1 + 1);
      int idx3 = data.indexOf(',', idx2 + 1);
      int idx4 = data.indexOf(',', idx3 + 1);

      if (idx1 > 0 && idx2 > 0 && idx3 > 0 && idx4 > 0) {
        String sSlot = data.substring(0, idx1);
        String sDist = data.substring(idx1 + 1, idx2);
        String sGate = data.substring(idx2 + 1, idx3);
        String sTemp = data.substring(idx3 + 1, idx4);
        String sLdr  = data.substring(idx4 + 1);

        slotOccupied = (sSlot == "1");
        slotDistance = sDist.toFloat();
        gateOpen     = (sGate == "1");
        currentTemperature = sTemp.toFloat();
        currentLightValue  = sLdr.toInt();
      }
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

