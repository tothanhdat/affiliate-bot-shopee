# Quy Trình Vận Hành: Từ Link Affiliate Đến Trả Hoa Hồng Cho User

> Viết ngày 2026-08-18, mô tả đúng hệ thống đang chạy thật (code trong `src/`), không phải kế hoạch. Dùng để hiểu cách vận hành hằng ngày và đối chiếu khi có vấn đề phát sinh. Xem `CLAUDE.md` nếu cần chi tiết implementation, `spec_bot_ap_ma_shopee.md` nếu cần bối cảnh quyết định.

## 1. Tổng quan quy trình (10 bước)

```
User gửi link sản phẩm
        │
        ▼
[1] Bot validate + nhận diện merchant + tách product_id
        │
        ▼
[2] Bot tạo link affiliate qua Accesstrade (sinh subId riêng)  ──► lưu vào requests.db
        │
        ▼
[3] Bot trả lời user: link + hoa hồng ước tính (nếu có)
        │
        ▼
[4] User bấm link, mua hàng trên Shopee/Lazada/TikTok Shop     ──► Accesstrade tự ghi nhận click
        │
        ▼
[5] (Vài ngày - vài tuần sau) Đơn được xác nhận trên Accesstrade
        │
        ▼
[6] Admin xem đơn thật, chạy ledgerAdmin.ts ghi vào hệ thống    ──► lưu vào ledger.db
        │
        ▼
[7] User nhắn "idid" lấy link dashboard cá nhân                ──► lưu token vào ledger.db
        │
        ▼
[8] User mở dashboard xem chi tiết hoa hồng từng đơn + tổng
        │
        ▼
[9] Đủ 50.000đ, user bấm "Yêu cầu rút tiền"                    ──► lưu yêu cầu vào ledger.db
        │
        ▼
[10] Admin chuyển khoản tay, đánh dấu đã trả                   ──► cập nhật ledger.db
```

Hai kho dữ liệu tách biệt trong suốt quy trình:

- **`data/requests.db`** — nhật ký MỌI request tạo link (kể cả lỗi), không phải dữ liệu tiền bạc.
- **`data/ledger.db`** — sổ cái tài chính (hoa hồng, yêu cầu rút tiền), tách riêng để không lẫn với log vận hành thông thường.

---

## 2. Chi tiết từng bước

### Bước 1 — User gửi link, bot validate

User dán link sản phẩm (Shopee, Lazada, hoặc TikTok Shop) vào chat với bot — Telegram (DM hoặc group) hoặc Zalo (group; ở Zalo DM bot chỉ phản hồi đúng lệnh `"idid"`, mọi nội dung khác im lặng).

Bot (`parseProductLink()`):
1. Nhận diện merchant theo domain (`shopee.vn`, `lazada.vn`, `tiktok.com`...).
2. Nếu là short-link (`s.shopee.vn`, `vt.tiktok.com`...), theo redirect để lấy URL thật.
3. Tách `product_id` (TikTok Shop) hoặc `shop_id`/`item_id` (Shopee) từ URL.
4. Với TikTok Shop, nếu không tách được `product_id` (vd link là video thường, không phải sản phẩm) → bot từ chối ngay, trả lời "không phải link sản phẩm", **không lưu gì cả, không đi tiếp bước 2**.

*Chưa lưu dữ liệu gì ở bước này — chỉ xử lý trong bộ nhớ.*

### Bước 2 — Bot tạo link affiliate, sinh mã theo dõi riêng

Với mỗi link hợp lệ, bot sinh 1 mã theo dõi (`subId`) duy nhất, dạng:

```
{platform}-{userId}-{timestamp}-{mã ngẫu nhiên}
vd: telegram-566659887-msww9vgx-a549ae
```

`subId` này gắn vào link gửi cho Accesstrade (`sub1` cho TikTok Shop, `utm_content` cho Shopee/Lazada) — đây là "sợi dây" duy nhất nối 1 cú click mua hàng ngoài đời với đúng user đã yêu cầu link đó trong bot.

