# 07 — Kiến trúc WeChat mini-program

## Tệp tin (`miniprogram/`)

```
miniprogram/
  app.js / app.json / app.wxss   # cấu hình app, globalData.apiBase (rỗng = offline)
  project.config.json            # AppID touristappid (xem dưới)
  utils/api.js                   # client API — dùng đúng đường dẫn /api/* (không bị lỗi thiếu /api như web)
  pages/                         # home, catalog, demands, orders, …
```

## Hành vi

- 4 tab dưới đáy: Trang chủ · Danh mục · Sàn nhu cầu · Vé của tôi — khớp 1-1 với web.
- Cùng 62 tài nguyên, cùng giá, cùng quy trình đặt (đặt → xác nhận → thanh toán mô phỏng → hoàn tất, hủy/hoàn được).
- Ngôn ngữ theo ô chọn trên web (Trung/Việt/Anh đồng bộ).
- Offline: dùng dữ liệu local; online (cùng trỏ về một server đang chạy) thì đơn hàng chia sẻ với web.
- Yêu thích của mini-program là **local offline** — không theo quy tắc "yêu thích phải đăng nhập" của web (quy tắc đó chỉ áp cho web).

## Khoảng trống đã biết

- **Chưa biên dịch thử trong WeChat DevTools lần nào** (không có DevTools trong môi trường làm việc). Chỉ có `node --check`, kiểm tra cân bằng JSON/WXML và test logic stub.
- **AppID đang là `touristappid`** — chỉ xem trước, **không phát hành được**. Cần AppID thật của nhóm để release.
- Đây là việc của Lam/nhóm (cần DevTools + tài khoản WeChat của nhóm), không làm được từ phía server.
