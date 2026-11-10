# Setup nhánh thử nghiệm

Đọc [EXPERIMENT.md](EXPERIMENT.md) để chạy bản AUTO theo cảm biến ô đỗ.

- Nhánh: `experiment/auto-entry-exit`; main giữ nguyên.
- Web thử nghiệm: http://localhost:5175
- API thử nghiệm: 18081; PostgreSQL:55439; Compose project/volume riêng.
- Máy camera: pull nhánh riêng, giữ model, dùng key backend thử nghiệm và `PARKING_DIRECTION=AUTO`.
- Nạp lại cả Uno/ESP protocol3; Uno cần GateCycle.h + SlotSensor.h.
- Qua cổng vào → PENDING_PARKING. Cảm biến ô có xe → Inside.
- Rời ô vẫn Inside. Camera duyệt lượt ra; qua cổng/đóng → Exited.

Không dùng hướng dẫn của main cho firmware/database/cổng thử nghiệm.
