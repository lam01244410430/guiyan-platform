# 04 — Xử lý sự cố

## Quy trình

1. Ghi lại triệu chứng chính xác (đường dẫn, mã lỗi, trình duyệt hay curl).
2. Kiểm tra log request Vercel trước khi đoán (xem `04-van-hanh/giam-sat.md`).
3. Sửa ở nguồn (repo), kiểm tra trên EC2 (test + smoke), deploy lại, kiểm tra bằng trình duyệt.
4. Ghi sự cố vào bảng dưới — để lần sau không lặp lại.

## Các sự cố đã xảy ra

### 1. Đăng nhập trên trình duyệt toàn lỗi, curl thì được (2026-11-10 ~19:03)

- **Triệu chứng:** demo/admin đăng nhập trên trình duyệt lỗi 5 lần; curl cùng tài khoản trả 200.
- **Nguyên nhân:** frontend gọi đường dẫn trần `/auth/login` (thiếu `/api`); server chỉ route `/api/*`. Vercel trả 405. GET thì lặng lẽ dùng dữ liệu nhúng trong trang nên trang chủ trông vẫn bình thường — lỗi chỉ lộ ở POST.
- **Sửa:** thêm `/api` vào đủ 25 call site web/admin + sửa comment `apiBase`. Bài học: kiểm tra curl dùng `/api` không bao giờ bắt được lỗi này — chỉ bấm thật trên trình duyệt mới thấy.

### 2. Trang login admin mất hết giao diện (2026-11-10 ~21:48)

- **Triệu chứng:** mở `/admin` thấy trang chữ trơn, không có giao diện.
- **Nguyên nhân:** Vercel phục vụ `/admin` (không `/` cuối) với 200 mà **không redirect** sang `/admin/`; asset link tương đối (`assets/css/admin.css`) bị trỏ nhầm sang `/assets/css/admin.css` (không tồn tại); route fallback trả trang chủ với 200 nên trình duyệt bỏ qua luôn file CSS.
- **Sửa:** mọi asset của admin dùng đường dẫn tuyệt đối (`/admin/assets/*`, link về `/index.html`). Quy tắc: trang nào nằm ở subpath thì asset dùng URL tuyệt đối từ gốc.

### 3. Đăng nhập admin xong nhảy về trang chủ (2026-11-10 ~21:55)

- **Triệu chứng:** sau khi đăng nhập ở `/admin`, trình duyệt vào `/dashboard.html` (trang chủ) thay vì dashboard admin.
- **Nguyên nhân:** cùng lỗi đường dẫn tương đối — `login.js` dùng `location.href="dashboard.html"`.
- **Sửa:** cả 6 redirect của admin dùng tuyệt đối (`/admin/dashboard.html` ×2, `/admin/index.html` ×4).

### 4. Thẻ thống kê ghi 9 nhu cầu, bảng chỉ liệt kê 8 (2026-11-10 ~21:55)

- **Triệu chứng:** stat card `需求 9`, bảng demands 8 dòng.
- **Nguyên nhân:** không phải lỗi đếm — danh sách công khai `/api/demands` giấu nhu cầu chưa duyệt; nhu cầu id 3 ("小剧场巡演合作意向") đang `pending`.
- **Sửa:** thêm endpoint admin `GET /api/admin/demands` (thấy tất cả, kể cả chờ duyệt) + cột trạng thái (已通过/待审核/已拒绝) trong bảng admin.

### 5. Test treo ở `npm test` (gặp nhiều lần)

- **Triệu chứng:** smoke script chạy mãi không xong.
- **Nguyên nhân:** `/tmp/smoke.sh` không tự khởi động Postgres; `npm test` treo khi không có DB.
- **Sửa:** luôn khởi động container `guiyan-test-pg` bằng tay trước khi chạy script (xem `03-van-hanh/runbook.md`).
