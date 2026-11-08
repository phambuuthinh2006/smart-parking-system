# ESP32 phát Wi-Fi, laptop chạy web/camera và gửi lệnh mở cổng

## Luồng đã nối

Laptop kết nối AP `SMART_PARKING_ESP32`. React, Spring Boot/PostgreSQL và Python/camera chạy local trên laptop. Camera gửi nhận diện tới backend; backend kiểm tra format, confidence, lượt xe, capacity rồi thay đổi trạng thái yêu cầu barie. `demo/esp32_bridge.py` đọc yêu cầu mới và gửi HTTP tới ESP32. Firmware áp dụng setpoint servo và phản hồi `APPLIED`.

Bridge cũng đưa siêu âm về một ô (mặc định P01), nhiệt độ hợp lệ về backend. ID backend `esp8266-01` được giữ để tương thích database/dashboard hiện có; phần cứng thực tế là ESP32. Ba ô chưa có cảm biến không được tạo dữ liệu giả.

Đây là bản chạy có người giám sát: **không có cảm biến xác nhận xe qua hoặc vị trí servo**. Trạng thái trên web là yêu cầu nghiệp vụ; dòng trạng thái trong terminal bridge là setpoint firmware đã áp dụng, không chứng minh servo đã tới góc hoặc xe đã qua. Các lượt xe được ghi theo xác nhận của người vận hành, độc lập với ACK phần cứng.

## Cấu hình và nạp firmware

Trong workspace hiện tại đã tạo riêng `SmartParking/Config.h` và thêm `ESP32_API_KEY`, `ESP32_URL`, `DEVICE_BACKEND_URL` vào `.env`; không in credential vào log. Hai file được Git bỏ qua. Mở Config.h bằng editor để xem mật khẩu AP khi kết nối laptop.

Với checkout mới:

1. Copy `SmartParking/Config.example.h` thành `SmartParking/Config.h`.
2. Đặt mật khẩu AP riêng (8–63 ký tự), API key ngẫu nhiên riêng ít nhất 24 ký tự. Firmware từ chối bật HTTP với placeholder.
3. Copy các mục ESP32 từ `.env.example` sang `.env`, đặt `ESP32_API_KEY` trùng `PARKING_API_KEY` trong Config.h. `DEVICE_API_KEY` là key backend, khác key ESP32.
4. Arduino IDE: cài **esp32 by Espressif Systems 3.3.4** và **ESP32Servo 3.2.1**, mở `SmartParking/SmartParking.ino`, chọn board phù hợp. Code chân hiện tại dành cho ESP32 classic (ví dụ ESP32 Dev Module), không mặc định áp dụng cho C3/S3.
5. Compile rồi upload bằng cổng USB của board. Serial 115200 in IP AP; mặc định thường `192.168.4.1`. Nếu khác, sửa ESP32_URL.

Giữ nguyên chân: TRIG5/ECHO18, servo13, buzzer12, LDR34, NTC35, LED2/4. Kiểm tra cách mắc cầu chia NTC và hiệu chuẩn thực tế; công thức hiện giả định NTC nối phía nguồn, R_FIXED xuống GND. HC-SR04 ECHO phải hạ mức 5V về mức ESP32; servo cần nguồn phù hợp và chung GND. GPIO12 là chân boot strap trên ESP32 classic, mạch buzzer không được kéo sai mức khi boot.

## Chạy trên laptop

Tại gốc repo, chuẩn bị dependencies, Docker images và model OCR trước khi chuyển sang AP vì AP không cấp Internet. Backend URL cho bridge phải là `http://127.0.0.1:18080` nếu dùng local; trình duyệt mở web local để không phụ thuộc Vercel/tunnel.

```bash
npm run backend:up
npm run dev
```

Backend controls cần `ACCESS_SIMULATION_ENABLED=true` trong `.env` nếu muốn dùng nút trên web. Chạy lại `npm run backend:up` sau khi đổi cấu hình. Tên biến và endpoint simulation được giữ để tương thích; **khi bridge đang chạy, những thay đổi này có thể làm servo thật di chuyển**. Local Simulation Mode của React chỉ đổi state trong trình duyệt và không gửi lệnh phần cứng.

Kết nối laptop vào AP ESP32, rồi trong terminal riêng:

```bash
python3 demo/esp32_bridge.py
```

Bridge phải chạy **trước** khi tạo nhận diện/lệnh mới. Khi khởi động hoặc kết nối lại, nó lấy version hiện tại làm mốc và bỏ qua lệnh tồn từ trước. Không tự đóng khi mất kết nối hoặc khi Ctrl+C. Nếu lệnh bị timeout, kiểm tra trạng thái và thao tác lại có chủ đích; bridge không tự phát lại lệnh đóng.

