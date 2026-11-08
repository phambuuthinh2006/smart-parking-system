# Demo nhận diện biển số → web

Hướng dẫn đầy đủ, API, database và demo barie: [docs/VEHICLE_ACCESS.md](../docs/VEHICLE_ACCESS.md).

```bash
cd /home/phambuuthinh/Downloads/IOT-PROJECT
npm run backend:up
npm run dev
```

Mở http://localhost:5173 → Device → Vehicle access.

Thử HTTP bằng biển giả lập (không cần thư viện ML):

```bash
python3 demo/main.py --mock-plate 43A-456.78 --send
# Web: Confirm passage để ghi giờ vào
python3 demo/main.py --mock-plate 43A-456.78 --direction EXIT --send
# Web: Confirm passage để ghi giờ ra
```

Thử webcam thật:

```bash
python3 -m venv demo/.venv
demo/.venv/bin/python -m pip install -r demo/requirements.txt
demo/.venv/bin/python demo/main.py --source 0 --direction ENTRY
# Sau khi xác minh OCR, thêm --send để lưu backend
```

Model `best.pt` của nhóm giữ nguyên, load theo vị trí script. Nếu cần chọn lớp, dùng `--plate-class ID` sau khi kiểm tra bảng nhãn do chương trình in. Mặc định chỉ dry run; `--send` mới ghi DB. `.env` cấp key, không đưa key vào frontend/Git. Phải bật `ACCESS_SIMULATION_ENABLED=true` ở backend để thao tác Confirm passage mô phỏng.

Đây là barie ảo; chưa điều khiển servo thật. Không tự gán biển số vào ô P01–P04. Camera thật/accuracy model cần kiểm chứng tại máy có thiết bị và các thư viện ML.
