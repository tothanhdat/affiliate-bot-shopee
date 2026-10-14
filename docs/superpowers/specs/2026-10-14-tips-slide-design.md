# Tips cho user (slide) + quản trị Tips — thiết kế

> Chủ bot muốn một nút **💡 Tips** trên dashboard cá nhân của user (`/d/:token`). Bấm vào mở trang
> Tips dạng **slide ngang**, nội dung do Admin cấu hình. Mỗi Tip gồm **Tiêu đề, Ảnh, Mô tả**.
>
> Tính năng **không đụng đường tiền**: không chạm `commissionMath.ts`, `payoutHold.ts`, các bảng
> `commission_entries`/`withdrawal_requests`/`payout_debts`. Rule liên quan cần đọc trước khi làm:
> `trang-cho-user.md`, `admin-ui-nen-tang.md`, `admin-ui-tung-trang.md`, `server-va-wiring.md`.

## 1. Mục tiêu và ngoài phạm vi

**Mục tiêu**
- User bấm 💡 Tips trên dashboard → xem các mẹo do Admin soạn, vuốt ngang mượt trên điện thoại.
- Admin thêm / sửa / **kéo-thả sắp xếp** / **tắt-bật** / **xoá** Tips tại `/admin/tips`, ảnh upload từ máy.

**Ngoài phạm vi** (YAGNI, chưa ai yêu cầu)
- Tips theo nhóm user, theo sàn, hay theo ngôn ngữ. Tips là nội dung chung cho mọi user.
- Đếm lượt xem, "đã đọc/chưa đọc", chấm đỏ báo Tip mới.
- Nhiều ảnh trên một Tip; video; định dạng rich-text trong mô tả (mô tả là văn bản thuần).
- Tips trong tin nhắn bot Zalo/Telegram và trang `/so-tay`.
- Nút ↑↓ dự phòng cho cảm ứng (chủ bot đã bỏ, admin dùng máy tính).

## 2. Quyết định đã chốt với chủ bot (2026-10-14)

| # | Quyết định | Lý do |
|---|---|---|
| 2.1 | Ảnh **upload file** lên server, lưu ở thư mục riêng trên volume | Không phụ thuộc link ngoài có thể chết/chặn hotlink; hạ tầng upload đã có sẵn (ảnh chứng từ rút tiền) |
| 2.2 | Trang Tips của user là **slide ngang**: Tiêu đề trên, Ảnh giữa, Mô tả dưới; slide kế bên lộ mép và **mờ** | Yêu cầu trực tiếp của chủ bot |
| 2.3 | Sắp xếp bằng **kéo-thả**, tự lưu khi thả | Yêu cầu trực tiếp; **không** có nút ↑↓ dự phòng (chủ bot xác nhận bỏ) |
| 2.4 | Có **Tắt/Bật** (deactivate) và **Xoá** | Tắt = hoàn tác được; Xoá = vĩnh viễn, mất cả file ảnh |
| 2.5 | Ảnh **không bắt buộc** | Mặc định đề xuất; có Tip chỉ cần chữ. Đổi sang bắt buộc chỉ là thêm validate ở route |
| 2.6 | Tip mới tạo xếp ở **cuối** | Thứ tự là thứ tự slide, Admin chủ động kéo lên nếu muốn |

## 3. Dữ liệu

Bảng MỚI `tips` trong `ledgerStore` (`CREATE TABLE IF NOT EXISTS` ở khối khởi tạo, **không cần migration**
vì là bảng mới hoàn toàn — quy tắc "thêm cột mới phải kèm migration" chỉ áp cho bảng đã tồn tại):

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | |
| `title` | TEXT NOT NULL | Cắt khoảng trắng hai đầu, không rỗng, tối đa 120 ký tự |
| `description` | TEXT NOT NULL DEFAULT '' | Văn bản thuần, tối đa 2000 ký tự, qua `normalizeNewlines()` (CRLF → LF) khi LƯU, giống bài học `/admin/settings` |
| `image_path` | TEXT NULL | **Tên file** (không phải đường dẫn) trong `TIPS_IMAGE_DIR`; NULL = Tip không có ảnh |
| `sort_order` | INTEGER NOT NULL | Thứ tự hiển thị tăng dần |
| `is_active` | INTEGER NOT NULL DEFAULT 1 | 0 = đã tắt |
| `created_at` / `updated_at` | TEXT NOT NULL | ISO UTC như các bảng khác |

