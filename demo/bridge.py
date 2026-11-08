"""Small standard-library HTTP bridge; importing it never loads camera/ML libraries."""
import json
import os
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib import error, request


def normalize_plate(value):
    return re.sub(r"[\s.\-]", "", str(value).upper())


def valid_plate(value):
    return bool(re.fullmatch(r"[0-9]{2}[A-Z]{1,2}[0-9]{4,6}", normalize_plate(value)))


def load_settings(path):
    """Read only bridge settings from simple KEY=value files. No shell expansion."""
    allowed = {"DEVICE_API_KEY", "DEVICE_BACKEND_URL"}
    settings = {}
    file = Path(path)
    if file.exists():
        for line in file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            if key.strip() in allowed:
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                settings[key.strip()] = value
    return {key: os.environ.get(key, settings.get(key, "")) for key in allowed}


def make_event(plate, direction, confidence, camera_id):
    if not valid_plate(plate):
        raise ValueError("Unsupported plate format; expected e.g. 43A-123.45")
    if direction not in ("ENTRY", "EXIT") or not .75 <= confidence <= 1:
        raise ValueError("Direction or confidence is invalid")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", camera_id):
        raise ValueError("Camera ID must contain 1–40 letters, digits, _ or -")
    return {
        "eventId": str(uuid.uuid4()), "plate": normalize_plate(plate),
        "direction": direction, "confidence": round(confidence, 4),
        "cameraId": camera_id,
        "observedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
    }


def post_event(base_url, api_key, event, attempts=4, sleeper=time.sleep):
    if not api_key:
        raise ValueError("DEVICE_API_KEY missing; configure .env, never put it in browser code")
    if not base_url.startswith(("http://", "https://")):
        raise ValueError("Backend URL must use http:// or https://")
    data = json.dumps(event).encode()
    url = base_url.rstrip("/") + "/api/device/vehicle-detections"
    # Reuse exactly this UUID, observation time and payload on every retry.
    for attempt in range(attempts):
        req = request.Request(url, data=data, headers={
            "Content-Type": "application/json", "X-Device-Key": api_key,
        }, method="POST")
        try:
            with request.urlopen(req, timeout=5) as response:
                result = json.load(response)
            return {key: result.get(key) for key in ("outcome", "visitId", "duplicate")}
        except error.HTTPError as exc:
            if exc.code not in (408, 429, 500, 502, 503, 504):
                raise RuntimeError(f"Backend rejected detection (HTTP {exc.code}); event not retried") from None
            failure = f"HTTP {exc.code}"
        except (error.URLError, TimeoutError, OSError):
            failure = "network unavailable"
        if attempt + 1 < attempts:
            sleeper(2 ** attempt)
    raise RuntimeError(f"Detection not acknowledged after {attempts} attempts: {failure}")


class StablePlate:
    """Consecutive frame consensus + absence rearm + cooldown. Once per frame."""
    def __init__(self, frames=3, cooldown=30, absence=2):
        if frames < 2 or cooldown < 0 or absence <= 0:
            raise ValueError("Invalid consensus parameters")
        self.frames, self.cooldown, self.absence = frames, cooldown, absence
        self.candidate = None
        self.count = 0
        self.last_seen = None
        self.latched = None
        self.sent_at = {}

    def observe(self, plate, now=None):
        now = time.monotonic() if now is None else now
        if self.last_seen is not None and now - self.last_seen >= self.absence:
            self.latched = None
            self.candidate, self.count = None, 0
        plate = normalize_plate(plate) if plate and valid_plate(plate) else None
        if plate is None:
            self.candidate, self.count = None, 0
            return None
        self.last_seen = now
        if plate == self.candidate:
            self.count += 1
        else:
            self.candidate, self.count = plate, 1
        if (self.count >= self.frames and plate != self.latched
                and now - self.sent_at.get(plate, float("-inf")) >= self.cooldown):
            self.latched, self.sent_at[plate] = plate, now
            return plate
        return None


def read_ocr_rows(results):
    """Order EasyOCR polygons by rows, then left-to-right (supports two-row plates)."""
    if not results:
        return "", 0.0
    boxes = []
    for polygon, text, confidence in results:
        ys = [point[1] for point in polygon]
        boxes.append((sum(ys) / len(ys), min(p[0] for p in polygon),
                      max(ys) - min(ys), text, float(confidence)))
    rows = []
    for box in sorted(boxes):
        row = next((row for row in rows if abs(row[0][0] - box[0]) <= max(row[0][2], box[2]) * .55), None)
        if row is None:
            rows.append([box])
        else:
            row.append(box)
    ordered = [box for row in rows for box in sorted(row, key=lambda b: b[1])]
    return normalize_plate("".join(b[3] for b in ordered)), min(b[4] for b in ordered)
