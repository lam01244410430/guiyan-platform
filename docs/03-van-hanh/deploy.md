# 03 — Triển khai (Vercel + Neon)

## Vercel — deploy bản mới

```bash
cd <repo>
npx -y vercel@65.14.0 deploy --prod --yes
```

- Dùng CLI thật qua `npx` (binary global hay biến mất sau khi VM thay thế; auth còn trong `~/.local/share/com.vercel.cli/auth.json`, `whoami` → `lam01244410430`).
- Connector MCP của Muse bị chặn scope — không dùng.

## Cấu hình bắt buộc (đã làm một lần, kiểm tra lại khi tạo project mới)

1. **Root Directory = `.`** — `vercel project create` tự nhận `server` (vì `server/package.json` trông như app). Sửa bằng PATCH API: `rootDirectory: null`, `framework: "vite"`. `vercel.json` không sửa được mục này.
2. **Entrypoint `server/index.mjs`** — Vercel coi file trong `server/` là entrypoint; file phải tên `index.mjs` (đã đổi từ `app.mjs`).
3. **`vercel.json`** phải giống bản demo gốc: `framework: "vite"`, `buildCommand: "mkdir -p dist dist/admin && cp -r web/. dist/ && cp -r admin/. dist/admin/"`, `outputDirectory: "dist"`, `regions: ["sin1"]`, `functions: {"api/index.js": {"maxDuration": 60}}`, **`routes`** (không phải `rewrites`): `/api/(.*)` → `/api/index?route=$1`, `{handle: "filesystem"}`, `/.*` → `/index.html`.
4. **Biến môi trường Production** (Secret): `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `DEMO_PASSWORD`, `ADMIN_PASSWORD`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`.

## Các bẫy đã gặp

| Bẫy | Triệu chứng | Cách sửa |
|---|---|---|
| Root Directory = `server` | `FUNCTION_INVOCATION_FAILED`, mọi request rơi vào file server | PATCH project: `rootDirectory: null` + framework vite |
| Thiếu tiền tố `/api` ở frontend | Đăng nhập trên trình duyệt toàn lỗi 405, curl thì được | Mọi call site dùng `/api/*` (xem `04-van-hanh/su-co.md`) |
| `/admin` không có `/` cuối | Trang admin mất hết giao diện (CSS 404 → fallback trả trang chủ) | Asset của admin dùng đường dẫn tuyệt đối `/admin/assets/*` |
| Redirect tương đối ở admin | Đăng nhập xong nhảy về trang chủ thay vì dashboard | Redirect tuyệt đối `/admin/dashboard.html` |

## Neon — setup lần đầu

```bash
NEON_API_KEY=<surrogate mới> neon link
NEON_API_KEY=<surrogate mới> neon config init -s postgres,object-storage
NEON_API_KEY=<surrogate mới> neon deploy   # kéo 9 biến vào .env.local
```

- Mỗi lệnh cần một surrogate mới (lấy từ Secure Vault). OAuth trình duyệt không chạy (60 giây).
- `.env.local` đã gitignore — **không commit**.
