# RioHub — TikTok Shop affiliate: hồ sơ business & kỹ thuật

> **Tài liệu sống.** Cập nhật trong suốt quá trình tích hợp. Mỗi lần verify thêm được một điều,
> sửa tại chỗ và ghi một dòng vào *Nhật ký verify* ở cuối file.
>
> Quy ước đánh dấu, **bắt buộc giữ**:
> - ✅ **ĐÃ ĐO** — gọi API thật hoặc nhìn thấy trên giao diện thật, có ngày tháng.
> - ⚠️ **SUY LUẬN** — hợp lý nhưng chưa có bằng chứng trực tiếp.
> - ❓ **CHƯA BIẾT** — đang chờ dữ liệu.
>
> Trộn ba loại này là cách nhanh nhất để sau vài tuần không ai còn phân biệt được đâu là sự thật
> đã kiểm chứng, đâu là phỏng đoán của một buổi chiều.

Cập nhật lần cuối: 2026-10-09 · Trạng thái tích hợp: **chưa viết dòng code nào**

---

# PHẦN 1 — BUSINESS

## 1.1 Vì sao chọn RioHub, không chọn Accesstrade

✅ **ĐÃ ĐO (2026-10-08)** trên 3 đơn thật: Accesstrade là network đứng giữa và **giữ 35,8%** hoa
hồng — hệ số publisher `0,6417` lặp lại y hệt trên cả 3 đơn, không phải nhiễu.

RioHub thì khác về bản chất: nó **không đứng giữa dòng tiền**. Nó chỉ là một lớp API trên **link
affiliate chính chủ** của tài khoản creator TikTok, nên TikTok trả thẳng cho creator, RioHub thu 0đ.

| | Accesstrade | RioHub |
|---|---|---|
| Rate thực nhận trên GMV | 3,85% | **6,00%** |
| Doanh thu cùng lượng đơn | 46.853đ | **~73.014đ** (+56%) |
| Rate limit | ~60 req/phút (429 ngay ở lời gọi thứ 2 liên tiếp) | 300 req/phút *(theo tài liệu, chưa tự đo)* |
| Trạng thái đơn | phải suy từ `status` + `is_confirmed` | `settlement_status` tường minh |
| Ngày giao hàng | không có | có field `time_delivered_iso` — **nhưng xem mục 2.6** |

✅ **Hai nguồn xác nhận chéo con số 6%**: RioHub trả `observed_commission.commission_rate = 600`,
khớp chính xác với số suy ngược từ feed Accesstrade (`3,888% / 0,6481 = 6,00%`).

## 1.2 Tư cách RioMCN và chi phí thật

✅ **ĐÃ ĐO (2026-10-09)** — đã được duyệt, 7/7 endpoint mở. Trước đó (08/10) bị chặn `403
mcn_membership_required` ở 5/7 endpoint, **mã lỗi này không hề có trong tài liệu của họ**, chỉ gọi
thật mới lộ ra.

✅ **Phí MCN = 0%.** Bằng chứng: màn "Thoả thuận chia sẻ doanh thu" trong app TikTok, đối tác
`RioMedia` ↔ creator `tothanhdat.it`, nguyên văn *"Bạn sẽ nhận được 100% tiền hoa hồng của mình"*,
ghi chú *"Phí quản lý 0%"*. User đã bấm Đồng ý ngày 09/10/2026.

**Hai ràng buộc trong chính thoả thuận đó, đừng quên:**

1. **0% chỉ chắc tới 08/04/2027.** Sau mốc này điều khoản chưa biết → ❓ cần xem lại trước hạn.
   Con số "+56%" chỉ đúng trong cửa sổ này.
2. **Không huỷ đơn phương được.** Nguyên văn: *"Bạn không thể thay đổi hoặc dừng chia doanh thu sau
   khi chấp nhận"*; muốn thoát phải huỷ liên kết và **cần RioMedia đồng ý**. Tài khoản TikTok thì
   không bị khoá (user xác nhận chỉ là chia sẻ dữ liệu).

⚠️ **"Thành viên MCN được x1.5 rate cơ bản" — chưa thấy dấu vết nào trong dữ liệu API.** Đơn
`586494603346282174` phát sinh **sau** khi bấm Đồng ý vẫn cho `commission_bonus_rate = 0`,
`shared_with_partner = null`, `est_bonus_commission = null`. Vậy **không có bonus tại thời điểm tạo
đơn**; ❓ còn khả năng nó chỉ xuất hiện lúc `SETTLED` thì chưa loại trừ được.
**Đừng tính khoản này vào dự báo doanh thu cho tới khi đo được trên một đơn đã chốt.**

## 1.3 Hai dòng tiền của chủ bot — tách bạch tuyệt đối

Đây là **bẫy kế toán nguy hiểm nhất** của việc thêm RioHub.

| Dòng tiền | Nằm ở đâu | Rút thế nào | Vào sổ bot? |
|---|---|---|---|
| **Hoa hồng affiliate** | Tài khoản TikTok của creator | Rút thẳng từ TikTok về ngân hàng | ✅ Đây là nguồn trả cashback cho user |
| **Cát-xê CAST chiến dịch** | **Ví RioHub** | Rút từ ví RioHub | ❌ **TUYỆT ĐỐI KHÔNG** |

✅ **ĐÃ ĐO**: partner API không có một endpoint tiền nào — `/balance`, `/wallet`, `/payouts`,
`/payout`, `/settlements`, `/transactions`, `/commissions` đều trả 404. Nên ví CAST **nằm ngoài tầm
với của API này**, tự tách sẵn về mặt kỹ thuật, không có đường nào để lỡ tay kéo nhầm vào sổ.

Lý do phải nhấn mạnh: tiền CAST là **công làm nội dung của chủ bot**, không phát sinh từ đơn của
user nào cả. Cộng nhầm vào sổ hoa hồng sẽ làm hệ thống tưởng có tiền chưa chia và **tính sai phần
của user** — sai về phía bất lợi cho chủ bot, và sai âm thầm.

## 1.3b ✅ ĐÃ QUYẾT (2026-10-09): TikTok vẫn trừ 10% thuế + 1% phí sàn như Shopee

**Bối cảnh**: TikTok **đã khấu trừ thuế TNCN tại nguồn** (`pit`, 10% phần HH chuẩn) và
`actual_commission` trả về **đã là số sau thuế** — khác Shopee, nơi báo cáo đưa số **trước thuế** nên
hệ thống phải tự trừ.

**Quyết định của chủ bot: vẫn áp 10% thuế + 1% phí sàn cho đơn TikTok, y như Shopee.** Lý do: đồng bộ
một đường tính cho cả hai sàn cho đơn giản, và phần chênh coi như biên của chủ bot — *"80% vẫn là con
số cao, anh không lời nhiều"*.

