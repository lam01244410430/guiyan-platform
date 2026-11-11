# 02 — Quyết định kỹ thuật đã chốt

Mỗi quyết định: nội dung, lý do, trạng thái. Chỉ ghi quyết định **đã chốt**; đề xuất chưa duyệt nằm ở `09-ghi-chu/chua-phan-loai.md` và phải ghi rõ là đề xuất.

| # | Quyết định | Lý do | Trạng thái |
|---|---|---|---|
| 1 | API Node.js thuần (`node:http`), không framework | Nhẹ, không phụ thuộc, chạy được cả trên Vercel Function lẫn server thường | Đã chốt |
| 2 | PostgreSQL duy nhất, 11 bảng | Theo tài liệu thiết kế 03 của nhóm; không SQLite fallback | Đã chốt |
| 3 | Tiền tệ = số nguyên xu (integer cents) | Tránh sai số float; server tự tính số tiền | Đã chốt |
| 4 | Mật khẩu scrypt + salt, session token | Không lưu plaintext; token ở `sessionStorage` | Đã chốt |
| 5 | Mọi đường dẫn API có tiền tố `/api` | Server chỉ route `/api/*`; frontend gọi trần sẽ 405 (đã xảy ra) | Đã chốt |
| 6 | Web admin là web hoàn toàn riêng biệt (`admin/`) | Không dùng chung frontend web chính; session key riêng | Đã chốt 2026-11-10 |
| 7 | Admin chỉ xem (read-only) | Không có sửa/xóa/duyệt ở admin; endpoint admin 403 với non-admin | Đã chốt |
| 8 | Yêu thích phải đăng nhập, lưu trên tài khoản | Không lưu local khi chưa đăng nhập; đăng xuất xóa tim | Đã chốt 2026-11-10 |
| 9 | Ngôn ngữ mặc định: tiếng Trung (zh) | Yêu cầu của Lam 2026-11-10 (trước đó là tiếng Việt) | Đã chốt 2026-11-10 |
| 10 | Deploy: Vercel (web + API) + Neon Postgres | Vercel region `sin1`; Neon nhánh `production`, Better Auth OFF | Đã chốt |
| 11 | Khả năng mô phỏng luôn ghi nhãn mô phỏng | Thanh toán, AI, blockchain là mô phỏng — không trình bày như thật | Đã chốt |
| 12 | Không làm nội dung pháp lý/thương mại | Lam quyết định bỏ hướng pháp lý, chỉ làm kỹ thuật | Đã chốt |
| 13 | Audit bảo mật đầy đủ chỉ chạy khi hệ thống hoàn thiện | Skill security-audit đã cài, chạy sau | Đã chốt 2026-11-10 |
| 14 | Frontend: React 19 + Vite 6, MPA 4 entry (`vite.config.js`, `appType: "mpa"`) | Giữ đúng URL cũ (`/`, `/user.html`, `/admin/`, `/admin/dashboard.html`); không đổi API/DB/schema; build `npm run build` = `vite build && node scripts/flatten-dist.mjs` | Đã chốt 2026-11-11 |
| 15 | Redis cache, fail-open tuyệt đối (`server/lib/cache.mjs`) | Cache chết/timeout → đọc thẳng Postgres, không bao giờ làm hỏng request; 2 driver: Upstash REST (Vercel serverless) ưu tiên, rồi node-redis RESP (`REDIS_URL`, dev/test); không có biến môi trường → cache tắt, API vẫn chạy | Đã chốt 2026-11-11 |
| 16 | TTL cache: tài nguyên/hot 300s, admin stats/analysis 60s; key dùng namespace `guiyan:*` | Thống kê thay đổi nhanh nên TTL ngắn; tài nguyên ít đổi nên TTL dài; ghi đơn/nhu cầu/cảnh báo thì xóa (bust) đúng nhóm key | Đã chốt 2026-11-11 |
| 17 | Đăng ký: `POST /api/auth/register`, KHÔNG xác minh email | Không có email provider; email là trường tùy chọn, chỉ kiểm tra định dạng; role cố định `user` (client gửi `role=admin` cũng bị bỏ qua); đăng ký xong tự đăng nhập (session 7 ngày) | Đã chốt 2026-11-11 |
| 18 | Seed mới cộng thêm, demo GIỮ làm fallback tạm thời | 100 user mới (id 40–139) + 180 đơn mới, thêm bên cạnh dữ liệu demo, không xóa demo; mật khẩu chung của 100 user mới là `guiyan2026` — cùng loại credential demo công khai như `demo123`/`admin123`, không phải mật khẩu thật; chỉ bỏ demo sau khi migration + seed mới kiểm chứng ổn định **và Lam duyệt riêng**; DB Neon production không reset | Đã chốt 2026-11-11 |
| 19 | Backend admin-insights giữ nguyên, premium dashboard là giai đoạn 5 | `server/routes/admin-insights.mjs` (stats theo kỳ, analysis, alerts, CSV, audit-logs, duyệt nhu cầu) đã có sẵn từ trước migration; giao diện React cho nó làm ở giai đoạn 5, không làm chung với migration | Đã chốt 2026-11-11 |
| 20 | Header `X-Cache: HIT/MISS` trên các endpoint có cache | Cho biết response từ Redis hay Postgres, phục vụ debug; chỉ đặt khi cache đang bật | Đã chốt 2026-11-11 |

## Chưa chốt / đang chờ (pending, không phải quy tắc)

- **Upstash (Redis production):** chưa có biến `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` ở Vercel — cần Lam tạo tài khoản Upstash (hoặc qua Vercel Marketplace). Code tự nhận biến khi có, không cần sửa code. Tới lúc đó cache trên production vẫn tắt (fail-open, API đọc thẳng Postgres).
- **Bỏ dữ liệu demo + tài khoản demo/demo123:** chỉ sau khi migration + seed mới kiểm chứng ổn định và Lam duyệt riêng (xem quyết định 18).
- **B-014/015/016/017:** 4 lỗi test/admin-insights chưa sửa (stats `?period=quarter` 500; test đòi chuỗi báo cáo không tồn tại; assert BOM CSV; assert `kpis.orders`/`venues.length` stale) — sửa ở giai đoạn 5 cùng premium dashboard. Chi tiết xem myown `02.md` §7.
- **Cảnh báo chunk Vite ~873 KB** (do ảnh base64 `CATIMG` trong `data.js`): chỉ là warning lúc build, tối ưu sau, không chặn.
- Snapshot TasteSkill cũ còn trỏ file admin JS đã xóa — chạy lại ở giai đoạn deploy.

## Quyết định chưa chốt (đề xuất, không phải quy tắc)

- Mini-program: đổi AppID `touristappid` sang AppID thật của nhóm để phát hành.
- Biên dịch thử mini-program trong WeChat DevTools (chưa ai làm).
- Các đề xuất trong tài liệu nhóm chưa được Lam duyệt vẫn là đề xuất.
