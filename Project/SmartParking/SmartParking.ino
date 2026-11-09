#include <ESP32Servo.h>
#include <math.h>

#include "WifiManager.h"

// ================= PIN CONFIGURATION =================

// Cảm biến siêu âm 1: Kiểm tra chỗ đỗ xe (GIỮ NGUYÊN)
#define TRIG_PIN 5
#define ECHO_PIN 18

// Cảm biến siêu âm 2: Đặt TRƯỚC Barrier để phát hiện xe
#define TRIG_PIN_2 19
#define ECHO_PIN_2 21

// Servo điều khiển barrier
#define SERVO_PIN 13

// Buzzer
#define BUZZER_PIN 27

// Cảm biến ánh sáng LDR
#define LDR_PIN 34

// Cảm biến nhiệt độ NTC
#define NTC_PIN 35

// LED chiếu sáng
#define LED_GATE 2

// LED cảnh báo cháy
#define LED_ALARM 4


// ================= CONFIGURATION =================

// Khoảng cách xác định có xe tại chỗ đỗ (slot)
const float SLOT_THRESHOLD = 15.0;

// Khoảng cách xác định có xe đứng TRƯỚC Barrier
const float GATE_SENSOR_THRESHOLD = 15.0;

// Ngưỡng cảnh báo nhiệt độ
const float TEMP_THRESHOLD = 45.0;

// Ngưỡng ánh sáng
const int LDR_THRESHOLD = 500;

// Số lần đọc liên tiếp để xác nhận trạng thái (chống nhiễu)
const int DETECT_CONFIRM_COUNT = 3;
const int CLEAR_CONFIRM_COUNT = 3;

// Thời gian tối đa giữ yêu cầu mở từ Web khi chưa thấy xe (30s)
const unsigned long WEB_REQUEST_TIMEOUT = 30000;

// Thời gian tối đa Barrier được mở (phòng trường hợp kẹt cảm biến - 25s)
const unsigned long GATE_MAX_OPEN_TIME = 25000;

// Thông số NTC
const float BETA = 3950.0;
const float R_FIXED = 10000.0;
const float R_NOMINAL = 10000.0;
const float TEMP_NOMINAL = 298.15;


// ================= OBJECTS & STATE =================

Servo gateServo;

// Trạng thái Barrier
enum GateState {
  GATE_CLOSED_STATE,  // Barrier đóng: Chờ kết hợp (Web yêu cầu + Xe trước barrier)
  GATE_OPENED_STATE   // Barrier mở: Chờ xe đi qua khỏi tầm cảm biến trước barrier
};

GateState gateState = GATE_CLOSED_STATE;

// Cờ ghi nhận yêu cầu mở từ Web/Python
bool webOpenRequested = false;
unsigned long webRequestTime = 0;

// Bộ đếm xác nhận cảm biến trước barrier
int detectedCount = 0;
int clearCount = 0;
bool isCarInFront = false; // Đã xác nhận chắc chắn có xe trước barrier

// Thời gian mở barrier để đếm timeout an toàn
unsigned long gateOpenedTime = 0;

// Bộ đếm thời gian non-blocking
unsigned long lastSensorCheck = 0;
unsigned long lastSerialPrint = 0;


// ================= SENSOR FUNCTIONS =================

// Đọc khoảng cách từ cảm biến siêu âm (trả về -1 nếu timeout)
float readUltrasonic(int trigPin, int echoPin) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);

  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  unsigned long duration = pulseIn(echoPin, HIGH, 30000);

  if (duration == 0) {
    return -1; // Không có vật cản hoặc ngoài tầm đo (> 5m)
  }

  float distance = duration * 0.0343 / 2.0;
  return distance;
}

// Cảm biến 1: Kiểm tra chỗ đỗ xe (slot)
float readDistance() {
  return readUltrasonic(TRIG_PIN, ECHO_PIN);
}

// Cảm biến 2: Kiểm tra xe TRƯỚC Barrier
float readGateDistance() {
  return readUltrasonic(TRIG_PIN_2, ECHO_PIN_2);
}

// Đọc nhiệt độ từ NTC
float readTemperature() {
  int adcValue = analogRead(NTC_PIN);

  if (adcValue <= 0 || adcValue >= 4095) {
    return -100;
  }

  float resistance = R_FIXED * (4095.0 / adcValue - 1.0);
  float steinhart = resistance / R_NOMINAL;
  steinhart = log(steinhart);
  steinhart /= BETA;
  steinhart += 1.0 / TEMP_NOMINAL;
  steinhart = 1.0 / steinhart;

  float temperature = steinhart - 273.15;
  return temperature;
}


// ================= GATE CONTROL =================

