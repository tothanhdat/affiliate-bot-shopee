# Thêm TikTok Shop qua RioHub — thiết kế đường tạo link

Ngày: 2026-10-09 · Trạng thái: **đã duyệt thiết kế, chưa triển khai**

> **Phạm vi file này: CHỈ đường tạo link.** Đường đối soát đơn (`GET /orders` → `commission_entries`)
> **cố ý để lại**, vì ba ẩn số còn chặn nó — xem mục 10.
>
> Hồ sơ kỹ thuật/business đầy đủ về RioHub: `docs/riohub-tiktok.md` (tài liệu sống).
> Rủi ro đang mở: `rui-ro-tich-hop-tiktok.md`. File này **không chép lại** nội dung hai file đó.

## 1. Mục tiêu

User gửi link TikTok Shop vào bot → nhận link affiliate kèm số tiền hoàn lại ước tính, **y hệt trải
nghiệm Shopee đang có**. Không trang mới, không ví riêng, không luồng riêng.

### Trong phạm vi

- `TiktokAffiliateProvider` tạo link qua RioHub `POST /product-links`
- Ước tính hoa hồng lấy từ chính lời gọi đó (không tốn request thêm)
- Định tuyến provider theo merchant (`compositeProvider`)
- Bật/tắt TikTok qua cờ, mặc định **tắt**
- Dự phòng 3 tên miền + bản đồ lỗi + cảnh báo admin

### NGOÀI phạm vi, cố ý

- Đối soát đơn, ghi `commission_entries` cho TikTok
- Webhook (đã có đặc tả đầy đủ, chưa chọn hướng)
- `POST /links/batch` — bot chỉ xử lý vài link mỗi tin nhắn, chưa cần
- Sửa `/so-tay`, dashboard, ảnh "đơn về" — chúng đã merchant-agnostic

## 2. Quyết định đã chốt với chủ bot (2026-10-09)

| # | Quyết định | Ghi chú |
|---|---|---|
| 1 | **Có** báo số hoa hồng ước tính ngay lúc trả link | Qua `/product-links`, 1 request được cả link lẫn dữ liệu sản phẩm |
| 2 | Bật bằng **cờ riêng, mặc định TẮT** | Thiếu key → cảnh báo + tự tắt, không crash |
| 3 | Instance chưa bật: link TikTok **giữ nguyên** câu "sàn đã ngừng hỗ trợ" | Deploy không đổi hành vi instance đang chạy |
| 4 | `422 product_not_promotable` → **báo thẳng, không trả link** | Khác ca `noCommission` của Shopee vì không có link nào để trả |
| 5 | RioHub sập → câu "Hệ thống Affiliate của Tiktok đang bảo trì, hãy thử lại sau 30 phút nữa" | Không trả link gốc thay thế |
| 6 | Vẫn trừ **10% thuế + 1% phí sàn** cho TikTok như Shopee | Dù TikTok đã khấu trừ `pit` tại nguồn — xem mục 1.3b của `docs/riohub-tiktok.md` |
| 7 | Chống spam cảnh báo admin: **1 lần / 15 phút / mỗi mã lỗi** | Do Claude đề xuất, chủ bot duyệt |

## 3. Kiến trúc

### 3.1 `src/core/providers/riohubClient.ts` — tầng vận chuyển

Không biết gì về affiliate. Trách nhiệm:

- Giữ danh sách base URL, **thử lần lượt**, **ghim** miền đầu tiên chạy được cho các request sau
- **Chuyển miền CHỈ khi lỗi tầng kết nối**: DNS, timeout, **và TLS/chứng chỉ**.
  `4xx`/`5xx` → dừng ngay, không thử miền khác (quy tắc của chính RioHub; đổi cũng lỗi y hệt)
- Gắn header `X-Riohub-Api-Key`, áp timeout
- Phân tích phong bì `{"error":{"code","message"}}` → ném `RiohubApiError { code, message, httpStatus }`
- Lỗi kết nối hết cả 3 miền → ném `RiohubUnreachableError`

**Bắt lỗi TLS là bắt buộc, không phải chi tiết thừa.** Sự cố 29/09/2026: `riohub.vn` phân giải DNS
bình thường nhưng trả chứng chỉ của `riohub.riokupon.com`; code chỉ bắt lỗi DNS sẽ **không** chạy dự
phòng. Với `fetch` của Node: `cause.code` ∈ { `ERR_TLS_CERT_ALTNAME_INVALID`, `ENOTFOUND`,
`ETIMEDOUT`, `ECONNRESET`, `ECONNREFUSED`, `EAI_AGAIN` } và `AbortError` do timeout.

