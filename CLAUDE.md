# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Bot nhận link sản phẩm (Shopee, Lazada) qua Telegram và Zalo (tự động hoá 1 tài khoản Zalo cá nhân qua thư viện không chính thức `zca-js` — **không phải Zalo OA**, quyết định đã chốt, đừng đề xuất quay lại Zalo OA trừ khi user chủ động nhắc lại), tự động nhận diện merchant theo domain trong link, gắn affiliate ID, trả về short link. Hoa hồng phát sinh **được chia sẻ 20% chủ bot / 80% user** (mô hình cashback, quyết định 2026-08-17 đảo ngược ý định ban đầu là giữ 100% hoa hồng) — chi tiết đầy đủ về mục tiêu sản phẩm, ticket, trạng thái từng phần nằm ở `spec_bot_ap_ma_shopee.md` (đã viết lại toàn bộ 2026-08-17, đọc file đó trước khi lên kế hoạch làm việc mới — đừng suy luận trạng thái dự án từ CLAUDE.md một mình, 2 file bổ sung cho nhau: CLAUDE.md = chi tiết implementation, spec = mục tiêu/trạng thái/quyết định).

**Nguồn affiliate Shopee — ĐÃ CHỐT (cập nhật 2026-08-19), KHÔNG còn "chưa chốt" nữa**: Shopee từng từ chối cấp Open API (`app_id`/`secret_key`) cho tài khoản KOC cá nhân (2026-08-17, kết luận cuối, đừng hỏi lại Shopee về việc này) — nhưng sau đó tìm được + verify xong hướng KHÔNG cần Open API: cơ chế `an_redir` chính thức của Shopee, chỉ cần `affiliate_id` cố định của tài khoản (không phải bí mật, lấy tại `affiliate.shopee.vn/account_setting`, không cần xin cấp riêng). **Đã implement**: `ShopeeAffiliateProvider` (`src/core/providers/shopeeAffiliateProvider.ts`, T3.1) tự build `https://s.shopee.vn/an_redir?origin_link=...&affiliate_id=...&sub_id=...` — xem chi tiết mục "Thêm nguồn affiliate mới" bên dưới và `spec_bot_ap_ma_shopee.md` mục 5/T3.1 để biết đầy đủ bối cảnh/cách verify. `AFFILIATE_PROVIDER=shopee_direct` (mới, thứ 3 sau `mock`/`accesstrade`) dùng provider này cho Shopee, còn Lazada/TikTok Shop vẫn qua `AccesstradeProvider` như cũ (`CompositeAffiliateProvider` định tuyến theo merchant, xem `src/core/providers/index.ts`). `AccesstradeProvider` vẫn giữ nguyên, không xoá — vẫn là provider chính cho Lazada/TikTok Shop.

**Mã giảm giá chung (`getPromotions`/`formatPromotionsReply`) mặc định TẮT** (`PROMOTIONS_DISPLAY_LIMIT=0`, quyết định 2026-08-17) — trọng tâm sản phẩm giờ là cashback, không phải tra mã giảm giá. Code giữ nguyên, bật lại được qua `.env` nếu cần, không phải xoá.

**Merchant được chọn theo domain trong link, không theo room/group Telegram** — quyết định đã chốt (xem lịch sử trao đổi): đơn giản hơn room-based (không cần bảng mapping room↔merchant). Đừng tự ý đổi sang room-based routing trừ khi user yêu cầu lại.

**Zalo Group Adapter dùng API không chính thức, có rủi ro khoá tài khoản** — quyết định đã được user chấp nhận (dùng tài khoản phụ/throwaway, không dùng tài khoản chính). Đừng "sửa" sang Zalo OA chính thức để "an toàn hơn" — đó là hướng đã bị từ chối.

## Commands

```bash
npm install
cp .env.example .env       # dien TELEGRAM_BOT_TOKEN / ACCESSTRADE_API_KEY / campaign_id tung merchant khi co

npm run dev                # chay dev voi tsx watch
npm run build               # bien dich sang dist/
npm start                    # chay production tu dist/ (can build truoc)
npm run typecheck            # tsc --noEmit
npm test                     # chay toan bo unit test (node:test qua tsx)
```

