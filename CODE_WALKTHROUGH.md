# 🚗 TÀI LIỆU TOÀN DIỆN: GIẢI THÍCH CHI TIẾT TOÀN BỘ CODEBASE HỆ THỐNG SMART PARKING

Tài liệu này được biên soạn dành cho buổi báo cáo và vấn đáp trực tiếp với Giảng viên / Hội đồng chấm điểm. Tài liệu chỉ rõ **tất cả các file chứa chức năng**, **vị trí mã nguồn**, **luồng dữ liệu kết nối giữa các tầng** và **các câu hỏi vấn đáp chuyên sâu thường gặp**.

---

## 🏗️ 1. TỔNG QUAN KIẾN TRÚC HỆ THỐNG (SYSTEM ARCHITECTURE)

Hệ thống được thiết kế theo mô hình **IoT 4 Tầng chuẩn công nghiệp** (Edge Hardware → Computer Vision AI → Backend Service & Database → Frontend Dashboard):

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           TẦNG 1: PHẦN CỨNG VI ĐIỀU KHIỂN                      │
│                                                                                 │
│   [Cảm biến Siêu âm Slot 1] ──┐                                                 │
│   [Cảm biến Siêu âm Barrier] ──┼──> [Arduino Uno R3] (Logic điều khiển, FSM)     │
│   [Cảm biến Nhiệt độ LM35] ────┤             │ (SoftwareSerial 9600)             │
│   [Cảm biến Ánh sáng LDR] ────┘             ▼                                   │
│   [Servo SG90 + Còi + LED] <─────── [ESP8266 Wi-Fi Gateway] (AP: 192.168.4.1)   │
└──────────────────────────────────────────────┬──────────────────────────────────┘
                                               │ Wi-Fi AP HTTP API (/open, /status)
                                               ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      TẦNG 2: COMPUTER VISION & AI (PYTHON)                      │
│                                                                                 │
│   [Webcam / Camera] ──> [camera_io.py] (DirectShow / V4L2)                      │
│                                 │                                               │
│                                 ▼                                               │
│                         [main.py] (AI YOLO / OCR nhận diện biển số)              │
│                                 │                                               │
│         ┌───────────────────────┴───────────────────────┐                       │
│         ▼                                               ▼                       │
│  [gate_link.py]                                  [web_link.py]                  │
│  (HTTP POST sang ESP8266 /open)                  (HTTP POST sang Backend)       │
└─────────────────────────────────────────────────────────┬───────────────────────┘
                                                          │ HTTP REST (Port 18080)
                                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                   TẦNG 3: BACKEND SERVER & DATABASE (JAVA / SQL)                │
│                                                                                 │
│   [Security: DeviceKeyFilter] (Kiểm tra API Key bảo mật X-Device-Key)           │
│                                 │                                               │
│   [Controllers]: CameraController, AccessController, TemperatureController      │
│                                 │                                               │
│   [Core Service]: ParkingService.java (Xử lý toàn bộ nghiệp vụ bãi xe)          │
│                                 │                                               │
│   [Data Layer]: AccessStore, TemperatureStore ──> [PostgreSQL 16] (Flyway V1-V8)│
│                                 │                                               │
│   [Realtime]: ParkingBroadcast.java ──> WebSocket STOMP (/topic/parking/updates)│
└─────────────────────────────────────────────────────────┬───────────────────────┘
                                                          │ WebSocket & REST
                                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      TẦNG 4: FRONTEND DASHBOARD (REACT + VITE)                  │
│                                                                                 │
│   [App.jsx] ──> Quản lý bố cục giao diện thời gian thực                         │
│     ├── [CameraPlatePanel.jsx]: Quản lý đăng ký, tạm khoá, xoá biển số xe       │
│     ├── [VehicleAccessPanel.jsx]: Theo dõi trạng thái barrier, Inside, Exited    │
│     ├── [ParkingMap.jsx]: Mô phỏng 4 ô đỗ xe trực quan (xanh/đỏ)                │
│     └── [FireAlarmPanel.jsx]: Giám sát nhiệt độ LM35 và còi báo cháy            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 💻 2. CHI TIẾT TỪNG FILE CODE THEO CHỨC NĂNG

