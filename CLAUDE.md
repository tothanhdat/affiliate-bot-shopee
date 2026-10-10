# CLAUDE.md

Hướng dẫn cho Claude Code khi làm việc trong repo này.

**File này chỉ là bản đồ + luật chung.** Mọi chi tiết implementation, quyết định đã chốt và cạm bẫy của từng phần nằm trong `.claude/rules/` — **đọc file rule tương ứng TRƯỚC KHI sửa phần đó**, đừng suy đoán từ bản đồ này. Các rule đó là nguồn duy nhất cho chi tiết kỹ thuật, và phần lớn ràng buộc trong đó đã trả giá bằng bug thật trên tiền thật.

## Project

Bot nhận link sản phẩm Shopee qua **Telegram** và **Zalo** (tự động hoá 1 tài khoản Zalo cá nhân qua thư viện không chính thức `zca-js` — **không phải Zalo OA**), tự nhận diện merchant theo domain trong link, gắn affiliate ID, trả về short link. Hoa hồng phát sinh được chia **20% chủ bot / 80% user** (mô hình cashback).

Những điều đúng ở mọi nơi trong repo (chi tiết + lý do: `.claude/rules/quyet-dinh-san-pham.md`):

- **Shopee là nguồn affiliate thật duy nhất**, đi qua cơ chế `an_redir` chính thức — KHÔNG cần Open API (Shopee đã từ chối cấp cho tài khoản cá nhân 2 lần, 2026-08-17 và 2026-09-30, đừng hỏi lại). TikTok Shop đang được tích hợp qua RioHub, xem `docs/riohub-tiktok.md`.
- **Tỉ lệ chia hoa hồng được CHỐT theo từng đơn** tại thời điểm ghi nhận (3 cột `*_percent` trong `commission_entries`). Đổi % ở `/admin/settings` **không** áp ngược cho đơn `pending` — đơn pending là đơn user ĐÃ MUA.
- **Admin sửa được % hoa hồng, ngưỡng rút và toàn bộ template tin nhắn bot ngay tại runtime** qua `/admin/settings` (xem `SETTINGS_REGISTRY`); `.env` chỉ còn là giá trị khởi tạo/fallback.
- **Giá trị đã lưu trong DB ĐÈ lên default trong code**: sửa default của template/FAQ rồi deploy là CHƯA XONG — phải vào `/admin/settings` của **từng instance** sửa tay. Đây là cái bẫy bị dính nhiều lần nhất.
- **Mỗi chủ bot = 1 deployment RIÊNG** từ cùng codebase này (DB riêng, tài khoản Shopee/Zalo riêng, domain riêng) — KHÔNG multi-tenant trong 1 process.
- **SQLite qua `node:sqlite`** (built-in Node 22+, KHÔNG dùng `better-sqlite3` hay lib ngoài), 2 DB tách biệt: `logStore` (log request) và `ledgerStore` (tiền). Thêm cột mới luôn phải kèm migration.
- **Mọi mốc ngày và phép cắt ngày tính theo giờ VN (+7)**, không theo UTC — server (Railway) chạy UTC, cắt theo UTC sẽ lệch 7 tiếng mỗi ngày.
- **Mọi lỗi là `AppError` subclass** (`src/core/errors.ts`) với `userMessage` tiếng Việt an toàn để hiện thẳng cho user — không throw lỗi thô lên adapter.
- **Mobile là màn hình CHÍNH** của trang `/so-tay` và dashboard user (user bấm link từ tin nhắn Zalo trên điện thoại).

Rủi ro kỹ thuật đã biết: `rui-ro-can-giai-quyet.md`, `rui-ro-tich-hop-tiktok.md`. Việc còn tồn đọng: `product-backlog.md`. Tài liệu hướng tới user là trang `/so-tay` tự host (`handbookHtml.ts`) — **toàn bộ tài liệu vận hành/đặc tả `.md` khác đã bị xoá 2026-10-01 và không khôi phục được, đừng đi tìm**.

## Architecture

Thiết kế **core logic dùng chung + adapter mỏng theo platform**, để mở rộng sang platform chat khác hoặc merchant khác không phải viết lại logic nghiệp vụ.

