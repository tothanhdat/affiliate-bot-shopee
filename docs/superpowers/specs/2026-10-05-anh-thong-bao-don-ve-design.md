# Ảnh thông báo "đơn về" — thiết kế (2026-10-05)

## Vấn đề

Khi đơn được xác nhận, bot gửi cho user một tin văn bản thuần do `formatOrdersConfirmedReply`
sinh ra (`src/adapters/shared/replyText.ts`). Với nhiều đơn, nó là một khối chữ dài nối bằng
dấu `/`, user đọc rối và không thấy được cảm giác "tiền về".

Thay bằng **một tấm ảnh** render từ template do chủ bot thiết kế, gửi kèm một dòng caption
ngắn chứa link dashboard.

## Quyết định đã chốt

| Vấn đề | Quyết định |
|---|---|
| Cách render | satori (layout → SVG) + `@resvg/resvg-js` (SVG → ảnh), chạy trong process |
| Ảnh sản phẩm trong thẻ | **Không có.** Hệ thống không lưu ảnh sản phẩm ở đâu cả |
| Tiêu đề | Giữ chữ in sẵn trên ảnh nền, chỉ điền số đơn vào khe trống |
| Số thẻ tối đa | 3 (3 đơn tiền cao nhất), dư thì thêm dòng "+N đơn khác" |
| Tổng cộng | Tổng **tất cả** đơn, không phải tổng 3 thẻ đang hiện |
| Định dạng gửi | JPEG chất lượng 88 (~120–160KB, nhẹ hơn PNG ~5 lần) |
| Phạm vi | Chỉ thông báo đơn về. Các tin khác giữ nguyên văn bản |

### Vì sao không dùng Puppeteer hay Canva API

- **Puppeteer**: khớp 100% nhưng Chromium ngốn ~300MB disk + ~250MB RAM thường trú trên
  Railway (tiền thật hàng tháng), cold start ~2s, và là nguồn gãy deploy phổ biến nhất.
- **Canva Connect API**: cần gói Canva trả phí, template phải là Brand Template, API chạy job
  bất đồng bộ vài giây/ảnh + rate limit + phụ thuộc mạng.

satori + resvg đo thật: lần đầu ~280ms (nạp font), các lần sau **130–190ms**, không gọi mạng,
thêm ~25MB `node_modules`.

### Vì sao không có ảnh sản phẩm

Đã kiểm tra hết các nguồn:

- Bảng `requests` (`logStore.ts`) không có cột ảnh. `item_id` thì moi được từ `origin_link`
  trong `affiliate_url`, nhưng từ `item_id` vẫn cần một nguồn khác để ra URL ảnh.
- Báo cáo Shopee chỉ có cột "Tên Item".
- API `data.addlivetag.com` **không dò được fields**: từ 01/10/2026 bên đó bắt buộc API key,
  gọi không key trả `{"status":"error"}`. Chưa biết nó có trả URL ảnh hay không.

Nếu sau này muốn thêm ảnh sản phẩm: lấy API key addlivetag, dò `productInfo` xem có trường ảnh
không, rồi tra theo `item_id` moi từ `affiliate_url`. Đừng lưu URL ảnh lúc tạo link — đơn
pending đang chờ sẽ không có.

## Hình ảnh

Khung render **1408×768** (đúng một nửa template gốc 2816×1536).

### Asset trong repo

| File | Nội dung |
|---|---|
| `bg.jpg` | Template của chủ bot, hạ xuống 1408×768, JPEG q92 (~89KB) |
| `moneybag.png` | 💰 cắt từ chính ảnh nền, nền trong suốt, 42×58 |
| `PlayfairDisplay-Bold.ttf` | font "Display" — số đơn + dòng Tổng cộng |
| `BeVietnamPro-Regular.ttf` / `-Bold.ttf` | font "Body" — chữ trong thẻ + dòng số dư |

**Cách dựng lại 2 asset ảnh nếu template đổi** (làm 1 lần, bằng script rời, không nằm trong
đường chạy production):