Chạy một test file cụ thể:

```bash
npx tsx --test src/core/__tests__/linkValidator.test.ts
```

Không có bước lint riêng (chưa cấu hình ESLint/Prettier).

## Architecture

Thiết kế **core logic dùng chung + adapter mỏng theo platform**, để mở rộng sang platform chat khác hoặc merchant khác không phải viết lại logic nghiệp vụ.

```
src/core/                    Core Service — khong biet gi ve Telegram/HTTP
  merchants.ts                registry nhan dien merchant theo domain (Shopee, Lazada, TikTok Shop) — THEM MERCHANT MOI TAI DAY
  linkValidator.ts            validate URL, nhan dien merchant, tach shop_id/item_id (Shopee) hoac product_id (TikTok Shop - BAT BUOC, khong phai optional, xem NotAProductLinkError), resolve short-link redirect
  affiliateProvider.ts        interface AffiliateProvider (createAffiliateLink + getPromotions, ca 2 deu nhan merchant; createAffiliateLink co them shopId/itemId optional cho case nhu Shopee/TikTok Shop) — diem noi de doi/them nguon affiliate khac Accesstrade
  providers/
    accesstradeProvider.ts    tich hop that voi Accesstrade API, config campaign_id/promotions-merchant RIENG TUNG MERCHANT — xem chi tiet ben duoi
    shopeeAffiliateProvider.ts  Shopee qua co che an_redir truc tiep (khong qua Accesstrade, khong can Open API), T3.1 — xem chi tiet ben duoi
    compositeProvider.ts      dinh tuyen 1 AffiliateProvider khac nhau THEO TUNG MERCHANT (vd Shopee -> shopeeAffiliateProvider, Lazada/TikTok Shop -> accesstradeProvider) - dung khi AFFILIATE_PROVIDER=shopee_direct
    mockProvider.ts           gia lap, dung khi AFFILIATE_PROVIDER=mock (mac dinh, khong can credentials), co du lieu mau rieng tung merchant
    index.ts                  factory chon provider theo env AFFILIATE_PROVIDER ("mock" | "accesstrade" | "shopee_direct")
  linkResolverService.ts      dieu phoi: rate limit -> parseProductLink (xac dinh merchant) -> goi provider theo merchant -> log (kem merchant) -> tra ket qua/loi
  rateLimiter.ts               sliding-window trong bo nho, key theo "platform:userId"
  logStore.ts                  SQLite qua node:sqlite (built-in Node 22+, KHONG dung better-sqlite3 hay lib ngoai). Co cot merchant + tu migrate (ALTER TABLE) cho DB tao truoc khi co field nay. findBySubId() dung boi ledgerAdmin.ts.
  ledgerStore.ts                SQLite rieng (DATABASE khac logStore, xem env.ledgerDatabasePath) cho ledger chia se hoa hong (T2.1-T2.4): commission_entries (co productName tuy chon), withdrawal_requests, dashboard_tokens. requestWithdrawal() dong bo trong 1 method (khong await xen giua) de chong rut trung. Them cot moi luon phai them migration (xem migrateAddTaxColumns) - DB that tren may da tung tao truoc khi co cot moi se loi "no such column" neu quen.
  errors.ts                    AppError va cac subclass — moi loi co userMessage tieng Viet an toan de hien thi truc tiep cho user

src/api/server.ts             Express: POST /api/v1/resolve, GET /api/v1/logs (loc duoc theo platform va merchant), GET /health, GET /d/:token + POST /d/:token/withdraw (dashboard ca nhan + rut tien, T2.3-T2.4)
src/api/dashboardHtml.ts      Render HTML tay (khong templating lib, giong triet ly cua replyText.ts) cho trang dashboard ca nhan
src/scripts/ledgerAdmin.ts    Script chay tay (npx tsx ...) ghi nhan don hang/hoa hong thu cong - GIAI PHAP TAM thay T2.1 tu dong hoa, doc comment dau file truoc khi dung. record-conversions-csv (2026-08-18): nhap hang loat tu file CSV (quy trinh hang tuan, xem quy-trinh-van-hanh-cashback.md), khong crash ca batch neu 1 dong loi (in ket qua tung dong + tong ket). File mau: src/scripts/templates/weekly-conversions.example.csv
src/scripts/csv.ts            Parser CSV toi gian (khong dung lib ngoai), rieng cho record-conversions-csv
src/adapters/
  shared/replyText.ts          template tin nhan DUNG CHUNG giua Telegram va Zalo (USAGE_TEXT, formatSuccessReply/Error/Skipped/PromotionsReply, formatDashboardLinkReply) — sua text/nhan hien thi tai day, khong sua rieng tung adapter. formatSuccessReply KHONG hua so tien/% hoa hong cu the (xem T2.1-T2.4).
  telegram/bot.ts               Telegraf, long polling (khong dung webhook). 1 tin nhan co the chua link nhieu merchant khac nhau — moi merchant duoc reply rieng. Lenh "idid" (DM only) tra ve link dashboard. Khuyen mai (getPromotions) mac dinh TAT (PROMOTIONS_DISPLAY_LIMIT=0), xem code van con neu can bat lai.
  zalo/
    bot.ts                      dieu khien 1 TAI KHOAN ZALO CA NHAN qua thu vien khong chinh thuc `zca-js` (mo phong Zalo Web) — KHONG phai Zalo OA. Trong GROUP: xu ly link giong het Telegram adapter (dung chung replyText.ts). Trong DM: CHI phan hoi dung lenh "idid" (tra link dashboard) — moi noi dung khac IM LANG hoan toan, khong tu xu ly link/rep ly gi ca, de admin tu vao tra loi thu cong (quyet dinh 2026-08-17, tranh lo link dashboard ca nhan neu lo tra loi nham trong group). Day la diem KHAC BIET voi Telegram adapter, dung nham lan.
    session.ts                  luu/doc credentials (cookie/imei/userAgent) vao file JSON de khong phai quet QR lai moi lan restart
src/config/env.ts             doc + validate bien moi truong. Config Accesstrade theo merchant duoc suy ra tu MERCHANTS registry (ACCESSTRADE_CAMPAIGN_ID_<MERCHANT>, ACCESSTRADE_PROMOTIONS_MERCHANT_<MERCHANT>) — them merchant vao merchants.ts la du, khong can sua env.ts. Zalo Group Adapter mac dinh TAT (ZALO_GROUP_ENABLED=false).
src/index.ts                  wiring: tao LogStore/RateLimiter/Provider/Resolver mot lan, gan vao Express server + Telegram bot + Zalo bot (neu bat), graceful shutdown
```

