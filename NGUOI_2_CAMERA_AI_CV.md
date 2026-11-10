# 📘 HƯỚNG DẪN THUYẾT TRÌNH & VẤN ĐÁP: NGƯỜI 2 - CAMERA TRÍ TUỆ NHÂN TẠO & COMPUTER VISION

> **Vai trò trong nhóm:** Phụ trách Tầng 2 (Computer Vision & Edge AI) — Lập trình nhận diện biển số xe (YOLO + OCR), xử lý luồng Video đa nền tảng (Windows/Linux), cơ chế tự động vào/ra `PARKING_DIRECTION=AUTO`, và điều phối liên kết giữa Backend và Barrier.

---

## 🎯 1. TỔNG QUAN PHẦN BẠN PHỤ TRÁCH
Bạn chịu trách nhiệm về toàn bộ phần mềm nhận diện hình ảnh và điều phối cổng:
1. **Trừu tượng hóa phần cứng Camera (`camera_io.py`):** Xử lý capture khung hình mượt mà, hỗ trợ DirectShow (`cv2.CAP_DSHOW`) trên Windows và V4L2 trên Linux, tự động phục hồi kết nối khi camera bị chập chờn.
2. **Nhận diện biển số xe bằng AI (`main.py`):** Sử dụng mô hình Deep Learning YOLO (`best.pt`) định vị vùng biển số xe và trích xuất ký tự (OCR).
3. **Cơ chế điều phối thông minh `AUTO`:** Camera không cần cố định là "Cổng vào" hay "Cổng ra". Hệ thống tự động gửi yêu cầu lên Backend để phân biệt xe vào hay xe ra dựa trên trạng thái thực tế của xe trong bãi.
4. **Cầu nối 2 phía (`gate_link.py` & `web_link.py`):** Gửi biển số lên Backend để kiểm tra quyền truy cập (kèm API Key bảo mật); khi Backend duyệt, lập tức phát lệnh HTTP sang ESP8266 để mở barrier.

---

## 📂 2. CÁC FILE CODE VÀ ĐOẠN CODE TRỌNG TÂM CẦN MỞ SHOW CHO THẦY

### FILE 1: `Project/Camera/camera_io.py`
* **Ý nghĩa:** Module bọc lớp giao tiếp Camera giải quyết triệt để lỗi không mở được Camera trên hệ điều hành Windows.
* **Đoạn code cốt lõi cần chỉ cho thầy:**
  * **Hàm khởi tạo `__init__` và mở Camera đa nền tảng:**
    ```python
    if isinstance(source, int) and platform.system() == "Windows":
        cap = cv2.VideoCapture(source, cv2.CAP_DSHOW)
    else:
        cap = cv2.VideoCapture(source)
    ```
  * **Giải thích logic:** Trên Windows, OpenCV mặc định dùng backend MSMF (Microsoft Media Foundation) rất hay bị treo luồng hoặc xung đột camera index. Việc ép dùng `cv2.CAP_DSHOW` (DirectShow) giúp webcam mở tức thì, hỗ trợ mượt mà cả Webcam tích hợp trên Laptop lẫn Camera gắn ngoài qua cổng USB.
  * **Hàm `read()` có cơ chế timeout:** Đảm bảo vòng lặp không bao giờ bị đứng hình nếu camera đột ngột bị rút dây.

---

### FILE 2: `Project/Camera/main.py`
* **Ý nghĩa:** File thực thi chính của ứng dụng nhận diện AI.
* **Đoạn code cốt lõi cần chỉ cho thầy:**
  * **Hàm `verify_experiment()`:** Kiểm tra kết nối với Backend Server trước khi bật Camera. Nếu Backend chưa bật hoặc sai port, chương trình sẽ in thông báo hướng dẫn rõ ràng chứ không bị crash ngầm.
  * **Vòng lặp nhận diện AI (Hàm `run_camera`):**
    * Đọc từng frame từ `CameraSource`.
    * Đưa qua mô hình nhận diện biển số (`best.pt`).
    * Trích xuất chuỗi ký tự biển số (ví dụ: `36H-123.45`).
  * **Cơ chế chống spam nhận diện (Debounce / Cooldown):**
    * Khi một xe đang đứng trước camera, camera sẽ nhận diện được biển số đó 30 lần mỗi giây.
    * Code có biến `last_seen_plate` và `cooldown_timer`: Trong vòng $3 - 5$ giây chỉ gửi đúng 1 request lên server cho cùng một biển số, tránh làm nghẽn mạng và spam database.
  * **Xử lý kết quả trả về từ Backend:**
    ```python
    outcome = web_link.record_reading(plate, direction="AUTO")
    if outcome in ("ENTRY_PENDING", "EXIT_PENDING", "APPROVED"):
        request_id = str(uuid.uuid4())
        gate_link.request_open(request_id)
    ```