### PHẦN I: PHẦN CỨNG VI ĐIỀU KHIỂN (C / C++ / ARDUINO)
Thư mục: `Project/`

| STT | File Code | Đường dẫn | Chức năng chi tiết & Dòng code quan trọng |
| :---: | :--- | :--- | :--- |
| 1 | **SmartParking_Uno.ino** | `Project/SmartParking_Uno/SmartParking_Uno.ino` | **Chương trình điều khiển trung tâm Uno R3:**<br>• Đọc 2 cảm biến siêu âm (chân Trig/Echo đo khoảng cách xe trước barrier và ô đỗ P01).<br>• Đọc cảm biến nhiệt độ LM35; nếu $\ge 45^\circ\text{C}$ kích hoạt còi Buzzer và LED báo động.<br>• Đọc cảm biến LDR với hysteresis (ngưỡng trễ) để bật/tắt đèn LED chiếu sáng tự động.<br>• Điều khiển Servo SG90 quay $90^\circ$ (mở) và $0^\circ$ (đóng), ngắt xung (`detach()`) để chống rung/cháy servo.<br>• Giao tiếp SoftwareSerial (`espSerial`) gửi chuỗi trạng thái telemetry sang ESP8266 mỗi 500ms. |
| 2 | **GateCycle.h** | `Project/SmartParking_Uno/GateCycle.h` | **Máy trạng thái hữu hạn (FSM) cho chu trình Barrier:**<br>• Quản lý 6 pha an toàn: `IDLE` (chờ) → `WAITING` (đã nhận lệnh mở, chờ xe đến) → `APPROACHING` (xe đã tới trước cổng) → `PASSING` (xe đang đi qua) → `CLEARING` (xe đã qua hẳn) → `RECOVERY` (đóng barrier an toàn).<br>• Ngăn ngừa va chạm: Barrier không bao giờ tự ý hạ xuống nếu cảm biến phát hiện xe vẫn đang nằm dưới thanh chắn. |
| 3 | **SlotSensor.h** | `Project/SmartParking_Uno/SlotSensor.h` | **Bộ lọc nhiễu cảm biến ô đỗ xe:**<br>• Lọc nhiễu độ trễ (debouncing): chỉ chuyển trạng thái giữa `EMPTY` và `OCCUPIED` khi giá trị khoảng cách ổn định liên tục qua nhiều mẫu đo, chống hiện tượng chập chờn khi có bóng người đi ngang. |
| 4 | **SmartParking_ESP8266.ino** | `Project/SmartParking_ESP8266/SmartParking_ESP8266.ino` | **Trạm Wi-Fi Gateway & Máy chủ HTTP:**<br>• Phát Access Point Wi-Fi nội bộ: `SMART_PARKING_ESP32` (IP `192.168.4.1`).<br>• Khởi tạo WebServer cổng 80 tiếp nhận các endpoint:<br>  - `POST /open`: Nhận lệnh mở cổng từ Camera/Web, kèm `requestId` để định danh lượt mở.<br>  - `POST /close`: Lệnh đóng cổng khẩn cấp.<br>  - `GET /status`: Xuất JSON trạng thái toàn bãi xe theo **Protocol Version 3** (12 trường dữ liệu gồm trạng thái barrier, nhiệt độ, ánh sáng, ô đỗ, độ tuổi dữ liệu `sampleAgeMs`).<br>• Chuyển tiếp 2 chiều giữa HTTP Web và cổng nối tiếp Serial với Uno R3. |

---

### PHẦN II: CAMERA TRÍ TUỆ NHÂN TẠO & NHẬN DIỆN BIỂN SỐ (PYTHON)
Thư mục: `Project/Camera/`