Luồng xử lý 1 request (dù vào từ HTTP hay Telegram) luôn đi qua `LinkResolverService.resolve()`:
`rate limit check → parseProductLink (validate + nhận diện merchant theo domain + resolve short-link redirect + extract shop_id/item_id nếu có pattern) → generate subId → provider.createAffiliateLink({merchant, ...}) → logStore.record() (kèm merchant) → trả ResolveLinkResult hoặc AppError`.

Mỗi request sinh một `subId` riêng (`{platform}-{userId}-{timestamp36}-{random}`) gắn vào affiliate link, dùng để đối soát hoa hồng sau này qua báo cáo của nguồn affiliate đang dùng — đây là lý do mọi log request đều lưu `subId`, và cũng là lý do `ledgerAdmin.ts` tra ngược `subId` → user qua `logStore.findBySubId()` khi ghi nhận đơn hàng thủ công.

### Nguyên tắc khi sửa code

- **Không phá vỡ ranh giới core/adapter**: `src/core/**` không được import bất cứ gì từ `express`, `telegraf`, hay biết về platform cụ thể. Logic nghiệp vụ mới luôn vào `src/core`, không vào adapter.
- **Adapter chỉ format I/O**: `src/adapters/*` và `src/api/server.ts` chỉ gọi `LinkResolverService`, bắt `AppError` để lấy `userMessage` hiển thị cho user — không tự implement lại validate/rate-limit/log.
- **Thêm merchant mới** (ví dụ Tiki): thêm 1 entry vào `MERCHANTS` trong `src/core/merchants.ts` (domain pattern + short-host nếu có) — `env.ts`, log, Telegram adapter đều tự động hỗ trợ merchant mới qua registry này, KHÔNG cần sửa. Nếu merchant có pattern URL chứa shop_id/item_id, thêm case trong `extractIds()` (`linkValidator.ts`) — mặc định trả `null` cho merchant chưa có pattern xác minh, **không đoán mò regex** (rủi ro sai âm thầm vì đây chỉ là metadata optional). **Ngoại lệ quan trọng — không phải merchant nào cũng chỉ cần đăng ký registry**: nếu network affiliate dùng endpoint/field HOÀN TOÀN KHÁC cho merchant đó (như TikTok Shop qua Accesstrade, xem ngay dưới), phải sửa thêm `AccesstradeProvider.createAffiliateLink` (branch theo `input.merchant`) và có thể cả `extractIds()`/`buildParsedLink()` nếu id tách được không còn là optional metadata mà là bắt buộc để gọi API — xem TikTok Shop làm ví dụ mẫu cho case này.
- **Sửa nội dung tin nhắn trả về link**: sửa `formatSuccessReply` trong `src/adapters/shared/replyText.ts` (dùng chung cho cả Telegram và Zalo, sửa 1 chỗ áp dụng cả 2). **2026-08-17: đã bỏ nhãn "Shopee 22%" cố định** (từng có trong `MERCHANT_LABELS`, xoá vì mâu thuẫn với hướng minh bạch mới — xem mục cashback bên dưới) — chỉ dùng tên thương hiệu thuần (`getMerchantConfig(merchant).displayName`). Nguyên tắc chung vẫn giữ: **không bịa % giảm giá/hoa hồng theo từng sản phẩm** trừ khi có nguồn dữ liệu xác thực (API chính thức, hoặc số cấu hình tĩnh chủ bot tự đặt và ghi rõ là ước tính).
- **Tin nhắn trả link hiện tại KHÔNG hứa hẹn số tiền/% hoa hồng cụ thể** (2026-08-17, tham khảo cách trình bày của 1 bot đối thủ rồi chỉnh lại chứ không copy nguyên) — chỉ nói rõ đơn cần thời gian để hệ thống affiliate xác nhận, hướng dẫn user nhắn `"idid"` để theo dõi. Đây là quyết định có chủ đích: hiển thị số ước tính đòi hỏi biết giá sản phẩm, mà tự động lấy giá từ trang Shopee vi phạm chính sách chống gian lận mục (e) (xem lịch sử trao đổi) — đừng tự ý thêm lại số ước tính (đ hay %) mà không nhắc lại rủi ro này với user trước.
- **Thêm nguồn affiliate mới** (khác Accesstrade): implement interface `AffiliateProvider` (`src/core/affiliateProvider.ts`), đăng ký trong `src/core/providers/index.ts` theo `env.affiliateProvider`.
- **Lỗi mới luôn là `AppError` subclass** (`src/core/errors.ts`) với `userMessage` tiếng Việt thân thiện — không throw lỗi thô lên adapter.
- **TikTok Shop VN qua Accesstrade — đã IMPLEMENT xong (2026-08-18)**, merchant thứ 3 (`tiktokshop`) sau Shopee/Lazada, ngoài scope ban đầu (user chủ động yêu cầu thêm). Endpoint `POST /v1/tiktokshop_product_feeds/create_link` với body `{product_url, product_id}` — **KHÔNG cần `campaign_id`** (khác hẳn Shopee/Lazada, đã xác minh thật qua test API: gọi với 1 link `vt.tiktok.com` thật → nhận `aff_url`/`aff_short_url` → trace hết chuỗi redirect → product_id cuối khớp chính xác sản phẩm gốc — dù bài hướng dẫn của chính Accesstrade nhắc tới hạn chế "creator-only", hạn chế đó KHÔNG áp dụng cho endpoint này). Chọn Accesstrade thay vì Involve Asia (cũng khả thi, đã khảo sát) vì tái dùng được `AccesstradeProvider` có sẵn thay vì tích hợp network mới.
  - **Khác biệt kiến trúc quan trọng so với Shopee/Lazada**: `tiktok.com` là domain DÙNG CHUNG cho cả video thường lẫn sản phẩm TikTok Shop — không tách được bằng domain thuần. Vì vậy với merchant `tiktokshop`, `itemId` (product_id, tách trong `extractIds()` từ pattern `/view/product/{id}`) **KHÔNG còn là optional metadata như Shopee** — thiếu `itemId` sẽ bị `buildParsedLink()` (`linkValidator.ts`) từ chối ngay bằng `NotAProductLinkError`, không cho lọt xuống provider. Hệ quả: bot sẽ chủ động trả lời "không phải link sản phẩm" cho bất kỳ link `tiktok.com` nào không khớp pattern (kể cả video thường ai đó share trong group) — đây là đánh đổi có chủ đích (thà báo lỗi rõ ràng còn hơn gọi API với dữ liệu thiếu), nhưng có thể gây ồn trong group hay share video TikTok — cân nhắc nếu user phàn nàn.
  - `CreateAffiliateLinkInput` có thêm field `itemId?: string | null` (từ `linkResolverService.ts` truyền `parsed.itemId` xuống) chỉ để phục vụ case này — provider khác bỏ qua field này.
  - Response TikTok Shop dùng field `aff_short_url`/`aff_url` (khác `short_link`/`aff_link` của Shopee/Lazada) — đã thêm vào danh sách candidate field của `extractAffiliateUrl()`.
  - Chưa test endpoint order-list cho TikTok Shop (cần có đơn hàng thật) và chưa xác minh `getPromotions`/offers_informations có hoạt động cho merchant này không (`ACCESSTRADE_PROMOTIONS_MERCHANT_TIKTOKSHOP` để trống — không đoán slug).
  - **Hoa hồng ước tính thật (2026-08-18)**: sau khi tạo link thành công, `createAffiliateLink` gọi thêm `GET /v2/tiktokshop_product_feeds?product_ids={id}` (không cần `title_keywords` dù docs ghi required — đã test trực tiếp) để lấy `commission.rate`/`amount` THẬT từ Accesstrade — không phải scrape, không vi phạm chính sách (khác hẳn case Shopee đã từ chối làm trước đó vì phải scrape giá từ trang Shopee). `rate` là phân số thập phân (`0.03888` = 3.888%), nhân 100 để ra %. Trả về qua `CreateAffiliateLinkOutput.commissionEstimate` → `ResolveLinkResult.commissionEstimate` → `formatSuccessReply()` hiển thị dòng "💰 Hoa hồng ước tính hiện tại: ~X% (~Yđ)". Lỗi ở bước lấy estimate KHÔNG làm fail việc tạo link (try/catch riêng, log warning, trả `null`) — chỉ Shopee/Lazada chưa có tương đương, `commissionEstimate` sẽ là `null` cho 2 merchant đó.