---

### FILE 3: `Project/Camera/web_link.py`
* **Ý nghĩa:** Module chịu trách nhiệm kết nối an toàn với Backend Spring Boot.
* **Đoạn code cốt lõi cần chỉ cho thầy:**
  * **Hàm `record_reading(...)`:**
    * Chuẩn bị payload:
      ```python
      payload = {
          "eventId": str(uuid.uuid4()),
          "plateText": plate_text,
          "direction": "AUTO",
          "observedAt": datetime.utcnow().isoformat() + "Z"
      }
      ```
    * Đính kèm Header xác thực:
      ```python
      headers = {
          "Content-Type": "application/json",
          "X-Device-Key": os.getenv("DEVICE_API_KEY")
      }
      ```
    * Gửi HTTP POST tới: `http://<IP_BACKEND>:18080/api/device/plate-readings`.
    * Trích xuất kết quả `outcome` từ JSON phản hồi: `ENTRY_PENDING`, `EXIT_PENDING`, `NOT_REGISTERED`, hoặc `ACCESS_LOCKED`.

---

### FILE 4: `Project/Camera/gate_link.py`
* **Ý nghĩa:** Module phát lệnh mở barrier trực tiếp tới vi điều khiển ESP8266.
* **Đoạn code cốt lõi cần chỉ cho thầy:**
  * **Hàm `request_open(gate_url, request_id)`:**
    * Sinh mã `request_id` dạng UUID chuẩn (ví dụ `b1a3ffb7-8774-3c40-ba13-9c5f7b72530a`).
    * Gửi HTTP POST sang: `http://192.168.4.1/open?requestId=<UUID>`.
    * Thiết lập `timeout = 2.0s` và cơ chế retry để đảm bảo phản hồi tức thì dưới 100ms.

---

## 🎤 3. KỊCH BẢN THUYẾT TRÌNH MẪU (BẠN NÓI KHOẢNG 2 - 3 PHÚT)

> *"Kính thưa thầy/cô, tiếp nối phần cứng của bạn [Tên Người 1], em xin phép trình bày về **Tầng 2: Computer Vision & Edge AI** của hệ thống Smart Parking.*
>
> *Phần này của tụi em đảm nhận 3 nhiệm vụ sống còn:*
> 1. ***Thu nhận và tối ưu hóa luồng Video (`camera_io.py`):*** *Tụi em xây dựng một lớp trừu tượng hóa camera có khả năng chạy mượt mà trên cả Windows lẫn Linux. Đặc biệt trên Windows, hệ thống tự động kích hoạt backend DirectShow (`cv2.CAP_DSHOW`) để triệt tiêu độ trễ và hỗ trợ chuyển đổi linh hoạt giữa Webcam laptop (`--source 0`) và Camera ngoài USB (`--source 1`).*
> 2. ***Nhận diện biển số thông minh (`main.py`):*** *Hình ảnh từ camera được đưa vào mô hình Deep Learning YOLO đã được train chuyên biệt cho biển số xe Việt Nam (`best.pt`) để crop vùng biển số và trích xuất ký tự. Hệ thống tích hợp thuật toán lọc nhiễu OCR và cơ chế Cooldown chống spam request liên tục khi xe dừng chờ.*
> 3. ***Cơ chế tự động hai chiều `PARKING_DIRECTION=AUTO`:*** *Camera không bị gán cứng là cổng vào hay cổng ra. Khi quét được biển số, chương trình gửi kèm cờ `AUTO` sang Backend. Backend sẽ tự động đối chiếu xem xe đang ở ngoài bãi hay trong bãi để trả về quyết định `ENTRY_PENDING` hay `EXIT_PENDING`. Ngay khi Backend phê duyệt, module `gate_link.py` sẽ lập tức bắn lệnh HTTP sang ESP8266 kèm theo mã định danh `requestId` duy nhất để mở barrier trong thời gian chưa đầy 0.1 giây.*
>
> *Sau đây, em xin kính mời bạn [Tên Người 3] trình bày về Tầng Backend và Cơ sở dữ liệu của hệ thống."*

---

