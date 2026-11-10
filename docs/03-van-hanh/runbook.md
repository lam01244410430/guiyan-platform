# 03 — Runbook vận hành hằng ngày

## Kiểm tra nhanh hệ thống còn sống (2 phút)

```bash
B=https://guiyan-platform.vercel.app
curl -s $B/api/health            # expect {"ok":true,"mode":"postgres"}
curl -s $B/api/resources | head -c 200   # expect 62 tài nguyên
curl -s -o /dev/null -w '%{http_code}\n' $B/admin/   # expect 200
```

- Đăng nhập demo/admin thử trên trình duyệt (không chỉ curl): đăng nhập là bước hay hỏng nhất (xem `04-van-hanh/su-co.md`).

## Sau mỗi lần đổi code

1. `node --check` các file JS đổi + `npm run build`.
2. Đồng bộ file đổi lên EC2 (`~/workspace/scp_ec2.sh`, file >200KB thì tách chunk 128KB + kiểm tra md5).
3. Trên EC2: chạy test + smoke với DB dùng một lần (xem dưới). **Phải tự khởi động container Postgres trước** — script `/tmp/smoke.sh` không tự khởi động, chạy khi chưa có DB sẽ treo ở `npm test`.
   ```bash
   docker run -d --name guiyan-test-pg -e POSTGRES_USER=guiyan \
     -e POSTGRES_PASSWORD=guiyan -e POSTGRES_DB=guiyan_test \
     -p 5433:5432 postgres:16-alpine
   nohup bash /tmp/smoke.sh > /tmp/smoke.log 2>&1 &
   ```
   Kỳ vọng: tests **14 đậu / 0 lỗi / 2 bỏ qua** (storage chưa cấu hình), smoke **26 đậu / 0 lỗi**, xong container tự xóa (0 container còn lại).
4. Deploy Vercel `--prod`, kiểm tra live (đăng nhập, yêu thích, admin).
5. Kiểm tra bằng trình duyệt (bấm thật) khi đổi giao diện hoặc luồng đăng nhập — curl không bắt được lỗi frontend.
6. Commit + push **chỉ khi Lam duyệt riêng cho lần đổi đó**; xong kiểm tra `git ls-remote` thấy HEAD trên GitHub bằng commit vừa push.

## Quy tắc máy EC2 (free tier)

- Giữ `t3.micro`, một instance, EBS ≤ 30GB, không snapshot/volume thừa.
- Postgres chỉ bật khi test, xong dừng + xóa container.
- Không chạm DB/container của IMSF.
- Codex dừng ở 80% giới hạn 5 giờ — chỉ khi Lam báo (Peter không đo được).
