# Guiyan — Khung xương backend + frontend (tách file, không đổi UI/logic)

Ngày: 2026-11-10. Lam yêu cầu: tách thành file cho chuyên nghiệp, dễ bảo trì/nâng cấp;
KHÔNG chỉnh giao diện (frontend hiện tại đã đẹp), KHÔNG đổi logic, kiến trúc, UI/UX.
Thêm 2 trang còn thiếu: admin dashboard và user dashboard, dùng đúng khuôn mẫu
hiện tại. Xong thì commit + push (Lam đã duyệt commit/push cho việc này).

## Hiện trạng (đã đo)

- `web/index.html` 1.818.482 byte = 1 file duy nhất:
  - CSS 27.246 byte (1 khối `<style>`)
  - HTML markup ~15 KB thật + 2 ảnh base64 WebP nhúng (hero 316.934 byte,
    spotlight 342.122 byte, đều RIFF/WEBP hợp lệ)
  - JS1 862.332 byte: i18n (I18N 106 key × 3 ngôn ngữ) + CATS/CITYN/UNITN/
    CATIMG (10 ảnh base64, giữ nguyên trong data) + RES (62) + DEMANDS + money/state
  - JS2 34.315 byte: logic SPA (API layer, render, auth, booking…)
  - JS1 dùng `var` global, JS2 tham chiếu các global đó (RES, DEMANDS, CATS…).
- `server/index.mjs` 697 dòng: toàn bộ API trong 1 file (createApp + handleApi
  if-chain + createRequestHandler + static serve `/` và `/index.html`).
- `server/server.mjs` bootstrap (import createApp từ `./index.mjs`, không đổi).
- `api/index.js` (Vercel function) import createApp từ `../server/index.mjs` — giữ nguyên.
- users có cột `role` (`user`/`admin`); tài khoản admin đã seed từ ADMIN_PASSWORD.

## Frontend mục tiêu (web/)

```
web/
  index.html               # shell SPA khách hàng: markup gốc, giữ nguyên từng byte
                           # trừ: <style> -> link css, 2 <script> -> script src,
                           # 2 ảnh base64 -> assets/img/*.webp
  admin.html               # MỚI: admin dashboard (trang riêng, không lẫn vào SPA khách)
  user.html                # MỚI: user dashboard (trang riêng)
  assets/
    css/main.css           # CSS trích verbatim từ <style>; chỉ THÊM đoạn cuối
                           # /* dashboards */ cho bảng/stat (không sửa rule cũ)
    js/
      data.js              # JS1 verbatim (I18N/CATS/RES/DEMANDS…) + THÊM key i18n
                           # cho admin/user (additive, không sửa key cũ)
      app.js               # JS2 verbatim (logic SPA, không sửa 1 dòng)
      api.js               # MỚI: client API dùng chung cho 2 dashboard
                           # (cùng contract với app.js: same-origin /api,
                           # token localStorage, timeout 5s, fallback im lặng)
      admin.js             # MỚI: logic admin dashboard
      user.js              # MỚI: logic user dashboard
    img/
      hero.webp            # trích từ <img> hero (base64 -> file, md5 khớp)
      spotlight.webp       # trích từ <img> spotlight
```

- Thứ tự load giữ nguyên: data.js trước, app.js sau (classic script, không module).
- `vercel.json` buildCommand đổi thành `mkdir -p dist && cp -r web/. dist/`
  (copy cả thư mục web, không chỉ index.html). Routes giữ nguyên
  (`/.*` -> `/index.html` vẫn là fallback SPA; admin.html/user.html là file
  thật nên filesystem handle phục vụ trực tiếp).
- Admin/user dashboard dùng đúng topbar/nav/footer và class CSS của index.html
  (copy khối header/footer verbatim, đổi nội dung main). Ngôn ngữ: dùng chung
  hệ i18n (data.js + data-i18n), mặc định tiếng Việt như SPA.

## Backend mục tiêu (server/) — Codex làm trên EC2

```
server/
  server.mjs               # bootstrap, KHÔNG ĐỔI
  index.mjs                # createApp: build ctx, BẢNG ROUTING (if-chain, giữ
                           # nguyên thứ tự check), createRequestHandler,
                           # static serve qua static.mjs, createServer.
                           # Vẫn export createApp (api/index.js + server.mjs dùng).
  lib/
    http.mjs               # assert, text, int, date, time, yuan, today,
                           # safeUser, resourceRow, bookingType (chuyển verbatim)
    context.mjs            # createContext(database): all/get/run/audit/notify/
                           # transaction/resourceSelect/orderRows + storage
  routes/
    misc.mjs               # GET /api/health, GET /api/categories
    resources.mjs          # GET /api/resources, GET /api/resources/:id
    auth.mjs               # POST /api/auth/login, POST /api/auth/logout
    orders.mjs             # GET/POST /api/orders, POST /api/orders/:id/(confirm|
                           # pay|complete|cancel|refund)
    demands.mjs            # GET/POST /api/demands
    favorites.mjs          # GET/POST /api/favorites, DELETE /api/favorites/:id
    assistant.mjs          # GET /api/assistant (+ ANSWERS)
    storage.mjs            # GET/POST/DELETE /api/storage/* (dùng server/storage.mjs)
    admin.mjs              # MỚI, chỉ đọc, role=admin (403 nếu không phải admin):
                           # GET /api/admin/stats {users, orders, revenue_cents
                           #   (sum amount status paid/completed), resources,
                           #   demands, orders_by_status}
                           # GET /api/admin/orders (join user + resource, 200 mới nhất)
                           # GET /api/admin/users (safeUser, không password)
  static.mjs               # phục vụ thư mục web/: / -> index.html, /index.html,
                           # /admin.html, /user.html, /assets/* (css/js/webp/png/
                           # json/svg/ico). Chặn traversal (..). 404 JSON nếu
                           # không phải /api/* và không phải file web.
  postgres.mjs, schema.mjs, seed.mjs, storage.mjs  # KHÔNG ĐỔI
```