Với TikTok Shop, bot gọi thêm 1 API để lấy % hoa hồng thật hiện tại của sản phẩm (hiển thị ở bước 3), việc này không bắt buộc thành công — lỗi ở đây không làm hỏng việc tạo link.

**Dữ liệu lưu (bảng `requests` trong `requests.db`)** — xem chi tiết cột ở mục 3.

### Bước 3 — Bot trả lời user

Tin nhắn gồm: sàn, link affiliate, hoa hồng ước tính (chỉ TikTok Shop có), cảnh báo mở đúng link và mua ngay, nhắc lệnh `"idid"` để theo dõi sau này.

*Không lưu thêm dữ liệu — chỉ là nội dung phản hồi.*

### Bước 4 — User bấm link, mua hàng

Diễn ra hoàn toàn bên ngoài hệ thống của bot — trên app/web Shopee/Lazada/TikTok Shop. Accesstrade tự động ghi nhận cú click (kèm `subId`) và theo dõi đơn hàng phát sinh trong "cửa sổ cookie" theo chính sách last-click của từng sàn.

*Hệ thống bot không biết gì về bước này cho tới khi admin chủ động kiểm tra (bước 5-6).*

### Bước 5 — Đơn được xác nhận trên Accesstrade (định kỳ hàng tuần)

**Quyết định vận hành (chốt 2026-08-18): mỗi thứ 5 hàng tuần**, admin vào dashboard Accesstrade xem báo cáo đơn hàng/giao dịch trong tuần đó, lọc ra các đơn đã thành công, đối chiếu `subId` (`sub1` cho TikTok Shop, `utm_content` cho Shopee/Lazada) của từng đơn.

**Đây là bước THỦ CÔNG hiện tại** (T2.1 trong spec) — chưa có cơ chế tự động poll API báo cáo chuyển đổi. Cố định thành lịch hàng tuần để không bị quên/dồn việc.

### Bước 6 — Admin ghi nhận đơn vào ledger (nhập hàng loạt bằng CSV)

Thay vì gõ từng lệnh cho từng đơn, admin điền các đơn đã đối chiếu ở Bước 5 vào 1 file CSV (copy từ file mẫu `src/scripts/templates/weekly-conversions.example.csv`), mỗi dòng 1 đơn:

```csv
subId,orderId,productName,orderAmount,commissionAmount,note
telegram-566659887-msww9vgx-a549ae,TT2608001,Hũ Nửa Kí Cơm Rang Cô Hồng,97020,15000,
zalo-6519368098272526337-abc123-def456,SP2608005,,500000,45000,đối soát tuần 33
```

Rồi chạy 1 lệnh duy nhất xử lý cả tuần:

```bash
npx tsx src/scripts/ledgerAdmin.ts record-conversions-csv --file=weekly-2026-w33.csv
```

Script in ra kết quả từng dòng (thành công/lỗi) + tổng kết cuối. **1 dòng lỗi (subId sai, đơn ghi trùng...) không làm dừng cả batch** — các dòng còn lại vẫn được xử lý bình thường, admin chỉ cần sửa lại đúng những dòng báo lỗi rồi chạy lại (chạy lại cả file cũng an toàn — đơn đã ghi rồi sẽ báo "đã ghi nhận trước đó" thay vì cộng trùng).

Với mỗi dòng hợp lệ, script tự động:
1. Tra `subId` trong `requests.db` → biết ngay `platform` + `userId` + `merchant` (không cần admin gõ tay 3 thông tin này).
2. Tính thuế/phí/phần user nhận theo công thức cố định:

```
thuế       = commissionAmount × 10%
sau thuế   = commissionAmount − thuế
phí sàn    = sau thuế × 1%
sau phí    = sau thuế − phí sàn
user nhận  = sau phí × 90%   (đổi từ 80% ngày 2026-08-19, chủ bot giữ 10% thay vì 20%)
```

Ví dụ với `commissionAmount = 15.000đ`: thuế 1.500đ → sau thuế 13.500đ → phí sàn 135đ → sau phí 13.365đ → **user nhận 12.029đ**.

