# Menu cấu hình động cho admin (settings)

Ngày: 2026-08-21
Trạng thái: Approved (chat), chờ review spec file

## Bối cảnh / vấn đề

Hiện tại 3 nhóm giá trị sau chỉ đổi được qua sửa `.env` + redeploy:

1. `%` hoa hồng user nhận (`COMMISSION_USER_SHARE_PERCENT`)
2. Ngưỡng số dư tối thiểu để rút tiền (`WITHDRAWAL_THRESHOLD_VND`)
3. Một số tin nhắn bot trả lời cố định (`USAGE_TEXT`, welcome message, phần mở đầu/lưu ý của tin trả link)

`src/index.ts` đọc các giá trị này từ `env` **một lần lúc khởi động** rồi truyền tay (as static values) xuống `server.ts`, `zalo/bot.ts`, và closure `runAccesstradeSync`. Admin muốn tự đổi các giá trị này qua UI, không cần chạm code/redeploy.

**Định hướng sản phẩm (2026-08-21, bổ sung theo yêu cầu trực tiếp của user)**: source này có khả năng được triển khai/cho thuê lại cho các bên khác (mỗi bên có `%` hoa hồng, ngưỡng rút tiền, văn phong tin nhắn riêng) — nếu mỗi lần khách thuê cần đổi 1 giá trị lại phải chủ bot tự sửa code + redeploy hộ thì rất mất thời gian. Vì vậy cơ chế `settings` xây ở đây phải **thiết kế để mở rộng rẻ**: thêm 1 setting mới sau này chỉ nên là thêm 1 key + 1 field trên form + 1 chỗ gọi getter thay vì phải thiết kế lại. Đợt này **vẫn chỉ build đúng 5 setting đã chốt** (không tự ý đoán thêm setting khác khách thuê có thể cần) — xem nguyên tắc mở rộng ở cuối spec.

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

## API của `LedgerStore` (thêm mới) + phân lớp key/registry

Để tránh core (`LedgerStore`) phụ thuộc `env` (giữ đúng ranh giới core/adapter của dự án) mà vẫn không lặp lại chuỗi key ở nhiều nơi, tách làm 2 lớp:

**`src/core/settingsKeys.ts`** (core, không phụ thuộc gì khác) — chỉ chứa hằng số tên key:

```ts
export const SETTINGS_KEYS = {
  userSharePercent: "commission_user_share_percent",
  withdrawalThresholdVnd: "withdrawal_threshold_vnd",
  usageText: "usage_text",
  welcomeMessageTemplate: "welcome_message_template",
  successReplyTemplate: "success_reply_template",
} as const;
```

**`LedgerStore`** (thêm mới, dùng `SETTINGS_KEYS` ở trên):

```ts
// Generic, dung truc tiep boi trang /admin/settings (lap qua SETTINGS_REGISTRY).
getSetting(key: string, defaultValue: string): string
getSettingInt(key: string, defaultValue: number): number
setSetting(key: string, value: string): void   // upsert, INSERT ... ON CONFLICT DO UPDATE, updatedAt = now.

// Typed wrapper tien dung cho code nghiep vu - NHAN defaultValue tu call site (khong hard-code
// default ben trong, giu core khong phu thuoc env - giong cach recordConversion nhan taxPercent
// qua input thay vi tu doc env). Doc lai tu DB moi lan goi, khong cache.
getUserSharePercent(defaultValue: number): number
setUserSharePercent(value: number): void
getWithdrawalThresholdVnd(defaultValue: number): number
setWithdrawalThresholdVnd(value: number): void
getUsageText(defaultValue: string): string
setUsageText(value: string): void
getWelcomeMessageTemplate(defaultValue: string): string
setWelcomeMessageTemplate(value: string): void
getSuccessReplyTemplate(defaultValue: string): string
setSuccessReplyTemplate(value: string): void
```

**`src/config/settingsRegistry.ts`** (config layer - được phép biết cả `env` lẫn `core`, dùng RIÊNG cho trang `/admin/settings`, không dùng bởi adapter/CLI): khai báo **1 danh sách duy nhất** `SETTINGS_REGISTRY: SettingFieldConfig[]` (`{key, label, type: "number" | "textarea", default: string, helpText?, min?, max?}`) - default lấy từ `env.commission.userSharePercent`/`env.withdrawal.thresholdVnd`/3 hằng số text mặc định export từ `replyText.ts` (xem mục placeholder bên dưới). Route `/admin/settings` (cả GET render lẫn POST validate/save) lặp qua danh sách này thay vì viết tay từng field - đây là nơi DUY NHẤT cần sửa khi thêm 1 setting mới sau này (xem "Nguyên tắc mở rộng" cuối spec).