| STT | File Code | Đường dẫn | Chức năng chi tiết & Dòng code quan trọng |
| :---: | :--- | :--- | :--- |
| 5 | **main.py** | `Project/Camera/main.py` | **Luồng điều phối Camera chính:**<br>• Tải model AI (`best.pt` YOLO) nhận diện vùng biển số.<br>• Vòng lặp đọc frame hình ảnh từ camera, tiền xử lý và cắt vùng ký tự (OCR).<br>• Chạy cơ chế tự động **`PARKING_DIRECTION=AUTO`**: Tự động phát hiện xe vào hay xe ra dựa trên trạng thái xe trong cơ sở dữ liệu.<br>• Khi nhận diện biển hợp lệ: Gọi `web_link.send_reading()` gửi lên Backend; nếu Backend trả về cho phép (APPROVED), lập tức gọi `gate_link.open_gate()` để mở barrier. |
| 6 | **camera_io.py** | `Project/Camera/camera_io.py` | **Trừu tượng hóa phần cứng Camera (Hardware I/O):**<br>• Tự động nhận diện hệ điều hành: Trên Windows sử dụng DirectShow (`cv2.CAP_DSHOW`), trên Linux sử dụng V4L2.<br>• Hỗ trợ chuyển đổi nguồn linh hoạt giữa Webcam laptop (`--source 0`), Camera cắm ngoài USB (`--source 1`), hoặc luồng RTSP.<br>• Xử lý timeout và cơ chế reconnect chống treo luồng hình ảnh. |
| 7 | **gate_link.py** | `Project/Camera/gate_link.py` | **Kết nối phần cứng Barrier:**<br>• Gửi HTTP POST tới `http://192.168.4.1/open` với payload `requestId` dạng UUID chuẩn.<br>• Xử lý timeout ngắn (1.5s - 2.5s) và cơ chế thử lại (retry) để đảm bảo barrier phản hồi ngay lập tức khi xe đến. |
| 8 | **web_link.py** | `Project/Camera/web_link.py` | **Kết nối Backend Server:**<br>• Đóng gói payload biển số, mã camera (`project-camera`), thời gian quét (`observedAt`), hướng di chuyển (`AUTO`, `ENTRY`, `EXIT`).<br>• Đính kèm header bảo mật `X-Device-Key` để xác thực với backend.<br>• Gửi tới endpoint `/api/device/plate-readings` và nhận về phản hồi (`outcome`: `ENTRY_PENDING`, `EXIT_PENDING`, `NOT_REGISTERED`, `ACCESS_LOCKED`). |

---

### PHẦN III: BACKEND SERVER & DATABASE (JAVA SPRING BOOT + POSTGRESQL)
Thư mục: `backend/src/main/java/com/smartparking/` (chia thành các package: `controller`, `service`, `store`, `model`, `config`)

