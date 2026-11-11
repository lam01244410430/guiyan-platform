# 05 — Kiến trúc web khách hàng

> Cập nhật 2026-11-11 (giai đoạn 1 — migration React): frontend vanilla đã viết lại bằng **React 19 + Vite 6 (MPA)**. URL, API, DB schema, design tokens và hành vi giữ nguyên (parity) — chỉ đổi cách build/render. File JS vanilla cũ (`app.js`, `api.js`, `user.js`) đã xóa.

## Build (Vite MPA)

- `vite.config.js`: `appType: "mpa"`, plugin `@vitejs/plugin-react`, **4 entry** giữ đúng URL cũ — `/` ← `web/index.html`, `/user.html` ← `web/user.html`, `/admin/` ← `admin/index.html`, `/admin/dashboard.html` ← `admin/dashboard.html`. Không thêm URL mới; SPA fallback cho đường dẫn lạ vẫn ở `vercel.json` (trả homepage 200).
- `package.json`: `react` + `react-dom` `^19.0.0`, dev `vite ^6.1.0`, `@vitejs/plugin-react ^4.3.4`; scripts: `build` = `vite build && node scripts/flatten-dist.mjs`, `dev` = `vite` (cổng 5173), `preview` = `vite preview` (cổng 4173, proxy `/api` → Node server cổng 3001, qua `GUIYAN_API_PORT`).
- **B-011:** Vite MPA build ra `dist/web/` thay vì `dist/` — đã fix bằng `scripts/flatten-dist.mjs` (chuyển `dist/web/index.html` → `dist/index.html`, `dist/web/user.html` → `dist/user.html`, xóa `dist/web/`; `dist/admin/` giữ nguyên). Asset trong HTML build là đường dẫn tuyệt đối (`/assets/...`) nên dời file không ảnh hưởng. `vercel.json` hiện dùng `buildCommand: "npm run build"`, `outputDirectory: "dist"`.
- ⚠️ Cảnh báo build: chunk chính ~873 KB do ảnh base64 `CATIMG` nhúng trong `data.js` (file `dist/assets/main-*.js` hiện tại 877.075 byte) — chỉ là warning, tối ưu sau.
- Server Node local (`server/static.mjs`) vẫn phục vụ bản `web/`/`admin/` cũ nên kiểm chứng local dùng `vite preview` (proxy `/api` về server), không dùng `static.mjs` để xem bản React.

## Tệp tin (`web/`)

```
web/
  index.html            # shell: <div id="root"> + <script type="module" src="assets/js/main.jsx">
  user.html             # shell dashboard user + <script type="module" src="assets/js/userMain.jsx">
  assets/
    css/main.css        # toàn bộ style (xem "Hệ thống thiết kế" dưới) — giữ nguyên
    js/data.js          # i18n (zh/vi/en, 177 key/ngôn ngữ — đếm lại 2026-11-11, xem dưới)
                        #   + CATS/RES/DEMANDS/CATIMG nhúng (không đổi dữ liệu)
    js/main.jsx         # entry trang chính: createRoot + <App/>
    js/userMain.jsx     # entry user.html: createRoot + <UserDashboard/>
    js/App.jsx          # SPA khách: header, hero, sections, đặt vé, yêu thích, trợ lý, đăng nhập/đăng ký
    js/UserDashboard.jsx# dashboard user (profile, đơn của tôi, yêu thích, nhu cầu)
    js/chrome.jsx       # Header, LoginDialog, RegisterDialog, Toast (dùng chung 2 entry)
    js/apiClient.js     # client API (token sessionStorage, mọi call có tiền tố /api)
    img/hero.webp       # ảnh hero
    img/spotlight.webp  # ảnh spotlight
```

- Design tokens, CSS, header "Hi + tên", responsive và hành vi giữ nguyên 100% so với bản vanilla (parity đã kiểm chứng; xem "Hành vi" dưới). Hai hàm `updateAuthUI()` cũ nay là component `Header` dùng chung trong `chrome.jsx`.
- `vercel.json` copy `dist/` (kết quả build) khi deploy, không copy trực tiếp `web/` nữa.

## i18n — 177 key/ngôn ngữ (đếm lại 2026-11-11)

`web/assets/js/data.js`, biến `I18N`: **zh 177, vi 177, en 177** — 3 thứ tiếng có tập key giống hệt nhau (không key nào chỉ có ở 1 tiếng). Giai đoạn 1 là 165 key; giai đoạn 3 (đăng ký) thêm **12 key**: `registerBtn`, `registerTitle`, `namePh`, `emailPh`, `registerFailed`, `regUserTaken`, `regUserInvalid`, `regPassShort`, `regNameRequired`, `regEmailInvalid`, `regToRegister`, `regToLogin`. Ngôn ngữ mặc định vẫn tiếng Trung (zh); chọn ngôn ngữ vẫn bằng dropdown 3 mục.

