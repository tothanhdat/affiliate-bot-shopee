# Đối soát đơn TikTok Shop qua RioHub — thiết kế

> Tiếp nối `2026-10-09-tiktok-shop-qua-riohub-design.md` (đường **tạo link**, đã xong và đang chạy
> thật trên production từ 10/10/2026). Spec này làm phần còn lại: **kéo đơn TikTok về và ghi vào
> ledger**, để tiền của user TikTok chảy đúng như tiền Shopee.
>
> Hồ sơ kỹ thuật nguồn: `docs/riohub-tiktok.md`. Rủi ro còn mở: `rui-ro-tich-hop-tiktok.md`.
> Mẫu để đối chiếu: `src/core/shopeeReportImport.ts` + `.claude/rules/import-bao-cao-shopee.md`.

## 1. Mục tiêu

Đơn phát sinh từ link TikTok do bot tạo phải tự vào `commission_entries` với `merchant='tiktokshop'`,
đi qua **đúng** mọi luật tiền đang áp cho Shopee: chia % theo tỉ lệ chốt từng đơn, giam đơn to, hoãn
đơn nhỏ, nợ hoàn trả, tự huỷ yêu cầu rút khi đơn bị huỷ.

Với user, việc thêm TikTok là **vô hình**: cùng một số dư, cùng `/d/:token`, cùng tin "đơn về", cùng
ngưỡng rút (mục 1.4 của `docs/riohub-tiktok.md`).

**Ngoài phạm vi**: webhook (đã chọn polling, xem mục 3.1), đồng bộ tự động theo giờ (xem mục 3.1),
ví CAST của RioHub (dòng tiền riêng, mục 1.3 của tài liệu).

## 2. Quyết định đã chốt với chủ bot (2026-10-11)

| # | Quyết định | Lý do |
|---|---|---|
| 2.1 | **Bấm tay trước, tự động sau** | Bảng quyết định trạng thái đang dựng trên 2 đơn / 1 trạng thái; vài lần đầu chủ bot phải tận mắt xem nó ghi gì |
| 2.2 | **Đơn vào Khả dụng NGAY LÚC GIAO HÀNG**, không chờ RioHub quyết toán | `SETTLED` nằm sau cửa sổ trả hàng 15+ ngày — chờ nó là trải nghiệm rất tệ, user không đợi được. `payoutHold.ts` ghi rõ Shopee cũng bật "Hoàn thành" **ngay lúc giao hàng**, nên `time_delivered_iso` là mốc tương đương, không phải `SETTLED` |
| 2.2b | **Hoa hồng gốc = `est_commission × 0,9`**, không sửa lại số sau khi đã chốt | Lúc giao hàng chỉ có `est` (số thô, chưa trừ thuế `pit`); `actual_commission` phải chờ ~15 ngày nữa. Hệ số 0,9 giữ đúng bài toán kinh tế ở mục 1.3b của `docs/riohub-tiktok.md`. Sửa số sau khi entry đã `confirmed` thì tiền user đã thấy và rút được → chạm vào cỗ máy nợ hoàn trả trên **mọi đơn** thay vì ca trả hàng hiếm: đánh đổi quá tệ |
| 2.3 | **Tách lớp áp ledger dùng chung** với Shopee | Bản sao thứ hai của đường tiền là loại nợ kỹ thuật đắt nhất ở đây; chính đoạn đó lòi ra lỗ hổng nghiêm trọng 08/10/2026 |
| 2.4 | **Cách ly Shopee ↔ TikTok là ràng buộc hạng nhất** | Yêu cầu trực tiếp của chủ bot: đồng bộ TikTok hỏng, hoặc bỏ hẳn TikTok sau này, đều **không được** ảnh hưởng Shopee |
| 2.5 | `pit` **không** cảnh báo lặp, `shared_with_partner ≠ 0` **có** | `pit` khác 0 là chuyện đúng-như-dự-kiến vĩnh viễn; báo động nó mỗi ngày sẽ làm nhờn luôn cảnh báo thật |

**Hệ quả của 2.2b — ghi lại bằng số để sau không ai tưởng là bug.** Trên đơn thật `est = 2.136đ`:

| | Hoa hồng gốc ghi vào ledger | User nhận | Chủ bot thực nhận | Chủ bot giữ lại |
|---|---|---|---|---|
| Phương án đã chọn (`est × 0,9`) | 1.922đ | **1.370đ** | ~1.922đ | **~552đ** |
| Phương án đã loại (`est` thô) | 2.136đ | 1.522đ | ~1.922đ | ~400đ |

Phương án đã chọn giữ nguyên bài toán 1.3b. **Đánh đổi đã được chủ bot chấp nhận, và nó là chỗ căng
nhất của spec này**: TikTok đã khấu trừ `pit` tại nguồn rồi hệ thống trừ 10% "thuế" lần nữa, nên
`/so-tay` đang hứa user nhận 71,28% hoa hồng gốc mà user TikTok thực nhận 64,15%. Chính mục 1.3b đã
ghi nhận chuyện này (*"nhãn thì không đúng bản chất"*) và chấp nhận, vì **mọi số user nhìn thấy đều
suy ra từ `commission_amount` đã lưu nên không hề mâu thuẫn nhau** — user không có cách nào phát hiện.
Muốn chuẩn hoá thì sửa câu chữ ở `/so-tay`, **không sửa phép tính**.

Giữ nguyên từ spec trước (mục 1.3b của tài liệu): **TikTok vẫn trừ 10% thuế + 1% phí sàn như Shopee**,
nên `computeCommissionBreakdown()` **không đổi một dòng**, không có nhánh riêng theo merchant.

## 3. Kiến trúc