Các call site khác (`telegram/bot.ts`, `zalo/bot.ts`, `server.ts` ngoài trang settings, `index.ts`, `ledgerAdmin.ts`) gọi thẳng typed getter của `LedgerStore` với default đã có sẵn tại chỗ (hằng số `USAGE_TEXT`/`WELCOME_MESSAGE_TEMPLATE_DEFAULT`/`SUCCESS_REPLY_TEMPLATE_DEFAULT` import từ `replyText.ts`, hoặc giá trị `env.commission.userSharePercent`/`env.withdrawal.thresholdVnd` đã được truyền vào lúc khởi tạo y như hiện tại) - KHÔNG import `settingsRegistry.ts` (giữ nguyên pattern hiện có: adapter nhận config qua constructor option từ `index.ts`, không tự import `src/config/env.js`).

## Placeholder cho 2 template có nội dung động

`replyText.ts` thêm hàm `renderTemplate(template: string, vars: Record<string, string>): string` thay mọi `{{key}}` bằng giá trị tương ứng (không tìm thấy key → để nguyên placeholder, không throw — tránh crash nếu admin gõ sai tên biến). Nội dung literal hiện tại của welcome/success message chuyển thành 2 hằng số export mới `WELCOME_MESSAGE_TEMPLATE_DEFAULT`/`SUCCESS_REPLY_TEMPLATE_DEFAULT` (giữ nguyên văn phong hiện tại, chỉ thay các đoạn nội suy `${...}` bằng placeholder `{{...}}`) — dùng làm default cho typed getter tương ứng của `LedgerStore` VÀ cho `SETTINGS_REGISTRY` (1 nguồn duy nhất, không lặp lại literal).

- `welcome_message_template`: `{{userSharePercent}}`, `{{botSharePercent}}`, `{{withdrawalThreshold}}` (đã format sẵn dạng "20.000đ" qua `formatVnd` trước khi truyền vào `renderTemplate`).
- `success_reply_template`: `{{link}}` (affiliate URL) và `{{commissionLine}}` (dòng hoa hồng ước tính — vẫn tính bằng code như hiện tại, ghép vào làm biến truyền vào template, admin không sửa được nội dung dòng này nhưng có thể đổi vị trí/văn phong xung quanh). Toàn bộ nội dung hiện tại của `formatSuccessReply` (phần mở đầu + phần lưu ý cuối) gộp thành **một template duy nhất** thay vì tách rời — đơn giản hơn cho admin khi sửa (nhìn thấy toàn bộ tin nhắn cùng lúc).

`formatWelcomeReply`/`formatSuccessReply` đổi chữ ký: nhận thêm `template: string` làm tham số ĐẦU TIÊN (giá trị lấy từ `ledgerStore.getWelcomeMessageTemplate(WELCOME_MESSAGE_TEMPLATE_DEFAULT)`/`getSuccessReplyTemplate(SUCCESS_REPLY_TEMPLATE_DEFAULT)` tại call site) thay vì tự dùng literal hard-code.

Nếu admin lỡ xoá placeholder khỏi template: chỉ mất phần nội dung tương ứng, không lỗi/crash — chấp nhận được, không validate placeholder tồn tại trong text khi lưu.

## Nơi phải sửa để đọc "động" thay vì giá trị đã đóng băng lúc khởi động

`index.ts` hiện xây 1 object config tĩnh (`{taxPercent, platformFeePercent, userSharePercent, maxCommissionRatioPercent}`) **một lần** rồi truyền references cố định xuống nhiều nơi tái sử dụng cho mọi request về sau. Sửa để các điểm dùng đọc lại từ `ledgerStore` ngay tại thời điểm xử lý:

- **`server.ts`**: `createServer(...)` giữ nguyên tham số `withdrawalThresholdVnd: number` và `orderConfig: RecordOrderConfig` như hiện tại (không đổi signature) — 2 giá trị này giờ mang ý nghĩa **default/fallback** (vẫn từ `env`, `index.ts` không cần đổi lời gọi `createServer(...)`), không phải giá trị cuối cùng dùng trực tiếp:
  - Route `/admin/record-orders/single` và `/admin/record-orders/csv`: build config cho từng request bằng `{ ...orderConfig, userSharePercent: ledgerStore.getUserSharePercent(orderConfig.userSharePercent) }` thay vì dùng thẳng `orderConfig` (các field `taxPercent`/`platformFeePercent`/`maxCommissionRatioPercent` giữ nguyên từ `orderConfig` gốc, ngoài phạm vi).
  - `GET /d/:token` và `POST /d/:token/withdraw`: thay tham số `thresholdVnd` cố định bằng `ledgerStore.getWithdrawalThresholdVnd(withdrawalThresholdVnd)` đọc tại đầu handler.
  - Thêm route mới `GET /admin/settings` (render form từ `SETTINGS_REGISTRY`, giá trị hiện tại đọc qua `ledgerStore.getSetting(entry.key, entry.default)`) + `POST /admin/settings` (validate theo `type`/`min`/`max` của từng entry, lưu qua `ledgerStore.setSetting(entry.key, value)`, redirect 303 về chính nó nếu thành công — theo đúng pattern các route admin khác đã có, vd `/admin/accesstrade-payments`) — theo pattern các route admin khác (`AdminSessionStore` guard, `adminHtml.ts` render).