## ❓ 4. CÁC CÂU HỎI VẤN ĐÁP THẦY SẼ HỎI BẠN & CÁCH TRẢ LỜI ĐẠT ĐIỂM TỐI ĐA

### ❓ Câu hỏi 1: "Mô hình nhận diện biển số của em hoạt động như thế nào? Dùng model gì?"
> **Trả lời:** Dạ thưa thầy, quy trình xử lý hình ảnh của tụi em gồm 2 bước:
> 1. **Plate Detection:** Sử dụng mô hình YOLO (`best.pt`) để phát hiện tọa độ bounding box của biển số xe trên khung hình.
> 2. **Character Recognition (OCR):** Vùng biển số sau khi được crop sẽ được tiền xử lý (chuyển ảnh xám, cân bằng sáng Grayscale/Threshold) và đưa qua module OCR để nhận dạng các ký tự chữ và số.
> 3. Chuỗi ký tự sau đó được hàm chuẩn hóa đưa về dạng viết hoa liền khối (ví dụ `36H12345`) trước khi gửi lên server.

### ❓ Câu hỏi 2: "Tại sao camera quét được biển số hợp lệ rồi mà không tự mở barrier luôn, lại phải gửi qua Backend rồi mới mở?"
> **Trả lời:** Dạ thưa thầy, đây là nguyên lý kiến trúc an ninh rất quan trọng:
> - Camera chỉ đóng vai trò là **Edge Sensor (Cảm biến đầu cuối)** thu thập dữ liệu hình ảnh. Camera không có quyền tự ý ra quyết định mở cổng.
> - **Backend** mới là nơi nắm giữ toàn bộ trạng thái hệ thống: Danh sách xe đã đăng ký, xe có đang bị "Tạm khoá" hay không, bãi xe còn chỗ trống hay đã đầy (`Capacity`), và xe đang ở trạng thái nào.
> - Việc camera bắt buộc phải hỏi Backend trước giúp đảm bảo an toàn tuyệt đối: nếu biển số xe chưa đăng ký hoặc đang bị bảo vệ Tạm khoá trên web thì barrier dứt khoát không mở.

### ❓ Câu hỏi 3: "Khi xe đứng chờ trước camera trong 5 giây, camera bắt được hàng chục frame có cùng biển số thì có bị gửi hàng chục lệnh mở barrier không?"
> **Trả lời:** Dạ không thưa thầy! Tụi em đã cài đặt thuật toán **Stateful Cooldown & Debounce** trong `main.py`:
> - Hệ thống lưu lại biển số vừa nhận diện và mốc thời gian `last_seen_at`.
> - Trong một khoảng thời gian nhất định (ví dụ 3 giây), nếu camera tiếp tục nhận diện được cùng một biển số đó thì hệ thống sẽ bỏ qua, không gửi request trùng lặp lên backend và không gửi lệnh mở cổng nhiều lần.

### ❓ Câu hỏi 4: "Tại sao trong lệnh mở cổng gửi sang ESP8266 lại cần `requestId` dạng UUID?"
> **Trả lời:** Dạ thưa thầy, `requestId` là một chuỗi UUID 36 ký tự duy nhất cho mỗi lượt mở cổng (ví dụ `b1a3ffb7-8774-3c40-ba13-9c5f7b72530a`). Mã này phục vụ 2 mục đích:
> 1. **Idempotency (Tính bất biến):** Nếu do mạng chập chờn mà script Python gửi lệnh 2 lần, ESP8266 và Uno kiểm tra thấy trùng `requestId` thì sẽ không kích hoạt lại chu kỳ mới.
> 2. **Audit Trail (Truy vết chu kỳ):** `requestId` này được Uno ghi vào telemetry phản hồi sang Backend, giúp Backend ghép chính xác lượt mở barrier với đúng lượt xe đi qua trong cơ sở dữ liệu.

### ❓ Câu hỏi 5: "Làm sao bảo mật luồng gửi từ Camera lên Backend không bị hacker bắt trộm hoặc làm giả biển số?"
> **Trả lời:** Dạ thưa thầy, trong file `web_link.py`, mỗi request gửi lên Backend đều đính kèm một mã khóa bí mật trong Header HTTP: `X-Device-Key: <SECRET_KEY>`. Backend sử dụng bộ lọc `DeviceKeyFilter.java` để kiểm tra key này. Nếu kẻ gian cố tình dùng Postman hoặc curl gửi biển số giả mạo lên backend mà không có key này thì server sẽ từ chối ngay lập tức với mã lỗi `401 Unauthorized`.
