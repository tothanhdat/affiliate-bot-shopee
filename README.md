# Bot Ap Ma Shopee/Lazada Affiliate — Core Service + Telegram + Zalo Group Adapter

Trien khai theo `spec_bot_ap_ma_shopee.md`, mo rong them ho tro nhieu merchant (Shopee, Lazada) va them Zalo Group Adapter (thay cho Zalo OA chinh thuc). Scope da code:

- **T1.1** Core Link Resolver Service (validate link, nhan dien merchant theo domain, tao affiliate link qua Accesstrade)
- **T1.2** Telegram Adapter (long polling)
- **Zalo Group Adapter** — tu dong hoa 1 tai khoan Zalo ca nhan qua thu vien khong chinh thuc `zca-js`, tra loi trong cac group ma tai khoan do la thanh vien (xem canh bao rui ro ben duoi)
- **T1.4** Luu log request vao SQLite (kem merchant), query lai theo ngay/platform/merchant
- **T1.5** Error handling cho cac failure mode (affiliate API loi/timeout, link hong, merchant chua cau hinh)
- **T1.6** Rate limit co ban theo user
- Hien thi ma giam gia dang chay chung cua tung merchant (khong gan san pham cu the) sau khi tra link thanh cong

Nguon affiliate da chon: **Accesstrade**. Kien truc **da merchant**: 1 link Shopee hay Lazada gui vao bot deu duoc tu dong nhan dien theo domain (khong can biet no den tu room/group nao) va dung dung `campaign_id` rieng cua merchant do. Xem `src/core/merchants.ts` de them merchant moi.

## ⚠️ Canh bao ve Zalo Group Adapter

Adapter nay dieu khien **1 tai khoan Zalo ca nhan** qua `zca-js` (mo phong Zalo Web) - **khong phai** Zalo OA chinh thuc. Zalo cam ro hanh vi tu dong hoa tai khoan ca nhan trong dieu khoan su dung; **tai khoan co the bi khoa**. Khuyen nghi:

- Dung **tai khoan Zalo phu/throwaway**, khong dung tai khoan chinh cua ban.
- Chi 1 web-listener chay duoc tren 1 tai khoan cung luc - neu ban mo Zalo Web bang trinh duyet khac trong luc bot dang chay, listener cua bot se tu dong dung.
- Mac dinh **tat** (`ZALO_GROUP_ENABLED=false`), phai bat co y thuc trong `.env`.

## Truoc khi chay that (business, khong code)

