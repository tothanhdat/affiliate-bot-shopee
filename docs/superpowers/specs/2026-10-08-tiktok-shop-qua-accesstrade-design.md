# Thêm lại TikTok Shop qua Accesstrade — thiết kế

Ngày: 2026-10-08
Trạng thái: **ĐÃ BỊ THAY THẾ — không triển khai theo file này.**

> **Đọc trước khi dùng file này.** Sau khi viết xong bản này, đã research RioHub (`riohub.vn`) và
> **chốt đổi sang RioHub, bỏ Accesstrade** (2026-10-08). Lý do chính: Accesstrade là network đứng
> giữa và **giữ 35,8% hoa hồng** (hệ số publisher `0,6417`, đo khớp trên cả 3 đơn thật ở mục 3.2),
> còn RioHub chỉ là lớp API trên link affiliate **chính chủ** của tài khoản creator TikTok nên
> TikTok trả thẳng, RioHub thu 0đ → **+56% doanh thu cùng lượng đơn** (46.853đ → ~73.014đ).
> RioHub còn hơn ở: 300 req/phút (Accesstrade ~60), đơn ghi nhận 5–30 phút, `settlement_status`
> tường minh thay vì suy từ `status`+`is_confirmed`, **có `time_delivered_iso`** (mốc giam đơn thật,
> xem mục 3.1 để thấy Accesstrade thiếu hẳn thứ này), webhook HMAC, 3 tên miền dự phòng.
>
> **Phần VẪN CÒN HIỆU LỰC nguyên vẹn** (~80%, chép sang bản RioHub): mục 1 (nút thắt cũ và vì sao
> làm lại), mục 2 (8 quyết định đã chốt với user), mục 4 (kiến trúc: tách engine dùng chung,
> `compositeProvider`, danh sách file sửa), mục 6 (giam đơn/nợ/`reconciled_at`), mục 9 (kế hoạch
> test), mục 10 (thứ tự commit).
>
> **Phần BỎ**: mục 3 (số liệu Accesstrade — giữ lại làm hồ sơ so sánh, không phải đặc tả), mục 5
> (lớp đọc đầu vào), mục 7 (env), mục 8 (thu hoạch git history của Accesstrade). Hai cái bẫy ở mục
> 5.1 (`_bonus` hai dòng, lọc subId xoá sạch hoa hồng) **không tồn tại ở RioHub** — 1 dòng/SKU.
>
> Bản RioHub sẽ được viết sau khi verify API thật bằng key của user.

## 1. Mục tiêu

Hỗ trợ lại TikTok Shop (đã bị gỡ khỏi scope 2026-09-29), **bỏ qua Lazada**. TikTok phải **kế thừa
toàn bộ** chức năng đang chạy cho Shopee: template tin nhắn bot, ảnh báo "đơn về", cơ chế giam đơn
giá trị lớn, quy tắc nợ hoàn trả, % hoa hồng riêng từng user, dashboard, rút tiền.

### Nút thắt cũ đã được giải, và nó là lý do làm lại

Lần trước bỏ TikTok vì "đơn hàng cập nhật lâu". Nguyên nhân thật: code cũ chờ `is_confirmed=1`
(~30 ngày, tức lúc Accesstrade đối soát xong) mới chuyển đơn sang `confirmed`. Nhưng trạng thái
**"Tạm duyệt"** của Accesstrade đã có nghĩa là **user nhận hàng rồi** — tương đương "Hoàn thành"
của Shopee. Vậy chỉ cần báo ngay ở "Tạm duyệt" và dùng chính bộ **giam đơn + nợ** đã có để che
rủi ro, y như đang làm với Shopee.

| Accesstrade | Nghĩa thật | Code cũ map | Thiết kế này |
|---|---|---|---|
| `status=0` | đơn chưa duyệt | `pending` | `pending` |
| `status=1, is_confirmed=0` — "Tạm duyệt" | **user đã nhận hàng** | `pending` ❌ | **`confirmed`** + giam đơn to |
| `status=1, is_confirmed=1` — "Đã duyệt" | đã đối soát, chủ bot rút được tiền thật | `confirmed` | `confirmed` + `reconciled_at` |
| `status=2` | huỷ / từ chối | `reversed` | `reversed` (+ ghi nợ nếu đã trả) |
| khác | — | — | **skip cả đơn + cảnh báo** |

## 2. Quyết định đã chốt với user (2026-10-08)

