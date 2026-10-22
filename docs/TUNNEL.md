# Backend tunnel để test Vercel

Phiên mở ngày 2026-10-22. URL tạm thời, chỉ hoạt động khi máy và process cloudflared còn chạy:

https://trainers-significant-participating-lexington.trycloudflare.com

Origin đã cho phép: `https://smart-parking-system-drab-kappa.vercel.app`.

Đã xác minh từ trình duyệt tại chính origin Vercel: GET `/api/parking/status` HTTP 200, snapshot bốn chỗ; kết nối WSS `/ws` nhận STOMP CONNECTED. Device POST thiếu key vẫn bị chặn HTTP 401. PostgreSQL vẫn chỉ bind loopback, không mở qua tunnel.

## Bước còn lại trên Vercel

Bản frontend public kiểm tra trong phiên này vẫn là bản cũ (chưa có Device Mode/API adapter). Cần cập nhật mã frontend mới từ workspace này lên repository/deployment.

Trong project Vercel → Environment Variables, thêm cho Production:

```dotenv
VITE_BACKEND_URL=https://trainers-significant-participating-lexington.trycloudflare.com
```

Sau khi cập nhật code và biến môi trường, deploy bản mới. Biến môi trường không thay đổi bản deployment đã có: [tài liệu Vercel](https://vercel.com/docs/environment-variables/managing-environment-variables).

Trên máy chạy backend:

```sh
npm run device:simulate
```

Mở web Vercel và chọn Device. Đây là dữ liệu HTTP giả lập, chưa phải mạch thật. Không đưa DEVICE_API_KEY lên frontend/Vercel.

## Mở tunnel mới sau khi tắt máy/process

Backend phải đang chạy. Trong workspace, binary cloudflared đã có sẵn từ lệnh share:

```sh
.cache/cloudflared/2026.10.1/cloudflared-linux-amd64 tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:18080
```

Giữ terminal mở. Lần mở mới nhận hostname khác, cần cập nhật VITE_BACKEND_URL rồi deploy frontend mới. Không dùng `npm run share` cho thao tác này vì lệnh đó mở tunnel cho frontend. Tham khảo [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).
