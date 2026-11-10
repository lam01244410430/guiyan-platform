# 08 — Kiến trúc web admin

Web admin là **web hoàn toàn riêng biệt** — không dùng frontend của web chính, không nằm trong `web/`.

## Tệp tin (`admin/`)

```
admin/
  index.html              # trang đăng nhập (1.405 byte): nền xanh đậm, chữ 桂演 lớn,
                          #   ô tài khoản/mật khẩu, gợi ý demo admin/admin123, link về trang chính
  dashboard.html          # dashboard (4.778 byte): sidebar 5 mục + 5 view
  assets/
    css/admin.css         # design system riêng (8.515 byte): sidebar xanh đậm 240px,
                          #   nền giấy, thẻ doanh thu rộng nổi bật + 4 thẻ nhỏ (không 3 thẻ bằng nhau)
    js/api.js             # client riêng; session key riêng guiyan-admin-token / guiyan-admin-user
    js/login.js           # đăng nhập; tài khoản không phải admin bị từ chối
    js/dashboard.js       # boot guard, tải 5 endpoint, chuyển view, 401 → login, 403 → trang cấm
```

## Hành vi

- Đăng nhập `admin/admin123` (tài khoản demo công khai trong tài liệu nhóm, file 08). Tài khoản demo (`demo`) đăng nhập được nhưng **không có quyền vào admin** — bị từ chối.
- Dashboard **chỉ xem**: 5 view Tổng quan / Đơn hàng / Người dùng / Tài nguyên / Nhu cầu, có bảng thật, bộ lọc trạng thái — **không có nút sửa/xóa/duyệt**.
- Số liệu live: users 39, orders 133, revenue ¥158,028, resources 62, demands 9 (số đơn tăng dần theo test).
- Bảng nhu cầu dùng `GET /api/admin/demands` (thấy cả nhu cầu chờ duyệt) + cột trạng thái (已通过/待审核/已拒绝).
- Đăng xuất về lại trang login admin (có giao diện, không phải trang chữ trơn).

## Các bẫy đã sửa (chi tiết ở `04-van-hanh/su-co.md`)

- Asset và redirect của admin **phải dùng đường dẫn tuyệt đối** (`/admin/assets/*`, `/admin/dashboard.html`, `/admin/index.html`) — vì Vercel phục vụ `/admin` không `/` cuối mà không redirect, đường dẫn tương đối sẽ trỏ nhầm.
- Mọi API call của admin dùng `/api/*` (như web).
