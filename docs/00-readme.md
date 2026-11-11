# Guiyan — Tài liệu kiến trúc hệ thống

> Chỉ mục của toàn bộ tài liệu trong `docs/`. **Luôn cập nhật file này** mỗi khi thêm, đổi tên hoặc xóa một tài liệu khác.
> Ngôn ngữ: tiếng Việt (thuật ngữ sản phẩm giữ tiếng Trung). Mọi số liệu phải lấy từ repo/code đã kiểm chứng, không bịa.

## Trạng thái (2026-11-11, sau migration — HEAD `90171d3`)

Lộ trình tuần tự của Lam: (1) migration React + Redis parity → (2) seed mới → (3) đăng ký → (4) docs → **(5) premium dashboard React — ĐÃ XÂY XONG 2026-11-11, chưa commit** (3 view premium + duyệt nhu cầu + CSV + audit, sửa B-014..B-017; `npm test` 29/0/10, smoke 30/0, review độc lập APPROVE không P1; còn chờ kiểm tra trình duyệt bằng deploy verification rồi mới xin Lam duyệt commit) → (6) các mục còn lại. Giai đoạn 1–4 đã xong, kiểm chứng và **đã commit + push lên main ngày 2026-11-11** (4 commit riêng từng giai đoạn: `2777747` React+Redis, `a6b58d1` seed, `f9909cd` đăng ký, `90171d3` docs; HEAD đã kiểm chứng bằng `git ls-remote`). Tài liệu dưới đây mô tả hệ thống **sau migration + giai đoạn 5 (chưa commit)**: frontend React, backend Node + Postgres + Redis cache, `docs/` trong repo là nguồn sự thật về kiến trúc. Thêm ngày 2026-11-11: thư mục `10-she-ji-wen-dang/` (thiết kế hệ thống theo khung của Lam, tiếng Trung — chưa commit).

## Cây tài liệu

| Đường dẫn | Nội dung | Cập nhật lần cuối |
|---|---|---|
| `00-readme.md` | Chỉ mục này | 2026-11-11 |
| `01-tong-quan/tong-quan.md` | Tổng quan: mục tiêu, phạm vi, kiến trúc tổng thể, roadmap | 2026-11-10 |
| `02-ky-thuat/api.md` | Hợp đồng API (endpoints, auth, đăng ký, admin-insights, X-Cache, tiền tệ, máy trạng thái) | 2026-11-11 |
| `02-ky-thuat/database.md` | Cơ sở dữ liệu: 11 bảng, cột email ở users, seed 139 user / 310 đơn | 2026-11-11 |
| `02-ky-thuat/quyet-dinh-ky-thuat.md` | Các quyết định kỹ thuật đã chốt (React + Vite, Redis, đăng ký, seed) | 2026-11-11 |
| `02-ky-thuat/tich-hop.md` | Tích hợp: Neon, Vercel, GitHub, WeChat, Redis/Upstash | 2026-11-11 |
| `03-van-hanh/deploy.md` | Triển khai: Vercel + Neon, các bẫy đã gặp | 2026-11-10 |
| `03-van-hanh/runbook.md` | Vận hành hằng ngày: kiểm tra, khởi động lại, kiểm chứng | 2026-11-10 |
| `04-van-hanh/giam-sat.md` | Giám sát: xem gì, xem ở đâu | 2026-11-10 |
| `04-van-hanh/su-co.md` | Xử lý sự cố: quy trình + các sự cố đã xảy ra | 2026-11-10 |
| `04-van-hanh/sao-luu.md` | Sao lưu & khôi phục | 2026-11-10 |
| `05-kien-truc/web.md` | Kiến trúc web khách hàng React MPA + hệ thống thiết kế | 2026-11-11 |
| `06-kien-truc/server.md` | Kiến trúc backend (dispatcher, routes, lib, Redis cache) | 2026-11-11 |
| `07-kien-truc/miniprogram.md` | Kiến trúc WeChat mini-program | 2026-11-10 |
| `08-kien-truc/admin.md` | Kiến trúc web admin React (riêng biệt; 5 view chỉ xem + 3 view premium giai đoạn 5, chưa commit) | 2026-11-11 |
| `09-ghi-chu/ghi-chu.md` | Ghi chú nhanh: link live, tài khoản demo, khoảng trống đã biết | 2026-11-10 |
| `09-ghi-chu/hop.md` | Biên bản họp (mẫu + các buổi đã họp) | 2026-11-10 |
| `09-ghi-chu/quyet-dinh.md` | Nhật ký quyết định (ai quyết, khi nào, nội dung) | 2026-11-11 |
| `09-ghi-chu/chua-phan-loai.md` | Danh sách chưa phân loại | 2026-11-10 |
| `10-she-ji-wen-dang/` (8 file, tiếng Trung) | Thiết kế hệ thống theo khung của Lam: 01 概述、02 总体架构、03 项目阶段、04 安全与稳定性、05 用户体验与界面设计、06 测试与部署（原文转录自 upload.docx）、07 技术风险与成本告知（原文转录） | 2026-11-11 |

## Quy ước đặt tên

- Thư mục đánh số `01`–`09` theo nhóm chủ đề; file trong thư mục đặt tên tiếng Việt không dấu, gạch nối.
- `00-readme.md` là chỉ mục duy nhất — mọi tài liệu mới phải được ghi vào bảng trên.
- Tài liệu mô tả **hệ thống như đã xây** (repo `lam01244410430/guiyan-platform`, nhánh `main`); đề xuất chưa duyệt ghi rõ là **đề xuất**, không viết như đã chốt.
- Tài khoản demo trong tài liệu là tài khoản công khai trong tài liệu của nhóm (file 08). Không ghi mật khẩu thật, khóa API, hay chuỗi kết nối vào đây — chúng chỉ nằm trong biến môi trường và `.env.local` (đã gitignore).
