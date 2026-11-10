# 📘 HƯỚNG DẪN THUYẾT TRÌNH & VẤN ĐÁP: NGƯỜI 4 - FRONTEND DASHBOARD & ĐIỀU PHỐI LIVE DEMO

> **Vai trò trong nhóm:** Phụ trách Tầng 4 (Frontend & User Experience) & Tổng chỉ huy Live Demo — Xây dựng giao diện Web Dashboard bằng React + Vite, kết nối Realtime WebSocket STOMP, Quản lý biển số xe (Đăng ký, Tạm khoá, Xoá), Giám sát ô đỗ trực quan, Cảnh báo cháy và Điều hành kịch bản Demo thực tế trước Hội đồng.

---

## 🎯 1. TỔNG QUAN PHẦN BẠN PHỤ TRÁCH
Bạn chịu trách nhiệm về "Bộ mặt" của dự án — nơi người dùng, người quản trị và Hội đồng chấm điểm trực tiếp nhìn thấy và tương tác:
1. **Giao diện Giám sát Thời gian thực (Realtime Dashboard):**
   - Không cần F5 hay tải lại trang: khi camera quét biển số, xe qua cổng, ô đỗ có xe, hoặc nhiệt độ thay đổi, giao diện tự động cập nhật ngay lập tức nhờ **WebSocket STOMP** (`useDeviceParking.js`).
2. **Quản lý Phương tiện Toàn diện (`CameraPlatePanel.jsx`):**
   - Hiển thị biển số xe vừa quét gần nhất và kết quả kiểm tra.
   - Form đăng ký biển số mới.
   - Tính năng **Tạm khoá / Mở khoá** biển số xe: Dành cho xe chưa đóng phí hoặc xe khả nghi.
   - Tính năng **Xoá biển số vĩnh viễn**: Có hộp thoại xác nhận an toàn, xoá hoàn toàn khỏi cơ sở dữ liệu.
3. **Bản đồ Ô đỗ Xe & Barrier Trực quan (`ParkingMap.jsx` & `VehicleAccessPanel.jsx`):**
   - Mô phỏng thanh chắn barrier (mở $90^\circ$ màu xanh, đóng $0^\circ$ màu xám).
   - Ô đỗ P01 tự động đổi sang màu đỏ khi cảm biến siêu âm phát hiện có xe đậu, và chuyển về màu xanh khi xe rời đi.
4. **Hệ thống Cảnh báo Cháy (`FireAlarmPanel.jsx`):**
   - Đo nhiệt độ LM35 thời gian thực. Khi nhiệt độ vượt ngưỡng nguy hiểm $\ge 45^\circ\text{C}$, màn hình nhấp nháy đỏ và tự động phát còi hú báo động qua `useAlarmSound.js`.
5. **Tổng đạo diễn kịch bản Live Demo:** Trực tiếp thao tác trên web và phối hợp với các bạn trong nhóm để chạy thử nghiệm kịch bản xe vào/ra thực tế.

---

## 📂 2. CÁC FILE CODE VÀ ĐOẠN CODE TRỌNG TÂM CẦN MỞ SHOW CHO THẦY

