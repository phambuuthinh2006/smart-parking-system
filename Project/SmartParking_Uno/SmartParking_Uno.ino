/*
 * ==================================================================================
 * DỰ ÁN: SMART PARKING SYSTEM - ARDUINO UNO R3 (ĐẦU NÃO XỬ LÝ)
 * ==================================================================================
 * Nhiệm vụ:
 *  - Đọc 2 cảm biến siêu âm (Slot đỗ xe và cảm biến trước Barrier).
 *  - Đọc cảm biến nhiệt độ LM35 (báo cháy) & cảm biến quang trở LDR (bật đèn chiếu sáng).
 *  - Điều khiển Servo Barrier đóng/mở tự động theo State Machine an toàn.
 *  - Giao tiếp Serial với ESP8266 (nhận lệnh OPEN/CLOSE, gửi dữ liệu telemetry sang ESP).
 * ==================================================================================
 */

#include <Servo.h>
#include <SoftwareSerial.h>
#include "GateCycle.h"
#include "SlotSensor.h"

// ================= PIN CONFIGURATION =================

// Giao tiếp với ESP8266 qua SoftwareSerial (tránh chiếm cổng USB Serial D0/D1)
// Chân D2 (RX) nối với chân TX của ESP8266
// Chân D3 (TX) nối với chân RX của ESP8266 (khuyên dùng qua cầu chia áp 1k/2k)
#define ESP_RX_PIN 2
#define ESP_TX_PIN 3

// Còi Buzzer
#define BUZZER_PIN 4

// Cảm biến siêu âm 1: Kiểm tra xe tại chỗ đỗ (Slot 1)
#define TRIG_PIN 5
#define ECHO_PIN 6

// Cảm biến siêu âm 2: Đặt TRƯỚC Barrier để phát hiện xe tới cổng
#define TRIG_PIN_2 7
#define ECHO_PIN_2 8

// Servo điều khiển cần Barrier (Chân PWM)
#define SERVO_PIN 9

// LED chiếu sáng cổng
#define LED_GATE 11

// LED cảnh báo cháy
#define LED_ALARM 12

// Cảm biến ánh sáng LDR (Cầu phân áp 10k LDR + 10k R)
#define LDR_PIN A0

// Cảm biến nhiệt độ LM35 (Ngõ ra 10mV / độ C)
#define LM35_PIN A1


// ================= CONFIGURATION =================

// Khoảng cách xác định có xe tại chỗ đỗ (slot) - cm
const float SLOT_THRESHOLD = 15.0;

// Khoảng cách xác định có xe đứng TRƯỚC Barrier - cm (ngưỡng 10cm chuẩn mô hình bàn học)
const float GATE_SENSOR_THRESHOLD = 10.0;

// Ngưỡng nhiệt độ cảnh báo cháy (°C)
const float TEMP_THRESHOLD = 45.0;

// Ngưỡng cảm biến ánh sáng LDR trên Uno R3 (ADC 10-bit: 0 - 1023)
const int LDR_ON  = 400;   // Dưới 400: Trời tối -> BẬT ĐÈN
const int LDR_OFF = 700;   // Trên 700: Trời sáng -> TẮT ĐÈN
static bool lightOn = false;

// Số lần đọc liên tiếp để xác nhận trạng thái (chống nhiễu)
const int DETECT_CONFIRM_COUNT = 3;
const int CLEAR_CONFIRM_COUNT = 3;

// Thời gian tối đa giữ yêu cầu mở từ Web khi chưa thấy xe (30 giây)
const unsigned long WEB_REQUEST_TIMEOUT = 30000;

// Thời gian tối đa Barrier được mở (phòng trường hợp kẹt cảm biến - 25 giây)
// No forced timeout close: unknown/blocked sensor keeps the barrier open.


// ================= OBJECTS & STATE =================

Servo gateServo;
SoftwareSerial espSerial(ESP_RX_PIN, ESP_TX_PIN);

// Trạng thái Barrier
enum GateState {
  GATE_CLOSED_STATE,  // Barrier đóng: Chờ kết hợp (Web yêu cầu + Xe trước barrier)
  GATE_OPENED_STATE   // Barrier mở: Chờ xe đi qua khỏi tầm cảm biến trước barrier
};