| STT | File Code | Đường dẫn | Chức năng chi tiết & Dòng code quan trọng |
| :---: | :--- | :--- | :--- |
| 9 | **ParkingService.java** | `backend/.../service/ParkingService.java` | **"Bộ não" xử lý toàn bộ nghiệp vụ (Core Domain Logic):**<br>• `cameraReading(...)`: Nhận biển số từ camera. Chuẩn hóa biển số (viết hoa, bỏ dấu cách, gạch nối).<br>• Kiểm tra trong bảng `registered_plate`: Biển số chưa đăng ký → từ chối (`NOT_REGISTERED`); biển bị tạm khoá (`enabled=false`) → từ chối (`ACCESS_LOCKED`).<br>• Xử lý luồng tự động `AUTO`: Nếu xe chưa có trong bãi → khởi tạo lượt vào (`PENDING_ENTRY`); nếu xe đang ở trong bãi → khởi tạo lượt ra (`PENDING_EXIT`).<br>• Xử lý xác nhận ô đỗ (`slotConfirmed`): Xe qua cổng vào chỉ tính là `PENDING_PARKING`. Khi cảm biến P01 báo có xe đỗ, hệ thống mới chính thức chuyển trạng thái thành `INSIDE`. Khi xe rời ô và qua cổng ra, chuyển thành `EXITED`.<br>• `registerPlate(...)`: Đăng ký mới hoặc bật/tắt (khoá/mở khoá) biển số.<br>• `deletePlate(...)`: Xoá vĩnh viễn biển số khỏi database. |
| 10 | **AccessStore.java** | `backend/.../store/AccessStore.java` | **Tầng tương tác Cơ sở dữ liệu (Persistence Layer):**<br>• Sử dụng `JdbcTemplate` thực thi các truy vấn SQL trực tiếp tối ưu hiệu năng.<br>• Quản lý các bảng: `vehicle_visit` (lưu lượt xe), `access_event` (lịch sử quét), `registered_plate` (danh sách biển số được cấp phép), `barrier_state` (trạng thái thanh chắn). |
| 11 | **CameraController.java** | `backend/.../controller/CameraController.java` | **REST API phục vụ Camera & Quản lý biển số Web:**<br>• `POST /api/device/plate-readings`: Camera gửi biển số lên (yêu cầu API Key).<br>• `GET /api/camera/latest`: Web lấy thông tin xe vừa quét gần nhất.<br>• `GET /api/camera/registered-plates`: Web lấy danh sách xe đã đăng ký.<br>• `POST /api/camera/registered-plates`: Web gửi yêu cầu thêm xe mới hoặc bật/tắt tạm khoá.<br>• `DELETE /api/camera/registered-plates/{plate}`: Web gửi yêu cầu xoá vĩnh viễn biển số. |
| 12 | **AccessController.java** | `backend/.../controller/AccessController.java` | **REST API giám sát xe & barrier:**<br>• `GET /api/access/status`: Trả về toàn bộ trạng thái lượt xe hiện tại (`visits`), các sự kiện gần đây (`events`), trạng thái barrier (`barrier`), số lượng xe trong bãi (`stats`: `inside`, `pendingEntry`, `pendingParking`, `exited`, `capacity`).<br>• `POST /api/device/barrier-feedback`: Nhận phản hồi trạng thái thật từ vi điều khiển. |
| 13 | **DeviceKeyFilter.java** | `backend/.../config/DeviceKeyFilter.java` | **Bộ lọc an ninh (Security Interceptor):**<br>• Chặn toàn bộ các request gửi vào `/api/device/*`. Bắt buộc phải có header `X-Device-Key` trùng khớp với `DEVICE_API_KEY` trong file cấu hình. Trả về `401 Unauthorized` nếu sai hoặc thiếu key. |
| 14 | **ParkingBroadcast.java** & **RealtimeConfig.java** | `backend/.../service/` & `.../config/` | **Hạ tầng truyền thông Thời gian thực (WebSocket STOMP):**<br>• `RealtimeConfig.java`: Mở endpoint WebSocket `/ws` hỗ trợ SockJS.<br>• `ParkingBroadcast.java`: Bất cứ khi nào có xe vào, xe ra, đổi trạng thái ô đỗ hoặc nhiệt độ thay đổi, server tự động đẩy (push) gói tin JSON tới topic `/topic/parking/updates` để tất cả trình duyệt đang mở cập nhật giao diện ngay lập tức mà không cần F5. |
| 15 | **HttpConfig.java** | `backend/.../config/HttpConfig.java` | **Cấu hình CORS & Giao thức HTTP:**<br>• Cấu hình các phương thức được phép: `GET`, `POST`, `PUT`, `DELETE`, `OPTIONS`.<br>• Cấu hình danh sách nguồn hợp lệ (`allowed-origins`: `http://localhost:5173`, `http://localhost:5175`). |
| 16 | **Database Migrations (Flyway)** | `backend/src/main/resources/db/migration/` | **Quản lý phiên bản Cơ sở dữ liệu:**<br>• `V1` -> `V6`: Thiết lập cấu trúc bãi đỗ xe, bảng biển số, bảng nhật ký sự kiện.<br>• `V7__experimental_slot_confirmed_access.sql`: Mở rộng enum hỗ trợ `PENDING_PARKING`, trường `gate_entered_at` và liên kết với cảm biến ô đỗ.<br>• `V8__slot_clear_confirmation.sql`: Thêm trường `slot_left_at` ghi nhận thời điểm xe rời ô đỗ. |

