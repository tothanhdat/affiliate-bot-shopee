# Giam có điều kiện + Nợ hoàn trả — thiết kế

Ngày: 2026-10-08

## 1. Vấn đề

Shopee bật trạng thái "Hoàn thành" cho đơn affiliate **ngay lúc giao hàng**, không phải sau khi
hết thời gian được trả hàng. Import báo cáo sẽ chuyển entry sang `confirmed` (Khả dụng) và user rút
được tiền ngay nếu đủ ngưỡng 20.000đ. Nếu sau đó user trả hàng, Shopee đổi trạng thái sản phẩm liên
kết thành "Đã hủy" và thu lại hoa hồng — trong khi tiền có thể đã ra khỏi tay chủ bot.

### 1.1. Số liệu đã xác minh

**Thời gian được trả hàng** — [Chính sách Trả hàng và Hoàn tiền, điều 3.2](https://help.shopee.vn/portal/4/article/77251)
(đăng 04/03/2026, hiệu lực 11/03/2026):

> Người Mua có thể gửi yêu cầu trả hàng/hoàn tiền trong vòng **15 (mười lăm) ngày** kể từ lúc đơn
> hàng được cập nhật **giao hàng thành công**. Riêng đối với các Sản Phẩm là thực phẩm tươi sống và
> đông lạnh, Người Mua cần gửi yêu cầu trả hàng/hoàn tiền trong vòng **24 giờ**.

Hai điều làm 15 ngày **không** phải trần tuyệt đối, đừng thiết kế như thể nó là:

- Cùng điều 3.2: *"Một số trường hợp Người Mua có nhu cầu trả hàng/hoàn tiền sau thời hạn trên,
  Shopee sẽ xem xét và có thể hỗ trợ"*.
- Shopee Mall theo ToS riêng ([điều 2.3](https://help.shopee.vn/portal/article/77262)), và trạng
  thái trong báo cáo affiliate có thể mất tới ~30 ngày mới refresh.

**Mốc "Hoàn thành" nằm ở đâu trong 15 ngày đó** — đo trên `AffiliateCommissionReport_202610010938.csv`
(46 dòng, báo cáo thật), khoảng cách `Thời Gian Đặt Hàng` → `Thời gian hoàn thành`:

| min | median | max |
| --- | --- | --- |
| 0,90 ngày | 2,51 ngày | 7,99 ngày |

→ Từ lúc hệ thống chuyển "Khả dụng", cửa sổ rủi ro còn lại gần như trọn 15 ngày.

**Tiền tập trung vào vài đơn** — phân bố `Tổng hoa hồng sản phẩm(₫)` cùng file:

| Hoa hồng SP | Số dòng | Tiền | % tổng |
| --- | --- | --- | --- |
| 50–100k | 2 | 123.898đ | **35,8%** |
| 20–50k | 2 | 47.473đ | 13,7% |
| <20k | 42 | 174.693đ | 50,5% |

Đơn to nhất: hoa hồng 66.298đ trên đơn 1.473.300đ → user nhận ~47k. Phần chủ bot của **cả tháng**
đó ≈ 20% × 288k ≈ 46k. Một đơn to bị trả hàng xoá sạch lợi nhuận một tháng. Đây là lý do định lượng
cho việc phân tầng theo số tiền thay vì giam tất.

Cùng file có 3 dòng `Số tiền hoàn trả (₫) ≠ 0`, lớn nhất 1.471.000đ (đơn `2609250DXCD0PW`) — khách
của bot có trả hàng tiền to thật, chỉ chưa trùng đơn đã `confirmed`.

### 1.2. Hai phát hiện kỹ thuật làm đổi phạm vi

**(a) Báo cáo XOÁ `Thời gian hoàn thành` khi đơn bị huỷ.** Cả 12 dòng "Đã hủy" trong file đều để
trống cột đó. Nên **từ CSV không phân biệt được** "huỷ từ đầu" với "hoàn thành rồi mới trả hàng".
`order_status_events` là bản ghi duy nhất biết một đơn từng `confirmed`.

**(b) Lỗ hổng lớn hơn cả chuyện user đã rút.** `src/core/shopeeReportImport.ts` (nhánh
`targetStatus === "reversed"`): khi báo cáo ghi "Đã hủy" mà entry nội bộ **không phải** `pending`,
code không reverse gì cả, chỉ đẩy một dòng cảnh báo vào `result.errors`. Hiện tại kể cả đơn mới
`confirmed` mà **user chưa rút** thì tiền vẫn nằm nguyên trong Khả dụng và rút được bình thường —
mất tiền *lấy lại được* mà vẫn mất. Đây là phần rẻ nhất của cả feature.

### 1.3. Nguyên tắc đã chốt với user

Mục tiêu là **giảm thiểu**, không triệt tiêu. Không giam tiền của mọi user theo đúng 15 ngày của
Shopee — user sẽ thấy đợi quá lâu trong khi số người trả hàng rất ít (lịch sử import đến nay chưa
ghi nhận case nào từ Khả dụng/Đã rút chuyển sang Đã huỷ). Chấp nhận mất một chút tiền, bù lại ràng
buộc chặt dần theo số tiền của đơn.

## 2. Hai khái niệm mới, tách biệt hẳn nhau

| | **Giam có điều kiện** (phòng) | **Nợ hoàn trả** (chữa) |
| --- | --- | --- |
| Khi nào | Lúc đơn chuyển `confirmed`, nếu `user_share_amount ≥ ngưỡng` | Lúc báo cáo ghi "Đã hủy" mà tiền đã ra khỏi tay |
| Tác dụng | Tiền vẫn của user, chỉ chưa rút được đến ngày mở khoá | Trừ dần vào Khả dụng tương lai |
| Mất tiền | Không | Có — đây là phần "chấp nhận mất một chút" |

Hai cơ chế này **không** phụ thuộc nhau: tắt cái này cái kia vẫn chạy đúng.

## 3. Giam có điều kiện

### 3.1. Quy tắc

Default (sửa được ở `/admin/settings`): `user_share_amount ≥ 100.000đ` → mở khoá sau **7 ngày** kể
từ `completed_at`.

Lý do chọn mốc `completed_at` thay vì ngày import: đó là **đúng** mốc Shopee đếm 15 ngày, nên câu
giải thích cho user kiểm chứng được, và hold không bị dài thêm chỉ vì import trễ.

Độ phủ đã biết và đã chấp nhận: vì import chạy hàng ngày, hold 7 ngày bắt được đơn trả hàng trong
~6 ngày đầu sau giao hàng, tức ~6/15 cửa sổ. Phần còn lại rơi vào cơ chế nợ. **Không có dữ liệu**
về việc khách thường trả hàng vào ngày thứ mấy (chưa có case nào để đo) — con số 7 là đánh đổi cảm
tính giữa độ kiên nhẫn của user và độ phủ, không phải phép tính. Vì vậy nó là setting, không phải
hằng số.

### 3.2. Dữ liệu

Hai cột mới trên `commission_entries`, nullable, **không backfill**, mỗi cột một migration riêng
theo pattern `migrateAddOrderDateColumn`:

- `completed_at TEXT` — `"YYYY-MM-DD"` giờ VN, đọc từ cột `Thời gian hoàn thành` của báo cáo.
  Kiểm chứng trên file thật: chỉ 26 dòng "Hoàn thành" có giá trị này; 8 dòng "Đang chờ xử lý" và 12
  dòng "Đã hủy" đều trống. Nghĩa là nó xuất hiện **đúng vào lúc** đơn chuyển `confirmed` — khớp
  chính xác chỗ cần ghi.
- `available_from TEXT` — ngày mở khoá, `"YYYY-MM-DD"` giờ VN. `NULL` = khả dụng ngay.

Entry ghi trước feature → cả 2 cột `NULL` → khả dụng ngay. **Không giam hồi tố** (tiền đã hứa rồi),
và `completed_at` của đơn cũ không khôi phục được vì báo cáo đã import không lưu lại — cùng lý do
đã chấp nhận với `order_date` và 3 cột `*_percent`.

### 3.3. `available_from` được CHỐT, không tính lại

Tính 1 lần tại thời điểm entry chuyển `confirmed`, ghi vào cột, **không bao giờ tính lại**.

Đây là cùng một lý do bắt buộc 3 cột `tax_percent`/`platform_fee_percent`/`user_share_percent` phải
chốt theo từng đơn (quyết định 2026-10-01): admin nâng hold từ 7 lên 15 ngày hôm nay **không được**
kéo dài thời gian giam của đơn user đã mua từ tuần trước. Hệ quả đối xứng cũng được chấp nhận: hạ
hold xuống 3 ngày không rút ngắn thời gian giam của đơn đã chốt.

Phụ phẩm: SQL đọc tiền chỉ còn một phép so sánh chuỗi, không phép tính nào trên đường đọc tiền.

### 3.4. File mới `src/core/payoutHold.ts` — hàm thuần, không DB

```ts
export interface PayoutHoldConfig {
  thresholdVnd: number;
  holdDays: number;
}

/**
 * Tra ngay mo khoa ("YYYY-MM-DD" gio VN) cho 1 entry vua chuyen sang confirmed,
 * hoac null neu kha dung ngay.
 */
export function resolveAvailableFrom(params: {
  userShareAmount: number;
  /** Tu cot "Thoi gian hoan thanh" cua bao cao. null khi bao cao thieu hoac ghi don le tay. */
  completedAtVn: string | null;
  /** Lui ve moc nay khi khong biet ngay giao hang - caller truyen todayVnIso(). */
  fallbackDayVn: string;
  config: PayoutHoldConfig;
}): string | null;
```

Quy tắc:

- `config.thresholdVnd <= 0` → `null` (tắt hẳn tính năng giam, giữ nguyên hành vi hiện tại — cùng
  pattern `PROMOTIONS_DISPLAY_LIMIT=0`).
- `userShareAmount < config.thresholdVnd` → `null`. So sánh là `>=` khi vào ngưỡng, tức đúng
  100.000đ **bị** giam.
- ngược lại → `addDaysToVnIso(completedAtVn ?? fallbackDayVn, config.holdDays)`.

Thêm vào `src/core/vietnamDate.ts`:

```ts
/** Cong `days` ngay vao 1 ngay lich "YYYY-MM-DD". Thuan chuoi->chuoi, khong dinh mui gio may chay. */
export function addDaysToVnIso(iso: string, days: number): string;
```

Dùng `Date.UTC` để không dính timezone của máy chạy (Railway chạy UTC). Input đã là ngày lịch VN nên
không cần đổi múi giờ lần nữa.

### 3.5. Ghi `available_from` ở đâu

| Đường ghi | Nguồn `completedAtVn` | `fallbackDayVn` |
| --- | --- | --- |
| `recordConversion` tạo entry `confirmed` luôn (đơn hoả tốc, lần đầu thấy đã "Hoàn thành") | cột `Thời gian hoàn thành` | `todayVnIso()` |
| `confirmPendingEntry` (`pending` → `confirmed`) | cột `Thời gian hoàn thành` | `todayVnIso()` |
| `orderIngest.recordSingleOrder` (form "Ghi 1 đơn lẻ") | `null` — form không có trường ngày giao hàng | `todayVnIso()` |

`updatePendingEntry` **không** ghi `available_from`: entry vẫn `pending`, chưa có tiền khả dụng. Nếu
lần refresh làm `user_share_amount` vượt ngưỡng thì lúc confirm mới tính — đúng, vì tính ở thời điểm
confirm.

Giá trị `thresholdVnd`/`holdDays` do caller resolve rồi truyền vào, y như cách
`resolveUserSharePercent` được gọi từ `orderIngest.recordSingleOrder` và `shopeeReportImport`.
`LedgerStore` có 2 getter mới `getPayoutHoldThresholdVnd(defaultValue)` /
`getPayoutHoldDays(defaultValue)` theo đúng pattern `getUserSharePercent(defaultValue)`.

### 3.6. Đọc cột `Thời gian hoàn thành`

`parseShopeeOrderDate()` trong `shopeeReportImport.ts` parse prefix `"YYYY-MM-DD"` nên dùng được
nguyên cho cột này. **Đổi tên thành `parseShopeeReportDay()`** (cập nhật doc comment + caller +
test): nó đã phục vụ 2 cột, giữ tên cũ là gây hiểu sai ngay chỗ dễ nhầm nhất.

Giữ nguyên nguyên tắc đã có: giá trị thiếu/sai định dạng → `null`, **không** làm fail đơn. Cột thống
kê không được quyền chặn việc ghi nhận tiền. Không đoán định dạng khác.

**Lưu ý tên cột**: Shopee viết thường "g"/"h" ở cột này (`Thời gian hoàn thành`) nhưng viết hoa ở cột
ngày đặt (`Thời Gian Đặt Hàng`). Đã đối chiếu file thật, đừng "sửa lại cho đồng nhất".

Đơn gộp nhiều dòng (`mergeOrderRows`): lấy `Thời gian hoàn thành` **muộn nhất** trong các dòng
**không bị huỷ** của nhóm (dòng huỷ đã bị loại khỏi tổng và luôn trống cột này). Ngược với
`order_date` (lấy sớm nhất) và có chủ đích — cửa sổ trả hàng của cả đơn chỉ đóng khi món giao cuối
cùng đã hết hạn trả. Đơn còn dòng `pending` thì cả đơn là `pending`, chưa cần `completed_at`.

### 3.7. Khả dụng

`getAvailableBalance` thêm điều kiện:

```sql
status = 'confirmed' AND withdrawal_id IS NULL
AND (available_from IS NULL OR available_from <= :todayVn)
```

Thêm `getHeldBalance(platform, userId)` và `getHeldEntries(platform, userId)` cho dashboard
(`confirmed`, `withdrawal_id IS NULL`, `available_from > :todayVn`).

`:todayVn` luôn là `todayVnIso()` — **không** `date('now')` của SQLite, cái đó là UTC và sẽ mở khoá
sớm/muộn 7 tiếng.

## 4. Nhánh "Đã hủy" của import — bảng quyết định đầy đủ

| Trạng thái entry | Hành động | Mất tiền |
| --- | --- | --- |
| `pending` | `reverseCommissionEntry` (như hiện nay) | không |
| `confirmed`, `withdrawal_id IS NULL` *(kể cả đang bị giam)* | **`reverseCommissionEntry`** — thu hồi trọn | **không** |
| `confirmed`, nằm trong withdrawal `requested` | **ghi nợ ngay** + cảnh báo admin | có, trừ khi admin huỷ yêu cầu |
| `paid` | **ghi nợ** + DM user | có |
| `reversed` | bỏ qua | — |

Mọi nhánh đều ghi `recordOrderStatusEvent(merchant, orderId, "reversed", importDay)` như hiện nay.

`ShopeeReportImportResult` thêm 2 counter cho lưới thống kê của `/admin/record-orders`:
`heldCount` (đơn mới bị giam) và `debtCreatedCount` (đơn phát sinh nợ). Hai số này là thứ admin cần
thấy ngay sau mỗi lần import — nếu chỉ nằm trong `result.errors` thì sẽ lẫn vào các cảnh báo khác và
không ai để ý, đúng cái bệnh của hành vi hiện tại (§1.2b).

### 4.1. Vì sao ghi nợ NGAY ở ca thứ 3

Ghi nợ ngay thay vì chờ admin quyết là để **mặc định an toàn**: admin bỏ qua cảnh báo thì sổ vẫn
khớp, không rò rỉ tiền. Cảnh báo chỉ là cơ hội làm tốt hơn, không phải điều kiện để đúng.

### 4.2. Entry `paid` bị huỷ thì KHÔNG đổi status

Giữ nguyên `status = 'paid'`. Câu đó vẫn đúng: tiền đã ra khỏi tay chủ bot thật, user có sao kê ngân
hàng chứng minh. Đổi sang `reversed` sẽ làm **lịch sử đơn mà user xem trên dashboard** hiện đơn đó
như chưa từng được chi trả, mâu thuẫn với bằng chứng user đang cầm — và làm mất luôn dấu vết rằng
`withdrawal_id` đó đã thực sự chuyển tiền.

(Lưu ý: `paidTotal` thì không bị ảnh hưởng dù chọn cách nào, vì §5.4 đổi nó sang đọc tổng `amount`
của withdrawal `paid`. Lý do giữ `'paid'` nằm ở lịch sử đơn, không ở con số tổng.)

Bản ghi của việc thu hồi là dòng trong `payout_debts`. `/admin/orders` LEFT JOIN để gắn badge
"⚠ đã trả hàng".

`reverseCommissionEntry` giữ nguyên `EntryAlreadyWithdrawnError` — nhánh nợ **không** đi qua hàm đó.

## 5. Nợ hoàn trả

### 5.1. Bảng mới `payout_debts`

Bảng mới hoàn toàn nên không cần migration (cùng lý do `user_commission_overrides`, `zalo_groups`).

```sql
CREATE TABLE IF NOT EXISTS payout_debts (
  id              TEXT PRIMARY KEY,
  created_at      TEXT NOT NULL,
  platform        TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  merchant        TEXT NOT NULL,
  order_id        TEXT NOT NULL,
  amount          INTEGER NOT NULL,   -- user_share_amount cua don bi huy
  remaining       INTEGER NOT NULL,   -- con phai tru
  note            TEXT,
  settled_at      TEXT,               -- NULL = chua tru xong
  written_off_at  TEXT                -- admin xoa no
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payout_debts_order ON payout_debts(merchant, order_id);
CREATE INDEX IF NOT EXISTS idx_payout_debts_user ON payout_debts(platform, user_id);
```

`UNIQUE(merchant, order_id)` là chốt **sống còn**, không phải tối ưu: báo cáo Shopee liệt kê lại cả
lịch sử ở mỗi lần import, nên đơn huỷ hôm qua sẽ lại hiện "Đã hủy" hôm nay. Không có UNIQUE là nợ
nhân đôi mỗi ngày. Đây đúng cái bẫy mà `order_status_events` đã phải dùng `INSERT OR IGNORE` để
tránh — nên API ghi nợ cũng dùng `INSERT ... ON CONFLICT DO NOTHING`.

API: `recordPayoutDebt`, `listOutstandingDebts(platform, userId)`, `getOutstandingDebtTotal(platform, userId)`,
`listUsersWithDebt()`, `writeOffDebt(id)`, `deleteDebtByOrder(merchant, orderId)`.

### 5.2. Khả dụng trừ nợ

```
availableBalance = max(0, confirmed_chưa_rút_đã_mở_khoá − SUM(remaining của nợ chưa settled/write-off))
```

Floor ở 0 là bắt buộc: **`availableBalance` không bao giờ được âm**. Nợ không bao giờ ép user trả
tiền ra; nó ngồi đó cho đến khi có hoa hồng mới. Nợ còn mà balance dưới ngưỡng thì user tự nhiên
không rút được — không cần luật chặn riêng.

### 5.3. Nợ chỉ bị trừ ở `markWithdrawalPaid`, KHÔNG ở `requestWithdrawal`

Đây là quyết định kiến trúc quan trọng nhất của phần nợ.

`requestWithdrawal`:

- `gross` = tổng entry `confirmed`, chưa rút, đã mở khoá.
- `debt` = `getOutstandingDebtTotal`.
- `net = max(0, gross − debt)`; `net < threshold` → `InsufficientBalanceError(net, threshold)`.
- Tạo withdrawal với `amount = net` và **cột mới `debt_applied = min(gross, debt)`**.
- Gom entry như hiện nay, **thêm** `AND (available_from IS NULL OR available_from <= :todayVn)` để
  không hút đơn đang bị giam vào yêu cầu rút.
- **Không chạm `payout_debts`.**

`markWithdrawalPaid`: trong cùng transaction đã có, trừ `debt_applied` vào các dòng nợ theo
`created_at ASC` (nợ cũ trả trước), dòng nào `remaining` về 0 thì set `settled_at`.

`cancelWithdrawal`: chỉ thả entry ra, `payout_debts` không cần hoàn lại gì **vì chưa từng bị trừ**.

Nếu trừ nợ ngay lúc tạo yêu cầu thì huỷ yêu cầu phải hoàn nợ lại đúng từng dòng — chỗ dễ sai nhất
trên cả đường tiền. Trừ ở bước cuối thì cả hai nhánh terminal (`paid`, `cancelled`) đều đơn giản.

Không có cửa sổ đếm trùng: trong lúc withdrawal còn `requested`, toàn bộ entry đã mở khoá đều đã bị
gom nên `availableBalance = max(0, 0 − debt) = 0`.

### 5.4. Hệ quả: `amount` của withdrawal KHÁC tổng entry của nó

Sau feature này `withdrawal_requests.amount` (net) **nhỏ hơn** tổng `user_share_amount` của các entry
gắn vào nó khi có nợ. Phải sửa mọi chỗ đang giả định hai số đó bằng nhau:

- `getUserSummary.pendingBalance` — hiện cộng `user_share_amount` của entry `confirmed` có
  `withdrawal_id IS NOT NULL`. **Đổi sang đọc `withdrawal_requests.amount`** của yêu cầu đang
  `requested`. Không sửa thì dashboard nói "đang chờ chi trả 100k" trong khi yêu cầu là 60k.
- `getUserSummary.paidTotal` — giữ nguyên cộng theo entry `paid`? **Không**: cùng lý do trên, đổi
  sang tổng `amount` của withdrawal `paid`. Đó mới là số tiền thật đã vào tài khoản user.
- Audit bắt buộc khi implement, mỗi chỗ ghi rõ kết luận: `getOutstandingTotals`,
  `getPaidWithdrawalTotal`, `getDashboardMoneyTotals`, `listUsers`, 4 thẻ KPI `/admin/orders`
  (`getOrdersFilterTotals`), 4 thẻ KPI `/admin/users`, 2 thẻ KPI `/admin/withdrawals`.

### 5.5. Xoá nợ

Admin có nút **Xoá nợ** trên `/admin/users` (set `written_off_at`, dùng `button.danger` đã có). User
biến mất là chuyện có thật và nợ treo vĩnh viễn làm méo mọi con số tổng. Nợ đã xoá không tính vào
`getOutstandingDebtTotal` nữa nhưng **giữ lại dòng** để đối soát.

## 6. Huỷ yêu cầu rút

`withdrawal_requests.status` có giá trị thứ ba: `'cancelled'`. Trước feature này bảng chỉ đi một
chiều `requested → paid`, không có route nào ngoài `mark-paid`.

- `POST /admin/withdrawals/:id/cancel` — chỉ nhận khi status là `requested`, ngược lại 422.
- `LedgerStore.cancelWithdrawal(id, reason)`, một transaction: set `status='cancelled'` +
  `cancelled_at`; `UPDATE commission_entries SET withdrawal_id = NULL WHERE withdrawal_id = ?`
  (entry về lại `confirmed`, rút lại được).
- Riêng ca "đơn bị huỷ nằm trong yêu cầu rút": route cancel còn gọi `reverseCommissionEntry` cho
  đơn đó rồi `deleteDebtByOrder` — vì giờ tiền chưa ra, không còn là nợ.
- DM user qua template mới `withdrawalCancelledTemplate`.

Cột mới trên `withdrawal_requests` (migration theo pattern `migrateAddBankInfoColumns`):
`debt_applied INTEGER NOT NULL DEFAULT 0`, `cancelled_at TEXT`.

Audit: mọi query đang giả định chỉ có `requested`/`paid` — `getPendingWithdrawal`,
`listPaidWithdrawals`, `getOutstandingTotals`, `getPaidWithdrawalTotal`, 2 thẻ KPI
`/admin/withdrawals`, chart `/admin/dashboard`. Yêu cầu `cancelled` **không** được cộng vào bất kỳ
tổng tiền nào.

## 7. Giao diện

### 7.1. Dashboard user (`dashboardHtml.ts`)

Ba trạng thái tiền thay vì hai, cộng dòng nợ:

```
Chờ xác nhận      45.000đ    Shopee chưa duyệt đơn
Đang giữ         120.000đ    mở khoá 14/10                    ← MỚI
Đã trừ hoàn trả  −40.000đ    đơn ...SQ9 đã trả hàng           ← MỚI
Khả dụng          32.000đ    rút được ngay (đã trừ ở trên)
```

Mỗi đơn bị giam hiện ngày mở khoá của **chính nó** (`available_from`), không gộp thành một ngày
chung — mỗi đơn có mốc giao hàng riêng, gộp là nói sai với đơn mở sớm.

**Thứ tự và cách gọi tên là bắt buộc, không phải thẩm mỹ.** `Khả dụng` đã là số **net** (đã trừ nợ),
nên nếu đặt dòng nợ *dưới* nó và gọi là "Đang trừ lại" thì user đọc ra là "32.000đ này còn bị trừ
40.000đ nữa" — hiểu sai theo hướng tệ hơn thực tế. Vì vậy: dòng nợ đặt **trên** `Khả dụng`, mang dấu
trừ, tên ở thể **đã hoàn thành** ("Đã trừ hoàn trả"), và `Khả dụng` có chú thích "đã trừ ở trên".

Dòng "Đang giữ" / "Đã trừ hoàn trả" **chỉ hiện khi số đó > 0**. Hiện "0đ" cho user chưa bao giờ bị
giam là tạo lo lắng về một luật không áp dụng cho họ.

Số ở dòng nợ là `SUM(remaining)` của nợ chưa settled/write-off — bằng đúng số đã bị trừ khỏi `Khả
dụng`, vì §5.3 không giảm `remaining` cho đến lúc `markWithdrawalPaid`. Hai số luôn khớp nhau theo
cấu tạo, không phải nhờ đồng bộ tay.

Form rút tiền (`POST /d/:token/withdraw`) phải hiện số bị trừ **trước khi** user bấm gửi, nếu không
user yêu cầu rút rồi mới biết nhận ít hơn.

### 7.2. Ảnh "đơn về" — bẫy phải xử cùng lúc

`buildOrdersConfirmedNotification()` in `Tổng cộng` của lô đơn vừa ghi **cạnh** `Số dư khả dụng`.
Một đơn 150k bị giam sẽ vào `Tổng cộng` nhưng **không** vào `Số dư khả dụng` → user soi đúng một tấm
ảnh thấy hai số không khớp.

Đây y hệt bẫy đã ghi trong `CLAUDE.md` cho thứ tự đọc số dư ("đọc trước thì ảnh báo thiếu đúng các
đơn vừa ghi"), chỉ khác nguyên nhân.

Xử: thêm **một dòng chỉ hiện khi lô đó có đơn bị giam**: `Trong đó 150.000đ mở khoá từ 14/10`. Lô
không có đơn giam thì ảnh y như cũ, không đổi một pixel. `ordersConfirmedTemplate` (text dự phòng)
và `ordersConfirmedCaptionTemplate` cũng cần slot tương ứng, theo pattern một-slot-nhiều-trạng-thái
của `{{commissionLine}}`.

### 7.3. Admin (`adminHtml.ts`)

| Trang | Thêm |
| --- | --- |
| `/admin/withdrawals` | Banner đỏ trên hàng có đơn vừa bị trả hàng (số đúng là bao nhiêu) + nút **Huỷ yêu cầu**; tab thứ 3 "Đã huỷ" |
| `/admin/users` | Cột "Nợ" + nút **Xoá nợ** |
| `/admin/orders` | Badge `⚠ đã trả hàng` cho entry `paid` có nợ; cột "Mở khoá" cho đơn đang giam |
| `/admin/dashboard` | **không thêm thẻ KPI nào** |

Không thêm KPI vì vừa cắt từ 12 xuống 9 thẻ (2026-10-07, "quá nhiều, rối"). Tiền đang giam và nợ
chưa thu thuộc về `/admin/users` và `/admin/withdrawals` — chỗ admin thực sự hành động.

Nút "Huỷ yêu cầu" nằm cùng `<td>` với "Đánh dấu đã trả" nên phải theo đúng pattern
`form="pay-<id>"` đã có (`<form>` đặt NGOÀI `<table>`, xem `withdrawalsPageScript.test.ts`).

### 7.4. `/so-tay` (`handbookHtml.ts`)

Thêm 1 mục: đơn to giam bao lâu, trả hàng thì tiền bị trừ thế nào. Không nói ra thì luật này là bẫy
với user.

Mọi số đọc **live** từ settings y như `userSharePercent` và ngưỡng rút đang làm. `handbookHtml.ts`
đã có test chặn hardcode số, mục mới phải đi cùng đường đó.

## 8. Cấu hình

`src/core/settingsKeys.ts` + `src/config/settingsRegistry.ts`:

| Key | `SETTINGS_KEYS` | Default | Kiểu |
| --- | --- | --- | --- |
| `payout_hold_threshold_vnd` | `payoutHoldThresholdVnd` | `100000` | number, min 0 |
| `payout_hold_days` | `payoutHoldDays` | `7` | number, min 0, max 60 |
| `payout_debt_notice_template` | `payoutDebtNoticeTemplate` | xem dưới | textarea |
| `withdrawal_cancelled_template` | `withdrawalCancelledTemplate` | xem dưới | textarea |

`src/config/env.ts` + `.env.example`: `PAYOUT_HOLD_THRESHOLD_VND=100000`, `PAYOUT_HOLD_DAYS=7` làm
giá trị khởi tạo/fallback (từ 2026-08-21 `.env` chỉ còn vai trò đó).

`settingsTabOf()` trong `adminHtml.ts`: 2 số vào tab "Hoa hồng & rút tiền", 2 template vào tab "Mẫu
tin nhắn bot".

**Bẫy vận hành phải ghi vào `CLAUDE.md`**: 2 template mới có default trong code, nhưng instance nào
đã bấm Lưu ở `/admin/settings` sẽ không tự nhận — đây là bẫy chung của mọi template.

### 8.1. Template mặc định

`payoutDebtNoticeTemplate` — placeholder `{{orderId}}`, `{{amount}}`, `{{dashboardUrl}}`:

> Đơn {{orderId}} đã được trả hàng nên Shopee thu lại hoa hồng của đơn này.
> {{amount}} sẽ được trừ dần vào các đơn tới của bạn — bạn **không** phải chuyển tiền lại cho em nhé.
> Xem chi tiết: {{dashboardUrl}}

`withdrawalCancelledTemplate` — placeholder `{{amount}}`, `{{reason}}`, `{{dashboardUrl}}`:

> Yêu cầu rút {{amount}} của bạn đã được huỷ, lí do: {{reason}}
> Tiền vẫn nằm nguyên trong số dư của bạn, bạn gửi lại yêu cầu rút được nhé: {{dashboardUrl}}

Câu "tiền vẫn nằm nguyên trong số dư" là bắt buộc: `cancelWithdrawal` thả entry về `confirmed` nên
câu đó đúng, và không nói ra thì user đọc "yêu cầu bị huỷ" thành "mất tiền".

Câu "không phải chuyển tiền lại" là bắt buộc chứ không phải cho lịch sự: nhận tin "bạn đang nợ 40.000đ"
mà không có câu đó thì user tưởng phải trả tiền ra.

## 9. Thông báo

`notifyUser(platform, userId, { text, image? })` đã có sẵn (2026-10-05). Hai sự kiện mới:

- Phát sinh nợ → DM `payoutDebtNoticeTemplate`, **một lần cho mỗi đơn** (`UNIQUE(merchant, order_id)`
  của `payout_debts` tự lo claim-once).
- Huỷ yêu cầu rút → DM `withdrawalCancelledTemplate`.

Cả hai best-effort, lỗi gửi **không** làm fail import / fail response, theo đúng pattern
`.catch()` ở từng call site đang dùng.

**Chỉ gửi từ route web**, không gửi từ CLI `record-shopee-report` — cùng lý do cũ: rủi ro
`DuplicateConnection` với bot thật đang đăng nhập.

## 10. Test chặn hồi quy

Những chỗ đã biết sẽ sai nếu không chặn:

**`payoutHold.test.ts`**
- Ngưỡng là `>=`: đúng 100.000đ **bị** giam, 99.999đ không.
- `userShareAmount === 0` → không giam (dùng `||` ở đây là sai, giống bẫy `userSharePercent === 0`).
- `thresholdVnd = 0` → tắt hẳn, luôn trả `null`.
- `completedAtVn === null` → lùi về `fallbackDayVn`.
- `addDaysToVnIso`: qua tháng (`2026-09-28` + 7), qua năm (`2026-12-28` + 7), tháng 2 năm nhuận.

**`ledgerStore` / money**
- `available_from` đã chốt **không** đổi khi sửa setting rồi tính lại.
- `availableBalance` **không bao giờ âm** khi nợ > tiền.
- Entry `confirmed` chưa rút bị huỷ → `reversed`, **nợ = 0** (ca thu hồi trọn).
- Entry `paid` bị huỷ → status **vẫn** `'paid'`, có dòng nợ, `paidTotal` không tụt.
- Nợ **không nhân đôi** khi import lại cùng một báo cáo 2 lần liên tiếp.
- `requestWithdrawal` **không** hút entry đang bị giam.
- `requestWithdrawal` không trừ `payout_debts`; `markWithdrawalPaid` trừ; `cancelWithdrawal` không
  hoàn (vì chưa trừ).
- `pendingBalance` đọc `withdrawal_requests.amount`, không cộng entry.
- `getPaidWithdrawalTotal` **không** cộng withdrawal `cancelled`.
- `cancelWithdrawal` → entry về `confirmed` + `withdrawal_id IS NULL`.

**Giao diện**
- Ảnh "đơn về": lô không có đơn giam → không có dòng "mở khoá"; lô có → có, và số khớp.
- `/so-tay` render với ngưỡng/số ngày khác → không còn vết của số cũ.
- `/admin/withdrawals`: nút Huỷ dùng `form="..."`, `<form>` nằm ngoài `<table>`.

## 11. Những gì thiết kế này KHÔNG chữa

Đã trình bày và user chấp nhận:

1. **Nợ của user bỏ đi là mất thật.** Không có cách nào thu. Và nên biết: user bị trả hàng một đơn
   to rồi thấy Khả dụng về 0 thì khả năng cao họ đi luôn — ca mất tiền và ca mất user trùng nhau.
2. **Hold 7 ngày phủ ~6/15 ngày cửa sổ.** Phần còn lại rơi hết vào nợ.
3. **Không có mốc an toàn tuyệt đối.** Điều 3.2 cho Shopee quyền hỗ trợ trả hàng *sau* 15 ngày, và
   trạng thái báo cáo có thể mất ~30 ngày mới refresh.
4. **Đơn cũ không giam hồi tố** — `completed_at` không backfill được.
5. **Thực phẩm tươi sống chỉ có 24h trả hàng** nhưng hệ thống không phân biệt ngành hàng. Báo cáo có
   `L1/L2/L3 Danh mục toàn cầu` nên làm được, nhưng chưa làm: thêm luật theo ngành hàng là một trục
   phức tạp nữa mà chưa có dữ liệu nào cho thấy nó đáng.
