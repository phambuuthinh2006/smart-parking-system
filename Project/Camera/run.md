# Camera Project → web → ESP32 SmartParking

Phần YOLO/EasyOCR và cảm biến/firmware `Project/SmartParking` giữ nguyên. `main.py` chỉ thêm gửi `plate_text` sau khi OCR đọc xong; gửi HTTP ở thread riêng để không chặn camera.

## Chuẩn bị web/backend

Tại gốc `/home/phambuuthinh/Downloads/IOT-PROJECT`:

```bash
npm run backend:up
npm run dev
```

Mở `http://localhost:5173`. Khối **Camera · Biển số vừa quét** cập nhật mỗi giây và hiện biển số/kết quả đăng ký, kể cả khi dashboard đang ở Simulation.

`.env` tại gốc cần `DEVICE_BACKEND_URL=http://127.0.0.1:18080` và `DEVICE_API_KEY` đã cấu hình backend. Các script tự đọc file này, không cần chép key vào code. Backend local đã được build lại với migration V5. Danh sách đăng ký khởi đầu rỗng; không tự đăng ký xe từ một lần quét.

## Đăng ký biển số

```bash
cd /home/phambuuthinh/Downloads/IOT-PROJECT/Project/Camera
python3 web_link.py --register '43A-123.45'
```

Lệnh này ghi đăng ký vào PostgreSQL qua API có key; web sẽ hiện danh sách đã đăng ký. Dùng biển thật của bạn thay ví dụ. Tắt đăng ký:

```bash
python3 web_link.py --disable '43A-123.45'
```

Để chỉ thử gửi chuỗi lên web, chưa cần webcam/YOLO:

```bash
python3 web_link.py --send '43A-123.45'
```

**Lệnh thử cũng là một nhận diện gửi tới backend**: nếu hợp lệ/đã đăng ký và gate link đang chạy, nó có thể yêu cầu mở cổng. Không chạy gate link khi chỉ muốn kiểm tra giao diện.

## Chạy camera gốc

File model `best.pt` được giữ local và không đưa lên GitHub. Sau khi clone repo, copy model của nhóm vào `Project/Camera/best.pt`.

Từ thư mục `Project/Camera` (để tìm đúng best.pt):

```bash
pip install ultralytics opencv-python easyocr
python3 main.py
```

Giữ nguyên model, webcam0, YOLO conf0.5, tiền xử lý ảnh, EasyOCR/allowlist và hình hiển thị. Cầu nối gửi nguyên chuỗi OCR; cùng một chuỗi gửi tối đa một lần mỗi3giây để tránh ngập HTTP. Không thêm thuật toán lọc/đồng thuận hoặc tự bịa confidence. Camera tiếp tục chạy nếu HTTP lỗi; lần đọc tiếp theo gửi dữ liệu mới thay vì phát lại ảnh cũ sau mất mạng.

Backend chuẩn hóa dấu cách/chấm/gạch khi so với danh sách đăng ký, kiểm tra format và trạng thái lượt xe/capacity. OCR sai định dạng hiện INVALID_PLATE; biển chưa đăng ký/đã bị tắt hiện NOT_REGISTERED, không tạo yêu cầu mở. Camera không tự đăng ký biển mới.

Hướng mặc định ENTRY. Để chạy camera lối ra:

```bash
PARKING_DIRECTION=EXIT python3 main.py
```

Hướng được cấu hình theo vị trí camera, không suy đoán từ biển số. Giờ vào/ra chỉ ghi sau khi người vận hành xác nhận xe qua; nhận diện không chứng minh xe đã qua.

## Nối ESP32

Nạp firmware `Project/SmartParking` như nhóm đang dùng, laptop kết nối AP ESP32. Trong terminal riêng, vẫn ở `Project/Camera`:

```bash
python3 gate_link.py --esp-url http://192.168.4.1
```

Gate link chỉ chuyển yêu cầu web mới sang `/open` hoặc `/close?clear=true`, không sửa firmware và không tính lại logic cảm biến. Khởi động bridge **trước** khi quét xe. Lệnh cũ trước startup/kết nối lại được bỏ qua, không tự đóng khi mất kết nối/Ctrl+C. Chỉ chạy một gate link; không chạy đồng thời adapter `demo/esp32_bridge.py`.

Firmware gốc phản hồi COMMAND_RECEIVED: chỉ xác nhận đã nhận lệnh, chưa chứng minh servo đã mở/đóng. `/status.gate` của firmware gốc chưa phản ánh đúng trạng thái, nên gate link không dùng trường này để đo cổng. Nếu dùng bản root SmartParking đã cập nhật, script cũng chấp nhận APPLIED và tự đọc ESP32_API_KEY từ .env.

## Khi nào đóng cổng?

Với phần cứng hiện tại: **người vận hành nhìn thấy xe đã qua hẳn và vùng dưới barie trống**. Trên web chọn Device → Vehicle access, tick **Vehicle has passed; the barrier area is clear**, rồi **Confirm passage**. Backend ghi giờ vào/ra và gate link gửi đóng. Cancel / close cần cùng xác nhận nhưng hủy lượt chờ.

Không đóng chỉ vì OCR mất biển hoặc hết một số giây: xe có thể đang đứng dưới thanh chắn. Muốn tự đóng cần thêm cảm biến qua cổng/phát hiện vật cản và xác nhận trình tự xe tới → qua → vùng trống. Cảm biến đang đo ô đỗ không thay được tín hiệu này.

Trong .env cần `ACCESS_SIMULATION_ENABLED=true` cho các nút operator hiện có; restart backend sau khi đổi. Đây là tên cấu hình cũ được giữ tương thích. Backend detection (kể cả nút demo) kiểm tra đăng ký; **Request open là thao tác mở thủ công của người vận hành**. Khi gate link đang chạy, các yêu cầu này có thể tác động servo thật. Giữ web/backend trong môi trường demo được kiểm soát.

Theo yêu cầu, firmware `Project/SmartParking` không bị sửa: các giới hạn sensor lỗi/cháy/trạng thái cổng của bản gốc vẫn còn. Cơ chế này chưa có cảm biến chống kẹp hoặc phản hồi vị trí servo; xác nhận bằng tay là phương án demo có người giám sát.

## Kiểm tra phần kết nối

```bash
python3 -m unittest discover -s . -p 'test*.py' -v
```

Đã thử API/DB, upload HTTP bằng server giả lập, giao diện và cổng bằng yêu cầu giả lập; chưa chạy camera/model hoặc điều khiển board thật trong lần cập nhật này. Dữ liệu đăng ký lưu lâu dài; khối camera hiển thị lần đọc cuối, không tự suy ra camera còn online từ một bản ghi cũ.

Kết quả kiểm tra 08/11/2026: 25Java integration/unit tests (HTTP/PostgreSQL) + 22Node + 3ProjectPython + 9demoPython PASS; production build PASS; browser mobile360/desktop1280 và web/backend local5173/18080 PASS. Backend local đã cập nhật V5, không thêm đăng ký/biển số thử vào dữ liệu thật. Chưa xác minh bản frontend trên Vercel.