3. Chặn ghi trùng: nếu `orderId` đã tồn tại cho đúng `merchant` đó, báo lỗi thay vì cộng 2 lần.

**Dữ liệu lưu (bảng `commission_entries` trong `ledger.db`)** — xem mục 3.

### Bước 7 — User nhắn "idid" lấy link cá nhân

Lần đầu tiên user nhắn `"idid"`, bot tạo 1 token ngẫu nhiên dài (không đoán được, không phải userId thật) gắn với `(platform, userId)` đó — **chỉ tạo 1 lần, các lần nhắn `"idid"` sau trả về đúng token cũ** (không tạo token mới mỗi lần).

**Dữ liệu lưu (bảng `dashboard_tokens` trong `ledger.db`)**.

### Bước 8 — User xem dashboard

Mở link `https://<domain>/d/<token>` → thấy toàn bộ đơn đã ghi nhận (ngày, sản phẩm, giá trị đơn, hoa hồng gốc, thuế+phí, % nhận, số tiền nhận, trạng thái) + 3 số tổng: Khả dụng / Đang chờ rút / Đã nhận.

*Chỉ đọc dữ liệu đã có, không ghi gì thêm.*

### Bước 9 — User yêu cầu rút tiền

Khi "Khả dụng" ≥ 50.000đ, dashboard hiện nút "Yêu cầu rút [toàn bộ số dư]" (không rút một phần). Bấm vào:
1. Hệ thống kiểm tra: có đang chờ 1 yêu cầu khác chưa xử lý không (nếu có → từ chối, báo lỗi).
2. Tạo 1 yêu cầu rút tiền mới, **khoá lại** toàn bộ các đơn đang "khả dụng" của user đó (đánh dấu đã gắn vào yêu cầu rút này — để không bị tính trùng nếu user bấm rút 2 lần liên tiếp).
3. Gửi thông báo Telegram cho admin (nếu đã cấu hình `ADMIN_TELEGRAM_CHAT_ID`).

**Dữ liệu lưu (bảng `withdrawal_requests` trong `ledger.db`)** + cập nhật cột `withdrawal_id` trên các dòng `commission_entries` liên quan.

### Bước 10 — Admin trả tiền

Admin xem thông báo (hoặc chạy `ledgerAdmin.ts list-pending-withdrawals` nếu không có thông báo Telegram), tự nhắn hỏi user số tài khoản ngân hàng (**không thu sẵn trong form**, đây là quyết định có chủ đích), chuyển khoản tay, rồi chạy:

```bash
npx tsx src/scripts/ledgerAdmin.ts mark-withdrawal-paid --id=<id yêu cầu rút>
```

Yêu cầu rút chuyển trạng thái "paid", toàn bộ đơn liên quan chuyển từ "khả dụng" sang "đã nhận".

### Trường hợp đặc biệt — Đơn bị huỷ/hoàn trả sau khi đã ghi nhận

```bash
npx tsx src/scripts/ledgerAdmin.ts reverse-entry --id=<id đơn> --reason="khách hoàn hàng"
```

Đơn chuyển trạng thái "đã huỷ", không còn tính vào số dư khả dụng của user. **Nếu user đã rút tiền trước khi phát hiện huỷ, chủ bot chịu lỗ phần đó** — đây là rủi ro đã ghi trong spec, nên tránh ghi nhận đơn quá sớm khi còn trong thời gian có thể bị hoàn.

---

## 3. Dữ liệu lưu ở từng bước — chi tiết

### 3.1. `requests.db` → bảng `requests` (ghi ở Bước 2, mọi request kể cả lỗi)

| Cột | Ý nghĩa | Ví dụ |
|---|---|---|
| `id` | UUID duy nhất của request | `a1b2c3...` |
| `timestamp` | Thời điểm tạo | `2026-08-18T05:10:00.000Z` |
| `platform` | `telegram` / `zalo` / `http` | `telegram` |
| `merchant` | `shopee` / `lazada` / `tiktokshop` (null nếu lỗi trước khi xác định được) | `tiktokshop` |
| `user_id` | ID user trên platform gốc | `566659887` |
| `original_url` | Link user gửi (chưa xử lý) | `https://vt.tiktok.com/ZS9k...` |
| `sub_id` | Mã theo dõi sinh ra (null nếu lỗi) | `telegram-566659887-msww9vgx-a549ae` |
| `outcome` | `success` / `error` | `success` |
| `error_code` | Mã lỗi nếu có | `null` |
| `affiliate_url` | Link trả về cho user | `https://shorten.asia/BCqzQzus` |

