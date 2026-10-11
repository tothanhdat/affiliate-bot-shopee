# Chi tiết từng sản phẩm trong đơn nhiều món — thiết kế

> 2026-10-11. Gồm việc chính (hiển thị chi tiết sản phẩm của đơn nhiều món) và hai việc phụ
> không liên quan, gộp chung một đợt theo yêu cầu của chủ bot (mục 10 và 11).

## 1. Mục tiêu

Shopee tính hoa hồng cho **mọi** sản phẩm mua cùng một shop trong phiên click, không chỉ sản
phẩm user gửi link. Hệ thống đã cộng đúng số tiền đó từ 2026-09-10 (`mergeOrderRows`), nhưng
chỉ hiển thị tên món hoa hồng cao nhất kèm hậu tố `(+N sản phẩm khác)` — không ai xem được
trong đơn có những gì.

Đợt này: lưu và hiển thị chi tiết từng món trên `/admin/orders` và dashboard user `/d/:token`.
**Không đổi một đồng tiền nào** — chỉ là dữ liệu hiển thị.

## 2. Dữ kiện đã đo trên báo cáo thật

Đo trên `AffiliateCommissionReport_202610110849.csv` (214 dòng, 160 đơn, ngày đặt 21/08 → 10/10).

| Phép đo | Kết quả |
|---|---|
| Đơn có `Σ hoa hồng sản phẩm ≠ hoa hồng đơn hàng` | **0/160** |
| Đơn nhiều dòng | 34 |
| Đơn còn ≥2 món **sau khi bỏ quà tặng** | **13** |
| Dòng quà tặng (giá niêm yết = 0) | 29 |
| Dòng mua thật (giá > 0) nhưng hoa hồng = 0 | 3 |
| Dòng giá = 0 mà vẫn có hoa hồng | **0** |
| Đơn có các dòng khác trạng thái nhau | **0/160** |
| Dòng Sub_id rỗng | 4 (3 đơn) |

Ba kết luận rút ra, mỗi cái chi phối một quyết định bên dưới:

1. Cột `Tổng hoa hồng đơn hàng(₫)` chỉ được Shopee điền ở **một** dòng của nhóm, các dòng còn
   lại là `0`. Cột `Tổng hoa hồng sản phẩm(₫)` thì **đủ ở mọi dòng**. Đây là chỗ dễ đọc nhầm
   thành "dòng mua kèm không có hoa hồng" — nguyên nhân sinh ra đợt này.
2. Lọc quà tặng theo **giá niêm yết = 0** là an toàn tuyệt đối (0 dòng giá 0 mà có tiền). Lọc
   theo **hoa hồng = 0** thì sai: mất 3 món mua thật trị giá 241k–316k thuộc ngành hàng 0%.
3. Trạng thái của mọi dòng trong một đơn hiện luôn giống nhau, nhưng luật gộp đã có nhánh xử lý
   trả hàng một phần, nên vẫn lưu trạng thái từng dòng (mục 4).

## 3. Quyết định đã chốt với chủ bot (2026-10-11)

- **Bỏ quà tặng**, tiêu chí là **giá niêm yết = 0**, lọc ngay ở tầng parse, không ghi xuống DB.
- Món mua thật nhưng hoa hồng 0đ (ngành hàng chưa bật) **vẫn hiện**.
- Chi tiết hiện **cả trên dashboard user**, mỗi món gồm **tên + giá + hoa hồng gốc**.
- Dòng Sub_id rỗng **bỏ hẳn** — đó là hoa hồng gián tiếp của chủ bot, không sinh từ link nào.
- Backfill không có bước riêng: lần import kế tiếp tự điền.
- **Không làm cho TikTok** trong đợt này.

## 4. Dữ liệu — bảng `commission_entry_items`

Bảng mới hoàn toàn trong `ledgerStore` ⇒ **không cần migration cột** (cùng tiền lệ `payout_debts`,
`zalo_known_users`).

```sql
CREATE TABLE IF NOT EXISTS commission_entry_items (
  merchant          TEXT    NOT NULL,
  order_id          TEXT    NOT NULL,
  item_id           TEXT    NOT NULL,
  model_id          TEXT    NOT NULL,   -- '' khi báo cáo thiếu
  product_name      TEXT    NOT NULL,
  quantity          INTEGER NOT NULL,
  order_amount      INTEGER NOT NULL,   -- "Giá trị đơn hàng (₫)" của CHÍNH dòng đó
  commission_amount REAL    NOT NULL,   -- "Tổng hoa hồng sản phẩm(₫)" của chính dòng đó
  row_status        TEXT    NOT NULL,   -- confirmed | pending | reversed
  PRIMARY KEY (merchant, order_id, item_id, model_id)
);
```