**Hệ quả đã được chấp nhận — ghi lại bằng số để sau này không ai tưởng là bug.** Trên cùng một mức
hoa hồng gốc 100.000đ:

| | Shopee | TikTok (theo quyết định này) |
|---|---|---|
| Sàn trả về | 100.000 (trước thuế) | 90.000 (**đã trừ `pit` 10.000**) |
| Hệ thống trừ thuế 10% | −10.000 | −9.000 |
| Trừ phí sàn 1% | −900 | −810 |
| User nhận 80% | **71.280** | **64.152** |
| **% so với hoa hồng gốc** | **71,3%** | **64,2%** |

→ Cùng một hoa hồng gốc, **user TikTok nhận ít hơn user Shopee khoảng 10%**. Phần chênh (~7.100đ
trên 100.000đ) về chủ bot. Đây là **lựa chọn có chủ đích**, không phải sai sót.

⚠️ **Một lưu ý về câu chữ, chưa quyết**: trang `/so-tay` giải thích với user là *"trừ 10% thuế"*. Với
đơn TikTok thì khoản 10% đó **không phải thuế** (thuế đã bị TikTok trừ trước rồi) mà là biên của chủ
bot. Con số hiển thị vẫn nhất quán với nhau nên user không thấy mâu thuẫn, nhưng **nhãn thì không
đúng bản chất**. Nếu sau này muốn chuẩn hoá thì sửa ở `/so-tay`, không phải sửa phép tính.

**Hệ quả kỹ thuật tốt**: `computeCommissionBreakdown()` **giữ nguyên**, không cần nhánh riêng theo
merchant, không cần đổi `taxPercent`. Đây là lý do chính của quyết định.

## 1.4 Rút tiền phía user — không đổi gì cả

User gửi link Shopee hay TikTok đều cộng vào **cùng một số dư**, rút ở **cùng `/d/:token`**, admin
trả tay ở **cùng `/admin/withdrawals`** kèm QR. Ngưỡng rút, luật giam đơn giá trị lớn, nợ hoàn trả,
% hoa hồng riêng từng user — dùng chung toàn bộ.

Không có ví TikTok riêng, không có trang báo cáo riêng. **Với user, việc thêm TikTok là vô hình** —
họ chỉ thấy gửi được thêm một loại link.

## 1.5 Rủi ro business đã biết và đã chấp nhận

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Phụ thuộc một nhà cung cấp nhỏ trên **đường tới hạn** (tạo link hỏng = bot không trả được link nào) | Cao | Cấu hình sẵn danh sách tên miền dự phòng. **Chỉ đổi miền khi lỗi tầng kết nối/DNS/timeout, KHÔNG đổi khi 4xx/5xx** |
| `424 creator_token_invalid` khi token TikTok của creator hết hạn → link ngừng tạo được | Cao | **Phải cảnh báo admin, không được im lặng** |
| Sự cố hạ tầng: tài liệu của họ ghi nhận `riohub.vn` sập 29/09/2026, khắc phục 03/10 | Trung bình | Nay chạy 3 tên miền |
| Hạn 08/04/2027 của thoả thuận 0% | Trung bình | Đặt lịch xem lại trước hạn |

Giảm nhẹ: RioHub/RioMCN đoạt hạng mục Content Ecosystem MCN tại Shopee Summit 2026, 10.000+ creator,
1.000+ brand, có app trên App Store và Google Play — không phải một bên vô danh.

## 1.6 Vận hành hằng ngày sẽ trông như thế nào

- **Xem báo cáo đơn**: không có trang mới nào trong hệ thống. Đơn TikTok sẽ tự hiện ở đúng chỗ đang
  xem hằng ngày — `/admin/dashboard`, `/admin/orders`, `/admin/links`, và dashboard của user. Lý do
  xem mục 2.7.
- **Dashboard của chính RioHub**: `https://riohub.vn/tiktok-shop-orders` — có xuất CSV, chế độ Live
  15s, lọc theo mã đơn/Sub ID/trạng thái/nguồn/khoảng ngày, 8 thẻ KPI và chart hoa hồng theo ngày.
- ❓ **Nhịp đồng bộ**: chạy tự động theo giờ hay bấm tay như Shopee — **chưa quyết**. Ràng buộc cứng
  ở mục 2.5: dữ liệu nguồn trễ tới ~1 tiếng nên gọi dày hơn mức đó là vô ích.

---

# PHẦN 2 — TECHNICAL

## 2.1 Kết nối

```
Base    https://riohub.vn/api/v1/partner/tiktok/affiliate
Auth    header  X-Riohub-Api-Key: rhk_...
Creator tham số creator_username (GET: query · POST: trong body)
```

**Tài liệu chính thức: `https://data.addlivetag.com/tiktok/`** (do chính nhà cung cấp viết).

✅ **Ba tên miền song song, cùng hệ thống cùng dữ liệu, chung một API key.** Đổi tên miền chỉ là đổi
phần host, mọi thứ khác giữ nguyên:

| Thứ tự thử | Base URL |
|---|---|
| 1 | `https://riohub.vn/api/v1` (chính) |
| 2 | `https://riohub.riokupon.com/api/v1` |
| 3 | `https://riohub.riokupon.me/api/v1` |

**Quy tắc chuyển miền — đọc kỹ, đây là chỗ dễ làm sai nhất:**

- Chỉ chuyển khi lỗi ở **tầng kết nối**: DNS không phân giải, timeout, **và cả lỗi TLS/chứng chỉ**.
- ⛔ **`4xx`/`5xx` thì KHÔNG chuyển** — hệ thống đã nhận request, đổi miền cũng lỗi y hệt và chỉ tốn quota.
- Miền nào chạy được thì **ghim lại dùng tiếp**, đừng để mỗi request lại chờ timeout ở miền đầu.

⚠️ **Bài học từ sự cố thật 29/09/2026 — đừng chỉ bắt lỗi DNS.** Hôm đó `riohub.vn` vẫn phân giải DNS
bình thường, nhưng **chứng chỉ TLS trả về lại là của `riohub.riokupon.com`** → client báo
`SSL: no alternative certificate subject name matches ... 'riohub.vn'` và request chết **trước khi
có HTTP status**. Code nào chỉ failover khi "không phân giải được DNS" thì ca này **không** chạy dự
phòng. Với cURL phải bắt các mã `6`, `7`, `28`, `35`, `51`, `60` — *cùng một lỗi sai tên miền, tuỳ
bản libcurl mà báo `51` hoặc `60`, phải bắt cả hai*. Với `fetch` của Node thì bắt `cause.code`
(`ERR_TLS_CERT_ALTNAME_INVALID`, `ENOTFOUND`, `ETIMEDOUT`, `ECONNRESET`).