---

### PHẦN IV: FRONTEND WEB DASHBOARD (REACT + VITE)
Thư mục: `src/`

| STT | File Code | Đường dẫn | Chức năng chi tiết & Dòng code quan trọng |
| :---: | :--- | :--- | :--- |
| 17 | **CameraPlatePanel.jsx** | `src/components/CameraPlatePanel.jsx` | **Giao diện Camera & Quản lý Biển số Xe:**<br>• Hiển thị biển số quét gần nhất kèm nhãn kết quả (Hợp lệ, Tạm khoá, Chưa đăng ký).<br>• Form thêm biển số mới (`handleRegister`), tự động chuẩn hóa biển số.<br>• Danh sách thẻ biển số đã đăng ký: Hiển thị trạng thái "Hoạt động" hoặc "Tạm khoá".<br>• Nút **Tạm khoá / Mở khoá** (`handleToggle`): Đổi cờ `enabled` ngay tức thì.<br>• Nút **Xoá biển số** (`handleDelete`): Có hộp thoại xác nhận (confirm dialog), gọi phương thức `DELETE` xóa khỏi cơ sở dữ liệu. |
| 18 | **VehicleAccessPanel.jsx** | `src/components/VehicleAccessPanel.jsx` | **Giao diện Giám sát Cổng & Lượt xe:**<br>• Hiển thị thanh chắn Barrier ảo (màu xanh khi OPEN, màu xám khi CLOSED).<br>• Bảng thống kê các chỉ số: Số xe trong bãi (`Inside`), Xe đang chờ đỗ (`Pending Parking`), Xe đã ra (`Exited`), Sức chứa bãi (`Capacity`).<br>• Bảng lịch sử các lần di chuyển gần nhất của phương tiện. |
| 19 | **ParkingMap.jsx** | `src/components/ParkingMap.jsx` | **Sơ đồ Ô đỗ xe Trực quan:**<br>• Hiển thị 4 ô đỗ (Slot P01 - P04).<br>• Ô P01 tự động đổi sang màu đỏ kèm biểu tượng xe đỗ khi cảm biến siêu âm phát hiện có vật cản, và chuyển màu xanh khi ô đỗ trống. |
| 20 | **FireAlarmPanel.jsx** | `src/components/FireAlarmPanel.jsx` | **Bảng Cảnh báo Cháy & Nhiệt độ LM35:**<br>• Hiển thị nhiệt độ thời gian thực dạng số và biểu đồ đo.<br>• Khi nhiệt độ $\ge 45^\circ\text{C}$, màn hình nhấp nháy cảnh báo khẩn cấp màu đỏ và tự động kích hoạt còi báo động qua hook `useAlarmSound.js`. |
| 21 | **vehicleAccess.js** | `src/services/vehicleAccess.js` | **Tầng xử lý dữ liệu Frontend (Service Layer):**<br>• Hàm `formatPlateDisplay(...)`: Định dạng hiển thị biển số xe chuẩn Việt Nam (ví dụ biến `36H12345` thành `36H-123.45`).<br>• Hàm `outcomeLabel(...)`: Dịch các mã kết quả từ backend thành tiếng Việt thân thiện (`Xe hợp lệ`, `Biển số chưa đăng ký`, `Xe đang bị tạm khoá`). |
| 22 | **useDeviceParking.js** | `src/hooks/useDeviceParking.js` | **Custom React Hook kết nối Realtime:**<br>• Mở kết nối WebSocket STOMP tới backend `/ws`.<br>• Lắng nghe các cập nhật từ `/topic/parking/updates`. Khi có gói tin mới, hook tự động cập nhật State của React mà không cần tải lại trang. |

---