**`model_id` nằm trong khoá không phải cho đẹp.** Đơn `2610109S28J4XY` có **hai dòng cùng
`item_id = 18193835545`**, khác `model_id` (`168152404387` / `...388`) — cùng sản phẩm, hai
phân loại, hai lần tính tiền riêng. Thiếu `model_id` trong khoá thì một trong hai dòng biến mất
và tổng các món không còn bằng tổng đơn.

**`order_amount` lấy cột *Giá trị đơn hàng*, không phải cột *Giá*.** Cột *Giá* là giá niêm yết;
thẻ đơn trên dashboard đang hiện `orderAmount` của entry = tổng *Giá trị đơn hàng* các dòng. Lấy
nhầm cột thì danh sách món cộng lại không bằng ô "Giá trị đơn" ngay phía trên nó.

**`commission_amount` là `REAL`, không làm tròn khi lưu.** Shopee trả hoa hồng lẻ tới phần nghìn
(`4836.375`). Làm tròn lúc lưu thì 7 món cộng lại lệch vài đồng so với ô "Hoa hồng" của đơn —
đúng cái bẫy hai-nguồn-tính-tiền mà `money.ts` đã phải dọn một lần. Làm tròn **chỉ** ở `formatVnd`
lúc render.

**Quà tặng không được ghi xuống bảng này.** Lọc một lần ở `mergeOrderRows` thì không có đường nào
lọt lên UI và không phải nhớ lọc lại ở hai chỗ render. Đánh đổi đã chấp nhận: đổi ý thì phải
import lại báo cáo — rẻ, vì báo cáo luôn kèm cả lịch sử.

**Dòng đã huỷ VẪN được ghi**, mang `row_status = 'reversed'`, và **không cộng** vào tổng — giữ
đúng hành vi tiền hiện tại (trả hàng một phần). Lưu để sau này hiện được "món này đã trả"; hiện
tại chưa quan sát được ca nào (0/160).

## 5. Luồng ghi + backfill

```
importShopeeReport
  ├─ mergeOrderRows  → MergedOrder { …, items: MergedOrderItem[] }   (lọc quà tặng tại đây)
  ├─ applyOrderStatusToLedger(...)        ← KHÔNG đụng vào
  └─ ledgerStore.replaceEntryItems(merchant, orderId, items)   ← lời gọi RIÊNG
```

**Không nhồi vào `orderStatusApply.ts`.** Module đó là đường quyết định tiền dùng chung với
TikTok (reverse, ghi nợ, huỷ yêu cầu rút). Đây là dữ liệu hiển thị thuần tuý; trộn vào là chạm
cỗ máy nợ hoàn trả của cả hai sàn để đổi lấy một danh sách tên món.

`replaceEntryItems()` = **XOÁ hết item của `(merchant, order_id)` rồi chèn lại, trong một
transaction**. (Tinh chỉnh so với bản trình bày trong chat, vốn nói `ON CONFLICT DO UPDATE`: upsert
chống được nhân đôi nhưng **không** dọn được item Shopee đã bỏ khỏi báo cáo — sẽ để lại món ma mà
không ai phát hiện. Khoá chính vẫn giữ để bảo toàn dữ liệu.)

Điều kiện gọi: **chỉ khi đơn thực sự có entry trong ledger**. Đơn bị bỏ qua vì trạng thái lạ, và
đơn toàn dòng Sub_id rỗng, đều không có entry ⇒ không ghi item.

Ghi cho **mọi** trạng thái đơn (`pending`/`confirmed`/`reversed`), kể cả lần import không làm đổi
trạng thái gì — vì đây không phải sự kiện trạng thái.

**Backfill**: không có nút, không có script, không có bước thủ công. Lần import 9h30 kế tiếp tự
điền cho mọi đơn còn trong báo cáo (phủ từ 21/08 — tức gần như toàn bộ lịch sử hệ thống). Đơn ghi
tay qua form "Ghi 1 đơn lẻ" không có item ⇒ hiển thị như cũ.

## 6. Hiển thị `/admin/orders`

**Không thêm cột.** Bảng đã 10 cột và `px-4` là mức vừa đủ để nút "Huỷ đơn" không bị đẩy ra ngoài
màn ~1700px (ràng buộc đã ghi trong `.claude/rules/admin-ui-tung-trang.md`).

Chi tiết nằm **trong ô "Sản phẩm" sẵn có**: tên món chính như cũ, bên dưới là `<details>` mở tại
chỗ, summary dạng `▸ 7 sản phẩm`, nội dung là danh sách `tên · giá · hoa hồng gốc`.

