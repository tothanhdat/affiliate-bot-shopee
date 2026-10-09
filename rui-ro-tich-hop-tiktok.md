# Rủi ro cần giải quyết khi tích hợp TikTok Shop (qua RioHub)

Rà soát ngày 2026-10-09, dựa trên **gọi API thật** bằng key của chủ bot (7/7 endpoint, 2 đơn thật)
và đọc tài liệu chính thức `https://data.addlivetag.com/tiktok/` — không phải suy đoán quy trình.
Hồ sơ kỹ thuật/business đầy đủ: `docs/riohub-tiktok.md`.

Trạng thái tích hợp khi lập file này: **chưa viết dòng code nào.** Mọi rủi ro dưới đây đều còn mở.

Quy ước trạng thái:
- **CHỜ DỮ LIỆU** — chỉ thời gian mới giải được, không đọc thêm tài liệu nào ra.
- **CẦN QUYẾT ĐỊNH** — đủ thông tin rồi, chờ chủ bot chọn hướng.
- **CHỦ ĐỘNG GIẢM ĐƯỢC** — có thể đi tìm câu trả lời ngay.

> **Nguyên tắc giữ file (yêu cầu của chủ bot 2026-10-09): rủi ro nào giải quyết xong thì XOÁ HẲN
> khỏi file**, không giữ lại kèm nhãn "đã fix" — để mở file ra là thấy đúng phần việc còn lại.
> Dữ kiện kỹ thuật của mục bị xoá vẫn nằm trong `docs/riohub-tiktok.md`, không mất.

---

## Nghiêm trọng nhất

### 1. Toàn bộ thiết kế đang đứng trên 2 đơn, cả 2 cùng một trạng thái

**Trạng thái: CHỜ DỮ LIỆU.**

Chưa quan sát được **một lần nào** các trạng thái `SETTLED`, `REFUNDED`, hay huỷ. Cả 2 đơn thật
(`586474851567371966` ngày 08/10, `586494603346282174` ngày 09/10) đều đứng ở `To-SETTLE`.

Trong khi đó, thứ quyết định **tiền có vào ví user hay không** chính là bảng ánh xạ
`settlement_status` → trạng thái entry (`pending`/`confirmed`/`reversed`).

Đối chiếu để thấy mức độ: logic import Shopee có **bảng quyết định 5 ca**, dựng từ **14 báo cáo
thật**, và vẫn lòi ra lỗ hổng nghiêm trọng ngày 08/10/2026 — đơn `confirmed` chưa rút mà bị huỷ thì
không nhánh nào thu hồi, tiền lấy lại được nhưng vẫn nằm trong Khả dụng của user. TikTok hiện có
**2 đơn, 1 trạng thái, 0 báo cáo thật**.

Rủi ro không nằm ở việc map sai cái đã thấy, mà ở **cái chưa thấy bao giờ**.

**Giải bằng**: đơn thật đi hết vòng đời — của chính chủ bot, **hoặc xin dữ liệu của creator khác**.

⚠️ **Nếu xin của người khác thì phải xin JSON từ API, KHÔNG phải CSV.** Đã đo: CSV dashboard thiếu
26/50 field gồm toàn bộ field tiền (`shared_with_partner`, `pit`, …) và cả `sku_id` — xem mục 2.8b
trong `docs/riohub-tiktok.md`. Lệnh cần nhờ họ chạy bằng **key của chính họ** (tuyệt đối không xin key):

```
curl 'https://riohub.vn/api/v1/partner/tiktok/affiliate/orders?creator_username=TEN&status=2&page_size=5' \
  -H 'X-Riohub-Api-Key: KEY_CUA_HO'
```

Đổi `status=2` (đã quyết toán) thành `status=3` (huỷ/hoàn) để lấy đủ ca. Hỏi thêm họ **có đang ở MCN
nào không** — câu đó quyết định cách đọc `shared_with_partner` của họ.

Khi có, phải dựng bảng quyết định đủ ca **trước khi** viết nhánh import, không vừa viết vừa đoán.

### 2. `time_delivered_iso` luôn `null` — cơ chế giam đơn không có mốc để đếm

**Trạng thái: CHỜ DỮ LIỆU.**