## Hệ thống thiết kế (nguồn sự thật: `~/workspace/custom-skills/guiyan-platform/SKILL.md`)

- **Font:** display `"Noto Serif SC"` 600/700/900 (chữ 桂演, số chương 其一…, tiêu đề hero); body `"Be Vietnam Pro"` + `"Noto Sans SC"` + `system-ui`. Không dùng Inter.
- **Màu** (`:root` trong `main.css`, có dark mode): nền giấy `#f7f3ec`, mặt `#fffdf8`, chữ `#1c1710`, đỏ `#b03a1e`, vàng `#a97e1c`, ngọc `#0d6e5f`, đêm `#12100d`, kem `#f5eedd`; bo `20/14/9px`. Xanh WeChat `#07c160` chỉ dùng cho nút WeChat Mini. Không gradient tím-xanh, không 3 thẻ bằng nhau.
- **Chiều rộng trang:** `.wrap` `max-width: 1240px`, căn giữa, `padding: 0 20px` — header, hero, sections, footer cùng một wrap nên mép thẳng hàng.
- **Header (64px, sticky):** logo 桂演 đỏ ở **ngoài cùng bên trái**, nav đẩy sang phải (`margin-left: auto`), rồi chọn ngôn ngữ, nút WeChat Mini, Vé của tôi (kèm số đơn), khu vực tài khoản ở **ngoài cùng bên phải**. Mọi nút trên header đều là pill (`border-radius: 99px`); link nav không bao giờ xuống 2 dòng (`white-space: nowrap`).
- **Khi đã đăng nhập — chỉ hiện "Hi + tên":** một pill tối màu: vòng tròn avatar đỏ (ký tự đầu của tên) + `Hi {name}` + chevron. Chạm vào mở menu thả xuống (rộng tối thiểu 208px, căn phải): **Quản lý tài khoản** (→ `user.html`), gạch ngang, **Đơn hàng** (mở ngăn Vé của tôi), gạch ngang, **Đăng xuất** (màu đỏ) ở dưới cùng. Menu đóng khi bấm ra ngoài, bấm Esc, đổi ngôn ngữ, hoặc sau khi chọn. Component `Header` dùng chung trong `chrome.jsx` cho cả `index.html` và `user.html`.
- **Đăng ký (giai đoạn 3):** hộp `RegisterDialog` (mở từ link "没有账号？去注册" trong hộp đăng nhập và ngược lại): nhập tên, username, mật khẩu, email tùy chọn; lỗi hiển thị bằng key i18n `regUserTaken` / `regUserInvalid` / `regPassShort` / `regNameRequired` / `regEmailInvalid` (thông báo lỗi server cũng được hiện nguyên văn khi có). Đăng ký xong tự đăng nhập, đóng hộp, header chuyển sang "Hi + tên" — không cần đăng nhập lại, không có bước xác minh email.
- **Chọn ngôn ngữ — tối giản:** icon quả cầu + `<select>` chỉ 3 mục: `中文`, `Tiếng Việt`, `English` (tiếng Trung đầu). Không có mục "sắp có" bị vô hiệu. **Ngôn ngữ mặc định: tiếng Trung (zh).**
- **Co giãn (responsive):** header không bao giờ wrap hay tràn. ≤1100px: ẩn tagline của logo, nút WeChat chỉ còn icon. ≤860px: nav thu vào nút hamburger (☰) mở panel thả xuống dưới thanh bar. ≤560px: ẩn nút WeChat, Vé của tôi chỉ còn icon + số, tên dài trong "Hi + tên" tự cắt ngắn (ellipsis).

## Hành vi

- **Yêu thích phải đăng nhập, lưu trên tài khoản:** chưa đăng nhập bấm tim → toast `favLogin` + mở hộp đăng nhập, không lưu local. Đã đăng nhập: tim chỉ đổi khi server xác nhận (`POST /api/favorites`); lỗi API không fallback local. Đăng xuất xóa tim.
- **Offline graceful fallback:** API không tới được thì dùng dữ liệu nhúng trong `data.js`, không vỡ trang (trừ đăng nhập — hộp đăng nhập báo lỗi trực tiếp).
- **Mô phỏng luôn ghi nhãn:** thanh toán, AI, blockchain là mô phỏng.
