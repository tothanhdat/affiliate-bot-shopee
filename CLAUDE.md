# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Bot nhận link sản phẩm (Shopee, Lazada) qua Telegram và Zalo (group thường, không phải Zalo OA), tự động nhận diện merchant theo domain trong link, gắn affiliate ID qua **Accesstrade** (mỗi merchant 1 campaign_id riêng), trả về short link kèm danh sách mã giảm giá đang chạy của đúng merchant đó (chung, không gắn sản phẩm cụ thể). Toàn bộ hoa hồng phát sinh thuộc về chủ bot (không phải mô hình cashback). Spec gốc nằm ở `spec_bot_ap_ma_shopee.md` (chỉ viết cho Shopee/Zalo OA — phần đa merchant và Zalo Group Adapter là mở rộng sau đó theo yêu cầu, không có trong spec gốc).

**Zalo OA chính thức sẽ không làm** — chủ dự án đổi hướng sang tự động hoá 1 tài khoản Zalo cá nhân trong group thường (qua thư viện không chính thức `zca-js`), vì thủ tục đăng ký Zalo OA phức tạp. Đừng đề xuất quay lại Zalo OA trừ khi user chủ động nhắc lại. Dashboard thống kê cũng chưa làm (ngoài scope hiện tại).

**Zalo Group Adapter dùng API không chính thức, có rủi ro khoá tài khoản** — đây là quyết định đã được user chấp nhận (dùng tài khoản phụ/throwaway, không dùng tài khoản chính). Đừng "sửa" sang Zalo OA chính thức để "an toàn hơn" — đó là hướng đã bị từ chối.

**Merchant được chọn theo domain trong link, không theo room/group Telegram** — đây là quyết định đã chốt (xem lịch sử trao đổi): user hỏi về multi-room multi-campaign, được tư vấn chọn domain-based vì đơn giản hơn room-based (không cần bảng mapping room↔merchant). Đừng tự ý đổi sang room-based routing trừ khi user yêu cầu lại.

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
  merchants.ts                registry nhan dien merchant theo domain (Shopee, Lazada) — THEM MERCHANT MOI TAI DAY
  linkValidator.ts            validate URL, nhan dien merchant, tach shop_id/item_id (hien chi co pattern cho Shopee), resolve short-link redirect
  affiliateProvider.ts        interface AffiliateProvider (createAffiliateLink + getPromotions, ca 2 deu nhan merchant) — diem noi de doi/them nguon affiliate khac Accesstrade
  providers/
    accesstradeProvider.ts    tich hop that voi Accesstrade API, config campaign_id/promotions-merchant RIENG TUNG MERCHANT — xem chi tiet ben duoi
    mockProvider.ts           gia lap, dung khi AFFILIATE_PROVIDER=mock (mac dinh, khong can credentials), co du lieu mau rieng tung merchant
    index.ts                  factory chon provider theo env AFFILIATE_PROVIDER
  linkResolverService.ts      dieu phoi: rate limit -> parseProductLink (xac dinh merchant) -> goi provider theo merchant -> log (kem merchant) -> tra ket qua/loi
  rateLimiter.ts               sliding-window trong bo nho, key theo "platform:userId"
  logStore.ts                  SQLite qua node:sqlite (built-in Node 22+, KHONG dung better-sqlite3 hay lib ngoai). Co cot merchant + tu migrate (ALTER TABLE) cho DB tao truoc khi co field nay.
  errors.ts                    AppError va cac subclass — moi loi co userMessage tieng Viet an toan de hien thi truc tiep cho user

