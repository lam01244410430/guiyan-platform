# 06 — Kiến trúc backend

## Tệp tin (`server/`)

```
server/
  index.mjs        # dispatcher: giữ đúng thứ tự kiểm tra route gốc (admin cuối cùng)
  server.mjs       # khởi động HTTP server (port 3001 local)
  postgres.mjs     # kết nối Postgres (DATABASE_URL bắt buộc, fail fast)
  schema.mjs       # tạo 11 bảng (bảng users đã có cột email TEXT, thêm giai đoạn 3)
  seed.mjs         # seed 62 tài nguyên + user demo + nhu cầu (id 3 pending)
                   #   + seed mới giai đoạn 2: 100 user (id 40–139) + 180 đơn → tổng 139 user / 310 đơn
  storage.mjs      # object storage Neon S3 (fail-soft 503 khi chưa cấu hình)
  lib/
    http.mjs       # validator/helper (assert, text, int, safeUser…)
    context.mjs    # createContext (req, session, send, all/get/run…)
    cache.mjs      # Redis cache fail-open (giai đoạn 1): Upstash REST → node-redis → tắt;
                   #   namespace guiyan:*, TTL tài nguyên 300s / admin 60s, X-Cache HIT/MISS
  routes/
    misc.mjs       # health, categories
    resources.mjs  # tài nguyên (GET list không lọc + assistant hot có cache)
    auth.mjs       # login/logout + register (giai đoạn 3: POST /api/auth/register)
    orders.mjs     # đơn hàng + chuyển trạng thái
    demands.mjs    # nhu cầu
    favorites.mjs  # yêu thích
    assistant.mjs  # trợ lý mô phỏng (hot answer có cache)
    storage.mjs    # storage endpoints
    admin.mjs      # stats tổng lũy kế, orders, users, demands (chỉ xem, admin-only)
    admin-insights.mjs # stats theo kỳ, analysis, alerts, orders.csv, duyệt nhu cầu,
                   #   audit-logs (chỉ xem, admin-only; giao diện React ở giai đoạn 5)
  static.mjs       # phục vụ file tĩnh web/ + admin/ (chặn traversal: \, .., symlink)
                   #   — chỉ phục vụ bản cũ; bản React kiểm chứng bằng vite preview
```

## Quy tắc

- **Dispatcher giữ đúng thứ tự route gốc**, admin check cuối. Thêm route mới phải giữ thứ tự này. Thứ tự hiện tại (`server/index.mjs`): health → categories → resources → login → **register** → logout → orders → demands → favorites → assistant → storage → admin (stats tổng → orders → users → demands) → admin-insights (stats theo kỳ → analysis → alerts → orders.csv → duyệt nhu cầu → audit-logs) → 404. `GET /api/admin/stats` không có `?period=` do `admin.mjs` trả tổng lũy kế; có `?period=` thì rơi xuống `admin-insights.mjs` trả chuỗi thời gian.
- **Cache Redis (`lib/cache.mjs`, giai đoạn 1):** fail-open tuyệt đối — Redis chết/timeout chỉ log rồi đọc Postgres; driver Upstash REST (cả 2 biến `UPSTASH_*`) → node-redis (`REDIS_URL`) → tắt. Upstash trên production đang **pending** (chưa có biến, cần Lam tạo). Key `guiyan:*`, TTL tài nguyên/hot 300s, admin stats/analysis 60s; ghi đơn/nhu cầu/cảnh báo thì bust đúng nhóm key. Endpoint có cache trả header `X-Cache: HIT/MISS`. Session vẫn ở Postgres, không qua Redis.
- **Đăng ký (`routes/auth.mjs`, giai đoạn 3):** `POST /api/auth/register` — username 3–20 ký tự, mật khẩu 6–100, tên bắt buộc, email tùy chọn đúng định dạng; role cố định `user`; trùng username → 409; scrypt + tự đăng nhập (session 7 ngày); **không xác minh email**.
- **Giữ nguyên 25 câu SQL gốc** — không sửa logic truy vấn khi tách file (đã kiểm chứng bằng đếm literal).
- Mọi ghi chạy trong transaction, chỉ dùng câu truy vấn có tham số.
- Số tiền đơn do **server tự tính**, bỏ qua số tiền client gửi.
- `static.mjs`: phục vụ `/`, `/index.html`, `/user.html`, `/assets/*` từ `web/`; `/admin/`, `/admin/dashboard.html`, `/admin/assets/*` từ `admin/`; còn lại 404 JSON. Asset của admin dùng đường dẫn tuyệt đối (xem `04-van-hanh/su-co.md`).
- `server/server.mjs`, `postgres.mjs`, `schema.mjs`, `seed.mjs`, `storage.mjs` không đổi trong đợt tách file.

## Chạy local

```bash
cd server && cp .env.example .env   # điền DATABASE_URL
docker compose up -d                # postgres:16-alpine, guiyan/guiyan/guiyan, 5432
npm ci && npm start                 # cổng 3001
```

Lần boot đầu tạo bảng + seed. Thiếu `DATABASE_URL` thì server dừng ngay kèm hướng dẫn.

```bash
npm run build    # vite build + flatten-dist → dist/ (xem 05-kien-truc/web.md)
npm run preview  # phục vụ bản React đã build ở cổng 4173, proxy /api → server 3001
```

Redis là tùy chọn: không đặt `UPSTASH_*`/`REDIS_URL` thì cache tắt, API vẫn chạy (fail-open). Muốn bật cache ở local thì chạy một container Redis dùng một lần (cổng 6380) và đặt `REDIS_URL=redis://127.0.0.1:6380`.
