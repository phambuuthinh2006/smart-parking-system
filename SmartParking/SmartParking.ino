
#include <ESP32Servo.h>
#include <math.h>
#include <Preferences.h>
#include "GateLogic.h"

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
// Policy is implemented in GateLogic: ON >=50, OFF <=45°C.

// Ngưỡng ánh sáng
const int LDR_THRESHOLD = 500;

// Thông số NTC
const float BETA = 3950.0;
const float R_FIXED = 10000.0;
const float R_NOMINAL = 10000.0;
const float TEMP_NOMINAL = 298.15;


// ================= OBJECTS =================

Servo gateServo;
GateLogic gate;
Preferences settings;
bool wifiReady = false;
bool storedAlarm = false;
bool storedOpen = false;

bool applyGateCommand(bool open, bool clearConfirmed) {
  if (!gate.command(open, clearConfirmed)) return false;
  gateServo.write(gate.open ? 90 : 0);
  updateGateStatus(gate.open);
  if (storedOpen != gate.open) {
    storedOpen = gate.open;
    settings.putBool("open", storedOpen);
  }
  return true;
}


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
    return NAN;
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
  if (!isfinite(temperature) || temperature < -40 || temperature > 150) return NAN;

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

  // Restore active fire latch across reboot; do not treat reboot as all-clear.
  settings.begin("parking", false);
  storedAlarm = settings.getBool("alarm", false);
  gate.alarm = storedAlarm;
  storedOpen = settings.getBool("open", false);
  gate.open = storedAlarm || storedOpen;
  gateServo.write(gate.open ? 90 : 0);
  updateGateStatus(gate.open);

  // Tắt các thiết bị cảnh báo
  digitalWrite(LED_GATE, LOW);
  digitalWrite(LED_ALARM, LOW);
  digitalWrite(BUZZER_PIN, LOW);

  // Khởi động Wi-Fi và Web Server
  wifiReady = setupWiFi();

  Serial.println("Smart Parking System Ready!");
}


// ================= MAIN LOOP =================

void loop() {
  static unsigned long lastSample = 0;
  static bool first = true;
  unsigned long now = millis();
  if (wifiReady) handleWiFi();

  // Schedule sensors without a blocking half-second delay. pulseIn still has a 30ms bound.
  if (first || now - lastSample >= 250) {
    first = false;
    lastSample = now;
    float distance = readDistance();
    bool validDistance = isfinite(distance) && distance > 0 && distance <= 400;
    updateParkingStatus(validDistance, validDistance && distance < SLOT_THRESHOLD, distance);
    int light = analogRead(LDR_PIN);
    digitalWrite(LED_GATE, light < LDR_THRESHOLD ? HIGH : LOW);
    float temperature = readTemperature();
    gate.sample(temperature);
    if (storedAlarm != gate.alarm) {
      storedAlarm = gate.alarm;
      settings.putBool("alarm", storedAlarm);
    }
    gateServo.write(gate.open ? 90 : 0);
    updateGateStatus(gate.open);
    if (storedOpen != gate.open) {
      storedOpen = gate.open;
      settings.putBool("open", storedOpen);
    }
    updateSensorStatus(temperature, light, gate.alarm);
  }
  bool blink = gate.alarm && ((millis() / 300) % 2 == 0);
  digitalWrite(LED_ALARM, blink ? HIGH : LOW);
  digitalWrite(BUZZER_PIN, gate.alarm ? HIGH : LOW);
}
