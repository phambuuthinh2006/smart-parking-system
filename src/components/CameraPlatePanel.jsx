import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import { outcomeLabel } from "../services/vehicleAccess";
const base = (import.meta.env.VITE_BACKEND_URL || "").replace(/\/$/, "");

export default function CameraPlatePanel() {
  const [latest, setLatest] = useState(null);
  const [registered, setRegistered] = useState([]);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let active = true, timer, controller;
    async function refresh() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      try {
        const [reading, plates] = await Promise.all([
          fetch(`${base}/api/camera/latest`, { signal: controller.signal, cache: "no-store" }),
          fetch(`${base}/api/camera/registered-plates`, { signal: controller.signal, cache: "no-store" }),
        ]);
        if (!reading.ok || !plates.ok) throw new Error("Backend unavailable");
        const [next, list] = await Promise.all([reading.json(), plates.json()]);
        if (active) { setLatest(next); setRegistered(list); setConnected(true); }
      } catch { if (active) setConnected(false); }
      finally { clearTimeout(timeout); if (active) timer = setTimeout(refresh, 1000); }
    }
    refresh();
    return () => { active = false; clearTimeout(timer); controller?.abort(); };
  }, []);
  const enabled = registered.filter((item) => item.enabled);
  return <section className="panel camera-plate-panel" aria-label="Camera plate reading">
    <div className="access-heading"><span className="access-icon"><Camera size={21} /></span>
      <div><h2>Camera · Biển số vừa quét</h2><p>Camera → kiểm tra đăng ký → yêu cầu mở cổng.</p></div>
      <span className="access-source">{connected ? "Đã kết nối backend" : "Mất kết nối backend"}</span>
    </div>
    <div className="camera-plate-content" aria-live="polite">
      <strong className="camera-plate-value">{latest?.plateText || "Chờ camera gửi biển số"}</strong>
      <p>{latest?.outcome ? outcomeLabel(latest.outcome) : "Chưa có lần quét nào."}</p>
      {latest?.receivedAt && <p>Lần nhận cuối: {new Date(latest.receivedAt).toLocaleString("vi-VN")}{!connected && " · Dữ liệu đã lưu, chưa có cập nhật mới"}</p>}
      <p>Biển số đang đăng ký: {enabled.length ? enabled.map((item) => item.plate).join(", ") : "Chưa có"}</p>
      <p>Tự động: camera gửi biển → backend duyệt → Uno mở/đóng → phản hồi ghi lượt xe. Cần firmware Uno/ESP protocol 2 và cầu nối đang chạy. Một cảm biến chỉ suy luận xe rời vùng trong mô hình.</p>
    </div>
  </section>;
}