- **Shopee qua `ShopeeAffiliateProvider` (co che `an_redir`) — đã IMPLEMENT xong (T3.1, 2026-08-19)**, thay thế hoàn toàn nhu cầu Open API cho merchant Shopee. Tự build `https://s.shopee.vn/an_redir?origin_link=<origin_link đã URL-encode>&affiliate_id=<affiliate_id>&sub_id=<subId>` — đây chính là cơ chế Custom Link trên portal dùng ngầm bên dưới (tài liệu công khai "Affiliate Short Link Implementation Guide" của Shopee), không phải hack/reverse-engineer. Đã verify khớp 100% qua trình duyệt thật (2026-08-19): link tự build resolve đúng y hệt link tạo qua Custom Link portal cho cùng 1 sản phẩm, `sub_id` giữ nguyên trong `utm_content` (đúng slot dùng để đối soát qua `subId`).
  - `affiliate_id` **không phải bí mật** (khác `app_id`/`secret_key` của Open API) — cố định theo tài khoản, lấy tại `affiliate.shopee.vn/account_setting`, không cần xin cấp riêng. Cấu hình qua `SHOPEE_AFFILIATE_ID` trong `.env`, không hard-code.
  - `origin_link` ưu tiên dạng gọn `https://shopee.vn/product/{shopId}/{itemId}` khi `extractIds()` (`linkValidator.ts`) tách được cả `shopId` lẫn `itemId` — ngắn hơn hẳn giữ nguyên slug tên sản phẩm tiếng Việt của link gốc. Nếu không tách được (link shop/category/campaign, hoặc pattern chưa xác minh) fallback về chính `productUrl` đã resolve — giống cách Custom Link xử lý được mọi loại trang Shopee, không chỉ trang sản phẩm.
  - `CreateAffiliateLinkInput` có thêm field `shopId?: string | null` (từ `linkResolverService.ts` truyền `parsed.shopId` xuống, song song với `itemId` đã có sẵn cho TikTok Shop) — provider khác bỏ qua field này.
  - `ShopeeAffiliateProvider` **CHỈ xử lý được merchant `shopee`** — gọi với merchant khác ném `MerchantNotConfiguredError` ngay (an toàn nếu lỡ wiring sai). Muốn Lazada/TikTok Shop vẫn chạy song song qua Accesstrade thì phải dùng qua `CompositeAffiliateProvider` (`AFFILIATE_PROVIDER=shopee_direct`), không dùng `ShopeeAffiliateProvider` đứng một mình làm provider chính.
  - `getPromotions()` của provider này luôn trả mảng rỗng — đã xác nhận Shopee Direct không có nguồn coupon chung tương đương (xem `nguon-kien-thuc-shopee-affiliate-portal.md` mục 8), không phải lỗi thiếu code.
  - **Chưa xác nhận**: 2 click test tạo link lúc verify có hiện lên Báo cáo click/Hoa hồng Shopee trên dashboard hay không — banner "chưa thiết lập thanh toán" (xem `nguon-kien-thuc-shopee-affiliate-portal.md` mục 1) có thể chặn việc ghi nhận dù landing page vẫn đúng. Tự kiểm tra lại trước khi coi Shopee Direct là "chắc chắn chạy thật" ở quy mô lớn.
  - **T3.2 (rút gọn link) — ĐÃ IMPLEMENT xong (2026-08-19)**: link `an_redir` tự build dài hơn hẳn link Custom Link/Accesstrade (~150-290+ ký tự tuỳ có giữ slug hay không) — tự host 1 lớp rút gọn riêng (KHÔNG dùng dịch vụ bên thứ ba, đặc biệt tránh Short Link Manager của `data.addlivetag.com` — dấu hiệu doorway/content-farm, chỉ tham khảo công thức URL của họ chứ không dùng hạ tầng). Bảng `short_links` (`code`/`target_url`/`created_at`) thêm vào `requests.db` qua `LogStore.createShortLink()`/`resolveShortLink()` (dùng chung DB với request log, không tách riêng vì không phải dữ liệu tài chính). Route `GET /s/:code` (`server.ts`) trả **302 redirect thật** (`res.redirect(302, targetUrl)`) — **TUYỆT ĐỐI không proxy/fetch nội dung trang đích rồi render lại**, vì sẽ làm mất cookie/`uls_trackid` Shopee tự sinh khi trình duyệt thật của user nhảy tiếp, phá tracking hoa hồng. `ShopeeAffiliateProvider` tự gọi rút gọn ngay sau khi build xong URL `an_redir` (`createShortLink`/`shortLinkBaseUrl` injected qua config, không tự phụ thuộc `LogStore` trực tiếp — dễ test). Đã verify: `Location` header của redirect khớp chính xác URL `an_redir` gốc, không bị biến dạng tham số.
