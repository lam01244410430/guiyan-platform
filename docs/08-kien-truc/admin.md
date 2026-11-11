# 08 — Kiến trúc web admin

Web admin là **web hoàn toàn riêng biệt** — không dùng frontend của web chính, không nằm trong `web/`.

> Cập nhật 2026-11-11 (giai đoạn 1 — migration React): admin vanilla đã viết lại bằng **React 19 + Vite 6** (cùng MPA với web khách, entry `admin/index.html` + `admin/dashboard.html`). URL, API, design system riêng và hành vi chỉ xem giữ nguyên (parity). File JS vanilla cũ (`api.js`, `login.js`, `dashboard.js`) đã xóa.
>
> Cập nhật 2026-11-11 (giai đoạn 5 — premium dashboard, **chưa commit**): sidebar 8 mục chia 2 nhóm (5 view cơ bản + 3 view premium 趋势统计 / 经营分析 / 预警中心）, duyệt/từ chối nhu cầu, xuất CSV, mục 操作审计 trong view alerts. Sửa B-014..B-017 (xem quyết định 21–24 trong `02-ky-thuat/quyet-dinh-ky-thuat.md`). `npm test` 29/0/10, smoke 30/0, review độc lập APPROVE (không P1). Còn chờ kiểm tra trình duyệt bằng deploy verification.
>
> Cập nhật 2026-11-11 (redesign màu + search, **chưa commit**, gộp chung với giai đoạn 5): tông sáng hiện đại thay cho giấy ấm + serif kiểu "quyển sách" — nền `#fafbfc`, mặt thẻ trắng, tiêu đề sans (`Noto Sans SC` 700/900, không Inter), sidebar trắng, pine sáng `#0f766e`, login sáng; khung search dùng chung (`SearchBox.jsx`) ở cả 8 view, lọc client-side. Xem § "Tìm kiếm" dưới đây. `npm test` 29/0/10, smoke 30/0 giữ nguyên, review độc lập APPROVE (không P1). Còn chờ deploy verification + kiểm trình duyệt live rồi mới xin duyệt commit chung.

## Tệp tin (`admin/`)

```
admin/
  index.html              # trang đăng nhập: nền xanh đậm, chữ 桂演 lớn,
                          #   ô tài khoản/mật khẩu, gợi ý demo admin/admin123, link về trang chính
                          #   + <script type="module" src="assets/js/loginMain.jsx">
  dashboard.html          # dashboard: sidebar 8 mục (2 nhóm) + 8 view
                          #   + <script type="module" src="assets/js/dashboardMain.jsx">
  assets/
    css/admin.css         # design system riêng: sidebar xanh đậm 240px,
                          #   nền giấy, thẻ doanh thu rộng nổi bật + 4 thẻ nhỏ (không 3 thẻ bằng nhau)
    js/loginMain.jsx      # entry login: createRoot + <AdminLogin/>
    js/dashboardMain.jsx  # entry dashboard: createRoot + <AdminDashboard/>
    js/AdminLogin.jsx     # form đăng nhập admin
    js/AdminDashboard.jsx # 8 view: 5 view cơ bản (Tổng quan / Đơn hàng / Người dùng / Tài nguyên / Nhu cầu)
                          #   + 3 view premium (趋势统计 / 经营分析 / 预警中心, giai đoạn 5)
    js/SearchBox.jsx      # khung search dùng chung (redesign 2026-11-11): label thật,
                          #   icon search, nút clear, Esc, đếm kết quả, trạng thái rỗng
    js/cats.js            # bảng CATS 10 dòng (copy nguyên văn từ web data.js) + hàm catZh
                          #   thuần — tránh import data.js của web khách vào admin (P2-1)
    js/TrendChart.jsx     # chart SVG thuần (giai đoạn 5): line day/week/month, bar quarter,
                          #   toggle 金额/订单量, tooltip hover
    js/adminApi.js        # client riêng; session key riêng guiyan-admin-token / guiyan-admin-user
                          #   + apiPatch, apiDownloadCsv (giai đoạn 5)
```

## Hành vi

- Đăng nhập `admin/admin123` (tài khoản demo công khai trong tài liệu nhóm, file 08). Tài khoản demo (`demo`) đăng nhập được nhưng **không có quyền vào admin** — bị từ chối.
- Dashboard: 5 view cơ bản Tổng quan / Đơn hàng / Người dùng / Tài nguyên / Nhu cầu **chỉ xem**, có bảng thật, bộ lọc trạng thái — không có nút sửa/xóa. 3 view premium (giai đoạn 5, xem dưới) có tác vụ ghi: duyệt/từ chối nhu cầu, trigger/resolve cảnh báo, xuất CSV — tất cả đều yêu cầu token admin phía server (`requireAdmin`).
- Số liệu live: users 39, orders 133, revenue ¥158,028, resources 62, demands 9 (số đơn tăng dần theo test) — số liệu này là của **DB Neon production trước seed mới**; sau seed mới (139 user / 310 đơn) các con số tổng sẽ đổi theo DB đang chạy, không còn là 39/133 nữa.

## Giai đoạn 5 — premium dashboard (2026-11-11, chưa commit)

Dùng lại backend `server/routes/admin-insights.mjs` đã có từ trước migration (không viết lại backend, trừ sửa B-014 trong `buildSeries`).

- **趋势统计** (`GET /api/admin/stats?period=day|week|month|quarter`): chuỗi thời gian + chart SVG thuần, toggle 金额/订单量, tooltip hover; quarter 2026 Q3 47 đơn ¥127,203 / Q4 109 đơn ¥247,505 (DB test mới).
- **经营分析** (`GET /api/admin/analysis?period=`): KPIs, series, channels, ranking, venues, insights, report text (dòng đầu `"模拟经营分析报告"`, B-015).
- **预警中心** (`GET/POST /api/admin/alerts`): trigger/resolve cảnh báo mô phỏng (ghi rõ mô phỏng), ngưỡng threshold=5; mục 操作审计 đọc `GET /api/admin/audit-logs` (60 dòng mới nhất).
- **Duyệt nhu cầu**: `PATCH /api/admin/demands/:id` `{status: "approved"|"rejected"}` — nút chỉ hiện khi demand đang pending; CORS thêm `PATCH` (quyết định 23).
- **Xuất CSV**: `GET /api/admin/orders.csv` (BOM `EF BB BF`, 311 dòng trên DB test mới, header 9 cột) — nút export ở view trends + orders.
- **Lỗi đã sửa**: B-014 (quarter 500 — `nextBucket` + viết lại `buildSeries`), B-015 (sửa code), B-016/017/018/019 (sửa test). `npm test` 29 pass / 0 fail / 10 skip, smoke 30/0, curl matrix 25/25, review độc lập APPROVE (không P1; 4 P2 đã sửa: race đổi kỳ nhanh, badge chỉ xem sai ở 订单/需求， ghi chú "改判" thừa, `.gitignore` taste-skill). 11 P3 không blocker để sau commit (ghi trong báo cáo giai đoạn 5, chưa sửa).

## Tìm kiếm (redesign 2026-11-11, chưa commit)

Một component `SearchBox.jsx` dùng chung cho cả 8 view (label thật, `type="search"`, icon search Lucide `ui-search`, nút clear × chỉ hiện khi có chữ, `Esc` xóa, dòng đếm `role="status"`, trạng thái rỗng `没有找到匹配的结果` + nút `清除搜索`). Lọc **client-side** trên dữ liệu đã tải (không endpoint mới); query rỗng → danh sách gốc; đổi view reset query, đổi `period` không reset.

| View | Lọc theo trường | Dòng đếm |
|---|---|---|
| Tổng quan (最近订单） | `code`, `user_name`, `resource_name`, `booking_date`, trạng thái (mã + nhãn Trung); lọc toàn bộ orders rồi mới slice 8 | `找到 N 条（显示前 8 条）` (chỉ khi N > 8) |
| Đơn hàng | Như tổng quan; **AND** với chip trạng thái | `找到 N 条` |
| Người dùng | `name`, `username`, `email`, `city`, `channel`, `role`, `已认证`/`未认证` | `找到 N 条` |
| Tài nguyên | `name`, `category` (id + `catZh`), `city` | `找到 N 条` |
| Nhu cầu | `title`, `category` (id + `catZh`), `city`, `user_name`, trạng thái nhãn Trung | `找到 N 条` |
| 趋势统计 | Chỉ `label` chu kỳ; **chart không bị lọc** | `找到 N 条（显示最近 10 条）` (chỉ khi N > 10) |
| 经营分析 | Một khung lọc cả channels + ranking + venues; rank giữ số gốc | `找到 C 条渠道 · R 条资源 · V 个场馆` |
| 预警中心 | Một khung lọc cả alert cards + audit table (`user_name`/`action`/`detail`/`created_at`) | `找到 A 条预警 · L 条审计记录` |

Không lọc theo tiền (`amount`/`price`/`stock`/`budget`). Bảng màu mới (xem đầu file): nền `#fafbfc`, mặt thẻ trắng, tiêu đề sans, sidebar trắng, pine sáng `#0f766e`, blue `#2563eb`; chart chỉ đổi màu qua token trong `admin.css` (`TrendChart.jsx` không sửa).
- Số liệu live: users 39, orders 133, revenue ¥158,028, resources 62, demands 9 (số đơn tăng dần theo test) — số liệu này là của **DB Neon production trước seed mới**; sau seed mới (139 user / 310 đơn) các con số tổng sẽ đổi theo DB đang chạy, không còn là 39/133 nữa.
- Bảng nhu cầu dùng `GET /api/admin/demands` (thấy cả nhu cầu chờ duyệt) + cột trạng thái (已通过/待审核/已拒绝).
- Đăng xuất về lại trang login admin (có giao diện, không phải trang chữ trơn).

## Premium dashboard — GIAI ĐOẠN 5 (chưa làm)

Backend đã có sẵn và được giữ nguyên qua migration: `server/routes/admin-insights.mjs` — `GET /api/admin/stats?period=`, `GET /api/admin/analysis?period=`, `GET/POST /api/admin/alerts`, `GET /api/admin/orders.csv`, `PATCH /api/admin/demands/:id`, `GET /api/admin/audit-logs`. Giao diện React cho các endpoint này (thống kê theo kỳ + biểu đồ + phân tích/gợi ý + cảnh báo + CSV + duyệt nhu cầu + audit) làm ở **giai đoạn 5**, không làm trong migration. 4 lỗi liên quan đang chờ giai đoạn 5: **B-014** (`stats?period=quarter` 500), **B-015** (test đòi chuỗi báo cáo không tồn tại), **B-016** (assert BOM CSV), **B-017** (assert `kpis.orders`/`venues.length` stale) — xem myown `02.md` §7.

## Các bẫy đã sửa (chi tiết ở `04-van-hanh/su-co.md`)

- Asset và redirect của admin **phải dùng đường dẫn tuyệt đối** (`/admin/assets/*`, `/admin/dashboard.html`, `/admin/index.html`) — vì Vercel phục vụ `/admin` không `/` cuối mà không redirect, đường dẫn tương đối sẽ trỏ nhầm.
- Mọi API call của admin dùng `/api/*` (như web).
