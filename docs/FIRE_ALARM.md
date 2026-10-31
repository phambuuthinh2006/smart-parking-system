# Nhiệt độ / báo cháy — cấu hình đồng bộ firmware

Thông số theo ảnh firmware nhóm cung cấp:

```cpp
const float TEMP_ALARM_ON = 50.0;
const float TEMP_ALARM_OFF = 45.0;
const unsigned long BLINK_INTERVAL = 300;
const bool FIRE_OPENS_GATE = true;
```

## Quy tắc 50/45°C

- Chưa có cảnh báo: **từ 50°C trở lên bật ALARM**.
- Đã có cảnh báo: chỉ khi nhiệt độ **45°C hoặc thấp hơn mới tắt**.
- Khoảng **45 < T < 50°C** giữ trạng thái trước. Vì vậy 47°C có thể NORMAL sau khi nguội hoặc ALARM sau khi đã vượt 50°C.
- LED đổi trạng thái mỗi **300 ms**, chu kỳ sáng/tắt đầy đủ **600 ms**. Với reduced motion, đèn sáng cố định.
- `FIRE_OPENS_GATE=true`: khi cảnh báo đang giữ, tính `gateOpenRequested=true`. UI hiển thị **Gate preview → Open requested**.
- Đây là yêu cầu/preview phần mềm, không xác nhận cổng vật lý đã mở và chưa gửi lệnh điều khiển servo. Muting trên browser không tắt còi trên mạch.

Đây là cấu hình prototype nhóm đưa ra, không phải khuyến nghị ngưỡng phát hiện cháy cho thiết bị khác.

## Chạy demo

```bash
cd /home/phambuuthinh/Downloads/IOT-PROJECT
npm run backend:up
npm run dev
```

Chọn **Device** trên http://localhost:5173. Bật Enable sound để nghe còi web.

Giả lập nhiệt độ tự động:

```bash
npm run temperature:simulate
```

Chu kỳ mỗi 15 giây: **27 → 49 → 50 → 47 → 45°C**. Chỉ chạy một giả lập nhiệt tại một thời điểm.

Muốn tự gửi từng bước, dừng giả lập nhiệt rồi chạy từng dòng:

```bash
npm run temperature:simulate -- --temperature 49 --once
npm run temperature:simulate -- --temperature 50 --once
npm run temperature:simulate -- --temperature 47 --once
npm run temperature:simulate -- --temperature 45 --once
npm run temperature:simulate -- --temperature 47 --once
```

Để bảo đảm bắt đầu từ trạng thái nguội, có thể gửi 27°C trước bước 49°C. Kết quả từ trạng thái nguội: NORMAL → ALARM → ALARM → NORMAL → NORMAL. Gửi mỗi bước trong 45 giây hoặc dùng chế độ gửi lặp để dữ liệu không hết hạn giữa lúc thuyết trình:

```bash
npm run temperature:simulate -- --temperature 50
```

Ctrl+C để dừng. Có thể giữ `npm run device:simulate` cho parking chạy song song; hai sensor có thời hạn độc lập.

### Simulation local

Chọn Simulation → Fire alarm simulation. Mặc định 27°C / ON 50 / OFF 45; có hai thanh chỉnh ngưỡng, luôn giữ OFF < ON. Simulate heat tăng lên ON+10; Cool down đưa về 27°C. Reset khôi phục cả chính sách 50/45/300 và tắt âm thanh.

Simulation chỉ ở React, không ghi DB hoặc thay đổi cấu hình Device. Device là dữ liệu HTTP/PostgreSQL thật, nhưng trong demo HTTP có thể do trình giả lập gửi thay cảm biến thật.

### Vercel

Cần deploy frontend mới; backend đã chạy migration V3, tunnel còn chạy và VITE_BACKEND_URL khớp. Production dùng https://smart-parking-system-drab-kappa.vercel.app. Chọn Device sau khi deployment mới Ready; backend và tunnel trên máy vẫn cần chạy.

## Database / migration