1. **Chỉ TikTok Shop**, không làm lại Lazada. Lazada **giữ nguyên trong `RETIRED_MERCHANTS`** —
   ledger thật còn entry `merchant='lazada'`, bỏ ra là `/admin/orders` crash khi render đơn cũ.
2. **Không revert code cũ.** Dùng git history (commit `433f4e8`) làm nguồn kiến thức cho **lớp gọi
   API**, không bê phần ghi ledger (xem mục 8).
3. **Giam đơn dùng CHUNG cấu hình với Shopee** (`PAYOUT_HOLD_THRESHOLD_VND` / `PAYOUT_HOLD_DAYS`),
   không thêm ô settings nào.
4. **"Đã duyệt" hiện cho admin biết** (nhãn trên `/admin/orders`), user không thấy gì khác.
   **Không** mở khoá giam sớm khi đơn đã đối soát — user đã cân nhắc và từ chối nhánh đó.
5. **Kéo đơn bằng nút bấm tay** trên `/admin/record-orders`, **không cron**. Lý do: khớp nhịp đối
   soát 9h30 đang có, admin thấy ngay kết quả, và không có tiến trình nào âm thầm ghi vào DB tiền.
6. **Làm luôn ước tính hoa hồng + tên sản phẩm** cho TikTok, giống hoàn toàn Shopee.
7. **Thuế dùng chung 10% + phí 1%** như Shopee. User đã xác nhận phần Accesstrade giữ (~35,8%)
   **chưa** bao gồm thuế TNCN, nên không có chuyện trừ thuế hai lần.
8. **Bỏ hẳn đơn cũ**: thêm `ACCESSTRADE_ORDER_CUTOFF_DATE` **bắt buộc**, đơn đặt trước mốc bị skip.

## 3. Số liệu đo được từ API thật (2026-10-08)

Đo bằng key thật của dự án. Đây là cơ sở của mọi quyết định mapping bên dưới — **đọc lại mục này
trước khi "sửa cho gọn" bất cứ phép tính nào**.

### 3.1 `GET /v1/transactions` — 6 giao dịch trong 365 ngày

Toàn bộ `merchant: "tiktok_cps"`, `conversion_platform` rỗng, `time_zone: "+00:00"`.

| `transaction_id` | `status` | `is_confirmed` | `transaction_time` | `confirmed_time` | `update_time` |
|---|---|---|---|---|---|
| 585623530205906622 | 1 | 1 | 2026-08-19T16:52:11 | 2026-08-31T23:59:59 | 2026-09-21T20:33:53 |
| 585624847796766398 | 1 | 1 | 2026-08-19T18:29:59 | 2026-08-31T23:59:59 | 2026-09-21T20:33:16 |
| 585930815026529295 | 1 | 0 | 2026-09-07T00:56:47 | 2026-09-14T15:48:54 | 2026-09-14T16:01:49 |

Quan sát quyết định thiết kế:

- `confirmed_time` **chỉ đáng tin khi `is_confirmed=0`** — lúc đó nó là thời điểm Tạm duyệt
  (đơn 07/09 → 14/09, đúng 7 ngày sau khi đặt ≈ giao hàng). Ở dòng đã đối soát nó bị **ghi đè
  thành cuối kỳ** (31/08 23:59:59), không còn là ngày giao hàng.
- Đối soát được ghi nhận ~33 ngày sau khi đặt (`update_time` 21/09 cho đơn 19/08), còn giam chỉ
  7 ngày từ lúc Tạm duyệt → **hold luôn hết trước khi đối soát**, nên việc không mở khoá sớm
  (quyết định 4) không gây tồn đọng thực tế.
- `utm_content` **rỗng ở cả 6 dòng**; subId thật nằm ở `_extra.sub_params.sub1`.
- subId trong dữ liệu là **định dạng cũ** `zalo-...` (trước 2026-09-26). `findBySubId` khớp nguyên
  chuỗi nên vẫn tra ra user thật — đây chính là lý do phải có mốc cutoff (quyết định 8).

### 3.2 MỖI ĐƠN LÀ HAI DÒNG CÙNG `transaction_id` — dòng chính có `commission: 0`

```
product_id=1733091906991982175        transaction_value=524250  commission=0      _extra.commission_rate=1100
product_id=1733091906991982175_bonus  transaction_value=57667   commission=37005  product_name=""
```

**Hoa hồng thật nằm ở dòng `_bonus`.** Chỉ đọc dòng chính thì mọi đơn TikTok ghi 0đ.

