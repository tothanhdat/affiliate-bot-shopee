# Bỏ TikTok Shop và Lazada khỏi scope — dự án chỉ còn Shopee

- **Ngày**: 2026-09-29
- **Trạng thái**: thiết kế chờ user duyệt
- **Quyết định bởi**: user (chủ dự án), trong phiên brainstorm 2026-09-29

## 1. Bối cảnh và quyết định

**Lý do**: Accesstrade và TikTok Shop cập nhật trạng thái đơn quá chậm, ảnh hưởng nặng tới trải
nghiệm người dùng (user gửi link, mua hàng, rồi chờ rất lâu mới thấy đơn đổi trạng thái trên
dashboard). Đây là lý do nghiệp vụ, không phải lý do kỹ thuật.

**Quyết định** (user chốt 2026-09-29):

1. Dự án **chỉ hỗ trợ Shopee**. Bỏ cả TikTok Shop **lẫn Lazada**.
2. Vì Shopee đi thẳng qua `an_redir` (không qua Accesstrade), bỏ 2 sàn trên đồng nghĩa
   **Accesstrade không còn merchant nào** → gỡ toàn bộ đường Accesstrade khỏi codebase.
3. **Làm dứt điểm 1 đợt**, không có giai đoạn "rút lui" giữ `accesstradeSync` chạy nốt. Lý do:
   production hiện chỉ còn **1 đơn TikTok Shop `pending`** (trên cả 2 service Railway cộng lại),
   là đơn của người quen của user — user tự huỷ qua `/admin/orders` và xử lý riêng với người đó.
4. Bỏ luôn `accesstrade_payments` + trang `/admin/accesstrade-payments` + CLI
   `record-accesstrade-payment` + `reconciliation-summary` — user **chưa bao giờ nhận tiền từ
   Accesstrade**, nên đây là code chết chứ không phải sổ tiền có giá trị lịch sử.
5. Link của sàn đã ngưng (TikTok Shop / Lazada) phải được bot **trả lời rõ ràng**, không im lặng.

**Không đụng tới dữ liệu ledger lịch sử.** Các entry `merchant='tiktokshop'` / `'lazada'` đã ghi
vẫn nằm nguyên trong DB và vẫn phải hiển thị đúng trên `/admin/orders`.

## 2. Nguyên tắc thiết kế

### 2.1 Tách "sàn đang hỗ trợ" khỏi "sàn từng hỗ trợ"

**Không thu hẹp `MerchantId` xuống còn `"shopee"`.** `commission_entries.merchant` trong DB thật
đang có giá trị `'tiktokshop'`/`'lazada'`, và `CommissionEntry.merchant` được cast thẳng từ row DB
(`src/core/ledgerStore.ts:1230`). Thu hẹp type sẽ:

- nói dối về dữ liệu thật (type bảo chỉ có `shopee`, DB thì không phải vậy), và
- làm `getMerchantConfig()` ném `Error` khi render đơn cũ → **crash trang `/admin/orders`**.

Thiết kế trong `src/core/merchants.ts`:

| Thứ | Nội dung | Điều khiển cái gì |
|---|---|---|
| `MerchantId` | giữ nguyên 3 giá trị `"shopee" \| "lazada" \| "tiktokshop"` | kiểu dữ liệu của ledger (lịch sử) |
| `MERCHANTS` | **chỉ còn Shopee** | nhận diện link để xử lý + chọn provider |
| `RETIRED_MERCHANTS` (mới) | `tiktokshop`, `lazada` — kèm `displayName`, `hostPattern`, `shortHosts` | hiển thị tên sàn cho đơn cũ + nhận diện link để từ chối tử tế |

- `detectMerchantByHost()` giữ nguyên ngữ nghĩa: chỉ tra `MERCHANTS` (= "sàn xử lý được").
- Thêm `detectRetiredMerchantByHost()` tra `RETIRED_MERCHANTS`.
- `getMerchantConfig(id)` tra **cả hai** danh sách → đơn TikTok cũ vẫn hiện "TikTok Shop", không throw.

### 2.2 Link sàn đã ngưng phải được trả lời, không im lặng

Đây là điểm dễ làm sai nhất. `extractProductUrls()` (`src/core/linkValidator.ts:8`) **lọc URL theo
đúng registry merchant**. Nếu chỉ gỡ TikTok Shop khỏi `MERCHANTS` mà không làm gì thêm, link TikTok
sẽ không được nhặt ra khỏi tin nhắn → rơi vào nhánh "tin nhắn không chứa link sản phẩm" → Zalo DM
**im lặng hoàn toàn** (quyết định 2026-08-21). User gửi link rồi không nhận được gì, tưởng bot hỏng.

Cách làm:

1. `extractProductUrls()` nhặt cả host của `RETIRED_MERCHANTS`.
2. `parseProductLink()` gặp host retired → ném **`RetiredMerchantLinkError`** (subclass `AppError`,
   code `RETIRED_MERCHANT_LINK`), `userMessage` đại ý:
   *"Hiện em chỉ hỗ trợ Shopee thôi ạ 🛒 Bạn gửi link Shopee giúp em nha."*
