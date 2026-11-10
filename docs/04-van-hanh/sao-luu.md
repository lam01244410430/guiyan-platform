# 04 — Sao lưu & khôi phục

## Cái gì là nguồn sự thật

| Thứ | Nguồn sự thật | Khôi phục bằng cách |
|---|---|---|
| Code | GitHub `main` (repo `lam01244410430/guiyan-platform`) | `git clone` / `git pull` |
| Dữ liệu production | Neon Postgres, nhánh `production` | Tạo lại từ seed (dữ liệu demo) hoặc branch Neon |
| Biến môi trường | Vercel Production + `.env.local` (máy làm việc) | Nhập lại từ Vercel / chạy `neon deploy` |
| Tài liệu kiến trúc | `docs/` trong repo | Theo repo |

## Dữ liệu demo

- DB production chứa dữ liệu seed + các đơn test tạo ra trong lúc kiểm chứng (đơn 131–134…). Đây là **dữ liệu demo, tạo lại được** — seed trong `server/seed.mjs` sinh lại 62 tài nguyên + user demo.
- Không cần backup định kỳ cho DB demo. Nếu DB hỏng: tạo nhánh Neon mới từ `production` (hoặc seed lại) rồi cập nhật `DATABASE_URL` trong Vercel.
- **Không bao giờ** commit `.env.local` hay bất kỳ secret nào (DATABASE_URL, API key, mật khẩu). File này đã gitignore; kiểm tra lại trước mỗi lần commit bằng `git status`.

## Máy EC2 (dev)

- IMSF và Guiyan trên EC2 là bản làm việc; code thật nằm trên GitHub. Mất EC2 thì clone lại từ GitHub.
- Không snapshot/volume thừa (giới hạn free tier EBS ≤ 30GB).
