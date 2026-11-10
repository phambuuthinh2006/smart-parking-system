# 📘 HƯỚNG DẪN THUYẾT TRÌNH & VẤN ĐÁP: NGƯỜI 1 - PHẦN CỨNG VI ĐIỀU KHIỂN & FIRMWARE

> **Vai trò trong nhóm:** Phụ trách Tầng 1 (IoT Edge Layer) — Lập trình Arduino Uno R3, ESP8266 Wi-Fi Gateway, cảm biến siêu âm, cảm biến nhiệt độ, quang trở và điều khiển Servo thanh chắn Barrier.

---

## 🎯 1. TỔNG QUAN PHẦN BẠN PHỤ TRÁCH
Bạn chịu trách nhiệm về toàn bộ phần cứng thực tế và code nhúng:
1. **Arduino Uno R3:** Đảm nhận vòng lặp thời gian thực cứng (Hard Real-time) chu kỳ 70ms: đo khoảng cách 2 cảm biến siêu âm, đọc nhiệt độ LM35, đọc quang trở LDR, điều khiển góc quay Servo SG90, còi Buzzer và LED báo động.
2. **ESP8266 Wi-Fi Gateway:** Đóng vai trò là Card mạng không dây phát Wi-Fi Access Point (`SMART_PARKING_ESP32`, IP: `192.168.4.1`), chạy WebServer cổng 80 nhận lệnh mở cổng `/open`, lệnh đóng `/close`, và cung cấp API JSON trạng thái `/status` theo **Protocol Version 3**.
3. **Cơ chế an toàn FSM (Finite State Machine):** Thuật toán 6 pha đảm bảo thanh chắn barrier không bao giờ tự ý hạ đè lên xe.

---

## 📂 2. CÁC FILE CODE VÀ ĐOẠN CODE TRỌNG TÂM CẦN MỞ SHOW CHO THẦY

### FILE 1: `Project/SmartParking_Uno/GateCycle.h`
* **Ý nghĩa:** Đây là "điểm sáng kỹ thuật" cao cấp nhất trên Arduino Uno: Máy trạng thái hữu hạn (FSM) xử lý chu trình Barrier an toàn.
* **Đoạn code cốt lõi cần chỉ cho thầy:**
  * **Enum và các biến trạng thái (Dòng 9 - 15):**
    ```cpp
    enum Action { NONE, RAISE, LOWER };
    const char* phase = "IDLE";
    char requestId[37] = "";
    bool opened = false;
    bool valid = false;
    bool present = false;
    float distance = -1;
    ```
  * **Hàm `request(id, now)` (Dòng 17 - 32):** Nhận lệnh mở cổng kèm mã `requestId` (UUID 36 ký tự). Chuyển trạng thái sang `WAITING`. Nếu sau 30 giây xe không tới (`now - requestedAt >= 30000`), chu trình tự động huỷ `CANCELLED` để chống mở cửa vô hạn.
  * **Hàm `sample(cm, now)` (Dòng 34 - 65):**
    * *Bộ lọc chống rung (Debouncing):* Khoảng cách $< 15\text{cm}$ phải xuất hiện liên tục 3 lần đo (`detected == 3`) mới xác nhận có xe đến trước cổng (`present = true`).
    * *An toàn nâng barrier:* Khi đang `WAITING` và xe đã tới → trả về hành động `RAISE` (nâng thanh chắn).
    * *An toàn hạ barrier:* Khi barrier đang mở (`opened == true`), xe phải đi qua hẳn và cảm biến đo khoảng cách thông thoáng liên tục 3 lần (`cleared == 3`), đồng thời phải mở tối thiểu 1.2 giây (`now - openedAt >= 1200`) mới trả về hành động `LOWER` (hạ thanh chắn).

---

### FILE 2: `Project/SmartParking_Uno/SlotSensor.h`
* **Ý nghĩa:** Bộ lọc đo khoảng cách chỗ đỗ xe Slot 1 (P01) áp dụng kỹ thuật **Hysteresis (Ngưỡng trễ)** chống nhấp nháy trạng thái.
* **Đoạn code cốt lõi cần chỉ cho thầy (Dòng 8 - 20):**
  ```cpp
  void sample(float cm) {
    valid = cm > 0 && cm <= 400;
    if (!valid) { occupied = clear = 0; status = "UNKNOWN"; return; }
    if (cm < 15) {
      clear = 0;
      if (occupied < 3) ++occupied;
      if (occupied == 3) status = "OCCUPIED";
    } else if (cm >= 18) {
      occupied = 0;
      if (clear < 3) ++clear;
      if (clear == 3) status = "AVAILABLE";
    } else { occupied = clear = 0; }
  }
  ```
  * **Giải thích logic:** Khi xe vào, khoảng cách phải $< 15\text{cm}$ liên tiếp 3 lần mới chuyển sang `OCCUPIED`. Khi xe lùi ra, khoảng cách phải $\ge 18\text{cm}$ liên tiếp 3 lần mới chuyển sang `AVAILABLE`. Vùng giữa $15\text{cm} - 18\text{cm}$ là vùng đệm (deadband) giúp triệt tiêu hoàn toàn hiện tượng nhảy trạng thái liên tục do nhiễu sóng siêu âm.

