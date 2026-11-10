# 04 — Giám sát

## Xem gì

| Tín hiệu | Ở đâu | Bình thường |
|---|---|---|
| Trang chủ + API còn sống | `GET /api/health` → `{"ok":true,"mode":"postgres"}` | 200, mode postgres |
| Số tài nguyên | `GET /api/resources` | 62 |
| Đăng nhập demo/admin | Bấm thật trên trình duyệt | Đăng nhập được ngay lần đầu |
| Trang admin | `GET /admin/` và `/admin/dashboard.html` | 200, có giao diện |
| Số liệu admin | Dashboard: users 39, orders 133, revenue ¥158,028, resources 62, demands 9 | Khớp DB (số đơn tăng dần theo test) |
| Deploy Vercel | `vercel inspect <deployment> --logs` | Build xong, không lỗi function |

## Xem log request Vercel (cách tìm nguyên nhân lỗi frontend)

```bash
npx -y vercel@65.14.0 logs requests --deployment <deployment> --since 1h --json
```

- Log cho biết trình duyệt thật gọi đường dẫn nào, trả mã nào, route nào — đây là cách tìm ra lỗi thiếu `/api` (POST `/auth/login` → 405, route `/index.html`).
- Lưu ý: route fallback `/.*` → `/index.html` khiến file tĩnh thiếu cũng trả 200 với nội dung trang chủ — trang "trông bình thường nhưng mất giao diện" nghĩa là kiểm tra URL asset trước.

## Neon

- Xem trạng thái project/branch trong Neon Console (project `crimson-term-40745510`, nhánh `production`).
- DB demo không cần cảnh báo dung lượng (dữ liệu seed, tạo lại được).