- `<details>` native, **không một dòng JS nào** — cùng pattern QR của `/admin/withdrawals`.
- Khu `/admin` **không nạp preflight** ⇒ `<summary>` phải tự reset, và cần
  `::-webkit-details-marker { display: none }` vì Safari không ẩn mũi tên chỉ bằng `list-none`.
- Chỉ hiện khi **≥2 món**. Đơn 1 món giữ nguyên hình như hiện tại.
- Đơn có `commission_overridden_at` ⇒ thêm dòng ghi chú trong khối: *"Hoa hồng đã được sửa tay,
  các số bên dưới là số Shopee báo."* **Bắt buộc**, không phải trang trí: thiếu nó thì lần đối
  soát sau admin thấy tổng các món khác số trên hàng và tưởng bảng tính sai.
- **Sửa kèm**: hậu tố `(+N sản phẩm khác)` trong `mergeOrderRows` phải đếm theo **cùng tiêu chí**
  (đã bỏ quà tặng). Không sửa thì hàng ghi "(+2 sản phẩm khác)" mà mở ra chỉ có 1 món.

## 7. Hiển thị dashboard user `/d/:token`

Trong `order-card`, ngay dưới dòng tên sản phẩm: `<details>` `7 sản phẩm trong đơn` → danh sách
**dọc** (`tên` / `giá` / `hoa hồng`) + **dòng tổng**.

Dòng tổng là lý do tính năng này đáng tin: tổng giá các món **đúng bằng** ô "Giá trị đơn" và tổng
hoa hồng **đúng bằng** ô "Hoa hồng" ngay phía trên — user tự kiểm chứng được, không có con số nào
lạc. Đây cũng là lý do **không** hiện "phần bạn nhận" theo từng món: chia thuế/phí/% rồi làm tròn
cho từng món thì tổng lệch vài đồng so với ô "Bạn nhận".

- Danh sách **dọc, không bảng ngang**: đây là màn hình chính của trang (user bấm link từ Zalo trên
  điện thoại) và user đã hai lần báo "không thấy cột X" khi dùng bảng ngang.
- Món thuộc dòng đã huỷ: gạch ngang + làm mờ, cùng quy tắc đang dùng cho đơn `reversed`.
- Chỉ hiện khi ≥2 món.
- `product_name` do Shopee trả ⇒ **phải `escapeHtml`**, giống `productName` của entry.
- `getUserSummary` lấy item cho **cả danh sách đơn trong một query** (một câu `WHERE (merchant, order_id) IN (…)`, vì một user có thể có đơn của
  nhiều sàn), không N+1.

## 8. Không làm (YAGNI)

Không trang chi tiết đơn riêng · không cột mới · không nút/script backfill · không xuất file ·
không hiện cho TikTok (rule đối soát TikTok ghi rõ "đơn nhiều SKU" là một trong sáu thứ **chưa
quan sát lần nào** — chưa biết hình dạng thật thì không đoán).

## 9. Test

Fixture là đơn thật `2610109S28J4XY` (7 món).

| Test | Chặn điều gì |
|---|---|
| 7 item; `Σ commission = 31.621` = `commissionAmount` của entry; `Σ order_amount` = `orderAmount` | Lấy nhầm cột, làm tròn sớm |
| Hai dòng cùng `item_id` khác `model_id` ⇒ vẫn đủ 2 item | Khoá chính thiếu `model_id` |
| Quà tặng giá 0 không xuất hiện **và** `(+N sản phẩm khác)` đếm khớp số item hiện ra | Lệch giữa nhãn và danh sách |
| Món giá > 0 hoa hồng 0đ (sữa Vinamilk 316k, rate 0%) **vẫn xuất hiện** | Ai đó "dọn" thành lọc theo hoa hồng |
| Import cùng file 2 lần ⇒ vẫn đúng 7 item | Nhân đôi theo ngày |
| Báo cáo lần 2 bớt 1 dòng ⇒ item đó biến mất | Món ma khi dùng upsert |
| Dòng Sub_id rỗng không vào items | Gán hoa hồng gián tiếp cho user |
| Đơn 1 món ⇒ không có khối `<details>` ở cả 2 trang | Khối rỗng vô nghĩa |
| Entry khoá hoa hồng ⇒ có dòng ghi chú | Admin đọc nhầm là lỗi tính |

## 10. Việc phụ A — nút "Rút tiền" mờ trên dashboard user

Khối rút tiền có 5 trạng thái. Chốt với chủ bot 2026-10-11: **chỉ 3 trạng thái "chưa đủ điều
kiện"** (tiền đang tạm giữ / đang chờ sàn xác nhận / chưa đủ ngưỡng) hiện thêm nút mờ. Trạng thái
"đang chờ Admin xử lý" **giữ nguyên như hiện tại, không có nút** — user ở đó **đủ** điều kiện, chỉ
là đã gửi rồi.