---

### FILE 3: `Project/SmartParking_Uno/SmartParking_Uno.ino`
* **Ý nghĩa:** Chương trình điều khiển chính trên Arduino Uno R3.
* **Đoạn code cốt lõi:**
  * **Khai báo chân & Khởi tạo (Dòng 20 - 75):**
    * Cảm biến siêu âm ô đỗ: `TRIG_PIN 12`, `ECHO_PIN 13`.
    * Cảm biến siêu âm trước cổng: `TRIG_PIN_2 4`, `ECHO_PIN_2 5`.
    * Servo: `SERVO_PIN 9`.
    * Cảm biến nhiệt độ LM35: chân `A0`. Quang trở LDR: chân `A1`.
    * Còi Buzzer: chân `8`. Đèn LED cổng: chân `6`. LED cảnh báo cháy: chân `7`.
  * **Cơ chế chống cháy/rung Servo (Hàm `setup` và `closeGate`):**
    ```cpp
    gateServo.attach(SERVO_PIN);
    gateServo.write(0);
    delay(400);
    gateServo.detach(); // Ngắt xung điều khiển để chống rung và tiết kiệm điện
    ```
  * **Hàm `loop()` (Dòng 220 - 290):**
    * Vòng lặp cảm biến chạy mỗi `70ms`: gọi `handleGateLogic()`, đo khoảng cách ô đỗ, kiểm tra nhiệt độ LM35 (nếu $\ge 45^\circ\text{C}$ bật còi báo động), kiểm tra ánh sáng LDR (ngưỡng bật $< 400$, ngưỡng tắt $> 600$).
    * Gửi telemetry sang ESP8266 mỗi `500ms` qua hàm `sendStatusToEsp()`.

---

### FILE 4: `Project/SmartParking_ESP8266/SmartParking_ESP8266.ino`
* **Ý nghĩa:** Card Wi-Fi & Web Gateway trên ESP8266.
* **Đoạn code cốt lõi:**
  * **Phát Wi-Fi Access Point (Dòng 18 - 22):**
    `AP_SSID = "SMART_PARKING_ESP32"`, `AP_PASSWORD = "12345678"`, IP mặc định `192.168.4.1`.
  * **Xử lý lệnh HTTP mở cổng `handleOpen()` (Dòng 45 - 56):** Tiếp nhận `requestId`, xác thực chuẩn UUID 36 ký tự, sau đó gửi chuỗi `OPEN:<requestId>` sang Uno qua Serial.
  * **Xuất JSON trạng thái `handleStatus()` (Dòng 84 - 110):** Trả về JSON theo **Protocol Version 3** gồm 12 trường: `gate`, `slot`, `distance`, `temperature`, `fireAlarm`, `light`, `protocolVersion: 3`, `telemetryValid`, `sampleAgeMs`, `requestId`, `phase`, `gateDistance`.

---

## 🎤 3. KỊCH BẢN THUYẾT TRÌNH MẪU (BẠN NÓI KHOẢNG 2 - 3 PHÚT)

> *"Kính thưa thầy/cô và các bạn, em xin đại diện nhóm trình bày về **Tầng 1: Phần cứng Vi điều khiển và Firmware IoT** của hệ thống Smart Parking.*
>
> *Hệ thống phần cứng của tụi em được thiết kế theo nguyên lý **Phân tách trách nhiệm (Separation of Concerns)** bằng cách kết hợp 2 vi điều khiển:*
> 1. ***Arduino Uno R3*** *đóng vai trò vi điều khiển thời gian thực cứng (Hard Real-time). Uno R3 liên tục quét cảm biến với chu kỳ 70ms: quản lý 2 cảm biến siêu âm (1 ở trước cổng và 1 ở ô đỗ P01), đọc nhiệt độ LM35 để báo cháy khẩn cấp, đọc quang trở LDR tự động bật đèn chiếu sáng bãi xe và điều khiển Servo thanh chắn.*
> 2. ***ESP8266*** *đóng vai trò là một Network Interface Card (Card mạng không dây). ESP8266 phát mạng Wi-Fi nội bộ `SMART_PARKING_ESP32` tại IP `192.168.4.1`, chạy máy chủ WebServer tiếp nhận các API HTTP `/open` từ camera và xuất toàn bộ telemetry hệ thống dưới dạng JSON theo Protocol 3.*
>
> *Điểm đặc biệt nhất trong phần firmware là **Máy trạng thái hữu hạn FSM (`GateCycle.h`)** và **Thuật toán Hysteresis (`SlotSensor.h`)**:*
> * *Barrier của tụi em không hạ xuống theo thời gian mù quáng, mà nó theo dõi chu kỳ 6 pha: chỉ khi xe đã đi qua hẳn và cảm biến đo thông thoáng liên tục 3 lần đo thì servo mới được phép hạ xuống, triệt tiêu 100% rủi ro va đập vào thân xe.*
> * *Đồng thời, servo sau khi quay đủ góc sẽ được ngắt xung (`detach()`) để chống hiện tượng giật cục và chống nóng cuộn dây.*
>
> *Sau đây, em xin chuyển sang phần trình bày của bạn [Tên Người 2] về Tầng AI Camera nhận diện biển số."*