- **`telegram/bot.ts`** (dòng 29/30/51 dùng `USAGE_TEXT`, dòng 63 gọi `formatSuccessReply`) và **`zalo/bot.ts`** (dòng 162 dùng `USAGE_TEXT`, dòng 182 gọi `formatSuccessReply`, dòng 246 gọi `formatWelcomeReply`): thay `USAGE_TEXT` bằng `ledgerStore.getUsageText(USAGE_TEXT)` đọc tại thời điểm xử lý tin nhắn (default = hằng số `USAGE_TEXT` vẫn export từ `replyText.ts` như hiện tại); `formatSuccessReply(...)` đổi chữ ký nhận thêm `template` → truyền `ledgerStore.getSuccessReplyTemplate(SUCCESS_REPLY_TEMPLATE_DEFAULT)`; `zalo/bot.ts` chỗ gọi `formatWelcomeReply(this.options.commissionUserSharePercent, this.options.withdrawalThresholdVnd)` → giữ nguyên 2 field `commissionUserSharePercent`/`withdrawalThresholdVnd` trong `ZaloGroupBotOptions` (không xoá — 2 giá trị này giờ đóng vai trò **default/fallback** thay vì giá trị cuối cùng), đổi cách dùng thành `formatWelcomeReply(ledgerStore.getWelcomeMessageTemplate(WELCOME_MESSAGE_TEMPLATE_DEFAULT), ledgerStore.getUserSharePercent(this.options.commissionUserSharePercent), ledgerStore.getWithdrawalThresholdVnd(this.options.withdrawalThresholdVnd))` ngay tại thời điểm gửi DM chào mừng. `index.ts` không cần đổi gì ở lời gọi `createZaloGroupBot` (vẫn truyền 2 field như cũ, nay mang ý nghĩa "default").

- **`index.ts`** (`runAccesstradeSync`): build `recordOrderConfig` (biến cục bộ trong hàm, thay vì object tĩnh ngoài hàm như hiện tại) với `userSharePercent: ledgerStore.getUserSharePercent(env.commission.userSharePercent)` ngay trong hàm (mỗi lần hàm này chạy — 1 lần/ngày — sẽ tự lấy giá trị mới nhất, không cần thay đổi cơ chế lịch chạy).

- **`scripts/ledgerAdmin.ts`** (CLI ghi tay/sync thủ công): tương tự, đọc `ledgerStore.getUserSharePercent(env.commission.userSharePercent)` thay vì thẳng `env.commission.userSharePercent` khi build `orderConfig`, tại các lệnh liên quan (`record-conversion`, `record-conversions-csv`, `sync-accesstrade`).

## Admin UI

Thêm mục "Cấu hình" vào sidebar (`adminShell` trong `adminHtml.ts`), route `/admin/settings`:

- Input số: `%` hoa hồng user nhận (0–100), Ngưỡng rút tiền tối thiểu (VNĐ, > 0).
- 3 textarea: Usage text, Welcome message, Success reply — mỗi ô có dòng ghi chú nhỏ liệt kê placeholder hợp lệ ngay bên dưới.
- Nút Lưu, POST tới `/admin/settings`. Validate theo `type`/`min`/`max` của từng entry trong `SETTINGS_REGISTRY` (số phải trong khoảng, text không rỗng sau khi trim) — sai thì redisplay form (giữ nguyên các giá trị vừa nhập) kèm banner lỗi liệt kê tất cả field sai (pattern giống `renderRecordOrdersPage`). Đúng thì lưu qua `ledgerStore.setSetting(entry.key, value)` cho từng entry rồi redirect 303 về `/admin/settings` (không cần banner thành công riêng — giá trị mới đã tự hiện trong form, giống pattern `/admin/accesstrade-payments`).
- Không cần xác nhận 2 lần (`confirmOnSubmit`) — đây không phải hành động phá huỷ, sửa lại được ngay.

