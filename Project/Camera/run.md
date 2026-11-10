# Camera → backend → Uno/ESP: chạy tự động

Xem [SETUP.md](../../SETUP.md) để chạy hai laptop, lấy IP, cấu hình key và nạp firmware.

## Cập nhật bắt buộc

- Chép cả thư mục Camera mới, giữ `.env` và model `best.pt` của nhóm.
- Nạp lại `Project/SmartParking_Uno` (có `GateCycle.h`) và `Project/SmartParking_ESP8266`.
- `/status` của ESP phải có `protocolVersion:2`, `telemetryValid:true`, `sampleAgeMs<=2000`.
- Backend phải có API `POST /api/device/barrier-feedback` (migration V6).

## Chạy trên máy camera

```powershell
python -m pip install ultralytics opencv-python easyocr
python web_link.py --register "36H-123.45"
python main.py --source 1
```

Thay biển ví dụ bằng biển thật. Chỉ chạy main.py, không chạy thêm bridge riêng.
Giữ đúng IP backend và key trong Camera/.env. Nếu camera lối ra, đặt `PARKING_DIRECTION=EXIT`.

Backend duyệt biển → Uno thấy xe dưới15cm → mở → cảm biến đo vùng trống hợp lệ
3lần, sau tối thiểu1.2s → đóng → PASSED đúngrequestId → backend tự ghi lượt.
Không còn phải bấm Confirm passage trong chu kỳ bình thường. Timeout chờ xe30s
hủy lượt; sensor không echo giữ cổng, không tính là xe qua. Một sensor chỉ suy
luận xe rời vùng (xe lùi cũng có thể bị ghi qua) nên chỉ dùng mô hình có giám sát.

Các log backend/ESP/telemetry tách riêng. Khi cùng một biển và kết quả không đổi,
log HTTP được giảm lặp; chuỗi biển chuẩn hóa được gửi tối đa mỗi3giây dù dấu chấm/
gạch/khoảng trắng OCR thay đổi. Không thay model/OCR hoặc tự tạo confidence.

Kiểm thử không cần webcam/board:

```powershell
python -m unittest discover -s . -p "test*.py" -v
```
