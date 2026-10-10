# Settings admin & template tin nhắn bot

> Đọc khi thêm/sửa setting ở `/admin/settings`, sửa nội dung tin nhắn bot, hoặc đổi default của template/FAQ trong code.

## Cái bẫy chung: DB đè lên default trong code

- **Đổi default của template/FAQ trong code KHÔNG lan tới instance đã tuỳ chỉnh (quy tắc chung, 2026-09-29)**: mọi giá trị trong `SETTINGS_REGISTRY` (`usageText`, các `faq_answer_*`, mọi template tin nhắn) nếu instance đã từng bấm Lưu ở `/admin/settings` thì **giá trị trong DB đè lên default trong code**. Sửa default rồi deploy là chưa xong — phải vào `/admin/settings` của **từng instance** sửa tay. Đây là lý do sau đợt bỏ TikTok Shop (2026-09-29), bot trên instance cũ vẫn có thể nói "Shopee và TikTok Shop" dù code đã sạch.

- **Giam don to + nợ hoàn trả (2026-10-08)**: 2 template mới `payoutDebtNoticeTemplate` / `withdrawalCancelledTemplate` có default trong code, nhưng instance nào đã bấm Lưu ở `/admin/settings` sẽ **không tự nhận** — đây là cái bẫy chung của mọi template. Hai câu trong default là **ràng buộc về niềm tin, không phải văn phong, có test chặn**: *"không phải chuyển tiền lại"* (nhận tin "bạn đang nợ 40.000đ" mà thiếu câu đó thì user tưởng phải trả tiền ra ngoài) và *"tiền vẫn nằm nguyên trong số dư"* (`cancelWithdrawal` thả entry về `confirmed` nên tiền thật sự còn nguyên; không nói ra thì user đọc "yêu cầu bị huỷ" thành "mất tiền").

- **Link "Sổ tay hoàn tiền" trong tin nhắn bot (2026-09-28)**: 2 template `GROUP_JOIN_WELCOME_TEMPLATE_DEFAULT` và `GROUP_JOIN_BLOCKED_REPLY_TEMPLATE_DEFAULT` không còn hardcode link Google Docs nữa mà dùng placeholder `{{handbookUrl}}`, do `zalo/bot.ts` điền qua `handbookUrl()` = `${dashboardBaseUrl}/so-tay` — mỗi instance tự ra domain của nó (xem mục "Triển khai nhiều chủ bot"). **CẢNH BÁO vận hành**: instance nào đã từng bấm Lưu ở `/admin/settings` thì giá trị trong DB **đè** lên default trong code, nên sau khi deploy vẫn còn link Google Docs cũ — phải vào sửa tay 2 ô đó. Đây là cái bẫy chung của mọi template: đổi default trong code KHÔNG tự lan tới instance đã tuỳ chỉnh.

## Nội dung tin nhắn trả về link

**Sửa nội dung tin nhắn trả về link**: sửa `formatSuccessReply` trong `src/adapters/shared/replyText.ts` (dùng chung cho cả Telegram và Zalo, sửa 1 chỗ áp dụng cả 2). **2026-08-17: đã bỏ nhãn "Shopee 22%" cố định** (từng có trong `MERCHANT_LABELS`, xoá vì mâu thuẫn với hướng minh bạch mới — xem mục cashback bên dưới) — chỉ dùng tên thương hiệu thuần (`getMerchantConfig(merchant).displayName`). Nguyên tắc chung vẫn giữ: **không bịa % giảm giá/hoa hồng theo từng sản phẩm** trừ khi có nguồn dữ liệu xác thực (API chính thức, hoặc số cấu hình tĩnh chủ bot tự đặt và ghi rõ là ước tính).

- **Tin nhắn trả link CÓ hiển thị số tiền ước tính (2026-10-01) — đảo ngược quyết định 2026-08-17.** Lý do đảo: quyết định cũ dựa trên tiền đề "muốn có số thì phải tự scrape giá từ trang Shopee" (vi phạm mục (e)); tiền đề đó không còn đúng khi có nguồn dữ liệu bên thứ ba trả sẵn cả giá lẫn hoa hồng đã áp trần (xem `commissionLookup.ts`). Câu hoa hồng trong template là **MỘT SLOT hai trạng thái** qua placeholder `{{commissionLine}}`: tra được → báo số tiền user THỰC NHẬN (đã qua `computeCommissionBreakdown`, tức đã trừ thuế/phí sàn/chia %); không tra được (tắt tính năng, link không có item_id, nguồn lỗi/timeout, ngành hàng hoa hồng 0) → câu hẹn báo sau khi Shopee xác nhận, đúng như trước.