Trong terminal khác, chạy camera đã chuẩn bị theo `docs/VEHICLE_ACCESS.md`:

```bash
demo/.venv/bin/python demo/main.py --source 0 --direction ENTRY
```

Mở `http://localhost:5173`, chọn **Device → Vehicle access**. Có thể dùng nút tạo detection để thử có người giám sát. Backend hiện yêu cầu biển số đã đăng ký trước khi nhận detection, ngoài kiểm tra lượt/capacity. Xem Project/Camera/run.md để đăng ký biển qua API có key.

Sau khi xe qua hoàn toàn, kiểm tra vùng dưới barie đã trống, tick **Vehicle has passed; the barrier area is clear**, rồi **Confirm passage**. Backend ghi lượt và yêu cầu đóng; bridge gửi `/close?clear=true`. **Cancel / close** cũng cần xác nhận vùng trống nhưng hủy lượt chờ thay vì ghi xe đã qua. Khi có thay đổi version hoặc fire override, checkbox được xóa để yêu cầu xác nhận lại.

Không chạy `device:simulate`/`temperature:simulate` đồng thời với bridge vì cùng ghi sensor backend. Nút tạo detection và dữ liệu cháy phía backend có thể điều khiển phần cứng khi bridge đang bật; chỉ dùng với board demo có người giám sát.

## Chính sách lỗi và cháy

- Siêu âm timeout/ngoài dải: `UNKNOWN`, distance `null`; không báo trống.
- NTC lỗi/ngoài -40..150°C: temperature `null`, `temperatureValid=false`. Firmware chặn đóng và giữ alarm đang bật. Bridge không gửi số nhiệt giả; web đổi nhiệt sang UNKNOWN sau timeout backend (mặc định45s), trong khi terminal hiển thị lỗi ngay ở lần poll kế tiếp.
- Cháy ON>=50/OFF<=45°C, giữ latch ở khoảng giữa; LED nháy300ms và buzzer hoạt động. Cháy mở cổng và chặn đóng.
- Hạ nhiệt không tự đóng cổng. Alarm và setpoint mở được lưu NVS khi đổi trạng thái để phục hồi qua reboot; NTC lỗi không xóa latch. Không thay thế một bộ điều khiển cháy chuyên dụng.
- Nếu sau cháy web đã CLOSED nhưng ESP32 vẫn OPEN, tạo **Request open** mới rồi sau khi xác nhận vùng trống mới **Cancel / close**. Không dùng việc hạ nhiệt làm bằng chứng xe đã qua.
- Một bridge điều khiển một ESP32. Không chạy nhiều bridge/nguồn lệnh đồng thời. API không đo được vật cản; xác nhận bằng người vận hành không thay thế cảm biến chống kẹp.

## HTTP ESP32

`GET /status`, `GET /slot`, `POST /open`, `POST /close?clear=true` đều cần header `X-Device-Key` với key ESP32. Không đưa key lên frontend. Python gọi trực tiếp từ laptop nên không cần browser CORS tới ESP32. `/status.gate` là setpoint; `positionFeedback=false` chỉ rõ không có cảm biến vị trí. Sensor được cập nhật mỗi250ms; `sampleAgeMs` giúp bridge loại dữ liệu cũ.

## Kiểm chứng

```bash
python3 -m unittest discover -s demo -p 'test*.py' -v
g++ -std=c++11 -Wall -Wextra -Werror tests/firmware/gate_logic.cpp -o /tmp/iot-gate-test
/tmp/iot-gate-test
npm test
npm run build
```

Python kiểm tra HTTP thật trên localhost với server ESP32/backend giả lập: sensor mapping, camera-request state→open, operator passage→close, key tách biệt, fault/stale và không phát lại lệnh. C++ kiểm tra hysteresis/ưu tiên cháy/lỗi cảm biến/xác nhận đóng. Browser kiểm tra checkbox bắt buộc, reset sau thao tác và layout mobile/desktop bằng API giả lập, không ghi backend thật.

Kết quả kiểm tra 08/11/2026: 9 Python tests + 22 Node tests PASS; C++ gate logic PASS; Vite production build PASS; Chromium mobile360/desktop1280 PASS. Firmware compile bằng Arduino CLI, `esp32:esp32:esp32`, core3.3.4 + ESP32Servo3.2.1 PASS: flash964119/1310720bytes (73%), RAM46128/327680bytes (14%). Toolchain kiểm thử được cài trong thư mục tạm tách khỏi Arduino IDE; IDE vẫn cần cài board/library như hướng dẫn trên.

Chưa nạp hoặc chạy trên board thật; chưa kiểm chứng camera/model, nguồn servo, góc cơ khí hay chống kẹp. Cần thử trên mô hình trước khi kết luận phần cứng hoạt động.
