# 📘 HƯỚNG DẪN THUYẾT TRÌNH & VẤN ĐÁP: NGƯỜI 3 - BACKEND SERVER & CƠ SỞ DỮ LIỆU

> **Vai trò trong nhóm:** Phụ trách Tầng 3 (Server & Database Layer) — Lập trình Java Spring Boot, Quản lý nghiệp vụ bãi xe (`ParkingService.java`), An ninh bảo mật API (`DeviceKeyFilter.java`), Cơ sở dữ liệu PostgreSQL với Flyway Migration (V1 - V8), và Giao tiếp thời gian thực WebSocket STOMP.

---

## 🎯 1. TỔNG QUAN PHẦN BẠN PHỤ TRÁCH
Bạn chịu trách nhiệm về "Bộ não trung tâm" của toàn bộ hệ thống:
1. **Core Domain Logic (`ParkingService.java`):**
   - Xử lý xác thực biển số: Chưa đăng ký (`NOT_REGISTERED`), Xe bị tạm khoá (`ACCESS_LOCKED`), hoặc Cho phép vào/ra.
   - Thuật toán tự động hai chiều **`AUTO`**: Tự động xác định xe vào hay ra dựa trên lịch sử trong cơ sở dữ liệu.
   - Cơ chế nâng cao **Slot-Confirmed Arrival**: Xe qua barrier chỉ tính là `PENDING_PARKING`; chỉ khi cảm biến ô đỗ xác nhận xe đã đậu ổn định mới chuyển trạng thái thành `INSIDE`.
   - Quản lý danh sách biển số: Đăng ký mới, Bật/Tắt Tạm khoá, và Xoá vĩnh viễn.
2. **REST API Controllers:**
   - `CameraController.java`: Cung cấp API cho camera và Web quản lý biển số.
   - `AccessController.java`: Cung cấp trạng thái barrier, thống kê và telemetry.
3. **An toàn & Bảo mật (`DeviceKeyFilter.java` & `HttpConfig.java`):**
   - Chặn các truy cập trái phép bằng header `X-Device-Key`.
   - Cấu hình chuẩn CORS cho phép các method `GET`, `POST`, `PUT`, `DELETE`.
4. **Cơ sở dữ liệu & Thời gian thực (PostgreSQL & WebSocket STOMP):**
   - Quản lý phiên bản CSDL tự động bằng **Flyway Migration** từ V1 đến V8.
   - Đẩy thông báo tức thời tới Web Dashboard qua `/topic/parking/updates` (`ParkingBroadcast.java`).

---

## 📂 2. CÁC FILE CODE VÀ ĐOẠN CODE TRỌNG TÂM CẦN MỞ SHOW CHO THẦY

### FILE 1: `backend/src/main/java/com/smartparking/service/ParkingService.java`
* **Ý nghĩa:** Đây là file quan trọng nhất của toàn bộ Backend.
* **Đoạn code cốt lõi cần chỉ cho thầy:**
  * **Hàm `cameraReading(Reading reading)`:**
    * *Chuẩn hóa biển số:* Chuyển thành chữ in hoa và loại bỏ dấu gạch/khoảng trắng.
    * *Kiểm tra đăng ký và trạng thái khoá:*
      ```java
      // Truy vấn bảng registered_plate
      RegisteredPlate plate = accessStore.findRegisteredPlate(normalizedPlate);
      if (plate == null) {
          return new Latest(..., "NOT_REGISTERED");
      }
      if (!plate.enabled()) {
          return new Latest(..., "ACCESS_LOCKED");
      }
      ```
    * *Xử lý tự động hướng di chuyển (`AUTO`):*
      ```java
      if (reading.direction() == AccessData.Direction.AUTO) {
          // Nếu xe chưa có trong bãi hoặc đã EXITED -> Đây là lượt xe VÀO (ENTRY)
          // Nếu xe đang ở trạng thái INSIDE hoặc PENDING_PARKING -> Đây là lượt xe RA (EXIT)
          direction = activeVisit == null ? Direction.ENTRY : Direction.EXIT;
      }
      ```
    * *Xử lý trạng thái Slot-Confirmed:*
      Khi xe vào hợp lệ, lượt xe được khởi tạo ở trạng thái `PENDING_ENTRY` → khi barrier mở và xe qua, chuyển thành `PENDING_PARKING`.
  * **Hàm xác nhận ô đỗ (`confirmSlotOccupied` & `confirmSlotCleared`):**
    Khi nhận telemetry từ cảm biến P01 báo ô đỗ có xe, hàm này chuyển trạng thái xe từ `PENDING_PARKING` thành chính thức `INSIDE`. Khi xe rời ô, cập nhật mốc thời gian `slot_left_at`.
  * **Hàm Đăng ký, Tạm khoá và Xoá biển số:**
    ```java
    public Registered registerPlate(Registration reg) {
        return accessStore.saveRegisteredPlate(reg.plate(), reg.enabled());
    }
    public void deletePlate(String plate) {
        accessStore.deleteRegisteredPlate(plate);
    }
    ```