Luồng xử lý 1 request (dù vào từ HTTP, Telegram hay Zalo) luôn đi qua `LinkResolverService.resolve()`:

`rate limit check → parseProductLink (validate + nhận diện merchant theo domain + resolve short-link redirect + extract shop_id/item_id) → generateSubId → provider.createAffiliateLink({merchant, ...}) → logStore.record() (kèm merchant) → ResolveLinkResult | AppError`

Mỗi request sinh một `subId` riêng gắn vào affiliate link để đối soát hoa hồng về sau — xem `.claude/rules/luong-tao-link.md`.

### Bản đồ code

```
src/core/                       logic nghiệp vụ, KHONG biet gi ve Telegram/HTTP/Express
  merchants linkValidator affiliateProvider providers/ linkResolverService
  subId rateLimiter errors                              -> luong-tao-link.md
  ledgerStore commissionMath payoutHold orderIngest
  userCommissionOverride money vietnamDate              -> ledger-va-tien.md
  commissionLookup                                      -> tra-hoa-hong-truoc.md
  logStore                                              -> logstore.md
  shopeeReportImport                                    -> import-bao-cao-shopee.md
  orderImage/ vietQr                                    -> anh-don-ve.md
  faq/                                                  -> faq-zalo-dm.md
  dashboardStats                                        -> admin-dashboard.md
  settingsKeys textNormalize                            -> settings-va-template.md
  adminAuth vietnamBanks                                -> server-va-wiring.md
src/api/
  server.ts                                             -> server-va-wiring.md
  adminHtml styles/admin.css adminAssets htmlHelpers    -> admin-ui-nen-tang.md
  adminLinksHtml + rang buoc tung trang /admin/*        -> admin-ui-tung-trang.md
  adminDashboardHtml                                    -> admin-dashboard.md
  dashboardHtml handbookHtml                            -> trang-cho-user.md
src/adapters/
  shared/replyText                                      -> settings-va-template.md
  shared/adminNotifier                                  -> server-va-wiring.md
  telegram/bot zalo/*                                   -> zalo-adapter.md
                                                           + src/adapters/zalo/CLAUDE.md
src/config/   env.ts -> server-va-wiring.md | settingsRegistry.ts -> settings-va-template.md
src/scripts/  ledgerAdmin zaloLogin zaloLoginPaths csv  -> van-hanh-va-deploy.md
src/index.ts  wiring + notifyUser/notifyAdmin/notifyZaloGroup -> server-va-wiring.md
```

### Nguyên tắc khi sửa code

- **Đọc file rule của phần đó trước khi sửa.** Bảng tra ở mục dưới. Rule nào mô tả một quyết định "đã chốt" thì đừng đề xuất quay lại hướng đã bị từ chối, trừ khi user chủ động nhắc lại.
- **Không phá vỡ ranh giới core/adapter**: `src/core/**` không được import bất cứ gì từ `express`, `telegraf`, hay biết về platform cụ thể. Logic nghiệp vụ mới luôn vào `src/core`, không vào adapter.
- **Adapter chỉ format I/O**: `src/adapters/*` và `src/api/server.ts` chỉ gọi `LinkResolverService`, bắt `AppError` để lấy `userMessage` hiển thị cho user — không tự implement lại validate/rate-limit/log.
- Biến môi trường mới thêm phải khai báo mặc định trong `src/config/env.ts` và note trong `.env.example`.
- **Sửa nội dung tin nhắn bot thì sửa `src/adapters/shared/replyText.ts`** (dùng chung Telegram + Zalo, sửa 1 chỗ áp cả 2) — và nhớ cái bẫy "DB đè default" ở trên.
- **Mọi phép tính tiền chỉ có một nguồn**: `computeCommissionBreakdown` (`commissionMath.ts`) cho phép chia, `formatVnd` (`money.ts`) cho hiển thị. Đừng tạo bản sao thứ hai — đã từng dẫn tới web và tin nhắn bot hiện 2 con số khác nhau cho cùng 1 đơn.
- Khi tính năng/quyết định thay đổi, cập nhật file rule tương ứng ngay trong cùng lần sửa; đừng để chi tiết mới chỉ nằm trong commit message.

## `.claude/rules/` — đọc file nào khi nào