- Mỗi route module export hàm nhận 1 `ctx` duy nhất:
  `{ req, send, url, p, b, session, needUser, all, get, run, audit, notify,
  transaction, resourceSelect, orderRows, storage, categories, time, yuan, ANSWERS }`
  và trả `true` nếu đã xử lý, `false` nếu không khớp (để dispatcher thử route sau).
- Dispatcher giữ NGUYÊN thứ tự check như handleApi hiện tại (health, categories,
  resources list, resources detail, login, logout, orders list, orders create,
  orders transition, demands list, demands create, favorites list, favorites
  toggle, favorites delete, assistant, storage health/upload/url/delete, 404).
- KHÔNG đổi: SQL, thông báo lỗi, status code, state machine, transition,
  permission (confirm vẫn owner-only; refund vẫn paid->refunded trực tiếp).
  Chỉ thêm: 3 endpoint admin chỉ-đọc + static serve mở rộng.
- Cập nhật root `package.json` build script: node --check cho mọi file server
  mới (lib/*, routes/*, static.mjs) + api/index.js.
- Cập nhật `server/README.md`: mô tả cấu trúc mới + 3 endpoint admin.
  (root README.md do Peter sửa phần Vercel; Codex không chạm root README.)
- Header comment của server/index.mjs cũ nói "no admin dashboard" — cập nhật theo
  quyết định mới của Lam (admin dashboard thêm ngày 2026-11-10, chỉ đọc).

## Admin dashboard (nội dung)

- Thẻ stat: tổng user, tổng đơn, doanh thu (paid+completed, tính bằng cents),
  tổng tài nguyên (62), nhu cầu.
- Bảng đơn hàng: code, user, resource, số tiền, ngày, trạng thái (chỉ xem).
- Bảng user: tên, username, role, city, channel, verified (chỉ xem).
- Bảng tài nguyên + nhu cầu (chỉ xem, dùng /api/resources + /api/demands có sẵn).
- Không có nút sửa/xóa/duyệt: admin chỉ xem ở bước này (không đổi permission).
- Đăng nhập bằng tài khoản admin (ADMIN_PASSWORD); không phải admin -> 403 + thông báo.

## User dashboard (nội dung)

- Thẻ hồ sơ: tên, city, tuổi, kênh, sở thích, verified (từ login response).
- Stat của tôi: đơn theo trạng thái, số favorite.
- Đơn của tôi: list từ GET /api/orders + nút thao tác có sẵn (xác nhận/thanh
  toán/hoàn thành/hủy/hoàn tiền — đúng transition như SPA My Tickets).
- Favorite của tôi: GET /api/favorites.
- Nhu cầu của tôi: GET /api/demands lọc client-side theo user_id.

## Kiểm chứng (bắt buộc trước commit)

1. Backend: suite trên EC2 disposable Postgres: 14 pass, 0 fail, 2 skipped
   (như trước) + smoke: /api/health, 62 resources, login demo + admin,
   /api/admin/stats + /api/admin/orders + /api/admin/users (admin ok, demo 403),
   GET /admin.html + /user.html 200 từ local server.
2. Frontend: CSS/JS trích ra byte-identical với bản gốc (trừ 2 ảnh đã tách);
   index.html shell không còn <style> hay <script> inline (trừ khi cần thiết);
   không còn base64 ảnh hero/spotlight trong HTML.
3. Deploy Vercel --prod, kiểm tra live: / 200, /api/health, 62 resources,
   login demo, 1 order flow, /admin.html + /user.html 200 và hiển thị đúng.
4. Mở bằng browser task: trang khách giữ nguyên giao diện; admin/user
   dashboard hiển thị đúng, cùng khuôn mẫu.
5. Commit + push lên main qua EC2 (SSH key, identity Lam), verify git ls-remote.
   Commit gộp cả: rename server/index.mjs + vercel.json (chưa commit từ trước)
   + lần tách file này. Commit message mô tả rõ 3 phần.

## Rủi ro đã biết

- Vercel Root Directory đã sửa thành `.` (project root) — deploy lại phải giữ
  nguyên setting này; đừng tạo lại project.
- `server/app.mjs` là tên cấm (Vercel coi là entrypoint) — không dùng lại tên này.
- MCP Vercel connector bị 403 scope — deploy bằng CLI /usr/bin/vercel.
- File >200KB chuyển EC2 phải split 128KB + md5 (web/assets/js/data.js ~862KB).