Đặt tên cột là `is_active` (không phải `is_visible`) cho khớp từ "deactivate" của chủ bot và nhãn UI "Đang hiện / Đã tắt".

**API `LedgerStore`** (tách thành một nhóm nhỏ, đặt cạnh `zalo_groups`):
- `createTip({title, description, imagePath})` → xếp cuối: `sort_order = COALESCE(MAX(sort_order), 0) + 1` tính **trong cùng câu INSERT/transaction** (hai request đồng thời không được trùng thứ tự).
- `updateTip(id, {title, description, imagePath?})` — `imagePath` là `undefined` = giữ ảnh cũ, `null` = bỏ ảnh, chuỗi = ảnh mới. Trả về `{previousImagePath}` để caller xoá file cũ.
- `setTipActive(id, active)`.
- `deleteTip(id)` → trả `imagePath` đã xoá để caller xoá file.
- `listTips({onlyActive})` — sắp theo `sort_order ASC, id ASC` (tiebreak `id` cho an toàn khi có dữ liệu lỗi trùng thứ tự).
- `countActiveTips()` — dashboard chỉ cần biết có hay không, không kéo cả bảng.
- `reorderTips(orderedIds: number[])` — xem mục 5.3.

`src/core/**` không import `express`/`multer` (luật ranh giới core/adapter): store chỉ nhận/trả dữ liệu, việc ghi/xoá file nằm ở `server.ts`.

## 4. Lưu và phục vụ ảnh