**Render form từ 1 danh sách khai báo field, không viết tay markup từng field** (phục vụ nguyên tắc mở rộng rẻ bên dưới): `renderSettingsPage` lặp qua `SETTINGS_REGISTRY` (`{key, label, type: "number" | "textarea", default, helpText?, min?, max?}`) để sinh `<div><label>...<input type="number">/<textarea>...</div>` — thêm 1 setting mới về sau chỉ cần thêm 1 phần tử vào mảng này, không phải viết thêm HTML tay. Route handler `POST /admin/settings` đọc/validate/lưu cũng lặp qua cùng danh sách này (đọc `req.body[key]`, validate theo `type`, gọi `ledgerStore.setSetting(key, value)`) thay vì if/else riêng từng field.

## Testing

- Unit test `LedgerStore`: `getSetting`/`setSetting` (chưa có override → trả default; đã set → trả giá trị mới; upsert ghi đè đúng), các typed getter/setter tương ứng.
- Unit test `renderTemplate` trong `replyText.ts`: thay đúng placeholder có trong `vars`, giữ nguyên placeholder không khớp, không throw.
- Unit test `formatWelcomeReply`/`formatSuccessReply` sau khi đổi chữ ký (nhận `template` làm tham số) — vẫn ra đúng nội dung khi dùng template mặc định (không regress test cũ), và ra đúng khi dùng template tuỳ chỉnh có placeholder.
- Test route `/admin/settings` (nếu `server.ts` đã có test harness sẵn — theo dõi pattern test hiện có cho các route admin khác trong `__tests__`).
- Kiểm tra thủ công qua trình duyệt: đổi `%`/ngưỡng/text trên `/admin/settings`, gửi link demo qua bot (hoặc gọi `POST /api/v1/resolve`) và xác nhận tin nhắn phản ánh đúng giá trị mới — không cần restart server.

## Nguyên tắc mở rộng cho tương lai (thêm setting mới sau này)

Không build thêm setting nào ngoài 5 cái đã chốt ở đợt này, nhưng cơ chế phải để việc **thêm 1 setting mới sau này** (khi có khách thuê yêu cầu cụ thể) chỉ gồm các bước nhỏ, không cần thiết kế lại:

1. Thêm 1 key mới vào `SETTINGS_KEYS` (`src/core/settingsKeys.ts`) và 1 entry tương ứng vào `SETTINGS_REGISTRY` (key, label, type, default, helpText, min/max nếu là số).
2. Nếu cần typed getter riêng cho code nghiệp vụ (không bắt buộc — có thể dùng thẳng `ledgerStore.getSetting(key, default)`/`getSettingInt(key, default)` generic ngay tại call site): thêm 1 cặp hàm 2 dòng (`getXxx(defaultValue)`/`setXxx(value)`) trong `LedgerStore`.
3. Thay chỗ đang đọc `env.xxx` cứng bằng lời gọi getter tương ứng (kèm default vẫn lấy từ `env.xxx` hoặc hằng số có sẵn) tại đúng call site đang dùng giá trị đó.

Trang `/admin/settings` **tự động** hiện field mới vì render từ `SETTINGS_REGISTRY` (không phải sửa `adminHtml.ts` thủ công cho từng field). Đây là lý do chọn "1 bảng key-value generic + 1 registry khai báo" thay vì mỗi setting là 1 cột riêng trong bảng SQL hay 1 route/form riêng — phương án sau tuy tường minh hơn nhưng mỗi setting mới lại phải sửa schema + route + admin UI, đúng thứ user muốn tránh.

**Không làm ở đợt này (out of scope, chỉ ghi nhận định hướng)**: multi-tenant thật sự (nhiều khách thuê dùng chung 1 lần deploy, mỗi khách 1 bộ setting/DB riêng) sẽ cần thêm khái niệm "tenant_id" vào mọi bảng — đây là thay đổi kiến trúc lớn hơn hẳn, chưa có tín hiệu nhu cầu cụ thể để thiết kế ngay. Hiện tại mô hình vẫn là **1 lần deploy = 1 khách** (mỗi khách thuê có deploy/`.env`/DB riêng), "cấu hình qua admin" ở đây chỉ giải quyết việc khách thuê (hoặc chủ bot thay mặt họ) tự đổi được giá trị mà không cần sửa code — không phải chạy chung hạ tầng nhiều khách.

## Rủi ro / lưu ý

- `zca-js` welcome DM đọc `ledgerStore` tại thời điểm gửi (không phải lúc khởi động `zaloBot`) — cần đảm bảo `ledgerStore` instance đã sẵn sàng trước khi handler chạy (vốn đã đúng vì `ledgerStore` được tạo trước khi `createZaloGroupBot` trong `index.ts`).
- Không thêm cơ chế cache cho các giá trị đọc từ `settings` — mỗi lần dùng query SQLite trực tiếp (đọc 1 dòng theo primary key, chi phí không đáng kể, nhất quán với cách `LedgerStore` đang xử lý các query khác).