Field có trong schema nhưng cả 2 đơn đều `null`, kể cả đơn đã `To-SETTLE`. Đây chính là mốc mà
`resolveAvailableFrom()` đếm 7 ngày từ đó (với Shopee là cột "Thời gian hoàn thành").

Nếu nó không bao giờ được điền thì chỉ còn hai lối, **cả hai đều tệ**:

- **Bỏ giam đơn cho TikTok** → một đơn to bị trả hàng là xoá sạch lợi nhuận tháng. Số liệu thật từ
  báo cáo Shopee 01/10/2026: **2 trong 46 dòng chiếm 35,8% hoa hồng cả tháng**.
- **Đếm từ `time_created`** → giam sớm hơn thực tế, và **không giải thích được cho user**: cả lập
  luận trên trang `/so-tay` đang dựa vào "mốc 15 ngày của Shopee, user kiểm chứng được". Lấy ngày
  đặt hàng làm mốc thì không tương ứng với quy định nào của TikTok cả.

**Giải bằng**: đơn `586494603346282174` khi giao hàng xong. Vài ngày nữa.

### 3. `shared_with_partner` — MCN có thể giữ phần hoa hồng, và field này là sự thật cuối cùng

**Trạng thái: CHỜ DỮ LIỆU — đây là field quyết định TOÀN BỘ bài toán kinh tế.**

Thoả thuận trong app TikTok ghi RioMedia thu **0%** tới 08/04/2027, và tài liệu RioHub cũng nói
*"đa số creator = 0"*. Nhưng **ví dụ trong chính tài liệu của họ** cho thấy MCN giữ tới **90%**:

```
đơn 585510807483352367:  6.080 + 45.600 + 0 − 46.512 = 5.168
                         chuẩn   thưởng       MCN giữ   creator nhận
                                              46.512/51.680 = 90%
```

**Nếu `shared_with_partner` khác 0 trên đơn thật, con số +56% so với Accesstrade sụp đổ** — thậm chí
có thể tệ hơn Accesstrade (bên đó giữ 35,8%).

Hai hệ quả phải nhớ khi viết code:

- ⛔ **Lấy THẲNG `actual_commission`**, không bao giờ cộng lại từ các thành phần. Cảnh báo nguyên văn
  của nhà cung cấp: cộng thêm là **trả thừa ~10 lần**. Cùng loại bẫy với quy tắc Shopee "lấy thẳng
  field `commission`, không nhân `rate × price`".
- ⚠️ **`est_commission` KHÔNG trừ phần MCN** → nếu MCN có giữ phần thì ước tính báo cho user sẽ
  **cao hơn thực nhận**. Đúng hướng sai nguy hiểm mà Shopee đã dạy.

**Việc phải làm**: đơn `SETTLED` đầu tiên — kiểm `shared_with_partner` **TRƯỚC MỌI THỨ KHÁC**.

### 4. Phụ thuộc runtime vào RioHub trên đường sống — ĐÃ CÓ SỰ CỐ THẬT, 2 lần trong 11 ngày

**Trạng thái: CẦN QUYẾT ĐỊNH — mức độ đã được nâng lên sau sự cố 09/10/2026.**

#### Bằng chứng đo trực tiếp, 09/10/2026 17:28 giờ VN

```
riohub.vn             GET /orders   HTTP 500  {"error":{"code":"server_error"}}   502ms
riohub.riokupon.com   GET /orders   HTTP 500  server_error                        450ms
riohub.riokupon.me    GET /orders   HTTP 500  server_error                        388ms
(POST /links — đường tạo link — cũng 500 ở cả ba tên miền)

Trang web thường:     cả 3 miền HTTP 200, 53-62ms
```

#### Diễn biến hồi phục — đo liên tục 5 phút/lần

```
17:28:56  vn=500   com=500            me=500
17:30:10  vn=500   com=TIMEOUT        me=500     ← hỏng KHÔNG đồng nhất giữa 3 miền
17:35:30  vn=200   com=200            me=200     ✅ sống lại
```

**Sập ngắn — chỉ vài phút** (quan sát từ 17:28, chủ bot phát hiện trước đó nên tổng thời gian thật
dài hơn, nhưng vẫn ở mức phút chứ không phải giờ). **Dữ liệu còn nguyên vẹn** sau sự cố: `GET /orders`
vẫn 2 đơn, `GET /links` vẫn 3 link, số liệu khớp từng đồng với trước đó — **không mất mát, không sai lệch.**

