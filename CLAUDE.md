# BỐI CẢNH DỰ ÁN VÀ QUY TẮC HOẠT ĐỘNG (DÀNH CHO CLAUDE CODE)

## ⛔ QUY TẮC BẮT BUỘC (CRITICAL DIRECTIVE - ZERO CODE):
1. **CHẾ ĐỘ ZERO CODE (TUYỆT ĐỐI KHÔNG VIẾT CODE):**
   - Bạn chỉ đóng vai trò là chuyên gia tư vấn giải pháp, phân tích nguyên nhân lỗi (Root Cause Analysis), giải thích luồng xử lý (Architecture & Logic Flow), và hướng dẫn chẩn đoán thực tế.
   - **KHÔNG** đưa ra các đoạn code lập trình (Java, Python, C++, JavaScript), không viết code mẫu, không viết file code. Chỉ đưa ra giải pháp dưới dạng mô tả logic, phân tích, thuật toán hoặc các bước thao tác thực tế.
   - Trả lời bằng tiếng Việt, ngắn gọn, súc tích, đi thẳng vào trọng tâm.

---

## 1. TỔNG QUAN HỆ THỐNG SMART PARKING
Dự án là một hệ thống bãi đỗ xe thông minh mô hình để bàn (desktop cardboard model), bao gồm:
- **Backend:** Spring Boot 3.5.16 (Java 17), chạy Docker container `smart-parking-backend-1` tại cổng `18080`.
- **Database:** PostgreSQL 16 tại cổng `55432` (`parking`).
- **Frontend Dashboard:** React 18 + Vite tại cổng `5175` (`http://localhost:5175`).
- **Camera AI:** Python 3.12 (YOLOv8 phát hiện biển số + EasyOCR đọc ký tự). Chạy script `Project/Camera/main.py --source 1`.
- **ESP8266 Wi-Fi Gateway:** Phát Wi-Fi AP `SMART_PARKING_ESP32` (IP `192.168.4.1`), làm trạm trung chuyển HTTP giữa Camera/Laptop và Arduino Uno.
- **Arduino Uno R3:** Vi điều khiển trung tâm kết nối trực tiếp cảm biến và cơ cấu chấp hành qua `Project/SmartParking_Uno`.

---

## 2. PHẦN CỨNG & SƠ ĐỒ CHÂN (ARDUINO UNO R3)
- **Cảm biến ô đỗ xe (Slot 1 - P01):** HC-SR04 (TRIG D5, ECHO D6).
  + Ngưỡng đo: `< 6cm` là có xe (`OCCUPIED`), `>= 8cm` là trống (`AVAILABLE`).
- **Cảm biến cổng trước Barrier:** HC-SR04 (TRIG D7, ECHO D8).
  + Ngưỡng đo: `< 15cm` là phát hiện có xe đứng trước cổng.
- **Cần gạt Barrier:** Servo SG90 (Chân PWM D9).
  + Đóng: 0 độ.
  + Mở: 90 độ.
- **Cảm biến nhiệt độ:** LM35 (Chân Analog A0). Ngưỡng báo cháy `>= 50°C`.
- **Cảm biến ánh sáng & Đèn:** LDR (Analog A1) & LED cổng (Chân D10).
- **Còi cảnh báo:** Buzzer (Chân D4).
- **Giao tiếp ESP8266:** SoftwareSerial trên Uno (RX D2, TX D3, 9600 baud).

---

## 3. MÔ HÌNH MẠNG VÀ PHÂN CHIA THIẾT BỊ
- **Laptop 1 (Linux):** Chạy Backend Spring Boot (18080), PostgreSQL (55432), và Web Dashboard (5175).
- **Laptop 2 (Windows):** Kết nối camera USB, chạy mô hình YOLO/EasyOCR, kết nối mạng Wi-Fi `SMART_PARKING_ESP32` để gửi lệnh sang ESP (`192.168.4.1`) và gửi kết quả nhận diện sang Backend (`http://<IP_Laptop_1>:18080`).

---

## 4. LUỒNG NGHIỆP VỤ CHUẨN (AUTOMATIC ENTRY & EXIT)

### A. Chiều đi vào (ENTRY):
1. Xe đến cổng: Đứng trước cảm biến cổng (khoảng cách `< 15cm`).
2. Camera quét biển số: Gửi biển số lên Web Backend.
3. Backend kiểm tra: Biển số đã đăng ký + Ô đỗ P01 đang trống (`AVAILABLE`).
4. Mở cổng: Barrier mở lên 90 độ, Web báo `ENTRY_PENDING`.
5. Xe đi qua cổng: Khi xe vượt qua khỏi tầm quét cảm biến cổng, barrier tự động hạ xuống đóng lại (0 độ). Web cập nhật `PENDING_PARKING` ("Đã qua cổng · đang tìm ô đỗ").
6. Vào ô đỗ: Xe tiến vào đỗ sát cảm biến P01 (`< 6cm`) $\to$ Web cập nhật `INSIDE` ("Đã vào ô đỗ (P01)").

### B. Chiều đi ra (EXIT):
1. Rời ô đỗ: Xe lùi ra khỏi ô đỗ P01 (`>= 8cm`) $\to$ Cảm biến báo trống, Web cập nhật `PENDING_EXIT` ("Đang rời ô đỗ · chuẩn bị ra cổng").
2. Xe đến cổng: Camera quét biển số $\to$ Web xác nhận đúng biển số đang ở `PENDING_EXIT`.
3. Mở cổng ngay: Barrier lập tức bung mở lên (90 độ) để đón xe ra (không bắt buộc cảm biến cổng phải thấy xe trước, vì cảm biến cổng chĩa ra ngoài đường nên không thấy xe từ phía sau).
4. Thoát cổng: Xe chạy qua cổng, lướt qua cảm biến cổng và đi ra ngoài hẳn $\to$ Barrier tự động đóng lại (0 độ). Web cập nhật `EXITED` ("Đã ra ngoài hoàn tất").