```
Admin bấm "Đồng bộ đơn TikTok Shop"  (/admin/record-orders)
  │
  ▼
POST /admin/record-orders/tiktok-sync                      src/api/server.ts
  │
  ▼
fetchTiktokOrders(client, creatorUsername)                 src/core/providers/riohubOrdersSource.ts
  phân trang page_size=200 → RiohubOrderRecord[]           ◀── chỗ DUY NHẤT gọi mạng
  │
  ▼
importTiktokOrders(logStore, ledgerStore, config, orders)   src/core/tiktokOrderImport.ts
  gộp dòng theo order_id → phân loại trạng thái             ◀── THUẦN, test bằng fixture
  │
  ▼
applyOrderStatusToLedger(...)                              src/core/orderStatusApply.ts
                                                            ◀── DÙNG CHUNG với Shopee
  │
  ▼
commission_entries · payout_debts · order_status_events · seen_orders
  │
  ├─▶ tự hiện ở /admin/orders, /admin/dashboard, dashboard user
  ├─▶ tin "đơn về" cho user (ảnh) qua buildOrdersConfirmedNotification()
  └─▶ cảnh báo admin: shared_with_partner ≠ 0 (7.1) · actual thấp hơn số đã trả (7.1b)
```

`/admin/links` **không** nằm trong danh sách trên: nó đọc từ `logStore.listCreatedLinks()` (bảng
`requests`), tức dữ liệu được ghi lúc **tạo link** — đường này không chạm tới nó. Link TikTok đã hiện
ở đó từ 10/10.

`importTiktokOrders` nhận **một mảng**, không tự gọi mạng — y hệt `importShopeeReport` nhận `csvText`.
Nhờ vậy toàn bộ bảng quyết định tiền test được bằng fixture, không mock HTTP.

### 3.1 Vì sao polling bấm tay, không webhook, không tự động (lúc này)

- **Không webhook**: thuật toán ký `X-Riohub-Signature` và hành vi retry đều là chép từ tài liệu,
  chưa chạm một dòng (rủi ro 8). Webhook cần mở route công khai + verify chữ ký đúng; polling thì gần
  như không có gì để hỏng. Rủi ro 8 được **đóng** bằng quyết định này.
- **Chưa tự động**: trần nhịp đồng bộ là độ trễ nguồn — 17–19 phút cho đơn mới, **~3 tiếng** cho mốc
  quyết toán. Gọi dày hơn là vô ích. Bật tự động sau này = gọi đúng hai hàm trên từ một `setInterval`,
  **không sửa gì bên trong** (tiền lệ: `rateLimiter.ts` đã dùng `setInterval(...).unref()`).

### 3.2 Lấy toàn bộ, không lọc ngày

Tài liệu khuyến nghị sync tăng dần bằng `update_time_start/end`, nhưng **mục 2.5 của
`docs/riohub-tiktok.md`** ghi cạm bẫy: **sai tên HOẶC sai định dạng tham số đều bị nuốt im lặng** rồi
trả về toàn bộ lịch sử — không `422`, không một dấu hiệu nào. Nghĩa là code **buộc phải** chịu được ca quét toàn bộ dù có lọc hay không.

Nên: quét toàn bộ, phân trang, không lọc ngày. Lý do:

1. Dung lượng hiện tại là 4 đơn — lọc là tối ưu hoá sớm cho một bài toán chưa tồn tại.
2. Tự chữa lành: một đơn đổi trạng thái từ 3 tháng trước vẫn được nhặt lại.
3. Cơ chế chống nhân đôi đang chạy cho Shopee (`ON CONFLICT DO NOTHING` của `payout_debts`,
   `INSERT OR IGNORE` của `order_status_events`, `DuplicateConversionError`) **chính là** lưới an toàn
   cho ca này.

Khi số đơn lớn lên thì thêm `update_time_start`, và **phải test bằng giá trị mà kết quả buộc phải
khác đối chứng** — nếu kết quả không đổi thì tham số đang bị nuốt, bất kể tài liệu viết gì.

## 4. `orderStatusApply.ts` — lớp áp ledger dùng chung

**Đây là refactor, không phải code mới.** Toàn bộ nội dung chuyển từ `importShopeeReport()` sang,
**không đổi hành vi**.

### 4.1 Đường cắt

| Ở lại mỗi sàn | Chuyển vào lớp dùng chung |
|---|---|
| Đọc định dạng nguồn (CSV tiếng Việt / JSON RioHub) | `resolveUserSharePercent` theo ngày đặt đơn |
| Gộp dòng thành đơn | `recordSeenOrder` (chart "Đơn mới") |
| Phân loại trạng thái đơn | `backfillOrderDate` / `backfillOrderTime` |
| Câu lý do huỷ, nhãn nguồn cho tin cảnh báo | Cảnh báo đơn bị khoá hoa hồng tay |
| | Nhánh `confirmed`: `confirmPendingEntry` / `recordConversion`, hoãn đơn nhỏ, đếm đơn bị giam |
| | Nhánh `pending`: `updatePendingEntry` / `recordConversion` |
| | Nhánh `reversed`: **bảng 5 ca**, tự huỷ yêu cầu rút, ghi nợ hoàn trả |
| | `recordOrderStatusEvent` |

Đúng chỗ hai sàn khác nhau thật: Shopee phân loại bằng **nhãn tiếng Việt** của cột "Trạng thái sản
phẩm liên kết", TikTok bằng **enum số đã chuẩn hoá** cộng một **mốc thời gian giao hàng** — hai hình
dạng dữ liệu khác hẳn, và mốc giao hàng thì Shopee không có tương đương dạng field.

### 4.2 Giao diện