**Không bao giờ hiện cả hai** — nói "em chưa báo số liền được" cạnh một con số cụ thể là tự mâu thuẫn trước mặt user. Vẫn giữ nguyên tắc cũ: **không hứa chắc**, luôn có chữ "ước tính" và nói rõ số chốt theo giá thực trả.

**Bẫy vận hành**: commit 5f86f18 (2026-09-30) từng gộp câu hoa hồng THẲNG vào template và bỏ placeholder (lúc đó đúng, vì nhánh ước tính là code chết); instance nào đã bấm Lưu ở `/admin/settings` trong khoảng 30/09-01/10 đang giữ template KHÔNG CÓ `{{commissionLine}}` trong DB, mà DB đè lên default trong code → **phải vào sửa tay, nếu không sẽ không bao giờ thấy số ước tính dù đã bật tính năng**. Có test chặn việc gộp thẳng vào template lần nữa.

## replyText.ts

**shared/replyText.ts** — template tin nhan DUNG CHUNG giua Telegram va Zalo (USAGE_TEXT, formatSuccessReply/Error/Skipped/PromotionsReply, formatDashboardLinkReply, formatOrdersConfirmedReply, formatWelcomeReply, formatGroupJoinWelcomeReply) — sua text/nhan hien thi tai day, khong sua rieng tung adapter. formatSuccessReply KHONG hua so tien/% hoa hong cu the (xem T2.1-T2.4) — tu 2026-09-30 ham nay chi con nhan (template, affiliateUrl): nhanh "hoa hong uoc tinh" theo `commissionEstimate` da bi go vi Shopee (merchant duy nhat con lai) khong bao gio tra ve gia tri nay, va cau giai thich "hoa hong chot sau khi Shopee xac nhan don" da duoc GOP THANG vao `SUCCESS_REPLY_TEMPLATE_DEFAULT` de admin sua duoc ngay tren `/admin/settings`. Placeholder `{{commissionLine}}` VAN duoc render (tro ve dung cau do) nhung la LEGACY: chi de template cu da luu trong DB cua instance khong nhan nguyen van "{{commissionLine}}" cho khach — dung xoa cho den khi chac moi instance da luu lai template moi. formatOrdersConfirmedReply (2026-08-20) dung boi ca ledgerAdmin.ts lan server.ts (/admin/record-orders/*) de bao user don moi duoc xac nhan. formatWelcomeReply (2026-09-07: them tham so dashboardUrl, hien THANG link dashboard thay vi chi huong dan nhan "xemhh") dung khi user gui link san pham DAU TIEN; formatGroupJoinWelcomeReply (moi 2026-09-07; tu 2026-09-28 nhan them handbookUrl qua placeholder {{handbookUrl}}) dung NGAY LUC user vua duoc ADD vao group — 2 template khac nhau cho 2 trigger khac nhau, xem zalo/bot.ts.

## settingsKeys.ts

**src/core/settingsKeys.ts** — (2026-08-21) hang so ten key cua 6 setting admin sua duoc qua /admin/settings (vd userSharePercent, withdrawalThresholdVnd, usageText, groupJoinWelcomeTemplate them 2026-09-07...) — file zero dependency, dung chung boi ca ledgerStore.ts (core) lan settingsRegistry.ts (config), tranh hardcode string key rai rac.

## settingsRegistry.ts

**src/config/settingsRegistry.ts** — (2026-08-21) mang SETTINGS_REGISTRY khai bao label/type/default/helpText/min/max cho tung setting — noi DUY NHAT can sua khi them 1 setting moi (route /admin/settings tu dong render form + validate theo registry nay, khong phai sua adminHtml.ts thu cong). Xem "Nguyen tac mo rong" trong docs/superpowers/specs/2026-08-21-admin-settings-menu-design.md.

## textNormalize.ts

**src/core/textNormalize.ts** — (2026-09-10) normalizeNewlines() — chuan hoa CRLF/CR ve LF. Trinh duyet nop <textarea> cua /admin/settings len dang CRLF theo dung chuan HTML; truoc day luu nguyen xi vao bang settings, roi Zalo desktop (Chromium, white-space: pre-wrap) dem "\r" va "\n" la 2 lan xuong dong RIENG BIET -> moi dong trong trong template bi nhan doi, tin nhan bot gian ra rat xa (bug that quan sat tren instance "sanhoantien" 2026-09-10; instance khac chua tung sua template qua web nen van dung default "\n" trong replyText.ts va hien binh thuong - do la ly do 2 instance CUNG CODE lai hien khac nhau). Goi o CA 2 phia CO CHU DICH: POST /admin/settings (chan tu goc) va LedgerStore.getSetting (READ path - de gia tri DA luu sai trong DB that tu khoi luc deploy, khong bat admin sua/luu lai tung template). Dung bo loi goi trong getSetting khi refactor.
