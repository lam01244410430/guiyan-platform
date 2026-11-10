# 06 — Kiến trúc backend

## Tệp tin (`server/`)

```
server/
  index.mjs        # dispatcher: giữ đúng thứ tự kiểm tra route gốc (admin cuối cùng)
  server.mjs       # khởi động HTTP server (port 3001 local)
  postgres.mjs     # kết nối Postgres (DATABASE_URL bắt buộc, fail fast)
  schema.mjs       # tạo 11 bảng
  seed.mjs         # seed 62 tài nguyên + user demo + nhu cầu (id 3 pending)
  storage.mjs      # object storage Neon S3 (fail-soft 503 khi chưa cấu hình)
  lib/
    http.mjs       # validator/helper (assert, text, int, safeUser…)
    context.mjs    # createContext (req, session, send, all/get/run…)
  routes/
    misc.mjs       # health, categories
    resources.mjs  # tài nguyên
    auth.mjs       # login/logout
    orders.mjs     # đơn hàng + chuyển trạng thái
    demands.mjs    # nhu cầu
    favorites.mjs  # yêu thích
    assistant.mjs  # trợ lý mô phỏng
    storage.mjs    # storage endpoints
    admin.mjs      # stats, orders, users, demands (chỉ xem, admin-only)
  static.mjs       # phục vụ file tĩnh web/ + admin/ (chặn traversal: \, .., symlink)
```

## Quy tắc

- **Dispatcher giữ đúng thứ tự route gốc**, admin check cuối. Thêm route mới phải giữ thứ tự này.
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
