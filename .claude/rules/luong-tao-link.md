# Luồng tạo link: merchant → validate → provider → log

> Đọc khi sửa `src/core/merchants.ts`, `linkValidator.ts`, `affiliateProvider.ts`, `providers/*`, `linkResolverService.ts`, `subId.ts`, `rateLimiter.ts`, `errors.ts`, khi thêm merchant mới hoặc debug lỗi tạo link.

## Luồng xử lý

`rate limit check → parseProductLink (validate + nhận diện merchant theo domain + resolve short-link redirect + extract shop_id/item_id nếu có pattern) → generate subId → provider.createAffiliateLink({merchant, ...}) → logStore.record() (kèm merchant) → trả ResolveLinkResult hoặc AppError`.

Mỗi request sinh một `subId` riêng (`{maNenTang}-{userId}-{timestamp36}-{random}` — đoạn đầu là mã 1 ký tự, **không phải** tên nền tảng, xem `src/core/subId.ts`) gắn vào affiliate link, dùng để đối soát hoa hồng sau này qua báo cáo của nguồn affiliate đang dùng — đây là lý do mọi log request đều lưu `subId`, và cũng là lý do `ledgerAdmin.ts` tra ngược `subId` → user qua `logStore.findBySubId()` khi ghi nhận đơn hàng thủ công.

## Các file

**merchants.ts** — registry nhan dien merchant theo domain. MERCHANTS = san DANG ho tro (tu 2026-09-29 chi con Shopee) — THEM MERCHANT MOI TAI DAY. RETIRED_MERCHANTS = san TUNG ho tro da ngung (TikTok Shop, Lazada): giu lai BAT BUOC vi (1) ledger that con entry merchant='tiktokshop'/'lazada' va getMerchantConfig() tra CA 2 danh sach, thieu no la crash /admin/orders khi render don cu; (2) extractProductUrls() van phai nhat link 2 san nay ra khoi tin nhan de parseProductLink() nem RetiredMerchantLinkError — neu khong, adapter coi nhu tin nhan khong co link va bot IM LANG trong Zalo DM, user tuong bot hong.

**linkValidator.ts** — validate URL, nhan dien merchant, tach shop_id/item_id (Shopee, optional metadata), resolve short-link redirect. extractIds() khop DUNG 2 segment da xac minh tren du lieu that: /product/{shop}/{item} VA /opaanlp/{shop}/{item} (2026-09-29 - "opaanlp" la segment CO DINH app Shopee dung khi bam "Chia se", chiem 58/90 link trong short_links production, nhieu hon han /product/ la 30; truoc do khong nhan dang duoc nen origin_link giu nguyen query string ~790-863 ky tu gom credential_token/gads_t_sig/uls_trackid va CA tham so affiliate cua nguoi khac - sau fix con ~170). KHONG noi long thanh /{bat-ky}/{id}/{id}: trang shop/category cung co dang 2 so tuong tu, xem "khong doan mo regex". Link cua RETIRED_MERCHANTS bi tu choi NGAY bang RetiredMerchantLinkError truoc ca buoc resolve redirect (khong goi mang, ket qua da biet truoc). Rieng Shopee: subdomain sv.shopee.vn (Shopee Video, dang link /share-video/...) bi tu choi ngay bang NotAProductLinkError qua buildParsedLink() (2026-08-28, xem chi tiet trong skill `tich-hop-affiliate-provider`) - khac cac trang Shopee khac (shop/category/campaign) van hop le du id rong.

**affiliateProvider.ts** — interface AffiliateProvider (createAffiliateLink + getPromotions, ca 2 deu nhan merchant; createAffiliateLink co them shopId/itemId optional cho Shopee) — diem noi de doi/them nguon affiliate khac

**shopeeAffiliateProvider.ts** — Shopee qua co che an_redir truc tiep (khong can Open API), T3.1 — provider that DUY NHAT, xem skill tich-hop-affiliate-provider

**mockProvider.ts** — gia lap, dung khi AFFILIATE_PROVIDER=mock (mac dinh, khong can credentials), co du lieu mau rieng tung merchant

**index.ts** — factory chon provider theo env AFFILIATE_PROVIDER ("mock" | "shopee_direct")