### 3.2 `src/core/providers/tiktokAffiliateProvider.ts`

`implements AffiliateProvider`. Nhận client + cấu hình qua constructor (giống
`ShopeeAffiliateProvider` nhận `createShortLink`/`commissionLookup`) để test không cần mạng.

- `createAffiliateLink()` → `POST /product-links { creator_username, product_url, sub_id, channel }`
- `merchant !== "tiktokshop"` → ném `MerchantNotConfiguredError` (giống Shopee provider)
- `getPromotions()` → trả `[]` (TikTok không có nguồn coupon chung, giống Shopee)

### 3.3 `src/core/providers/compositeProvider.ts`

Định tuyến `createAffiliateLink`/`getPromotions` theo `merchant` tới provider tương ứng. Không có
provider cho merchant đó → `MerchantNotConfiguredError`.

**Chỉ bọc composite khi thật sự có từ 2 provider.** Một provider thì factory trả thẳng nó — đỡ một
lớp gián tiếp cho trường hợp phổ biến nhất (instance chỉ chạy Shopee).

### 3.4 Chỗ sửa trong code có sẵn

| File | Sửa gì |
|---|---|
| `src/core/merchants.ts` | Thêm `buildMerchantRegistry({ tiktokEnabled })` + cờ `resolveShortLinks` trên `MerchantConfig` |
| `src/core/providers/index.ts` | Dựng TikTok provider khi bật; bọc composite khi có ≥2 |
| `src/config/env.ts` | 6 biến mới (mục 5) + nới `assertAffiliateProviderConfigured()` |
| `src/config/settingsRegistry.ts` | 2 template mới |
| `src/core/settingsKeys.ts` | 2 hằng số key |
| `src/core/linkValidator.ts` | Tôn trọng cờ `resolveShortLinks` khi quyết định có theo redirect không |
| `src/core/errors.ts` | Thêm **một** lớp: `ProviderUnavailableError` (câu bảo trì). **Dùng lại** `ProductNotAffiliateEligibleError` đã có — câu chữ của nó khớp sẵn ca `product_not_promotable`; và `NotAProductLinkError` cho link không phải trang sản phẩm |
| `src/api/adminHtml.ts` | Màu chip "TikTok Shop" trong `merchantChipClass()` |

## 4. Luồng một request

```
user gửi link tiktok
  → extractProductUrls nhặt link ra (registry)
  → parseProductLink: merchant = tiktokshop
       KHÔNG resolve redirect · KHÔNG extractIds
  → compositeProvider → TiktokAffiliateProvider
  → POST /product-links
  → affiliateUrl = link RioHub trả (tiktok.com/t/XXXX, đã ngắn sẵn)
    commissionEstimate ← product.observed_commission ?? product.commission
  → formatSuccessReply (dùng chung Shopee, KHÔNG sửa)
```

### Hai thứ cố ý KHÔNG làm

- **Không rút gọn qua `/s/:code`.** Shopee cần vì `an_redir` dài 150–290 ký tự. RioHub trả sẵn link
  ngắn; thêm một chặng redirect chỉ tăng rủi ro hỏng deep-link mở app TikTok.
- **Không `extractIds()` cho TikTok.** RioHub nhận thẳng `product_url` và tự parse, **kể cả link rút
  gọn `vt.tiktok.com`** (đã verify: lỗi của họ ghi "Final URL after redirect..."). Tự parse là nhận
  rủi ro đoán sai pattern mà không được gì — đúng nguyên tắc "không đoán mò regex" của dự án.

### ⚠️ `shortHosts` đang gánh HAI vai trò — phải tách

Trong `MerchantConfig`, `shortHosts` vừa dùng để **nhận diện merchant theo host**, vừa là thứ **kích
hoạt resolve redirect** trong `parseProductLink`. Entry `tiktokshop` có `shortHosts:
{"vt.tiktok.com"}`.

Nếu để nguyên: bot sẽ tự theo redirect — trái với thiết kế. Nếu xoá `shortHosts`: `vt.tiktok.com`
không còn được nhận là TikTok nên `extractProductUrls` **không nhặt link ra**, bot im lặng — đúng
cái bẫy mà `RETIRED_MERCHANTS` tồn tại để tránh.

**Cách giải**: thêm cờ `resolveShortLinks?: boolean` (mặc định `true`) vào `MerchantConfig`; entry
`tiktokshop` đặt `false`. `shortHosts` giữ nguyên để nhận diện host, chỉ bước resolve bị bỏ qua.