## 🔄 3. LUỒNG HOẠT ĐỘNG THỰC TẾ CỦA MỘT CHU KỲ XE (END-TO-END FLOW)

### Giai đoạn 1: Xe vào bãi (Check-in)
1. **Quét biển số:** Xe tiến đến trước cổng → Camera chụp hình → `main.py` nhận diện ra biển `36H-123.45`.
2. **Kiểm tra đăng ký:** `web_link.py` gửi biển số sang Backend `POST /api/device/plate-readings`.
3. **Phê duyệt:** `ParkingService.java` kiểm tra thấy biển số đã đăng ký và đang ở trạng thái `enabled=true`. Backend tạo lượt xe mới với trạng thái `PENDING_ENTRY` và trả về kết quả `outcome: ENTRY_PENDING`.
4. **Mở Barrier:** Camera nhận kết quả duyệt → `gate_link.py` gọi sang ESP8266 `POST /open?requestId=...` → ESP8266 gửi lệnh Serial sang Uno R3 → Uno quay Servo mở barrier lên $90^\circ$.
5. **Xe đi qua cổng:** Cảm biến khoảng cách trước barrier phát hiện xe đi qua (`PASSING` → `CLEARING`) → Uno tự động hạ Servo đóng barrier xuống $0^\circ$. Lượt xe chuyển thành `PENDING_PARKING` (chờ vào ô).
6. **Xe vào ô đỗ:** Xe tiến vào ô đỗ P01. Cảm biến siêu âm P01 đo khoảng cách $< 10\text{cm}$ → Uno gửi dữ liệu sang ESP8266 → ESP8266 gửi telemetry về Backend. Backend cập nhật trạng thái xe thành **`INSIDE`** và phát WebSocket đẩy lên Web làm ô P01 đổi sang màu đỏ.

### Giai đoạn 2: Xe rời bãi (Check-out)
1. **Rời ô đỗ:** Xe lùi ra khỏi ô P01 → Cảm biến P01 thông thoáng → Web ghi nhận ô đỗ trống (màu xanh), nhưng trạng thái xe vẫn là `INSIDE` (vì xe vẫn còn trong khuôn viên bãi).
2. **Quét biển số ra:** Xe tiến đến cổng ra → Camera chụp biển số `36H-123.45` gửi lên Backend.
3. **Tự động nhận diện (AUTO):** Backend nhận thấy xe này đã có trạng thái `INSIDE` trong bãi → Tự động xác định đây là lượt **`EXIT`** → Cấp phép mở barrier cho xe ra.
4. **Mở Barrier ra:** Cổng mở ra cho xe qua → Xe qua hẳn cổng → Barrier đóng lại → Backend ghi nhận trạng thái cuối cùng là **`EXITED`** (Hoàn tất chu kỳ).

---

## 🎯 4. BỘ CÂU HỎI VẤN ĐÁP THẦY CÔ THƯỜNG HỎI & CÁCH TRẢ LỜI

### ❓ Câu 1: "Hệ thống phân biệt giữa xe vào và xe ra như thế nào khi chỉ dùng một camera?"
> **Trả lời:** Dạ thưa thầy, hệ thống sử dụng thuật toán **Stateful Encounter (`AUTO`)** trong file `ParkingService.java`. Khi camera quét được một biển số, hệ thống sẽ truy vấn cơ sở dữ liệu `vehicle_visit` theo biển số đó:
> - Nếu xe **chưa có lượt gửi nào** hoặc lượt gửi trước đã kết thúc (`EXITED`), hệ thống xác định đây là xe **VÀO** (`ENTRY`) và tạo trạng thái `PENDING_ENTRY`.
> - Nếu xe **đang có lượt gửi còn hiệu lực** (`INSIDE` hoặc `PENDING_PARKING`), hệ thống tự động xác định đây là xe **RA** (`EXIT`) và tiến hành thủ tục check-out đóng lượt gửi.