**Hạn mức: 300 request/phút · 100.000 request/ngày · miễn phí cho creator.** Gặp `429` thì đọc
header `Retry-After`.
- **Key không bao giờ commit vào repo.** Dùng env `RIOHUB_API_KEY`. Key đã lộ trong lịch sử chat
  2 lần (08/10 và 09/10) → **rotate trước khi đưa lên production**.
- RioHub **cùng nhà cung cấp với `addlivetag`** (host `data.addlivetag.com` bot đang dùng tra hoa
  hồng Shopee) nhưng là **hai API key khác nhau, hai header khác nhau**.
- ✅ Tồn tại một API thứ hai cho app người dùng, xác thực bằng **bearer token** (`/me` trả
  `401 Missing bearer token`). Hai hệ thống tách biệt — xem hệ quả ở mục 2.4.

## 2.2 Bảy endpoint — trạng thái 2026-10-09

| Endpoint | Method | Trạng thái | Dùng để |
|---|---|---|---|
| `/links` | POST | ✅ 200 | **Tạo link cho bot** — giữ nguyên sub_id |
| `/product-links` | POST | ✅ 200 | Như trên, trả kèm thông tin sản phẩm |
| `/general-links` | POST | ✅ 200 | ⛔ **KHÔNG dùng** — ghi đè sub_id, xem 2.3 |
| `/orders` | GET | ✅ 200 | **Đối soát đơn** |
| `/links` | GET | ✅ 200 | Liệt kê link — ⚠️ không đầy đủ, xem 2.4 |
| `/products` | GET | ✅ 200 | Tra 1 sản phẩm theo `product_id` |
| `/products/search` | GET | ✅ 200 | Tìm theo từ khoá |

Không gọi được gì khác: đã dò `/balance`, `/wallet`, `/payouts`, `/settlements`, `/statistics`,
`/summary`, `/report`, `/transactions`, `/me`, `/account`, `/webhooks`, `/commissions` — **404 hết**.

### Endpoint thứ 8: `POST /links/batch` — tạo NHIỀU link 1 lần

Phát hiện 09/10/2026 từ spec AI, **chưa tự gọi thử**. Cùng body với `/links` nhưng thay `sub_id`
bằng `sub_ids`: mảng **tối đa 50** giá trị, trùng lặp được gộp.

> *"Dùng khi cần nhiều link cho cùng sản phẩm (vd **mỗi người dùng 1 sub_id riêng**) — nhanh hơn
> nhiều so với gọi `/links` từng cái."*

⚠️ **Thành công MỘT PHẦN là bình thường** — response có mảng `failed`, phải gửi lại những sub_id
trong đó. Rate limit tính **mỗi sub_id là 1 request**.

Với bot hiện tại thì mỗi tin nhắn user chỉ có vài link nên `/links` là đủ; `/links/batch` chỉ đáng
dùng nếu sau này có kịch bản phát link hàng loạt.

### Tham số `channel` của `/links` — nên dùng

`/links` nhận `channel` (tuỳ chọn, mặc định `riokupon`, 1–64 ký tự `[A-Za-z0-9_-]`) làm **nhãn nguồn
traffic**. Đây là lý do 3 link test có `channel` khác nhau. Nên đặt một giá trị riêng cho bot để lọc
được link do bot tạo, tách khỏi link chủ bot tự tạo trên app.

### Webhook — đặc tả đã đầy đủ, chưa tự kiểm chứng

- Cấu hình URL + sự kiện tại trang Developer. **URL phải HTTPS.**
- Event: `order.created` · `order.updated` · `order.refunded`; `event_id` (UUID) để idempotency;
  `occurred_at` ISO-8601. `data` mang các field như `orders[]`, kèm `order_status_raw`.
- **Chữ ký**: header `X-Riohub-Signature: t=<unix_ts>,v1=<hex>`, trong đó
  `v1 = HMAC-SHA256(key = signing secret, message = t + "." + raw_body)`.
  **`raw_body` nguyên văn, CHƯA parse JSON** — phải giữ body thô trước khi `JSON.parse`.
  So sánh bằng hàm **constant-time**. Signing secret đọc từ env như API key.
- Server phải trả `2xx` **trong 5 giây**; thất bại retry lùi dần **tối đa 6 lần**.

⚠️ Vẫn **chưa tự kiểm chứng dòng nào** — nếu chọn hướng webhook thì phải verify thật.

Cách phối hợp mà tài liệu khuyến nghị: nhận postback → **hold ~5 phút** → gom một loạt `order_id`
gọi **1 request** verify (`GET /orders` nhận tối đa **200 mã/lần**).

### Hình dạng lỗi THẬT (đo 2026-10-09)

✅ Mọi lỗi đều về cùng một khuôn, có **`error.code` đọc được bằng máy**:

```json
{"error":{"code":"...","message":"..."}}
```

| Tình huống | HTTP | `error.code` | `message` |
|---|---|---|---|
| Creator không tồn tại / không kết nối | 404 | `not_found` | `Creator 'x' is not connected on RioHub.` |
| Creator của người khác | 404 | `not_found` | *(giống hệt trên — xem ghi chú)* |
| Thiếu `creator_username` (GET) | 422 | `validation_error` | `Query 'creator_username' is required.` |
| Thiếu `creator_username` (POST) | 422 | `validation_error` | `Field 'creator_username' is required.` |
| Thiếu `product_url` | 422 | `validation_error` | `Field 'product_url' (or 'product_id') is required.` |
| `product_url` không parse được | 422 | `validation_error` | `Cannot extract product_id: Unrecognized TikTok product URL format.` |
| API key sai **hoặc** thiếu | 401 | `unauthorized` | `Invalid or missing API key.` |
| Chưa là thành viên MCN | 403 | `mcn_membership_required` | *(không có trong tài liệu)* |
| **Backend sập** | **500** | **`server_error`** | `Internal server error` *(không có trong tài liệu)* |

⚠️ **`403` của tài liệu KHÔNG tái hiện được.** Tài liệu ghi 403 = "creator không thuộc tài khoản của
API key", nhưng thử với creator của người khác lại ra **404 `not_found`** y hệt creator không tồn
tại. Không phân biệt được hai ca này từ phía client.

### ⛔ BẪY: `GET /products` trả **HTTP 200** khi không tìm thấy sản phẩm

```json
{"creator_username":"...","requested":1,"found":0,"products":[],"not_found":["9999999999999999999"]}
```

**Thành công ở tầng HTTP nhưng thất bại ở tầng nghiệp vụ.** Code chỉ kiểm `response.ok` sẽ đi tiếp
với `products[0] === undefined`. **Phải kiểm `found` / `not_found`**, đúng tinh thần `commission = 0`
của Shopee: *mã trạng thái không phải là câu trả lời*.

