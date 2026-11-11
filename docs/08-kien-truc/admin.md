# 08 — Kiến trúc web admin

Web admin là **web hoàn toàn riêng biệt** — không dùng frontend của web chính, không nằm trong `web/`.

> Cập nhật 2026-11-11 (giai đoạn 1 — migration React): admin vanilla đã viết lại bằng **React 19 + Vite 6** (cùng MPA với web khách, entry `admin/index.html` + `admin/dashboard.html`). URL, API, design system riêng và hành vi chỉ xem giữ nguyên (parity). File JS vanilla cũ (`api.js`, `login.js`, `dashboard.js`) đã xóa.

## Tệp tin (`admin/`)

```
admin/
  index.html              # trang đăng nhập: nền xanh đậm, chữ 桂演 lớn,
                          #   ô tài khoản/mật khẩu, gợi ý demo admin/admin123, link về trang chính
                          #   + <script type="module" src="assets/js/loginMain.jsx">
  dashboard.html          # dashboard: sidebar 5 mục + 5 view
                          #   + <script type="module" src="assets/js/dashboardMain.jsx">
  assets/
    css/admin.css         # design system riêng: sidebar xanh đậm 240px,
                          #   nền giấy, thẻ doanh thu rộng nổi bật + 4 thẻ nhỏ (không 3 thẻ bằng nhau)
    js/loginMain.jsx      # entry login: createRoot + <AdminLogin/>
    js/dashboardMain.jsx  # entry dashboard: createRoot + <AdminDashboard/>
    js/AdminLogin.jsx     # form đăng nhập admin
    js/AdminDashboard.jsx # 5 view chỉ xem: Tổng quan / Đơn hàng / Người dùng / Tài nguyên / Nhu cầu
    js/adminApi.js        # client riêng; session key riêng guiyan-admin-token / guiyan-admin-user
```

## Hành vi

- Đăng nhập `admin/admin123` (tài khoản demo công khai trong tài liệu nhóm, file 08). Tài khoản demo (`demo`) đăng nhập được nhưng **không có quyền vào admin** — bị từ chối.
- Dashboard **chỉ xem**: 5 view Tổng quan / Đơn hàng / Người dùng / Tài nguyên / Nhu cầu, có bảng thật, bộ lọc trạng thái — **không có nút sửa/xóa/duyệt**.
- Số liệu live: users 39, orders 133, revenue ¥158,028, resources 62, demands 9 (số đơn tăng dần theo test) — số liệu này là của **DB Neon production trước seed mới**; sau seed mới (139 user / 310 đơn) các con số tổng sẽ đổi theo DB đang chạy, không còn là 39/133 nữa.
- Bảng nhu cầu dùng `GET /api/admin/demands` (thấy cả nhu cầu chờ duyệt) + cột trạng thái (已通过/待审核/已拒绝).
- Đăng xuất về lại trang login admin (có giao diện, không phải trang chữ trơn).

## Premium dashboard — GIAI ĐOẠN 5 (chưa làm)

Backend đã có sẵn và được giữ nguyên qua migration: `server/routes/admin-insights.mjs` — `GET /api/admin/stats?period=`, `GET /api/admin/analysis?period=`, `GET/POST /api/admin/alerts`, `GET /api/admin/orders.csv`, `PATCH /api/admin/demands/:id`, `GET /api/admin/audit-logs`. Giao diện React cho các endpoint này (thống kê theo kỳ + biểu đồ + phân tích/gợi ý + cảnh báo + CSV + duyệt nhu cầu + audit) làm ở **giai đoạn 5**, không làm trong migration. 4 lỗi liên quan đang chờ giai đoạn 5: **B-014** (`stats?period=quarter` 500), **B-015** (test đòi chuỗi báo cáo không tồn tại), **B-016** (assert BOM CSV), **B-017** (assert `kpis.orders`/`venues.length` stale) — xem myown `02.md` §7.

## Các bẫy đã sửa (chi tiết ở `04-van-hanh/su-co.md`)

- Asset và redirect của admin **phải dùng đường dẫn tuyệt đối** (`/admin/assets/*`, `/admin/dashboard.html`, `/admin/index.html`) — vì Vercel phục vụ `/admin` không `/` cuối mà không redirect, đường dẫn tương đối sẽ trỏ nhầm.
- Mọi API call của admin dùng `/api/*` (như web).