Lợi ích kèm theo: bỏ được một lời gọi mạng trên đường user đang chờ — RioHub dù sao cũng phải tự
resolve lại.

## 5. Cấu hình

| Biến | Mặc định | Vai trò |
|---|---|---|
| `TIKTOK_ENABLED` | `false` | Công tắc chính |
| `RIOHUB_API_KEY` | `""` | Thiếu khi đã bật → cảnh báo + tự tắt |
| `RIOHUB_CREATOR_USERNAME` | `""` | Như trên |
| `RIOHUB_BASE_URLS` | 3 miền mặc định | Ngăn cách dấu phẩy, theo đúng thứ tự thử |
| `RIOHUB_TIMEOUT_MS` | `10000` | Nằm trên đường user đang chờ |
| `RIOHUB_LINK_CHANNEL` | `bot` | Nhãn `channel` tách link bot tạo khỏi link chủ bot tự tạo |

**Thiếu key thì tự tắt kèm cảnh báo, KHÔNG throw** — bắt chước đúng `COMMISSION_LOOKUP_ENABLED` và
`FAQ_PROVIDER`. Tính năng thêm không được phép làm bot không khởi động được.

**`AFFILIATE_PROVIDER` giữ nguyên tên** dù `shopee_direct` giờ phục vụ cả TikTok. Đọc lại nó thành
"dùng provider thật thay vì mock"; ghi chú trong `env.ts`. Đổi tên là buộc mọi instance sửa `.env`
khi deploy, không đáng.

```
AFFILIATE_PROVIDER=mock          → mock hết, TIKTOK_ENABLED bị bỏ qua
AFFILIATE_PROVIDER=shopee_direct → Shopee thật
   + TIKTOK_ENABLED=true (đủ key) → composite
   + TIKTOK_ENABLED=false         → chỉ Shopee, y như hôm nay
```

## 6. Bản đồ lỗi

Rẽ nhánh theo **`error.code`**, không theo HTTP status. Chia hai loại theo **ai có lỗi**:

| `error.code` | Nói với user | Báo admin |
|---|---|---|
| `product_not_promotable` | Báo thẳng, **không trả link** | ❌ |
| `validation_error` kèm "Cannot extract product_id" | "Không phải link sản phẩm TikTok" | ❌ |
| `validation_error` còn lại | Câu bảo trì | ✅ |
| `server_error` · `502` · không với tới được cả 3 miền | Câu bảo trì | ✅ |
| `unauthorized` · `not_found` | Câu bảo trì | ✅ **khẩn** |
| `429` | Câu bảo trì | ✅ |
| **mã lạ bất kỳ** | Câu bảo trì | ✅ kèm nguyên văn `code` + `message` |

**Nhánh mặc định là bắt buộc.** Bảng mã lỗi của RioHub không đầy đủ — `mcn_membership_required` và
`server_error` đều không có trong đó. Thiếu nhánh này thì một mã mới của họ làm bot chết câm.

**Hai nhóm không được gộp** — nói "bảo trì, thử lại sau 30 phút" cho sản phẩm không có hoa hồng là
nói sai: 30 phút nữa nó vẫn không có. Có test chặn.

### Chống spam cảnh báo

Tối đa **1 cảnh báo / 15 phút / mỗi `error.code`**, tin đầu gửi ngay. Lỗi vẫn ghi log đầy đủ từng
lần. Sự cố 09/10 kéo dài ~7 phút — không có cơ chế này thì 20 user gửi link = 20 tin giống nhau.

### Hai template mới (`SETTINGS_REGISTRY`)

| Key | Mặc định |
|---|---|
| `tiktokProviderDownTemplate` | "Hệ thống Affiliate của Tiktok đang bảo trì, hãy thử lại sau 30 phút nữa" |
| `tiktokNoCommissionTemplate` | Câu báo sản phẩm chưa bật hoa hồng |

Key mới nên không dính bẫy "DB đè default". Nhưng khi admin đã bấm Lưu thì nó đông cứng.

## 7. Ước tính hoa hồng

Nguồn: `product.observed_commission.commission_rate` **nếu có**, không thì `product.commission.rate`
(cả hai dạng raw int, `÷100` ra %).

- `commission.amount` và `sales_price` đều có thể là **khoảng** (`"250.00 - 735.00"`,
  `minimum_amount`/`maximum_amount`) → **lấy đầu thấp ở cả hai**