1. Khoanh vùng 💰 in sẵn trên template gốc (2816×1536): `x 1861–1946, y 1358–1473`.
2. Cắt nó ra, tạo alpha bằng cách so từng pixel với nền ước lượng (nội suy ngang từ 2 cột
   cách bbox 14px) — khoảng cách màu < 26 thì trong suốt, > 52 thì đục, ở giữa thì chuyển dần.
   Thu nhỏ 1/2 → `moneybag.png`.
3. **Xoá 💰 khỏi nền**: tô đè vùng `x 1853–1954, y 1350–1481` bằng chính phép nội suy ngang đó.
   Nền chỗ này là gradient mượt nên liền mạch (đo lại: lệch 1 đơn vị màu). Bắt buộc phải xoá,
   nếu không phần dưới của 💰 sẽ thò ra ngoài ô Tổng cộng.
4. Resize template đã xoá 💰 xuống 1408×768, JPEG q92 → `bg.jpg`.

### Toạ độ (hệ 1408×768)

```
SLOT số đơn   cx 552, cy 150, hộp 96×68
Thẻ           y 206, cao 340, rộng 395, x = [90, 508, 927], khe 23
"+N đơn khác" y 552, cao 24
Ô Tổng cộng   x 381, y 586, rộng 622, cao 78
Dòng số dư    y 678, cao 50          → chừa 40px mép dưới
```

Toạ độ ngang của thẻ và khe số đơn **đo trực tiếp từ 2 file template**, không ước lượng. Khe
số đơn là khoảng trắng giữa chữ "CÓ" (kết thúc x=1009 ở hệ 2816) và chữ vàng "ĐƠN" (bắt đầu
x=1202) → tâm 1105, chia đôi còn 552.

Chiều dọc thì **không** lấy từ template: bản đầu để thẻ cao 400 theo đúng ảnh mẫu, kết quả là
thẻ rỗng ruột còn ô Tổng cộng + dòng số dư bị dồn vào 159px cuối và chỉ chừa 10px mép dưới.

### Màu và cỡ chữ

| Thành phần | Giá trị |
|---|---|
| Số đơn | Display 72, `#ffd79b`, đổ bóng `0 3px 7px rgba(132,72,14,.55)` |
| Thẻ | nền `linear-gradient(180deg,#fdfffe,#e4f1e7)`, viền 2px `#caecdb`, bo 30 |
| Huy hiệu số thứ tự | 50×50 tròn, `linear-gradient(180deg,#f7d294,#e2a555)`, Display 28 trắng |
| Tên sản phẩm | Body 25, line-height 1.32, `#2f3e35`, căn giữa, **cắt ở 4 dòng** |
| Số tiền trong thẻ | Body Bold 44, `#c2762a` |
| Ô Tổng cộng | `linear-gradient(180deg,#feddb0,#e99c56)`, viền 2px `#ffe4bb`, bo 39 |
| Chữ "Tổng cộng:" | Display 39 trắng — số tiền Display 41 `#fff4d2` |
| 💰 trong ô | 34×47 |
| Dòng số dư | nền `#fdfaf2`, viền 2px `#f2d9ae`, bo 25, Body Bold 27 |
| Chữ dòng số dư | `#4a3a24` — số tiền `#b45f0c` |
| "+N đơn khác" | Body Bold 21, `#9c5f18` |

**Hai cái bẫy tương phản đã gặp thật, đừng lặp lại:**

1. Chữ sáng đặt trần trên nền cam thì **chìm**, càng sáng càng chìm. Chữ vàng in sẵn trên
   template nổi được là nhờ có bóng đổ tối. Nên số đơn bắt buộc phải có `textShadow`.
2. Dòng số dư từng thử để chữ trần + số vàng trên nền cam — số tiền gần như không đọc được.
   Phải bọc trong viền kem, chữ nâu đậm. Đây là lý do dòng đó có nền riêng chứ không phải
   để trang trí.

### Luật bố cục

