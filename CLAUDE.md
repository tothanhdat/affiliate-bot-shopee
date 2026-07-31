# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Bot nhận link sản phẩm Shopee qua Telegram, gắn affiliate ID qua **Accesstrade**, trả về short link kèm danh sách mã giảm giá Shopee đang chạy (chung, không gắn sản phẩm cụ thể). Toàn bộ hoa hồng phát sinh thuộc về chủ bot (không phải mô hình cashback). Spec đầy đủ nằm ở `spec_bot_ap_ma_shopee.md` — bao gồm roadmap theo Phase (0–3) và ticket breakdown (T0.x = business/không code, T1.x = coding). Chỉ **Phase 1** (T1.1, T1.2, T1.4, T1.5, T1.6) đã được code.

**Zalo OA Adapter (T1.3) sẽ không làm** — chủ dự án đã quyết định bỏ qua vì thủ tục đăng ký Zalo OA phức tạp. Đừng đề xuất resume việc này trừ khi user chủ động nhắc lại. Dashboard (T1.7) cũng chưa làm (Phase 3, ngoài scope hiện tại).

## Commands

```bash
npm install
cp .env.example .env       # dien TELEGRAM_BOT_TOKEN / ACCESSTRADE_API_KEY khi co

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

Thiết kế **core logic dùng chung + adapter mỏng theo platform** (per spec mục 4), để mở rộng sang platform chat khác không phải viết lại logic nghiệp vụ.

```
src/core/                    Core Service — khong biet gi ve Telegram/HTTP
  linkValidator.ts            validate URL Shopee, tach shop_id/item_id, resolve short-link redirect (s.shopee.vn, shp.ee)
  affiliateProvider.ts        interface AffiliateProvider (createAffiliateLink + getPromotions) — diem noi de doi/them nguon affiliate khac Accesstrade
  providers/
    accesstradeProvider.ts    tich hop that voi Accesstrade API, da xac minh voi API key that (2026-07-31) — xem chi tiet ben duoi
    mockProvider.ts           gia lap, dung khi AFFILIATE_PROVIDER=mock (mac dinh, khong can credentials)
    index.ts                  factory chon provider theo env AFFILIATE_PROVIDER
  linkResolverService.ts      dieu phoi: rate limit -> validate -> goi provider -> log -> tra ket qua/loi
  rateLimiter.ts               sliding-window trong bo nho, key theo "platform:userId"
  logStore.ts                  SQLite qua node:sqlite (built-in Node 22+, KHONG dung better-sqlite3 hay lib ngoai)
  errors.ts                    AppError va cac subclass — moi loi co userMessage tieng Viet an toan de hien thi truc tiep cho user

src/api/server.ts             Express: POST /api/v1/resolve, GET /api/v1/logs, GET /health
src/adapters/telegram/bot.ts  Telegraf, long polling (khong dung webhook)
src/config/env.ts             doc + validate bien moi truong, moi gia tri mac dinh nam o day
src/index.ts                  wiring: tao LogStore/RateLimiter/Provider/Resolver mot lan, gan vao Express server + Telegram bot, graceful shutdown
```

Luồng xử lý 1 request (dù vào từ HTTP hay Telegram) luôn đi qua `LinkResolverService.resolve()`:
`rate limit check → parseShopeeLink (validate + resolve short-link redirect + extract shop_id/item_id) → generate subId → provider.createAffiliateLink() → logStore.record() → trả ResolveLinkResult hoặc AppError`.

Mỗi request sinh một `subId` riêng (`{platform}-{userId}-{timestamp36}-{random}`) gắn vào affiliate link, dùng để đối soát hoa hồng sau này qua báo cáo Accesstrade — đây là lý do mọi log request đều lưu `subId`.

### Nguyên tắc khi sửa code

- **Không phá vỡ ranh giới core/adapter**: `src/core/**` không được import bất cứ gì từ `express`, `telegraf`, hay biết về platform cụ thể. Logic nghiệp vụ mới (validate thêm định dạng link, thêm nguồn affiliate, thay đổi cách tính subId...) luôn vào `src/core`, không vào adapter.
- **Adapter chỉ format I/O**: `src/adapters/*` và `src/api/server.ts` chỉ gọi `LinkResolverService`, bắt `AppError` để lấy `userMessage` hiển thị cho user — không tự implement lại validate/rate-limit/log.
- **Thêm nguồn affiliate mới**: implement interface `AffiliateProvider` (`src/core/affiliateProvider.ts`), đăng ký trong `src/core/providers/index.ts` theo `env.affiliateProvider`.
- **Lỗi mới luôn là `AppError` subclass** (`src/core/errors.ts`) với `userMessage` tiếng Việt thân thiện — không throw lỗi thô lên adapter, tránh lộ message kỹ thuật cho end-user hoặc làm bot crash.
- **`AccesstradeProvider` đã xác minh với API thật (2026-07-31)**, 2 endpoint độc lập nhau:
  - `createAffiliateLink` → `POST /v1/product_link/create`, bắt buộc `campaign_id` trong body (không có trong tài liệu công khai ban đầu, phát hiện qua lỗi 400 thật). `campaign_id` đúng cho việc tạo link tuỳ ý là campaign **"Shopee Việt Nam Smartlink cho tất cả thiết bị"** (merchant `shopee`, id `[REDACTED_CAMPAIGN_ID]`) — tài khoản hiện tại đang **"unregistered"** với campaign này (chưa bấm đăng ký trong dashboard Accesstrade, khác với việc đã có API key). Cho đến khi đăng ký xong, `AFFILIATE_PROVIDER` phải để `mock`.
  - `getPromotions` → `GET /v1/offers_informations?merchant=shopee`, hoạt động độc lập, **không cần** campaign được duyệt. Không có field % giảm giá hay số lượt còn lại có cấu trúc — chỉ có `coupons[].coupon_desc` dạng text đã chứa sẵn "Giảm X%..."; tham số `coupon=1` trong tài liệu bị lỗi (luôn trả rỗng), đã bỏ, lọc coupon rỗng ở code thay vì dựa vào API.
- Biến môi trường mới thêm phải khai báo mặc định trong `src/config/env.ts` và note trong `.env.example`.
