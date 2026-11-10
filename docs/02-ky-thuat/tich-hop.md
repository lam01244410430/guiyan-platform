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
- Biến môi trường Production: `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED`, `DEMO_PASSWORD`/`ADMIN_PASSWORD`, 4 biến `AWS_*`.
- Cấu hình (xem `03-van-hanh/deploy.md`): Root Directory phải là `.` (không phải `server`), framework Vite, entry `server/index.mjs`, `vercel.json` dùng `routes` (không phải `rewrites`).

## GitHub

- Repo https://github.com/lam01244410430/guiyan-platform.git, nhánh `main` là nguồn sự thật.
- Push **chỉ qua SSH key trên máy EC2** (`~/.ssh/id_ed25519_github`); PAT đã chết (401). Máy này không có SSH key GitHub.
- File > ~200KB phải tách thành chunk 128KB khi chuyển qua EC2 (egress proxy gãy ở ~1MB), ghép lại rồi kiểm tra md5.

## WeChat mini-program

- Nằm trong repo (`miniprogram/`), dùng chung API `/api/*` khi trỏ về server đang chạy; offline thì dùng dữ liệu local.
- `project.config.json` đang dùng AppID `touristappid` — chỉ xem trước, **không phát hành được**; cần AppID thật của nhóm.
- Chưa biên dịch thử trong WeChat DevTools lần nào.
