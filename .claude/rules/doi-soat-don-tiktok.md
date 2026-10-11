# Đối soát đơn TikTok Shop (RioHub → ledger)

> Đọc khi sửa `src/core/tiktokOrderImport.ts`, `src/core/tiktokCommission.ts`, `src/core/orderStatusApply.ts`, `src/core/providers/riohubOrdersSource.ts`, route `/admin/record-orders/tiktok-sync`, hoặc khi định đổi cách tính hoa hồng/mốc chốt đơn TikTok. Spec đầy đủ: `docs/superpowers/specs/2026-10-11-doi-soat-don-tiktok-design.md`. Dữ kiện API: `docs/riohub-tiktok.md`.

## Luồng

Admin bấm "Đồng bộ ngay" (thẻ ở `/admin/record-orders`) → `fetchTiktokOrders` (chỗ DUY NHẤT gọi mạng, phân trang) → `importTiktokOrders` (THUẦN, nhận mảng, test bằng fixture) → `applyOrderStatusToLedger` (DÙNG CHUNG với Shopee). Chưa tự động theo giờ — cố ý (bảng quyết định mới dựng trên 4 đơn thật, vài lần đầu phải nhìn tận mắt); bật tự động = gọi đúng hai hàm đó từ một `setInterval`.

## Quyết định tiền (đã chốt với chủ bot 2026-10-11, đừng đảo lại khi chưa hỏi)

- **Đơn vào Khả dụng LÚC GIAO HÀNG** (`time_delivered_iso`) hoặc `status=2`, KHÔNG chờ RioHub `SETTLED` (nằm sau cửa sổ trả hàng 15+ ngày, user không đợi nổi). Tương đương "Hoàn thành" của Shopee. Luật giam đơn to (7 ngày) / đơn nhỏ (1 ngày) dùng nguyên `resolveConfirmPlan()`, đếm từ ngày giao.
- **Hoa hồng gốc = `round(Σ est_commission dòng không huỷ × TIKTOK_PIT_RETAINED_RATIO)`** (0,9), cho CẢ `pending` lẫn `confirmed`. Một công thức ⇒ không bao giờ phải sửa số sau khi entry đã `confirmed` (sửa là chạm cỗ máy nợ hoàn trả trên MỌI đơn). `actual_commission` KHÔNG tham gia tính tiền — chỉ đối chiếu/cảnh báo. Nếu ai định dùng nó: lấy THẲNG field, tuyệt đối không cộng lại 6 thành phần (trả thừa ~10 lần).
- **`TIKTOK_PIT_RETAINED_RATIO` dùng ở HAI nơi**: ghi ledger và `estimateFrom()` (câu ước tính bot gửi lúc trả link). Lệch nhau = bot hứa khác số trả. Có test chặn. Hằng số 0,9 đọc từ tài liệu, CHƯA đo trên đơn quyết toán thật — đơn đầu tiên quyết toán là lúc đối chiếu.
- Hệ quả đã chấp nhận (mục 1.3b của `docs/riohub-tiktok.md`): TikTok đã khấu trừ `pit` rồi hệ thống trừ 10% "thuế" nữa ⇒ user TikTok nhận ít hơn Shopee ~10%. Muốn nói đúng bản chất thì sửa câu chữ `/so-tay`, KHÔNG sửa phép tính.

## Phân loại đơn — thứ tự xét LÀ MỘT PHẦN CỦA LUẬT

Đọc `status` (1 chờ · 2 quyết toán · 3 huỷ/hoàn), KHÔNG đọc `settlement_status` (passthrough của TikTok, có thể thêm giá trị lạ). Xét từ trên xuống, dừng ở dòng khớp đầu tiên: (1) có `status` lạ → bỏ qua cả đơn; (2) tất cả dòng = 3 → `reversed`; (3) còn dòng không huỷ chưa giao & chưa quyết toán → `pending`; (4) còn lại → `confirmed`. **Ca 2 phải đứng TRƯỚC ca 3**: đơn toàn dòng huỷ không có dòng "không huỷ" nào nên điều kiện "còn dòng…" đúng một cách rỗng ⇒ rơi xuống `confirmed` và đơn huỷ được ghi tiền. Cùng họ: chốt "không có `est_commission`" CHỈ áp cho đơn `pending`/`confirmed`, nếu áp cả `reversed` thì mọi đơn huỷ bị bỏ qua và tiền không bao giờ được thu hồi. Có test chặn cả hai.

## Cách ly Shopee ↔ TikTok (ràng buộc hạng nhất)

1. `findBySubId` có thể trả request SHOPEE (subId chỉ mã hoá nền tảng chat k/m/w, không mã hoá sàn) ⇒ `merchant !== "tiktokshop"` bị bỏ qua + cảnh báo, ledger không thêm dòng. Chốt này CHỈ ở phía TikTok.
2. Hai route riêng; import Shopee không gọi RioHub (có test); RioHub hỏng chỉ hiện trên thẻ TikTok.
3. `createServer(..., syncTiktokOrders)` = `undefined` khi TikTok tắt/thiếu key ⇒ thẻ ẩn, route 404. `tiktokshop` về `RETIRED_MERCHANTS` thì đơn đã ghi vẫn hiện (tiền lệ Lazada).
4. Bỏ phần đối soát = xoá `tiktokOrderImport.ts`, `riohubOrdersSource.ts`, `tiktokCommission.ts`, `scripts/riohubOrders.ts` + 1 route + 1 thẻ. **`orderStatusApply.ts` Ở LẠI** — nó là module ledger không biết sàn nào, Shopee gọi nó.

## Giao diện `/admin/record-orders` — 2 tab