---

## 5. CÁC TÌNH HUỐNG & VẤN ĐỀ ĐÃ GẶP PHẢI (CASE STUDIES):
1. **Ô đỗ P01 luôn báo OCCUPIED dù không có xe:**
   - *Nguyên nhân:* Mô hình hộp giấy mặt bàn gây dội âm ở khoảng cách 14.6cm. Ngưỡng cũ (< 15cm) làm cảm biến luôn báo có xe.
   - *Giải pháp:* Hạ ngưỡng xuống `< 6cm` là có xe, `>= 8cm` là trống.
2. **Xe ra cổng không mở được (Deadlock):**
   - *Nguyên nhân:* Cảm biến cổng chĩa ra ngoài đường, khi xe ở trong bãi tiến ra thì cảm biến không thấy xe, trong khi code Uno cũ lại bắt buộc cảm biến thấy xe mới mở.
   - *Giải pháp:* Tách luồng riêng cho chiều ra: Khi nhận lệnh mở ra, Uno mở servo ngay lập tức. Sau đó xe đi qua cảm biến cổng và ra ngoài thì mới đóng lại.
3. **Kẹt 30 giây ở chiều vào (Waiting 30s):**
   - *Nguyên nhân:* Uno có biến `WEB_REQUEST_TIMEOUT = 30000`. Khi nhận lệnh mở vào, nếu cảm biến cổng không gom đủ 3 lần đo liên tiếp `< 15cm` (do xe đặt lệch, dội âm méo), Uno sẽ đứng chờ 30 giây rồi hủy (`CANCELLED`).
   - *Giải pháp:* Cho phép mở barrier ngay khi Backend đã duyệt và gửi lệnh mở hợp lệ.
4. **Mất kết nối mạng / TimeoutError:**
   - *Nguyên nhân:* Mạng `SMART_PARKING_ESP32` là AP nội bộ không có Internet. Nếu đổi Wi-Fi hoặc lệch IP trong file `.env` của Camera thì các máy không giao tiếp được với nhau.


---

## 6. CHI TIẾT SỰ CỐ ĐANG GẶP PHẢI TRỰC TIẾP (CURRENT LIVE ISSUE)
- **Tình huống xảy ra:**
  + Nhóm đã hoàn thành trọn vẹn lượt test đầu tiên (Lượt 10): Xe vào cổng $\to$ vào ô đỗ P01 $\to$ lùi khỏi ô $\to$ ra cổng tự động mở $\to$ hoàn thành chu kỳ `EXITED`.
  + Tuy nhiên, khi nhóm đưa xe ra trước cổng để **test lại lượt thứ 2 (Lượt 11)**:
    * Camera quét đúng biển số xe `36H-123.45`.
    * Web Backend nhận diện đúng và chuyển trạng thái sang `ENTRY_PENDING` ("Đã duyệt xe vào").
    * Script camera (`gate_link.py`) chuyển lệnh `OPEN` sang ESP32 thành công (`COMMAND_RECEIVED`).
    * **NHƯNG:** Cần servo barrier trên mô hình thực tế **KHÔNG CHỊU MỞ**, và xe đứng trước cổng đúng **30 giây** thì hệ thống tự hủy lệnh.
- **Phân tích kỹ thuật (Root Cause):**
  1. Con số 30 giây chính là biến thời gian chờ `WEB_REQUEST_TIMEOUT = 30000` (30.000 ms) trong code Uno.
  2. Khi nhận lệnh mở `OPEN` từ ESP8266, Uno chuyển sang trạng thái chờ `phase = "WAITING"`.
  3. Để quay servo mở cần (chuyển sang `phase = "OPEN"` và thực hiện `RAISE`), Uno đòi hỏi:
     `valid && detected == 3` (tức là cảm biến siêu âm trước cổng TRIG D7 / ECHO D8 phải đo được liên tục 3 lần khoảng cách `< 15cm`).
  4. Trên mô hình thực tế bằng hộp carton:
     - Khi đặt xe trước cổng ở lượt 2, nếu đầu xe bị lệch khỏi tâm chùm sóng siêu âm, hoặc độ dội âm từ vỏ nhựa/giấy không ổn định, hoặc cảm biến trả về `0` (lỗi không bắt được echo) $\to$ biến đếm `detected` bị reset về 0 liên tục.
     - Uno không gom đủ 3 lần đo liên tiếp `< 15cm`, do đó nó cứ nằm im ở `phase = "WAITING"` chờ xe.
     - Sau đúng 30 giây, điều kiện `now - requestedAt >= 30000` kích hoạt $\to$ Uno tự hủy yêu cầu (`phase = "CANCELLED"`) và coi như lượt mở thất bại!
- **Yêu cầu tư vấn dành cho Claude:**
  - Hãy phân tích các góc độ vật lý, định vị cảm biến trên mô hình bàn, và phương án thiết kế logic điều khiển (Control Logic) để khắc phục triệt để hiện tượng kẹt 30 giây này mà không làm ảnh hưởng đến tính an toàn của bãi đỗ xe.
  - **LƯU Ý:** TUYỆT ĐỐI KHÔNG VIẾT CODE, CHỈ ĐƯA RA GIẢI PHÁP VÀ LẬP LUẬN LOGIC.