→ Điều này **ủng hộ mốc "thử lại sau 30 phút"** của chủ bot cho loại sự cố này. Lưu ý sự cố 29/09
thuộc loại khác hẳn (tầng kết nối, 4 ngày mới xong) — hai loại hỏng, hai thang thời gian.

**Ba điều rút ra, đều quan trọng:**

1. **Tên miền dự phòng KHÔNG cứu được ca này.** Cả 3 cùng chết, đúng như tài liệu của họ tự nói
   *"cùng hệ thống, cùng dữ liệu"*. Lỗi nằm ở **backend dùng chung**, không phải ở DNS/TLS/edge.
   Trang web vẫn 200 nên nhìn từ ngoài tưởng hệ thống khoẻ.
2. **Chính quy tắc failover của RioHub cũng vô hiệu ở đây.** Họ hướng dẫn "`4xx`/`5xx` thì ĐỪNG đổi
   tên miền" — đúng về mặt kỹ thuật, nhưng hệ quả là **ca này không có đường lui nào cả**.
3. **Fail nhanh (300–500ms), không treo.** Điểm tốt duy nhất: bot sẽ biết ngay chứ không bắt user
   chờ timeout. Thiết kế được một câu trả lời tử tế trong vòng nửa giây.

#### Tần suất quan sát được

| Ngày | Sự cố |
|---|---|
| 29/09/2026 | `riohub.vn` trả chứng chỉ TLS sai tên miền — chết ở tầng kết nối (tài liệu của họ ghi nhận) |
| 09/10/2026 | **Cả 3 tên miền `HTTP 500 server_error`** — chết ở tầng ứng dụng (tự đo). Hồi phục sau **vài phút**, dữ liệu nguyên vẹn |

**Hai sự cố trong 11 ngày, hai tầng hỏng khác nhau.** Đây là tần suất quan sát được, không phải suy
đoán — và nó nói rằng "nhà cung cấp nhỏ" là rủi ro thật chứ không phải lo xa.

#### Vì sao nghiêm trọng hơn mọi phụ thuộc hiện có

Shopee đi qua `an_redir` **tự dựng**, không phụ thuộc bên nào. Lớp tra hoa hồng `addlivetag` tuy là
bên thứ ba nhưng **mọi đường thất bại đều trả `null`** và bot vẫn gửi link bình thường — hỏng thì
mất một dòng chữ, không mất chức năng.

TikTok qua RioHub thì khác hẳn: **RioHub chết là không tạo được link nào.** Đây là phụ thuộc runtime
đầu tiên nằm chắn ngang đường user đang chờ.

#### ✅ ĐÃ QUYẾT (2026-10-09): RioHub sập thì bot báo bảo trì, KHÔNG trả link gốc

Quyết định của chủ bot — nội dung báo cho user:

> **Hệ thống Affiliate của Tiktok đang bảo trì, hãy thử lại sau 30 phút nữa**

Tức là **không** chọn hướng trả link gốc không gắn affiliate. Khác với ca `noCommission` của Shopee
(vẫn trả link vì sản phẩm có thật, chỉ là không có hoa hồng), ở đây bot **không tạo được link nào**
nên không có gì để trả — bảo user quay lại sau là trung thực hơn.

Hai thứ kèm theo vẫn bắt buộc:
- Lỗi TikTok **không được làm hỏng link Shopee** trong cùng một tin nhắn.
- **Cảnh báo admin ngay lần hỏng đầu** qua `createAdminNotifier` (đã có sẵn).

**Hai lưu ý khi triển khai, cần chủ bot xác nhận lại:**

1. ⚠️ **Câu này quy lỗi cho TikTok trong khi bên sập là RioHub.** Với user thì không thể nhắc tên
   RioHub (họ không biết đó là ai), nhưng nói "TikTok đang bảo trì" là sai sự thật — TikTok vẫn
   chạy bình thường, user mở app vẫn mua được. Phương án giữ đúng sự thật mà không lộ nhà cung cấp:
   *"Hệ thống tạo link TikTok đang bảo trì…"*.