```ts
/** Một đơn có thể sinh HAI việc (huỷ yêu cầu rút *và* reverse) nên trả mảng. */
export type OrderStatusOutcome =
  | { kind: "confirmed-new"; entry: CommissionEntry; wasPending: boolean; held: boolean }
  | { kind: "confirmed-duplicate" }
  | { kind: "small-hold-deferred" }
  | { kind: "pending-new" }
  | { kind: "pending-updated" }
  | { kind: "reversed"; from: CommissionStatus }
  | { kind: "reversed-unseen" }
  | { kind: "debt-created"; platform: Platform; userId: string; orderId: string; amount: number }
  | {
      kind: "withdrawal-cancelled";
      platform: Platform;
      userId: string;
      withdrawalId: number;
      amount: number;
      orderId: string;
    }
  | { kind: "warning"; message: string }
  | { kind: "error"; message: string };

export interface OrderStatusApplyInput {
  orderId: string;
  targetStatus: "confirmed" | "pending" | "reversed";
  subId: string;
  requestEntry: { platform: Platform; userId: string; merchant: MerchantId };
  orderAmount: number;
  /** BI BO QUA khi targetStatus = "reversed": nhanh do thu hoi theo existing.userShareAmount da luu. */
  commissionAmount: number;
  productName: string | null;
  orderDate: string | null;
  orderTime: string | null;
  completedAt: string | null;
  /** Câu ghi vào lịch sử khi reverse — mỗi sàn tự diễn đạt theo nhãn nguồn của nó. */
  reverseReason: string;
  /** Ghi vào `note` của entry mới. Vd "Nhap tu bao cao Shopee (file CSV admin upload)". */
  sourceNote: string;
  /** Tên nguồn trong câu cảnh báo hoa hồng bị khoá. Vd "Bao cao Shopee" / "RioHub". */
  sourceLabel: string;
}

export function applyOrderStatusToLedger(
  ledgerStore: LedgerStore,
  input: OrderStatusApplyInput,
  recordOrderConfig: RecordOrderConfig,
  importDay: string
): OrderStatusOutcome[];
```

Mỗi caller tự map `OrderStatusOutcome[]` sang result shape của mình. **`ShopeeReportImportResult`
giữ nguyên từng field** — đó là điều kiện để test cũ không phải sửa.

### 4.3 Luật kiểm chứng refactor

**Baseline đã chốt 2026-10-11 trên nhánh `tiktok-riohub` sau khi merge `main`: `947 pass / 0 fail`,
typecheck sạch.**

Sau refactor: `shopeeReportImport.test.ts` (27 ca), `shopeeReportOrderDate.test.ts`,
`shopeeReportSmallHold.test.ts`, `payoutDebt.test.ts` phải xanh **không sửa một dòng nào**.

> Phải sửa một test Shopee = extraction đã đổi hành vi ⇒ **dừng, làm lại**, không sửa test cho khớp.
> Đây là bất biến quan trọng nhất của cả đợt: nó là thứ duy nhất chứng minh đường tiền Shopee không
> bị đụng.

Entry nào không chạm tới: `ledgerStore.ts`, `payoutHold.ts`, `commissionMath.ts`, `orderIngest.ts`
giữ nguyên hoàn toàn.

## 5. Bảng quyết định trạng thái TikTok

### 5.1 Gộp dòng

Theo `order_id`. Một đơn nhiều SKU là **nhiều dòng**, mỗi dòng một SKU (tài liệu đã xác nhận, y hệt
Shopee tách nhiều sản phẩm cùng shop).

### 5.2 Phân loại từng dòng — đọc `status`, KHÔNG đọc `settlement_status`

`settlement_status` là **passthrough của TikTok** và tài liệu ghi thẳng *"TikTok có thể bổ sung trạng
thái khác"*. Rẽ nhánh theo nó là để một chuỗi lạ âm thầm rơi vào nhánh sai. `status` là enum RioHub
**đã chuẩn hoá**:

| `status` | Nghĩa |
|---|---|
| `1` | chờ (gồm cả `AWAITING PAYMENT` và `To-SETTLE`) |
| `2` | đã quyết toán |
| `3` | huỷ / hoàn |
| khác, hoặc thiếu | **lạ** |

### 5.3 Trạng thái cả đơn — mốc là GIAO HÀNG, không phải quyết toán

Quyết định 2.2. `status` **một mình không đủ** để quyết định: `status=1` gồm cả đơn chưa giao lẫn đơn
đã giao đang chờ TikTok quyết toán, mà hai ca đó phải đi hai đường khác nhau. Nên tín hiệu chuyển
`confirmed` là **`time_delivered_iso !== null`**.

Vì sao đó là mốc đúng chứ không phải mốc tiện: `payoutHold.ts` ghi rõ **Shopee bật "Hoàn thành" cho
đơn affiliate ngay lúc giao hàng**, chứ không phải sau khi hết hạn trả hàng — cơ chế giam tồn tại
chính vì thế. Nên `time_delivered_iso` của TikTok **tương đương** "Hoàn thành" của Shopee, còn `SETTLED`
của RioHub là một mốc khác hẳn và muộn hơn nhiều.

Theo đúng nguyên tắc *"chưa chắc chắn hết thì vẫn pending"* của `mergeOrderRows` bên Shopee:

**Xét theo thứ tự trên xuống, dừng ở dòng khớp đầu tiên** — thứ tự là một phần của luật, không phải
cách trình bày: đơn toàn dòng `3` **không có** dòng không huỷ nào, nên nếu xét ca `pending` trước thì
nó rơi tuột xuống `confirmed` và đơn bị huỷ lại được ghi tiền.

