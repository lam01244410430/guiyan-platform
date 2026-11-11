# 02 — Cơ sở dữ liệu

PostgreSQL duy nhất, không có SQLite fallback. Production: Neon, nhánh `production`, database `neondb`. Test: container dùng một lần `postgres:16-alpine` trên máy EC2 (cổng 5433), xóa sau khi test.

## 11 bảng (theo tài liệu thiết kế 03 của nhóm, `server/schema.mjs`)

| Bảng | Nội dung chính |
|---|---|
| `users` | Tài khoản (mật khẩu scrypt + salt, không lưu plaintext), role (`user`/`admin`), city, channel, verified; **cột `email` TEXT (nullable)** — thêm ở giai đoạn 3 cho đăng ký (trước đó bảng chưa có cột email; seed mới dùng địa chỉ suy ra `<username>@example.com` chỉ trong chú thích, không lưu) |
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
- **Seed mới, giai đoạn 2 (2026-11-11, `server/seed.mjs`):** thêm **100 user** (id 40–139) + **180 đơn** bên cạnh dữ liệu demo, không sửa dữ liệu demo. Tổng sau seed: **139 user / 310 đơn** (kiểm chứng bằng `tests/seed-integrity.test.mjs`, assert đúng 2 con số này). User mới: tên tiếng Trung hư cấu, 10 thành phố Quảng Tây, ngày tạo 2026-08-15..2026-11-08; đơn mới chỉ dùng 22 tài nguyên gốc nên `amount = quantity × giá` luôn đúng; mỗi user mới có 0–3 đơn (cứ user thứ 10 thì 0 đơn), kèm favorites/comments/messages/demands liên kết. **Toàn vẹn khóa ngoại:** mọi đơn/comment/favorite/demand/message mới đều trỏ về user/resource có thật (id user 40–139, resource 1–22) — không có dòng mồ côi. 100 user mới dùng chung một mật khẩu demo công khai `guiyan2026` (cùng loại credential demo như `demo123`/`admin123`); dữ liệu demo + `demo/demo123` được GIỮ làm fallback tạm thời, chỉ bỏ sau khi migration + seed mới kiểm chứng ổn định và Lam duyệt riêng; DB Neon production không reset.
- Không chạm vào DB của IMSF hay container khác trên EC2; DB test dùng một lần rồi xóa.