### ❓ Câu 2: "Tại sao qua cổng barrier rồi mà hệ thống chưa tính xe là 'Inside' ngay?"
> **Trả lời:** Dạ thưa thầy, đây là cải tiến quan trọng trong cơ chế **Slot-Confirmed Arrival**. Khi xe vừa qua cổng barrier, xe mới chỉ ở trạng thái `PENDING_PARKING` (đang di chuyển trong hành lang bãi đỗ). Chỉ khi cảm biến siêu âm tại ô đỗ (Slot P01) phát hiện có xe đỗ vào ổn định, hệ thống mới chính thức xác nhận xe là `INSIDE`. Điều này giúp phát hiện các trường hợp xe qua cổng nhưng không đỗ hoặc quay đầu ra ngoài.

### ❓ Câu 3: "Chức năng Tạm khoá biển số khác gì với Xoá hẳn khỏi cơ sở dữ liệu?"
> **Trả lời:** Dạ thưa thầy:
> - **Tạm khoá (`enabled = false`):** Biển số vẫn được lưu trong cơ sở dữ liệu, lịch sử ra vào của xe không bị mất. Tuy nhiên khi xe này đến cổng, backend sẽ trả về mã `ACCESS_LOCKED` và barrier sẽ kiên quyết **không mở** (áp dụng khi chủ xe chưa đóng phí tháng hoặc xe bị nghi vấn).
> - **Xoá hẳn (`DELETE`):** Bản ghi biển số bị xoá hoàn toàn khỏi bảng `registered_plate`. Lần sau xe này đến, hệ thống sẽ coi như xe lạ chưa từng đăng ký (`NOT_REGISTERED`).

### ❓ Câu 4: "Khi trình duyệt web ở máy khác hoặc điện thoại kết nối vào, làm sao web biết trạng thái thay đổi tức thì mà không cần F5?"
> **Trả lời:** Dạ thưa thầy, hệ thống sử dụng giao thức **WebSocket (STOMP Protocol)** được cấu hình tại `RealtimeConfig.java`. Ở Frontend, hook `useDeviceParking.js` duy trì một kết nối ngầm tới endpoint `/ws` và đăng ký nhận tin từ topic `/topic/parking/updates`. Bất cứ khi nào backend có sự kiện (camera quét xe, barrier đóng mở, nhiệt độ thay đổi), class `ParkingBroadcast.java` sẽ đẩy ngay gói tin JSON xuống tất cả các máy client đang kết nối.

### ❓ Câu 5: "Làm thế nào để bảo mật các API điều khiển thiết bị tránh bị hacker giả mạo gửi lệnh mở cổng?"
> **Trả lời:** Dạ thưa thầy, hệ thống triển khai lớp bảo vệ **`DeviceKeyFilter.java`**. Tất cả các API giao tiếp phần cứng thuộc tiền tố `/api/device/*` đều bắt buộc phải kèm theo header bí mật `X-Device-Key`. Nếu request từ ngoài vào không có key hoặc sai key, bộ lọc Spring Boot sẽ lập tức chặn lại và trả về mã lỗi `401 Unauthorized`.

### ❓ Câu 6: "Tại sao lại chia phần cứng làm 2 vi điều khiển (Arduino Uno và ESP8266) mà không dùng 1 con ESP32?"
> **Trả lời:** Dạ thưa thầy, thiết kế này áp dụng nguyên lý **Phân tách trách nhiệm (Separation of Concerns)**:
> - **Arduino Uno R3:** Đảm nhận việc xử lý thời gian thực cứng (Hard Real-time) với độ trễ micro-giây: đo khoảng cách 2 cảm biến siêu âm, tính toán góc quay servo, còi báo động, đọc analog LM35 và LDR.
> - **ESP8266:** Đóng vai trò là card mạng không dây (Network Interface Card) xử lý chồng giao thức TCP/IP, phát Wi-Fi AP và tiếp nhận các HTTP Request. Việc phân tách này giúp Arduino Uno không bao giờ bị nghẽn (block) vòng quét cảm biến khi mạng Wi-Fi bị trễ.
