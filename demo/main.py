"""YOLO plate detector -> stable OCR -> authenticated HTTP -> virtual gate."""
import argparse
import queue
import threading
from pathlib import Path

from bridge import StablePlate, load_settings, make_event, post_event, read_ocr_rows, valid_plate

ROOT = Path(__file__).resolve().parent


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weights", type=Path, default=ROOT / "best.pt")
    parser.add_argument("--source", default="0", help="Camera index, video file or stream URL")
    parser.add_argument("--direction", choices=("ENTRY", "EXIT"), default="ENTRY")
    parser.add_argument("--camera-id", default="gate-entry")
    parser.add_argument("--env-file", type=Path, default=ROOT.parent / ".env")
    parser.add_argument("--backend-url", help="Default: DEVICE_BACKEND_URL or http://127.0.0.1:18080")
    parser.add_argument("--send", action="store_true", help="Enable backend writes (default is dry run)")
    parser.add_argument("--mock-plate", help="Send one explicitly simulated reading; no camera/ML needed")
    parser.add_argument("--plate-class", type=int, action="append", help="Explicit plate class ID; repeatable")
    parser.add_argument("--min-confidence", type=float, default=.75)
    parser.add_argument("--stable-frames", type=int, default=3)
    parser.add_argument("--cooldown", type=float, default=30)
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--gpu-ocr", action="store_true")
    return parser.parse_args()


def main():
    args = arguments()
    if not .75 <= args.min_confidence <= 1:
        raise ValueError("Minimum confidence must be between .75 and 1")
    settings = load_settings(args.env_file)
    base = args.backend_url or settings["DEVICE_BACKEND_URL"] or "http://127.0.0.1:18080"
    key = settings["DEVICE_API_KEY"]
    if args.send and not key:
        raise ValueError("DEVICE_API_KEY missing from environment or .env")
    if args.mock_plate:
        event = make_event(args.mock_plate, args.direction, 1, "mock-demo")
        print("MOCK reading: no camera inference or physical hardware.", flush=True)
        print(post_event(base, key, event) if args.send else event, flush=True)
        return
    if not args.weights.is_file():
        raise ValueError(f"Weights file not found: {args.weights}")
    # Keep heavy dependencies lazy: --help and --mock-plate work with Python alone.
    import cv2
    import easyocr
    from ultralytics import YOLO

    model = YOLO(str(args.weights))
    aliases = {"plate", "licenseplate", "licenceplate", "numberplate", "bienso"}
    normalize_name = lambda name: "".join(c for c in name.lower() if c.isalnum())
    class_ids = args.plate_class or [int(i) for i, name in model.names.items() if normalize_name(name) in aliases]
    if not class_ids or any(i not in model.names for i in class_ids):
        raise ValueError(f"Specify --plate-class from model labels: {model.names}; do not OCR vehicle boxes")
    print(f"Plate classes: {[(i, model.names[i]) for i in class_ids]}; {'HTTP enabled' if args.send else 'DRY RUN'}", flush=True)
    reader = easyocr.Reader(["en"], gpu=args.gpu_ocr)
    source = int(args.source) if args.source.isdigit() else args.source
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise RuntimeError("Unable to open camera/video source")
    pending = queue.Queue(maxsize=8)
    stopping = threading.Event()

    def deliver():
        while not stopping.is_set() or not pending.empty():
            try:
                event = pending.get(timeout=.2)
            except queue.Empty:
                continue
            try:
                print("HTTP result:", post_event(base, key, event), flush=True)
            except Exception as exc:
                print(f"NOT SAVED / needs operator check: {exc}", flush=True)
            finally:
                pending.task_done()

    worker = threading.Thread(target=deliver, daemon=True)
    worker.start()
    stable = StablePlate(args.stable_frames, args.cooldown)
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            result = model.predict(frame, conf=args.min_confidence, classes=class_ids, verbose=False)[0]
            candidates = {}
            for box in result.boxes:
                x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                x1, y1 = max(0, x1), max(0, y1)
                x2, y2 = min(frame.shape[1], x2), min(frame.shape[0], y2)
                crop = frame[y1:y2, x1:x2]
                if not crop.size:
                    continue
                gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
                gray = cv2.resize(gray, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
                gray = cv2.bilateralFilter(gray, 11, 17, 17)
                plate, ocr_conf = read_ocr_rows(reader.readtext(gray, detail=1, allowlist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-. "))
                confidence = min(float(box.conf[0]), ocr_conf)
                if valid_plate(plate) and confidence >= args.min_confidence:
                    candidates[plate] = max(candidates.get(plate, 0), confidence)
                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 180, 0), 2)
                cv2.putText(frame, plate, (x1, max(20, y1 - 10)), cv2.FONT_HERSHEY_SIMPLEX, .7, (0, 180, 0), 2)
            # More than one plausible plate in view: wait, do not choose a vehicle arbitrarily.
            plate = next(iter(candidates)) if len(candidates) == 1 else None
            confirmed = stable.observe(plate)
            if confirmed:
                event = make_event(confirmed, args.direction, candidates[confirmed], args.camera_id)
                if args.send:
                    try:
                        pending.put_nowait(event)
                        print(f"Queued {confirmed}; waiting for backend acknowledgement", flush=True)
                    except queue.Full:
                        print(f"NOT SAVED: queue full for {confirmed}; check connection and retry", flush=True)
                else:
                    print("DRY RUN:", event, flush=True)
            if not args.headless:
                cv2.imshow("Plate detection - q to quit", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
    finally:
        cap.release()
        cv2.destroyAllWindows()
        stopping.set()
        worker.join(timeout=45)
        if worker.is_alive():
            print("WARNING: pending deliveries remain; inspect backend before resending", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, ImportError) as exc:
        raise SystemExit(str(exc))