Và `transaction_value` của dòng bonus (57.667) **≠** `commission` (37.005):

| đơn | giá | rate nhà bán | bonus `transaction_value` | `commission` | tỉ lệ |
|---|---|---|---|---|---|
| 1 | 33.000 | 8% | 2.640 | 1.694 | 0,64167 |
| 2 | 254.150 | 5% | 12.707 | 8.154 | 0,64169 |
| 3 | 524.250 | 11% | 57.667 | 37.005 | 0,64170 |

→ **Accesstrade giữ ~35,8%.** `commission` là số thật về tài khoản.

> **CẢNH BÁO TIỀN — đừng đổi:** `commissionAmount` phải lấy `commission`, **TUYỆT ĐỐI không lấy**
> `transaction_value` của dòng bonus. Lấy sai là chia cho user 80% của 57.667 trong khi chủ bot chỉ
> nhận 37.005 → **lỗ mỗi đơn**. Cùng loại bẫy với "không nhân `ratePercent × price`" bên Shopee.
> Có test chặn cả hai chiều.

### 3.3 `GET /v2/tiktokshop_product_feeds` — ước tính hoa hồng

`commission.amount` là **chuỗi, dấu `.` là THẬP PHÂN** (không phải dấu nghìn): sản phẩm giá
5.000–14.700đ, rate 3,888% → `"194.439"` ≈ `5000 × 0,03888`. Nên `Number()` thẳng là đúng.

**Feed đã trả số publisher thực nhận, không phải số gộp của nhà bán.** Bằng chứng: lấy 10 sản phẩm
và chia `commission.rate` cho hệ số,

```
rate feed (%):  9,721  5,185  5,833  9,721  5,833  6,481  7,129  6,481  6,481  6,481
chia 0,6417  :  15,149  8,080  9,090  ...        <- lệch 1%, không tròn
chia 0,6481  :  15,000  8,000  9,000  10,000  11,000   <- TRÒN TUYỆT ĐỐI
```

`0,6481 = 0,70 / 1,08` (70% chia VAT 8%). Rate nhà bán đều là số nguyên, khớp `_extra.commission_rate`
của transaction (800/500/1100 = 8%/5%/11%).

→ Feed chỉ cao hơn thực nhận **1%** (`0,6481` vs `0,6417`), nằm thừa trong sai số của chữ "ước tính".
**Không cần hệ số chỉnh nào.** Và với sản phẩm có dải giá (19.000–27.999), `amount` tính trên **giá
thấp nhất** → ước tính lệch **thấp**, an toàn hơn Shopee (lệch cao).

`title` của feed là **nguồn duy nhất** biết tên sản phẩm TikTok (dùng cho cột "Tên sản phẩm" của
`/admin/links`), giống vai trò `productInfo.productName` bên Shopee.

### 3.4 Rate limit ~1 request/giây

4 lời gọi giãn 7s → HTTP 200 hết. **2 lời gọi liên tiếp → lần 2 HTTP 429.** Dùng CHUNG key cho cả
`/v1/transactions` lẫn product feed.

### 3.5 `POST /v1/tiktokshop_product_feeds/create_link` vẫn chạy

```
HTTP 200  {"data":{"aff_short_url":"https://shorten.asia/...","aff_url":"https://go.isclix.com/deep_link/...&sub1=k-probe-test-0001","code":"0"},"status":true}
```

`sub1` giữ nguyên trong `aff_url` ✓. Endpoint này **không cần `campaign_id`** (khác nhánh
Shopee/Lazada cũ). Accesstrade báo lỗi **nghiệp vụ** bằng `{"status": false}` **trong HTTP 200** —
phải chặn trước khi parse link.

## 4. Kiến trúc

Giữ triết lý đang có: **core logic dùng chung + lớp đọc mỏng theo nguồn**. Một engine ghi tiền duy
nhất, hai lớp đọc đầu vào.

### 4.1 Tách engine (refactor thuần, commit riêng)

`src/core/orderOutcomeEngine.ts` — **mới**. Nhận phần thân vòng lặp hiện nằm trong
`shopeeReportImport.ts` (từ ~dòng 372): chốt % qua `resolveUserSharePercent`, 4 nhánh trạng thái,
**bảng quyết định 5 ca khi huỷ đơn**, giam đơn qua `resolveAvailableFrom`, ghi nợ `payout_debts`,
`recordOrderStatusEvent`, gom `confirmedByUser`. Nhận `NormalizedOrder[]`, **không biết CSV hay API**.