### ⚠️ `422 product_not_promotable` — ca user-facing THẬT, phải có câu trả lời riêng

> *"sản phẩm không có hoa hồng, chưa được shop duyệt, hoặc bị TikTok hạn chế (xem `message`)"*

Đây **không phải lỗi hệ thống** mà là câu trả lời thật về sản phẩm — tương đương ca `noCommission`
của Shopee. User gửi link hợp lệ nhưng bot không tạo được link affiliate.

Khác Shopee ở chỗ **nghiêm trọng hơn**: Shopee vẫn trả được link (chỉ là 0đ hoa hồng), còn ở đây
**không có link nào để trả**. Cần quyết định riêng cho ca này, không gộp vào nhánh lỗi chung.

### Quy tắc map lỗi cho adapter

Bảng mã lỗi của RioHub **không đầy đủ** — `mcn_membership_required` là bằng chứng. Vậy:

1. **Rẽ nhánh theo `error.code`, không theo HTTP status** (401 và 403 cùng là "không gọi được" nhưng
   cách xử lý khác hẳn nhau).
2. **Mọi `code` lạ phải rơi vào nhánh mặc định có CẢNH BÁO ADMIN**, không được im lặng — nếu không,
   một mã mới của họ sẽ làm bot chết câm giống hệt ca MCN.
3. `validation_error` là **lỗi của mình**, không phải lỗi tạm thời → đừng retry, đừng đổi tên miền.

### Bảng mã lỗi (theo tài liệu)

| HTTP | Ý nghĩa |
|---|---|
| 401 | API key sai hoặc thiếu |
| 403 | Creator không thuộc tài khoản của API key |
| 404 | Creator chưa kết nối RioHub |
| 422 | `product_not_promotable` — sản phẩm không có hoa hồng hoặc shop chưa duyệt |
| 429 | Vượt rate limit — đọc `Retry-After` |
| 502 | Không tạo được link nào (batch deep link) |

⚠️ **`403 mcn_membership_required` KHÔNG có trong bảng này** (tài liệu ghi 403 nghĩa khác hẳn:
"creator không thuộc tài khoản của API key"). Cửa chặn MCN chỉ lộ ra khi gọi thật. ❓ `424
creator_token_invalid` cũng không có trong bảng — ghi nhận từ nguồn khác, chưa đối chiếu lại được.

## 2.3 sub_id — mắt xích sống còn

Bot sinh subId dạng `{mã}-{userId}-{timestamp36}-{random}` (đúng 4 đoạn, xem `src/core/subId.ts`).
RioHub nhận `sub_id` 1–128 ký tự `[A-Za-z0-9_-]` và tự tách theo dấu `-` thành `sub1..sub4`.

✅ **ĐÃ ĐO (2026-10-09)** — `POST /links` và `POST /product-links` giữ nguyên vẹn:

```
gửi  sub_id = "m-probe2-abc123-xy9z"
nhận sub1="m"  sub2="probe2"  sub3="abc123"  sub4="xy9z"
```

→ **`findBySubId()` chạy y nguyên, không cần migration.**

⚠️ **`POST /general-links` KHÔNG dùng `sub_id`** — nó theo dõi bằng cơ chế khác: gắn `event_id` vào
link, đơn về có `trace_type = "GENERAL"` và `trace_id` = `event_id` đó. Quan trọng: **đơn từ
`/general-links` có `subid` cố định = `open_api_san`** (TikTok gán), nên **phải phân biệt bằng
`trace_id`, không dùng `subid`**.

→ Với bot thì **`/links` vẫn là lựa chọn đúng** (đơn giản hơn, `sub_id` đi thẳng vào `sub1..sub4`,
`findBySubId()` chạy nguyên). Nhưng verdict cũ "mất sạch đường quy đơn" là **sai** — `/general-links`
có đường quy đơn riêng, chỉ là khác cơ chế.

✅ **Nửa sau của mắt xích ĐÃ CHỨNG MINH (2026-10-09)** — đơn `586494603346282174`, đặt qua link tạo
trên app RioHub, trả về **nguyên văn** sub_id mà link mang:

```
"sub_id": "u35008-m1791535058",
"sub1": "u35008",  "sub2": "m1791535058",  "sub3": "",  "sub4": "",
"trace_id": "u35008-m1791535058",  "trace_type": "SPECIFIC"
```

So với đơn không có sub_id (`586474851567371966`): `sub_id = ""`, `trace_id = null`,
`trace_type = null`. → **`GET /orders` quy được đơn về đúng link đã tạo ra nó.** Đây là mắt xích
sống còn của toàn bộ đường tiền, giờ đã thông.

Hai điều rút ra:
- `trace_id` lặp lại y hệt `sub_id`, `trace_type = "SPECIFIC"` khi có sub_id → **có thể dùng
  `trace_type` để phân biệt đơn của bot với đơn tự nhiên của chủ bot** mà không cần parse chuỗi.
- Chuỗi app sinh chỉ có 2 đoạn và `sub3`/`sub4` là **chuỗi rỗng, không phải `null`** — đơn không có
  sub_id cũng cho `""`. Đừng dùng `sub3 === null` để phân biệt; so bằng `sub_id !== ""`.

⚠️ Vẫn còn một khoảng hở nhỏ: mới chứng minh với sub_id **2 đoạn** do app sinh, chưa chạy với sub_id
**4 đoạn** của bot qua một đơn thật. Cơ chế tách thì đã đo ở trên (`POST /links` tách đúng 4 đoạn),
nên rủi ro còn lại thấp.

## 2.4 `GET /links` KHÔNG phải sổ cái đầy đủ

✅ **ĐÃ ĐO (2026-10-09)**: link tạo trên **app RioHub không xuất hiện** trong `GET /links`. Chỉ thấy
link do chính partner API tạo ra.

`channel` là tham số lọc **thật** (khác loại bị bỏ qua ở mục 2.5) — kiểm bằng cách liệt kê:

```
(mặc định) total=3   ← đúng 3 link tạo qua API
riohub     total=1   (từ /general-links)
riokupon   total=2   (từ /links và /product-links)
app/mobile/web/api/open_api/tiktok/manual  → 0
all        → 0   ← chứng minh tham số được honor thật
```

Nguyên nhân: app chạy bearer token, partner API chạy API key — hai hệ thống (mục 2.1).

**Ngược lại `GET /orders` là creator-wide**, thấy cả đơn từ link tạo ngoài API. Nên:
- ✅ dùng `GET /orders` làm nguồn đối soát duy nhất;
- ⛔ **không** dùng `GET /links` để đếm "tổng số link đã tạo".

## 2.5 Bộ lọc của `GET /orders` — và cạm bẫy nuốt tham số

