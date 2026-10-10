# Quyết định sản phẩm & nghiệp vụ (đã chốt)

> Nền tảng, tỷ lệ chia hoa hồng, nguồn affiliate, các hướng đã bị từ chối. Đọc trước khi đề xuất đổi mô hình, đổi % hoa hồng, đổi nguồn affiliate hay đổi cách nhận diện merchant.

## Tổng quan + mô hình chia hoa hồng

Bot nhận link sản phẩm Shopee qua Telegram và Zalo (tự động hoá 1 tài khoản Zalo cá nhân qua thư viện không chính thức `zca-js` — **không phải Zalo OA**, quyết định đã chốt, đừng đề xuất quay lại Zalo OA trừ khi user chủ động nhắc lại), tự động nhận diện merchant theo domain trong link, gắn affiliate ID, trả về short link. Hoa hồng phát sinh **được chia sẻ 20% chủ bot / 80% user** (mô hình cashback, quyết định 2026-08-17 đảo ngược ý định ban đầu là giữ 100% hoa hồng; tỷ lệ đã đổi 3 lần: 20/80 → 10/90 ngày 2026-08-19 → **quay lại 20/80 ngày 2026-10-01**. `COMMISSION_USER_SHARE_PERCENT` trong `.env` — từ 2026-08-21 `.env` chỉ còn là giá trị khởi tạo/fallback, admin đổi được ngay tại runtime qua `/admin/settings` không cần restart, xem mục `settings` trong `ledgerStore.ts` bên dưới.

**Tỉ lệ được CHỐT theo từng đơn tại thời điểm ghi nhận (2026-10-01, đảo ngược hành vi trước đó)**: 3 cột `tax_percent`/`platform_fee_percent`/`user_share_percent` trong `commission_entries` ghi 1 lần ở `recordConversion`, và `updatePendingEntry`/`confirmPendingEntry` tính lại tiền bằng CHÍNH 3 số đó qua `effectivePercents()` — đổi % trên `/admin/settings` **không** còn áp dụng ngược cho đơn `pending` nữa (đơn pending là đơn user ĐÃ MUA, chỉ chờ Shopee duyệt; hạ % hôm nay mà hạ tiền của đơn mua từ tuần trước là sai với user). Trước đó mỗi lần import báo cáo lại tính lại theo % hiện hành. Entry ghi trước 2026-10-01 có 3 cột = `NULL`: **không suy ngược TỰ ĐỘNG được** (tỉ lệ thật lúc đó không còn lưu ở đâu, và suy ngược từ số tiền thì sai khi hoa hồng nhỏ — thuế 10% của 7đ làm tròn còn 1đ, suy ngược ra 14%), nên lần tính lại đầu tiên sau deploy sẽ lùi về % hiện hành **và chốt luôn** từ lần đó.

**2026-10-09: đã backfill được, nhờ user cung cấp thẳng tỉ lệ** (`backfillLegacyRatePercents()` trong `ledgerStore.ts`, chạy lúc khởi động store — xem `LEGACY_RATE_PERCENTS` = thuế 10% / phí sàn 1% / user 90%, là mốc 10/90 có hiệu lực 19/08–01/10/2026). Không mâu thuẫn với câu trên: tỉ lệ do NGƯỜI cung cấp, số tiền đã lưu chỉ dùng để **xác minh** chứ không dùng để suy ra.

**CHỈ ghi khi `computeCommissionBreakdown` tính lại ra ĐÚNG TỪNG ĐỒNG của cả 4 cột tiền đã lưu** (quyết định của user: đơn nào không khớp thì để nguyên `NULL` + log cảnh báo kèm mã đơn, chứ không gắn nhãn một tỉ lệ có thể sai lên đơn tiền thật — đơn thời 20/80 trước 19/08 nếu còn sót sẽ nói 80%). Tuyệt đối không đụng tới cột tiền nào: chỉ ghi nhận tỉ lệ đã dùng. Tự nhiên là một lần duy nhất (`WHERE user_share_percent IS NULL`) vì đơn mới luôn ghi sẵn 3 cột — **đừng đổi điều kiện đó thành lọc theo ngày**. Hệ quả đã được user chấp nhận: gõ sai % rồi import thì các đơn đó giữ tỉ lệ sai vĩnh viễn, sửa lại setting không chữa được. Trang `/so-tay` + `helpText` của `userSharePercent` đã đổi theo, nói "chốt khi đơn **được ghi nhận**" — **có test chặn ở cả 2 nơi**, đừng đảo lại thành "khi đơn hoàn thành" (câu đó đúng cho hành vi CŨ, đã bị thay)) — **`.claude/rules/` là nguồn duy nhất cho chi tiết implementation/kiến trúc/quyết định kỹ thuật** (`CLAUDE.md` chỉ còn là bản đồ + luật chung). Rủi ro kỹ thuật đã biết xem `rui-ro-can-giai-quyet.md`; việc còn tồn đọng xem `product-backlog.md`.

