# Thử nghiệm AUTO: chỉ vào ô mới Inside

Nhánh `experiment/auto-entry-exit`, cùng repo `phambuuthinh2006/smart-parking-system`.
Bản gốc ở nhánh `main` và thư mục `IOT-PROJECT` giữ nguyên. Bản thử nghiệm ở
`/home/phambuuthinh/Downloads/IOT-PROJECT-experiment`.

## Luồng đã chốt

1. Cảm biến cổng thấy xe; camera đọc biển đã đăng ký. Backend chọn ENTRY nếu chưa có lượt hoạt động.
2. Mở cổng. Xe qua, Uno đóng và trả PASSED: backend chuyển **PENDING_PARKING** (chờ vào ô), chưa có giờ Inside.
3. Cảm biến P01 chuyển từ trống hợp lệ sang có xe sau lúc qua cổng: backend mới ghi **Inside** và giờ vào ô.
4. Xe rời ô: P01 báo trống; biển vẫn **Inside**, lưu dấu đã rời ô.
5. Biển xuất hiện trong một lần tới camera mới, cảm biến cổng thấy xe, P01 trống:
   backend chọn EXIT vì xe đang Inside, mở cổng.
6. Cảm biến cổng xác nhận có xe rồi rời vùng, Uno đóng và PASSED: backend ghi **Exited**.

Không đổi ENTRY/EXIT qua lại. Không đánh Inside từ ACK hoặc chỉ từ xe qua cổng vào.
Ô có xe nhưng không có đúng một lượt chờ đỗ sẽ không tự gán biển số.
Giới hạn demo **một xe đang hoạt động / một ô P01** để tránh ghép nhầm cảm biến với biển.

## Chống nhận lặp

Camera giữ cùng `encounterId` dù OCR thay đổi dấu/chữ hay tạm không đọc ra.
Chỉ sinh mã mới sau khi các khung hình thực sự không còn vùng biển số ít nhất2giây
rồi thấy biển trở lại. Backend lưu mã đã dùng, không tạo thêm lượt vào/ra từ cùng mã,
kể cả khi trạng thái đã đổi. Chỉ tiêu thụ mã khi thật sự mở một lượt mới; lỗi mạng/
chờ cảm biến có thể thử lại. Không suy ra xe đã rời hình từ việc OCR đọc sai.

## Tách bản gốc và thử nghiệm

| Thành phần | main | experiment |
| --- | --- | --- |
| Thư mục máy Thịnh | IOT-PROJECT | IOT-PROJECT-experiment |
| Compose project | smart-parking | smart-parking-experiment |
| Web | 5173 | **5175** |
| API host | 18080 | **18081** |
| PostgreSQL host | 55432 | **55439** |
| Docker volume | smart-parking_parking-data | smart-parking-experiment_parking-data |
| Firmware | protocol2 | **protocol3** |

Database thử nghiệm có credentials riêng và bắt đầu với danh sách đăng ký trống.
Không dùng API key của main cho backend thử nghiệm. `.env` và model vẫn ngoàiGit.
Không chạy camera/bridge của cả main và experiment cùng điều khiển một bộ mạch.
Firmware trên cùng bo chỉ có một bản: thử protocol3 sẽ thay bản đang nạp.

## Máy camera: lấy nhánh riêng khi có Internet

Giữ thư mục cũ và tạo thư mục thử nghiệm riêng bằng Git worktree:

```powershell
git fetch origin
git worktree add ../smart-parking-experiment origin/experiment/auto-entry-exit
```

Lệnh chạy trong repo cũ. Worktree mới ở detached HEAD của nhánh remote, đủ để thử;
muốn cập nhật sau đó, khi không có sửa local, chạy trong worktree mới:

```powershell
git fetch origin
git merge --ff-only origin/experiment/auto-entry-exit
```

Hoặc clone repo vào thư mục mới với `--branch experiment/auto-entry-exit`.
Không switch thư mục cũ sang nhánh này nếu muốn giữ bộ file main nguyên tại chỗ.
Copy `best.pt` của nhóm vào `Project/Camera` trong thư mục thử nghiệm.

## Nạp hai firmware thử nghiệm

- Uno: `Project/SmartParking_Uno/SmartParking_Uno.ino`, giữ cả **GateCycle.h và SlotSensor.h** cạnh sketch.
- ESP8266: `Project/SmartParking_ESP8266/SmartParking_ESP8266.ino`.
- Chân nối giữ nguyên: Uno D2←ESP TX, Uno D3→hạ mức3.3V→ESP RX, chungGND.
- Cảm biến cổng TRIG7/ECHO8; cảm biến ô đỗ TRIG5/ECHO6.
- `/status` cần `protocolVersion:3`, `telemetryValid:true`, `sampleAgeMs<=2000`,
  thêm `gatePresent`, `gateSensorValid`, `slotSensorValid` và `slot` (AVAILABLE/OCCUPIED/UNKNOWN).
- Uno bật ô có xe sau3mẫu dưới15cm, ô trống sau3mẫu từ18cm trở lên. Vùng15–18cm giữ trạng thái;
  mất echo/ngoài tầm400cm là UNKNOWN. Cần nền phản xạ khi ô trống.