> 🔄 **Mục này đã được VIẾT LẠI 2026-10-09.** Bản trước kết luận "API không lọc theo ngày" — **sai**,
> do đoán sai tên tham số. API có bộ lọc đầy đủ. Cái bẫy thật thì tinh vi hơn, đọc tiếp.

✅ **ĐÃ ĐO bằng phép thử phân biệt** (2 đơn ở 2 ngày khác nhau, nên lọc đúng thì kết quả *phải* khác):

| Tham số | Kết quả | Ghi chú |
|---|---|---|
| `update_time_start` / `update_time_end` | ✅ chạy | **CHỈ nhận epoch giây** — xem bẫy dưới |
| `order_id` | ✅ chạy | tối đa **200 mã/lần** |
| `sub_id` | ✅ chạy | khớp **chuỗi con** |
| `sub1` (và `sub2..sub4`) | ✅ chạy | khớp **chính xác** từng vị trí |
| `status` | ✅ chạy | chuẩn hoá: `1` pending · `2` settled · `3` cancelled/refunded |
| `settlement_status` | ✅ chạy | |
| `content_type` | ✅ chạy | `VIDEO` / `LIVE` / `SHOWCASE` / `LINKSHARE` |
| `page_size` | ✅ chạy | tối đa **200** |
| `time_start` / `time_end` | ✅ chạy | lọc theo **ngày tạo**; nhận **CẢ epoch LẪN** `Y-m-d H:i:s` (kể cả `2026-10-09`) |
| `trace_id` | ✅ chạy | khớp chính xác, tối đa 200 mã |
| `product_id` | ✅ chạy *(theo tài liệu)* | tối đa 100 |
| `fully_refunded` | ✅ *(theo tài liệu)* | `0` / `1` |
| `create_time_start` | ⛔ **bị nuốt** | **sai tên** — tên đúng là `time_start` |

### ⚠️ Cạm bẫy: sai tên HOẶC sai định dạng đều bị nuốt im lặng

```
update_time_start=1791500000             → total=1   ✅ lọc đúng
update_time_start="2026-10-09 00:00:00"  → total=2   ⛔ ĐÚNG TÊN, SAI ĐỊNH DẠNG → trả TẤT CẢ
time_start="2026-10-09 00:00:00"         → total=1   ✅ chạy — vì time_* nhận cả 2 kiểu
xyz_khong_ton_tai=123                    → total=2   ⛔ tên bịa → trả TẤT CẢ
```

**Đã tìm ra nguyên nhân gốc**: `update_time_*` chỉ nhận **epoch giây**, còn `time_*` nhận **cả epoch
lẫn chuỗi ngày**. Hai tham số trông giống nhau nhưng khác luật — và sai luật thì **bị nuốt im lặng**
thay vì báo lỗi.

**Không `422`, không cảnh báo, không một dấu hiệu nào.** Trường hợp giữa là nguy hiểm nhất: tên
tham số đúng, chỉ sai định dạng giá trị, và API **lặng lẽ bỏ lọc** rồi trả về toàn bộ lịch sử.

**Quy tắc bắt buộc khi thêm bất kỳ tham số nào:** test bằng giá trị mà kết quả **phải khác** đối
chứng. Nếu kết quả không đổi thì tham số đó đang bị nuốt — bất kể tài liệu viết gì.

### Hệ quả cho thiết kế đồng bộ

- Tài liệu khuyến nghị **sync tăng dần bằng `update_time_start/end`** thay vì quét lại toàn bộ theo
  ngày tạo — vì đơn đổi trạng thái settlement/refund thì `update_time` mới đổi, `create_time` thì không.
- Nhưng **vẫn phải giữ nguyên cơ chế chống nhân đôi** đang chạy cho Shopee (`ON CONFLICT DO NOTHING`
  của `payout_debts`, `INSERT OR IGNORE` của `order_status_events`): nếu lọc bị nuốt vì một lỗi định
  dạng, hệ thống sẽ bất ngờ nhận lại toàn bộ lịch sử. Cơ chế dedup là **lưới an toàn cho đúng ca này**.

## 2.6 Hình dạng bản ghi đơn (`GET /orders`)

Đơn mẫu thật `586474851567371966` (08/10/2026):

| Nhóm | Field |
|---|---|
| Định danh | `order_id`, `sku_id`, `product_id`, `product_name`, `shop_name` |
| Quy về user | `sub_id`, `sub1`…`sub4`, `trace_id`, `trace_type`, `content_type` (`LINKSHARE`), `content_id` |
| Tiền | `price`, `quantity`, `commission_gmv`, `est_commission`, `actual_commission`, `commission_rate`, `standard_commission_rate`, `commission_model` |
| MCN / thưởng | `commission_bonus_rate`, `est_bonus_commission`, `actual_bonus_commission`, `shared_with_partner`, `shop_ads_commission_rate` |
| Thuế | `pit` |
| Hoàn/huỷ | `refunded_quantity`, `returned_quantity`, `fully_refunded` |
| Trạng thái | `settlement_status`, `payment_status`, `status`, `tt_order_status` |
| Thời gian | `time_created(_iso)`, `time_delivered(_iso)`, `settled_at(_iso)`, `create_time`, `update_time` |

Hai đơn thật đã đo:

| Đơn | Ngày | GMV | rate | est_commission | sub_id | trace_type |
|---|---|---|---|---|---|---|
| `586474851567371966` | 08/10 | 8.000đ | 600 (6,00%) | 480đ | `""` | `null` |
| `586494603346282174` | 09/10 | 10.000đ | 500 (5,00%) | 500đ | `u35008-m1791535058` | `SPECIFIC` |

Cả hai đều `settlement_status = "To-SETTLE"`, `est_commission = GMV × rate` đúng từng đồng.
⚠️ **Rate khác nhau giữa hai sản phẩm (6% vs 5%)** — rate là của từng sản phẩm, không phải một con
số chung của tài khoản. Đừng hardcode 6% ở bất cứ đâu.

⚠️ **Thời gian trả về là UTC** (`2026-10-08 06:52:18`), dashboard của họ hiện giờ VN
(`13:52:18 8/10/2026`). Hệ thống đang dùng `VN_DAY_EXPR = date(timestamp,'+7 hours')` — **phải quy
đổi, đừng ghi thẳng**.

### ⛔⛔ TIỀN: `actual_commission` đã là SỐ RÒNG — TUYỆT ĐỐI không cộng các thành phần

Tài liệu chính thức cảnh báo thẳng, và đây là cái bẫy đắt nhất của cả API:

```
actual_commission = actual_standard_commission        (HH chuẩn)
                  + actual_bonus_commission           (HH thưởng)
                  + actual_shop_ads_commission        (HH quảng cáo shop)
                  + shared_with_partner               ◀ ÂM — phần chia MCN
                  + pit                               ◀ ÂM — thuế TNCN 10%
                  + actual_creator_commission_reward_fee  ◀ ÂM — phí reward

ví dụ đơn 585510807483352367:  6.080 + 45.600 + 0 − 46.512 = 5.168
```

