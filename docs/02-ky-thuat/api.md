# 02 — Hợp đồng API

API chạy trên Node.js thuần (`node:http`, không framework), file vào `server/index.mjs` (dispatcher) → `server/routes/*`. Mọi đường dẫn API đều bắt đầu bằng **`/api`** — frontend gọi đường dẫn trần (vd `/auth/login`) sẽ bị Vercel trả 405 (đã xảy ra 2026-11-10, xem `04-van-hanh/su-co.md`).

## Quy ước chung

- JSON; tiền tệ luôn là **số nguyên xu** (vd ¥280 = `28000`); server tự tính số tiền của đơn, bỏ qua số tiền client gửi.
- Auth: mật khẩu scrypt + session; client gửi `Authorization: Bearer <token>`; token lưu ở `sessionStorage`.
- Lỗi: `{error: "..."}` kèm mã HTTP. Không có dữ liệu giả trong API.

## Endpoints khách hàng

| Phương thức & đường dẫn | Mô tả |
|---|---|
| `GET /api/health` | `{ok, mode: "postgres", database, today}` |
| `GET /api/categories` | 10 danh mục |
| `GET /api/resources` (+ `category/city/q/sort`) | Danh sách tài nguyên (62); category nhận id hoặc tên tiếng Trung |
| `GET /api/resources/:id` | Một tài nguyên |
| `POST /api/auth/login` / `POST /api/auth/logout` | Đăng nhập / đăng xuất |
| `POST /api/auth/register` | **Đăng ký (giai đoạn 3, 2026-11-11).** Body: `username` (3–20 ký tự chữ/số/gạch dưới), `password` (6–100 ký tự), `name` (bắt buộc, ≤50 ký tự), `email` (tùy chọn, đúng định dạng, ≤100 ký tự). Username trùng → **409**; sai định dạng → **400**. Role luôn là `user` (client gửi role khác cũng bị bỏ qua). **Không xác minh email** (không có email provider). Thành công trả `{token, user}` và tự đăng nhập (session 7 ngày, như login); ghi audit `注册` |
| `GET` / `POST /api/orders` | Danh sách / tạo đơn. Tạo đơn cần `booking_date` (≥ 2026-11-09); ngày của sân khấu đã đặt → **409**; trả về `{ok, id, code, amount, status}` |
| `POST /api/orders/:id/confirm\|pay\|complete\|cancel\|refund` | Chuyển trạng thái đơn |
| `GET` / `POST /api/demands` | Danh sách / đăng nhu cầu (đăng cần đăng nhập + đã xác thực) |
| `GET` / `POST` / `DELETE /api/favorites` | Yêu thích theo tài khoản; ẩn danh `POST` → **401** |
| `GET /api/assistant?q=` | Trợ lý (mô phỏng) |
| `GET /api/storage/health`, `POST /api/storage/upload`, `GET /api/storage/url?key=`, `DELETE /api/storage/:key` | Object storage (cần đăng nhập; chưa cấu hình → 503, API còn lại vẫn chạy) |

## Máy trạng thái đơn hàng

```
pending → confirmed → paid (mô phỏng) → completed
   │           │             │
   └─ cancel ──┴─ cancel ────┴─ refund → refunded
```

- `confirm` do **chủ đơn** thực hiện (không có giao diện vận hành).
- `refund` đi thẳng `paid → refunded` (không qua bước duyệt).
- `pay` trả về `{simulated: true, note: "模拟支付，未扣款"}` — không trừ tiền thật.

## Endpoints admin (chỉ xem, role = admin)

| Đường dẫn | Mô tả |
|---|---|
| `GET /api/admin/stats` | `{users, orders, revenue_cents (SUM amount WHERE status IN paid/completed), resources, demands, orders_by_status}` |
| `GET /api/admin/orders` | 200 đơn mới nhất, kèm `user_name`/`resource_name` |
| `GET /api/admin/users` | Danh sách user đã lọc mật khẩu (`safeUser`) |
| `GET /api/admin/demands` | **Tất cả** nhu cầu kể cả chờ duyệt, kèm `user_name` + `status` (danh sách công khai `/api/demands` giấu nhu cầu chưa duyệt) |

## Endpoints admin-insights (chỉ xem/phân tích, role = admin; backend đã có, giao diện React ở giai đoạn 5)

File `server/routes/admin-insights.mjs`, gọi sau các route admin cũ trong dispatcher (`server/index.mjs`) — `GET /api/admin/stats` không có `?period=` vẫn do `routes/admin.mjs` trả tổng lũy kế; có `?period=` thì handler ở đây trả chuỗi thời gian.

| Đường dẫn | Mô tả |
|---|---|
| `GET /api/admin/stats?period=day\|week\|month\|quarter` | Chuỗi thống kê theo kỳ: `{period, series, sources}`. Kỳ không hợp lệ → 400. ⚠️ `period=quarter` đang lỗi 500 (B-014, chưa sửa, giai đoạn 5) |
| `GET /api/admin/analysis?period=day\|week\|month\|quarter` | Phân tích vận hành: `{period, today, kpis, series, channels, ranking, alerts, insights, venues, cold, report, sources, userSummary, ...}`. `report` là chuỗi văn bản nhiều dòng (không chứa tiêu đề "模拟经营分析报告" — test cũ đòi chuỗi này đang sai, B-015) |
| `GET /api/admin/alerts` | Danh sách cảnh báo (tồn kho, chờ xác nhận, hoàn tiền/tranh chấp) + ngưỡng `threshold` |
| `POST /api/admin/alerts` | Kích hoạt / xử lý sự kiện mô phỏng (`trigger` / `resolve`, ghi bảng `events` + audit) |
| `GET /api/admin/orders.csv` | Xuất CSV toàn bộ đơn (có BOM `EF BB BF` ở đầu file; test assert `startsWith("\uFEFF")` bằng Node fetch không bao giờ pass — B-016, wire vẫn đúng) |
| `PATCH /api/admin/demands/:id` | Duyệt nhu cầu: body `{status: "approved" \| "rejected"}` (admin-only) |
| `GET /api/admin/audit-logs` | 60 nhật ký audit mới nhất, kèm `user_name` |

## Header `X-Cache`

Các endpoint có cache (`GET /api/resources` không lọc, `GET /api/assistant?q=...hot...`, `GET /api/admin/stats` cả 2 dạng, `GET /api/admin/analysis`) trả thêm header `X-Cache: HIT` (đọc từ Redis) hoặc `X-Cache: MISS` (đọc Postgres rồi ghi cache). Header chỉ xuất hiện khi cache đang bật (có `UPSTASH_*` hoặc `REDIS_URL`); khi cache tắt, API vẫn trả dữ liệu bình thường, không có header này. TTL: tài nguyên/hot **300s**, admin stats/analysis **60s**; key dùng namespace `guiyan:*` (xem `02-ky-thuat/tich-hop.md`).

- Không phải admin (kể cả ẩn danh) → **403** (không phải 401). `POST` vào các endpoint admin → **404**.
- Không có endpoint sửa/xóa/duyệt nào ở admin — đúng thiết kế chỉ xem.