src/api/server.ts             Express: POST /api/v1/resolve, GET /api/v1/logs (loc duoc theo platform va merchant), GET /health
src/adapters/
  shared/replyText.ts          template tin nhan DUNG CHUNG giua Telegram va Zalo (USAGE_TEXT, MERCHANT_LABELS, formatSuccessReply/Error/Skipped/PromotionsReply) — sua text/nhan hien thi tai day, khong sua rieng tung adapter
  telegram/bot.ts               Telegraf, long polling (khong dung webhook). 1 tin nhan co the chua link nhieu merchant khac nhau — moi merchant duoc reply + hien khuyen mai rieng.
  zalo/
    bot.ts                      dieu khien 1 TAI KHOAN ZALO CA NHAN qua thu vien khong chinh thuc `zca-js` (mo phong Zalo Web) — KHONG phai Zalo OA. Tra loi trong TAT CA group ma tai khoan la thanh vien (khong co allowlist, la lua chon cua chu du an) va ca tin nhan rieng (DM). Cung logic reply nhu Telegram adapter (dung chung replyText.ts).
    session.ts                  luu/doc credentials (cookie/imei/userAgent) vao file JSON de khong phai quet QR lai moi lan restart
src/config/env.ts             doc + validate bien moi truong. Config Accesstrade theo merchant duoc suy ra tu MERCHANTS registry (ACCESSTRADE_CAMPAIGN_ID_<MERCHANT>, ACCESSTRADE_PROMOTIONS_MERCHANT_<MERCHANT>) — them merchant vao merchants.ts la du, khong can sua env.ts. Zalo Group Adapter mac dinh TAT (ZALO_GROUP_ENABLED=false).
src/index.ts                  wiring: tao LogStore/RateLimiter/Provider/Resolver mot lan, gan vao Express server + Telegram bot + Zalo bot (neu bat), graceful shutdown
```

Luồng xử lý 1 request (dù vào từ HTTP hay Telegram) luôn đi qua `LinkResolverService.resolve()`:
`rate limit check → parseProductLink (validate + nhận diện merchant theo domain + resolve short-link redirect + extract shop_id/item_id nếu có pattern) → generate subId → provider.createAffiliateLink({merchant, ...}) → logStore.record() (kèm merchant) → trả ResolveLinkResult hoặc AppError`.

Mỗi request sinh một `subId` riêng (`{platform}-{userId}-{timestamp36}-{random}`) gắn vào affiliate link, dùng để đối soát hoa hồng sau này qua báo cáo Accesstrade — đây là lý do mọi log request đều lưu `subId`.

### Nguyên tắc khi sửa code

- **Không phá vỡ ranh giới core/adapter**: `src/core/**` không được import bất cứ gì từ `express`, `telegraf`, hay biết về platform cụ thể. Logic nghiệp vụ mới luôn vào `src/core`, không vào adapter.
- **Adapter chỉ format I/O**: `src/adapters/*` và `src/api/server.ts` chỉ gọi `LinkResolverService`, bắt `AppError` để lấy `userMessage` hiển thị cho user — không tự implement lại validate/rate-limit/log.
- **Thêm merchant mới** (ví dụ Tiki): thêm 1 entry vào `MERCHANTS` trong `src/core/merchants.ts` (domain pattern + short-host nếu có) — `env.ts`, `AccesstradeProvider`, log, Telegram adapter đều tự động hỗ trợ merchant mới qua registry này. Nếu merchant có pattern URL chứa shop_id/item_id, thêm case trong `extractIds()` (`linkValidator.ts`) — mặc định trả `null` cho merchant chưa có pattern xác minh, **không đoán mò regex** (rủi ro sai âm thầm vì đây chỉ là metadata optional).
- **Thêm nhãn hiển thị cho merchant mới**: sửa `MERCHANT_LABELS` trong `src/adapters/shared/replyText.ts` (dùng chung cho cả Telegram và Zalo, sửa 1 chỗ áp dụng cả 2). Mặc định dùng tên thương hiệu thuần — **không bịa % giảm giá** cho merchant mới trừ khi có xác nhận cụ thể (xem case Shopee "22%" bên dưới, đó là số marketing cố định do chủ bot yêu cầu, không phải số tính từ API).
- **Thêm nguồn affiliate mới** (khác Accesstrade): implement interface `AffiliateProvider` (`src/core/affiliateProvider.ts`), đăng ký trong `src/core/providers/index.ts` theo `env.affiliateProvider`.
- **Lỗi mới luôn là `AppError` subclass** (`src/core/errors.ts`) với `userMessage` tiếng Việt thân thiện — không throw lỗi thô lên adapter.
- **`AccesstradeProvider` đã xác minh với API thật (2026-07-31)**, 2 endpoint độc lập nhau, config theo `AccesstradeProviderConfig.merchants: Partial<Record<MerchantId, {campaignId, promotionsMerchant}>>`:
  - `createAffiliateLink` → `POST /v1/product_link/create`, bắt buộc `campaign_id` trong body (không có trong tài liệu công khai ban đầu, phát hiện qua lỗi 400 thật). Thiếu campaign_id cho 1 merchant → `MerchantNotConfiguredError` (không chặn các merchant khác đã có config). Campaign đúng cho tạo link tuỳ ý:
    - Shopee: **"Shopee Việt Nam Smartlink cho tất cả thiết bị"** (merchant `shopee`, id `[REDACTED_CAMPAIGN_ID]`)
    - Lazada: **"Lazada Việt Nam"** (merchant `lazada_kol`, id `[REDACTED_CAMPAIGN_ID]`)
    - Cả 2 đang **"unregistered"** trên tài khoản hiện tại (chưa bấm đăng ký trong dashboard Accesstrade, khác với việc đã có API key). Cho đến khi đăng ký xong, `AFFILIATE_PROVIDER` phải để `mock`.
  - `getPromotions(merchant, limit)` → `GET /v1/offers_informations?merchant=<slug>`, hoạt động độc lập, **không cần** campaign được duyệt (đã xác minh với merchant `shopee`; merchant `lazada_kol` gọi được nhưng hiện chưa có dữ liệu trả về — có thể do không có campaign đang chạy tại thời điểm test, chưa chắc là do thiếu quyền). Không có field % giảm giá hay số lượt còn lại có cấu trúc — chỉ có `coupons[].coupon_desc` dạng text đã chứa sẵn "Giảm X%...". Tham số `coupon=1` trong tài liệu bị lỗi (luôn trả rỗng), đã bỏ, lọc coupon rỗng ở code thay vì dựa vào API. Cache riêng theo merchant trong bộ nhớ (TTL `ACCESSTRADE_PROMOTIONS_CACHE_TTL_MS`).
- Biến môi trường mới thêm phải khai báo mặc định trong `src/config/env.ts` và note trong `.env.example`.
- **`zca-js` (Zalo Group Adapter) — quyết định kỹ thuật cần biết trước khi động vào `src/adapters/zalo/`**:
  - Type definitions gốc của `zca-js` bị lỗi (`index.d.ts` ở root làm `export * from "./dist"` thiếu phần mở rộng file, không resolve được dưới `moduleResolution: NodeNext`). Đã fix bằng `paths` override trong `tsconfig.json` trỏ thẳng tới `./node_modules/zca-js/dist/index.d.ts` (file này có đầy đủ extension `.js`, hợp lệ). Đừng xoá override này hoặc "dọn dẹp" tsconfig mà không kiểm tra lại `npm run typecheck` — sẽ lại hỏng.
  - Đăng nhập ưu tiên session đã lưu (`ZALO_SESSION_PATH`) qua `zalo.login(credentials)`; chỉ fallback sang `zalo.loginQR()` khi chưa có session hoặc session hết hạn. Credentials (cookie/imei/userAgent) lấy từ event `LoginQRCallbackEventType.GotLoginInfo` trong callback của `loginQR`, lưu qua `session.ts`.
  - Message handler dùng `message.data.uidFrom` làm `userId` (rate-limit/log key) và phải bỏ qua `message.isSelf === true` (tránh vòng lặp echo) cũng như bỏ qua nội dung không phải string (sticker/ảnh...).
  - Handler được gọi qua `.catch()` ở nơi đăng ký listener (không phải `await` trực tiếp trong callback đồng bộ của `api.listener.on`) — giữ nguyên pattern này để một tin nhắn lỗi không làm crash cả process qua unhandled rejection.