GateState gateState = GATE_CLOSED_STATE;
GateCycle gateCycle;
SlotSensor slotSensor;

// Cờ ghi nhận yêu cầu mở từ Web
bool webOpenRequested = false;
unsigned long webRequestTime = 0;

// Bộ đếm xác nhận cảm biến trước barrier
int detectedCount = 0;
int clearCount = 0;
bool isCarInFront = false;

// Thời gian mở barrier để đếm timeout an toàn
unsigned long gateOpenedTime = 0;

// Bộ đếm thời gian non-blocking
unsigned long lastSensorCheck = 0;
unsigned long lastSerialPrint = 0;
unsigned long lastEspSend = 0;

// Lưu trữ dữ liệu cảm biến
bool slotOccupied = false;
float slotDistance = 0.0;
float currentTemperature = 0.0;
int currentLightValue = 0;


// ================= SENSOR FUNCTIONS =================

// Đọc khoảng cách từ cảm biến siêu âm (cm)
float readUltrasonic(int trigPin, int echoPin) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);

  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  unsigned long duration = pulseIn(echoPin, HIGH, 30000); // Timeout 30ms

  if (duration == 0) {
    return -1; // Ngoài tầm đo hoặc không phản hồi
  }

  return (duration * 0.0343) / 2.0;
}

// Cảm biến 1: Slot đỗ xe
float readDistance() {
  return readUltrasonic(TRIG_PIN, ECHO_PIN);
}

// Cảm biến 2: Xe đứng trước Barrier
float readGateDistance() {
  return readUltrasonic(TRIG_PIN_2, ECHO_PIN_2);
}

// Đọc nhiệt độ từ cảm biến LM35 (ADC 10-bit trên 5V)
float readTemperature() {
  uint32_t sum = 0;
  for (int i = 0; i < 16; i++) {
    sum += analogRead(LM35_PIN);
    delayMicroseconds(200);
  }
  float avgRaw = sum / 16.0;
  float milliVolts = (avgRaw * 5000.0) / 1024.0;
  return milliVolts / 10.0; // 10mV = 1 độ C
}


// ================= GATE CONTROL =================

// void openGate() {
//   gateServo.write(90);
//   gateState = GATE_OPENED_STATE;
//   gateOpenedTime = millis();
//   clearCount = 0;

//   Serial.println(F("\n============================================="));
//   Serial.println(F(">>> [BARRIER ACTION] MO BARRIER (90 do) <<<"));
//   Serial.println(F(">>> Cho xe di qua khoi vung cam bien...      <<<"));
//   Serial.println(F("=============================================\n"));
// }

// void closeGate() {
//   gateServo.write(0);
//   gateState = GATE_CLOSED_STATE;
//   webOpenRequested = false;
//   detectedCount = 0;
//   clearCount = 0;

//   Serial.println(F("\n============================================="));
//   Serial.println(F(">>> [BARRIER ACTION] DONG BARRIER (0 do)  <<<"));
//   Serial.println(F("=============================================\n"));
// }

// ================= GATE CONTROL (ĐÃ CHỐNG RUNG GIẬT) =================

void openGate() {
  gateServo.attach(SERVO_PIN); // Bật cấp xung điều khiển
  gateServo.write(90);         // Quay mở 90 độ
  delay(400);                  // Đợi 400ms cho cần quay hẳn lên
  gateServo.detach();          // Ngắt xung để triệt tiêu hoàn toàn rung giật!

  gateState = GATE_OPENED_STATE;
  gateOpenedTime = millis();
  clearCount = 0;

  Serial.println(F("\n============================================="));
  Serial.println(F(">>> [BARRIER ACTION] MO BARRIER (90 do) <<<"));
  Serial.println(F(">>> Cho xe di qua khoi vung cam bien...      <<<"));
  Serial.println(F("=============================================\n"));
}

void closeGate() {
  gateServo.attach(SERVO_PIN); // Bật cấp xung điều khiển
  gateServo.write(0);          // Quay đóng về 0 độ
  delay(400);                  // Đợi 400ms cho cần hạ hẳn xuống
  gateServo.detach();          // Ngắt xung để triệt tiêu hoàn toàn rung giật!

  gateState = GATE_CLOSED_STATE;
  webOpenRequested = false;
  detectedCount = 0;
  clearCount = 0;

  Serial.println(F("\n============================================="));
  Serial.println(F(">>> [BARRIER ACTION] DONG BARRIER (0 do)  <<<"));
  Serial.println(F("=============================================\n"));
}