- Biến môi trường mới `TIPS_IMAGE_DIR`, mặc định `./data/tips-images`; khai báo mặc định trong `src/config/env.ts` và note trong `.env.example` (luật chung của repo). Truyền vào `createServer()` như `withdrawalProofDir`, **là tham số cuối có giá trị mặc định** để các chỗ gọi cũ trong test không phải sửa.
- Upload bằng `multer.memoryStorage()`, giới hạn **5MB**. `fileFilter` chỉ nhận mimetype `image/jpeg`, `image/png`, `image/webp`. **Không nhận SVG và GIF**: SVG chạy được script khi mở trực tiếp; GIF không cần thiết và nặng.
- **Không tin mimetype do client gửi**: kiểm tra thêm chữ ký (magic bytes) của buffer — JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF....WEBP`. Không khớp → từ chối với thông báo rõ ràng. Phần mở rộng của file lưu suy ra từ chữ ký, không từ tên file người upload.
- Tên file lưu: `crypto.randomUUID()` + đuôi (`.jpg`/`.png`/`.webp`). Không dùng tên gốc.
- Route phục vụ ảnh `GET /tips/images/:filename`: **công khai** (ảnh Tips không nhạy cảm, và tên file ngẫu nhiên khó đoán), dùng `basename()` chặn path traversal như route ảnh chứng từ, header `Cache-Control: public, max-age=31536000, immutable` (an toàn vì tên file đổi mỗi lần thay ảnh), 404 khi không có file. Khác route ảnh chứng từ ở đúng một điểm: không kiểm tra chủ sở hữu, vì không có chủ sở hữu.
- Thay ảnh / xoá Tip → xoá file cũ **sau khi** DB đã ghi thành công; xoá file lỗi chỉ `console.warn`, không làm fail thao tác (file mồ côi vô hại hơn bản ghi trỏ vào file đã mất).
- Chuẩn bị instance mới: thư mục tự tạo bằng `mkdirSync(..., {recursive: true})` lúc ghi lần đầu, không cần bước thủ công.

## 5. Trang admin `/admin/tips`

Mục menu mới "Tips" (icon bóng đèn: thêm một dòng vào `ICON_PATHS` theo hình Lucide `lightbulb`, đặt sau "Link đã tạo" hoặc trước "Cấu hình"). Dùng lại `adminShell` và các thành phần dùng chung (`FIELD_CLASS`, nút…) — **không chép ra bản riêng**.

### 5.1 Bố cục
- Đầu trang: nút "Thêm Tip" mở form (thẻ `<details>` native, không JS) gồm Tiêu đề, Mô tả (textarea), Ảnh (`<input type="file" accept="image/jpeg,image/png,image/webp">`).
- Danh sách các Tip dạng card, mỗi card: **tay nắm kéo `⋮⋮`**, ảnh thu nhỏ (hoặc ô trống xám nếu không có ảnh), tiêu đề, mô tả cắt dòng, nhãn trạng thái, công tắc Tắt/Bật, nút Sửa, nút Xoá.
- Tip `is_active = 0`: card mờ đi + nhãn chữ "Đã tắt" (trạng thái **không chỉ dựa vào độ mờ**, người mù màu/màn hình sáng vẫn đọc được). Vẫn kéo được.
- Sửa Tip: mở form sửa ngay trong card (`<details>`), cùng các trường, kèm ảnh hiện tại và hai lựa chọn "Giữ ảnh / Thay ảnh / Bỏ ảnh".
- Một dòng ghi chú ngay cạnh nút Xoá: "Muốn giữ lại để dùng sau thì **Tắt**, đừng Xoá."
- Danh sách rỗng: trạng thái rỗng có câu hướng dẫn, không để bảng trống trơn.

### 5.2 Route (đều sau `requireAdminAuth`, POST thường redirect về `/admin/tips`)
| Route | Việc |
|---|---|
| `GET /admin/tips` | Render trang |
| `POST /admin/tips` | Tạo (multipart: `title`, `description`, `image`) |
| `POST /admin/tips/:id` | Sửa (multipart + trường `imageAction=keep\|replace\|remove`) |
| `POST /admin/tips/:id/active` | Đặt `active=0\|1` |
| `POST /admin/tips/:id/delete` | Xoá |
| `POST /admin/tips/reorder` | Sắp xếp lại — **JSON**, xem 5.3 |

Validate sai (tiêu đề rỗng/quá dài, file không phải ảnh, quá 5MB) → render lại trang với banner lỗi **422** và **giữ nguyên chữ admin đã nhập** (không bắt gõ lại một mô tả dài). Lỗi của multer (quá dung lượng, sai loại) rơi xuống error handler chung giống `csvUpload`/`proofUpload`.

`POST /admin/tips/reorder` đặt **trước** `POST /admin/tips/:id` trong thứ tự khai báo Express, để `reorder` không bị hiểu là một `:id`.

### 5.3 Kéo-thả và `reorder`
- Dùng **HTML5 Drag and Drop gốc**, không cài thư viện. Một đoạn `<script>` nhỏ trong trang (cùng kiểu các script client hiện có của `/admin/users`, `/admin/settings`). Chỉ tay nắm `⋮⋮` có `draggable="true"` — **không** để cả card kéo được, vì card chứa ô nhập/`<details>`/nút, kéo cả card sẽ làm không bôi chọn được chữ trong ô.
- Khi kéo: card đang kéo mờ đi; một **đường kẻ chỉ chỗ thả** hiện giữa hai card theo vị trí con trỏ. Thả xong → DOM đổi chỗ ngay, rồi gửi `POST /admin/tips/reorder` với body `{"ids":[3,1,2]}` (đủ **toàn bộ** Tip, kể cả đã tắt, theo thứ tự mới).
- Lưu **lỗi** (mạng/401/422) → card trả về đúng chỗ cũ + thông báo lỗi ngắn trên trang. Không để màn hình lệch với DB. Lưu thành công thì không cần thông báo gì (toast liên tục mỗi lần kéo là phiền).
- Server: `reorderTips(orderedIds)` trong **một transaction**, chỉ chấp nhận khi `orderedIds` là **hoán vị đúng** của tập id đang có (không thiếu, không thừa, không trùng, mọi phần tử là số nguyên). Sai → 422 JSON, không ghi gì. Ghi `sort_order = 1..N` theo thứ tự nhận. Hoán vị đúng nghĩa là nếu admin kia vừa thêm một Tip trong lúc mình kéo thì request bị từ chối và trang báo "danh sách đã thay đổi, hãy tải lại" — chấp nhận được với 1 admin, hơn là âm thầm ghi đè.
- Route này là JSON: chưa đăng nhập trả **JSON 401** thay vì redirect (cùng kiểu `POST /admin/api/orders/confirm`).
- Logic tính "chèn vào vị trí nào" và "danh sách id theo thứ tự DOM" tách thành hàm thuần trong script để test được trên DOM giả (cùng cách `usersSearchScript.test.ts`).

### 5.4 Xoá
Xác nhận hai bước **tại chỗ** bằng `<details>`: bấm "Xoá" mở ra "Xác nhận xoá" + "Huỷ". **Không dùng `window.confirm()`** (từng làm treo trình duyệt tự động khi test, ghi ở `admin-ui-tung-trang.md`) và chạy được khi không có JS. Nút xác nhận là `<button>` trong `<form method="post">` riêng của card.

### 5.5 Bẫy Tailwind không-preflight cần tránh (từ `admin-ui-nen-tang.md`)
1. Control tự dựng (`<button>`, `<summary>`) phải tự reset viền/nền/font; Safari cần `::-webkit-details-marker`.
2. Ẩn/hiện phần tử có class `flex`/`grid` bằng JS → set `el.style.display`, **không** dùng `.hidden =`.
3. Style kéo-thả (card mờ, đường kẻ chỉ chỗ thả, tay nắm) và mọi giá trị có thể chứa khoảng trắng → viết thành **class CSS thật trong `admin.css`**, không dùng utility tuỳ ý. Sau khi build, `grep -F` `public/admin.css` để xác nhận class đã được sinh ra.
4. Bảng/card mới nằm trong `.card` nếu dùng bảng.

## 6. Dashboard user — nút Tips

- `renderDashboardPage()` nhận thêm một field đơn giản (ví dụ `hasTips: boolean`) từ `server.ts` (`ledgerStore.countActiveTips() > 0`). Hàm render **không** đọc store (giữ đúng kiểu hiện tại: input là dữ liệu, không là store). Field này **tuỳ chọn, mặc định `false`**: mọi chỗ gọi cũ (có 2 chỗ trong `server.ts`, cộng test) không phải sửa, và không có Tip thì giao diện y hệt hiện tại.
- Dòng tiêu đề thành hàng flex: bên trái `<h1>💰 Hoa hồng của bạn</h1>`, bên phải nút pill **💡 Tips** (`<a href="/d/${token}/tips">`). Kiểu pill theo ảnh chủ bot gửi: bo tròn hoàn toàn, nền tím nhạt hơn nền trang, viền sáng mảnh, chữ trắng. Màu lấy từ biến CSS sẵn có của `dashboardHtml.ts`, **không** thêm bảng màu riêng.
- Mobile là màn hình CHÍNH: hàng flex `flex-wrap`; màn rất hẹp thì nút xuống dòng chứ không đẩy tiêu đề. Vùng bấm tối thiểu 44px chiều cao.
- **Không có Tip đang bật → không hiện nút** (cùng nguyên tắc thẻ "Đang tạm giữ" chỉ hiện khi > 0: không hiện thứ chưa áp dụng).
- `renderDashboardPage` có 2 chỗ gọi trong `server.ts` (GET `/d/:token` và nhánh lỗi POST withdraw) — cả hai đều phải truyền `hasTips`, vì trang lỗi rút tiền cũng là dashboard user thấy.

## 7. Trang Tips của user — `GET /d/:token/tips`

- Xác thực bằng token dashboard như trang chính; token sai → `renderInvalidTokenPage()` như hiện tại.
- Render bằng module mới `src/api/tipsHtml.ts` (`renderTipsPage`), HTML viết tay + `escapeHtml`. `pageShell(title, body)` hiện là hàm **không export** ở `dashboardHtml.ts:56`: **export nó** và dùng lại để trang Tips có đúng nền/font/màu của dashboard (không chép CSS nền sang bản thứ hai). CSS riêng của slide nằm trong `tipsHtml.ts` và đi kèm `body` truyền vào `pageShell`. Việc export này không đổi hành vi nào của dashboard.
- Đầu trang: liên kết "← Hoa hồng của bạn" về `/d/:token`, rồi tiêu đề "💡 Tips".
- Không có Tip đang bật (admin tắt hết sau khi user mở dashboard) → hiện câu "Chưa có mẹo nào, bạn quay lại sau nhé" kèm link quay lại, **không** trả 404.

### 7.1 Slide
**Cấu trúc**: `<div class="tips-track">` chứa các `<article class="tip-slide">`. Mỗi slide từ trên xuống: **Tiêu đề (`<h2>`) → Ảnh → Mô tả**.

**Cuộn và bắt dính**: CSS scroll-snap thuần.
```
.tips-track { display:flex; gap; overflow-x:auto; scroll-snap-type:x mandatory;
              scroll-behavior:smooth; -webkit-overflow-scrolling:touch;
              padding-inline: calc((100% - var(--slide-w)) / 2); scrollbar-width:none; }
