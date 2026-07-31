# Bot Ap Ma Shopee Affiliate — Phase 1 (Core Service + Telegram Adapter)

Trien khai theo `spec_bot_ap_ma_shopee.md`. Scope da code trong lan nay:

- **T1.1** Core Link Resolver Service (validate link Shopee, tao affiliate link qua Accesstrade)
- **T1.2** Telegram Adapter (long polling)
- **T1.4** Luu log request vao SQLite, query lai theo ngay/platform
- **T1.5** Error handling cho cac failure mode (affiliate API loi/timeout, link hong)
- **T1.6** Rate limit co ban theo user

Zalo OA Adapter (T1.3) **khong lam** — da quyet dinh bo qua vi thu tuc dang ky Zalo OA phuc tap (T0.3 khong trien khai). Bot chi chay tren Telegram.

Nguon affiliate da chon: **Accesstrade**. Chi phi build va format request/response API cua Accesstrade nam trong `src/core/providers/accesstradeProvider.ts` — co ghi chu ro can doi chieu lai voi tai lieu API chinh thuc trong dashboard Accesstrade cua ban truoc khi chay that, vi minh chua co credentials that de xac minh 100% field response.

## Truoc khi chay that (business, khong code — theo spec muc T0.x)

1. **T0.1** — Dang ky Accesstrade, duoc duyet campaign Shopee, lay API key.
2. **T0.2** — Tao Telegram Bot qua [@BotFather](https://t.me/BotFather), lay bot token.

Neu chua co 2 cai tren, project van chay duoc o che do **mock**: bot van tra loi short link (gia), giup ban test toan bo luong truoc khi co credentials that.

## Cai dat

```bash
npm install
cp .env.example .env
```

Mo `.env`, dien:

- `TELEGRAM_BOT_TOKEN` — token tu BotFather (T0.2). Neu de trong, server HTTP van chay nhung Telegram Adapter se khong khoi dong.
- `AFFILIATE_PROVIDER=accesstrade` + `ACCESSTRADE_API_KEY` — khi da co credentials that (T0.1). Mac dinh la `mock` de dev/test.

## Chay

```bash
npm run dev        # dev, tu reload khi sua code
npm run build && npm start   # build + chay production
npm test            # unit test cho link validator + rate limiter
npm run typecheck
```

Khi chay, Core Service HTTP mo tai `http://localhost:3000` (doi PORT trong `.env` neu can).

## Kiem tra thu (khong can Telegram token)

```bash
curl -X POST http://localhost:3000/api/v1/resolve \
  -H "Content-Type: application/json" \
  -d '{"url":"https://shopee.vn/Ao-thun-nam-i.123456.789012","platform":"http","userId":"tester1"}'
```

Link khong phai Shopee hoac sai dinh dang se tra ve loi ro rang (HTTP 422/400), khong crash server.

Xem lai log request theo ngay/platform (T1.4):

```bash
curl "http://localhost:3000/api/v1/logs?from=2026-07-31&to=2026-07-31&platform=telegram"
```

## Test Telegram that

Sau khi co `TELEGRAM_BOT_TOKEN` va chay `npm run dev`, nhan link san pham Shopee cho bot (chat rieng hoac trong group co bot) — bot se tra loi short link affiliate trong vong vai giay. Tin nhan khong chua link Shopee: bot tra loi huong dan (chat rieng) hoac im lang (trong group, tranh spam).

## Cau truc thu muc

```
src/
  config/env.ts              cau hinh tu bien moi truong
  core/
    types.ts, errors.ts       kieu du lieu & loi dung chung
    linkValidator.ts          validate/parse link Shopee (T1.1)
    affiliateProvider.ts      interface chuan hoa cho nguon affiliate
    providers/
      accesstradeProvider.ts  tich hop that voi Accesstrade
      mockProvider.ts         gia lap, dung khi chua co credentials
    logStore.ts                luu log vao SQLite (T1.4)
    rateLimiter.ts             rate limit theo user (T1.6)
    linkResolverService.ts    dieu phoi toan bo luong + xu ly loi (T1.5)
  api/server.ts                HTTP API (POST /api/v1/resolve, GET /api/v1/logs)
  adapters/telegram/bot.ts     Telegram Adapter (T1.2)
  index.ts                     wiring + khoi dong
```

## Khong lam (ngoai scope, theo quyet dinh cua chu du an)

- Zalo OA Adapter (T1.3, Phase 2) — bo qua, khong dang ky Zalo OA vi thu tuc phuc tap.
- Dashboard thong ke (T1.7, Phase 3).
- Tra cuu voucher tu dong.
- Phat hien nganh hang bi loai tru khoi hoa hong Shopee/Accesstrade — neu Accesstrade tra loi/that bai cho truong hop nay, bot se bao loi chung chung (T1.5) thay vi bao chi tiet ly do.