- **TikTok không có trần hoa hồng** như Shopee (40k) → `giá × rate` hợp lệ. Đây là khác biệt quan
  trọng so với quy tắc cứng của Shopee là phải lấy thẳng field `commission`
- Đi qua `computeCommissionBreakdown()` như Shopee → hiển thị **số user thực nhận**, không phải hoa
  hồng gốc
- `product_error` có / `product` null → **vẫn trả link**, chỉ bỏ phần ước tính (dùng câu hẹn như cũ)

Mọi sai số đều dồn về **phía hứa ít hơn trả**: `commission.rate` vốn thấp hơn thực tế ~17%, cộng với
việc lấy đầu thấp của hai khoảng. Ngược hẳn bẫy của Shopee là hứa cao hơn thực nhận.

⚠️ `observed_commission` **chỉ có ở ~1/10 sản phẩm** (đo trên 10 kết quả tìm kiếm) — phần lớn link
user gửi sẽ chạy nhánh `commission.rate`.

## 8. Test

Không gọi mạng thật — client tiêm vào provider như `createShortLink` đang làm.

**`riohubClient`**: lỗi kết nối → nhảy miền kế tiếp · `500` → **dừng, không nhảy** · **lỗi TLS cũng
phải nhảy** (ca 29/09) · ghim miền đã chạy được · phân tích đúng phong bì lỗi · hết cả 3 miền →
`RiohubUnreachableError`.

**`tiktokAffiliateProvider`**: `product_error` mà link vẫn về → trả link, không ước tính · ưu tiên
`observed_commission` hơn `commission.rate` · `commission.amount` khoảng → đầu thấp · `sales_price`
khoảng → đầu thấp · merchant sai → `MerchantNotConfiguredError`.

**Chặn hồi quy (nhóm quan trọng nhất)**: `product_not_promotable` **không bao giờ** ra câu bảo trì ·
mã lỗi lạ **luôn** kích hoạt cảnh báo admin · subId 4 đoạn đi nguyên vẹn vào `sub_id` · cảnh báo bị
gộp trong cửa sổ 15 phút nhưng tin đầu vẫn gửi ngay.

**Registry**: cờ bật → `tiktokshop` trong `MERCHANTS` · cờ tắt → trong `RETIRED_MERCHANTS` · **cả hai
trường hợp** `getMerchantConfig("tiktokshop")` đều trả được tên (đơn cũ trong ledger phải render).

**`resolveShortLinks`**: link `vt.tiktok.com` **vẫn được nhận** là TikTok (không bị bot bỏ qua im
lặng) nhưng **không** bị theo redirect · link `s.shopee.vn` vẫn được resolve như cũ (không hồi quy).

**Composite**: định tuyến đúng theo merchant · một provider thì không bọc composite.

## 9. Thứ tự commit

1. `riohubClient` + test (dự phòng miền, map lỗi) — không đụng gì đang chạy
2. `buildMerchantRegistry` + test — hành vi mặc định không đổi
3. `env` + 2 template + key hằng số
4. `tiktokAffiliateProvider` + test
5. `compositeProvider` + nối vào `providers/index.ts` + test
6. Bản đồ lỗi trong adapter + chống spam cảnh báo + test hồi quy
7. Màu chip TikTok trong `/admin/*`

Mỗi bước tự đứng được; bước 1–4 **không đổi hành vi** của instance nào vì cờ mặc định tắt.

## 10. Phụ thuộc còn treo — lý do chưa làm đối soát

Ba ẩn số chỉ giải được bằng một đơn đi hết vòng đời (xem `rui-ro-tich-hop-tiktok.md`):

1. **`shared_with_partner`** — MCN có giữ phần hoa hồng không. Không chặn code (quy tắc "lấy thẳng
   `actual_commission`" đúng trong mọi trường hợp) nhưng **chặn bài toán kinh doanh**
2. **`pit`** — đã biết cơ chế, chỉ còn đối chiếu bằng số
3. **`time_delivered_iso`** — mốc đếm cho cơ chế giam đơn

**Xây đường tạo link trước chính là cách sinh ra dữ liệu để gỡ nốt phần còn lại.** Và thời gian ủng
hộ: đơn đặt hôm nay phải vài tuần mới quyết toán, nên nếu đường đối soát xong trong vài tuần tới thì
**không user nào phải chờ**.

Việc nên làm song song: đặt một đơn thử qua chính link bot tạo — gỡ luôn rủi ro 7 (subId 4 đoạn chưa
đi qua đơn thật).