3. Lỗi đi qua đúng đường `AppError` sẵn có → Telegram, Zalo group, Zalo DM **tự có hành vi đúng**,
   không phải sửa adapter nào.

**Tại sao không tái dùng `UnsupportedMerchantLinkError`**: message của nó là *"Sàn này em chưa hỗ
trợ được á, để em báo admin cập nhật thêm nha"* — hứa hẹn sai, vì 2 sàn này sẽ không được thêm lại.

## 3. Phạm vi thay đổi

### 3.1 Xoá hẳn

**Code:**

- `src/core/providers/accesstradeProvider.ts` + test
- `src/core/providers/compositeProvider.ts` + test (chỉ còn 1 provider thì không cần định tuyến)
- `src/core/accesstradeSync.ts` + test
- `runAccesstradeSync()` + scheduler + `msUntilNextHour()` trong `src/index.ts`
- CLI (`src/scripts/ledgerAdmin.ts`): `sync-accesstrade`, `record-conversions-csv`,
  `record-accesstrade-payment`, `reconciliation-summary`
- `src/scripts/templates/weekly-conversions.example.csv`
- `LedgerStore`: `recordAccesstradePayment()`, `listAccesstradePayments()`,
  `getReconciliationSummary()`, và câu `CREATE TABLE accesstrade_payments` trong schema
- Route + trang `/admin/accesstrade-payments` (`server.ts`, `adminHtml.ts`) + link ở sidebar

**Config:** `ACCESSTRADE_API_KEY`, `ACCESSTRADE_API_BASE`, `ACCESSTRADE_ENDPOINT_PATH`,
`ACCESSTRADE_CAMPAIGN_ID_*`, `ACCESSTRADE_PROMOTIONS_MERCHANT_*`, `ACCESSTRADE_SYNC_*`, và option
`AFFILIATE_PROVIDER=accesstrade` (chỉ còn `mock` | `shopee_direct`). Gỡ cả đoạn suy ra config
theo merchant trong `src/config/env.ts`.

> **KHÔNG chạy `DROP TABLE accesstrade_payments` trên DB production.** Bỏ `CREATE TABLE` khỏi code
> là đủ; bảng rỗng còn sót trong DB cũ vô hại. `DROP` là thao tác phá huỷ trên DB tiền.

### 3.2 GIỮ — những thứ có tên gợi ý phải xoá nhưng thực ra đang phục vụ Shopee

Đây là danh sách chống-xoá-nhầm, quan trọng ngang phần xoá:

| Thứ | Vì sao giữ |
|---|---|
| `src/scripts/csv.ts` (`parseCsv`) | `shopeeReportImport.ts` dùng để đọc file báo cáo gốc Shopee |
| `orderIngest.recordOrderFromAccesstrade()` | **Tên gây hiểu nhầm**: đây là hàm ghi 1 đơn dùng chung, form web "Ghi 1 đơn lẻ" (`POST /admin/record-orders/single`) vẫn gọi. → **Giữ, đổi tên thành `recordSingleOrder()`** |
| `orderIngest.summarizeOrderResultsByUser()` | Dùng bởi route web `/admin/record-orders/*` để gộp thông báo theo user |
| `shopeeReportImport.ts` | Đường đối soát chính và duy nhất còn lại |
| Bảng `commission_entries` với rows TikTok/Lazada | Lịch sử tiền, không xoá |

`orderIngest.recordOrdersFromCsv()`: chỉ xoá **nếu sau khi gỡ CLI `record-conversions-csv` thì
không còn caller nào** (route web `/admin/record-orders/csv` đã bị gỡ trước đó, 2026-08-23). Phải
kiểm tra caller thật lúc implement, không xoá theo suy đoán.

### 3.3 Sửa

| File | Nội dung |
|---|---|
| `src/core/merchants.ts` | theo mục 2.1 |
| `src/core/linkValidator.ts` | bỏ nhánh `tiktokshop` trong `extractIds()` và `buildParsedLink()`; thêm nhánh retired trong `extractProductUrls()` + `parseProductLink()` |
| `src/core/errors.ts` | thêm `RetiredMerchantLinkError` |
| `src/core/providers/index.ts` | `shopee_direct` trả thẳng `ShopeeAffiliateProvider`, bỏ `CompositeAffiliateProvider` |
| `src/core/providers/mockProvider.ts` | bỏ dữ liệu mẫu Lazada/TikTok Shop |
| `src/core/affiliateProvider.ts` | doc comment nhắc TikTok Shop |
| `src/adapters/shared/replyText.ts` | `USAGE_TEXT` — bỏ "hoặc TikTok Shop" |
| `src/core/faq/faqTopics.ts` | viết lại chủ đề "Sàn được hỗ trợ" (chỉ Shopee); **xoá hẳn** chủ đề về đơn TikTok Shop cập nhật chậm |
| `src/api/handbookHtml.ts` | 11 chỗ nhắc TikTok Shop trong Sổ tay hoàn tiền |
| `src/config/env.ts` | theo 3.1 |