**Cả 6 field chỉ để hiện breakdown.** `actual_standard_commission` / `actual_bonus_commission` là số
**GỘP TRƯỚC KHI TRỪ**, nên cộng chúng vào là cộng ngược lại phần đã bị giữ ⇒ **trả thừa ~10 lần**
(cảnh báo nguyên văn của nhà cung cấp).

→ **Quy tắc cứng: lấy THẲNG `actual_commission`.** Cùng tinh thần với quy tắc Shopee "lấy thẳng
field `commission`, không nhân `ratePercent × price`" — và lần này hậu quả còn nặng hơn.

### ⚠️ `shared_with_partner` — phần MCN giữ, là SỐ ÂM

Tài liệu ghi *"Đa số creator = 0"*, nhưng ví dụ của chính họ cho thấy MCN giữ **46.512/51.680 = 90%**
hoa hồng. Chủ bot đã ký thoả thuận **0% tới 08/04/2027**, nên **kỳ vọng field này = 0**.

❓ **CHƯA KIỂM CHỨNG ĐƯỢC** — cả 2 đơn hiện có đều chưa `SETTLED` nên field này còn `null`.
**Đây là field quyết định toàn bộ bài toán kinh tế**: nếu nó khác 0, con số +56% so với Accesstrade
sụp đổ. Đơn `SETTLED` đầu tiên phải kiểm field này TRƯỚC MỌI THỨ KHÁC.

### ⚠️ `est_commission` KHÔNG trừ phần MCN

`est_commission` đã gồm thưởng + QC shop, **nhưng không trừ `shared_with_partner`**. Nghĩa là nếu
MCN có giữ phần thì **ước tính sẽ cao hơn thực nhận**. Đúng loại sai nguy hiểm mà Shopee đã dạy:
hứa cao hơn trả.

Với thoả thuận 0% hiện tại thì `est_commission` dùng được — nhưng **phụ thuộc vào `shared_with_partner`
đúng bằng 0**, không phải một sự thật độc lập.

### `pit` — TikTok ĐÃ khấu trừ thuế TNCN tại nguồn

> *"Thuế TNCN TikTok khấu trừ (**10% phần HH chuẩn**) — **áp cho cả creator thường**."* Số **ÂM**.

✅ Điều này **xác nhận rủi ro trừ thuế hai lần là THẬT**, không còn là giả thuyết. Xem rủi ro 3 trong
`rui-ro-tich-hop-tiktok.md`.

✅ **ĐÃ TRẢ LỜI (spec AI, 09/10/2026): `pit` NẰM TRONG `actual_commission`** — nó là một trong 6
thành phần, mang dấu âm. Nghĩa là **`actual_commission` đã trừ thuế rồi.**

→ ⛔ **TUYỆT ĐỐI không áp `taxPercent` 10% lần nữa cho đơn TikTok.** Shopee phải tự trừ vì báo cáo
Shopee đưa số **trước thuế**; TikTok thì đưa số **sau thuế**. Dùng chung một đường tính cho hai sàn
là trừ thuế hai lần cho user TikTok. Đây là khác biệt kiến trúc, không phải tham số cấu hình.

❓ Còn lại: chưa thấy giá trị thật (cả 2 đơn chưa `SETTLED`) nên chưa biết `pit` tính trên phần nào
**chính xác** — tài liệu field ghi *"10% phần HH chuẩn"*, nhưng chưa đối chiếu được bằng số.

### Ngữ nghĩa các field khác, đã đọc từ tài liệu chính thức

| Field | Ý nghĩa cần nhớ |
|---|---|
| `sku_id` | ✅ **Một đơn nhiều SKU = NHIỀU DÒNG**, mỗi dòng 1 SKU — y hệt Shopee, logic gộp đơn tái dùng được |
| `commission_rate` | Tỷ lệ **TỔNG** (chuẩn + thưởng + QC shop). `standard_commission_rate` mới là tỷ lệ gốc |
| `status` / `tt_order_status` | `1`/`100` pending · `2`/`103` settled · `3`/`104` cancelled-refunded |
| `settlement_status` | **Passthrough TikTok** — `AWAITING PAYMENT` · `To-SETTLE` · `SETTLED` · `REFUNDED`, và *"TikTok có thể bổ sung trạng thái khác"* → **bắt buộc có nhánh mặc định** |
| `update_time` | Lần cập nhật cuối — **KHÔNG phải ngày quyết toán** |
| `settled_at` | Ngày quyết toán **do RioHub tự ghi** (TikTok không trả mốc này). **Bị XOÁ về `null` nếu đơn chuyển huỷ/hoàn**, chốt lại thì nhận mốc mới → **không dùng làm mốc cố định**. `null` cả khi quyết toán trước 04/09/2026 hoặc muộn hơn 60 ngày kể từ ngày tạo |
| `time_delivered(_iso)` | Thời điểm giao hàng, `null` nếu **chưa giao** → field này **sẽ** được điền, xem rủi ro 2 |
| `*_iso` | **Nên dùng bộ này** — có hậu tố `Z` nên thư viện parse đúng UTC, không đọc nhầm thành giờ VN |
| Kiểu JSON | Số nguyên → *number*; **tiền/decimal và ID lớn → *string*** (giữ nguyên độ chính xác) |