| # | Tình huống các dòng | Cả đơn | Ghi chú |
|---|---|---|---|
| 1 | có **bất kỳ** dòng `status` lạ | **bỏ qua cả đơn** + cảnh báo | không đoán mò trên tiền — đúng `skippedUnknownStatus` của Shopee |
| 2 | **tất cả** dòng = `3` | `reversed` | phải xét TRƯỚC ca 3, xem đoạn trên |
| 3 | còn dòng không huỷ **chưa giao** và **chưa quyết toán** | `pending` | món cuối chưa về thì cả đơn chưa chắc |
| 4 | còn lại (mọi dòng không huỷ đã giao, hoặc `status=2`) | **`confirmed`** | giam theo `time_delivered_iso`; dòng `3` bị **loại khỏi tổng tiền** (hoàn một phần) |

`status=2` vẫn được nhận là `confirmed` **kể cả khi `time_delivered_iso` rỗng** — đã quyết toán là
tín hiệu mạnh hơn đã giao, không có lý gì giữ lại. Lúc đó `completedAt` là `null` và
`resolveConfirmPlan()` tự lùi về hôm nay.

Luật giam dùng **nguyên** `resolveConfirmPlan()`, không sửa một dòng: đơn nhỏ nằm lại `pending` thêm
`payout_hold_small_days` (mặc định 1) ngày, đơn to vào `confirmed` với `available_from` sau
`payout_hold_days` (mặc định 7) ngày — cả hai đếm từ `completedAt`, y hệt Shopee.

**Hệ quả vận hành phải biết trước**: đơn nhỏ vào Khả dụng ở **lần đồng bộ KẾ TIẾP** sau ngày đã chốt,
chứ không tự mở theo ngày — đúng tính chất đã được chấp nhận cho Shopee (xem
`.claude/rules/ledger-va-tien.md`, mục `payoutHold.ts`). Với Shopee nó vô hại vì có nhịp import hằng
ngày 9h30. Với TikTok thì **phải bấm nút ở hai ngày khác nhau** mới xong một đơn nhỏ.

Chuyện này **gần như tự tan** vì cả hai nút nằm trên **cùng trang** `/admin/record-orders`: lần ghé
hằng ngày để import Shopee là bấm luôn được nút TikTok. Nhưng nó là lý do thật để bật đồng bộ tự động
sớm (mục 3.1) — nghỉ 3 ngày thì đơn nhỏ TikTok vào Khả dụng chậm 3 ngày. **Chậm chứ không mất.**

### 5.4 Tiền

Hoa hồng gốc ghi vào ledger, **cho cả `pending` lẫn `confirmed`**:

```
commissionAmount = round( Σ est_commission(dòng không huỷ) × TIKTOK_PIT_RETAINED_RATIO )
```

Một công thức duy nhất cho cả hai trạng thái — đó chính là điều làm **không cần sửa số sau khi chốt**
(quyết định 2.2b). `actual_commission` **không** tham gia vào việc tính tiền ở bất cứ đâu; nó chỉ được
đọc để **đối chiếu và cảnh báo** (mục 7).

- `orderAmount` → cộng `commission_gmv` của các dòng không huỷ.
- Tiền về dạng **string** trong JSON (giữ độ chính xác decimal) → parse qua một helper trả
  `number | null`; chuỗi rỗng và `null` đều ra `null`, **khác** số `0` (0 là giá trị thật).
- `est_commission` rỗng ở **mọi** dòng không huỷ → bỏ qua cả đơn + cảnh báo (không có gì để ghi).
  **Chốt này CHỈ áp cho đơn `pending`/`confirmed`.** Đơn `reversed` có **không** dòng nào không huỷ
  nên điều kiện trên đúng một cách rỗng tuếch — áp cả vào đó là **bỏ qua mọi đơn bị huỷ**, tức tiền
  không bao giờ được thu hồi. Nhánh `reversed` không cần `commissionAmount`: nó thu hồi theo
  `existing.userShareAmount` đã lưu, y như Shopee.

> ⛔ **Nếu sau này có ai định dùng `actual_commission` để tính tiền: lấy THẲNG field, tuyệt đối không
> cộng lại từ 6 thành phần.** `actual_standard_commission` và `actual_bonus_commission` là số **gộp
> trước khi trừ**, nên cộng chúng vào là cộng ngược lại phần đã bị giữ ⇒ **trả thừa ~10 lần** (cảnh
> báo nguyên văn của nhà cung cấp). Cùng loại luật với "Shopee lấy thẳng field `commission`, không
> nhân `rate × price`".

### 5.4b `TIKTOK_PIT_RETAINED_RATIO` — một hằng số, hai nơi dùng

`src/core/tiktokCommission.ts` (mới, nhỏ, thuần):

```ts
/**
 * Phan hoa hong con lai SAU khi TikTok khau tru thue TNCN tai nguon (field `pit`).
 *
 * 0,9 doc tu tai lieu RioHub ("10% phan HH chuan, ap cho ca creator thuong") - CHUA DO duoc tren
 * don that nao vi ca 4 don hien co deu chua quyet toan. Doi so nay khi thay `pit` that: muc 7 cua
 * spec co canh bao bat duoc dung luc do.
 *
 * Vi sao phai co: `est_commission` va `estimateFrom()` deu la so THO (GMV x rate), chua tru thue.
 * Dua so tho vao duong tien la hua cao hon thuc nhan tren MOI don - dung cai bay Shopee da day.
 */
export const TIKTOK_PIT_RETAINED_RATIO = 0.9;

/** Bien bo qua khi so actual voi so da tra user - xem muc 7.1b. */
export const TIKTOK_ACTUAL_SHORTFALL_SLACK = 0.02;

export function estimateTiktokNetCommission(grossVnd: number): number;
```

**Hai nơi bắt buộc dùng, lệch nhau là bot nói sai:**

1. `tiktokOrderImport.ts` — hoa hồng gốc ghi vào ledger (mục 5.4).
2. `tiktokAffiliateProvider.ts` → `estimateFrom()` — câu ước tính bot gửi **lúc trả link**.

