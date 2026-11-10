# 05 — Kiến trúc web khách hàng

## Tệp tin (`web/`)

```
web/
  index.html            # shell 15.951 byte (header, hero, sections, dialog) — bản gốc 1,8 MB đã tách
  user.html             # dashboard user (profile, đơn của tôi, yêu thích, nhu cầu)
  assets/
    css/main.css        # toàn bộ style (xem "Hệ thống thiết kế" dưới)
    js/data.js          # i18n (zh/vi/en, 165 key/ngôn ngữ) + CATS/RES/DEMANDS nhúng
    js/app.js           # logic SPA (đăng nhập, đặt vé, yêu thích, trợ lý, mini-program preview)
    js/api.js           # client API cho user.html (token sessionStorage)
    js/user.js          # logic dashboard user
    img/hero.webp       # ảnh hero
    img/spotlight.webp  # ảnh spotlight
```

- Shell + assets tái tạo đúng file đơn gốc (chỉ khác 4 chỗ thay thế có chủ ý). Không sửa UI khi tách file.
- `vercel.json` copy `web/` → `dist/` khi build.

## Hệ thống thiết kế (nguồn sự thật: `~/workspace/custom-skills/guiyan-platform/SKILL.md`)

- **Font:** display `"Noto Serif SC"` 600/700/900 (chữ 桂演, số chương 其一…, tiêu đề hero); body `"Be Vietnam Pro"` + `"Noto Sans SC"` + `system-ui`. Không dùng Inter.
- **Màu** (`:root` trong `main.css`, có dark mode): nền giấy `#f7f3ec`, mặt `#fffdf8`, chữ `#1c1710`, đỏ `#b03a1e`, vàng `#a97e1c`, ngọc `#0d6e5f`, đêm `#12100d`, kem `#f5eedd`; bo `20/14/9px`. Xanh WeChat `#07c160` chỉ dùng cho nút WeChat Mini. Không gradient tím-xanh, không 3 thẻ bằng nhau.
- **Chiều rộng trang:** `.wrap` `max-width: 1240px`, căn giữa, `padding: 0 20px` — header, hero, sections, footer cùng một wrap nên mép thẳng hàng.
- **Header (64px, sticky):** logo 桂演 đỏ ở **ngoài cùng bên trái**, nav đẩy sang phải (`margin-left: auto`), rồi chọn ngôn ngữ, nút WeChat Mini, Vé của tôi (kèm số đơn), khu vực tài khoản ở **ngoài cùng bên phải**. Mọi nút trên header đều là pill (`border-radius: 99px`); link nav không bao giờ xuống 2 dòng (`white-space: nowrap`).
- **Khi đã đăng nhập — chỉ hiện "Hi + tên":** một pill tối màu: vòng tròn avatar đỏ (ký tự đầu của tên) + `Hi {name}` + chevron. Chạm vào mở menu thả xuống (rộng tối thiểu 208px, căn phải): **Quản lý tài khoản** (→ `user.html`), gạch ngang, **Đơn hàng** (mở ngăn Vé của tôi), gạch ngang, **Đăng xuất** (màu đỏ) ở dưới cùng. Menu đóng khi bấm ra ngoài, bấm Esc, đổi ngôn ngữ, hoặc sau khi chọn. `web/index.html` (`app.js`) và `web/user.html` (`api.js`) dùng chung markup/CSS/hành vi — hai hàm `updateAuthUI()` phải giữ đồng bộ.
- **Chọn ngôn ngữ — tối giản:** icon quả cầu + `<select>` chỉ 3 mục: `中文`, `Tiếng Việt`, `English` (tiếng Trung đầu). Không có mục "sắp có" bị vô hiệu. **Ngôn ngữ mặc định: tiếng Trung (zh).**
- **Co giãn (responsive):** header không bao giờ wrap hay tràn. ≤1100px: ẩn tagline của logo, nút WeChat chỉ còn icon. ≤860px: nav thu vào nút hamburger (☰) mở panel thả xuống dưới thanh bar. ≤560px: ẩn nút WeChat, Vé của tôi chỉ còn icon + số, tên dài trong "Hi + tên" tự cắt ngắn (ellipsis).

## Hành vi

- **Yêu thích phải đăng nhập, lưu trên tài khoản:** chưa đăng nhập bấm tim → toast `favLogin` + mở hộp đăng nhập, không lưu local. Đã đăng nhập: tim chỉ đổi khi server xác nhận (`POST /api/favorites`); lỗi API không fallback local. Đăng xuất xóa tim.
- **Offline graceful fallback:** API không tới được thì dùng dữ liệu nhúng trong `data.js`, không vỡ trang (trừ đăng nhập — hộp đăng nhập báo lỗi trực tiếp).
- **Mô phỏng luôn ghi nhãn:** thanh toán, AI, blockchain là mô phỏng.
