# 02 — Cơ sở dữ liệu

PostgreSQL duy nhất, không có SQLite fallback. Production: Neon, nhánh `production`, database `neondb`. Test: container dùng một lần `postgres:16-alpine` trên máy EC2 (cổng 5433), xóa sau khi test.

## 11 bảng (theo tài liệu thiết kế 03 của nhóm, `server/schema.mjs`)

| Bảng | Nội dung chính |
|---|---|
| `users` | Tài khoản (mật khẩu scrypt + salt, không lưu plaintext), role (`user`/`admin`), city, channel, verified |
| `sessions` | Phiên đăng nhập (token) |
| `resources` | 62 tài nguyên: tên, category, city, giá (xu), tồn kho, tags, meta |
| `orders` | Đơn hàng: user, resource, số lượng, `booking_date`, amount (xu), status, code |
| `demands` | Nhu cầu hợp tác: user, tiêu đề, category, budget (xu), city, mô tả, **status** (`approved`/`pending`/…) |
| `comments` | Bình luận tài nguyên |
| `messages` | Tin nhắn |
| `favorites` | Yêu thích, khóa chính hợp `(user_id, resource_id)` — một user chỉ lưu một tài nguyên một lần |
| `events` | Sự kiện hệ thống |
| `audit_logs` | Nhật ký kiểm toán |
| `settings` | Cài đặt hệ thống |

## Quy tắc

- **Tiền tệ là số nguyên xu** trong DB và API (vd ¥280 = `28000`); không dùng float, không lưu số dư (balance tính lúc đọc).
- Mật khẩu: scrypt hash + salt; demo/admin lấy từ biến môi trường `DEMO_PASSWORD` / `ADMIN_PASSWORD`, không ghi trong repo.
- Mọi ghi đều chạy trong transaction, chỉ dùng câu truy vấn có tham số (parameterised) — không nối chuỗi SQL.
- Seed: lần khởi động đầu tạo 11 bảng + seed 62 tài nguyên + user demo. Nhu cầu id 3 ("小剧场巡演合作意向") có status `pending` — cố ý để demo luồng chờ duyệt.
- Không chạm vào DB của IMSF hay container khác trên EC2; DB test dùng một lần rồi xóa.