- **Dưới 3 đơn**: căn giữa cả cụm thẻ, không để dính vào ô trái của lưới 3 cột.
- **Trên 3 đơn**: hiện 3 đơn **tiền cao nhất**, thêm dòng "+N đơn khác".
- **Tên sản phẩm dài**: cắt ở 4 dòng kèm "…". `lineClamp` của satori **chỉ ăn khi
  `display: "block"`** — để `"flex"` thì nó im lặng bỏ qua, tên dài tràn thành 5 dòng và đè
  lên số tiền. Phải có test cho tên cực dài.

## Dữ liệu

Ảnh cần 3 thứ ngoài danh sách đơn:

| Dữ liệu | Nguồn |
|---|---|
| Danh sách đơn (tên, tiền) | `ConfirmedOrderItem[]` có sẵn từ `summarizeOrderResultsByUser` |
| Số dư khả dụng | `LedgerStore.getAvailableBalance(platform, userId)` |
| Ngưỡng rút | `LedgerStore.getWithdrawalThresholdVnd(env.withdrawal.thresholdVnd)` |

**Thứ tự đọc là then chốt**: số dư phải đọc **sau** khi đã ghi nhận các đơn mới vào ledger.
Đọc trước thì ảnh báo số dư thiếu đúng mấy đơn vừa về — user đối chiếu ngay trong cùng tấm ảnh
sẽ thấy "Tổng cộng" cộng vào mà "Số dư" không đổi.

Dòng số dư có **hai trạng thái loại trừ nhau**, không bao giờ hiện cả hai:

- `available >= threshold` → `Số dư khả dụng: {available} — Có thể rút tiền 💰`
- `available < threshold` → `Số dư khả dụng: {available} — Tích luỹ thêm {threshold-available} để rút tiền`

## Kiến trúc

### Module mới `src/core/orderImage/`

Nằm trong core: satori và resvg không biết gì về Express/Telegraf nên không phá ranh giới
core/adapter.

- **`orderImageLayout.ts`** — hàm thuần, biến input thành view model: chọn 3 đơn tiền cao nhất,
  đếm phần dư, tính tổng **tất cả** đơn, dựng nhãn, quyết định trạng thái dòng số dư, format
  tiền qua `formatVnd` có sẵn. Không đụng tới render nên test được độc lập, không cần font.
- **`orderImageRenderer.ts`** — nhận view model, trả `{ data: Buffer, width, height }`.
- **`assets/`** — 4 file ở bảng trên.

Không dùng JSX (repo chưa cấu hình, thêm vào sẽ phải sửa tsconfig): dựng cây satori bằng một
helper `h()` nhỏ.

### Build

`tsc` không copy file nhị phân sang `dist/`. Phải thêm bước copy assets vào `npm run build`.
**Quên bước này thì chạy local ngon mà lên Railway crash vì không thấy font** — đây là kiểu lỗi
chỉ lộ ra sau khi deploy.

### Đường gửi

`notifyUser` hiện là `(platform, userId, message: string)`, khai báo ở `src/index.ts` và nhận
vào `createServer` (`src/api/server.ts:129`). Đổi tham số cuối thành:

```ts
type OutgoingNotification = { text: string; image?: OutgoingImage };
type OutgoingImage = { data: Buffer; width: number; height: number; filename: string };
```

Ảnh là tuỳ chọn, nên **fallback chính là bỏ trống `image`** — không cần nhánh `if` riêng ở
từng chỗ gọi. Bốn chỗ gọi hiện có trong `server.ts` (dòng 365, 482, 748, 833) đổi thành
`{ text: ... }`; chỉ 2 chỗ dùng `formatOrdersConfirmedReply` mới kèm ảnh.

- **Zalo**: `api.sendMessage({ msg, attachments: [{ data, filename, metadata }] }, ...)` —
  `zca-js` nhận Buffer thẳng từ RAM, không phải ghi file tạm.
- **Telegram**: `telegram.sendPhoto(userId, { source: buffer }, { caption })`.

### Bẫy tự khoá FAQ — bắt buộc sửa kèm

`sendTrackedDirect` (`src/adapters/zalo/bot.ts:470`) hiện chỉ ghi nhận `result?.message?.msgId`.
Nhưng `zca-js` trả `{ message: SendMessageResult | null, attachment: SendMessageResult[] }`, và
**khi có đính kèm thì chữ có thể đi cùng attachment, `message` trả về `null`**.