---

### FILE 2: `backend/src/main/java/com/smartparking/controller/CameraController.java`
* **Ý nghĩa:** Cung cấp đầy đủ RESTful API cho ứng dụng Camera AI và Web Dashboard.
* **Đoạn code cốt lõi:**
  ```java
  @RestController
  @RequestMapping("/api")
  public class CameraController {
    // 1. Camera gửi biển số lên
    @PostMapping("/device/plate-readings")
    public Latest receive(@Valid @RequestBody Reading reading) {
      return parking.cameraReading(reading);
    }

    // 2. Web lấy thông tin xe vừa quét gần nhất
    @GetMapping("/camera/latest")
    public Latest latest() { ... }

    // 3. Web lấy danh sách biển số đã đăng ký
    @GetMapping("/camera/registered-plates")
    public List<Registered> registered() { ... }

    // 4. Web đăng ký mới hoặc Bật/Tắt Tạm khoá
    @PostMapping("/camera/registered-plates")
    public Registered registerFromWeb(@Valid @RequestBody Registration reg) {
      return parking.registerPlate(reg);
    }

    // 5. Web xoá vĩnh viễn biển số khỏi hệ thống
    @DeleteMapping("/camera/registered-plates/{plate}")
    public void delete(@PathVariable String plate) {
      parking.deletePlate(plate);
    }
  }
  ```

---

### FILE 3: `backend/src/main/java/com/smartparking/config/DeviceKeyFilter.java`
* **Ý nghĩa:** Bộ lọc an ninh bảo vệ các API phần cứng IoT.
* **Đoạn code cốt lõi:**
  ```java
  @Override
  protected void doFilterInternal(HttpServletRequest request, ...) {
    String path = request.getRequestURI();
    if (path.startsWith("/api/device/")) {
      String key = request.getHeader("X-Device-Key");
      if (key == null || !key.equals(this.configuredDeviceKey)) {
        response.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Invalid device key");
        return;
      }
    }
    filterChain.doFilter(request, response);
  }
  ```
  * **Giải thích logic:** Mọi request muốn can thiệp phần cứng (như camera gửi biển số, thiết bị gửi telemetry) đều phải có header `X-Device-Key`. Các API dành cho Web dashboard (như xem trạng thái, quản lý biển số) thì không bị chặn để người dùng thao tác bình thường.

---

### FILE 4: `backend/src/main/resources/db/migration/` (Flyway Migrations)
* **Ý nghĩa:** Quản lý cấu trúc cơ sở dữ liệu có tính phiên bản (Database Version Control).
* **Các file quan trọng:**
  * `V1__init.sql` đến `V6`: Khởi tạo các bảng `vehicle_visit`, `access_event`, `registered_plate`, `barrier_state`.
  * `V7__experimental_slot_confirmed_access.sql`: Bổ sung trạng thái `PENDING_PARKING`, trường `gate_entered_at` để theo dõi chính xác thời điểm xe vừa lọt qua barrier.
  * `V8__slot_clear_confirmation.sql`: Bổ sung trường `slot_left_at` ghi nhận thời điểm xe lùi ra khỏi ô đỗ P01.