2. ⚠️ **"30 phút" hợp lý cho sự cố ngắn, nhưng không phải mọi loại.** Sự cố 09/10 (tầng ứng dụng)
   chỉ kéo dài **vài phút** → mốc 30 phút là thừa đủ. Nhưng sự cố 29/09 (tầng kết nối) phải tới
   **03/10 mới xong — 4 ngày**. Nếu gặp lại loại thứ hai, user sẽ nhận đúng câu này mỗi 30 phút suốt
   nhiều ngày, và lời hẹn lặp lại mà không thành thì tệ hơn là không hẹn.

→ **Khuyến nghị: đưa câu này thành template trong `SETTINGS_REGISTRY`** (ví dụ
`tiktokProviderDownTemplate`) thay vì hardcode, để admin sửa cả câu chữ lẫn mốc thời gian ngay trên
`/admin/settings` khi đang có sự cố, không cần deploy. Đúng pattern đang dùng cho toàn bộ tin nhắn
bot. **Nhớ cái bẫy chung**: instance đã từng bấm Lưu thì giá trị trong DB đè lên default trong code.

## Rủi ro vừa

### 5. `422 product_not_promotable` — user gửi link hợp lệ nhưng không tạo được link affiliate

**Trạng thái: CẦN QUYẾT ĐỊNH.**

Tài liệu: *"sản phẩm không có hoa hồng, chưa được shop duyệt, hoặc bị TikTok hạn chế"*. Đây **không
phải lỗi hệ thống** mà là câu trả lời thật về sản phẩm.

**Nghiêm trọng hơn ca `noCommission` của Shopee**: ở Shopee bot vẫn trả được link (chỉ là 0đ hoa
hồng, user vẫn mua được món họ cần — đánh đổi đã chọn). Ở đây **không có link nào để trả**.

Cần một câu trả lời riêng, **không gộp vào nhánh lỗi chung** "hệ thống đang bảo trì" — vì bảo user
thử lại sau 30 phút là sai: 30 phút nữa sản phẩm đó vẫn không có hoa hồng.

### 6. `424 creator_token_invalid` — vẫn chưa biết hình dạng thật

**Trạng thái: ĐÃ GIẢM, CÒN LẠI PHẦN NHỎ (2026-10-09).**

Đã lập bản đồ lỗi thật bằng 10 ca gọi hỏng có chủ đích (xem *Hình dạng lỗi THẬT* trong
`docs/riohub-tiktok.md`). Thu được: mọi lỗi về cùng khuôn `{"error":{"code","message"}}` với
`error.code` đọc được bằng máy, và **quy tắc map lỗi đã chốt** — rẽ nhánh theo `error.code`, mọi mã
lạ rơi vào nhánh mặc định **có cảnh báo admin**, `validation_error` thì không retry.

Nhờ quy tắc đó, kể cả `424` có hình dạng gì thì bot cũng **không chết câm** — nó sẽ rơi vào nhánh
mặc định và admin được báo. Đây là phần đã giải.

**Phần còn lại**: vẫn chưa biết `error.code` thật của ca token hết hạn, nên **chưa viết được thông
báo riêng** ("cần vào RioHub kết nối lại tài khoản") thay cho câu lỗi chung chung. Không ép được ca
này xảy ra; chỉ chờ nó tự xảy ra rồi đọc log.

**Phát hiện kèm theo, mức độ nghiêm trọng hơn cả mục gốc**: `GET /products` trả **HTTP 200** khi
không tìm thấy sản phẩm (`found: 0`, `not_found: [...]`). Code chỉ kiểm `response.ok` sẽ đi tiếp với
`products[0] === undefined`. Đã ghi vào `docs/riohub-tiktok.md`; **phải kiểm `found`/`not_found`**
khi viết lớp tra hoa hồng.

⚠️ Thêm một chỗ tài liệu sai: `403` mà tài liệu mô tả ("creator không thuộc tài khoản của API key")
**không tái hiện được** — creator của người khác cũng ra `404 not_found` y hệt creator không tồn tại.
Không phân biệt được hai ca này từ phía client.

### 7. subId 4 đoạn của bot chưa chạy qua một đơn thật

