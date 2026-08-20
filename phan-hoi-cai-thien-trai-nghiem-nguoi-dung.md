# Spec: Feedback cải thiện trải nghiệm người dùng (dịch vụ cashback)

> Viết ngày 2026-08-19. Tài liệu **bổ sung riêng**, không gộp vào `spec_bot_ap_ma_shopee.md`. Nguồn: phiên brainstorm đóng vai người dùng thật của bot (10 feedback), đã được chủ bot phản hồi/chốt từng ý. Xem `quy-trinh-van-hanh-cashback.md` để đối chiếu quy trình hiện tại, `rui-ro-can-giai-quyet.md` để đối chiếu rủi ro đã biết trước đó (mục 5 dưới đây liên quan trực tiếp tới mục 3 của file đó).

## 1. Thông báo khi đơn được xác nhận

**Quyết định: Option B — gộp thông báo theo lượt chạy, không gửi real-time từng đơn.**

Context: Hiện tại user không được báo khi đơn của mình được admin ghi nhận qua `record-conversion`/`record-conversions-csv` — phải tự nhắn "idid" mở dashboard để kiểm tra.

Goal: Sau mỗi lượt `record-conversions-csv` chạy xong, gộp kết quả theo `(platform, userId)` và gửi 1 tin nhắn tổng hợp cho mỗi user có ít nhất 1 đơn mới trong lượt đó (vd "Bạn có N đơn mới được xác nhận, tổng cộng Yđ, xem chi tiết: <link dashboard>"). Với `record-conversion` (ghi 1 đơn lẻ, dùng cho case gấp) gửi ngay 1 tin ngay sau khi ghi thành công, không cần gộp.

Acceptance Criteria:
- Sau khi `record-conversions-csv` xử lý xong toàn bộ file, mỗi user có đơn hợp lệ trong lượt đó nhận đúng 1 tin nhắn (không phải N tin cho N đơn).
- `record-conversion` đơn lẻ gửi 1 tin ngay sau khi ghi nhận thành công.
- Gửi tin thất bại (user block bot, đổi platform, lỗi mạng...) không làm hỏng kết quả ghi nhận đơn — chỉ log lỗi riêng, không rollback dữ liệu ledger.
- Tin nhắn có link dashboard cá nhân (`/d/:token`), tự tạo token nếu user chưa từng nhắn "idid" trước đó.

Out of Scope: Gửi thông báo real-time theo từng đơn (Option A) — không làm vì quy trình đối soát vẫn theo tuần, gửi sớm hơn không có ý nghĩa và tăng rủi ro spam tin nhắn (đặc biệt bên Zalo).

## 2. Hạ ngưỡng rút tiền

**Quyết định: hạ từ 50.000đ xuống 20.000đ.**

Goal: Đổi ngưỡng tối thiểu để dashboard hiện nút "Yêu cầu rút" (hiện đang hard-code 50.000đ, xem `quy-trinh-van-hanh-cashback.md` bước 9).

Acceptance Criteria:
- Ngưỡng cấu hình được qua `.env` (biến mới, không hard-code), mặc định 20.000đ.
- Dashboard hiển thị đúng số tiền còn thiếu để đủ ngưỡng mới khi chưa đạt.

## 3. Rút một phần — giữ nguyên, không làm

**Quyết định: không hỗ trợ rút một phần.**

Lý do (theo chủ bot): rút một phần đòi hỏi biết chính xác đơn nào đã được gộp vào yêu cầu rút nào — phức tạp hoá logic khoá đơn (`withdrawal_id`) hiện đang thiết kế theo kiểu "khoá toàn bộ số dư khả dụng" đơn giản. Không có thay đổi code.

## 4. Mã giảm giá chung — ngoài scope

**Quyết định: giữ nguyên, không làm.** Đã xác nhận trước đó trong `CLAUDE.md`/`README.md`: tính năng mã giảm giá chung đã bị đưa ra ngoài scope dự án (`PROMOTIONS_DISPLAY_LIMIT=0`, trọng tâm sản phẩm là cashback). Không có thay đổi code.

## 5. Cảnh báo rủi ro hoàn/huỷ đơn sau khi rút

**Quyết định: Option A — thêm dòng cảnh báo tĩnh trên dashboard.**

Goal: Thêm 1 dòng cảnh báo cố định trên `/d/:token`, gần khu vực số dư "Khả dụng", nội dung tương tự "Hoa hồng có thể bị thu hồi nếu đơn liên quan bị huỷ/hoàn sau khi đã ghi nhận". Không cần logic mới, chỉ sửa `dashboardHtml.ts`.

Acceptance Criteria:
- Dòng cảnh báo hiển thị trên mọi dashboard có ít nhất 1 đơn ở trạng thái "khả dụng" hoặc đã từng rút.
- Không thay đổi bất kỳ trạng thái/logic tính toán số dư nào.

### ⚠️ Câu hỏi mở — ĐÃ CHỦ BOT XÁC NHẬN LẠI (2026-08-20)