Chỗ (2) là **sửa code đang chạy thật**: `estimateFrom()` hiện tính `price × ratePercent`, tức **cùng
cơ sở thô với `est_commission`**. Để nguyên thì bot hứa 1.522đ mà đơn về 1.370đ — lệch ~11% trên mọi
đơn, mãi mãi, và lệch về đúng phía nguy hiểm. Có **test chặn hai nơi cùng dùng một hằng số**.

### 5.5 Ngày

API trả **UTC** (`2026-10-08 06:52:18`) còn dashboard RioHub hiện giờ VN (`13:52:18 8/10/2026`). Mọi
mốc phải quy đổi, **không ghi thẳng**. Dùng bộ `*_iso` (có hậu tố `Z`) chứ không bộ epoch — thư viện
parse đúng UTC, không đọc nhầm thành giờ VN.

`formatVnDateIso()` đã có trong `vietnamDate.ts`. **`orderTime` thì chưa có hàm nào** — Shopee đọc
thẳng giờ từ chuỗi CSV (`parseShopeeReportTime`) nên chưa bao giờ cần đổi múi giờ cho giờ. Phải thêm
`formatVnTimeHms(date: Date): string` vào `vietnamDate.ts` (cùng chỗ, cùng lý do tách file đó: các mốc
dễ sai là nửa đêm giờ VN **không** phải nửa đêm UTC, đổi tháng, đổi năm — phải có test riêng cho cả 3).

| Trường ledger | Nguồn | Quy tắc |
|---|---|---|
| `orderDate` / `orderTime` | `time_created_iso` | dòng **sớm nhất** (cùng quy tắc Shopee) |
| `completedAt` | `time_delivered_iso` | **muộn nhất** trong các dòng không huỷ |

`completedAt` lấy muộn nhất vì **cửa sổ trả hàng của cả đơn chỉ đóng khi món giao cuối cùng hết hạn**
— cùng lý do Shopee lấy "Thời gian hoàn thành" muộn nhất. Thiếu thì để `null`: `resolveConfirmPlan()`
tự lùi về `fallbackDayVn` (hôm nay), nên **không vỡ gì**, chỉ giam hơi dài hơn.

> ❌ **Không dùng `settled_at`.** Tài liệu: bị **xoá về `null`** nếu đơn chuyển huỷ/hoàn, chốt lại thì
> nhận mốc mới ⇒ không phải mốc cố định. Cũng `null` khi quyết toán trước 04/09/2026 hoặc muộn hơn
> 60 ngày kể từ ngày tạo.

### 5.6 Quy về user

| Ca | Xử lý |
|---|---|
| `sub_id === ""` | `skippedNoSubId` |
| `logStore.findBySubId(sub_id)` không thấy | `skippedSubIdNotFound` |
| `requestEntry.merchant !== "tiktokshop"` | **bỏ qua + cảnh báo** — xem mục 6 |

> ⚠️ `sub_id` của đơn không có subId là **chuỗi rỗng, KHÔNG phải `null`** (đo thật 2026-10-09) →
> phân biệt bằng `sub_id !== ""`, dùng `=== null` là **sai**.

`sub_id` về nguyên văn chuỗi 4 đoạn, đã xác nhận trên **2 đơn thật** của bot
(`k-9053348487804998642-mv16nixs-f85f8a` và `...-mv19z39z-acc5c0`, cả hai `trace_type: SPECIFIC`) —
**không** cần ghép lại từ `sub1..sub4`.

### 5.7 Tên sản phẩm

Dòng hoa hồng cao nhất + hậu tố `(+N sản phẩm khác)` — cùng quy tắc `mergeOrderRows` của Shopee.

### 5.8 Chưa quan sát được lần nào

Ghi rõ để sau không ai đọc nhánh code như bằng chứng đã kiểm chứng. Cả 4 đơn thật hiện có đều là
**một SKU, `status=1`, chưa quyết toán** — nên chưa thấy ca nào trong số này:

| Chưa quan sát | Thiết kế dựa vào đâu |
|---|---|
| `status=2` (đã quyết toán) | enum chuẩn hoá trong tài liệu RioHub |
| `status=3` (huỷ/hoàn) | tài liệu + loại suy từ bảng 5 ca của Shopee |
| `actual_commission` có giá trị | tài liệu (và là lý do tồn tại của gác 7.1b) |
| `status` lạ | tài liệu tự nói *"TikTok có thể bổ sung trạng thái khác"* |
| **Đơn nhiều SKU** | tài liệu (*"một đơn nhiều SKU = nhiều dòng"*), **chưa thấy đơn nào >1 dòng** |
| **Hoàn một phần trong CÙNG một SKU** | **không có thiết kế** — xem dưới |

**Khoảng hở còn mở, ghi ra thay vì che:** `refunded_quantity`/`returned_quantity`/`fully_refunded` tồn
tại trong schema nhưng thiết kế này **không đọc** chúng. Hoàn một phần được xử lý **theo dòng** (dòng
`status=3` bị loại khỏi tổng), nên ca "mua 3 cái, trả 1 cái, vẫn cùng một SKU" sẽ phụ thuộc vào việc
`est_commission` của dòng đó có tự giảm theo hay không — **chưa đo được**.

Không bịa cách xử lý cho ca chưa thấy. Thay vào đó đặt một **đèn báo rẻ**: khi gặp dòng có
`refunded_quantity > 0` hoặc `fully_refunded` bật mà `status !== 3` → đẩy một dòng vào `result.errors`.
Lần đầu ca đó xảy ra là biết ngay, kèm số thật để quyết định, chứ không phải phát hiện qua lệch tiền.

## 6. Bốn chốt cách ly Shopee ↔ TikTok