→ Bảng này là **nguồn duy nhất** để tra `subId → user` (dùng bởi `ledgerAdmin.ts`), và cũng dùng để debug/thống kê số link đã tạo.

### 3.2. `ledger.db` → bảng `commission_entries` (ghi ở Bước 6, 1 dòng = 1 đơn hàng đã xác nhận)

| Cột | Ý nghĩa | Ví dụ |
|---|---|---|
| `id` | UUID | ... |
| `platform`, `user_id` | Suy ra từ `subId` lúc ghi nhận | `telegram`, `566659887` |
| `merchant` | Sàn phát sinh đơn | `tiktokshop` |
| `sub_id` | Mã theo dõi gốc | `telegram-566659887-...` |
| `order_id` | Mã đơn hàng (từ Accesstrade) — **unique theo (merchant, order_id)**, chống ghi trùng | `TT2608001` |
| `product_name` | Tên sản phẩm (tuỳ chọn, admin tự điền) | `Hũ Nửa Kí Cơm Rang...` |
| `order_amount` | Giá trị đơn hàng | `97.020đ` |
| `commission_amount` | Hoa hồng GỐC (100%, trước thuế/phí) | `15.000đ` |
| `tax_amount` | Thuế đã trừ (10%) | `1.500đ` |
| `platform_fee_amount` | Phí sàn đã trừ (1% trên phần sau thuế) | `135đ` |
| `after_tax_amount` | Còn lại sau thuế + phí | `13.365đ` |
| `user_share_amount` | User thực nhận (90% của trên) | `12.029đ` |
| `status` | `confirmed` / `paid` / `reversed` | `confirmed` |
| `withdrawal_id` | Gắn với yêu cầu rút nào (null = chưa rút) | `null` |
| `note` | Ghi chú nội bộ, không hiện cho user | `null` |

### 3.3. `ledger.db` → bảng `dashboard_tokens` (ghi ở Bước 7, 1 dòng = 1 user, chỉ tạo 1 lần)

| Cột | Ý nghĩa |
|---|---|
| `token` | Chuỗi ngẫu nhiên dài, dùng trong URL `/d/:token` |
| `platform`, `user_id` | User sở hữu token này (unique — mỗi user chỉ có 1 token cố định) |
| `created_at` | Lúc tạo lần đầu |

### 3.4. `ledger.db` → bảng `withdrawal_requests` (ghi ở Bước 9)

| Cột | Ý nghĩa |
|---|---|
| `id` | UUID |
| `platform`, `user_id` | User yêu cầu rút |
| `amount` | Tổng số tiền rút (= toàn bộ số dư khả dụng lúc yêu cầu) |
| `status` | `requested` → `paid` |
| `created_at`, `paid_at` | Thời điểm tạo / thời điểm admin đánh dấu đã trả |

---

## 4. Ví dụ minh hoạ — 100 user dùng bot trong 1 tháng

Giả định: group Zalo "Săn Sale ABC" có 100 thành viên dùng bot trong tháng 8/2026.

**Ở tầng `requests.db`:** trung bình mỗi user gửi 4-5 link/tháng → khoảng **450 dòng** trong bảng `requests` (bao gồm cả link lỗi, link không phải sản phẩm, link thành công). Đây là traffic thô, chưa liên quan gì tới tiền.

**Ở tầng `ledger.db`:** trong 450 lượt tạo link đó, giả sử tỷ lệ chuyển đổi thực tế (người bấm link, thực sự mua hàng, đơn được xác nhận) là ~8% → admin phát hiện và ghi tay **36 đơn hàng thật** trong tháng → 36 dòng trong `commission_entries`, rải rác trên nhiều user khác nhau trong 100 user đó (không phải ai cũng có đơn — đa số user chỉ dò giá, không mua).