// ================= LOGIC XỬ LÝ LỆNH TỪ ESP8266 =================

void handleEspCommunication() {
  // Lắng nghe dữ liệu gửi từ ESP8266 qua SoftwareSerial
  while (espSerial.available() > 0) {
    String line = espSerial.readStringUntil('\n');
    line.trim();

    if (line.startsWith("OPEN_EXIT:") || line.equalsIgnoreCase("OPEN_EXIT")) {
      String id = line.startsWith("OPEN_EXIT:") ? line.substring(10) : "";
      if (gateCycle.requestExit(id.c_str(), millis())) {
        openGate();
        Serial.println(F("\n============================================="));
        Serial.println(F(">>> [EXIT ACTION] MO BARRIER NGAY CHO XE RA <<<"));
        Serial.println(F("=============================================\n"));
      }
    } else if (line.equalsIgnoreCase("OPEN") || line.startsWith("OPEN:")) {
      String id = line.startsWith("OPEN:") ? line.substring(5) : "";
      // Mở barrier NGAY KHI NHẬN LỆNH từ Backend/ESP, không chờ detected == 3
      if (gateCycle.request(id.c_str(), millis())) {
        openGate();
        Serial.println(F("\n============================================="));
        Serial.println(F(">>> [ENTRY ACTION] MO BARRIER NGAY CHO XE VAO <<<"));
        Serial.println(F("=============================================\n"));
      }
    } else if (line.equalsIgnoreCase("CLOSE")) {
      if (gateCycle.cancel()) closeGate();
      else Serial.println(F("[AUTO] Close refused: sensor blocked or unknown"));
    }
  }
}

// Gửi định kỳ trạng thái cảm biến sang ESP8266
// Định dạng: STATUS:<slot_occupied>,<slot_distance>,<gate_state>,<temp>,<ldr>\n
void sendStatusToEsp() {
  espSerial.print(F("STATUS:"));
  espSerial.print(slotOccupied ? "1" : "0");
  espSerial.print(F(","));
  espSerial.print(slotDistance > 0 ? slotDistance : 0.0, 1);
  espSerial.print(F(","));
  espSerial.print(gateState == GATE_OPENED_STATE ? "1" : "0");
  espSerial.print(F(","));
  espSerial.print(currentTemperature, 1);
  espSerial.print(F(","));
  espSerial.print(currentLightValue);
  espSerial.print(F(","));
  espSerial.print(gateCycle.requestId);
  espSerial.print(F(","));
  espSerial.print(gateCycle.phase);
  espSerial.print(F(","));
  espSerial.print(gateCycle.distance, 1);
  espSerial.print(F(","));
  espSerial.print(gateCycle.valid ? "1" : "0");
  espSerial.print(F(","));
  espSerial.print(slotSensor.status);
  espSerial.print(F(","));
  espSerial.print(gateCycle.present ? "1" : "0");
  espSerial.print(F(","));
  espSerial.println(slotSensor.valid ? "1" : "0");
}


// ================= GATE SENSOR & LOGIC STATE MACHINE =================

void handleGateLogic() {
  GateCycle::Action action = gateCycle.sample(readGateDistance(), millis());
  isCarInFront = gateCycle.present;
  webOpenRequested = gateCycle.opened;
  if (action == GateCycle::RAISE) openGate();
  if (action == GateCycle::LOWER) closeGate();
}


// ================= SETUP =================

