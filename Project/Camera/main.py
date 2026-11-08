import cv2
import easyocr
from ultralytics import YOLO
from web_link import PlateUploader

model = YOLO("best.pt")
reader = easyocr.Reader(["en"], gpu=False)  # đổi gpu=True nếu có CUDA

web = PlateUploader()

cap = cv2.VideoCapture(0)  # 0 = webcam mặc định

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

        # Tiền xử lý để OCR đọc tốt hơn
        gray = cv2.cvtColor(plate, cv2.COLOR_BGR2GRAY)
        gray = cv2.resize(gray, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        gray = cv2.bilateralFilter(gray, 11, 17, 17)

        text = reader.readtext(
            gray,
            allowlist="ABCDEFGHKLMNPRSTUVXYZ0123456789-. ",
            detail=0,
        )
        plate_text = " ".join(text)
        web.submit(plate_text)

        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.putText(frame, plate_text, (x1, y1 - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 0), 2)

    cv2.imshow("Bien so", frame)
    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()
web.close()
