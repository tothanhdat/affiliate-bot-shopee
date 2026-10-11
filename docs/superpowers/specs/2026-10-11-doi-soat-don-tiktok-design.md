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
| 2.2 | **Đơn chờ ghi `est_commission`**, đơn quyết toán ghi `actual_commission` | Mỗi giai đoạn báo số thật nhất mà nguồn đang có, không bịa công thức. Chưa ai thấy giá trị `pit` thật nào nên trừ trước là trừ theo giả thiết |
| 2.3 | **Tách lớp áp ledger dùng chung** với Shopee | Bản sao thứ hai của đường tiền là loại nợ kỹ thuật đắt nhất ở đây; chính đoạn đó lòi ra lỗ hổng nghiêm trọng 08/10/2026 |
| 2.4 | **Cách ly Shopee ↔ TikTok là ràng buộc hạng nhất** | Yêu cầu trực tiếp của chủ bot: đồng bộ TikTok hỏng, hoặc bỏ hẳn TikTok sau này, đều **không được** ảnh hưởng Shopee |
| 2.5 | `pit` **không** cảnh báo lặp, `shared_with_partner ≠ 0` **có** | `pit` khác 0 là chuyện đúng-như-dự-kiến vĩnh viễn; báo động nó mỗi ngày sẽ làm nhờn luôn cảnh báo thật |

**Hệ quả đã được chấp nhận của 2.2 — ghi lại bằng số để sau không ai tưởng là bug.** `est_commission`
là số **thô** (GMV × rate), `actual_commission` đã bị TikTok trừ thuế `pit`. Nên số user nhìn thấy sẽ
**tụt ~10% đúng lúc đơn chuyển sang Khả dụng**:

| | Lúc "Chờ xác nhận" | Lúc vào "Khả dụng" |
|---|---|---|
| Nguồn | `est_commission` = 2.136đ | `actual_commission` ≈ 1.922đ |
| User nhận (80% sau thuế/phí) | **1.522đ** | **1.370đ** |

Đổi lại: số lúc chờ **khớp với câu bot đã gửi** lúc trả link, nên user không thấy mâu thuẫn cho tới
lúc chốt — đúng lúc hệ thống vốn đã hẹn *"số chốt theo giá thực trả"*.

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
  ├─▶ tự hiện ở /admin/orders, /admin/dashboard, /admin/links, dashboard user
  ├─▶ tin "đơn về" cho user (ảnh) qua buildOrdersConfirmedNotification()
  └─▶ cảnh báo admin nếu shared_with_partner ≠ 0