.tip-slide  { flex:0 0 var(--slide-w); scroll-snap-align:center; scroll-snap-stop:always; }
```
`--slide-w` khoảng 80% khung (tối đa khoảng 420px trên màn rộng) → hai bên luôn còn ~10% để lộ mép slide kế. `padding-inline` đối xứng để slide đầu/cuối cũng nằm chính giữa. `scroll-snap-stop: always` để vuốt mạnh không nhảy qua nhiều slide.

**Hiệu ứng mờ/sáng**: slide không phải slide đang ở giữa có `opacity ~0.45` và `transform: scale(~0.92)`, chuyển bằng `transition` (opacity/transform, **không** `transition: all`, theo bài học ở `admin-ui-nen-tang.md`). Slide đang ở giữa (`.is-active`) sáng và về cỡ chuẩn. Đây là nơi tạo cảm giác "lướt mượt chứ không khô khan": chuyển động do scroll-snap + quán tính của hệ điều hành, sáng/mờ do transition.

**JS tối thiểu (progressive enhancement)**: nếu JS lỗi, scroll-snap vẫn vuốt được, chỉ mất hiệu ứng mờ và chấm tròn. Đoạn script:
- `IntersectionObserver` (root là track, `threshold` cao quanh 0.6) đánh dấu `.is-active` cho slide đang ở giữa.
- Sinh/đồng bộ **chấm tròn + "2 / 5"** dưới track. Bấm chấm hoặc bấm **slide mờ bên cạnh** → `scrollIntoView({inline:'center', behavior:'smooth'})` tới slide đó.
- Mũi tên trái/phải chỉ hiện trong `@media (hover: hover) and (pointer: fine)` (desktop có chuột); trên điện thoại ẩn hẳn.
- Phím ←/→ khi track được focus (`tabindex=0`, `role="region"`, `aria-roledescription="carousel"`).
- `prefers-reduced-motion: reduce` → `scroll-behavior: auto`, bỏ transition, vẫn đổi sáng/mờ tức thời.

**Không lặp vòng**: đầu/cuối chạm biên (đơn giản, không clone slide).

### 7.2 Trường hợp biên
| Trường hợp | Hành vi |
|---|---|
| Chỉ 1 Tip | Không lộ slide kế, không chấm, không mũi tên, không `scroll-snap` (card đứng giữa, rộng bằng khung) |
| Tip không có ảnh | Slide chỉ gồm Tiêu đề + Mô tả, không chừa khung ảnh trống |
| Mô tả dài | Card cao theo nội dung; các slide **căn mép trên** (`align-items:flex-start`), không kéo giãn bằng nhau để Tip ngắn không bị khoảng trống thừa. Ảnh luôn trong khung `aspect-ratio` cố định + `object-fit: cover` để chiều cao ảnh không làm slide nhảy lúc tải |
| Ảnh lỗi/mất file | Ẩn `<img>` hỏng (`onerror` đặt `hidden`) — slide còn lại vẫn đọc được, không hiện icon ảnh vỡ |
| Tiêu đề/mô tả chứa `<script>`, dấu `"`, `&` | Qua `escapeHtml`; mô tả giữ xuống dòng bằng `white-space: pre-line` (không đổi `\n` thành `<br>` thủ công) |
| URL ảnh | Luôn dựng từ `encodeURIComponent(image_path)` trên route `/tips/images/`, không bao giờ nhúng đường dẫn do người dùng nhập |