**Kết quả: giữ quyết định cũ, không làm 2 giai đoạn.** Chủ bot chọn phương án "Giữ quyết định cũ" khi được hỏi lại — không có thay đổi code nào cho quy trình đối soát, chỉ có cảnh báo tĩnh ở mục 5 phía trên.

Khi bàn về mục này, chủ bot có đặt câu hỏi: có nên đổi quy trình đối soát thành **2 giai đoạn** — upload CSV lần 1 khi đơn Accesstrade ở trạng thái "tạm duyệt" (chưa cho rút), rồi upload CSV lần 2 khi đơn chuyển "đã duyệt"/"huỷ" (lúc đó mới chuyển sang "khả dụng"/xoá khỏi số dư) — để chặn đúng gốc rủi ro thay vì chỉ cảnh báo suông.

**Cần lưu ý: câu hỏi này đã được đặt ra và bàn kỹ trước đó (2026-08-18), xem `rui-ro-can-giai-quyet.md` mục 3.** Lúc đó chủ bot đã **từ chối hướng 2 giai đoạn** với lý do: quy trình 2 giai đoạn tăng gánh nặng vận hành (thêm 1 bước "duyệt lại" mỗi tuần), trong khi rủi ro gốc là lỗi con người lúc nhập liệu — thao tác "duyệt" cũng chỉ là 1 lần nhập liệu khác, dễ sai tương tự, không giải quyết tận gốc. Quyết định khi đó: chấp nhận rủi ro này, xử lý phần "lỗi nhập liệu" bằng sanity-check số tiền (đã làm, xem mục 6 file đó) thay vì thêm bước quy trình.

Vì câu hỏi được nêu lại trong phiên này, đề xuất 2 hướng để chủ bot chọn lại (giữ quyết định cũ hoặc đảo ngược):

- **Giữ quyết định cũ (khuyến nghị nếu không có gì thay đổi)**: không làm 2 giai đoạn, chỉ dùng cảnh báo tĩnh (mục 5 ở trên) — đỡ tăng tải vận hành, rủi ro tài chính đã được chấp nhận có ý thức từ 2026-08-18.
- **Đảo ngược, làm 2 giai đoạn**: cần thêm cột `status` (`cho_duyet`/`da_duyet`) vào CSV mẫu, lệnh `confirm-entries` mới để chuyển `pending → confirmed` (tận dụng field `status: 'pending'` đã có sẵn trong `ledgerStore.ts`, dashboard/badge/filter admin đã handle theo ghi chú trong `rui-ro-can-giai-quyet.md`) — đổi lại là user phải chờ lâu hơn (2 vòng đối soát) mới rút được, và tăng thêm 1 việc thủ công mỗi tuần.

**Không tự ý code hướng nào cho tới khi chủ bot xác nhận lại — đây là quyết định đã từng đảo ngược 1 lần trong lịch sử dự án, cần chốt rõ ràng để không lặp lại vòng hỏi-đáp.**

## 6. Câu trả lời bot cho Shopee (rút gọn)

**Quyết định: nội dung đã duyệt, rút gọn lại.**

Text cuối cùng (chèn vào phần trả lời link Shopee trong `formatSuccessReply`, `src/adapters/shared/replyText.ts`, chỉ áp dụng merchant `shopee`):

> "Sàn Shopee không cho phép hiển thị hoa hồng ước tính khi đơn chưa hoàn tất. Nhắn "idid" để theo dõi đơn hàng của bạn nhé."

Acceptance Criteria:
- Chỉ hiện với merchant `shopee` — không đổi behavior của Lazada/TikTok Shop.
- Không hứa hẹn số tiền/% cụ thể (giữ đúng nguyên tắc đã có trong `CLAUDE.md`).

## 7. Tách tài khoản Telegram/Zalo — giữ nguyên, không làm

**Quyết định: giữ tách, không gộp số dư giữa 2 platform.** Lý do (theo chủ bot): case 1 người dùng cả 2 platform hiếm khi xảy ra. Không có thay đổi code.

## 8. Bảo mật link dashboard (token trong URL) — giữ nguyên, không làm

**Quyết định: chấp nhận rủi ro.** Lý do (theo chủ bot): quy mô ứng dụng nhỏ. Không có thay đổi code.

## 9. Form nhập thông tin ngân hàng khi yêu cầu rút tiền

**Quyết định: làm.**

Context: Hiện tại (bước 9-10 trong `quy-trinh-van-hanh-cashback.md`) user bấm "Yêu cầu rút" không nhập gì cả — admin phải tự chủ động nhắn hỏi số tài khoản sau đó, gây chậm trễ và user không biết admin đã thấy yêu cầu hay chưa.