// Mở Barrier
void openGate() {
  gateServo.write(90);
  gateState = GATE_OPENED_STATE;
  gateOpenedTime = millis();
  clearCount = 0;

  // Cập nhật trạng thái sang WebServer
  updateGateStatus(true);

  Serial.println("\n=============================================");
  Serial.println(">>> [BARRIER ACTION] MO BARRIER (90 do) <<<");
  Serial.println(">>> Cho xe di qua khoi vung cam bien...      <<<");
  Serial.println("=============================================\n");
}

// Đóng Barrier
void closeGate() {
  gateServo.write(0);
  gateState = GATE_CLOSED_STATE;
  webOpenRequested = false;
  detectedCount = 0;
  clearCount = 0;

  // Cập nhật trạng thái sang WebServer
  updateGateStatus(false);

  Serial.println("\n=============================================");
  Serial.println(">>> [BARRIER ACTION] DONG BARRIER (0 do)  <<<");
  Serial.println("=============================================\n");
}


// ================= GATE SENSOR & LOGIC =================

void handleGateLogic() {
  // 1. Nhận lệnh từ Web / Python
  GateCommand command = consumeGateCommand();

  if (command == GATE_OPEN) {
    webOpenRequested = true;
    webRequestTime = millis();
    Serial.println("\n---------------------------------------------");
    Serial.println("[WEB REQUEST] Nhan duoc yeu cau MO BARRIER tu Web/Python!");
    if (isCarInFront) {
      Serial.println("[WEB REQUEST] Cam bien da san sang (co xe cho san)!");
    } else {
      Serial.println("[WEB REQUEST] Dang cho xe tien vao truoc Barrier de mo...");
    }
    Serial.println("---------------------------------------------\n");
  } 
  else if (command == GATE_CLOSE) {
    Serial.println("\n[WEB REQUEST] Nhan lenh DONG BARRIER thu cong tu Web/Python!");
    closeGate();
  }

  // 2. Đọc cảm biến siêu âm trước Barrier
  float gateDistance = readGateDistance();
  bool carDetectedNow = (gateDistance > 0 && gateDistance < GATE_SENSOR_THRESHOLD);

  // Bộ lọc chống nhiễu (yêu cầu N lần liên tiếp)
  if (carDetectedNow) {
    detectedCount++;
    clearCount = 0;

    if (detectedCount >= DETECT_CONFIRM_COUNT) {
      if (!isCarInFront) {
        isCarInFront = true;
        Serial.print("[SENSOR BARRIER] Phat hien XE TRUOC BARRIER! Khoang cach: ");
        Serial.print(gateDistance);
        Serial.println(" cm");
      }
    }
  } else {
    clearCount++;
    detectedCount = 0;

    if (clearCount >= CLEAR_CONFIRM_COUNT) {
      if (isCarInFront) {
        isCarInFront = false;
        Serial.println("[SENSOR BARRIER] Khong con xe truoc Barrier (vung cam bien da thoang).");
      }
    }
  }

  // 3. Xử lý State Machine cho Barrier
  if (gateState == GATE_CLOSED_STATE) {
    // ĐIỀU KIỆN MỞ: Cần cả Web yêu cầu + Cảm biến phát hiện có xe trước Barrier
    if (webOpenRequested && isCarInFront) {
      Serial.println("[LOGIC] Thoa man ca 2 dieu kien (Web mo + Co xe truoc Barrier) -> MO BARRIER!");
      openGate();
      webOpenRequested = false; // Đã thực thi lệnh mở
    }

    // Tự động hủy yêu cầu từ Web nếu quá thời gian mà xe không tới
    if (webOpenRequested && (millis() - webRequestTime > WEB_REQUEST_TIMEOUT)) {
      webOpenRequested = false;
      Serial.println("[TIMEOUT] Qua 30s khong co xe den truoc Barrier -> Tu dong HUY yeu cau mo tu Web!");
    }
  } 
  else if (gateState == GATE_OPENED_STATE) {
    // ĐIỀU KIỆN ĐÓNG: Cổng đang mở, khi xe đi qua và cảm biến trước barrier không còn thấy xe
    if (!isCarInFront) {
      Serial.println("[LOGIC] Xe da di qua khoi Barrier (cam bien thoang) -> DONG BARRIER!");
      closeGate();
    }
    // Timeout an toàn nếu xe dừng quá lâu hoặc lỗi cảm biến
    else if (millis() - gateOpenedTime > GATE_MAX_OPEN_TIME) {
      Serial.println("[SAFETY TIMEOUT] Barrier da mo qua 25s -> Tu dong dong de dam bao an toan!");
      closeGate();
    }
  }
}


// ================= SETUP =================

