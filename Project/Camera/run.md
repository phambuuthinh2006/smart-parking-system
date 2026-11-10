# Camera thử nghiệm AUTO

Đọc [EXPERIMENT.md](../../EXPERIMENT.md). Nhánh này dùng backend18081/key riêng,
`PARKING_DIRECTION=AUTO`, firmware Uno/ESP protocol3. Giữ best.pt và file.env ngoàiGit.

```powershell
python web_link.py --register "36H-123.45"
python main.py --source 1
```

Qua cổng vào chưa Inside; cảm biếnP01trống→cóxe sau khi qua cổng mớiInside.
Rời ô vẫnInside; camera thấy lại xe tronglượtmới thìAUTOchọnEXIT; qua cổng mớiExited.
Chờ vùngbiểnsố biếnmấtít nhất2s trêncáckhunghình rồi xuất hiệnlại đểtạolượtmới.
Không chạy main/bridge main cùng lúc, không dùng chung database/APIkey của main.
