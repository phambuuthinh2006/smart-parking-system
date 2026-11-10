# Hướng dẫn Kết nối & Nạp Code: Arduino Uno R3 + ESP8266

Hệ thống được tách thành 2 vi điều khiển riêng biệt:
1. **Arduino Uno R3** (`SmartParking_Uno/`): Làm **đầu não xử lý**, đọc toàn bộ cảm biến, điều khiển Servo, Còi, LED và State Machine.
2. **ESP8266** (`SmartParking_ESP8266/`): Làm **bộ phát Wi-Fi AP** (`192.168.4.1`) và Web Server nhận gói tin HTTP từ Laptop.

---

## 1. Sơ đồ nối dây giữa Arduino Uno R3 và ESP8266

| Chân trên Arduino Uno R3 | Nối sang | Chân trên ESP8266 | Chức năng / Lưu ý |
| :--- | :---: | :--- | :--- |
| **D2 (RX)** | ─── | **TX** (GPIO 1) | Uno nhận lệnh `OPEN` / `CLOSE` từ ESP |
| **D3 (TX)** | ─── | **RX** (GPIO 3) | Uno gửi trạng thái sang ESP *(khuyên dùng qua cầu chia trở 1k/2k vì ESP dùng mức 3.3V)* |
| **GND** | ─── | **GND** | **BẮT BUỘC NỐI CHUNG GND** |
| **5V** (hoặc nguồn ngoài) | ─── | **VIN** (NodeMCU) | Nếu dùng ESP-01 cần nguồn 3.3V riêng cấp dòng đủ 300mA |

---

## 2. Sơ đồ chân cắm toàn bộ linh kiện trên Arduino Uno R3

| Linh kiện | Chân cắm trên Uno R3 | Chức năng |
| :--- | :--- | :--- |
| **Cảm biến siêu âm 1 (Slot đỗ xe)** | TRIG: **D5**, ECHO: **D6** | Đo khoảng cách chỗ đỗ (dưới 15cm = có xe) |
| **Cảm biến siêu âm 2 (Trước Barrier)** | TRIG: **D7**, ECHO: **D8** | Phát hiện xe đang đứng chờ trước barrier |
| **Servo Barrier** | **D9** (PWM) | Mở 90°, Đóng 0° |
| **Buzzer** | **D4** | Kêu khi nhiệt độ >= 45°C |
| **LED Chiếu sáng cổng** | **D11** | Bật khi trời tối (LDR kích hoạt) |
| **LED Cảnh báo cháy** | **D12** | Sáng cùng còi khi nhiệt độ cao |
| **Cảm biến ánh sáng LDR** | **A0** | Cầu phân áp 10k LDR + 10k R |
| **Cảm biến nhiệt độ LM35** | **A1** | Chân giữa (Vout) của LM35 (VCC nối 5V, GND nối GND) |

---

## 3. Cách nạp code bằng Arduino IDE

### Bước 1: Nạp cho Arduino Uno R3
1. Cắm cáp USB nối Arduino Uno R3 vào máy tính.
2. Trong Arduino IDE: Mở file `Project/SmartParking_Uno/SmartParking_Uno.ino`.
3. Menu **Tools** -> **Board** -> Chọn **Arduino Uno**.
4. Menu **Tools** -> **Port** -> Chọn cổng COM của Uno R3.
5. Nhấn nút **Upload** (Mũi tên sang phải).

### Bước 2: Nạp cho ESP8266
1. Cắm cáp USB nối mạch ESP8266 (NodeMCU / ESP-01 qua mạch nạp) vào máy tính.
2. Trong Arduino IDE: Mở file `Project/SmartParking_ESP8266/SmartParking_ESP8266.ino`.
3. Menu **Tools** -> **Board** -> Chọn **NodeMCU 1.0 (ESP-12E Module)** (hoặc Generic ESP8266 Module).
4. Menu **Tools** -> **Port** -> Chọn cổng COM của ESP8266.
5. Nhấn nút **Upload**.

---

## 4. Kiểm tra hoạt động
1. Cấp nguồn cho cả 2 mạch.
2. Mở Wi-Fi trên Laptop: Sẽ thấy mạng **`SMART_PARKING_ESP32`** (Mật khẩu: `12345678`).
3. Kết nối vào Wi-Fi và mở trình duyệt: Truy cập `http://192.168.4.1/status` để thấy toàn bộ thông số cảm biến từ Uno R3 gửi sang theo thời gian thực!



## Cập nhật chu kỳ tự động (protocol 2)

Phải nạp cả Uno và ESP mới. Uno cần `GateCycle.h` cùng thư mục `.ino`.
ESP `/status` thêm requestId/phase/gateDistance/gateSensorValid/protocolVersion/
telemetryValid/sampleAgeMs. Khung UART mới:
`STATUS:slot,distance,gate,temp,ldr,requestId,phase,gateDistance,gateSensorValid`.

Uno mở khi có yêu cầu và xe dưới15cm ổn định; đóng khi đo được vùng trống hợp lệ
3mẫu sau tối thiểu1.2s. Chờ xe quá30s thì CANCELLED; đang mở mà mất echo giữ cổng.
Đã bỏ ép đóng25s. Không echo không được coi là vùng trống; cần nền phản xạ khi không có xe.
PASSED chỉ suy luận xe rời vùng trên mô hình, không phân biệt xe tiến qua với lùi lại.
Đọc [SETUP.md](../SETUP.md) trước khi thử. Firmware báo trạng thái điều khiển servo,
không đo vị trí servo bằng cảm biến độc lập.
