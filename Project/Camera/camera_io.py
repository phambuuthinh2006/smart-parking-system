"""Camera selection and preview; no OCR, backend calls or hardware commands."""
import argparse
import sys
import time


def open_camera(source, backend="auto", cv=None, platform_name=None):
    if cv is None:
        import cv2 as cv
    platform_name = platform_name or sys.platform
    if backend not in ("auto", "dshow", "msmf", "any"):
        raise ValueError("Unknown capture backend")
    if backend == "auto":
        names = ["dshow", "msmf"] if platform_name == "win32" and isinstance(source, int) else ["any"]
    else:
        names = [backend]
    attempted = []
    for name in names:
        api = {"dshow": cv.CAP_DSHOW, "msmf": cv.CAP_MSMF, "any": cv.CAP_ANY}[name]
        cap = cv.VideoCapture(source, api)
        success = False
        try:
            if cap.isOpened():
                for _ in range(8):
                    ok, frame = cap.read()
                    if ok and frame is not None and frame.size > 0:
                        success = True
                        return cap, frame, name
                    time.sleep(.05)
        finally:
            if not success:
                cap.release()
        attempted.append(name)
    raise ValueError(f"Camera {source} cannot read frames ({', '.join(attempted)}). Close other camera apps, check Windows camera permissions/USB and try --source 0 or another real device index.")


def preview():
    import cv2
    parser = argparse.ArgumentParser(description="Preview webcam only; does not send plates or gate commands")
    parser.add_argument("--source", default="1")
    parser.add_argument("--capture-backend", default="auto", choices=("auto", "dshow", "msmf", "any"))
    args = parser.parse_args()
    source = int(args.source) if args.source.isdigit() else args.source
    cap = None
    try:
        cap, frame, name = open_camera(source, args.capture_backend)
        print(f"Camera {source}: {name}; preview only, q to close", flush=True)
        while True:
            cv2.imshow("Camera preview - no gate commands", frame)
            if cv2.waitKey(1) & 0xff == ord('q'):
                break
            ok, frame = cap.read()
            if not ok or frame is None:
                raise ValueError("Camera stopped delivering frames; check USB and device index")
    finally:
        if cap is not None:
            cap.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    try:
        preview()
    except (ValueError, KeyboardInterrupt) as exc:
        print(str(exc) or "Preview stopped", flush=True)
