# 01 — Tổng quan hệ thống Guiyan (桂演)

## Mục tiêu

Xây lại **文化惠票务系统 (Hệ thống vé văn hóa惠)** cho diễn nghệ Quảng Tây — phiên bản mới thay bản cũ yếu về trải nghiệm người dùng và tính đầy đủ chức năng. Mục tiêu: một hệ thống vé **đầy đủ, an toàn, tin cậy, thông minh**, hướng tới **"cửa ngõ tiêu dùng văn hóa một điểm + trung tâm dịch vụ ngành"**.

4 hướng nâng cấp 2026 (đúng 4 nhóm trong `upload.xlsx`):

1. Phân tích dữ liệu lớn (big data)
2. Chân dung người dùng chính xác (user portrait)
3. Dịch vụ thông minh bằng AI
4. Tích hợp tài nguyên sân khấu + tiết mục toàn khu vực

## Phạm vi

- **Dự án thực tập (Demo)**, nhóm 8 thành viên.
- **3 mặt:** web khách hàng (H5), WeChat mini-program, web admin.
- **29 module, 11 bảng, 3 giai đoạn, mốc M0–M5** (theo tài liệu nhóm).
- **Thanh toán, AI, blockchain chỉ là mô phỏng** — giao diện luôn ghi rõ là mô phỏng, không trình bày như thật.

## Kiến trúc tổng thể

```
┌──────────────┐   ┌──────────────┐   ┌──────────────────┐
│  Web khách   │   │  Web admin   │   │ WeChat mini-prog │
│  (tĩnh, Vercel)│  │ (riêng, Vercel)│  │ (offline/local)  │
└──────┬───────┘   └──────┬───────┘   └────────┬─────────┘
       │  /api/*          │  /api/admin/*     │  /api/*
       └──────────────┬───┴───────────────────┘
                      ▼
            ┌──────────────────┐
            │  API Node.js     │
            │  (Vercel Function│
            │   + server local)│
            └────────┬─────────┘
                     ▼
            ┌──────────────────┐
            │  PostgreSQL      │
            │  (Neon, nhánh    │
            │   production)    │
            └──────────────────┘
```

- Một API duy nhất phục vụ cả 3 mặt; web và mini-program chỉ chia sẻ đơn hàng khi cùng trỏ về một server đang chạy.
- Web admin là **web hoàn toàn riêng biệt** (thư mục `admin/`), không dùng frontend của web chính.
- Tiền tệ: **số nguyên xu (integer cents)** trong DB và API; hiển thị quy ra nhân dân tệ.

## Roadmap (M0–M5, theo tài liệu nhóm)

| Mốc | Nội dung (theo nhóm) | Trạng thái thực tế 2026-11-10 |
|---|---|---|
| M0–M2 | Thiết kế tổng thể, mô hình dữ liệu | Đã có bản thiết kế + hệ thống chạy được |
| M3–M4 | Xây dựng web + mini-program + backend | Web + backend thật đã live; mini-program chưa biên dịch thử trong WeChat DevTools |
| M5 | Nghiệm thu, bàn giao | Chưa tới |

## Trạng thái hiện tại (2026-11-10)

- Web live: https://guiyan-platform.vercel.app (62 tài nguyên, đăng nhập demo/admin hoạt động, yêu thích theo tài khoản).
- Backend thật trên Neon Postgres (11 bảng), 14/16 test đậu (2 test storage bỏ qua khi chưa cấu hình).
- Mini-program: chưa biên dịch thử; AppID đang là `touristappid` (chỉ xem trước, không phát hành được).
- Audit bảo mật đầy đủ: chỉ chạy khi hệ thống hoàn thiện (quyết định của Lam 2026-11-10).