**linkResolverService.ts** — dieu phoi: rate limit -> parseProductLink (xac dinh merchant) -> goi provider theo merchant -> log (kem merchant) -> tra ket qua/loi

**subId.ts** — (2026-09-26) generateSubId() + SUBID_PLATFORM_CODE - sinh subId gan vao affiliate link. Doan dau la MA 1 KY TU (zalo->"k", telegram->"m", http->"w") chu KHONG phai ten nen tang: subId hien nguyen van trong bao cao click/chuyen doi cua Shopee, de "zalo" o day la tu khai traffic den tu Zalo giua luc Shopee dang quet huy don traffic Zalo. Doi ma nay khong mat gi vi nen tang THAT doc tu cot `platform` cua requests.db qua findBySubId() (xem orderIngest.ts), KHONG parse tu chuoi subId - da grep toan repo, khong co cho nao split/startsWith tren subId. KHONG can migration: findBySubId khop nguyen chuoi nen subId cu "zalo-..." van tra duoc, 2 format cung ton tai. Doc doc comment trong file truoc khi doi - co test chan viec nhet lai ten nen tang, va chan viec "muon" ten kenh khac ("facebook"/"instagram": click van mang UA Zalo nen Shopee doi chieu duoc, luc do la khai sai nguon - dieu khoan (c)/(t)(iii)/(u), phat toi 10tr/lan).

**rateLimiter.ts** — sliding-window trong bo nho, key theo "platform:userId" — cung dung lam adminLoginRateLimiter (key theo req.ip) de chan brute-force /admin/login.

**errors.ts** — AppError va cac subclass — moi loi co userMessage tieng Viet an toan de hien thi truc tiep cho user

## Nguyên tắc

- **Thêm merchant mới** (ví dụ Tiki): thêm 1 entry vào `MERCHANTS` trong `src/core/merchants.ts` (domain pattern + short-host nếu có) — nhưng lưu ý hiện chỉ có 1 provider thật (`ShopeeAffiliateProvider`, chỉ xử lý được `shopee`), nên merchant mới cần một provider mới đi kèm, không phải chỉ đăng ký registry — `env.ts`, log, Telegram adapter đều tự động hỗ trợ merchant mới qua registry này, KHÔNG cần sửa. Nếu merchant có pattern URL chứa shop_id/item_id, thêm case trong `extractIds()` (`linkValidator.ts`) — mặc định trả `null` cho merchant chưa có pattern xác minh, **không đoán mò regex** (rủi ro sai âm thầm vì đây chỉ là metadata optional). **Ngoại lệ quan trọng — không phải merchant nào cũng chỉ cần đăng ký registry**: nếu network affiliate dùng endpoint/field HOÀN TOÀN KHÁC cho merchant đó (như TikTok Shop qua Accesstrade, xem ngay dưới), phải sửa thêm `AccesstradeProvider.createAffiliateLink` (branch theo `input.merchant`) và có thể cả `extractIds()`/`buildParsedLink()` nếu id tách được không còn là optional metadata mà là bắt buộc để gọi API — xem TikTok Shop làm ví dụ mẫu cho case này.

- **Thêm nguồn affiliate mới**: implement interface `AffiliateProvider` (`src/core/affiliateProvider.ts`), đăng ký trong `src/core/providers/index.ts` theo `env.affiliateProvider`.

- **Lỗi mới luôn là `AppError` subclass** (`src/core/errors.ts`) với `userMessage` tiếng Việt thân thiện — không throw lỗi thô lên adapter.

- **Adapter luôn log `err.message` trước khi trả `userMessage` cho user (2026-09-02)** — `zalo/bot.ts` và `telegram/bot.ts` trước đó chỉ lấy `err.userMessage` rồi vứt luôn `err.message` (chỗ chứa chi tiết chẩn đoán như `HTTP 400: {...}`), nên mọi lỗi tạo link đều không để lại dấu vết nào trong log Railway. Giờ cả 2 adapter `console.warn` kèm `code` + `rawUrl` + `message` trước khi reply. **Đừng bỏ dòng log này khi refactor** — không có nó thì mọi lỗi provider đều phải trace tay lại từ đầu.
