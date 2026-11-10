# Setup tự động: Camera → Backend → ESP8266 → Uno

## Hai máy làm gì?

- **Máy Thịnh (web):** chạy PostgreSQL, backend và web local.
- **Máy bạn (camera):** cắm webcam, chạy `main.py`. Script này chạy cả nhận diện và cầu nối.
- **Mạch:** Uno đọc cảm biến/điều khiển servo, ESP8266 phát Wi-Fi và chuyển lệnh/phản hồi.
- Tên Wi-Fi vẫn là `SMART_PARKING_ESP32` dù bo mạng dùng ESP8266.

```text
Camera → Python → Backend kiểm tra đăng ký → Python bridge → ESP → Uno mở cổng
Web ← Backend ghi lượt tự động ← Python bridge ← ESP ← Uno kết thúc chu kỳ
```

## 1. Cập nhật đúng bộ code và nạp lại cả hai bo

**Firmware cũ không hỗ trợ hoàn tất lượt tự động. Phải nạp lại cả Uno và ESP8266.**

- Uno: mở `Project/SmartParking_Uno/SmartParking_Uno.ino`, chọn Arduino Uno rồi Upload.
  Giữ `GateCycle.h` trong cùng thư mục sketch, không chép riêng mỗi file `.ino`.
- ESP8266: mở `Project/SmartParking_ESP8266/SmartParking_ESP8266.ino`, chọn đúng board
  (NodeMCU 1.0 ESP-12E nếu dùng NodeMCU), rồi Upload.
- Xem sơ đồ chân trong [Project/README_HARDWARE.md](Project/README_HARDWARE.md).
- UART 9600 baud: ESP TX → Uno D2; Uno D3 → hạ mức 5V xuống 3.3V → ESP RX; chung GND.
- Không nhầm cảm biến chỗ đỗ với cảm biến trước barie (Uno TRIG D7, ECHO D8).

Chuẩn bị thư viện Arduino/core trước khi chuyển sang Wi-Fi không có Internet.
Không cần nạp firmware root `SmartParking/` cho cấu hình Uno + ESP8266 này.

## 2. Chuẩn bị máy camera

Chép cả thư mục `Project/Camera` mới sang máy camera; giữ `.env` và `best.pt` riêng
của nhóm. Không dùng lẫn `main.py`, `web_link.py`, `gate_link.py` cũ/mới.

Tại terminal trong thư mục `Camera`, khi còn Internet:

```powershell
python -m pip install ultralytics opencv-python easyocr
```

EasyOCR có thể tải model lần đầu. `best.pt` phải đặt cạnh `main.py`, model không có
trên GitHub. Máy chỉ chạy web không cần cài các thư viện Python này.

## 3. Chuẩn bị backend lần đầu (khi còn Internet)

Trên máy web, terminal tại gốc dự án:

```bash
npm ci
npm run backend:up
```

Đây là lệnh build lần đầu hoặc khi cập nhật backend, cần Internet để tải dependency/image.
Trên máy Thịnh, backend tự động mới đã được đóng gói và khởi động local trong lần sửa này.
Không chạy lại lệnh build khi đang dùng Wi-Fi mạch không có Internet.

Trong `.env` gốc, giữ nguyên key/mật khẩu và bảo đảm:

```dotenv
API_BIND_ADDRESS=0.0.0.0
API_PORT=18080
DEVICE_BACKEND_URL=http://127.0.0.1:18080
```

`ACCESS_SIMULATION_ENABLED=true` chỉ cần cho các nút điều khiển thủ công/demo;
API phản hồi tự động dùng key riêng, không phụ thuộc bật simulation.

## 4. Cả hai laptop nối Wi-Fi mạch

Cấp nguồn Uno/ESP. Kết nối cả hai máy với `SMART_PARKING_ESP32`.
Mật khẩu trong firmware hiện tại: `12345678`. Giữ kết nối dù hệ điều hành báo không có Internet.

Mở trên cả hai máy:

```text
http://192.168.4.1/status
```

Phải thấy `protocolVersion: 2`, `telemetryValid: true` và `sampleAgeMs <= 2000`.
Nếu protocol khác/không có: đang chạy firmware cũ. Nếu telemetry không hợp lệ:
kiểm tra cả hai firmware, UART và nguồn. JSON trả về không đồng nghĩa Uno đang hoạt động.