---

### FILE 5: `backend/src/main/java/com/smartparking/service/ParkingBroadcast.java` & `backend/src/main/java/com/smartparking/config/RealtimeConfig.java`
* **Ý nghĩa:** Hạ tầng WebSocket STOMP đẩy dữ liệu thời gian thực xuống Web.
* **Đoạn code cốt lõi:**
  * `RealtimeConfig.java`: Mở endpoint WebSocket `/ws` với SockJS fallback.
  * `ParkingBroadcast.java`: Sử dụng `SimpMessagingTemplate` bắn dữ liệu snapshot bãi đỗ xe tới topic `/topic/parking/updates` mỗi khi có bất kỳ thay đổi nào trong hệ thống.

---

## 🎤 3. KỊCH BẢN THUYẾT TRÌNH MẪU (BẠN NÓI KHOẢNG 2 - 3 PHÚT)

> *"Kính thưa thầy/cô, em xin đại diện nhóm trình bày về **Tầng 3: Backend Server & Cơ sở Dữ liệu** — thành phần đóng vai trò 'Bộ não' điều phối toàn bộ nghiệp vụ của hệ thống Smart Parking.*
>
> *Backend của tụi em được phát triển trên nền tảng **Java Spring Boot 3**, kết hợp với hệ quản trị cơ sở dữ liệu **PostgreSQL 16** và công cụ quản lý migration tự động **Flyway**.*
>
> *Về mặt nghiệp vụ cốt lõi, em xin nhấn mạnh 3 tính năng quan trọng nhất tại `ParkingService.java`:*
> 1. ***Cơ chế phân quyền biển số 3 trạng thái:*** *Khi nhận biển số từ camera, hệ thống kiểm tra bảng `registered_plate`. Nếu chưa đăng ký trả về `NOT_REGISTERED`; nếu xe đang bị người quản trị tạm khoá trên web trả về `ACCESS_LOCKED` và dứt khoát không mở cổng; chỉ khi xe hợp lệ và đang kích hoạt mới phê duyệt.*
> 2. ***Thuật toán Stateful Encounter (`AUTO`):*** *Hệ thống tự động tra cứu lịch sử trong CSDL. Nếu xe chưa có trong bãi, server tự gán hướng `ENTRY`. Nếu xe đã có trong bãi, server tự gán hướng `EXIT`. Người dùng chỉ cần 1 camera duy nhất mà vẫn vận hành được cả chiều vào lẫn chiều ra.*
> 3. ***Quy trình kiểm soát ô đỗ nâng cao (Slot-Confirmed Arrival):*** *Tụi em viết migration V7 và V8 trong Flyway để hỗ trợ trạng thái trung gian `PENDING_PARKING`. Khi xe qua cổng barrier, xe chưa được tính là 'Inside'. Chỉ khi cảm biến ô P01 phát hiện xe đã đỗ thành công, server mới cập nhật trạng thái `INSIDE`.*
>
> *Toàn bộ các cập nhật này được server tự động 'push' xuống giao diện Frontend thông qua giao thức **WebSocket STOMP** trên topic `/topic/parking/updates`, đồng thời tất cả các endpoint giao tiếp phần cứng đều được bảo vệ nghiêm ngặt bằng bộ lọc **`DeviceKeyFilter`**.*
>
> *Sau đây, em xin mời bạn [Tên Người 4] trình bày về Giao diện Web Dashboard và trực tiếp điều hành phần Live Demo."*

---

## ❓ 4. CÁC CÂU HỎI VẤN ĐÁP THẦY SẼ HỎI BẠN & CÁCH TRẢ LỜI ĐẠT ĐIỂM TỐI ĐA