`shopeeReportImport.ts` giữ parse CSV + `mergeOrderRows`, rồi gọi engine.

**Vì sao không nhân bản khối này sang file TikTok:** đúng cái bẫy mà `commissionMath.ts` đã phải
tách ra để tránh (trước đó 3 chỗ lặp phép chia tiền). Hai bản sẽ trôi khỏi nhau và hậu quả là
*user hai sàn được đối xử khác nhau trên cùng một quy tắc*.

**Lưới an toàn của refactor:** 26 test `shopeeReportImport` + 58 test `ledgerStore` + 8 test
`payoutHold`. **Test Shopee phải xanh y nguyên, không sửa một dòng test nào** — đó là bằng chứng
refactor thuần. Làm thành commit riêng TRƯỚC khi thêm TikTok.

### 4.2 File thêm mới

| File | Việc |
|---|---|
| `src/core/accesstradeOrderImport.ts` | gọi `/v1/transactions`, gộp theo `transaction_id`, map sang `NormalizedOrder[]`, gọi engine |
| `src/core/providers/accesstradeProvider.ts` | **chỉ TikTok**. Bỏ sạch nhánh Shopee/Lazada, bỏ `campaignId`/`promotionsMerchant`; `getPromotions` trả `[]` (khuyến mãi đang tắt) |
| `src/core/providers/accesstradeCommissionLookup.ts` | `implements CommissionLookup`, cắm vào đúng slot Shopee đang dùng |
| `src/core/providers/compositeProvider.ts` | **lấy lại** (39 dòng, bị xoá ở `6613aa4`). Factory hiện trả *một* provider; cần định tuyến `shopee` → `ShopeeAffiliateProvider`, `tiktokshop` → `AccesstradeProvider` |

### 4.3 File sửa

- `merchants.ts` — chuyển `tiktokshop` từ `RETIRED_MERCHANTS` sang `MERCHANTS`. Lazada để nguyên.
- `linkValidator.ts` — lấy lại nhánh `extractIds` cho `tiktokshop` (`/view/product/{id}` và
  `/pdp/{id}`) + `buildParsedLink` yêu cầu `itemId` **bắt buộc** cho tiktokshop
  (`NotAProductLinkError` nếu rỗng — chặn link video TikTok thường).
- `ledgerStore.ts` — cột `reconciled_at` + `migrateAddReconciledAtColumn`.
- `server.ts` — route `POST /admin/record-orders/accesstrade`.
- `adminHtml.ts` — card thứ 4 "Đồng bộ đơn TikTok Shop" trên `/admin/record-orders`; nhãn
  "đã đối soát" trên `/admin/orders`.
- `env.ts` + `.env.example` — xem mục 7.

**Đã verify link mẫu của user** (`https://shop.tiktok.com/vn/pdp/1733204173655213684?_t=...`) bằng
code thật: `extractProductUrls` nhặt được ✓, host khớp `RETIRED_MERCHANTS` nên hiện bị
`RetiredMerchantLinkError` ✓ (chuyển registry là xong), regex `/pdp/(\d+)` tách đúng
`1733204173655213684` ✓.

## 5. Lớp đọc đầu vào TikTok

Lọc `merchant === "tiktok_cps"`. Gộp theo `transaction_id`. Dòng "chính" = `product_id` **không** có
hậu tố `_bonus`.

| `NormalizedOrder` | Nguồn | Ghi chú |
|---|---|---|
| `orderId` | `transaction_id` | |
| `orderDate` | `transaction_time` **+7h** → `YYYY-MM-DD` | `time_zone: "+00:00"`, Railway chạy UTC |
| `completedAt` | `is_confirmed=0` → `confirmed_time` +7h; ngược lại `null` | xem 3.1 |
| `subId` | `_extra.sub_params.sub1` ?? `utm_content` | ưu tiên `sub1` — `utm_content` rỗng thật |
| `productName` | dòng chính có hoa hồng cao nhất + `(+N sản phẩm khác)` | dòng bonus có `product_name` rỗng |
| `orderAmount` | **tổng** `transaction_value` các dòng **chính** | chỉ để hiển thị |
| `commissionAmount` | **tổng** `commission` của **mọi** dòng | số thật về tay — xem cảnh báo 3.2 |
| `status` | bảng ở mục 1 | |
| `reconciledAt` | `is_confirmed=1` → `confirmed_time` +7h | field mới |
| `riskWindowClosed` | `true` khi **lần đầu thấy** đã `is_confirmed=1` | → `available_from = null` |