**2026-10-01: đã xoá toàn bộ tài liệu vận hành/đặc tả dạng `.md` khác** (`huong-dan-van-hanh-admin.md`, `huong-dan-nguoi-dung.md`, `huong-dan-van-hanh-cho-doi-tac.md`, `huong-dan-deploy-instance-moi.md`, `nguon-kien-thuc-shopee-affiliate-portal.md`, `danh-sach-tinh-nang.md`, `SRS.md`) — chúng chưa từng được commit nên không khôi phục được, **đừng đi tìm**. Tài liệu hướng tới user giờ là trang `/so-tay` tự host (xem `handbookHtml.ts`).

## Nguồn affiliate Shopee

**Nguồn affiliate Shopee — ĐÃ CHỐT (cập nhật 2026-08-19), KHÔNG còn "chưa chốt" nữa**: Shopee từng từ chối cấp Open API (`app_id`/`secret_key`) cho tài khoản KOC cá nhân (2026-08-17, kết luận cuối, đừng hỏi lại Shopee về việc này) — nhưng sau đó tìm được + verify xong hướng KHÔNG cần Open API: cơ chế `an_redir` chính thức của Shopee, chỉ cần `affiliate_id` cố định của tài khoản (không phải bí mật, lấy tại `affiliate.shopee.vn/account_setting`, không cần xin cấp riêng). **Đã implement**: `ShopeeAffiliateProvider` (`src/core/providers/shopeeAffiliateProvider.ts`, T3.1) tự build `https://s.shopee.vn/an_redir?origin_link=...&affiliate_id=...&sub_id=...` — xem chi tiết trong skill `tich-hop-affiliate-provider`. `AFFILIATE_PROVIDER=shopee_direct` dùng provider này. **Từ 2026-09-29 đây là nguồn affiliate duy nhất**: TikTok Shop và Lazada đã bị bỏ khỏi scope, kéo theo toàn bộ đường Accesstrade (provider, đồng bộ đơn tự động, bảng `accesstrade_payments`) bị gỡ khỏi codebase — đừng tìm lại `AccesstradeProvider`/`accesstradeSync.ts`, chúng không còn tồn tại.

## Mã giảm giá chung (mặc định TẮT)

**Mã giảm giá chung (`getPromotions`/`formatPromotionsReply`) mặc định TẮT** (`PROMOTIONS_DISPLAY_LIMIT=0`, quyết định 2026-08-17) — trọng tâm sản phẩm giờ là cashback, không phải tra mã giảm giá. Code giữ nguyên, bật lại được qua `.env` nếu cần, không phải xoá.

## Nhận diện merchant theo domain

**Merchant được chọn theo domain trong link, không theo room/group Telegram** — quyết định đã chốt (xem lịch sử trao đổi): đơn giản hơn room-based (không cần bảng mapping room↔merchant). Đừng tự ý đổi sang room-based routing trừ khi user yêu cầu lại.

## Zalo Group Adapter dùng API không chính thức

**Zalo Group Adapter dùng API không chính thức, có rủi ro khoá tài khoản** — quyết định đã được user chấp nhận (dùng tài khoản phụ/throwaway, không dùng tài khoản chính). Đừng "sửa" sang Zalo OA chính thức để "an toàn hơn" — đó là hướng đã bị từ chối.