Không sửa thì: bot gửi ảnh → không ghi được msgId → vòng sau bot thấy tin của chính mình mà
không nhận ra → `handleSelfMessage` hiểu nhầm là admin gõ tay → **bot tự khoá FAQ của chính nó**
30 phút. Đúng cái bẫy `CLAUDE.md` đã cảnh báo ở mục `zalo/bot.ts`.

Sửa: ghi nhận **mọi** msgId trả về (cả `message` lẫn từng phần tử `attachment`).

### Cấu hình

- Setting mới `ordersConfirmedCaptionTemplate` (`SETTINGS_REGISTRY`) — caption đi kèm ảnh, mặc
  định ngắn gọn chỉ còn link dashboard.
- Giữ nguyên `ordersConfirmedTemplate` cũ làm **text dự phòng** khi render lỗi. Mỗi setting một
  việc rõ ràng.
- Env mới `ORDER_IMAGE_ENABLED` (mặc định bật) làm công tắc tắt nhanh khỏi phải rollback.

**Cảnh báo vận hành chung của mọi setting**: instance nào đã bấm Lưu ở `/admin/settings` thì giá
trị trong DB đè lên default trong code. Setting caption mới thì không sao (chưa từng tồn tại),
nhưng nhớ quy tắc này khi sửa default.

## Xử lý lỗi

Nguyên tắc: **tin báo tiền không bao giờ được mất.**

| Hỏng ở đâu | Xử lý |
|---|---|
| Render lỗi (thiếu font, resvg crash) | log chi tiết → gửi text như cũ |
| Gửi ảnh lỗi (mạng, Zalo từ chối) | log chi tiết → thử lại dạng text |
| `ORDER_IMAGE_ENABLED=false` | gửi text như cũ, không render |

Dùng API async của resvg để không chẹn event loop khi một lần import bắn thông báo cho vài chục
user.

Giữ đúng quy tắc 2026-09-02: luôn `console.warn` kèm chi tiết chẩn đoán **trước** khi nuốt lỗi.

## Test

- **Layout (thuần, không cần font)**: chọn đúng 3 đơn cao nhất; đếm đúng phần dư; nhãn fallback
  `Đơn <orderId>` khi `productName` rỗng; hai trạng thái dòng số dư đúng ở cả 2 phía ngưỡng và
  tại đúng mốc bằng nhau.
- **Chặn hồi quy quan trọng**: tổng tiền là tổng **TẤT CẢ** đơn, không phải tổng 3 đơn hiện trên
  ảnh. Test bằng 5 đơn, assert tổng khác tổng 3 đơn đầu.
- **Renderer**: ra đúng magic bytes JPEG + đúng 1408×768; không ném lỗi với 1/2/3/5 đơn; không
  ném lỗi với tên sản phẩm cực dài (chặn bẫy `lineClamp`).
- **Zalo**: gửi kèm ảnh vẫn ghi nhận **đủ** msgId vào `SentMessageTracker`, kể cả khi
  `message` trả về `null` và msgId chỉ nằm trong `attachment`.
- **Fallback**: renderer ném lỗi thì tin vẫn tới dưới dạng text.

Kiểm tra bằng mắt: render các trường hợp ra file rồi đối chiếu ảnh mẫu trước khi báo xong.

## Đánh đổi đã chấp nhận

- **Khớp template ~95%, không pixel-perfect.** Font tiêu đề là font riêng của Canva (đã quét
  520 font Google có tiếng Việt, không font nào khớp kiểu sans tương phản cao này), nên số đơn
  và dòng Tổng cộng dùng Playfair Display. Chủ bot đã xem và duyệt.
- **Tên sản phẩm dài bị cắt đuôi** ở 4 dòng. Nếu sau này thấy tiếc thì cho chữ tự thu nhỏ khi
  tên dài (25 → 22) để chứa thêm trước khi cắt.
- **Thẻ xếp theo tiền giảm dần**, không theo thứ tự đơn.