- V2 thêm `temperature_sensor`, `temperature_reading`, `fire_alarm_event`, giữ dữ liệu parking.
- V3 đổi cấu hình hiện tại thành 50/45/300/true, thêm `alarm_active` để giữ trạng thái giữa hai ngưỡng và qua timeout/restart.
- Khi đổi chính sách, sensor hiện tại chuyển UNKNOWN để đợi bản đo mới; ALARM đang được ghi nhận được giữ trong latch.
- Không sửa migration cũ. Lịch sử giữ các ngưỡng của chính sách lúc ghi; bản ghi cũ có thể vẫn là 80°C. Gate request cũ NULL là chưa được ghi nhận lúc đó.
- Mỗi bản đo hợp lệ đều được lưu; event chỉ thêm khi status đổi. Hạ 50 → 47 vẫn ALARM nên không thêm event “cleared”.

DBeaver → Refresh bảng/cột rồi dùng:

```sql
SELECT device_id, value_celsius, threshold_celsius, clear_threshold_celsius,
       blink_interval_ms, fire_opens_gate, alarm_active, status, last_reported_at
FROM public.temperature_sensor;
```

```sql
SELECT id, value_celsius, threshold_celsius, clear_threshold_celsius,
       gate_open_requested, status, recorded_at
FROM public.temperature_reading
ORDER BY id DESC
LIMIT 20;
```

```sql
SELECT id, previous_status, status, value_celsius, threshold_celsius,
       clear_threshold_celsius, gate_open_requested, created_at, source
FROM public.fire_alarm_event
ORDER BY id DESC
LIMIT 20;
```

```sql
SELECT version, description, success
FROM public.flyway_schema_history
ORDER BY installed_rank;
```

Khi UNKNOWN, value_celsius có thể giữ số đo cuối trong DB để tra cứu; API/web che giá trị không còn xác nhận bằng null/“—”. `alarm_active` là latch, độc lập với status UNKNOWN. `gateOpenRequested` trong snapshot tính bằng `fire_opens_gate AND alarm_active`.

## API

POST `/api/device/temperature` với Content-Type JSON và X-Device-Key:

```json
{ "deviceId": "esp8266-01", "temperatureCelsius": 50 }
```

- Contract prototype chấp nhận -40..150°C, tối đa hai số thập phân; đây là giới hạn phần mềm, không phải dải đo được xác minh của sensor.
- Không nhận threshold/status/gate command tùy ý từ client. Backend tính từ trạng thái và cấu hình lưu trong sensor.
- `observedAt` tùy chọn, UTC, tăng đơn điệu, kiểm tra replay/freshness và chuẩn hóa microsecond. Tách riêng timestamp nhiệt và parking.
- GET `/api/temperature/status`, `/api/temperature/readings?limit=20`, `/api/temperature/events?limit=20`; giới hạn danh sách 1–100.
- Snapshot chung GET `/api/parking/status` và STOMP `/topic/parking` qua `/ws` có `temperature`: ON/OFF, blink, fireOpensGate, alarmActive, gateOpenRequested, trạng thái và lịch sử.
- Header key chỉ dành cho mạch/emulator; không đưa key vào frontend/Vercel.

Backend khóa hàng thiết bị chung, lưu dữ liệu trong transaction, tăng revision rồi COMMIT trước khi phát STOMP. Lỗi request rollback toàn bộ, không phát snapshot thành công.

## Mất dữ liệu và latch

- Quá hạn mặc định 45 giây, quét mỗi 5 giây: status UNKNOWN, thêm event TIMEOUT.
- Latch cảnh báo đang bật **không bị xóa vì timeout**. Gate preview giữ yêu cầu mở nhưng ghi unconfirmed khi dữ liệu chưa xác nhận.
- Nhận lại 47°C sau timeout nếu latch đã bật → ALARM; nhận 45°C → NORMAL và bỏ yêu cầu mở do cháy.
- Web không khẳng định UNKNOWN nghĩa là hết cảnh báo. Parking/heartbeat còn chạy không gia hạn sensor nhiệt.
- Còi browser chỉ phát với trạng thái ALARM đã xác nhận, có opt-in và tab đang hiển thị; Unknown/mute/rời panel dừng audio. Latch backend vẫn được giữ.

## Kiểm thử

```bash
npm test
npm run test:backend
npm run build
```

Mã nguồn: TemperatureStore / TemperatureData / TemperatureController, migration V3, temperatureAlarm.js, deviceTemperature.js, FireAlarmPanel và simulate-temperature.mjs. Kiểm thử bao gồm chính xác biên 50/45, giữ trạng thái 47°C từ cả hai hướng, latch/gate qua timeout/restart và nháy 300 ms. Chi tiết bằng chứng trong VERIFICATION.md.
