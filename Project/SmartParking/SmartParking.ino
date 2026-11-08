
#include <ESP32Servo.h>
#include <math.h>

#include "WifiManager.h"

// ================= PIN CONFIGURATION =================

// Cảm biến siêu âm HC-SR04
#define TRIG_PIN 5
#define ECHO_PIN 18

// Servo điều khiển barrier
#define SERVO_PIN 13

// Buzzer
#define BUZZER_PIN 12

// Cảm biến ánh sáng LDR
#define LDR_PIN 34

// Cảm biến nhiệt độ NTC
#define NTC_PIN 35

// LED chiếu sáng
#define LED_GATE 2

// LED cảnh báo cháy
#define LED_ALARM 4


// ================= CONFIGURATION =================

// Khoảng cách xác định có xe
const float SLOT_THRESHOLD = 15.0;

// Ngưỡng cảnh báo nhiệt độ
const float TEMP_THRESHOLD = 45.0;

// Ngưỡng ánh sáng
const int LDR_THRESHOLD = 500;

// Thông số NTC
const float BETA = 3950.0;
const float R_FIXED = 10000.0;
const float R_NOMINAL = 10000.0;
const float TEMP_NOMINAL = 298.15;


// ================= OBJECTS =================

Servo gateServo;


// ================= SENSOR FUNCTIONS =================

// Đọc khoảng cách từ HC-SR04
float readDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);

  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  // Chờ tối đa 30ms
  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 30000);

  // Không nhận được tín hiệu phản hồi
  if (duration == 0) {
    return -1;
  }

  // Tính khoảng cách cm
  float distance = duration * 0.0343 / 2.0;

  return distance;
}


// Đọc nhiệt độ từ NTC
float readTemperature() {
  int adcValue = analogRead(NTC_PIN);

  // Tránh chia cho 0
  if (adcValue <= 0 || adcValue >= 4095) {
    return -100;
  }

  // Tính điện trở NTC
  float resistance =
    R_FIXED * (4095.0 / adcValue - 1.0);

  // Công thức Beta
  float steinhart;

  steinhart = resistance / R_NOMINAL;
  steinhart = log(steinhart);
  steinhart /= BETA;
  steinhart += 1.0 / TEMP_NOMINAL;
  steinhart = 1.0 / steinhart;

  // Chuyển Kelvin sang Celsius
  float temperature = steinhart - 273.15;

  return temperature;
}


// ================= SETUP =================

void setup() {
  Serial.begin(115200);

  // Cấu hình chân cảm biến siêu âm
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  // Cấu hình LED và Buzzer
  pinMode(LED_GATE, OUTPUT);
  pinMode(LED_ALARM, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  // Đọc ADC ESP32 12-bit: 0 - 4095
  analogReadResolution(12);

  // Khởi tạo Servo
  gateServo.setPeriodHertz(50);
  gateServo.attach(SERVO_PIN, 500, 2400);

  // Ban đầu đóng cổng
  gateServo.write(0);

  // Tắt các thiết bị cảnh báo
  digitalWrite(LED_GATE, LOW);
  digitalWrite(LED_ALARM, LOW);
  digitalWrite(BUZZER_PIN, LOW);

  // Khởi động Wi-Fi và Web Server
  setupWiFi();

  Serial.println("Smart Parking System Ready!");
}


// ================= MAIN LOOP =================

void loop() {

  // --------------------------------
  // 1. XỬ LÝ YÊU CẦU WIFI
  // --------------------------------

  handleWiFi();


  // --------------------------------
  // 2. ĐIỀU KHIỂN SERVO
  // --------------------------------

  // Lấy lệnh từ Python/Web
  GateCommand command = consumeGateCommand();

  if (command == GATE_OPEN) {
    gateServo.write(90);

    Serial.println("GATE OPENED");
  }

  else if (command == GATE_CLOSE) {
    gateServo.write(0);

    Serial.println("GATE CLOSED");
  }


  // --------------------------------
  // 3. KIỂM TRA CHỖ ĐỖ XE
  // --------------------------------

  float distance = readDistance();

  bool slotOccupied = false;

  if (distance > 0 && distance < SLOT_THRESHOLD) {
    slotOccupied = true;
  }

  // Cập nhật trạng thái cho API
  updateParkingStatus(slotOccupied, distance);


  // --------------------------------
  // 4. KIỂM TRA ÁNH SÁNG
  // --------------------------------

  int ldrValue = analogRead(LDR_PIN);

  // Giả sử giá trị LDR thấp khi trời tối
  if (ldrValue < LDR_THRESHOLD) {
    digitalWrite(LED_GATE, HIGH);
  } else {
    digitalWrite(LED_GATE, LOW);
  }


  // --------------------------------
  // 5. KIỂM TRA NHIỆT ĐỘ
  // --------------------------------

  float temperature = readTemperature();

  bool fireAlarm = temperature >= TEMP_THRESHOLD;

  if (fireAlarm) {
    digitalWrite(BUZZER_PIN, HIGH);
    digitalWrite(LED_ALARM, HIGH);
  } else {
    digitalWrite(BUZZER_PIN, LOW);
    digitalWrite(LED_ALARM, LOW);
  }


  // --------------------------------
  // 6. CẬP NHẬT DỮ LIỆU CHO WIFI
  // --------------------------------

  updateSensorStatus(temperature, ldrValue);


  // --------------------------------
  // 7. HIỂN THỊ SERIAL MONITOR
  // --------------------------------

  Serial.println("========== SMART PARKING ==========");

  Serial.print("Distance: ");
  Serial.print(distance);
  Serial.println(" cm");

  Serial.print("Slot: ");
  Serial.println(slotOccupied ? "OCCUPIED" : "EMPTY");

  Serial.print("Temperature: ");
  Serial.print(temperature);
  Serial.println(" C");

  Serial.print("LDR: ");
  Serial.println(ldrValue);

  Serial.println("===================================");

  delay(500);
}