Ảnh dùng `loading="lazy"` cho slide ngoài khung nhìn đầu tiên; slide đầu không lazy (nó là nội dung chính lúc mở trang).

## 8. Kiểm thử

Theo luật repo, test cùng lượt với code (TDD). Các file test mới/mở rộng:

1. **`tipsStore.test.ts`** (store): tạo xếp cuối; hai lần tạo liên tiếp không trùng `sort_order`; `listTips({onlyActive})`; `updateTip` giữ/bỏ/đổi ảnh và trả đúng `previousImagePath`; `setTipActive`; `deleteTip` trả đường dẫn ảnh; `reorderTips` đúng hoán vị thì đổi, **từ chối** thiếu/thừa/trùng/không phải số và không ghi gì (transaction nguyên vẹn).
2. **`tipsHtml.test.ts`** (render trang user): thứ tự **Tiêu đề → ảnh → mô tả** trong mỗi slide; Tip không ảnh thì không có `<img>`; 1 Tip thì không có chấm/mũi tên; nhiều Tip thì có chấm đúng số lượng; escape HTML ở tiêu đề **và** mô tả (với `<script>` thật); trạng thái rỗng; chỉ render Tip đang bật; có chặn "hồi quy" cho `prefers-reduced-motion` và `scroll-snap` (assert chuỗi CSS).
3. **`dashboardHtml` test**: nút Tips **có** khi `hasTips`, **không có dấu vết nào** khi tắt/mặc định (không chữ "Tips", không link); link đúng `/d/<token>/tips`; token được escape; test cũ không sửa vẫn xanh.
4. **`adminRoutes.test.ts` (mở rộng)**: mọi route `/admin/tips*` cần đăng nhập; `reorder` chưa đăng nhập trả JSON 401 (không redirect); upload từ chối file không phải ảnh, **từ chối file giả mạo** (mimetype `image/png` nhưng nội dung là chữ), từ chối SVG, từ chối >5MB; tạo/sửa ghi file vào `TIPS_IMAGE_DIR` tạm; thay ảnh và xoá Tip **xoá file cũ**; giữ lại chữ đã nhập khi 422; `reorder` hoán vị sai → 422 và DB không đổi.
5. **Route ảnh `/tips/images/:filename`**: trả đúng file; `../` và đường dẫn tuyệt đối không thoát được thư mục (path traversal); file không tồn tại → 404; header cache.
6. **`tipsPageScript.test.ts` + `tipsAdminScript.test.ts`** (script client trên DOM giả, cùng kiểu `usersSearchScript.test.ts`): logic đánh dấu slide active; logic tính vị trí chèn và danh sách id theo thứ tự DOM khi kéo-thả; hoàn tác DOM khi lưu lỗi.
7. **CSS**: sau `npm run build:css`, `grep -F` các class mới (tay nắm, đường kẻ thả, card mờ) có trong `public/admin.css`.