- **`AccesstradeProvider` đã xác minh với API thật (2026-07-31)**, 2 endpoint độc lập nhau, config theo `AccesstradeProviderConfig.merchants: Partial<Record<MerchantId, {campaignId, promotionsMerchant}>>`:
  - `createAffiliateLink` → `POST /v1/product_link/create`, bắt buộc `campaign_id` trong body (không có trong tài liệu công khai ban đầu, phát hiện qua lỗi 400 thật). Thiếu campaign_id cho 1 merchant → `MerchantNotConfiguredError` (không chặn các merchant khác đã có config). Campaign đúng cho tạo link tuỳ ý:
    - Shopee: **"Shopee Việt Nam Smartlink cho tất cả thiết bị"** (merchant `shopee`, id xem dashboard Accesstrade)
    - Lazada: **"Lazada Việt Nam"** (merchant `lazada_kol`, id xem dashboard Accesstrade)
    - Cả 2 đang **"unregistered"** trên tài khoản hiện tại (chưa bấm đăng ký trong dashboard Accesstrade, khác với việc đã có API key) — nghĩa là nếu `AFFILIATE_PROVIDER=accesstrade`, cả Shopee lẫn Lazada đều lỗi `MerchantNotConfiguredError`. **Đã hết áp dụng cho Shopee kể từ khi có `shopee_direct` (2026-08-19, xem đầu file)** — Lazada vẫn còn bị chặn cho tới khi đăng ký campaign xong.
  - `getPromotions(merchant, limit)` → `GET /v1/offers_informations?merchant=<slug>`, hoạt động độc lập, **không cần** campaign được duyệt (đã xác minh với merchant `shopee`; merchant `lazada_kol` gọi được nhưng hiện chưa có dữ liệu trả về — có thể do không có campaign đang chạy tại thời điểm test, chưa chắc là do thiếu quyền). Không có field % giảm giá hay số lượt còn lại có cấu trúc — chỉ có `coupons[].coupon_desc` dạng text đã chứa sẵn "Giảm X%...". Tham số `coupon=1` trong tài liệu bị lỗi (luôn trả rỗng), đã bỏ, lọc coupon rỗng ở code thay vì dựa vào API. Cache riêng theo merchant trong bộ nhớ (TTL `ACCESSTRADE_PROMOTIONS_CACHE_TTL_MS`).