Ràng buộc 2.4. Đây là phần trả lời trực tiếp yêu cầu của chủ bot.

**(1) Đồng bộ TikTok không bao giờ ghi được một đơn Shopee.** `subId` **không** mã hoá sàn — đoạn đầu
là mã nền tảng **chat** (`k`/`m`/`w`, xem `subId.ts`), không phải merchant. Nên về lý thuyết
`findBySubId` có thể trả về một request Shopee. Chốt merchant ở 5.6 biến điều đó thành không thể.
**Có test chặn đúng ca này**: nhồi một đơn TikTok mang `sub_id` của request Shopee → phải bị bỏ qua
kèm cảnh báo, ledger **không thêm dòng nào**.

Chốt này **chỉ đặt ở phía TikTok**, không thêm vào `shopeeReportImport` — thêm vào đó là đổi hành vi
Shopee, vi phạm luật 4.3.

**(2) RioHub sập không chạm được tới đường Shopee.** Hai route riêng, hai nút riêng, hai khối kết quả
riêng. Lỗi mạng hiện trên thẻ TikTok và dừng tại đó. Đường Shopee không gọi RioHub một dòng nào.

**(3) `TIKTOK_ENABLED=false` làm đường TikTok trơ hoàn toàn.** Thẻ ẩn, route từ chối, không có code
TikTok nào chạy lúc khởi động — đúng cơ chế provider đang tự tắt khi thiếu env. Đơn TikTok **đã ghi**
vẫn hiện bình thường vì `tiktokshop` về `RETIRED_MERCHANTS` và `getMerchantConfig()` vẫn trả được:
**chính xác tiền lệ Lazada đang chạy**.

**(4) Bỏ hẳn phần đối soát của đợt này = xoá 4 file + 1 route + 1 thẻ.** `tiktokOrderImport.ts`,
`riohubOrdersSource.ts`, `tiktokCommission.ts`, `riohubOrders.ts` (CLI).

Phạm vi câu này là **riêng đợt đối soát**. Đường **tạo link** (`tiktokAffiliateProvider.ts`,
`riohubClient.ts`, `compositeProvider.ts`) đã có từ 10/10 và được tắt bằng chốt (3), không phải xoá —
`TIKTOK_ENABLED=false` là cách tắt cả hai đường mà không xoá dòng nào.

Hai thứ **ở lại** vì không phải đồ của TikTok: `orderStatusApply.ts` (xem đoạn dưới) và
`formatVnTimeHms()` trong `vietnamDate.ts` (hàm ngày tháng dùng chung).

`orderStatusApply.ts` **ở lại** — nó là module ledger **không biết sàn nào**, thuộc về đường Shopee
sau khi tách, không phải đồ của TikTok. Doc comment đầu file phải nói đúng điều đó, và nó có bộ test
riêng đứng độc lập.

> **Chỗ duy nhất ràng buộc 2.4 có căng, ghi lại không giảm nhẹ**: sau refactor, Shopee **đi qua** một
> module được tách ra trong đợt làm TikTok. Extraction có bug thì Shopee hỏng. Chặn bằng đúng luật
> 4.3 và baseline 947 test đã chốt **trước khi** chạm file nào.

## 7. Cảnh báo `pit` và `shared_with_partner`

Hai field này không cùng loại nên **không gộp một cơ chế** (quyết định 2.5).

### 7.1 `shared_with_partner ≠ 0` → cảnh báo admin thật

Gộp qua `AlertThrottle` (`src/core/alertThrottle.ts`) khoá `tiktok_mcn_cut` — tối đa 1 tin/15 phút dù
bao nhiêu đơn — kèm một dòng trong `result.errors` để hiện trên trang.

Đây là ca **làm sụp bài toán kinh tế**: thoả thuận RioMedia 0% (hạn 08/04/2027) không còn đúng, và
**`est_commission` KHÔNG trừ phần MCN** nên số bot đã báo cho user đang **cao hơn thực nhận** — đúng
loại sai nguy hiểm mà Shopee đã dạy. Ví dụ trong chính tài liệu của họ cho thấy MCN giữ tới **90%**.