Đơn nhiều sản phẩm (N dòng chính + N dòng bonus) đi đúng quy tắc `mergeOrderRows` của Shopee: cộng
dồn, tên lấy từ dòng hoa hồng cao nhất, bất kỳ dòng trạng thái lạ → bỏ cả đơn.

### 5.1 Hai cái bẫy PHẢI tránh khi tái dùng quy tắc gộp của Shopee

**(a) Quy tắc lọc subId của Shopee sẽ XOÁ SẠCH hoa hồng TikTok.** `mergeOrderRows` loại dòng có
subId rỗng/khác khỏi tổng (để không gán hoa hồng "mua kèm" cho user). Nếu áp y nguyên cho TikTok mà
một dòng `_bonus` thiếu `sub1`, thì **dòng duy nhất chứa tiền bị loại** → đơn ghi 0đ. Nên: dòng
bonus **thừa hưởng subId của dòng chính**, không bao giờ bị loại vì subId; quy tắc lọc subId chỉ áp
cho dòng chính. **Có test chặn.**

**(b) Hậu tố `_bonus` là quy ước quan sát từ 3 mẫu, Accesstrade không ghi ở đâu cả.** Giảm bán kính
thiệt hại: `commissionAmount = SUM(commission)` **không phụ thuộc hậu tố** → tiền luôn đúng dù họ
đổi marker. Hậu tố chỉ ảnh hưởng `orderAmount`/`productName` (hiển thị). Không tìm được dòng chính
→ lùi về `MAX(transaction_value)` + **ghi cảnh báo** chứ không im lặng.

### 5.2 Mốc cutoff

`ACCESSTRADE_ORDER_CUTOFF_DATE` (`YYYY-MM-DD`), **bắt buộc** khi Accesstrade được cấu hình (theo
pattern `assertAffiliateProviderConfigured`). Đơn có `orderDate < cutoff` → skip, đếm riêng
`skippedBeforeCutoff`. **Bắt buộc chứ không có default** — để không instance nào vô tình trả tiền
ngược cho đơn lịch sử (365 ngày trong tài khoản có 3 đơn cũ ~47.000đ hoa hồng với subId tra ra
user thật).

### 5.3 Rate limit

429 ở bước import → **retry 1 lần có giãn**, rồi báo lỗi rõ cho admin. Import Shopee đọc file nên
không có failure mode này — đây là cái mới, đừng bỏ qua.

429 ở commission lookup → `null` (hợp đồng `CommissionLookup` đã bắt mọi đường thất bại về `null`,
không bao giờ throw). Tỉ lệ hụt sẽ **cao hơn Shopee** vì rate limit ~1 req/giây.

## 6. Giam đơn, nợ, và `reconciled_at`

Giam đơn dùng chung `PAYOUT_HOLD_THRESHOLD_VND` / `PAYOUT_HOLD_DAYS`. Đếm từ `completedAt`
(= `confirmed_time` lúc Tạm duyệt ≈ ngày giao hàng). `riskWindowClosed=true` → `available_from = null`.

Nợ hoàn trả, `DebtNotCoveredError`, tự huỷ yêu cầu rút khi đơn bị huỷ, ảnh "đơn về", template tin
nhắn, % riêng từng user, dashboard — **kế thừa nguyên, không sửa gì**, vì engine là một bản duy nhất
và các đường tiền đều không biết gì về sàn (đã kiểm: `payoutHold.ts` là hàm thuần; `orderImage/`
grep `merchant` ra trống; `shopeeReportImport.ts` ghi entry bằng `requestEntry.merchant` đọc từ log
request chứ không hardcode `"shopee"`).

`reconciled_at`: cột nullable + migration, **không backfill**. `/admin/orders` hiện thành **dòng phụ
dưới pill trạng thái** (như "mở khoá dd/mm" và "đã trả hàng") — **không thêm cột thứ 10**, bảng đã
9 cột và padding `px-4` là mức vừa đủ để cột "Thao tác" không bị đẩy ra ngoài màn ~1700px.

## 7. Biến môi trường

| Biến | Mặc định | Ghi chú |
|---|---|---|
| `ACCESSTRADE_API_KEY` | — | bắt buộc khi bật TikTok |
| `ACCESSTRADE_API_BASE` | `https://api.accesstrade.vn` | |
| `ACCESSTRADE_TIMEOUT_MS` | 4000 | |
| `ACCESSTRADE_ORDER_CUTOFF_DATE` | — | **bắt buộc**, xem 5.2 |

