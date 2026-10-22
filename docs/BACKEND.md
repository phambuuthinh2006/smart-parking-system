# Backend Smart Parking — hướng dẫn sử dụng

## Luồng dữ liệu

```text
ESP8266 -- HTTP JSON + X-Device-Key --> Spring Boot :18080
                                      | transaction
                                      v
                                 PostgreSQL :55432
                                      |
                               broadcast sau COMMIT
                                      v
React <-- STOMP /topic/parking <-- WebSocket /ws
```

Bản này dùng Spring WebSocket/STOMP. `socket.io-client` không tương thích giao thức này; frontend dùng `@stomp/stompjs`. Tham khảo [Spring STOMP](https://docs.spring.io/spring-framework/reference/web/websocket/stomp/enable.html) và [Spring Boot 3.5 / Java 17](https://docs.spring.io/spring-boot/3.5/system-requirements.html).

## Khởi động và cấu hình

```sh
npm run backend:up
npm run dev
```

Mặc định PostgreSQL chỉ mở `127.0.0.1:55432`, API mở `127.0.0.1:18080`. Dùng database và volume riêng của project `smart-parking`. Lệnh `npm run backend:down` giữ volume.

Các cấu hình trong `.env`:

| Biến                     | Mặc định / ý nghĩa                                           |
| ------------------------ | ------------------------------------------------------------ |
| `POSTGRES_PASSWORD`      | Tạo ngẫu nhiên bằng backend:init                             |
| `DEVICE_API_KEY`         | Tạo ngẫu nhiên; tối thiểu 24 ký tự; chỉ backend và mạch biết |
| `POSTGRES_PORT`          | 55432, cổng DB trên máy                                      |
| `API_PORT`               | 18080, cổng HTTP trên máy                                    |
| `API_BIND_ADDRESS`       | 127.0.0.1; đổi 0.0.0.0 khi cho mạch truy cập LAN             |
| `DEVICE_TIMEOUT_SECONDS` | 45, timeout heartbeat và từng sensor                         |
| `ALLOWED_ORIGINS`        | Các origin frontend, phân cách dấu phẩy, không có dấu / cuối |

Sau khi đổi `.env`: `docker compose up -d --force-recreate backend`. Mật khẩu PostgreSQL được dùng khi tạo volume lần đầu: **đổi biến môi trường không đổi mật khẩu trong database đã có**. Muốn đổi mật khẩu sau đó phải đổi role PostgreSQL tương ứng; không xóa volume để sửa lỗi đăng nhập.

Nếu đổi `API_PORT`, chạy Vite với `BACKEND_PROXY_TARGET=http://127.0.0.1:<port> npm run dev` và restart Vite. Vite proxy `/api` và `/ws`; biến này chỉ dành cho dev server, không vào bundle.

Nếu frontend host riêng, đặt `VITE_BACKEND_URL=https://your-api.example.com` trước `npm run build`; giá trị không có slash cuối. Backend thêm origin frontend vào `ALLOWED_ORIGINS`. Trình duyệt HTTPS cần backend HTTPS/WSS và reverse proxy hỗ trợ WebSocket Upgrade. Không đặt device key trong bất kỳ biến `VITE_*` nào.

## API dành cho ESP8266

`POST /api/device/status` và `POST /api/device/heartbeat` bắt buộc header:

```http
Content-Type: application/json
X-Device-Key: <giá trị DEVICE_API_KEY trong .env>
```

Chỉ có thiết bị `esp8266-01`, bốn ID `P01`–`P04`. Status phải viết hoa: `AVAILABLE`, `OCCUPIED`, `UNKNOWN`. Không tự suy đoán chân GPIO: firmware cần ánh xạ đúng cảm biến thực tế sang từng ID.

### Gửi trạng thái

```json
{
  "deviceId": "esp8266-01",
  "spaces": [
    { "spaceId": "P01", "status": "OCCUPIED" },
    { "spaceId": "P02", "status": "AVAILABLE" },
    { "spaceId": "P03", "status": "OCCUPIED" },
    { "spaceId": "P04", "status": "UNKNOWN" }
  ]
}
```

Gửi snapshot đầy đủ **mỗi 15–20 giây** và gửi ngay khi phát hiện thay đổi. Có thể gửi 1–4 sensor trong một request; những sensor không được nhắc tới không được gia hạn. Debounce/lọc nhiễu ở firmware trước khi gửi. Sensor hỏng/mất tín hiệu thì gửi `UNKNOWN`, không coi đó là `AVAILABLE`.

Tùy chọn `observedAt`: timestamp ISO-8601 UTC nếu mạch đã đồng bộ NTP. Backend từ chối timestamp quá 30 giây trong tương lai hoặc cũ hơn timeout; từ chối timestamp nhỏ hơn hoặc bằng lần đã xử lý của thiết bị (409). Timestamp chuẩn hóa về microsecond trước khi so sánh/lưu. Phải dùng timestamp tăng dần ngay cả khi gửi từng sensor. Mạch chưa có đồng hồ tin cậy thì **bỏ trường observedAt**; lúc đó backend dùng thời gian nhận, không thể nhận biết thứ tự đo thực tế của các bản tin gửi trễ.

### Heartbeat

```json
{ "deviceId": "esp8266-01" }
```

Heartbeat gia hạn kết nối thiết bị nhưng **không** gia hạn trạng thái cảm biến. Một status report hợp lệ cũng được coi là heartbeat. Gửi full snapshot đều đặn thì không cần request heartbeat riêng.

| HTTP          | Ý nghĩa                                                           |
| ------------- | ----------------------------------------------------------------- |
| 200           | Đã commit, trả snapshot mới                                       |
| 400           | JSON/ID/status sai, ID trùng, danh sách rỗng, timestamp ngoài hạn |
| 401           | Thiếu/sai X-Device-Key                                            |
| 409           | Timestamp đã xử lý hoặc đảo thứ tự                                |
| 5xx / timeout | Chưa xác nhận; retry có backoff, không spam vòng lặp              |

Cùng trạng thái lặp lại không sinh thêm history, nhưng vẫn gia hạn thời gian nhận. Batch sai một mục sẽ bị từ chối toàn bộ. Không ghi lịch sử “mẫu”. Các request cùng thiết bị được tuần tự hóa bằng khóa hàng PostgreSQL. WebSocket chỉ phát sau transaction COMMIT.

### ESP8266 gửi HTTP (đoạn tích hợp, không phải firmware hoàn chỉnh)

```cpp
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>

// Gọi hàm sau khi Wi-Fi đã kết nối; thay IP bằng IP LAN của máy Docker.
int sendParkingStatus(const String& payload, const String& deviceKey) {
  WiFiClient wifiClient;
  HTTPClient http;
  http.begin(wifiClient, "http://192.168.x.x:18080/api/device/status");
  http.setTimeout(5000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", deviceKey); // lấy từ config riêng, không commit secret
  // payload theo contract trên, status lấy từ sensor đã debounce.
  int code = http.POST(payload);
  http.end();
  return code;
}
```

Trong `.env` đổi `API_BIND_ADDRESS=0.0.0.0`, recreate backend, cho phép TCP 18080 trên firewall LAN nếu cần. Mạch và máy phải cùng mạng có thể liên lạc; `localhost` trên mạch **không phải** máy tính. HTTP này dành cho LAN thử nghiệm; qua mạng công cộng phải có HTTPS và không expose PostgreSQL. Đoạn Arduino chưa được compile hoặc thử với mạch thật. API HTTPClient tham chiếu [ví dụ chính thức ESP8266](https://github.com/esp8266/Arduino/blob/master/libraries/ESP8266HTTPClient/examples/BasicHttpClient/BasicHttpClient.ino).

## API dashboard

- `GET /api/parking/status`: snapshot gồm `revision`, `generatedAt`, `staleAfterSeconds`, device, spaces, stats, tối đa 100 events mới nhất.
- `GET /api/parking/history?limit=100`: mảng lịch sử, limit 1–100.
- WS `/ws`, STOMP subscribe `/topic/parking`: cùng cấu trúc snapshot.

Read API không yêu cầu API key; bản prototype chưa có auth người xem. Client WebSocket không được SEND và chỉ được subscribe đúng topic. Cho phép origin theo cấu hình; CORS không thay thế device key.

Mỗi lần status/heartbeat/expiry được commit tăng revision. Frontend bỏ snapshot revision cũ, lấy lại HTTP khi reconnect và polling 10 giây để bù bản tin lỡ. Nếu backend ngừng trả dữ liệu 25 giây, frontend chuyển các chỗ sang Unknown và báo Device Unconfirmed; lịch sử cũ vẫn có thể xem. Backend kiểm tra timeout mỗi 5 giây: thiếu heartbeat thì Offline, thiếu báo cáo sensor thì Unknown, có event `TIMEOUT`. Heartbeat mới không khôi phục trạng thái sensor cũ.

Thống kê xác nhận không tính Unknown vào Available hoặc Occupied. `updatedAt` của sensor là lần báo cáo nhận được gần nhất; expiry không sửa timestamp đó.

## Chạy Java trực tiếp (tùy chọn)

Cần Java 17+. Maven Wrapper tải Maven đã ghim kèm checksum.

```sh
npm run backend:init
docker compose up -d postgres
npm run backend:build
npm run backend:local
```

Cách này dùng DB trong Docker và Java trên máy. Không chạy đồng thời container backend trên cùng cổng. `DATABASE_URL` tùy chọn cho Java trực tiếp phải có dạng `jdbc:postgresql://host:port/parking`; cấu hình container luôn dùng hostname nội bộ `postgres`.

## Kiểm thử

```sh
npm test
npm run build
npm run test:backend
```

`test:backend` cần Java 17+, PostgreSQL project đang chạy và `.env`. Script tạo database **parking_test** riêng; suite chỉ chấp nhận URL kết thúc bằng `/parking_test`, reset fixture trong DB này trước mỗi test. Không xóa dữ liệu application `parking`.

Kiểm thử API/transaction, input/auth, timestamp replay, concurrency, timeout, heartbeat, WS sau commit và chặn client publish. `./backend/mvnw test` thiếu `TEST_DATABASE_URL` sẽ skip integration suite; dùng lệnh npm ở trên để chạy đầy đủ. Muốn chạy từ máy CI với DB riêng, truyền `TEST_DATABASE_URL` đúng tên `/parking_test` và thông tin POSTGRES tương ứng.

Prototype dùng simple broker trong một instance backend, không dành cho chạy nhiều instance đồng thời. Lịch sử DB chưa có retention tự động; với demo nhỏ giữ toàn bộ, trước khi chạy dài hạn cần đặt chính sách lưu/xóa hoặc archive phù hợp.