```

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

Tài liệu khuyến nghị sync tăng dần bằng `update_time_start/end`, nhưng mục 2.5 ghi cạm bẫy: **sai tên
HOẶC sai định dạng tham số đều bị nuốt im lặng** rồi trả về toàn bộ lịch sử — không `422`, không một
dấu hiệu nào. Nghĩa là code **buộc phải** chịu được ca quét toàn bộ dù có lọc hay không.

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

Đúng chỗ hai sàn khác nhau thật: Shopee đọc nhãn tiếng Việt theo dòng, TikTok có
`refunded_quantity`/`fully_refunded` nên hoàn một phần là khái niệm hạng nhất.

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

### 5.3 Trạng thái cả đơn

Theo đúng nguyên tắc *"chưa chắc chắn hết thì vẫn pending"* của `mergeOrderRows` bên Shopee:

| Tình huống các dòng | Cả đơn | Ghi chú |
|---|---|---|
| có **bất kỳ** dòng `status` lạ | **bỏ qua cả đơn** + cảnh báo | không đoán mò trên tiền — đúng `skippedUnknownStatus` của Shopee |
| **tất cả** dòng = `3` | `reversed` | |
| có **bất kỳ** dòng = `1` | `pending` | |
| còn lại (toàn `2`, hoặc `2` lẫn `3`) | `confirmed` | dòng `3` bị **loại khỏi tổng tiền** (hoàn một phần) |

### 5.4 Tiền

- `confirmed` → cộng **`actual_commission`** của các dòng không huỷ.

  > ⛔ **Lấy THẲNG field. Tuyệt đối không cộng lại từ 6 thành phần.** `actual_standard_commission` và
  > `actual_bonus_commission` là số **gộp trước khi trừ**, nên cộng chúng vào là cộng ngược lại phần
  > đã bị giữ ⇒ **trả thừa ~10 lần** (cảnh báo nguyên văn của nhà cung cấp). Cùng loại luật với
  > "Shopee lấy thẳng field `commission`, không nhân `rate × price`".

- **Chốt an toàn**: nếu một dòng đáng tính mà `actual_commission` rỗng/`null` → **hạ cả đơn về
  `pending`** (dùng `est_commission`) + cảnh báo. Confirm bằng con số mình không có là tệ hơn chờ
  thêm một ngày.
- `pending` → cộng `est_commission` của các dòng không huỷ (quyết định 2.2).
- `orderAmount` → cộng `commission_gmv`.
- Tiền về dạng **string** trong JSON (giữ độ chính xác decimal) → parse qua một helper trả
  `number | null`; chuỗi rỗng và `null` đều ra `null`, **khác** số `0` (0 là giá trị thật).

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

Ghi rõ để sau không ai đọc nhánh code như bằng chứng đã kiểm chứng: **`status=2`, `status=3`, hoàn một
phần, `status` lạ, và `actual_commission` có giá trị** — chưa thấy ca nào. Nhánh `reversed` của TikTok
dựng từ tài liệu + loại suy từ Shopee. **Lần hoàn/huỷ thật đầu tiên vẫn phải soi tay.**

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

**(4) Bỏ hẳn TikTok sau này = xoá 3 file + 1 route + 1 thẻ.** `tiktokOrderImport.ts`,
`riohubOrdersSource.ts`, `riohubOrders.ts`.

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
  chung** với đơn Shopee. Đúng mục 1.4: với user việc thêm TikTok là vô hình.
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
  /** Mục 7.2 — null ở field nào nghĩa là chưa quan sát được giá trị nào. */
  settledTotals: {
    orderCount: number;
    estTotal: number;
    actualTotal: number;
    pitTotal: number | null;
    sharedWithPartnerTotal: number | null;
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
| Shopee (4 file hiện có) | Xanh **không sửa một dòng** |

**Fixture**: nền là **4 đơn thật** đã lấy qua `npm run riohub:orders` (JSON thật, gồm 2 đơn từ link bot
và 1 đơn đã giao có `time_delivered_iso`). Các trạng thái ở 5.8 phải dựng tay — **mỗi fixture dựng tay
có comment ghi rõ `"dựng từ tài liệu, chưa quan sát"`**, để sau không ai đọc nó như bằng chứng.

Hai chỗ phải có test chặn vì sai là sai tiền:
- `actual_commission` rỗng ở đơn `status=2` → **hạ về `pending`**, không confirm bằng `est`.
- Tiền parse từ **string**: `""` và `null` → `null`; `"0"` và `"0.00"` → số `0` (giá trị thật).

## 11. Tài liệu phải cập nhật trong cùng đợt

Theo quy ước `CLAUDE.md`: `.claude/rules/` là nguồn duy nhất cho chi tiết implementation.

- **Mới**: `.claude/rules/doi-soat-don-tiktok.md` + thêm dòng vào bảng tra của `CLAUDE.md`.
- `.claude/rules/import-bao-cao-shopee.md`: ghi rõ phần áp ledger đã chuyển sang `orderStatusApply.ts`.
- `docs/riohub-tiktok.md`: nhật ký verify (`time_delivered_iso` đã có giá trị thật 10/10), mục 2.9,
  danh sách "Việc còn treo".
- `rui-ro-tich-hop-tiktok.md` theo **luật giữ file** (giải xong thì **xoá hẳn**, số thứ tự **không**
  đánh lại):
  - **xoá rủi ro 2** — `time_delivered_iso` đã có giá trị thật, cơ chế giam đơn có mốc để đếm;
  - **xoá rủi ro 8** — đã quyết polling, không làm webhook (mục 3.1);
  - **cập nhật rủi ro 1 và 3** — bảng quyết định đã dựng, nhưng 4 trạng thái ở 5.8 vẫn chưa quan sát;
    rủi ro 3 giờ có cơ chế cảnh báo (mục 7.1) chứ chưa có dữ liệu.

## 12. Việc còn treo sau đợt này

- [ ] Đơn thật đi hết vòng đời → chốt `pit`, `shared_with_partner`, `status=2`/`3` (mục 5.8)
- [ ] Bật đồng bộ **tự động** sau khi bảng quyết định đã chạy đúng qua vài đơn thật (mục 3.1)
- [ ] Lọc `update_time_start` khi số đơn lớn lên — **kèm phép thử phân biệt** (mục 3.2)
- [ ] Xem lại thoả thuận MCN 0% trước **08/04/2027** (rủi ro 11)