### Theo dõi 3 user cụ thể trong nhóm 100 người đó:

**User "Minh Khuê" (Telegram, userId `566659887`)** — gửi 6 link trong tháng, có 2 đơn TikTok Shop thật:

| Đơn | Hoa hồng gốc | Thuế (10%) | Phí sàn (1%) | User nhận (90%) |
|---|---|---|---|---|
| TT2608001 | 15.000đ | 1.500đ | 135đ | **12.029đ** |
| TT2608014 | 9.000đ | 900đ | 81đ | **7.217đ** |
| **Tổng** | | | | **19.246đ** |

→ Chưa đạt 50.000đ, dashboard hiện "Tích luỹ thêm 30.754đ nữa để đủ điều kiện rút". User này chỉ dùng bot xem tiến độ, chưa rút được.

**User "Thành Đạt" (Telegram, userId `900001`)** — 2 đơn Shopee:

| Đơn | Hoa hồng gốc | Thuế | Phí sàn | User nhận |
|---|---|---|---|---|
| SP2608005 | 45.000đ | 4.500đ | 405đ | **36.086đ** |
| SP2608022 | 30.000đ | 3.000đ | 270đ | **24.057đ** |
| **Tổng** | | | | **60.143đ** |

→ Vượt 50.000đ! User nhắn `"idid"`, vào dashboard, bấm "Yêu cầu rút 60.143đ" → cả 2 dòng trên bị khoá (`withdrawal_id` được gán). Admin nhận thông báo Telegram, nhắn hỏi STK, chuyển khoản, chạy `mark-withdrawal-paid` → cả 2 dòng chuyển "đã nhận", user không rút trùng được nữa cho tới khi có đơn mới tích luỹ tiếp.

**User "Hồng Anh" (Zalo, userId `700002`)** — 1 đơn Lazada 20.000đ hoa hồng gốc, đã ghi nhận (`user nhận` ước tính ~16.038đ) — nhưng 2 tuần sau khách trả hàng, admin phát hiện qua Accesstrade, chạy `reverse-entry`. Dòng này chuyển "đã huỷ", **không tính vào số dư của Hồng Anh nữa** — nếu Hồng Anh đã trót rút tiền trước đó (giả sử có đơn khác đủ ngưỡng), phần 16.038đ này là khoản admin phải tự bù, không đòi lại được từ user.

### Tổng kết quy mô tháng đó (minh hoạ):

| Chỉ số | Giá trị |
|---|---|
| Tổng user hoạt động | 100 |
| Tổng lượt tạo link (`requests`) | ~450 |
| Tổng đơn hàng ghi nhận thật (`commission_entries`) | 36 |
| User có ít nhất 1 đơn | ~25 (không phải 36 user riêng biệt, có người nhiều đơn) |
| User đủ ngưỡng rút trong tháng | ~4-5 |
| Đơn bị huỷ/hoàn sau khi đã ghi nhận | 1-2 (rủi ro cần admin theo dõi sát) |

Đây là lý do quy mô càng lớn thì **gánh nặng thao tác tay ở Bước 5-6 càng lớn theo** (mỗi đơn thật đều cần admin tự tra + gõ lệnh) — chính là động lực cho việc tự động hoá đối soát (T2.1) sau này khi có API báo cáo chuyển đổi từ nguồn affiliate.

---

## 5. Hướng dẫn chạy lệnh (cheat sheet cho admin)

Toàn bộ lệnh chạy từ thư mục gốc project:

```bash
cd "/Users/ryan/Documents/Claude/Projects/Affiliate Bot Shopee"
```

Format chung: `npx tsx src/scripts/ledgerAdmin.ts <lệnh> --flag=value`

### 5.1. Ghi nhận nhiều đơn cùng lúc — dùng định kỳ thứ 5 hàng tuần (Bước 5-6)

1. Copy file mẫu làm file tuần đó (đặt tên tuỳ ý, vd `weekly-2026-w33.csv`):
   ```bash
   cp src/scripts/templates/weekly-conversions.example.csv weekly-2026-w33.csv
   ```