**Trạng thái: CHỜ DỮ LIỆU.**

Mắt xích link→đơn **đã thông** (đơn `586494603346282174` trả về nguyên văn `sub_id` + `trace_id` +
`trace_type: "SPECIFIC"`), nhưng mới chứng minh với chuỗi **2 đoạn** do app RioHub sinh
(`u35008-m1791535058`). Chuỗi **4 đoạn** của bot (`{mã}-{userId}-{ts36}-{random}`) đã đo được cơ chế
tách đúng lúc **tạo link**, chưa đi qua một đơn thật.

Rủi ro còn lại thấp, nhưng đây là đường quy tiền về user nên không nên dừng ở mức "chắc ổn".

**Lưu ý đã biết**: `sub3`/`sub4` của đơn không có subId là **chuỗi rỗng, không phải `null`** →
phân biệt bằng `sub_id !== ""`, dùng `=== null` là sai.

### 8. Webhook — chưa verify một dòng nào

**Trạng thái: CẦN QUYẾT ĐỊNH (chỉ khi chọn hướng webhook).**

Thuật toán ký `X-Riohub-Signature`, trường nào được đưa vào chữ ký, hành vi retry (tối đa 6 lần,
phải trả 2xx trong 5 giây) — **tất cả đều là chép từ tài liệu**, chưa chạm vào.

Đánh đổi so với polling: webhook cần mở một route công khai nhận POST và verify chữ ký đúng; còn
polling 20 phút/lần thì gần như không có gì để hỏng. Với quy mô hiện tại, polling nhiều khả năng là
lựa chọn đúng — nhưng chưa quyết.

---

## Rủi ro nhỏ

### 9. Chưa biết MCN có thật cho x1.5 rate không

**Trạng thái: CHỜ DỮ LIỆU.** Đơn đầu tiên phát sinh **sau** khi vào MCN vẫn cho
`commission_bonus_rate = 0`, `shared_with_partner = null`. Còn khả năng nó chỉ hiện lúc `SETTLED`.

Nhẹ vì: ảnh hưởng **dự báo doanh thu**, không ảnh hưởng đúng/sai. Con số **+56%** so với Accesstrade
**không dựa vào khoản này**.

### 10. `observed_commission` chỉ có ở 1/10 sản phẩm

**Trạng thái: ĐÃ LƯỢNG HOÁ, CHẤP NHẬN ĐƯỢC.** Phần lớn link user gửi sẽ phải lui về
`commission.rate` (rate shop niêm yết), báo **thấp hơn thực tế ~17%**.

Nhẹ vì **lệch về phía an toàn** — hứa ít hơn trả, ngược hẳn bẫy của Shopee là hứa cao hơn thực nhận.
Vẫn phải giữ chữ "ước tính" trong tin nhắn.

### 11. Thoả thuận MCN 0% hết hạn 08/04/2027

**Trạng thái: CẦN ĐẶT LỊCH.** Sau mốc này điều khoản chưa biết. Thêm nữa: thoả thuận **không huỷ đơn
phương được** — muốn thoát phải huỷ liên kết và cần RioMedia đồng ý.

---

## Hai thứ không phải rủi ro kỹ thuật nhưng phải nhớ

- **Tiền CAST không được trộn vào sổ bot.** Ví RioHub chứa cát-xê chiến dịch — là công làm nội dung
  của chủ bot, không phát sinh từ đơn của user nào. Cộng nhầm sẽ làm hệ thống tưởng có tiền chưa
  chia và **tính sai phần của user**. Về kỹ thuật thì đã tự tách sẵn (partner API không có endpoint
  tiền nào), nhưng nếu sau này nhập tay thì đây là chỗ sai đầu tiên.
- **Đơn không qua bot vẫn vào `GET /orders`.** Endpoint này là creator-wide, nên đơn cá nhân của chủ
  bot cũng nằm trong feed (`sub_id: ""`, `trace_type: null`). **Tuyệt đối không gán cho user nào** —
  đúng quy tắc `skippedNoSubId` đã áp dụng cho Shopee, hoa hồng đó mặc nhiên là lợi nhuận riêng của
  chủ bot. `trace_type: "SPECIFIC"` cho tín hiệu sạch hơn chuỗi `sub_id` rỗng.