### FILE 1: `src/components/CameraPlatePanel.jsx`
* **Ý nghĩa:** Thành phần giao diện điều khiển Camera và quản lý biển số xe.
* **Đoạn code cốt lõi cần chỉ cho thầy:**
  * **Hàm Đăng ký xe mới `handleRegister(e)` (Dòng 48 - 69):**
    ```jsx
    const res = await fetch(`${base}/api/camera/registered-plates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plate: clean, enabled: true }),
    });
    ```
  * **Hàm Tạm khoá / Mở khoá `handleToggle(plate, currentEnabled)` (Dòng 71 - 87):**
    Gửi request đảo ngược cờ `enabled` (`!currentEnabled`), giúp người quản trị vô hiệu hóa hoặc kích hoạt lại quyền ra vào của một xe mà không cần xoá dữ liệu.
  * **Hàm Xoá vĩnh viễn `handleDelete(plate)` (Dòng 89 - 107):**
    Có hộp thoại xác nhận `window.confirm`, gọi method `DELETE` tới `${base}/api/camera/registered-plates/${encodeURIComponent(plate)}`.
  * **Phần hiển thị thẻ biển số (Dòng 176 - 215):**
    Định dạng hiển thị biển số qua hàm `formatPlateDisplay(item.plate)` (ví dụ `36H-123.45`), hiển thị tag trạng thái "Hoạt động" (xanh lá) hoặc "Tạm khoá" (đỏ cam), cùng các nút bấm thao tác nhanh.

---

### FILE 2: `src/hooks/useDeviceParking.js`
* **Ý nghĩa:** Custom Hook kết nối WebSocket STOMP mang lại trải nghiệm thời gian thực (Zero Refresh).
* **Đoạn code cốt lõi:**
  * Khởi tạo STOMP Client kết nối tới endpoint `/ws`.
  * Đăng ký lắng nghe kênh tin tức (Topic Subscription):
    ```javascript
    client.subscribe("/topic/parking/updates", (message) => {
      const payload = JSON.parse(message.body);
      setAccessState(payload.access);
      setParkingState(payload.parking);
      setTemperatureState(payload.temperature);
    });
    ```
  * **Giải thích logic:** Khi có bất kỳ sự kiện nào xảy ra từ vi điều khiển hoặc camera, server Spring Boot bắn ngay một gói tin JSON xuống kênh này. Hook bắt được dữ liệu và cập nhật trực tiếp vào State của React, khiến giao diện thay đổi ngay lập tức dưới 0.1 giây mà không cần người dùng phải bấm F5 tải lại trang.

---

### FILE 3: `src/components/VehicleAccessPanel.jsx`
* **Ý nghĩa:** Giám sát trạng thái barrier và lưu lượng xe.
* **Đoạn code cốt lõi:**
  * Hiển thị chỉ số thống kê:
    * `Inside`: Số xe đang đỗ thực tế trong bãi.
    * `Pending Parking`: Số xe đã qua cổng barrier nhưng đang di chuyển tìm ô đỗ.
    * `Exited`: Số lượt xe đã rời bãi an toàn.
    * `Capacity`: Sức chứa tối đa của bãi xe.
  * Hiển thị trực quan thanh chắn barrier mô phỏng đồng bộ với vị trí góc quay của Servo thật.

---

### FILE 4: `src/components/ParkingMap.jsx` & `SlotCard.jsx`
* **Ý nghĩa:** Bản đồ bãi đỗ xe mô phỏng không gian thực tế.
* **Đoạn code cốt lõi:**
  * Hiển thị 4 vị trí đỗ xe: P01, P02, P03, P04.
  * Liên kết với dữ liệu cảm biến siêu âm ô đỗ: Khi ô đỗ có trạng thái `OCCUPIED`, component tự động render biểu tượng chiếc xe đỗ vào ô và chuyển màu nền sang màu đỏ cảnh báo đã có xe.

---

### FILE 5: `src/components/FireAlarmPanel.jsx` & `useAlarmSound.js`
* **Ý nghĩa:** Hệ thống cảnh báo khẩn cấp khi có sự cố nhiệt độ cao/cháy nổ.
* **Đoạn code cốt lõi:**
  * Đọc nhiệt độ từ cảm biến LM35.
  * Nếu nhiệt độ $\ge 45^\circ\text{C}$: Kích hoạt giao diện chớp đỏ cảnh báo khẩn cấp, đồng thời hook `useAlarmSound.js` sử dụng Web Audio API để phát âm thanh còi hú báo động trực tiếp từ loa máy tính.

---

## 🎬 3. KỊCH BẢN THUYẾT TRÌNH & ĐIỀU PHỐI LIVE DEMO THỰC TẾ

### Lời mở đầu thuyết trình (Bạn nói khoảng 1.5 phút):
> *"Kính thưa thầy/cô, em xin đại diện nhóm trình bày về **Tầng 4: Giao diện Web Dashboard và Trải nghiệm Người dùng** của hệ thống Smart Parking.*
>
> *Dashboard của tụi em được phát triển bằng **React 18** và bundler **Vite**, mang phong cách thiết kế hiện đại, trực quan và đặc biệt là **hoàn toàn Realtime 100% nhờ giao thức WebSocket STOMP**.*
>
> *Người quản trị bãi xe có thể theo dõi mọi diễn biến trên cùng một màn hình duy nhất:*
> 1. *Giám sát hình ảnh biển số vừa quét từ camera AI.*
> 2. *Quản lý danh sách phương tiện: Thêm xe mới, Tạm khoá xe vi phạm chưa đóng phí, hoặc Xoá xe khỏi hệ thống.*
> 3. *Theo dõi trạng thái thanh chắn barrier và sơ đồ 4 ô đỗ xe xanh/đỏ theo thời gian thực.*
> 4. *Giám sát nhiệt độ môi trường và tự động hú còi báo động khẩn cấp khi phát hiện nguy cơ hoả hoạn.*
>
> *Sau đây, em xin phép mời quý thầy/cô cùng theo dõi **phần Live Demo thực tế toàn bộ quy trình vận hành bãi xe** do nhóm tụi em trực tiếp thực hiện ngay sau đây ạ!"*

---

### 🚀 KỊCH BẢN BỐN BƯỚC LIVE DEMO THỰC TẾ TRƯỚC HỘI ĐỒNG:

| Bước | Thao tác trên Web (Người 4 làm) | Thao tác phần cứng/camera (Cả nhóm phối hợp) | Hiện tượng trên Web & Phần cứng |
| :---: | :--- | :--- | :--- |
| **BƯỚC 1: Quản lý Biển số & Thử nghiệm Tạm khoá** | • Nhập biển số `36H-123.45` bấm **"Đăng ký xe"**.<br>• Thử bấm nút **"Tạm khoá"**.<br>• Nói: *"Bây giờ xe này đang bị tạm khoá, ta thử quét biển xem cổng có mở không."* | Đưa biển số `36H-123.45` trước Camera. | • Web hiện kết quả: `Tạm khoá (ACCESS_LOCKED)`.<br>• Cổng barrier **kiên quyết không mở**.<br>• Bấm lại nút **"Mở khoá"** để chuyển sang "Hoạt động". |
| **BƯỚC 2: Xe vào bãi (Check-in & Slot Confirmation)** | Chỉ tay lên màn hình xem trạng thái xe. | • Đưa biển số trước camera.<br>• Sau khi barrier mở, cho xe đi qua cảm biến trước cổng.<br>• Cho xe đỗ vào ô P01 (đặt vật cản trước cảm biến P01). | • Camera nhận diện → Backend duyệt → Barrier mở $90^\circ$.<br>• Xe qua cổng → Barrier tự động đóng lại.<br>• Trạng thái xe trên web chuyển: `PENDING_PARKING` → khi đỗ vào ô P01 chuyển thành **`INSIDE`**.<br>• Ô P01 trên bản đồ đổi từ màu xanh sang **màu đỏ**! |
| **BƯỚC 3: Xe ra bãi (Check-out Tự động `AUTO`)** | Cho thầy cô xem số lượng `Inside = 1`. | • Rút vật cản khỏi ô P01 (xe lùi ra).<br>• Đưa biển số ra trước camera (cổng ra). | • Ô P01 trên web lập tức chuyển về màu xanh (Trống).<br>• Camera quét biển → Backend tự động nhận diện chiều `EXIT` → Barrier tự động mở cho xe ra.<br>• Xe qua cổng → Trạng thái xe chuyển thành **`EXITED`** (Hoàn thành chu kỳ trọn vẹn). |
| **BƯỚC 4: Demo Báo cháy khẩn cấp** | Mở tab giám sát nhiệt độ. | Dùng bật lửa hơ nhẹ gần cảm biến LM35 (hoặc giải thích logic nếu không tiện dùng lửa). | • Nhiệt độ vượt ngưỡng $45^\circ\text{C}$.<br>• Còi Buzzer trên mạch kêu liên tục.<br>• Giao diện Web nhấp nháy đỏ rực và phát âm thanh còi hú báo cháy trên loa máy tính! |

---

## ❓ 4. CÁC CÂU HỎI VẤN ĐÁP THẦY SẼ HỎI BẠN & CÁCH TRẢ LỜI ĐẠT ĐIỂM TỐI ĐA

### ❓ Câu hỏi 1: "Làm thế nào để Web nhận được dữ liệu tức thì từ backend mà không cần gửi request liên tục (Polling)?"
> **Trả lời:** Dạ thưa thầy, nếu dùng cơ chế Polling (gọi `fetch` liên tục mỗi giây) thì sẽ gây lãng phí băng thông và làm quá tải server. Tụi em đã triển khai giao thức **WebSocket hai chiều (STOMP Protocol)** qua thư viện `@stomp/stompjs` trong hook `useDeviceParking.js`:
> - Trình duyệt chỉ mở 1 kết nối TCP duy nhất tới server tại `/ws`.
> - Khi có bất kỳ thay đổi nào về xe hoặc cảm biến, server Spring Boot sẽ chủ động **đẩy (Push)** dữ liệu xuống kênh `/topic/parking/updates`.
> - Nhờ đó, độ trễ cập nhật giao diện đạt mức gần như tức thời (dưới 50ms) và tiết kiệm tài nguyên mạng tối đa.

### ❓ Câu hỏi 2: "Khi xoá một biển số xe trên web, việc xoá đó diễn ra như thế nào ở phía Backend và CSDL?"
> **Trả lời:** Dạ thưa thầy:
> - Khi người dùng bấm nút xoá trên giao diện, hàm `handleDelete()` trong `CameraPlatePanel.jsx` sẽ bật hộp thoại xác nhận `window.confirm`.
> - Nếu người dùng đồng ý, frontend gửi một HTTP `DELETE` tới endpoint `/api/camera/registered-plates/{plate}`.
> - Backend Spring Boot đón nhận request này tại `CameraController.java`, gọi qua `ParkingService.java` và thực thi câu lệnh SQL: `DELETE FROM registered_plate WHERE plate = ?`.
> - Bản ghi biển số đó bị xóa hoàn toàn khỏi danh sách cấp phép, các lượt xe sau này của biển số này sẽ bị từ chối với mã `NOT_REGISTERED`.

### ❓ Câu hỏi 3: "Tại sao âm thanh còi báo cháy lại phát được trực tiếp từ trình duyệt mà không cần file MP3 tải về?"
> **Trả lời:** Dạ thưa thầy, trong hook `useAlarmSound.js`, tụi em sử dụng trực tiếp **Web Audio API** tích hợp sẵn của trình duyệt:
> - Tạo ra một bộ dao động âm thanh (`OscillatorNode`) phát sóng âm tần số thay đổi dạng còi hú tuần hoàn ($600\text{Hz} - 900\text{Hz}$).
> - Ưu điểm là không cần phải tải bất kỳ file âm thanh MP3 nặng nề nào từ server, đảm bảo còi hú có thể phát ngay tức khắc khi phát hiện cháy, kể cả khi mạng bị chập chờn hoặc mất kết nối Internet.

### ❓ Câu hỏi 4: "Giao diện web này có chạy được trên điện thoại di động không?"
> **Trả lời:** Dạ thưa thầy, toàn bộ giao diện được thiết kế theo tiêu chuẩn **Responsive Web Design**:
> - Sử dụng CSS Grid và Flexbox linh hoạt (`VehicleAccessPanel.css`, `styles.css`).
> - Khi mở trên màn hình nhỏ của điện thoại thông minh, các panel tự động xếp chồng theo chiều dọc một cách gọn gàng, các nút bấm "Tạm khoá", "Xoá" và bảng ô đỗ xe đều tự động co giãn vừa vặn với ngón tay thao tác.

### ❓ Câu hỏi 5: "Nếu người dùng bấm đăng ký biển số mà nhập chữ thường hoặc có khoảng trắng lung tung thì web xử lý ra sao?"
> **Trả lời:** Dạ thưa thầy, hệ thống có 2 tầng kiểm soát dữ liệu đầu vào:
> 1. **Tại Frontend:** Hàm `handleRegister()` tự động gọi `.trim()` để loại bỏ các khoảng trắng thừa ở đầu và cuối chuỗi, đồng thời giới hạn độ dài `maxLength={24}`.
> 2. **Tại Backend & Service:** Hàm `normalizePlate()` trong `ParkingService.java` tự động viết hoa toàn bộ và loại bỏ các ký tự đặc biệt, đảm bảo biển số lưu vào cơ sở dữ liệu luôn ở dạng chuẩn hóa duy nhất.
