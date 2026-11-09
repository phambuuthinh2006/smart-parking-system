# Hướng dẫn chạy Camera AI & Kết nối Hệ thống Đỗ xe

Hệ thống giữ nguyên toàn bộ mô hình YOLO (`best.pt`), EasyOCR và thuật toán tiền xử lý ảnh.
Các module HTTP đã được tích hợp chạy ngầm bên trong `main.py`, bạn **chỉ cần chạy đúng 1 lệnh duy nhất**!

---

## 1. Cài đặt thư viện (chỉ cần chạy 1 lần)
Mở terminal tại thư mục `Project/Camera`:
```bash
pip install ultralytics opencv-python easyocr
```

---

## 2. Cấu hình IP và Key trong file `.env`
Mở file `Project/Camera/.env` và cập nhật:
- `DEVICE_BACKEND_URL`: Địa chỉ Backend trên Laptop 1.
  - Khi cả 2 laptop kết nối vào Wi-Fi ESP32 (`SMART_PARKING_ESP32`), mở Command Prompt trên Laptop 1 gõ `ipconfig` để lấy địa chỉ IPv4 của Wi-Fi (thường là `192.168.4.2`).
  - Điền: `DEVICE_BACKEND_URL=http://192.168.4.2:18080` (hoặc `http://127.0.0.1:18080` nếu Camera chạy chung trên cùng laptop với Web).
- `DEVICE_API_KEY`: Lấy chuỗi key từ file `.env` của `smart-parking-system` trên Laptop 1 dán vào đây.

---

## 3. Khởi chạy Camera
Đảm bảo Laptop đã kết nối vào mạng Wi-Fi của ESP32 (`SMART_PARKING_ESP32`).
Sau đó chạy lệnh:
```bash
python main.py
```

### Các tính năng tự động hoạt động:
1. Mở cửa sổ Webcam quét xe và nhận diện biển số theo thời gian thực.
2. Khi OCR đọc được biển số, luồng ngầm tự động gửi HTTP POST lên Web Backend.
3. Luồng Gate Link chạy ngầm tự động lắng nghe lệnh mở cổng từ Web:
   - Khi Backend duyệt mở cổng -> Gửi tín hiệu sang ESP32.
   - Khi ESP32 nhận lệnh VÀ cảm biến siêu âm phát hiện có xe phía trước -> Barrier tự động mở.
   - Khi xe đi qua khỏi tầm cảm biến -> ESP32 tự động đóng barrier!
4. Nhấn phím `q` trên cửa sổ video để tắt camera an toàn.

---

## 4. Công cụ phụ trợ (Tùy chọn)
- Đăng ký trước một biển số vào hệ thống qua dòng lệnh:
  ```bash
  python web_link.py --register "43A-123.45"
  ```
- Hủy kích hoạt biển số:
  ```bash
  python web_link.py --disable "43A-123.45"
  ```
- Thử gửi một biển số lên web kiểm tra mà không cần bật webcam:
  ```bash
  python web_link.py --send "43A-123.45"
  ```
