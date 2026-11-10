> **Nhánh thử nghiệm `experiment/auto-entry-exit`**: qua cổng chưa tính Inside; vào ô P01 mới Inside. Chạy riêng tại web5175/API18081/DB55439. Đọc [EXPERIMENT.md](EXPERIMENT.md).

# Smart Parking System

Dashboard React + Vite + Tailwind CSS với backend **Spring Boot 3.5 / Java 17**, **PostgreSQL 16** và **WebSocket/STOMP**. Prototype gồm bốn chỗ P01–P04, một thiết bị `esp8266-01`.

ESP32 phát AP, laptop chạy camera/web và điều khiển servo qua cầu nối Python: xem [hướng dẫn ESP32](docs/ESP32_SETUP.md).

Camera gốc trong `Project`, kiểm tra biển đăng ký và chuyển lệnh cho ESP32: [Project/Camera/run.md](Project/Camera/run.md).

## Chạy nhanh

Cần Node.js **22.12+**, npm và Docker Compose. Docker sẽ build Java; không cần cài Maven/Java trên máy khi dùng cách này.

```sh
npm install
npm run backend:up
npm run dev
```

Mở URL Vite in ra (thường http://localhost:5173). Chọn **Device** để xem dữ liệu backend. Lần build Docker đầu tiên cần tải image/dependencies và có thể mất vài phút. API: http://127.0.0.1:18080/api/parking/status. Xem log bằng `npm run backend:logs`.

`backend:up` tạo `.env` với mật khẩu PostgreSQL và device key ngẫu nhiên, không ghi đè cấu hình đã có. File này được gitignore; không đưa key vào frontend hay biến `VITE_*`.

Chỉ xem giao diện: `npm run dev` vẫn chạy độc lập, mặc định **Simulation** (P01/P03 occupied; P02/P04 available). Chế độ này không gọi API hoặc ghi database. Chuyển sang Device sẽ dừng auto simulation. Device Mode khởi đầu unknown, không dùng mẫu lịch sử của Simulation.

## Test luồng HTTP → database → dashboard

Khi backend đã khởi động, ở terminal khác:

```sh
npm run device:simulate
```

Đây là **trình giả lập HTTP của mạch**, không phải ESP8266 thật. Chọn Device trên dashboard để thấy dữ liệu lưu và cập nhật qua WebSocket. Ctrl+C dừng giả lập; sau khoảng 45–50 giây, các chỗ chuyển Unknown và thiết bị Offline. Không có mẫu dữ liệu nào tự được seed vào database.

```sh
npm test              # simulation + adapter/freshness/order tests
npm run build         # production frontend build
npm run test:backend  # Java 17+, PostgreSQL đang chạy; tự tạo DB parking_test riêng
npm run backend:down  # dừng stack, GIỮ dữ liệu trong named volume
```

Maven Wrapper có sẵn trong `backend/`, tải Maven kèm checksum. Test backend chỉ xóa fixture trong database `parking_test`, không dùng database `parking` của ứng dụng.

## Nối mạch và cấu hình

Xem **[hướng dẫn backend & ESP8266](docs/BACKEND.md)**: HTTP contract, device key, cổng LAN, timeout, cách chạy Java trực tiếp và cấu hình frontend khi host riêng.

- Dashboard nhận `/topic/parking` qua STOMP tại `/ws`; đây **không phải Socket.IO**.
- Reconnect tự động và HTTP polling 10 giây để khôi phục snapshot bị lỡ.
- Mất backend 25 giây: các trạng thái chưa thể xác nhận hiển thị Unknown, không báo thiết bị online.
- Heartbeat xác nhận thiết bị còn phản hồi; mỗi sensor phải có báo cáo riêng còn hạn.
- Database giữ lịch sử thay đổi; dashboard và API history hiển thị tối đa 100 bản ghi gần nhất. CSV xuất theo bộ lọc đang chọn.

## Chia sẻ frontend

```sh
npm run share
```

Lệnh mở Vite + Cloudflare Quick Tunnel, in URL HTTPS tạm thời; Ctrl+C dừng cả hai. Simulation chạy ngay. Nếu muốn Device Mode qua tunnel, backend phải chạy và cần thêm **đúng origin HTTPS của tunnel** vào `ALLOWED_ORIGINS`, rồi recreate backend. Không chia sẻ `.env` hoặc device key. Chế độ Device cho người có URL quyền đọc trạng thái/lịch sử; prototype chưa có đăng nhập người xem.

Vite bind loopback khi share, giữ kiểm tra Host, tự chọn cổng khác nếu 5173 bận. Nếu dùng cổng khác, thêm origin đó vào `ALLOWED_ORIGINS` để WebSocket được chấp nhận. Chi tiết frontend triển khai Vercel: backend Spring Boot/PostgreSQL cần host riêng có HTTPS/WSS; Vercel chỉ chạy bản frontend này.

## Nhiệt độ / báo cháy theo cấu hình mạch

**ON 50°C / OFF 45°C**, giữ trạng thái trong khoảng hai ngưỡng; LED đổi trạng thái mỗi **300 ms**. `FIRE_OPENS_GATE=true` được hiển thị dưới dạng yêu cầu mở cổng trong **Gate preview**, không xác nhận vị trí cổng hoặc điều khiển servo thật.

Simulation cho phép chỉnh nhiệt độ/ngưỡng và bật còi web. Device nhận bản đo qua HTTP, lưu PostgreSQL, giữ alarm latch qua timeout/restart và cập nhật realtime. V2/V3 thêm các bảng nhiệt và chính sách firmware, giữ nguyên dữ liệu parking.

```sh
npm run temperature:simulate
# Chu kỳ 27 → 49 → 50 → 47 → 45°C; hoặc gửi một bản đo:
npm run temperature:simulate -- --temperature 50 --once
```

Lệnh gửi HTTP giả lập, chưa phải cảm biến thật. Xem [hướng dẫn demo, API và SQL](docs/FIRE_ALARM.md).

## Cấu trúc

- `backend/`: REST, JDBC transactions, Flyway migrations, STOMP, integration tests.
- `src/services/parking.js`, `useParking`: local simulation.
- `src/services/deviceParking.js`, `useDeviceParking`: validate snapshot, revision ordering, reconnect, freshness.
- `compose.yaml`: PostgreSQL và backend, volume riêng; không sử dụng database của dự án khác.
- `docs/VERIFICATION.md`: kết quả kiểm thử và giới hạn thực tế.

Không có authentication người dùng, thanh toán hoặc firmware cảm biến hoàn chỉnh. Chưa xác minh với phần cứng thật. SVG xe được vẽ trong mã; không tải ảnh/font ngoài.
