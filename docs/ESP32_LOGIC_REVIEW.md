# Review luồng ESP32 AP → laptop → mở cổng

> Các thiếu sót bên dưới là kết quả review trước sửa. Firmware và cầu nối laptop đã được bổ sung trong IOT-018; xem [ESP32_SETUP.md](ESP32_SETUP.md) để biết hành vi hiện tại và giới hạn phần cứng.

Ngày kiểm tra: 2026-11-08. Phạm vi: đọc ba file SmartParking và đối chiếu Python/backend/frontend hiện có; không sửa firmware hoặc gửi lệnh phần cứng.

## Kết luận

Đúng hướng kiến trúc, nhưng hiện chỉ đủ phần firmware demo nhận lệnh mở/đóng; chưa nối toàn bộ camera/web tới cổng thật.

| Mắt xích | Kết quả |
| --- | --- |
| ESP32 phát Wi-Fi AP | Có: WifiManager.cpp:93–94, chưa kiểm tra kết quả softAP trả về. |
| Laptop kết nối AP | Khả thi; IP ESP32 xem Serial (mặc định thường 192.168.4.1). Chưa thử thiết bị thật. |
| ESP32 nhận POST /open hoặc /close | Có: WifiManager.cpp:104–105. |
| Nhận lệnh rồi điều khiển servo | Có: SmartParking.ino:162–173, góc 90/0. |
| Camera/web gửi tới ESP32 | Chưa có trong ứng dụng hiện tại. demo/bridge.py:60 gửi /api/device/vehicle-detections tới backend; AccessController.java:35 gọi virtualBarrierCommand. |
| Hiển thị trạng thái cổng | Sai: WifiManager.cpp:18 khởi tạo gateOpen=false nhưng không có nơi cập nhật; /status luôn CLOSED. |

## Các điểm còn thiếu

1. Cần cầu nối ở laptop/backend: sau khi nghiệp vụ cho phép mở, gửi POST tới ESP32, xử lý timeout và đồng bộ trạng thái. Phản hồi COMMAND_RECEIVED hiện chỉ xác nhận nhận lệnh, không chứng minh cổng đã mở vật lý; servo không có cảm biến phản hồi.
2. Cần cập nhật trạng thái sau khi áp dụng lệnh servo; nếu muốn biết vị trí thật thì bổ sung công tắc hành trình/cảm biến.
3. Chưa có quy trình xe qua → đóng cổng, chống đóng khi xe còn dưới barie. Cảm biến hiện được dùng nhận biết chỗ đỗ, không xác nhận passage.
4. Siêu âm timeout trả -1 nhưng bị biến thành EMPTY (ino:183–190); NTC lỗi trả -100 làm tắt cảnh báo (ino:85–87,213–220). Cần trạng thái UNKNOWN/FAULT và chính sách khi mất cảm biến.
5. Chính sách cháy chưa khớp web: firmware bật >=45°C, không hysteresis, LED sáng liên tục, không mở cổng; web hiện ON>=50/OFF<=45, blink300ms và có yêu cầu mở cổng khi cháy. Cần thống nhất chính sách và ưu tiên lệnh đóng khi cháy.
6. delay(500) và pulseIn tối đa30ms làm HTTP chỉ được phục vụ mỗi vòng; nên dùng millis cho lịch cảm biến/log để phục vụ yêu cầu thường xuyên.
7. Nếu browser gọi trực tiếp từ localhost sang ESP32: firmware chưa hỗ trợ CORS/OPTIONS, còn tùy ràng buộc truy cập mạng cục bộ của browser. Dùng backend/Python ở laptop gửi HTTP sẽ tránh phụ thuộc CORS. AP riêng không tự cung cấp Internet; chạy web/backend và model OCR local, chuẩn bị dependencies/model trước.
8. /status và /slot của ESP32 không cùng schema dashboard (dashboard cần snapshot backend với4ô); cần adapter, không đổi URL frontend thẳng sang ESP32. Firmware này chỉ báo một ô.
9. API mở/đóng chưa xác thực riêng; mọi client truy cập được AP đều có thể ra lệnh. Nên giới hạn và xác thực lệnh khi tích hợp.

## Luồng đề nghị

Laptop chạy React + backend + Python/camera local, kết nối AP của ESP32. Python gửi nhận diện tới backend; backend kiểm tra nghiệp vụ rồi gửi lệnh có mã định danh tới ESP32. ESP32 điều khiển servo và báo trạng thái áp dụng lệnh. Chỉ ghi xe vào/ra khi có xác nhận passage; chỉ đóng khi vùng barie an toàn. Backend đẩy trạng thái về web.

## Giới hạn kiểm chứng

Đã rà soát mã nguồn; không có arduino-cli/PlatformIO trong PATH, chưa biên dịch, nạp ESP32, thử Wi-Fi/camera hoặc servo thật. Không chạy test web hiện có vì không thay đổi mã và các test này không kiểm chứng chuỗi phần cứng.