Goal: Thêm form ngay tại bước "Yêu cầu rút" trên `/d/:token`, gồm 3 trường bắt buộc: số tài khoản ngân hàng, tên người nhận, ngân hàng (chọn từ danh sách ngân hàng Việt Nam). Sau khi submit thành công, hiện thông báo: "Thông tin này sẽ được Admin xác nhận lại qua tin nhắn riêng. Vui lòng chờ Admin liên hệ bạn."

Acceptance Criteria:
- 3 trường đều bắt buộc, không cho submit yêu cầu rút nếu thiếu.
- Thông tin lưu vào `withdrawal_requests` (cần thêm cột mới: `bank_name`, `bank_account_number`, `bank_account_holder` — kèm migration, theo đúng nguyên tắc "thêm cột mới luôn phải thêm migration" đã ghi trong `CLAUDE.md`).
- Admin xem được 3 trường này trên `/admin/withdrawals` (hoặc qua `list-pending-withdrawals` CLI) để không phải hỏi lại user.
- Thông báo xác nhận đúng nguyên văn như trên hiện ra ngay sau khi submit.
- Không thay đổi logic khoá đơn/chống rút trùng hiện có.

Out of Scope: Xác thực số tài khoản ngân hàng có hợp lệ hay không (admin tự xác nhận qua tin nhắn riêng như quy trình hiện tại, không tự động hoá bước này).

## 10. Bot Zalo DM: hướng dẫn khi không phải lệnh "idid"

**Quyết định: làm.**

Context: Hiện tại trong DM Zalo, mọi nội dung không phải "idid" bị bot im lặng hoàn toàn (quyết định cũ, tránh lộ link dashboard nhầm trong group — vẫn giữ nguyên, không đổi). Vấn đề: lần đầu dùng dễ tưởng bot lỗi.

Goal: Khi nhận tin nhắn DM không khớp lệnh "idid", bot trả lời 1 câu hướng dẫn cố định, ví dụ: "Mình chỉ hỗ trợ lệnh "idid" trong tin nhắn riêng để lấy link theo dõi hoa hồng. Muốn ghi mã link sản phẩm, vui lòng gửi trong group nhé."

Acceptance Criteria:
- Câu trả lời chỉ hiện trong DM, không đổi behavior trong group (group vẫn xử lý link như Telegram).
- Không lộ link dashboard hay bất kỳ thông tin cá nhân nào trong câu trả lời mặc định này.
- Text đặt trong `src/adapters/shared/replyText.ts` (dùng chung style với các template khác) dù hiện chỉ Zalo DM dùng tới — để nếu sau này cần dùng lại nơi khác thì có sẵn.

## Tổng kết trạng thái

> Cập nhật 2026-08-20: đã implement xong toàn bộ 6 hạng mục "Làm" (1, 2, 5, 6, 9, 10) — `npm run typecheck` + `npm test` (82/82) pass. Mục 5b đã được chủ bot xác nhận lại, giữ quyết định cũ. Thay đổi hiện ở local, chưa commit/push/deploy Railway (chủ bot chọn "Chưa làm gì cả" khi được hỏi 2026-08-20).

| # | Hạng mục | Quyết định | Triển khai |
|---|---|---|---|
| 1 | Thông báo khi đơn xác nhận | Làm — Option B | ✅ DONE (2026-08-20) — `orderIngest.ts` (`summarizeOrderResultsByUser`), `ledgerAdmin.ts` (Telegram qua Bot API, Zalo bỏ qua có chủ đích), `server.ts` `/admin/record-orders/*` (Telegram + Zalo qua `notifyUser`) |
| 2 | Hạ ngưỡng rút tiền | Làm — 20.000đ | ✅ DONE (2026-08-20) — `WITHDRAWAL_THRESHOLD_VND` |
| 3 | Rút một phần | Không làm | — |
| 4 | Mã giảm giá chung | Không làm (ngoài scope) | — |
| 5 | Cảnh báo hoàn/huỷ đơn | Làm — Option A (cảnh báo tĩnh) | ✅ DONE (2026-08-20) — `dashboardHtml.ts` |
| 5b | Quy trình đối soát 2 giai đoạn | Đã xác nhận lại (2026-08-20): **giữ quyết định cũ, không làm 2 giai đoạn** | — (không code, giữ nguyên cảnh báo tĩnh mục 5) |
| 6 | Câu trả lời bot Shopee | Làm — text đã chốt | ✅ DONE (2026-08-20) — `replyText.ts` |
| 7 | Gộp số dư Telegram/Zalo | Không làm | — |
| 8 | Bảo mật link dashboard | Không làm (chấp nhận rủi ro) | — |
| 9 | Form ngân hàng khi rút tiền | Làm | ✅ DONE (2026-08-20) — `ledgerStore.ts` (migration + `MissingBankInfoError`), `vietnamBanks.ts`, `dashboardHtml.ts`, `adminHtml.ts` |
| 10 | Hướng dẫn DM Zalo | Làm | ✅ DONE (2026-08-20) — `replyText.ts` (`ZALO_DM_HELP_TEXT`), `zalo/bot.ts` |