**Phần test KHÔNG chứng minh được** (nói rõ để không tuyên bố xong sớm):
- Test DOM giả không có CSS cascade thật, nên **không biết hiệu ứng sáng/mờ và độ mượt có đẹp không**, và có thể xanh giả như bẫy `.hidden` đã gặp. Vì vậy phải **xem bằng mắt** trên Chrome trong **iframe 390px** (`--window-size` không đổi layout viewport nên ảnh bị cắt bên phải — bài học ở memory về harness mobile).
- Kéo-thả bằng chuột thật: drag gốc của trình duyệt khó giả lập tin cậy bằng tự động hoá; chốt cuối cùng là chủ bot thử tay.
- Cảm giác vuốt trong **Zalo in-app browser** (WebView có thể khác Chrome về quán tính/snap) chỉ kiểm được trên điện thoại thật.
- Preview trang bằng server riêng trên DB tạm, **không** dùng `npm run dev` (tránh dùng token bot thật, theo memory).

## 9. Tài liệu phải cập nhật cùng lượt sửa

Theo `CLAUDE.md` ("cập nhật file rule tương ứng ngay trong cùng lần sửa"):
- `.claude/rules/ledger-va-tien.md`: bảng `tips` (mục tiêu, `is_active`, thứ tự, vì sao tách khỏi bảng tiền — **không** thuộc đường tiền nhưng ở chung DB).
- `.claude/rules/trang-cho-user.md`: nút Tips (điều kiện hiện), trang slide, các quyết định ở mục 7 (đặc biệt "một Tip → không snap", "mờ chỉ là hiệu ứng, không mang nghĩa").
- `.claude/rules/admin-ui-tung-trang.md`: mục `/admin/tips` (kéo-thả chỉ bằng tay nắm, xoá hai bước bằng `<details>`, không `window.confirm`, nhãn "Đã tắt" bằng chữ).
- `.claude/rules/server-va-wiring.md`: 6 route admin + 2 route user (`/d/:token/tips`, `/tips/images/:filename`), biến `TIPS_IMAGE_DIR`, thứ tự khai báo `reorder` trước `:id`.
- `.env.example` + `src/config/env.ts`: `TIPS_IMAGE_DIR`.
- Bảng "Bản đồ code" trong `CLAUDE.md`: thêm `tipsHtml.ts` vào dòng `src/api/` và trỏ tới `trang-cho-user.md`.

