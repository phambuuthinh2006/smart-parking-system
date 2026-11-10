import { useEffect, useState } from "react";
import { Camera, Plus, Lock, Unlock, Trash2, CheckCircle2, ShieldAlert } from "lucide-react";
import { outcomeLabel, formatPlateDisplay } from "../services/vehicleAccess";

const base = (import.meta.env.VITE_BACKEND_URL || "").replace(/\/$/, "");

export default function CameraPlatePanel() {
  const [latest, setLatest] = useState(null);
  const [registered, setRegistered] = useState([]);
  const [connected, setConnected] = useState(false);
  const [newPlate, setNewPlate] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function fetchRegistered() {
    try {
      const res = await fetch(`${base}/api/camera/registered-plates`, { cache: "no-store" });
      if (res.ok) {
        const list = await res.json();
        setRegistered(list);
      }
    } catch {
      // ignore
    }
  }

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
      finally { clearTimeout(timeout); if (active) timer = setTimeout(refresh, 2000); }
    }
    refresh();
    return () => { active = false; clearTimeout(timer); controller?.abort(); };
  }, []);

  async function handleRegister(e) {
    e.preventDefault();
    const clean = newPlate.trim();
    if (!clean) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`${base}/api/camera/registered-plates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plate: clean, enabled: true }),
      });
      if (!res.ok) throw new Error("Không thể đăng ký biển số");
      setNewPlate("");
      setMessage({ type: "success", text: `Đã đăng ký biển ${clean} thành công!` });
      await fetchRegistered();
    } catch (err) {
      setMessage({ type: "error", text: err.message || "Lỗi khi đăng ký" });
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle(plate, currentEnabled) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`${base}/api/camera/registered-plates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plate, enabled: !currentEnabled }),
      });
      if (!res.ok) throw new Error("Không thể đổi trạng thái");
      await fetchRegistered();
    } catch (err) {
      setMessage({ type: "error", text: err.message || "Lỗi cập nhật" });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(plate) {
    if (!window.confirm(`Bạn có chắc muốn xoá hẳn biển số ${formatPlateDisplay(plate)} khỏi hệ thống?`)) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`${base}/api/camera/registered-plates/${encodeURIComponent(plate)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Không thể xoá biển số");
      setMessage({ type: "success", text: `Đã xoá biển ${formatPlateDisplay(plate)}!` });
      await fetchRegistered();
    } catch (err) {
      setMessage({ type: "error", text: err.message || "Lỗi khi xoá" });
    } finally {
      setBusy(false);
    }
  }

  const enabledCount = registered.filter((item) => item.enabled).length;

  return (
    <section className="panel camera-plate-panel" aria-label="Camera plate reading">
      <div className="access-heading">
        <span className="access-icon"><Camera size={21} /></span>
        <div>
          <h2>Camera & Quản lý biển số xe</h2>
          <p>Nhận diện AI → kiểm tra danh sách đăng ký → tự động mở cổng barrier.</p>
        </div>
        <span className="access-source">{connected ? "Đã kết nối backend" : "Mất kết nối backend"}</span>
      </div>

      <div className="camera-plate-content" aria-live="polite">
        <div className="camera-status-block">
          <span className="camera-label">KẾT QUẢ QUÉT GẦN NHẤT</span>
          <strong className="camera-plate-value">{latest?.plateText || "Chờ camera gửi biển số"}</strong>
          <p className="camera-outcome">{latest?.outcome ? outcomeLabel(latest.outcome) : "Chưa có lần quét nào."}</p>
          {latest?.receivedAt && (
            <p className="camera-time">
              Lần nhận cuối: {new Date(latest.receivedAt).toLocaleString("vi-VN")}
              {!connected && " · Dữ liệu đã lưu, chưa có cập nhật mới"}
            </p>
          )}
        </div>

        <div className="plate-management-section">
          <div className="plate-mgmt-header">
            <div>
              <h3>DANH SÁCH BIỂN SỐ ĐÃ ĐĂNG KÝ</h3>
              <p className="plate-mgmt-sub">
                Đang kích hoạt: <strong>{enabledCount}</strong> / Tổng số: <strong>{registered.length}</strong> xe
              </p>
            </div>
          </div>

          <form className="plate-add-form" onSubmit={handleRegister}>
            <input
              type="text"
              className="plate-input"
              placeholder="Nhập biển số, ví dụ: 36H-123.45"
              value={newPlate}
              onChange={(e) => setNewPlate(e.target.value)}
              disabled={busy || !connected}
              maxLength={24}
            />
            <button
              type="submit"
              className="plate-add-button"
              disabled={busy || !connected || !newPlate.trim()}
            >
              <Plus size={16} />
              <span>Đăng ký xe</span>
            </button>
          </form>

          {message && (
            <div className={`plate-feedback ${message.type === "success" ? "is-success" : "is-error"}`}>
              {message.type === "success" ? <CheckCircle2 size={15} /> : <ShieldAlert size={15} />}
              <span>{message.text}</span>
            </div>
          )}

          <div className="plate-list-wrap">
            {registered.length === 0 ? (
              <p className="plate-empty">Chưa có biển số nào được đăng ký trong hệ thống.</p>
            ) : (
              <div className="plate-grid">
                {registered.map((item) => (
                  <div
                    key={item.plate}
                    className={`plate-item-card ${item.enabled ? "is-enabled" : "is-disabled"}`}
                  >
                    <div className="plate-item-info">
                      <span className="plate-badge">{formatPlateDisplay(item.plate)}</span>
                      <span className={`plate-status-tag ${item.enabled ? "tag-active" : "tag-locked"}`}>
                        {item.enabled ? "Hoạt động" : "Tạm khoá"}
                      </span>
                    </div>

                    <div className="plate-actions">
                      <button
                        type="button"
                        className={`plate-btn-toggle ${item.enabled ? "btn-lock" : "btn-unlock"}`}
                        onClick={() => handleToggle(item.plate, item.enabled)}
                        disabled={busy || !connected}
                        title={item.enabled ? "Tạm khoá biển số này" : "Kích hoạt lại biển số này"}
                      >
                        {item.enabled ? <Lock size={13} /> : <Unlock size={13} />}
                        <span>{item.enabled ? "Tạm khoá" : "Mở khoá"}</span>
                      </button>

                      <button
                        type="button"
                        className="plate-btn-delete"
                        onClick={() => handleDelete(item.plate)}
                        disabled={busy || !connected}
                        title="Xoá vĩnh viễn biển số này"
                        aria-label={`Xoá biển số ${item.plate}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <p className="camera-footnote">
          Tự động: camera gửi biển → backend duyệt (nếu Hoạt động) → Uno mở barrier. Nếu biển bị "Tạm khoá" hoặc chưa đăng ký, hệ thống từ chối mở cổng.
        </p>
      </div>
    </section>
  );
}