Không cần `ACCESSTRADE_CAMPAIGN_ID_*` (endpoint TikTok không dùng), không cần
`ACCESSTRADE_SYNC_*` (không làm cron).

## 8. Thu hoạch từ git history

Code cũ còn nguyên tại commit **`433f4e8`** (trước 7 commit gỡ `6613aa4` → `b03c4bc`, tổng 2.507
dòng xoá trên 41 file).

**Đáng tái dùng** — lớp gọi API, ~400 dòng kiến thức đã trả giá bằng debug thật: endpoint, tên
field, auth `Token`, `{"status": false}` trong HTTP 200, `sub1` bắt buộc, `aff_short_url` vs
`short_link`, pattern `/pdp/` của app TikTok.

**KHÔNG bê về** — phần ghi ledger của `accesstradeSync.ts` cũ: viết 2026-08-20, trước khi có
`order_date`, 3 cột `*_percent` chốt theo đơn, `completed_at`/`available_from`, `payout_debts` và
bảng quyết định 5 ca. Đã lỗi thời hoàn toàn.

## 9. Kế hoạch test

- **26 test `shopeeReportImport` xanh y nguyên, không sửa một dòng** — bằng chứng refactor thuần.
- Gộp 2 dòng cùng `transaction_id` → `commissionAmount = 37005`; chỉ đọc dòng chính → sai thành `0`.
- Chặn lấy nhầm `transaction_value` của dòng bonus (57.667 → lỗ mỗi đơn).
- Dòng bonus thiếu `sub1` vẫn **không** bị loại khỏi tổng (bẫy 5.1a).
- Không tìm được dòng chính → lùi `MAX(transaction_value)` + có cảnh báo (bẫy 5.1b).
- Timezone: đơn `2026-09-07T00:56:47Z` → ngày VN `2026-09-07`; ca đổi ngày `17:30Z` → hôm sau.
- `status=0` → `pending`; `status` lạ → skip cả đơn + cảnh báo.
- `is_confirmed=1` lần đầu thấy → `available_from = null` (không giam).
- `orderDate < cutoff` → skip, đếm `skippedBeforeCutoff`.
- Link `/vn/pdp/{id}` và `/view/product/{id}` tách đúng `itemId`; link video TikTok → `NotAProductLinkError`.
- Commission lookup: 429 / timeout / JSON hỏng / số âm → `null`; `commission = 0` → "chưa bật hoa hồng".

## 10. Thứ tự commit

1. Tách engine (test Shopee xanh y nguyên)
2. Bật `tiktokshop` trong registry + `linkValidator`
3. Provider tạo link + composite routing
4. Commission lookup
5. Lớp đọc đơn + route web + card admin
6. `reconciled_at` + nhãn admin
7. `.env.example` + CLAUDE.md

## 11. Điểm CHƯA kiểm chứng được

1. **Nhãn "Tạm duyệt"**: suy ra từ `status=1, is_confirmed=0` + vòng đời 7 ngày khớp giao hàng. Cần
   user nhìn dashboard Accesstrade đơn `585930815026529295` để xác nhận nhãn thật — đây là mắt chốt
   *khi nào trả tiền cho user*.
2. **Nhánh `status=2`** (huỷ/từ chối): không có mẫu thật nào trong 365 ngày. Mapping `2 → reversed`
   dựa trên doc comment code cũ. Có field `reason_rejected` (đang rỗng). Logic phía sau là engine
   đã được Shopee kiểm chứng.
3. **`status=0`** cũng không có mẫu thật — dựa trên doc comment code cũ ("status=0 (hold)").
4. **Trần hoa hồng TikTok**: Shopee có trần 40.000đ/đơn; TikTok chưa biết. Feed chỉ trả `giá × rate`,
   không thể hiện trần. Cách đo: sau vài đơn giá trị lớn, so `commission` thực nhận với
   `giá × rate × 0,6417` — lệch xuống đều đặn là có trần.

## 12. Ghi chú vận hành

- Lúc verify có tạo 1 link affiliate thật với `sub1=k-probe-test-0001`
  (`https://shorten.asia/tdc8tUFP`). Không trỏ về user nào.
- API key đã xuất hiện trong lịch sử chat khi verify → nên rotate sau khi xong.
- `data/report_template/` đang `.gitignore` — giữ nguyên nếu thêm mẫu response Accesstrade.