⚠️ **Nhịp sync của RioHub là ~3 tiếng** cho mốc quyết toán (tài liệu: *"lệch so với TikTok tối đa
bằng nhịp sync ~3h"*), khác hẳn con số 17–19 phút đo được cho **đơn mới**. Hai loại cập nhật, hai
nhịp khác nhau.

### ❗ Ba thứ chưa verify, đang chặn thiết kế

1. ❓ **`time_delivered_iso = null`** dù `settlement_status` đã là `To-SETTLE`. Đây chính là **mốc mà
   cơ chế giam đơn giá trị lớn đếm 7 ngày từ đó** (với Shopee là cột "Thời gian hoàn thành"). Field
   có trong schema nhưng chưa thấy được điền. **Nếu không bao giờ điền thì phải chọn mốc thay thế —
   đó là quyết định của chủ bot, không phải mặc định kỹ thuật.**
2. ❓ **`pit` (thuế TNCN) = null.** Nếu TikTok **đã khấu trừ thuế tại nguồn** mà `commissionMath`
   lại trừ tiếp 10% như đang làm với Shopee thì **user bị trừ thuế hai lần**. Phải xem `pit` trên
   một đơn đã `SETTLED`.
3. ❓ **Vòng đời trạng thái** `AWAITING PAYMENT → To-SETTLE → SETTLED → REFUNDED` mới quan sát được
   tại **một điểm duy nhất**. Tài khoản chỉ có đúng 1 đơn.

## 2.7 Độ trễ dữ liệu — trần cho nhịp đồng bộ

✅ **ĐÃ ĐO BẰNG ĐỒNG HỒ (2026-10-09)** — đơn `586494603346282174`:

```
TikTok tạo đơn           08:38:20 UTC
API vẫn chưa thấy        08:54:50 UTC   (poll lần 3)
API đã thấy              08:57:51 UTC   (poll lần 4)
                         => trễ 17–19 phút
```

Khớp với tài liệu của họ ("đơn ghi nhận 5–30 phút").

> ⚠️ **ĐÃ SỬA MỘT KẾT LUẬN SAI.** Trước đó tài liệu này ghi "dữ liệu trễ tới ~1 tiếng", suy từ dòng
> *"Dữ liệu cập nhật: 1 giờ trước"* trên dashboard. Đo thật cho thấy sai: dòng đó nhiều khả năng là
> **lần dữ liệu THAY ĐỔI gần nhất** (lúc chụp màn chỉ có 1 đơn, từ hôm trước), **không phải độ cũ
> của dữ liệu**. Bài học: đừng suy độ trễ từ một nhãn trên giao diện, hãy bấm giờ một sự kiện thật.

→ **Nhịp đồng bộ hợp lý: 15–30 phút/lần**, dùng `update_time_start` = lần sync trước (mục 2.5).
Dày hơn 15 phút gần như chắc chắn phí lời gọi. Hạn mức 300 req/phút rộng hơn nhu cầu rất nhiều nên
rate limit không phải ràng buộc ở đây.

❓ Còn một lựa chọn chưa đánh giá: **webhook** (mục 2.2) đổi từ kéo sang đẩy. Đánh đổi: phải mở một
route công khai nhận POST, verify chữ ký, và trả `2xx` trong 5 giây — trong khi polling 20 phút/lần
thì gần như không có gì để hỏng.

✅ Cũng đo được: **partner API là bản sao trung thành của dashboard** — cả hai cùng báo `total=1` tại
cùng thời điểm. Không cần xây cơ chế đối chiếu chéo API ↔ dashboard, chúng là một.

## 2.8 Ước tính hoa hồng để báo cho user

Dùng cho tính năng bot báo số tiền ngay lúc trả link (tương đương `commissionLookup.ts` của Shopee).

✅ **BẮT BUỘC dùng `observed_commission.commission_rate`, KHÔNG dùng `commission.rate`.**
`commission.rate` là rate shop niêm yết, đo được thấp hơn thực tế: `500` vs `600`.

⚠️ **Nhưng `observed_commission` rất thưa: chỉ 1/10 sản phẩm có** (đo trên search "tai nghe
bluetooth"). Nó suy từ đơn đã phát sinh (`source: "orders"`), `scope` là `"creator"` (đơn của chính
mình) hoặc `"global"` (toàn sàn). Sản phẩm chưa ai bán gần đây → `null`.

→ Phần lớn link user gửi sẽ **phải lui về `commission.rate`**, tức **báo thấp hơn thực tế ~17%**.
Hướng lệch này **an toàn** (hứa ít hơn trả), **ngược hẳn bẫy của Shopee** là hứa cao hơn thực nhận.

Hai điểm khác biệt nữa so với Shopee:

- ✅ **TikTok không có trần hoa hồng** như Shopee (40k). Đơn GMV 524.250đ rate 11% ra đúng 57.667đ,
  không bị cắt → với TikTok **được phép tính `giá × rate`**, khác hẳn quy tắc cứng của Shopee là
  phải lấy thẳng field `commission`.
- ⚠️ `commission.amount` là **chuỗi KHOẢNG** với sản phẩm nhiều biến thể (`"250.00 - 735.00"`,
  `"25079.28 - 39073.08"`) → phải parse, lấy đầu thấp.

## 2.8b ⛔ CSV xuất từ dashboard KHÔNG dùng được làm nguồn dữ liệu

✅ **ĐÃ ĐO (2026-10-09)** — diff bằng máy: lấy `Object.keys()` từ chính response API của **đúng 2 đơn
có trong file CSV thật** của chủ bot, so với header CSV. **API 50 field · CSV 24 cột · thiếu 26.**
CSV **không có** field nào mà API thiếu.

**Đây là điểm khác biệt kiến trúc quan trọng nhất so với Shopee.** Shopee không có API nên đường ghi
nhận đơn **bắt buộc** là import CSV. Với TikTok thì **ngược lại: phải dùng API, CSV không đủ.**

### CSV thiếu 26/50 field, gồm TẤT CẢ field tiền

| Nhóm thiếu | Field |
|---|---|
| 💰 **Quyết định tiền** | `shared_with_partner` · `pit` · `actual_standard_commission` · `actual_shop_ads_commission` · `actual_creator_commission_reward_fee` |
| Gộp đơn nhiều SKU | **`sku_id`** — không có thì không tách được dòng của đơn nhiều SKU |
| Hoàn/huỷ một phần | `refunded_quantity` · `returned_quantity` · `fully_refunded` |
| Quy đơn về user | `sub1`…`sub4` |
| Mốc thời gian chuẩn | `time_created_iso` · `time_delivered_iso` · `settled_at_iso` |
| Khác | `price` · `shop_name` · `currency` · `tt_order_status` · `content_id` · `payment_status` · … |

Thiếu `shared_with_partner` và `pit` nghĩa là **không thể tính đúng số user thực nhận từ CSV** — hai
khoản trừ lớn nhất đều vô hình.

### Bốn bẫy biểu diễn dữ liệu trong CSV

1. ⛔ **`actual_commission = 0.00` trong khi API trả `null`** — đối chiếu **trên CÙNG một đơn**:

   | | đơn `586494603346282174` | đơn `586474851567371966` |
   |---|---|---|
   | CSV `actual_commission` | `0.00` | `0.00` |
   | API `actual_commission` | `null` | `null` |

   Cả 7 field tiền của 2 đơn này đều `null` trong API (vì chưa `SETTLED`). CSV **gộp "chưa quyết
   toán" thành "bằng 0"** — import thẳng là ghi nhận hàng loạt đơn hoa hồng 0đ như thật. Đúng cùng
   loại bẫy với `commission = 0` của Shopee và `commission_estimate` NULL-vs-0 của `/admin/links`.
2. ⚠️ **Không nhất quán cách biểu diễn rỗng**: `actual_commission` ra `0.00` nhưng
   `est_bonus_commission` / `actual_bonus_commission` lại ra **chuỗi rỗng**.
3. ⚠️ **`commission_rate` là chuỗi `"5%"` / `"6%"`**, không phải raw int `500`/`600` như API.
4. ⚠️ **Thời gian là GIỜ VN** (`15:38:20 9/10/2026`) trong khi API là **UTC**
   (`2026-10-09T08:38:20Z`). Trộn hai nguồn mà quên quy đổi là lệch **7 tiếng**.

→ **Kết luận: CSV là báo cáo cho người đọc, không phải nguồn cho máy.** Mọi đường ghi nhận đơn
TikTok đi qua `GET /orders`.

## 2.9 Ghép vào hệ thống hiện có

✅ **ĐÃ KIỂM**: tầng ledger và dashboard **đã merchant-agnostic** — không có chỗ nào hardcode
`merchant = 'shopee'`. `MerchantId` vẫn còn `"tiktokshop"`, config domain vẫn nằm trong
`RETIRED_MERCHANTS` (`src/core/merchants.ts`).

Nên khi đơn TikTok được ghi vào `commission_entries` với `merchant='tiktokshop'`, nó **tự động hiện**
ở `/admin/dashboard`, `/admin/orders`, `/admin/links` và dashboard user. Việc cần làm:

- chuyển `tiktokshop` từ `RETIRED_MERCHANTS` về `MERCHANTS`;
- viết provider mới implement `AffiliateProvider`, đăng ký trong `src/core/providers/index.ts`;
- thêm màu chip "TikTok Shop" trong `merchantChipClass()`;
- `dashboardHtml.ts` hiện chỉ tô màu riêng cho `shopee`, merchant khác về màu trung tính — không vỡ.

⚠️ Lưu ý `RETIRED_MERCHANTS` vẫn phải giữ Lazada: ledger thật còn entry `merchant='lazada'` và
`getMerchantConfig()` phải trả được, thiếu là crash `/admin/orders` khi render đơn cũ.

## 2.10 Cách chạy lại kiểm tra

Script probe nằm ngoài repo (scratchpad của phiên). Khung tối thiểu:

```js
const BASE = "https://riohub.vn/api/v1/partner/tiktok/affiliate";
const r = await fetch(`${BASE}/orders?creator_username=${CREATOR}&page=1&page_size=50`, {
  headers: { "X-Riohub-Api-Key": process.env.RIOHUB_API_KEY },
});
```

Khi thêm một tham số mới, **luôn kiểm bằng giá trị mà kết quả phải khác** (mục 2.5).

---

## Nhật ký verify

| Ngày | Việc | Kết quả |
|---|---|---|
| 2026-10-08 | Đo hệ số publisher Accesstrade trên 3 đơn thật | Giữ 35,8%, hệ số `0,6417` |
| 2026-10-08 | Gọi thử 7 endpoint RioHub | 5/7 trả `403 mcn_membership_required` |
| 2026-10-09 | Gọi lại sau khi được duyệt MCN | **7/7 trả 200** |
| 2026-10-09 | Thoả thuận chia doanh thu trong app TikTok | Phí MCN **0%**, hạn 08/04/2027, không huỷ đơn phương |
| 2026-10-09 | `POST /links`, `/product-links` với subId 4 đoạn | Giữ nguyên, tách đúng `sub1..sub4` |
| 2026-10-09 | `POST /general-links` | **Ghi đè sub_id** → không dùng được |
| 2026-10-09 | Liệt kê `channel` của `GET /links` | Chỉ thấy link tạo qua partner API |
| 2026-10-09 | Thử lọc ngày `GET /orders` | **Bị bỏ qua âm thầm**, luôn trả toàn bộ lịch sử |
| 2026-10-09 | Dò endpoint tiền | 404 toàn bộ → ví CAST ngoài tầm với |
| 2026-10-09 | `observed_commission` trên 10 sản phẩm | Chỉ 1/10 có |
| 2026-10-09 | Dashboard RioHub | Trễ dữ liệu ~1 tiếng; API khớp dashboard |
| 2026-10-09 | Đơn thử của user qua link app RioHub | Lên sau **17–19 phút**; **sub_id về nguyên văn** → mắt xích link→đơn THÔNG |
| 2026-10-09 | Đơn đầu tiên sau khi vào MCN | `commission_bonus_rate` vẫn `0` → chưa thấy bonus MCN |
| 2026-10-09 | Đo lại độ trễ bằng đồng hồ | **Sửa kết luận sai "1 tiếng"** → thực tế 17–19 phút |
| 2026-10-09 | Đọc tài liệu chính thức `data.addlivetag.com/tiktok/` | Lấy được 3 tên miền, bảng mã lỗi, webhook, hạn mức |
| 2026-10-09 | Test lại bộ lọc `GET /orders` bằng tên tham số đúng | **Sửa kết luận sai "không lọc được"** → lọc đầy đủ; bẫy thật là sai định dạng bị nuốt im lặng |
| 2026-10-09 | **SỰ CỐ THẬT 17:28–17:35 VN** — cả 3 tên miền `500 server_error`, web vẫn 200 | Tên miền dự phòng KHÔNG cứu được; hồi phục sau vài phút, **dữ liệu nguyên vẹn**; xem rủi ro 4 |
| 2026-10-09 | Đối chiếu CSV dashboard với API | **CSV thiếu 26/50 field gồm cả 5 field tiền** → không dùng làm nguồn dữ liệu |
| 2026-10-09 | Lập bản đồ hình dạng lỗi thật (10 ca) | Khuôn `error.code` thống nhất; **403 của tài liệu không tái hiện được**; phát hiện bẫy `GET /products` trả 200 khi không thấy |

## Việc còn treo

- [ ] Đơn thật đi hết vòng đời → chốt `time_delivered_iso`, `pit`, `settlement_status`
- [x] ~~Đơn qua link **có sub_id** → chốt mắt xích link → đơn~~ ✅ 2026-10-09
- [ ] Chạy lại với sub_id **4 đoạn** của bot qua một đơn thật (khoảng hở nhỏ còn lại, mục 2.3)
- [ ] Xem `commission_bonus_rate` trên một đơn đã **`SETTLED`** (tại lúc tạo đơn thì đã đo: vẫn `0`)
- [x] ~~Hỏi RioHub tên 3 miền dự phòng~~ ✅ 2026-10-09 (mục 2.1, kèm quy tắc failover phải bắt cả lỗi TLS)
- [ ] Rotate API key trước khi lên production
- [ ] Quyết định nhịp đồng bộ (tự động vs bấm tay) — trần kỹ thuật đã rõ: 15–30 phút/lần
- [ ] Cân nhắc webhook thay polling; nếu dùng thì verify chữ ký `X-Riohub-Signature` (mục 2.2)
- [ ] Tìm tên đúng của tham số lọc theo **ngày tạo** (`create_time_start` bị nuốt)
- [ ] Quyết định mốc giam đơn nếu `time_delivered_iso` không bao giờ được điền
- [ ] Xem lại điều khoản trước 08/04/2027
