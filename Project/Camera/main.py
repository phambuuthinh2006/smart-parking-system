import argparse
import cv2
import easyocr
from ultralytics import YOLO

# Import các module kết nối mạng HTTP đã bổ sung
from web_link import PlateUploader
from gate_link import start_gate_link

# Cho phép chọn camera qua tham số dòng lệnh: python main.py --source 1
parser = argparse.ArgumentParser(description="Chạy camera nhận diện biển số Smart Parking")
parser.add_argument("--source", default="1", help="Chỉ số camera (0 = Cam laptop, 1 = USB Webcam ngoài)")
args = parser.parse_args()

# Chuyển đổi source sang số nguyên nếu là webcam
cam_source = int(args.source) if args.source.isdigit() else args.source

print("Đang khởi tạo mô hình nhận diện biển số YOLO và EasyOCR...")
model = YOLO("best.pt")
reader = easyocr.Reader(["en"], gpu=False)  # đổi gpu=True nếu có CUDA

# Khởi tạo luồng gửi HTTP biển số lên Web Backend
web = PlateUploader()

# Tự động kích hoạt luồng lắng nghe lệnh mở cổng từ Web để bắn sang ESP32
# (Chạy ngầm, không cần phải mở thêm terminal riêng)
gate = start_gate_link()

print(f"Đang mở Camera nguồn: {cam_source}...")
cap = cv2.VideoCapture(cam_source)
if not cap.isOpened():
    print(f"⚠️ Không mở được camera {cam_source}! Đang tự động chuyển sang camera 0 (Laptop)...")
    cap = cv2.VideoCapture(0)

print("\n>>> CAMERA SẴN SÀNG! Đang quét xe... (Nhấn 'q' trên cửa sổ video để thoát) <<<\n")

while True:
    ok, frame = cap.read()
    if not ok:
        break

    results = model(frame, conf=0.5, verbose=False)[0]

    for box in results.boxes:
        x1, y1, x2, y2 = map(int, box.xyxy[0])
        plate = frame[y1:y2, x1:x2]
        if plate.size == 0:
            continue

        # Tiền xử lý để OCR đọc tốt hơn (Giữ nguyên thuật toán gốc)
        gray = cv2.cvtColor(plate, cv2.COLOR_BGR2GRAY)
        gray = cv2.resize(gray, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        gray = cv2.bilateralFilter(gray, 11, 17, 17)

        text = reader.readtext(
            gray,
            allowlist="ABCDEFGHKLMNPRSTUVXYZ0123456789-. ",
            detail=0,
        )
        plate_text = " ".join(text).strip()

        # Khi OCR đọc được biển số -> Gửi lên Web Backend qua HTTP (chạy ngầm, tự lọc trùng 3s)
        if plate_text:
            web.submit(plate_text)

        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.putText(frame, plate_text, (x1, y1 - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 0), 2)

    cv2.imshow("Bien so", frame)
    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()

# Đóng các kết nối mạng khi dừng chương trình
web.close()
gate.stop()
print("Đã đóng camera và dừng các luồng kết nối.")