void setup() {
  Serial.begin(115200);

  // Cấu hình cảm biến 1: Slot đỗ xe
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  // Cấu hình cảm biến 2: Trước Barrier
  pinMode(TRIG_PIN_2, OUTPUT);
  pinMode(ECHO_PIN_2, INPUT);

  // Cấu hình LED và Buzzer
  pinMode(LED_GATE, OUTPUT);
  pinMode(LED_ALARM, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  // ADC 12-bit
  analogReadResolution(12);

  // Khởi tạo Servo
  gateServo.setPeriodHertz(50);
  gateServo.attach(SERVO_PIN, 500, 2400);

  // Mặc định ban đầu: Đóng Barrier
  gateServo.write(0);
  gateState = GATE_CLOSED_STATE;

  // Tắt cảnh báo
  digitalWrite(LED_GATE, LOW);
  digitalWrite(LED_ALARM, LOW);
  digitalWrite(BUZZER_PIN, LOW);

  // Khởi động Wi-Fi Access Point & Web Server
  setupWiFi();

  Serial.println("=========================================");
  Serial.println("   SMART PARKING SYSTEM ESP32 READY!     ");
  Serial.println("=========================================");
}


// ================= MAIN LOOP =================

void loop() {
  // 1. Phục vụ Web Server liên tục (non-blocking)
  handleWiFi();

  // 2. Đọc cảm biến & Xử lý Barrier mỗi 70ms để phản hồi nhanh, không lag
  unsigned long currentMillis = millis();

  if (currentMillis - lastSensorCheck >= 70) {
    lastSensorCheck = currentMillis;

    // Xử lý Barrier kết hợp Web + Cảm biến trước Barrier
    handleGateLogic();

    // --------------------------------
    // 3. KIỂM TRA CHỖ ĐỖ XE (GIỮ NGUYÊN)
    // --------------------------------
    float slotDistance = readDistance();
    bool slotOccupied = (slotDistance > 0 && slotDistance < SLOT_THRESHOLD);
    updateParkingStatus(slotOccupied, slotDistance);

    // --------------------------------
    // 4. KIỂM TRA ÁNH SÁNG
    // --------------------------------
    int ldrValue = analogRead(LDR_PIN);
    if (ldrValue < LDR_THRESHOLD) {
      digitalWrite(LED_GATE, HIGH);
    } else {
      digitalWrite(LED_GATE, LOW);
    }

    // --------------------------------
    // 5. KIỂM TRA NHIỆT ĐỘ
    // --------------------------------
    float temperature = readTemperature();
    bool fireAlarm = (temperature >= TEMP_THRESHOLD);

    if (fireAlarm) {
      digitalWrite(BUZZER_PIN, HIGH);
      digitalWrite(LED_ALARM, HIGH);
    } else {
      digitalWrite(BUZZER_PIN, LOW);
      digitalWrite(LED_ALARM, LOW);
    }

    // Cập nhật dữ liệu cảm biến sang WebServer
    updateSensorStatus(temperature, ldrValue);
  }

  // --------------------------------
  // 6. IN THÔNG TIN ĐỊNH KỲ RA SERIAL MONITOR (Mỗi 1.5 giây)
  // --------------------------------
  if (currentMillis - lastSerialPrint >= 1500) {
    lastSerialPrint = currentMillis;

    float slotDistance = readDistance();
    bool slotOccupied = (slotDistance > 0 && slotDistance < SLOT_THRESHOLD);
    float gateDistance = readGateDistance();
    float temperature = readTemperature();
    int ldrValue = analogRead(LDR_PIN);

    Serial.println("========== SMART PARKING MONITOR ==========");

    // Cảm biến 1: Slot đỗ xe (Giữ nguyên không đụng)
    Serial.print("[Slot 1 (Xe do)]     : ");
    Serial.print(slotDistance > 0 ? String(slotDistance, 1) + " cm" : "N/A");
    Serial.print(" -> ");
    Serial.println(slotOccupied ? "OCCUPIED (CO XE)" : "EMPTY (TRONG)");

    // Cảm biến 2: Trước Barrier
    Serial.print("[Sensor Truoc Barrier]: ");
    Serial.print(gateDistance > 0 ? String(gateDistance, 1) + " cm" : "Thoang (N/A)");
    Serial.print(" -> ");
    Serial.println(isCarInFront ? "PHAT HIEN XE DANG CHO" : "KHONG CO XE");

    // Yêu cầu từ Web
    Serial.print("[Web Open Request]    : ");
    Serial.println(webOpenRequested ? "CO (Dang cho xe toi)" : "KHONG");

    // Trạng thái Barrier
    Serial.print("[Trang Thai Barrier]  : ");
    Serial.println(gateState == GATE_OPENED_STATE ? "DANG MO (90 do)" : "DANG DONG (0 do)");

    // Nhiệt độ & Ánh sáng
    Serial.print("[Moi Truong]          : ");
    Serial.print("Temp: ");
    Serial.print(temperature, 1);
    Serial.print(" C | LDR: ");
    Serial.println(ldrValue);

    Serial.println("===========================================\n");
  }
}