## 10. Rủi ro và đánh đổi

| Rủi ro | Cách xử lý |
|---|---|
| **Thư mục ảnh nằm ngoài volume** trên một instance (chưa mount) → ảnh mất sau mỗi lần redeploy, bản ghi `tips` vẫn còn nhưng ảnh 404 | `TIPS_IMAGE_DIR` mặc định nằm cùng `./data/` với ảnh chứng từ và DB, đã được mount trên các instance hiện có. Thêm một dòng vào hướng dẫn chuẩn bị instance (`van-hanh-va-deploy.md`) rằng thư mục này phải ở trên volume. UI user đã ẩn `<img>` hỏng nên trang không vỡ |
| Ảnh lớn làm trang chậm trên 4G | Giới hạn 5MB là trần chứ không phải khuyến nghị; ghi gợi ý trên form "ảnh ngang, khoảng 1000px là đủ". **Không** tự resize/nén phía server ở bản đầu (cần thư viện ảnh, và đã có `jpeg-js`/`resvg` cho việc khác nhưng không phải để làm việc này) — làm khi thật sự thấy chậm |
| Hai admin sửa cùng lúc | Chỉ có 1 mật khẩu admin; `reorder` từ chối danh sách lỗi thời thay vì ghi đè |
| Nội dung Admin gõ chứa `<`/`&` | Escape ở mọi điểm render, có test |
| Script kéo-thả hỏng trên một trình duyệt lạ | Danh sách vẫn hiển thị và các thao tác Sửa/Tắt/Xoá vẫn chạy (đều là form thường); chỉ mất khả năng đổi thứ tự. Đây là lý do thao tác thường **không** phụ thuộc JS |

**Đánh đổi đã chấp nhận**
- Drag gốc không chạy trên cảm ứng → không đổi thứ tự được từ điện thoại (chủ bot đã chọn bỏ nút ↑↓ dự phòng vì admin dùng máy tính).
- Ảnh Tips phục vụ công khai (không cần token): ai biết đúng tên file ngẫu nhiên đều xem được. Chấp nhận vì nội dung là mẹo hướng dẫn chung, không phải dữ liệu user.
- Không có cache phía server cho danh sách Tips: bảng nhỏ (vài chục dòng), truy vấn rẻ, và cache sẽ làm Admin vừa sửa mà user chưa thấy.

## 11. Thứ tự làm đề xuất (để bước lập kế hoạch chia việc)

1. Bảng `tips` + API `LedgerStore` + test store.
2. `TIPS_IMAGE_DIR` (env + `.env.example`) + lưu/phục vụ/xoá ảnh + kiểm tra magic bytes + test.
3. Trang admin: danh sách, thêm/sửa/tắt-bật/xoá (chưa kéo-thả) + test route.
4. Kéo-thả + `reorder` + script test.
5. Trang user `tipsHtml.ts` (slide) + route + test.
6. Nút Tips trên dashboard + test hồi quy.
7. Xem bằng mắt trên trình duyệt (admin ≥1280px, user iframe 390px) + `grep -F` CSS + cập nhật rule + `CLAUDE.md`.

Mỗi bước tự thân chạy được và test xanh; bước 1–3 đã dùng được ở admin dù user chưa thấy gì (nút Tips chỉ hiện từ bước 6).