### ❓ Câu hỏi 1: "Tại sao lại dùng Flyway Migration mà không để Hibernate tự động tạo bảng (`ddl-auto=update`)?"
> **Trả lời:** Dạ thưa thầy, trong môi trường sản xuất công nghiệp:
> 1. `ddl-auto=update` của Hibernate rất nguy hiểm vì có thể tự ý sửa đổi kiểu dữ liệu hoặc xoá nhầm cột làm mất mát dữ liệu thực tế.
> 2. **Flyway** quản lý cấu trúc database dưới dạng các file mã nguồn SQL có đánh số phiên bản (`V1`, `V2`,..., `V8`) được commit chung vào Git. Khi triển khai lên server mới hoặc đồng bộ giữa các máy lập trình, Flyway sẽ tự động chạy các migration tuần tự, đảm bảo schema cơ sở dữ liệu ở mọi môi trường luôn đồng nhất 100% mà không bao giờ gây lỗi xung đột.

### ❓ Câu hỏi 2: "Trạng thái `PENDING_PARKING` khác gì với `INSIDE`? Tại sao phải sinh ra trạng thái này?"
> **Trả lời:** Dạ thưa thầy:
> - `PENDING_PARKING` có nghĩa là: Xe đã được duyệt qua cổng barrier, nhưng xe vẫn đang di chuyển trên đường dẫn trong bãi, chưa đỗ vào bất kỳ ô nào.
> - `INSIDE` có nghĩa là: Xe đã thực sự nằm trong ô đỗ (được xác nhận bởi cảm biến siêu âm ô P01).
> - Việc phân tách này giúp người quản lý bãi xe phát hiện được các tình huống bất thường: ví dụ xe qua cổng nhưng không đỗ mà quay đầu đi ra, hoặc xe đỗ sai vị trí không vào ô quy định.

### ❓ Câu hỏi 3: "Khi có hàng ngàn lượt xe ra vào, làm sao truy vấn tìm biển số xe nhanh nhất?"
> **Trả lời:** Dạ thưa thầy:
> 1. Trong file migration Flyway `V1`, cột `plate` trong bảng `registered_plate` đã được đánh chỉ mục `UNIQUE INDEX`.
> 2. Trong bảng `vehicle_visit`, cột `status` và `plate` đều được đánh Index để khi xe đến cổng, câu lệnh truy vấn tìm lượt gửi đang hoạt động (`WHERE plate = ? AND status IN ('PENDING_ENTRY', 'PENDING_PARKING', 'INSIDE')`) đạt độ phức tạp tìm kiếm là $O(\log N)$, phản hồi tức thì dưới 5 mili-giây.

### ❓ Câu hỏi 4: "Tại sao lại dùng `JdbcTemplate` thay vì dùng toàn bộ Spring Data JPA / Hibernate?"
> **Trả lời:** Dạ thưa thầy:
> - `JdbcTemplate` cho phép viết các câu lệnh SQL tường minh, tối ưu hóa chính xác từng thao tác `INSERT`, `UPDATE`, `JOIN` mà không bị gánh nặng hiệu năng (overhead) của Hibernate (như bộ nhớ đệm cấp 1, cấp 2, hay lỗi N+1 query).
> - Đối với các hệ thống IoT cần ghi nhận trạng thái phần cứng và phản hồi mở barrier tức thời dưới 100ms, `JdbcTemplate` mang lại tốc độ thực thi cao nhất và kiểm soát dữ liệu chặt chẽ nhất.

### ❓ Câu hỏi 5: "Làm thế nào để chức năng Tạm khoá biển số và Xoá biển số không bị lỗi CORS khi gọi từ trình duyệt?"
> **Trả lời:** Dạ thưa thầy, trong file `HttpConfig.java`, tụi em đã cấu hình phương thức CORS WebMvc:
> ```java
> registry.addMapping("/api/**")
>     .allowedOrigins(...)
>     .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS");
> ```
> Mặc định một số trình duyệt khi gọi method `DELETE` sẽ gửi một request `OPTIONS` (Preflight request) để kiểm tra quyền. Nhờ cấu hình đầy đủ `allowedMethods` và xử lý tại `CameraController.java`, việc xoá và cập nhật biển số diễn ra mượt mà và an toàn.