- Nút nằm **dưới** ô thông báo đang có; **giữ nguyên toàn bộ câu chữ** của 3 ô đó (đã qua nhiều
  vòng chỉnh, có test chặn trong `dashboardWithdrawHint.test.ts`).
- `<button type="button" disabled>Rút tiền</button>`, **không bọc trong `<form>` nào** ⇒ không có
  đường submit kể cả khi gỡ `disabled` bằng DevTools.
- **Không render 3 trường ngân hàng** (yêu cầu trực tiếp của chủ bot).
- CSS `button:disabled`: giảm độ đậm, `cursor: not-allowed`, bỏ hover/transform. Trang này nền tối
  kiểu kính ⇒ **không hạ opacity quá tay**: mờ tới mức không đọc được chữ là lỗi hiển thị chứ
  không phải "disabled".
- **Không nhét lý do vào `title`** — màn hình điện thoại không hover được; lý do đã nằm trong ô
  thông báo ngay trên.
- **Không đụng backend**: `POST /d/:token/withdraw` vẫn tự chặn bằng ngưỡng và `DebtNotCoveredError`
  ở tầng ledger. Nút mờ thuần tuý là giao diện.

Test (thêm vào `dashboardWithdrawHint.test.ts`): 3 nhánh đó có nút `disabled` **và không có**
`<form` / `bankAccountNumber`; nhánh đủ điều kiện có form với nút **không** disabled; nhánh chờ
Admin xử lý **không** có nút nào.

## 11. Việc phụ B — `{{san}}` cho template chào bù trong group

`formatGroupJoinBlockedGroupReply()` truyền thêm `san: supportedMerchantNames()` vào
`renderTemplate` — đúng cách `formatGroupJoinWelcomeReply` đang làm. Thêm `{{san}}` vào `helpText`
của `groupJoinBlockedReplyTemplate` trong `settingsRegistry.ts`; chip "bấm để chèn biến" ở
`/admin/settings` **tự xuất hiện** vì nó quét placeholder ngay từ helpText.

**Default template giữ nguyên câu chữ.** Nó không gõ thẳng tên sàn nào (chỉ "Bot săn sale hoàn
tiền") nên hôm nay không có lỗi nói sai sàn — thêm tên sàn vào là đổi văn phong, không phải sửa
bug. Hệ quả dễ chịu: instance đã bấm Lưu **không cần sửa tay**, khi nào muốn dùng thì tự chèn.

Chỗ duy nhất có thể gãy: tin này tag `@tên` bằng `pos = body.indexOf("@tên")` **tính sau khi
render**, nên `{{san}}` đứng trước `{{name}}` vẫn ra offset đúng. Test riêng cho ca đó, cộng test
template cũ (không có `{{san}}`) chạy y như cũ.

## 12. Tài liệu phải cập nhật trong cùng đợt

- `.claude/rules/import-bao-cao-shopee.md` — mục mới: bảng item, tiêu chí lọc quà tặng, `replaceEntryItems`.
- `.claude/rules/ledger-va-tien.md` — schema `commission_entry_items`, `getUserSummary` trả thêm item.
- `.claude/rules/admin-ui-tung-trang.md` — khối `<details>` trong ô "Sản phẩm" của `/admin/orders`.
- `.claude/rules/trang-cho-user.md` — khối chi tiết món + nút rút tiền mờ.
- `.claude/rules/settings-va-template.md` — `{{san}}` cho `groupJoinBlockedReplyTemplate`.

## 13. Bổ sung khi lập kế hoạch (2026-10-11)

Ba chỗ plan **tinh chỉnh/bổ sung** so với bản spec ở trên — ghi lại để spec không nói khác code:

1. **Hai dòng cùng `(item_id, model_id)` trong một đơn được cộng dồn** thành một món (mục 4). Có trong dữ liệu thật: đơn `260923SDX2CYF2` có 3 dòng cùng `item_id`+`model_id`, khác promotion. Không xử lý thì vi phạm khoá chính và làm sập cả transaction.
2. **Dashboard user chỉ hiện danh sách khi cộng lại KHỚP thẻ** (`entryItemsReconcile`), khác với `/admin/orders` luôn hiện kèm ghi chú (mục 6, 7). Spec ban đầu chỉ nói về ghi chú cho admin và bỏ sót trường hợp user xem một đơn đã bị admin khoá hoa hồng tay: lúc đó tổng các món lệch thẻ ngay trước mắt user và phá lời hứa "tự cộng lại ra đúng số".
3. **Món mua thật hoa hồng 0đ hiện "(chưa có hoa hồng)"** ở cả hai trang — cách nói trung tính, vì từ báo cáo chỉ biết rate 0%, không biết lý do.