| File rule | Đọc khi |
|---|---|
| `quyet-dinh-san-pham.md` | Trước khi đề xuất đổi mô hình chia hoa hồng, nguồn affiliate, cách nhận diện merchant, hay "sửa" Zalo sang OA chính thức |
| `luong-tao-link.md` | Sửa `merchants.ts`, `linkValidator.ts`, provider, `linkResolverService.ts`, `subId.ts`; thêm merchant mới; debug lỗi tạo link |
| `ledger-va-tien.md` | **Bất cứ gì trên đường tiền**: `ledgerStore.ts`, phép chia hoa hồng, giam đơn to, nợ hoàn trả, rút tiền, % riêng từng user |
| `tra-hoa-hong-truoc.md` | Sửa `commissionLookup.ts` hoặc nguồn dữ liệu hoa hồng báo trước cho user |
| `logstore.md` | Sửa `logStore.ts`, bảng `requests`/`short_links`, thống kê đọc từ DB log |
| `import-bao-cao-shopee.md` | Sửa `shopeeReportImport.ts`, cách đọc cột báo cáo Shopee, bảng quyết định trạng thái đơn |
| `admin-ui-nen-tang.md` | **Trước khi sửa giao diện bất kỳ trang `/admin/*`** — 4 cái bẫy Tailwind không-preflight đã dính thật nằm ở đây |
| `admin-ui-tung-trang.md` | Sửa `/admin/orders`, `/admin/users`, `/admin/withdrawals`, `/admin/record-orders`, `/admin/settings`, `/admin/links` |
| `admin-dashboard.md` | Sửa `/admin/dashboard`, chart, màu trạng thái, `dashboardStats.ts`, công thức lợi nhuận chủ bot |
| `anh-don-ve.md` | Sửa `src/core/orderImage/*` (satori/resvg/font/toạ độ) hoặc QR chuyển khoản `vietQr.ts` |
| `zalo-adapter.md` | Sửa `zalo/bot.ts` hay `telegram/bot.ts`: DM, group, chào mừng, kết bạn, reaction, roster thành viên |
| `faq-zalo-dm.md` | Sửa `src/core/faq/*`, thêm chủ đề FAQ, đổi nhà cung cấp LLM, sửa hành vi im lặng/escalate |
| `settings-va-template.md` | Thêm/sửa setting ở `/admin/settings`, sửa text tin nhắn bot, đổi default template/FAQ |
| `trang-cho-user.md` | Sửa dashboard cá nhân (`/d/:token`) hoặc Sổ tay hoàn tiền (`/so-tay`) |
| `server-va-wiring.md` | Thêm route, sửa `server.ts`, `index.ts`, `env.ts`, đường thông báo cho user/admin |
| `van-hanh-va-deploy.md` | Chạy/sửa script `src/scripts/*`, chuẩn bị instance mới, bàn giao cho người vận hành khác |

## Nguồn chi tiết khác (ngoài `.claude/rules/`)

- **Tích hợp affiliate Shopee** (cơ chế `an_redir`/`ShopeeAffiliateProvider`, rút gọn link T3.2, các bug đã gặp + cách chẩn đoán lại) → skill `tich-hop-affiliate-provider` (`.claude/skills/tich-hop-affiliate-provider/SKILL.md`).
- **RioHub / TikTok Shop affiliate** (vì sao bỏ Accesstrade, phí MCN, hai dòng tiền, 7 endpoint, cạm bẫy sub_id/lọc ngày, những thứ chưa verify) → `docs/riohub-tiktok.md`. **Tài liệu sống, cập nhật trong suốt quá trình tích hợp** — mỗi lần verify thêm được gì thì sửa tại chỗ và ghi vào bảng *Nhật ký verify* ở cuối file. Quy ước ✅ ĐÃ ĐO / ⚠️ SUY LUẬN / ❓ CHƯA BIẾT là bắt buộc, đừng trộn.
- **Gotcha của `zca-js` / Zalo adapter** (override `paths` trong tsconfig, login QR/session, `uidFrom`/`isSelf`, pattern `.catch()`) → `src/adapters/zalo/CLAUDE.md` (tự load khi làm việc trong thư mục đó).
- **Plan/spec của từng đợt tính năng** → `docs/superpowers/plans/` và `docs/superpowers/specs/`.
