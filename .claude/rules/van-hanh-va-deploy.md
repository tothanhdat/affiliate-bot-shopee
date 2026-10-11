# Vận hành: CLI, đăng nhập Zalo, triển khai nhiều chủ bot

> Đọc khi chạy/sửa script trong `src/scripts/*`, chuẩn bị instance mới, hoặc bàn giao cho người vận hành khác.

## Triển khai nhiều chủ bot

**Trien khai nhieu chu bot (2026-09-10, quyet dinh da chot)**: moi chu bot = 1 deployment RIENG tu CUNG codebase nay (Railway service rieng + volume rieng + env rieng + domain rieng), KHONG phai multi-tenant trong 1 process va KHONG phai copy source sang repo khac. Ly do khong multi-tenant: store la singleton module-level trong index.ts, va moi bang trong ledgerStore khoa theo (platform, user_id) voi platform chi la telegram|zalo|http — dung chung DB thi 2 user Zalo trung uid se DINH VI CUA NHAU (day la DB tien, khong co ngoai le). Bat buoc rieng giua cac instance: DB, tai khoan Shopee Affiliate (SHOPEE_AFFILIATE_ID), tai khoan Zalo chay bot, ADMIN_PASSWORD, DASHBOARD_BASE_URL. Luu y khi ban giao cho nguoi van hanh khac: ho KHONG co code nen khong chay duoc CLI ledgerAdmin.ts, dac biet la reverse-entry cho don da "confirmed" - moi thao tac cua ho phai lam duoc thuan qua web /admin.

## scripts/ledgerAdmin.ts

**src/scripts/ledgerAdmin.ts** — Script chay tay (npx tsx ...) ghi nhan don hang/hoa hong thu cong. Tu 2026-09-29 (bo TikTok Shop/Lazada khoi scope) day la duong ghi nhan don DUY NHAT va VINH VIEN, vi Shopee di thang qua an_redir nen khong the tu dong hoa doi soat. doc comment dau file truoc khi dung. record-shopee-report (2026-08-23, xem shopeeReportImport.ts): import THANG file bao cao goc Shopee (khong doi ten cot), day la cong cu CHINH cho quy trinh doi soat hang ngay 9h30 sang. Tu 2026-08-20: sau khi ghi xong tu dong goi Telegram Bot API (fetch, KHONG can bot dang chay) bao user co don moi — CHI Telegram, Zalo tu CLI bi bo qua co chu dich (rui ro DuplicateConnection voi bot that dang dang nhap tren server), dung web /admin/record-orders neu can bao ca user Zalo.

## scripts/zaloLogin.ts

**src/scripts/zaloLogin.ts** — (2026-09-10) `npm run zalo:login` — dang nhap QR cho 1 TAI KHOAN ZALO MOI roi ghi file session ra dia, dung khi chuan bi instance bot moi (nguoi quet chi chay 1 lenh, khong sua code/env). CO Y **KHONG import src/config/env.ts**: dotenv khong chay -> .env khong duoc doc -> khong the nap TELEGRAM_BOT_TOKEN -> khong the sinh poller Telegram thu 2 tranh voi bot production (2 poller cung token = loi 409 o bot that). Day la ly do ton tai cua file nay thay vi dung `npm run dev` de quet QR - DUNG "don gian hoa" bang cach import env.ts vao day. Khong khoi dong Express/store/listener nao, chi login -> ghi file -> thoat. Logic duong dan tach rieng sang zaloLoginPaths.ts de test duoc (script chay that thi khong test tu dong duoc).

## scripts/zaloLoginPaths.ts

src/scripts/zaloLoginPaths.ts (2026-09-10) resolveSessionOutputPath() — 2 chot an toan cho zaloLogin.ts: (1) CHAN TUYET DOI ghi vao ./data/zalo-session.json cua bot dang chay, ke ca co --force (ghi de = bot that doi tai khoan luc restart hoac bi da phien ra ngoai, vi zca-js chi cho 1 phien/tai khoan) - so sanh qua path.resolve nen chan duoc ca "data/zalo-session.json" lan duong dan tuyet doi; (2) khong ghi de file da ton tai neu thieu --force (session mat = phai quet QR lai bang dien thoai). Mac dinh ghi ./data/zalo-session-bot2.json. **.gitignore dung GLOB `data/zalo-session*.json` + `data/zalo-qr*.png`** (doi tu ten co dinh 2026-09-10) - ten co dinh cu khong chan file bot2/bot3 do script nay sinh ra, ma file session = quyen truy cap tai khoan Zalo.
