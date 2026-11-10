import argparse
import cv2
from camera_io import open_camera
from web_link import HttpLink, PlateUploader, describe_http_error
from gate_link import GateLinkRunner


def main():
    parser = argparse.ArgumentParser(description="Experimental AUTO parking camera")
    parser.add_argument("--source", default="1", help="Webcam index or video path")
    parser.add_argument("--capture-backend", default="auto", choices=("auto", "dshow", "msmf", "any"))
    args = parser.parse_args()
    source = int(args.source) if args.source.isdigit() else args.source
    link = HttpLink()
    link.verify_experiment()

    import easyocr
    from ultralytics import YOLO
    print("Đang khởi tạo mô hình YOLO và EasyOCR...", flush=True)
    model = YOLO("best.pt")
    reader = easyocr.Reader(["en"], gpu=False)
    cap, frame, name = open_camera(source, args.capture_backend)
    web, gate = None, None
    try:
        print(f"Camera {source}: {name}, đã đọc được hình. Nhấn q để thoát.", flush=True)
        web = PlateUploader(link)
        gate = GateLinkRunner(backend=link)
        gate.start()
        while True:
            results = model(frame, conf=0.5, verbose=False)[0]

            web.observe_frame(len(results.boxes) > 0)

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
            ok, frame = cap.read()
            if not ok or frame is None or frame.size == 0:
                print("[CAMERA] Mất khung hình. Đóng các app dùng webcam, kiểm tra USB hoặc thử --source khác.", flush=True)
                break
    finally:
        cap.release()
        cv2.destroyAllWindows()
        if web is not None:
            web.close()
        if gate is not None:
            gate.stop()
        print("Đã đóng camera và dừng các luồng kết nối.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Đã dừng.", flush=True)
    except Exception as exc:
        print(f"[STARTUP] {describe_http_error(exc)}", flush=True)
        raise SystemExit(1)