- Cổng giữ logic có xe dưới15cm; đóng sau3mẫu vùng trống hợp lệ và mở ít nhất1.2s.
  Không đóng theo timeout25s nếu xe/cảm biến còn lỗi. Chờ xe30s không đến thì hủy lượt chờ cổng.

**Đây là mô hình:** một cảm biến cổng chỉ biết xe rời vùng, không phân biệt xe qua với xe lùi.
Hai biển trước/sau cùng số; camera phải nhìn được vùng chờ cả hai chiều.

## Máy web: chạy đúng thư mục thử nghiệm

Lần đầu hoặc build source mới, khi có Internet:

```bash
cd ~/Downloads/IOT-PROJECT-experiment
npm ci
npm run backend:up
```

`backend:init` tạo `.env` với key riêng nếu chưa có. Đặt `API_BIND_ADDRESS=0.0.0.0`
để laptop camera truy cập. Giữ `API_PORT=18081`, `POSTGRES_PORT=55439`.
Trên máy Thịnh bản local đã được chuẩn bị; khi dùng Wi-Fi mạch chỉ cần:

```bash
cd ~/Downloads/IOT-PROJECT-experiment
docker compose up -d --no-build --pull never
npm run dev
```

Mở **http://localhost:5175**, mặc định Device. Có nhãn THỬ NGHIỆM trên đầu trang.
Không nhầm webmain5173. Web thử nghiệm proxy tới API18081.

## Cấu hình máy camera thử nghiệm

Tạo `.env` cạnh `main.py` trong Camera của thư mục thử nghiệm:

```dotenv
DEVICE_BACKEND_URL=http://IP_MAY_THINH:18081
DEVICE_API_KEY=KEY_BACKEND_THU_NGHIEM
ESP32_URL=http://192.168.4.1
PARKING_DIRECTION=AUTO
```

Lấy key từ `.env` gốc **IOT-PROJECT-experiment**, không lấy từ main.
Máy Thịnh đã có sẵn `Project/Camera/.env` thử nghiệm để chép riêng nếu IP máy web
vẫn192.168.4.2. Không đưa file chứa key lên Git.
Sau khi cả hai máy cùng Wi-Fi mạch, kiểm tra IP máy web bằng `ip -brief -4 address`.
Trên máy camera mở `http://IP_MAY_THINH:18081/api/camera/latest` phải hiện JSON.

Tại Camera thử nghiệm, cài thư viện một lần khi có Internet:

```powershell
python -m pip install ultralytics opencv-python easyocr
```

Đăng ký biển thật của xe vào database thử nghiệm, ví dụ:

```powershell
python web_link.py --register "36H-123.45"
python main.py --source 1
```

Chỉ chạy **một** main.py. Không chạy bridge/main.py ở thư mục cũ cùng lúc.
Đợi `Connected: backend + fresh Uno telemetry`, rồi mới đưa xe tới.
Phải có ô P01 trống hợp lệ và cảm biến cổng thấy xe thì AUTO mới duyệt lượt vào.

## Kiểm tra demo

1. Ban đầu ô trống, camera chưa thấy xe.
2. Đưa xe tới: ENTRY_PENDING→mở→đi qua→đóng→**chờ vào ô**, Inside vẫn0.
3. Đưa xe vào ô: webP01OCCUPIED, Inside1.
4. Đưa xe rời ô: P01AVAILABLE, Inside vẫn1.
5. Đưa xe tới cổng; xe đã khuất camera ít nhất2s giữa hai lần: EXIT_PENDING→mở.
6. Xe qua và cổng đóng: Exited1, Inside0. Không bấm Confirm passage.

Nếu xe đứng trong cùng một lần camera thấy biển, backend trả ENCOUNTER_USED.
Nếu qua cổng mà chưa tới ô, WAITING_PARKING; không mở lượt ra cho xe chưa Inside.
Nếu đang Inside nhưng ô chưa trống, SLOT_STILL_OCCUPIED.
UNKNOWN hoặc dữ liệu cũ không được tạo Inside/Exited. Chỉ P01 có cảm biến;
P02–P04 trên dashboard chưa gắn cảm biến, giữ UNKNOWN.

## Quay về bản gốc

1. Nhấn q dừng camera thử nghiệm, dừng terminal Vite5175.
2. Trong thư mục thử nghiệm: `docker compose stop` (giữ database thử nghiệm).
3. Nạp lại Uno và ESP từ thư mục/nhánh main (protocol2).
4. Dùng lại Camera/.env main (API18080/keymain), webmain5173.

Không cần sửa hoặc reset code main. Không chạy migrationV7 lên database main.

## Kiểm thử

Các test Java dùng parking_test trong container PostgreSQL thử nghiệm, không dùng database thật.

```bash
npm run test:backend
npm test
python3 -m unittest discover -s Project/Camera -p 'test*.py' -v
```

Compile cả hai sketch trong Arduino IDE trước khi upload. Chưa có kiểm chứng trên mạch/
webcam thật trong lần triển khai thử nghiệm; không tự nạp hoặc điều khiển mạch từ máy Thịnh.
