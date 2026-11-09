
#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H

#include <Arduino.h>

// Các lệnh điều khiển cổng
enum GateCommand {
  GATE_NONE,
  GATE_OPEN,
  GATE_CLOSE
};

// Khởi tạo Wi-Fi Access Point và Web Server
void setupWiFi();

// Xử lý các yêu cầu HTTP từ Python/Web
void handleWiFi();

// Lấy lệnh mở/đóng cổng đang chờ
GateCommand consumeGateCommand();

// Cập nhật trạng thái chỗ đỗ xe
void updateParkingStatus(bool occupied, float distance);

// Cập nhật dữ liệu cảm biến
void updateSensorStatus(float temperature, int lightValue);

// Cập nhật trạng thái cổng (Mở / Đóng)
void updateGateStatus(bool isOpen);

#endif