Đưa vật trước cảm biến barie: kiểm tra `gateDistance` thay đổi và `gateSensorValid: true`.
Đặt một nền phản xạ phía sau đường xe, trong tầm đo tối đa 400 cm: khi không có xe,
cảm biến phải đo được khoảng cách từ 15 cm trở lên. Không có echo được coi là lỗi,
**không phải vùng trống**.

## 5. Máy web: khởi động offline và lấy IP

```bash
cd ~/Downloads/IOT-PROJECT
docker compose up -d --no-build --pull never
ip -brief -4 address
```

Lấy IP dòng `wlan0`. Kết quả cuối người dùng cung cấp là **192.168.4.2**,
nhưng có thể đổi sau khi nối lại Wi-Fi. Không lấy IP Docker hoặc `127.0.0.1`.

Mở `http://localhost:5173`. Nếu web chưa chạy thì mở terminal riêng tại gốc dự án:

```bash
npm run dev
```

Giữ terminal Vite mở. Nếu cổng 5173 đã dùng, kiểm tra web đang chạy trước, không
mở thêm nhiều bản Vite. Dùng web local trước; Vercel không tự nối backend laptop.
Nếu đã cấu hình `VITE_BACKEND_URL` trỏ backend khác thì bỏ nó và chạy lại Vite để dùng proxy local.

## 6. Máy camera: cấu hình Camera/.env

Đặt file tên chính xác `.env`, không phải `.env.txt`, cạnh `main.py`:

```dotenv
DEVICE_BACKEND_URL=http://192.168.4.2:18080
DEVICE_API_KEY=THAY_BANG_KEY_BACKEND
ESP32_URL=http://192.168.4.1
PARKING_DIRECTION=ENTRY
```

- Thay key bằng `DEVICE_API_KEY` trong `.env` gốc máy web. Không đưa key vào frontend/Git.
- Nếu IP máy web khác `.2`, thay URL bằng IP thật.
- `ENTRY` cho camera lối vào, `EXIT` cho lối ra. Không tự suy đoán hướng chỉ từ biển số.
- Sau khi chỉnh phải khởi động lại Python.
- Biến môi trường hệ thống ưu tiên hơn `Camera/.env`, rồi tới `Project/.env` và `.env` gốc.

Trên trình duyệt máy camera, mở:

```text
http://192.168.4.2:18080/api/camera/latest
```

Phải hiện JSON. Nếu không: kiểm tra IP, hai máy cùng Wi-Fi, Docker publish cổng18080
ra LAN và firewall cho phép TCP18080 trên mạng demo. Giữ firewall hoạt động.

## 7. Đăng ký xe trước

Terminal thư mục `Camera`, dùng biển thật trên xe (ví dụ):

```powershell
python web_link.py --register "36H-123.45"
```

Phải báo đăng ký thành công và biển xuất hiện trên web. Đây cũng là kiểm tra API key.
Biển chưa đăng ký hoặc OCR sai không được mở cổng.

## 8. Chạy tự động

Dừng các bản `main.py`/`gate_link.py`/bridge cũ. Chỉ chạy một lệnh trên máy camera:

```powershell
python main.py --source 1
```

Nếu webcam không đúng, dùng `--source 0` hoặc số thiết bị thật. Linux có thể dùng
`--source /dev/video2` sau khi xác định đúng thiết bị. Chạy từ thư mục chứa `best.pt`.

Đợi cầu nối kết nối backend và nhận telemetry Uno hợp lệ rồi mới đưa xe tới quét.
Không chạy thêm `gate_link.py` hay `demo/esp32_bridge.py` cùng lúc.
Cầu nối không tự phát lại yêu cầu cũ đã tồn tại trước lúc khởi động. Nếu còn lượt
chờ từ phiên cũ, kiểm tra vùng trống và xử lý bằng điều khiển thủ công trên web,
rồi tạo lần quét mới.

## 9. Chu kỳ tự động của mô hình

