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

## Quyết định chưa chốt (đề xuất, không phải quy tắc)

- Mini-program: đổi AppID `touristappid` sang AppID thật của nhóm để phát hành.
- Biên dịch thử mini-program trong WeChat DevTools (chưa ai làm).
- Các đề xuất trong tài liệu nhóm chưa được Lam duyệt vẫn là đề xuất.