void setup() {
  Serial.begin(115200);       // Serial USB theo dõi trên máy tính
  espSerial.begin(9600);      // SoftwareSerial giao tiếp với ESP8266

    // Khởi tạo Servo: Quay về 0 độ rồi ngắt xung để chống rung
  gateServo.attach(SERVO_PIN);
  gateServo.write(0);
  delay(400);
  gateServo.detach();
  gateState = GATE_CLOSED_STATE;

  // Cấu hình chân cảm biến siêu âm
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(TRIG_PIN_2, OUTPUT);
  pinMode(ECHO_PIN_2, INPUT);

  // Cấu hình LED và Buzzer
  pinMode(LED_GATE, OUTPUT);
  pinMode(LED_ALARM, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  // Khởi tạo Servo
  //gateServo.attach(SERVO_PIN);
  //gateServo.write(0); // Ban đầu đóng barrier
  //gateState = GATE_CLOSED_STATE;

  // Tắt cảnh báo ban đầu
  digitalWrite(LED_GATE, LOW);
  digitalWrite(LED_ALARM, LOW);
  digitalWrite(BUZZER_PIN, LOW);

  Serial.println(F("========================================="));
  Serial.println(F("   SMART PARKING - UNO EXPERIMENT PROTOCOL 3 READY  "));
  Serial.println(F("========================================="));
}


// ================= MAIN LOOP =================

void loop() {
  // 1. Nhận lệnh từ ESP8266
  handleEspCommunication();

  unsigned long currentMillis = millis();

  // 2. Đọc cảm biến & Xử lý Barrier mỗi 70ms (mượt mà, không lag)
  if (currentMillis - lastSensorCheck >= 70) {
    lastSensorCheck = currentMillis;

    // Xử lý Barrier kết hợp Web + Cảm biến trước Barrier
    handleGateLogic();

    // --------------------------------
    // 3. KIỂM TRA CHỖ ĐỖ XE (SLOT 1)
    // --------------------------------
    slotDistance = readDistance();
    slotSensor.sample(slotDistance);
    slotOccupied = strcmp(slotSensor.status, "OCCUPIED") == 0;

    // --------------------------------
    // 4. KIỂM TRA ÁNH SÁNG (LDR HYSTERESIS)
    // --------------------------------
    currentLightValue = analogRead(LDR_PIN);
    if (!lightOn && currentLightValue < LDR_ON) {
      lightOn = true;
    } else if (lightOn && currentLightValue > LDR_OFF) {
      lightOn = false;
    }
    digitalWrite(LED_GATE, lightOn ? HIGH : LOW);

    // --------------------------------
    // 5. KIỂM TRA NHIỆT ĐỘ (LM35)
    // --------------------------------
    currentTemperature = readTemperature();
    bool fireAlarm = (currentTemperature >= TEMP_THRESHOLD);

    if (fireAlarm) {
      digitalWrite(BUZZER_PIN, HIGH);
      digitalWrite(LED_ALARM, HIGH);
    } else {
      digitalWrite(BUZZER_PIN, LOW);
      digitalWrite(LED_ALARM, LOW);
    }
  }

  // 3. Gửi trạng thái sang ESP8266 mỗi 500ms
  if (currentMillis - lastEspSend >= 500) {
    lastEspSend = currentMillis;
    sendStatusToEsp();
  }

  // 4. In thông tin định kỳ ra Serial Monitor mỗi 1.5 giây
  if (currentMillis - lastSerialPrint >= 1500) {
    lastSerialPrint = currentMillis;

    float gateDistance = readGateDistance();

    Serial.println(F("========== SMART PARKING MONITOR (UNO) =========="));
    Serial.print(F("[Slot 1 (Xe do)]     : "));
    Serial.print(slotDistance > 0 ? String(slotDistance, 1) + " cm" : "N/A");
    Serial.print(F(" -> "));
    Serial.println(slotOccupied ? F("CO XE (OCCUPIED)") : F("TRONG (EMPTY)"));

    Serial.print(F("[Sensor Truoc Barrier]: "));
    Serial.print(gateDistance > 0 ? String(gateDistance, 1) + " cm" : "Thoang");
    Serial.print(F(" -> "));
    Serial.println(isCarInFront ? F("CO XE DANG CHO") : F("KHONG CO XE"));

    Serial.print(F("[Web Open Request]    : "));
    Serial.println(webOpenRequested ? F("DANG CHO XE TOI") : F("KHONG"));

    Serial.print(F("[Trang Thai Barrier]  : "));
    Serial.println(gateState == GATE_OPENED_STATE ? F("DANG MO (90 do)") : F("DANG DONG (0 do)"));

    Serial.print(F("[Moi Truong]          : "));
    Serial.print(F("Temp: "));
    Serial.print(currentTemperature, 1);
    Serial.print(F(" C | LDR: "));
    Serial.println(currentLightValue);
    Serial.println(F("=================================================\n"));
  }
}