Câu cảnh báo phải nói đủ ba thứ: mã đơn, số MCN giữ, và **hệ quả** ("ước tính báo cho user đang cao
hơn thực nhận").

### 7.1b Gác `actual` thấp hơn số đã trả — quyết định của chủ bot 2026-10-11

`shared_with_partner ≠ 0` là tín hiệu **trực tiếp**, nhưng không phải đường duy nhất để lỗ: `pit` thật
có thể khác 10%, hoặc `actual_creator_commission_reward_fee` lớn hơn dự kiến. Nên gác thêm bằng chính
con số cuối cùng.

Mỗi lần đồng bộ, với mọi đơn đã quyết toán (`actual_commission` có giá trị), so:

```
assumed = round( est_commission × TIKTOK_PIT_RETAINED_RATIO )    ◀ so DA dung de tra user
bien    = round( est_commission × TIKTOK_ACTUAL_SHORTFALL_SLACK ) ◀ SLACK = 0.02
canh bao khi:  actual_commission < assumed − bien
```

So **thẳng với `assumed`**, không dựng một biểu thức thứ hai — hai cách tính cùng một ngưỡng là chỗ
để chúng lệch nhau lúc refactor.

Biên `0.02` hấp thụ làm tròn và khoản `actual_creator_commission_reward_fee` nhỏ — thứ thật sự cần bắt
(MCN giữ phần) lệch tới hàng **chục** phần trăm chứ không phải 2%. Đặt tên hằng số
(`TIKTOK_ACTUAL_SHORTFALL_SLACK`) cạnh `TIKTOK_PIT_RETAINED_RATIO` trong `tiktokCommission.ts`, không
rắc số `0.02` vào giữa logic.

Cảnh báo admin qua `AlertThrottle` khoá `tiktok_actual_below_assumed`, kèm mã đơn, `est`, `assumed`,
`actual`, và **hệ quả bằng số**: đã trả user bao nhiêu trên một đơn thực nhận bấy nhiêu.

> **Hạn chế đã biết và đã chấp nhận**: quyết toán đến sau giao hàng ~15 ngày, mà giam chỉ 1–7 ngày —
> nên lúc cảnh báo nổ thì tiền của mấy đơn đầu **đã trả user rồi, không lấy lại được**. Giá trị của
> gác này là **chặn lỗ âm thầm kéo dài**: chủ bot biết để tắt TikTok sau vài đơn chứ không phải sau
> vài tháng. Chủ bot đã chọn "chỉ cảnh báo", **không** tự động khoá đồng bộ — báo động sai mà tự khoá
> thì tự làm hỏng dịch vụ đang chạy tốt. Với dung lượng hiện tại (hoa hồng 480–3.190đ/đơn) thiệt hại
> tối đa của vài đơn là không đáng kể.

Đây cũng là **cơ chế duy nhất** cho biết phải đổi `TIKTOK_PIT_RETAINED_RATIO` khi `pit` thật khác 10%.

### 7.2 `pit` → không cảnh báo lặp, hiện số trên trang kết quả

`pit` được kỳ vọng khác 0 **vĩnh viễn** — tài liệu: *"10% phần HH chuẩn, áp cho cả creator thường"*.
Báo động một chuyện đúng-như-dự-kiến mỗi ngày thì sau một tuần chủ bot sẽ bỏ qua nó, và lúc đó cảnh
báo thật ở 7.1 cũng bị bỏ qua cùng.

Thay vào đó trang kết quả **luôn** có khối "Số liệu đã quyết toán": số đơn `status=2` · tổng `est` ·
tổng `actual` · tổng `pit` · tổng `shared_with_partner`. Chưa có gì thì hiện `—`.

Đơn quyết toán đầu tiên là mấy con số đó hiện ra ngay trước mắt. Vì chủ bot **tự bấm nút**, trang này
**chính là** kênh cảnh báo — không cần cờ "đã báo chưa" (một loại state rất dễ sinh bug), và nó còn
hữu ích lâu dài chứ không chỉ một lần.

## 8. Route và giao diện

- **Thẻ thứ ba** ở `/admin/record-orders`: "Đồng bộ đơn TikTok Shop" — chỉ một cái nút, **không** có ô
  upload. Khối kết quả dùng lại `statRow()` y như Shopee. `TIKTOK_ENABLED=false` thì **ẩn thẻ**.
- `POST /admin/record-orders/tiktok-sync`.
- `recordImportHistory()` thêm `actionType: "tiktok"` → hiện trong "Lịch sử ghi nhận đơn hàng" cùng
  bảng với Shopee. `ImportActionType` (`src/core/types.ts:262`) hiện là `"csv" | "single"`.
  **Không cần migration** — `import_history.action_type` lưu text, row cũ không đổi. Và vì
  `ACTION_TYPE_LABELS` (`adminHtml.ts:2318`) là một `Record<ImportHistoryEntry["actionType"], string>`,
  thêm giá trị vào union sẽ làm **typecheck đỏ** cho tới khi khai nhãn — trình biên dịch tự chặn việc
  quên, không cần nhớ.
- Chip "Loại" dùng **màu trung tính có viền**, phân biệt bằng chữ. Luật
  `.claude/rules/admin-ui-nen-tang.md`: 3 màu có nghĩa trong khu `/admin` đã kín (cam = chờ xác
  nhận/lợi nhuận chủ bot, xanh lá = khả dụng, xanh dương = Zalo) — mở màu thứ tư là làm loãng nghĩa
  của chúng.
- Tin **"đơn về"** cho user: dùng nguyên `buildOrdersConfirmedNotification()`, đơn TikTok vào **ảnh
  chung** với đơn Shopee. Đúng mục 1.4 của `docs/riohub-tiktok.md`: với user việc thêm TikTok là vô hình.
- **KHÔNG** gửi tin vào group Zalo sau khi đồng bộ TikTok. Tin hằng ngày đó thuộc nhịp import Shopee
  9h30; thêm tin thứ hai là nhiễu, và TikTok còn chưa thông báo cho user. **Cố ý, không phải sót.**

## 9. Kết quả import

`TiktokOrderImportResult` — song song `ShopeeReportImportResult`, dùng lại tên field ở chỗ nghĩa giống
nhau để đọc hai khối kết quả cạnh nhau không phải dịch:

```ts
export interface TiktokOrderImportResult {
  ordersScanned: number;
  confirmedNew: number;
  confirmedDuplicate: number;
  pendingNew: number;
  pendingUpdated: number;
  reversedCount: number;
  mergedMultiSku: number;          // ◀ tên khác Shopee (mergedMultiItem): TikTok tách theo SKU
  skippedNoSubId: number;
  skippedSubIdNotFound: number;
  skippedForeignMerchant: number;  // ◀ chốt cách ly (1), Shopee không có
  skippedUnknownStatus: number;
  smallHoldDeferred: number;
  heldCount: number;
  debtCreatedCount: number;
  debtsByUser: Array<{ platform: Platform; userId: string; orderId: string; amount: number }>;
  cancelledWithdrawals: Array<{
    platform: Platform;
    userId: string;
    withdrawalId: number;
    amount: number;
    orderId: string;
  }>;
  confirmedByUser: UserOrderSummary[];
  newOrderIds: string[];
  statusTransitions: StatusTransition[];
  /**
   * Muc 7.2 — CHI de doi chieu/canh bao, KHONG tham gia tinh tien.
   * null o field nao nghia la chua quan sat duoc gia tri nao.
   */
  settledTotals: {
    orderCount: number;
    estTotal: number;
    actualTotal: number | null;
    pitTotal: number | null;
    sharedWithPartnerTotal: number | null;
    /** Muc 7.1b — so don co actual thap hon so da dung de tra user. > 0 la phai xem ngay. */
    shortfallCount: number;
  };
  errors: string[];
}
```

## 10. Test

Baseline **947 pass / 0 fail** (mục 4.3).

| File | Nội dung |
|---|---|
| `orderStatusApply.test.ts` | Test **trực tiếp** lớp vừa tách: đủ 5 ca huỷ, hoãn đơn nhỏ, duplicate, cảnh báo đơn bị khoá hoa hồng tay, `reversed-unseen` |
| `tiktokOrderImport.test.ts` | Bảng quyết định 5.3, tiền 5.4, ngày 5.5, quy về user 5.6, gộp SKU 5.1 |
| `tiktokOrderIsolation.test.ts` | Chốt cách ly (1): đơn TikTok mang `sub_id` của request Shopee → bỏ qua, ledger **không thêm dòng** |
| `tiktokCommission.test.ts` | Mục 5.4b: `estimateTiktokNetCommission()` làm tròn, và **`estimateFrom()` dùng cùng hằng số** |
| `vietnamDate.test.ts` (có sẵn) | Thêm ca cho `formatVnTimeHms()`: nửa đêm giờ VN ≠ nửa đêm UTC, đổi tháng, đổi năm |
| Shopee (4 file hiện có) | Xanh **không sửa một dòng** |

**Fixture**: nền là **4 đơn thật** đã lấy qua `npm run riohub:orders` (JSON thật, gồm 2 đơn từ link bot
và 1 đơn đã giao có `time_delivered_iso`). Các trạng thái ở 5.8 phải dựng tay — **mỗi fixture dựng tay
có comment ghi rõ `"dựng từ tài liệu, chưa quan sát"`**, để sau không ai đọc nó như bằng chứng.

Bốn chỗ phải có test chặn vì sai là sai tiền:
- Đơn **đã giao mà chưa quyết toán** → vẫn `confirmed` (không chờ `actual_commission`). Đây là test
  chặn quan trọng nhất của mục 5.3: viết sai là user phải đợi 15 ngày.
- **Hai nơi dùng `TIKTOK_PIT_RETAINED_RATIO` phải ra cùng một số** cho cùng một hoa hồng gốc —
  `estimateFrom()` (câu bot gửi) và `importTiktokOrders()` (số ghi ledger). Lệch là bot nói sai.
- Tiền parse từ **string**: `""` và `null` → `null`; `"0"` và `"0.00"` → số `0` (giá trị thật).
- **Đơn toàn dòng `status=3` phải ra `reversed`**, không bị chốt "est rỗng" ở 5.4 chặn lại và không
  rơi xuống `confirmed`. Đây là ca thứ tự bảng 5.3 — sai là đơn huỷ không bao giờ được thu hồi tiền.

## 11. Tài liệu phải cập nhật trong cùng đợt

Theo quy ước `CLAUDE.md`: `.claude/rules/` là nguồn duy nhất cho chi tiết implementation.

- **Mới**: `.claude/rules/doi-soat-don-tiktok.md` + thêm dòng vào bảng tra của `CLAUDE.md`.
- `.claude/rules/import-bao-cao-shopee.md`: ghi rõ phần áp ledger đã chuyển sang `orderStatusApply.ts`.
- `docs/riohub-tiktok.md`: nhật ký verify (`time_delivered_iso` đã có giá trị thật 10/10), mục 2.9,
  danh sách "Việc còn treo". **Mục 1.3b phải ghi thêm**: đầu vào đường tiền là `est_commission × 0,9`
  chứ không phải `actual_commission` như bảng số của 1.3b giả định — kết quả cho user giống nhau, nhưng
  nguồn số khác, và lý do khác (chốt lúc giao hàng nên chưa có `actual`).
- `rui-ro-tich-hop-tiktok.md` theo **luật giữ file** (giải xong thì **xoá hẳn**, số thứ tự **không**
  đánh lại):
  - **xoá rủi ro 2** — `time_delivered_iso` đã có giá trị thật, cơ chế giam đơn có mốc để đếm;
  - **xoá rủi ro 8** — đã quyết polling, không làm webhook (mục 3.1);
  - **cập nhật rủi ro 1 và 3** — bảng quyết định đã dựng, nhưng 4 trạng thái ở 5.8 vẫn chưa quan sát;
    rủi ro 3 giờ có cơ chế cảnh báo (mục 7.1) chứ chưa có dữ liệu.

## 12. Việc còn treo sau đợt này

- [ ] Đơn thật đi hết vòng đời → chốt `pit`, `shared_with_partner`, `status=2`/`3` (mục 5.8)
- [ ] **Đối chiếu `TIKTOK_PIT_RETAINED_RATIO = 0,9` với `pit` thật** ngay khi đơn đầu tiên quyết toán,
      đổi hằng số nếu lệch (mục 5.4b). Cảnh báo ở 7.1b là thứ bắt được đúng lúc đó
- [ ] Nếu đổi `/so-tay` để nói đúng bản chất khoản 10% với đơn TikTok — **sửa câu chữ, không sửa phép
      tính** (mục 2.2b)
- [ ] Bật đồng bộ **tự động** sau khi bảng quyết định đã chạy đúng qua vài đơn thật (mục 3.1)
- [ ] Lọc `update_time_start` khi số đơn lớn lên — **kèm phép thử phân biệt** (mục 3.2)
- [ ] Xem lại thoả thuận MCN 0% trước **08/04/2027** (rủi ro 11)
