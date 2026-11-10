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

- Không phải admin (kể cả ẩn danh) → **403** (không phải 401). `POST` vào các endpoint admin → **404**.
- Không có endpoint sửa/xóa/duyệt nào ở admin — đúng thiết kế chỉ xem.
