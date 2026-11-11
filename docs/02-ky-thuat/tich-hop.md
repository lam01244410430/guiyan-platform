# 02 — Tích hợp

## Neon (Postgres + Object Storage)

- Project `guiyan-platform`, id `crimson-term-40745510`, region `aws-ap-southeast-1` (Singapore), nhánh `production` (`br-cold-queen-a1f0f0be`), database `neondb`, bucket `uploads`.
- Better Auth **OFF** — Guiyan giữ hệ thống đăng nhập scrypt + session của riêng nó.
- 9 biến môi trường nằm trong `.env.local` (đã gitignore, không commit): `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED`, `NEON_BRANCH`, `NEON_BRANCH_ID`, `NEON_FUNCTION_HOST_SUFFIX`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`.
- Storage: `@aws-sdk/client-s3` + presigner, `forcePathStyle: true` (bắt buộc với Neon). Chưa cấu hình → `/api/storage/*` trả 503, API còn lại vẫn chạy.
- **Máy này không kết nối trực tiếp được tới Neon Postgres** (egress proxy trả HTTP thay cho TLS handshake) — mọi kết nối DB thật chạy từ máy EC2. API Neon (HTTPS) thì chạy được từ đây.
- Đăng nhập Neon: OAuth trên trình duyệt **không chạy** (chờ 60 giây rồi hết hạn). Dùng API key trong Secure Vault (custom.neon, project-scoped) hoặc surrogate `NEON_API_KEY` mới cho mỗi lệnh CLI.

## Vercel

- Project `guiyan-platform`, id `prj_QBg081xC5J9uR2fP2erejqqJbRkg`, scope `lam01244410430`, region `sin1`. Live: https://guiyan-platform.vercel.app
- Deploy **chỉ bằng Vercel CLI thật** (`npx -y vercel@65.14.0`); connector MCP của Muse bị chặn scope (403) — không dùng.
- Biến môi trường Production: `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED`, `DEMO_PASSWORD`/`ADMIN_PASSWORD`, 4 biến `AWS_*`. **Chưa có** `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — pending Lam tạo Upstash (xem mục Redis ở trên); build vẫn chạy, cache trên production tạm tắt (fail-open).
- Cấu hình (xem `03-van-hanh/deploy.md`): Root Directory phải là `.` (không phải `server`), framework Vite, entry `server/index.mjs`, `vercel.json` dùng `routes` (không phải `rewrites`). `vercel.json` hiện tại: `buildCommand: "npm run build"`, `outputDirectory: "dist"` (xem `05-kien-truc/web.md` về flatten-dist).

## GitHub

- Repo https://github.com/lam01244410430/guiyan-platform.git, nhánh `main` là nguồn sự thật.
- Push **chỉ qua SSH key trên máy EC2** (`~/.ssh/id_ed25519_github`); PAT đã chết (401). Máy này không có SSH key GitHub.
- File > ~200KB phải tách thành chunk 128KB khi chuyển qua EC2 (egress proxy gãy ở ~1MB), ghép lại rồi kiểm tra md5.

## Redis / Upstash (thêm giai đoạn 1, 2026-11-11)

- **Vị trí:** `server/lib/cache.mjs`, dùng bởi `routes/resources.mjs`, `routes/assistant.mjs`, `routes/admin.mjs`, `routes/admin-insights.mjs`. Session vẫn ở Postgres (bảng `sessions`), không chuyển sang Redis.
- **Fail-open tuyệt đối:** Redis chết, timeout, hay thiếu dependency đều chỉ ghi log (tên key + mã lỗi, không ghi giá trị/URL/token) rồi đọc thẳng Postgres; không có phương thức cache nào ném lỗi ra request. Timeout mỗi thao tác 1s, timeout kết nối 3s; client node-redis tắt offline queue và không tự nối lại để lỗi nhanh thay vì xếp hàng chờ.
- **Driver (thứ tự ưu tiên, cái đầu khớp sẽ thắng):**
  1. **Upstash REST** — khi có đủ cả `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (dùng `@upstash/redis`, HTTP không trạng thái, an toàn cho Vercel serverless). ⚠️ **PENDING:** chưa có 2 biến này trên Vercel — cần Lam tạo tài khoản Upstash (hoặc qua Vercel Marketplace); code tự nhận biến khi có, không cần sửa code.
  2. **node-redis RESP** — khi có `REDIS_URL` (dev/test: docker redis, vd `REDIS_URL=redis://127.0.0.1:6380`).
  3. **Tắt** — không có biến nào: mọi phương thức thành no-op, API đọc thẳng Postgres.
- **Key / TTL (namespace `guiyan:*`):** `guiyan:resources:list` 300s (chỉ list tài nguyên không lọc, sort=hot; query có lọc bỏ qua cache), `guiyan:resources:hot` 300s (top-3 hot cho assistant), `guiyan:admin:stats:total` 60s, `guiyan:admin:stats:{day|week|month|quarter}` 60s, `guiyan:admin:analysis:{day|week|month|quarter}` 60s. Xóa cache (bust) theo nhóm: tạo/chuyển trạng thái đơn → bust stats + analysis + resources; tạo/duyệt nhu cầu → bust stats; kích hoạt/xử lý cảnh báo mô phỏng → bust analysis. Header `X-Cache: HIT/MISS` cho biết nguồn dữ liệu (xem `api.md`).
- **Dev local:** chạy một container Redis dùng một lần, mở cổng 6380, rồi đặt `REDIS_URL=redis://127.0.0.1:6380` khi chạy server/test; dừng/xóa container sau khi xong (máy EC2 free-tier, Postgres/Redis chỉ bật khi test).

## WeChat mini-program

- Nằm trong repo (`miniprogram/`), dùng chung API `/api/*` khi trỏ về server đang chạy; offline thì dùng dữ liệu local.
- `project.config.json` đang dùng AppID `touristappid` — chỉ xem trước, **không phát hành được**; cần AppID thật của nhóm.
- Chưa biên dịch thử trong WeChat DevTools lần nào.
