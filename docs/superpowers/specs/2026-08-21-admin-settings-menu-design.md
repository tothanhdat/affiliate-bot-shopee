# Menu cấu hình động cho admin (settings)

Ngày: 2026-08-21
Trạng thái: Approved (chat), chờ review spec file

## Bối cảnh / vấn đề

Hiện tại 3 nhóm giá trị sau chỉ đổi được qua sửa `.env` + redeploy:

1. `%` hoa hồng user nhận (`COMMISSION_USER_SHARE_PERCENT`)
2. Ngưỡng số dư tối thiểu để rút tiền (`WITHDRAWAL_THRESHOLD_VND`)
3. Một số tin nhắn bot trả lời cố định (`USAGE_TEXT`, welcome message, phần mở đầu/lưu ý của tin trả link)

`src/index.ts` đọc các giá trị này từ `env` **một lần lúc khởi động** rồi truyền tay (as static values) xuống `server.ts`, `zalo/bot.ts`, và closure `runAccesstradeSync`. Admin muốn tự đổi các giá trị này qua UI, không cần chạm code/redeploy.

## Phạm vi

- Chỉ 3 nhóm giá trị nêu trên. `taxPercent`/`platformFeePercent`/`maxRatioPercent` (commission) **không** đổi động — vẫn tĩnh từ `.env` như hiện tại, ngoài phạm vi yêu cầu.
- Tin nhắn bot: chỉ 3 tin nhắn tĩnh, không phụ thuộc logic dữ liệu phức tạp — `USAGE_TEXT`, `formatWelcomeReply`, `formatSuccessReply`. Các tin nhắn khác (lỗi, khuyến mãi, xác nhận đơn hàng...) giữ nguyên hard-code trong `replyText.ts`.
- Không cần lịch sử thay đổi (audit trail) cho setting — chỉ lưu giá trị hiện tại, đúng tinh thần YAGNI của dự án.
- Thay đổi setting chỉ ảnh hưởng **từ thời điểm lưu trở đi** — các `commission_entries` đã ghi nhận trước đó giữ nguyên `userShareAmount` đã chốt (không có gì thay đổi ở đây, hành vi này vốn đã đúng vì số được chốt tại thời điểm ghi entry).

## Lưu trữ

Thêm bảng `settings` vào **`ledger.db`** (qua `LedgerStore`, không tạo store/DB mới):

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt TEXT NOT NULL
)
```

Lý do gộp vào `LedgerStore` thay vì tách file/class riêng: 2/3 nhóm cấu hình (`%` hoa hồng, ngưỡng rút tiền) vốn là tham số tài chính đi cùng `LedgerStore` sẵn có; số lượng setting quá nhỏ (5 key) để đáng tách một store/DB mới — theo đúng cách dự án đã xử lý các trường hợp tương tự (vd gộp `short_links` vào `requests.db` thay vì tách riêng, xem `CLAUDE.md`).

`.env` (`COMMISSION_USER_SHARE_PERCENT`, `WITHDRAWAL_THRESHOLD_VND`) vẫn giữ vai trò **giá trị mặc định ban đầu** — dùng khi bảng `settings` chưa có override cho key đó. Text 3 tin nhắn mặc định = literal hiện tại trong `replyText.ts`. Không cần migrate dữ liệu, không phá vỡ deploy hiện tại (DB cũ tự có bảng mới qua `CREATE TABLE IF NOT EXISTS`, theo đúng pattern các bảng khác trong file).

## API của `LedgerStore` (thêm mới)

```ts
// Đọc: fallback ve default (tham so truyen vao) neu chua co override trong DB.
getSetting(key: string, defaultValue: string): string
getSettingInt(key: string, defaultValue: number): number

// Ghi: upsert (INSERT ... ON CONFLICT DO UPDATE), updatedAt = now.
setSetting(key: string, value: string): void