1. **T0.1** — Dang ky Accesstrade, lay API key.
2. **T0.2** — Tao Telegram Bot qua [@BotFather](https://t.me/BotFather), lay bot token.
3. **Voi moi merchant muon dung that** (Shopee, Lazada...) — vao dashboard Accesstrade, muc Campaign, tim va **bam dang ky** campaign tuong ung (khac voi buoc da co API key):
   - Shopee: **"Shopee Việt Nam Smartlink cho tất cả thiết bị"** (merchant `shopee`, id `[REDACTED_CAMPAIGN_ID]`)
   - Lazada: **"Lazada Việt Nam"** (merchant `lazada_kol`, id `[REDACTED_CAMPAIGN_ID]`)
   - Xac minh that (2026-07-31): ca 2 campaign tren dang o trang thai "unregistered" tren tai khoan hien tai — can dang ky truoc khi dung `AFFILIATE_PROVIDER=accesstrade`.
4. **Neu dung Zalo Group Adapter** — chuan bi san 1 tai khoan Zalo phu, cai app Zalo tren dien thoai dung tai khoan do de quet QR khi bot khoi dong lan dau.

Neu chua hoan tat, project van chay duoc o che do **mock**: bot van tra loi short link + ma giam gia gia lap, giup ban test toan bo luong (ca Shopee lan Lazada) truoc khi co credentials that.

## Cai dat

```bash
npm install
cp .env.example .env
```

Mo `.env`, dien:

- `TELEGRAM_BOT_TOKEN` — token tu BotFather (T0.2). Neu de trong, server HTTP van chay nhung Telegram Adapter se khong khoi dong.
- `AFFILIATE_PROVIDER=accesstrade` + `ACCESSTRADE_API_KEY` — khi da co credentials that (T0.1). Mac dinh la `mock` de dev/test.
- `ACCESSTRADE_CAMPAIGN_ID_SHOPEE` / `ACCESSTRADE_CAMPAIGN_ID_LAZADA` — campaign_id rieng tung merchant (xem muc tren). Merchant nao thieu campaign_id se bao loi ro rang khi co request that cho merchant do, cac merchant khac van hoat dong binh thuong.
- `ZALO_GROUP_ENABLED=true` — neu muon bat Zalo Group Adapter (xem canh bao o tren truoc khi bat).

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

curl -X POST http://localhost:3000/api/v1/resolve \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.lazada.vn/products/ao-thun-i333.html","platform":"http","userId":"tester1"}'
```

Link khong thuoc merchant duoc ho tro hoac sai dinh dang se tra ve loi ro rang (HTTP 422/400), khong crash server.

Xem lai log request theo ngay/platform/merchant (T1.4):

```bash
curl "http://localhost:3000/api/v1/logs?from=2026-07-31&to=2026-07-31&platform=telegram&merchant=shopee"
```

## Test Telegram that

Sau khi co `TELEGRAM_BOT_TOKEN` va chay `npm run dev`, nhan link san pham Shopee hoac Lazada cho bot (chat rieng hoac trong group co bot) — bot se tra loi link ap ma trong vong vai giay, kem 1 tin nhan rieng liet ke ma giam gia dang chay chung cua dung merchant vua gui (neu 1 tin nhan co ca 2 merchant se co 2 tin khuyen mai rieng). Tin nhan khong chua link duoc ho tro: bot tra loi huong dan (chat rieng) hoac im lang (trong group, tranh spam).

## Test Zalo Group Adapter that

1. Dat `ZALO_GROUP_ENABLED=true` trong `.env`, chay `npm run dev`.
2. Lan dau chua co session: log se bao `Chua co session hop le - can dang nhap qua QR` va luu anh QR vao duong dan `ZALO_QR_PATH` (mac dinh `./data/zalo-qr.png`). Mo anh nay, dung app Zalo tren dien thoai (**tai khoan phu**, xem canh bao o tren) de quet.
3. Sau khi quet thanh cong, credentials duoc luu vao `ZALO_SESSION_PATH` (mac dinh `./data/zalo-session.json`) - lan khoi dong sau se tu dang nhap lai, khong can quet QR nua tru khi session het han.
4. Them tai khoan bot vao 1 group Zalo, gui thu link Shopee/Lazada trong group do - bot tra loi giong Telegram. Tin nhan rieng (khong phai group) gui cho tai khoan bot cung duoc tra loi tuong tu chat rieng Telegram.

## Cau truc thu muc

```
src/
  config/env.ts              cau hinh tu bien moi truong (bao gom campaign_id/promotions merchant tung merchant, config Zalo)
  core/
    types.ts, errors.ts       kieu du lieu & loi dung chung
    merchants.ts              registry nhan dien merchant theo domain (Shopee, Lazada) - them merchant moi tai day
    linkValidator.ts          validate/parse link, nhan dien merchant (T1.1)
    affiliateProvider.ts      interface chuan hoa cho nguon affiliate (theo merchant)
    providers/
      accesstradeProvider.ts  tich hop that voi Accesstrade, campaign_id + promotions rieng tung merchant
      mockProvider.ts         gia lap, dung khi chua co credentials
    logStore.ts                luu log vao SQLite kem merchant (T1.4), tu migrate DB cu
    rateLimiter.ts             rate limit theo user (T1.6)
    linkResolverService.ts    dieu phoi toan bo luong + xu ly loi (T1.5)
  api/server.ts                HTTP API (POST /api/v1/resolve, GET /api/v1/logs)
  adapters/
    shared/replyText.ts        template tin nhan dung chung giua Telegram va Zalo (tranh trung lap)
    telegram/bot.ts             Telegram Adapter (T1.2)
    zalo/
      bot.ts                   Zalo Group Adapter - dang nhap qua zca-js, lang nghe + tra loi group/DM
      session.ts               luu/doc credentials de khong phai quet QR moi lan restart
  index.ts                     wiring + khoi dong
```

## Khong lam (ngoai scope, theo quyet dinh cua chu du an)

- Zalo OA chinh thuc — da doi sang Zalo Group Adapter (khong chinh thuc) vi thu tuc dang ky OA phuc tap.
- Dashboard thong ke (Phase 3).
- Dieu huong theo room/group (moi room ep ve 1 merchant co dinh) — merchant duoc nhan dien tu dong theo domain trong link, khong phu thuoc room/group nao gui, ap dung cho ca Telegram lan Zalo.
- Allowlist gioi han group Zalo duoc tra loi — bot tra loi trong TAT CA group ma tai khoan la thanh vien, theo lua chon cua chu du an.
- Phat hien nganh hang bi loai tru khoi hoa hong — neu Accesstrade tra loi/that bai cho truong hop nay, bot se bao loi chung chung (T1.5) thay vi bao chi tiet ly do.