2. Mở file bằng Excel/Google Sheets/Notepad, xoá 2 dòng mẫu, điền các đơn đã đối chiếu từ Accesstrade — mỗi đơn 1 dòng:

   | Cột | Bắt buộc? | Ghi chú |
   |---|---|---|
   | `subId` | Có | Lấy từ báo cáo đơn hàng Accesstrade (cột `sub1` với TikTok Shop, `utm_content` với Shopee/Lazada) |
   | `orderId` | Có | Mã đơn hàng, dùng để chống ghi trùng nếu chạy lại nhầm |
   | `orderAmount` | Có | Giá trị đơn hàng (số, không có dấu chấm/phẩy phân cách nghìn) |
   | `commissionAmount` | Có | Hoa hồng gốc Accesstrade trả (số, trước khi trừ thuế/phí) |
   | `productName` | Không | Để trống nếu không cần |
   | `note` | Không | Ghi chú nội bộ, không hiện cho user |

3. Chạy:
   ```bash
   npx tsx src/scripts/ledgerAdmin.ts record-conversions-csv --file=weekly-2026-w33.csv
   ```
4. Đọc kết quả in ra — mỗi dòng 1 kết quả OK/LỖI, cuối cùng có dòng tổng kết:
   ```
   [dong 2] OK - orderId=TT2608001 subId=telegram-566659887-msww9vgx-a549ae - user_share=12029d
   [dong 3] LOI - orderId=SP2608005 subId=zalo-abc-xyz - Khong tim thay request thanh cong nao ung voi subId "zalo-abc-xyz"

   Tong: 2 dong, 1 thanh cong, 1 loi.
   ```
5. Với các dòng LỖI: sửa lại đúng dòng đó trong file CSV rồi chạy lại **cả file** — các dòng đã ghi thành công trước đó sẽ tự báo "đã ghi nhận trước đó" (không bị cộng trùng), chỉ dòng vừa sửa mới được ghi thêm.

### 5.2. Ghi nhận 1 đơn lẻ — dùng khi có đơn phát sinh gấp, không đợi tới thứ 5

```bash
npx tsx src/scripts/ledgerAdmin.ts record-conversion \
  --subId=telegram-566659887-msww9vgx-a549ae \
  --orderId=TT2608001 \
  --orderAmount=97020 \
  --commissionAmount=15000 \
  --productName="Hũ Nửa Kí Cơm Rang Cô Hồng"
```

(`--productName` và `--note` không bắt buộc, có thể bỏ.) Kết quả in ra là dữ liệu đơn vừa ghi dạng JSON — **giữ lại dòng `"id"` trong đó** nếu sau này cần huỷ đơn (mục 5.4).

**Không muốn gõ lệnh?** Cả 2 cách trên (ghi 1 đơn lẻ và ghi nhiều đơn qua CSV) đều làm được ngay trên web, không cần mở terminal: menu **"Ghi nhận đơn hàng"** (`/admin/record-orders`) — có form ghi 1 đơn lẻ (y hệt mục 5.2) và form chọn file CSV để import hàng loạt (y hệt mục 5.1, không cần copy file/gõ đường dẫn, chỉ cần chọn file từ máy). Kết quả từng dòng hiện ngay trên trang, cùng logic với CLI (dòng lỗi không làm hỏng cả batch).

### 5.3. Xem danh sách yêu cầu rút tiền đang chờ xử lý

```bash
npx tsx src/scripts/ledgerAdmin.ts list-pending-withdrawals
```

Dùng khi chưa cấu hình `ADMIN_TELEGRAM_CHAT_ID` (không nhận thông báo Telegram tự động), hoặc muốn xem lại toàn bộ danh sách đang chờ trả. Kết quả trả về danh sách JSON, mỗi mục có `id` (dùng ở bước 5.5), `platform`, `userId`, `amount`.

### 5.4. Đánh dấu đã chuyển khoản xong

Sau khi đã tự nhắn hỏi user số tài khoản và chuyển khoản tay xong:

```bash
npx tsx src/scripts/ledgerAdmin.ts mark-withdrawal-paid --id=<id lấy từ mục 5.3>
```

### 5.5. Huỷ 1 đơn đã ghi nhận (khách hoàn hàng/huỷ đơn)

```bash
npx tsx src/scripts/ledgerAdmin.ts reverse-entry --id=<id đơn> --reason="khách hoàn hàng"
```

`<id đơn>` là `id` trong kết quả JSON lúc ghi nhận đơn đó (mục 5.1 hoặc 5.2) — nên lưu lại output mỗi lần chạy `record-conversion`/`record-conversions-csv` để tra lại khi cần, vì hiện dashboard cá nhân của user chưa hiển thị `id` này trên giao diện.

### 5.6. Đối chiếu dòng tiền — ghi nhận tiền Accesstrade đã chuyển thật

Mỗi khi Accesstrade thực sự chuyển khoản vào tài khoản (thường theo kỳ, vd hàng tháng), ghi lại ngay để hệ thống tính đúng "chủ bot còn bao nhiêu tiền để trả tiếp":

```bash
npx tsx src/scripts/ledgerAdmin.ts record-accesstrade-payment --amount=2000000 --note="chuyen khoan ky thang 8"
```

Cũng ghi được nhanh ngay trên web: menu "Đối chiếu Accesstrade" (`/admin/accesstrade-payments`) — form có thêm ô chọn ngày Accesstrade thật sự chuyển (mặc định là hôm nay, đổi lại nếu ghi trễ so với ngày thực tế nhận tiền).

Xem tổng quan bất cứ lúc nào (không cần mở trình duyệt):

```bash
npx tsx src/scripts/ledgerAdmin.ts reconciliation-summary
```

Trang "Đối chiếu Accesstrade" cũng hiển thị sẵn card "Số dư chủ bot" + lịch sử tất cả lần đã ghi nhận — nếu số "Còn lại" hiện màu đỏ/âm, nghĩa là đang trả cho user nhiều hơn số tiền thực nhận từ Accesstrade, cần kiểm tra lại ngay.

### Lỗi thường gặp

| Thông báo lỗi | Nguyên nhân | Cách xử lý |
|---|---|---|
| `Khong tim thay request thanh cong nao ung voi subId "..."` | `subId` gõ sai/thiếu ký tự, hoặc đơn này chưa từng qua bot | Copy lại chính xác `subId` từ báo cáo Accesstrade, không tự gõ tay/đoán |
| `Đơn hàng "..." đã được ghi nhận trước đó` | Đơn đã ghi rồi (chạy trùng file/lệnh) | Không phải lỗi cần sửa — bỏ qua dòng đó |
| `Khong doc duoc file "...": ...` | Sai đường dẫn file CSV | Kiểm tra lại đường dẫn, dùng đường dẫn tuyệt đối nếu không chắc đang đứng ở thư mục nào |
| `--<flag> phai la so, nhan duoc "..."` | `orderAmount`/`commissionAmount` chứa ký tự không phải số (dấu chấm phân cách nghìn, khoảng trắng...) | Sửa lại thành số thuần, vd `97020` không phải `97.020` |
| `Hoa hồng ... vượt quá 50% giá trị đơn (...), có thể gõ nhầm` | `commissionAmount` cao bất thường so với `orderAmount` — thường do gõ nhầm thêm số 0 | Kiểm tra lại số liệu trong báo cáo Accesstrade. Nếu đúng là hoa hồng cao thật (campaign đặc biệt), tăng `COMMISSION_MAX_RATIO_PERCENT` trong `.env` rồi chạy lại |
| `Đơn hàng này đã nằm trong 1 yêu cầu rút tiền (...), không thể huỷ trực tiếp qua đây` | Dùng `reverse-entry`/nút "Huỷ đơn" trên 1 đơn đã bị khoá bởi 1 yêu cầu rút tiền (đang chờ hoặc đã trả) | Không huỷ được qua lệnh này nữa — cần xử lý thủ công riêng (liên hệ user, điều chỉnh tay), vì tiền có thể đã chuyển |