Về việc xoá 1 chủ đề FAQ: setting `faq_answer_<id>` của chủ đề đó còn nằm lại trong bảng `settings`
như bản ghi mồ côi. Vô hại (không có gì đọc nó nữa), không cần migration.

### 3.4 Tài liệu

**Sửa**: `CLAUDE.md`, `README.md`, `SRS.md`, `danh-sach-tinh-nang.md`, `huong-dan-nguoi-dung.md`,
`huong-dan-van-hanh-admin.md`, `huong-dan-van-hanh-cho-doi-tac.md`, `huong-dan-deploy-instance-moi.md`,
`rui-ro-can-giai-quyet.md`, `product-backlog.md`, `.env.example`.

**Skill**: `.claude/skills/tich-hop-affiliate-provider/SKILL.md` — gỡ phần TikTok Shop/Lazada, chỉ
còn Shopee. `.claude/skills/doi-soat-hoa-hong/SKILL.md` — **xoá skill**, vì toàn bộ nội dung của nó
là cơ chế `accesstradeSync.ts`; quy tắc trạng thái của báo cáo Shopee đã nằm ở `CLAUDE.md` và
`shopeeReportImport.ts`.

**KHÔNG sửa**: `docs/superpowers/specs/**` và `docs/superpowers/plans/**` — đó là biên bản quyết
định theo ngày, sửa lại là làm sai lịch sử. Spec này là bản ghi mới, không ghi đè bản cũ.

**Xoá**: `CLAUDE.md.bak-doctor` (file rác chưa commit trong working tree).

## 4. Kiểm thử

- `linkValidator`: link `tiktok.com`, `vt.tiktok.com`, `shop.tiktok.com/vn/pdp/...`, `lazada.vn`
  → ném `RetiredMerchantLinkError`; link Shopee vẫn resolve bình thường.
- `linkValidator`: `extractProductUrls()` **vẫn nhặt** URL TikTok/Lazada ra khỏi text (nếu không
  nhặt thì bot im lặng — đây là test chặn đúng cái bug ở mục 2.2).
- `merchants`: `getMerchantConfig("tiktokshop")` vẫn trả `displayName` "TikTok Shop" và không throw
  (test hồi quy chặn crash `/admin/orders`).
- `ledgerStore`: entry `merchant='tiktokshop'` đọc ra và hiển thị được.
- `replyText` / `handbookHtml`: không còn chuỗi "TikTok" hay "Lazada".
- Xoá test của các module bị xoá.
- Chạy `npm test` toàn bộ + `tsc --noEmit` trước khi kết luận xong.

## 5. Việc vận hành sau deploy (bắt buộc, làm trên CẢ 2 service Railway)

1. **Huỷ đơn TikTok `pending`** qua `/admin/orders` → link "Huỷ đơn" trên dòng đó
   (`adminHtml.ts:662`). User tự làm và nhắn riêng cho người liên quan.
2. **Vào `/admin/settings` sửa tay** mọi giá trị còn chữ "TikTok"/"Lazada": `usageText`, các
   `faq_answer_*`, và bất kỳ template tin nhắn nào.
   > **Đây là cái bẫy chung của mọi template trong dự án này**: instance nào đã từng bấm Lưu thì giá
   > trị trong DB **đè** lên default trong code. Deploy code sạch xong bot vẫn nói "TikTok Shop".
3. Gỡ các biến môi trường `ACCESSTRADE_*` trên cả 2 service (không bắt buộc về mặt chức năng sau
   khi code không đọc nữa, nhưng để env sạch, tránh hiểu nhầm về sau).
4. **Kiểm tra thật**: gửi 1 link TikTok vào bot → phải nhận được câu "chỉ hỗ trợ Shopee"; gửi 1
   link Shopee → vẫn ra link rút gọn như cũ.

## 6. Ngoài phạm vi

- **Đối soát "tiền đã nhận từ sàn" vs "tiền đã trả user" cho Shopee**: khái niệm này vẫn hữu ích,
  nhưng `getReconciliationSummary()` hiện neo hoàn toàn vào `accesstrade_payments` nên bị gỡ cùng.
  Nếu sau này cần cho Shopee, đó là tính năng mới, thiết kế riêng.
- Không `DROP TABLE` trên DB production.
- Không sửa lại các spec/plan lịch sử.

## 7. Rủi ro đã nhận diện

| Rủi ro | Giảm thiểu |
|---|---|
| Gỡ merchant khỏi registry làm bot **im lặng** với link TikTok | Mục 2.2 + test `extractProductUrls` ở mục 4 |
| `getMerchantConfig()` chỉ tra `MERCHANTS` → crash `/admin/orders` khi render đơn cũ | Mục 2.1 + test hồi quy |
| Xoá nhầm `csv.ts` / `recordOrderFromAccesstrade()` → hỏng đường Shopee | Bảng chống-xoá-nhầm mục 3.2 |
| Sửa code xong quên sửa settings trong DB → user vẫn thấy "TikTok Shop" | Checklist mục 5, bước 2 và 4 |
| Thu hẹp `MerchantId` vì "gọn hơn" | Mục 2.1 nêu rõ lý do không làm |