---

## ❓ 4. CÁC CÂU HỎI VẤN ĐÁP THẦY SẼ HỎI BẠN & CÁCH TRẢ LỜI ĐẠT ĐIỂM TỐI ĐA

### ❓ Câu hỏi 1: "Tại sao không dùng luôn 1 con ESP32 hay ESP8266 điều khiển tất cả mà phải dùng cả Arduino Uno lẫn ESP8266?"
> **Trả lời:** Dạ thưa thầy:
> 1. **Tính độc lập thời gian thực:** ESP8266 khi phải xử lý ngăn xếp mạng Wi-Fi TCP/IP và tiếp nhận HTTP Request rất dễ bị nghẽn (block) các tác vụ đo xung cảm biến siêu âm (`pulseIn`). Việc dùng Arduino Uno chạy độc lập giúp vòng quét cảm biến siêu âm và điều khiển servo luôn chạy mượt mà ở chu kỳ 70ms không bao giờ bị trễ.
> 2. **Số lượng chân I/O và chân Analog:** Arduino Uno có nhiều chân Digital và cổng ADC 5V phù hợp trực tiếp với cảm biến nhiệt độ LM35 và LDR, trong khi ESP8266 chỉ có 1 chân ADC và hoạt động ở điện áp 3.3V.

### ❓ Câu hỏi 2: "Tại sao trong code Uno lại gọi `gateServo.detach()` sau khi quay servo?"
> **Trả lời:** Dạ thưa thầy, servo SG90 nếu liên tục nhận xung điều khiển PWM (`attach`) ở một góc cố định thì các bánh răng và mạch điều khiển bên trong sẽ liên tục rung lắc (jitter) và sinh nhiệt lớn, dễ dẫn đến cháy servo hoặc sụt áp nguồn 5V làm vi điều khiển bị reset. Lệnh `detach()` sẽ ngắt hoàn toàn xung giữ sau khi servo đã quay tới đích $0^\circ$ hoặc $90^\circ$, giúp servo hoàn toàn êm ái, mát mẻ và tiết kiệm điện.

### ❓ Câu hỏi 3: "Nếu xe dừng ngay dưới thanh chắn barrier thì barrier có hạ xuống đè vào xe không?"
> **Trả lời:** Dạ tuyệt đối không thưa thầy! Trong file `GateCycle.h`, hàm `sample()` kiểm tra biến `cleared`. Cảm biến siêu âm trước cổng phải đo được khoảng cách thông thoáng $\ge 15\text{cm}$ liên tiếp 3 lần đo (`cleared == 3`) thì hàm mới trả về hành động `LOWER`. Nếu xe vẫn đang đậu dưới thanh chắn, khoảng cách đo được vẫn $< 15\text{cm}$, `cleared` bị gán về 0 và barrier sẽ kiên quyết giữ nguyên vị trí mở $90^\circ$.

### ❓ Câu hỏi 4: "Thuật toán Hysteresis ở cảm biến ô đỗ xe `SlotSensor.h` giải quyết vấn đề gì?"
> **Trả lời:** Dạ thưa thầy, cảm biến siêu âm giá rẻ thường có sai số dao động khoảng $\pm 1\text{cm} - 2\text{cm}$. Nếu ta chỉ đặt một ngưỡng cứng duy nhất (ví dụ $15\text{cm}$), thì khi xe đỗ ở khoảng cách đúng $15\text{cm}$, trạng thái sẽ bị nhảy liên tục giữa CÓ XE và TRỐNG (hiện tượng chập chờn). Tụi em dùng 2 ngưỡng lệch nhau: $< 15\text{cm}$ mới nhận là `OCCUPIED`, và phải lùi ra $\ge 18\text{cm}$ mới nhận là `AVAILABLE`. Khoảng lệch $3\text{cm}$ này chính là dải trễ (deadband) giúp triệt tiêu hoàn toàn nhiễu.

### ❓ Câu hỏi 5: "Làm thế nào Arduino Uno và ESP8266 truyền dữ liệu được với nhau?"
> **Trả lời:** Dạ thưa thầy, hai vi điều khiển giao tiếp qua giao thức nối tiếp **UART/Serial**:
> - Uno R3 dùng thư viện `SoftwareSerial` trên chân D2/D3 giao tiếp với cổng Serial phần cứng của ESP8266 ở tốc độ Baud 9600.
> - Uno gửi chuỗi định dạng: `STATUS:<slot>,<dist>,<gate>,<temp>,<ldr>,...` mỗi 500ms.
> - ESP8266 gửi chuỗi lệnh: `OPEN:<requestId>` hoặc `CLOSE` sang Uno khi nhận được HTTP Request từ Web/Camera.