(2026-10-11, yêu cầu của chủ bot: trộn hai sàn trên một trang bị rối.) Tab **Shopee** (form "Ghi 1 đơn lẻ" + import CSV + lịch sử) và tab **TikTok** (thẻ đồng bộ + kết quả + lịch sử).

- **Tab là LINK `?tab=shopee|tiktok` render phía server**, không phải JS như `/admin/settings`: mọi route POST render lại cả trang nên server trả đúng tab của nó (import Shopee ở lại tab Shopee, đồng bộ TikTok ở lại tab TikTok), không có state client nào để lệch. `?tab=tiktok` khi TikTok tắt → rơi về tab Shopee; TikTok tắt thì không có thanh tab.
- **Lịch sử chia theo sàn, lọc TRONG SQL** (`listImportHistory(limit, actionTypes)`): Shopee = `csv`+`single`, TikTok = `tiktok`. Lọc sau khi cắt 20 dòng chung thì tab ít hoạt động chỉ còn vài dòng. Mảng loại rỗng = không khớp gì (không phải "lấy hết").
- **Form "Ghi 1 đơn lẻ" nằm ở tab Shopee** và dòng lịch sử của nó luôn hiện ở tab Shopee, **kể cả khi subId là của TikTok** (form tra sàn theo subId nên về kỹ thuật ghi được đơn TikTok). Chủ bot đã chọn để vậy thay vì tra sàn của đơn để xếp đúng tab.
- **Nhãn ngắn cho admin**: `getMerchantAdminName()` ("TikTok") dùng ở chip sàn `/admin/orders` + `/admin/links`, ô lọc "Sàn", trang huỷ đơn/sửa hoa hồng, nhãn lịch sử. **Tên đầy đủ `displayName` ("TikTok Shop") GIỮ NGUYÊN cho mọi thứ user đọc** (tin nhắn bot, `{{san}}`, dashboard cá nhân `/d/…`) — đổi `displayName` gốc sẽ làm bot nói "Shopee và TikTok" với khách. Thêm sàn mới: chỉ cần `adminName` nếu tên đầy đủ dài.
- Nhãn tab là `<a>` nên phải có `no-underline` (không nạp preflight, thẻ `<a>` giữ gạch chân mặc định — đúng bẫy trong `admin-ui-nen-tang.md`).

## Thông tin do chủ bot cung cấp (2026-10-11), chưa đối chiếu với TikTok

- Cửa sổ trả hàng của TikTok Shop là **10 ngày** (Shopee 15). Đã ghi vào Sổ tay và helpText của `payout_hold_days`. Số `payout_hold_days` mặc định 7 ngày vẫn áp cho cả hai sàn.
- Điều kiện được ghi nhận hoa hồng của TikTok **giống Shopee** (đặt hàng trong phiên, không xem video/livestream xen giữa).
- Lịch vận hành: đồng bộ TikTok **9h30 mỗi ngày giống nhịp import Shopee** (bấm tay, cùng trang `/admin/record-orders`). Với user, Sổ tay ghi "Mỗi ngày" cho cả hai sàn.

## Bẫy đã biết

- `sub_id` rỗng là chuỗi `""`, không phải `null`.
- **Nghi vấn về mốc giao hàng (2026-10-11):** hai đơn không liên quan cùng có `time_delivered_iso = 04:16:50Z` đúng từng giây ⇒ trông như thời điểm RioHub **phát hiện** giao hàng, không phải giờ giao thật. Sai theo hướng an toàn (giam lâu hơn chút, không bao giờ sớm hơn) nhưng CHƯA khẳng định; nếu hoá ra trễ nhiều ngày thì cửa sổ giam 7 ngày của đơn to lệch tương ứng. Cần thêm đơn để kết luận.
- API trả **UTC**; dùng `*_iso`, quy đổi bằng `formatVnDateIso`/`formatVnTimeHms`. Không dùng `settled_at` (bị xoá về null khi đơn chuyển huỷ rồi chốt lại).
- Tham số lọc sai tên/định dạng bị API nuốt im lặng và trả cả lịch sử — kể cả `page`. `fetchTiktokOrders` nén lỗi nếu trang sau không có đơn mới. Chưa lọc ngày: thêm `update_time_start` khi số đơn lớn lên, KÈM phép thử "kết quả phải khác đối chứng".
- Đơn nhỏ vào Khả dụng ở lần đồng bộ KẾ TIẾP sau ngày đã chốt (không tự mở theo ngày) — nghỉ 3 ngày thì chậm 3 ngày.
- `fully_refunded`/`refunded_quantity` KHÔNG được đọc để tính tiền; hoàn MỘT PHẦN trong cùng một SKU chưa có thiết kế. Có đèn báo: dòng có `refunded_quantity > 0` mà `status ≠ 3` → dòng trong `errors`.
- Sáu thứ CHƯA quan sát lần nào (đừng đọc nhánh code của chúng như bằng chứng): `status=2`, `status=3`, `actual_commission` có giá trị, `status` lạ, đơn nhiều SKU, hoàn một phần cùng SKU.

## Cảnh báo admin

`shared_with_partner ≠ 0` (key `tiktok_mcn_cut`) và `actual` thấp hơn số đã trả trừ biên 2% (key `tiktok_actual_below_assumed`, so thẳng với `assumed`) đi qua `AlertThrottle` 15 phút/key. `pit` khác 0 KHÔNG cảnh báo (kỳ vọng vĩnh viễn — báo mỗi ngày thì sau một tuần bị bỏ qua và cảnh báo thật cũng bị bỏ qua); nó hiện ở khối "Số liệu đã quyết toán". Cảnh báo nổ SAU khi tiền mấy đơn đầu đã trả user — giá trị là chặn lỗ âm thầm kéo dài, không chặn được đơn đã trả. Chủ bot chọn chỉ cảnh báo, không tự khoá đồng bộ.