1. OCR gửi biển lên backend. Backend kiểm tra đăng ký, lượt xe và sức chứa.
2. Backend duyệt → yêu cầu mới có mã `requestId` → bridge gửi ESP → Uno nhận đúng mã.
3. Uno xác nhận xe trước barie dưới 15 cm qua 3 mẫu liên tiếp → mở servo.
4. Khi có 3 mẫu khoảng cách hợp lệ từ 15 cm trở lên và đã mở ít nhất 1.2 giây,
   Uno đóng servo rồi báo `PASSED` kèm đúng mã yêu cầu.
5. Bridge gửi phản hồi có API key → backend kiểm tra mã/version/lượt → ghi giờ vào/ra
   **một lần**, đưa barie yêu cầu về CLOSED và cập nhật web. **Không cần bấm Confirm passage.**

Web hiển thị phản hồi Uno riêng với yêu cầu backend. Đây là trạng thái servo do
firmware báo, không có cảm biến đo góc servo thực tế.

Nếu sau 30 giây chờ không thấy xe: Uno báo `CANCELLED`, backend hủy lượt chờ,
không tính xe đã qua. Nếu đang mở mà cảm biến mất echo: `BLOCKED`, giữ cổng,
không ghi lượt. Bản mới bỏ ép đóng sau 25 giây khi vẫn có xe/lỗi cảm biến.
Các nút tay nằm trong **Điều khiển thủ công / xử lý sự cố**, không cần dùng trong chu kỳ bình thường.

### Giới hạn một cảm biến

`PASSED` chỉ là suy luận **xe rời vùng cảm biến** trên mô hình. Xe lùi lại cũng có
thể bị ghi là qua. Nó không chứng minh vùng ngay dưới thanh chắn an toàn; cần hai
cảm biến/trình tự hướng hoặc cảm biến chống kẹp để làm bãi xe thực. Thử mô hình có
người giám sát. Không coi mất echo hoặc ACK nhận lệnh là bằng chứng xe đã qua.

### Thử lượt ra

Biển đã INSIDE sẽ không được ghi thêm lượt ENTRY. Đặt `PARKING_DIRECTION=EXIT`,
lưu rồi khởi động lại camera để thử lượt ra; xác nhận chu kỳ tự cập nhật EXITED.
Sau đó đổi lại ENTRY nếu cần thử lượt vào mới.

## 10. Tra lỗi nhanh

| Hiện tượng | Kiểm tra |
| --- | --- |
| Log lỗi tại backend | URL/IP, backend18080, cùng Wi-Fi, key |
| Log lỗi tại ESP /status / Uno telemetry | Nạp cả hai bo protocol2, UART9600/chungGND, sampleAgeMs |
| Firmware protocolVersion2 nhưng telemetryValidfalse | Uno chưa gửi đủ frame mới hoặc UART lỗi |
| OPEN ACK nhưng servo không mở | gateDistance <15 cm hợp lệ/3mẫu, dây servo, nguồn, UART |
| BLOCKED / không đóng | Sensor mất echo/ngoài tầm; cần nền phản xạ và tín hiệu đo hợp lệ |
| ENTRY_PENDING cũ sau restart | Bridge bỏ yêu cầu cũ; xử lý lượt chờ rồi tạo lần quét mới |
| ALREADY_INSIDE | Xe đã vào; thử EXIT, không đăng ký lại để né lượt cũ |
| STALE_CYCLE | Phản hồi không khớp lượt/version hiện tại, không tự ghi lượt |
| 404 /device/barrier-feedback | Backend vẫn bản cũ, cần cập nhật backend |
| Nhiệt độ/ô đỗ web vẫn offline | Bridge này mới đồng bộ barie và lượt xe, chưa gửi toàn bộ cảm biến ô đỗ/nhiệt độ |

## 11. Dừng và kiểm chứng

Nhấn `q` ở cửa sổ camera để dừng. Không tự phát lệnh đóng khi thoát/mất mạng.
Quan sát mô hình và xử lý vùng barie trước khi ngắt nguồn.

Đã kiểm thử API trên PostgreSQL riêng, cầu nối với HTTP giả lập, state machine
C++, frontend và biên dịch hai firmware. Chưa nạp board hoặc thử toàn bộ camera/
servo thật trong lần sửa này. Không có thao tác điều khiển mạch thật được thực hiện tự động.