- Biến môi trường mới thêm phải khai báo mặc định trong `src/config/env.ts` và note trong `.env.example`.
- **`zca-js` (Zalo Group Adapter) — quyết định kỹ thuật cần biết trước khi động vào `src/adapters/zalo/`**:
  - Type definitions gốc của `zca-js` bị lỗi (`index.d.ts` ở root làm `export * from "./dist"` thiếu phần mở rộng file, không resolve được dưới `moduleResolution: NodeNext`). Đã fix bằng `paths` override trong `tsconfig.json` trỏ thẳng tới `./node_modules/zca-js/dist/index.d.ts` (file này có đầy đủ extension `.js`, hợp lệ). Đừng xoá override này hoặc "dọn dẹp" tsconfig mà không kiểm tra lại `npm run typecheck` — sẽ lại hỏng.
  - Đăng nhập ưu tiên session đã lưu (`ZALO_SESSION_PATH`) qua `zalo.login(credentials)`; chỉ fallback sang `zalo.loginQR()` khi chưa có session hoặc session hết hạn. Credentials (cookie/imei/userAgent) lấy từ event `LoginQRCallbackEventType.GotLoginInfo` trong callback của `loginQR`, lưu qua `session.ts`.
  - Message handler dùng `message.data.uidFrom` làm `userId` (rate-limit/log key) và phải bỏ qua `message.isSelf === true` (tránh vòng lặp echo) cũng như bỏ qua nội dung không phải string (sticker/ảnh...).
  - Handler được gọi qua `.catch()` ở nơi đăng ký listener (không phải `await` trực tiếp trong callback đồng bộ của `api.listener.on`) — giữ nguyên pattern này để một tin nhắn lỗi không làm crash cả process qua unhandled rejection.