// Typed getters/setters tien dung tai cac diem goi (moi diem goi tu doc lai, khong cache):
getUserSharePercent(): number             // key: commission_user_share_percent
setUserSharePercent(v: number): void
getWithdrawalThresholdVnd(): number       // key: withdrawal_threshold_vnd
setWithdrawalThresholdVnd(v: number): void
getUsageText(): string                    // key: usage_text
setUsageText(v: string): void
getWelcomeMessageTemplate(): string       // key: welcome_message_template
setWelcomeMessageTemplate(v: string): void
getSuccessReplyTemplate(): string         // key: success_reply_template
setSuccessReplyTemplate(v: string): void
```

Default value cho từng typed getter lấy từ `env.commission.userSharePercent` / `env.withdrawal.thresholdVnd` / literal hiện tại của 3 tin nhắn — các default này được truyền vào từ **call site** (không hard-code default bên trong `LedgerStore`, giữ core không phụ thuộc `env`), giống cách `LedgerStore` hiện đã nhận config qua tham số ở các method khác (`recordConversion` nhận `taxPercent` v.v. qua input, không tự đọc `env`).

## Placeholder cho 2 template có nội dung động

`replyText.ts` thêm hàm `renderTemplate(template: string, vars: Record<string, string>): string` thay mọi `{{key}}` bằng giá trị tương ứng (không tìm thấy key → để nguyên placeholder, không throw — tránh crash nếu admin gõ sai tên biến).

- `welcome_message_template`: `{{userSharePercent}}`, `{{botSharePercent}}`, `{{withdrawalThreshold}}` (đã format sẵn dạng "20.000đ" qua `formatVnd` trước khi truyền vào `renderTemplate`).
- `success_reply_template`: `{{link}}` (affiliate URL) và `{{commissionLine}}` (dòng hoa hồng ước tính — vẫn tính bằng code như hiện tại, ghép vào làm biến truyền vào template, admin không sửa được nội dung dòng này nhưng có thể đổi vị trí/văn phong xung quanh). Toàn bộ nội dung hiện tại của `formatSuccessReply` (phần mở đầu + phần lưu ý cuối) gộp thành **một template duy nhất** thay vì tách rời — đơn giản hơn cho admin khi sửa (nhìn thấy toàn bộ tin nhắn cùng lúc).

`formatWelcomeReply`/`formatSuccessReply` đổi chữ ký: nhận thêm `template: string` (đọc từ `ledgerStore.getWelcomeMessageTemplate()`/`getSuccessReplyTemplate()` tại call site) thay vì tự dùng literal hard-code.

Nếu admin lỡ xoá placeholder khỏi template: chỉ mất phần nội dung tương ứng, không lỗi/crash — chấp nhận được, không validate placeholder tồn tại trong text khi lưu.

## Nơi phải sửa để đọc "động" thay vì giá trị đã đóng băng lúc khởi động

`index.ts` hiện xây 1 object config tĩnh (`{taxPercent, platformFeePercent, userSharePercent, maxCommissionRatioPercent}`) **một lần** rồi truyền references cố định xuống nhiều nơi tái sử dụng cho mọi request về sau. Sửa để các điểm dùng đọc lại từ `ledgerStore` ngay tại thời điểm xử lý:

- **`server.ts`**:
  - Route `/admin/record-orders/single` và `/admin/record-orders/csv`: khi build `recordOrderConfig` truyền vào `recordOrderFromAccesstrade`/`recordOrdersFromCsv`, thay `userSharePercent: <static>` bằng `userSharePercent: ledgerStore.getUserSharePercent()` (đọc ngay trước khi gọi, các field `taxPercent`/`platformFeePercent`/`maxCommissionRatioPercent` giữ nguyên tĩnh từ config truyền vào lúc khởi tạo server).
  - `GET /d/:token` và `POST /d/:token/withdraw`: thay tham số `thresholdVnd` cố định bằng `ledgerStore.getWithdrawalThresholdVnd()` đọc tại đầu handler.
  - Thêm route mới `GET /admin/settings` (render form) + `POST /admin/settings` (validate + lưu qua các setter của `ledgerStore`, redirect lại kèm banner thành công/lỗi) — theo pattern các route admin khác (`AdminSessionStore` guard, `adminHtml.ts` render).

- **`telegram/bot.ts`** (dòng 29/30/51 dùng `USAGE_TEXT`, dòng 63 gọi `formatSuccessReply`) và **`zalo/bot.ts`** (dòng 162 dùng `USAGE_TEXT`, dòng 182 gọi `formatSuccessReply`, dòng 246 gọi `formatWelcomeReply`): thay `USAGE_TEXT` bằng `ledgerStore.getUsageText()` đọc tại thời điểm xử lý tin nhắn; `formatSuccessReply(...)` → truyền thêm `ledgerStore.getSuccessReplyTemplate()`; `zalo/bot.ts` chỗ gọi `formatWelcomeReply(this.options.commissionUserSharePercent, this.options.withdrawalThresholdVnd)` → đổi thành đọc `ledgerStore.getUserSharePercent()`, `ledgerStore.getWithdrawalThresholdVnd()`, `ledgerStore.getWelcomeMessageTemplate()` ngay tại thời điểm gửi DM chào mừng (bỏ 2 field `commissionUserSharePercent`/`withdrawalThresholdVnd` khỏi `ZaloGroupBotOptions`, vì `ledgerStore` đã có sẵn trong `options` để đọc trực tiếp — `index.ts` không cần truyền 2 field này nữa khi gọi `createZaloGroupBot`).

- **`index.ts`** (`runAccesstradeSync`): `recordOrderConfig.userSharePercent` đọc `ledgerStore.getUserSharePercent()` ngay trong hàm (mỗi lần hàm này chạy — 1 lần/ngày — sẽ tự lấy giá trị mới nhất, không cần thay đổi cơ chế lịch chạy).

- **`scripts/ledgerAdmin.ts`** (CLI ghi tay/sync thủ công): tương tự, đọc `ledgerStore.getUserSharePercent()` thay vì `env.commission.userSharePercent` tại các lệnh liên quan (`record-conversion`, `record-conversions-csv`, `sync-accesstrade`).

## Admin UI

Thêm mục "Cấu hình" vào sidebar (`adminShell` trong `adminHtml.ts`), route `/admin/settings`:

- Input số: `%` hoa hồng user nhận (0–100), Ngưỡng rút tiền tối thiểu (VNĐ, > 0).
- 3 textarea: Usage text, Welcome message, Success reply — mỗi ô có dòng ghi chú nhỏ liệt kê placeholder hợp lệ ngay bên dưới.
- Nút Lưu, POST tới `/admin/settings`. Validate cơ bản (số trong khoảng hợp lệ, text không rỗng) — sai thì redisplay form kèm banner lỗi (pattern giống `renderRecordOrdersPage`). Đúng thì lưu qua các setter của `ledgerStore` và hiện banner thành công.
- Không cần xác nhận 2 lần (`confirmOnSubmit`) — đây không phải hành động phá huỷ, sửa lại được ngay.

## Testing

- Unit test `LedgerStore`: `getSetting`/`setSetting` (chưa có override → trả default; đã set → trả giá trị mới; upsert ghi đè đúng), các typed getter/setter tương ứng.
- Unit test `renderTemplate` trong `replyText.ts`: thay đúng placeholder có trong `vars`, giữ nguyên placeholder không khớp, không throw.
- Unit test `formatWelcomeReply`/`formatSuccessReply` sau khi đổi chữ ký (nhận `template` làm tham số) — vẫn ra đúng nội dung khi dùng template mặc định (không regress test cũ), và ra đúng khi dùng template tuỳ chỉnh có placeholder.
- Test route `/admin/settings` (nếu `server.ts` đã có test harness sẵn — theo dõi pattern test hiện có cho các route admin khác trong `__tests__`).
- Kiểm tra thủ công qua trình duyệt: đổi `%`/ngưỡng/text trên `/admin/settings`, gửi link demo qua bot (hoặc gọi `POST /api/v1/resolve`) và xác nhận tin nhắn phản ánh đúng giá trị mới — không cần restart server.

## Rủi ro / lưu ý

- `zca-js` welcome DM đọc `ledgerStore` tại thời điểm gửi (không phải lúc khởi động `zaloBot`) — cần đảm bảo `ledgerStore` instance đã sẵn sàng trước khi handler chạy (vốn đã đúng vì `ledgerStore` được tạo trước khi `createZaloGroupBot` trong `index.ts`).
- Không thêm cơ chế cache cho các giá trị đọc từ `settings` — mỗi lần dùng query SQLite trực tiếp (đọc 1 dòng theo primary key, chi phí không đáng kể, nhất quán với cách `LedgerStore` đang xử lý các query khác).
