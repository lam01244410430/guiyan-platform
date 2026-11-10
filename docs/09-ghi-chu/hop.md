# 09 — Biên bản họp

Mẫu cho mỗi buổi họp. Ghi ngắn gọn: ngày, ai tham gia, quyết định, việc cần làm (ai + hạn).

## Mẫu

```
Ngày: YYYY-MM-DD
Tham gia: ...
Quyết định:
- ...
Việc cần làm:
- ... (người phụ trách, hạn)
```

## Các buổi đã ghi

### 2026-11-10 — Chốt hướng admin riêng + yêu thích theo tài khoản (chat với Lam)

- **Quyết định:** admin là web hoàn toàn riêng biệt (không dùng frontend web chính); dashboard + login chuyên nghiệp (TasteSkill); yêu thích phải đăng nhập mới lưu, lưu trên tài khoản user.
- **Việc cần làm:** tách admin ra `admin/`, sửa yêu thích — đã xong, đã commit `786e0cd`.

### 2026-11-10 — Ngôn ngữ mặc định + menu "Hi + tên" + docs kiến trúc (chat với Lam)

- **Quyết định:** tiếng Trung là mặc định; khi đăng nhập chỉ hiện "Hi + tên", chạm vào mở menu (quản lý tài khoản, đơn hàng, gạch ngang, đăng xuất); header dùng max trang (logo trái, tài khoản phải); chọn ngôn ngữ tối giản (chỉ 3 ngôn ngữ thật); header co giãn chuẩn quốc tế; viết lại skill giao diện chính (font, màu, giao diện) + tạo bộ docs kiến trúc `docs/`.
- **Việc cần làm:** đang thực hiện (header + skill + docs).
