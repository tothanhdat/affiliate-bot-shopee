# FAQ tự động trả lời trong Zalo DM (LLM phân loại + câu trả lời soạn sẵn)

Ngày: 2026-09-13
Trạng thái: đã chốt thiết kế, chưa implement

## 1. Vấn đề

User trong group không hình dung được cơ chế hoàn tiền dù đã có tin nhắn chào (`formatWelcomeReply`,
`formatGroupJoinWelcomeReply`) và Sổ tay hoàn tiền (Google Doc). Họ nhắn riêng hỏi admin những câu lặp
đi lặp lại ("hoàn tiền như thế nào?", "bao giờ có tiền?", "rút sao?"), admin phải trả lời thủ công.

Hôm nay bot **im lặng tuyệt đối** với mọi DM không phải `xemhh` và không chứa link sản phẩm
(`src/adapters/zalo/bot.ts`, nhánh `dmLinks.length === 0`) — quyết định 2026-08-21. Spec này đảo lại
quyết định đó **một phần**: bot chỉ mở miệng khi nhận ra chắc chắn một chủ đề FAQ đã soạn sẵn; mọi
trường hợp khác vẫn im lặng y như hôm nay.

## 2. Quyết định đã chốt

| Quyết định | Chốt |
|---|---|
| Phạm vi | **Chỉ Zalo DM**. Không làm trong group (tránh bot nói nhiều → tăng rủi ro khoá tài khoản `zca-js`), không làm Telegram |
| Loại câu hỏi | **Chỉ cơ chế chung**. Bot KHÔNG đọc ledger, KHÔNG trả lời về đơn/số dư cụ thể của user |
| Cách trả lời | **LLM chỉ phân loại**, câu trả lời gửi đi là text admin soạn 100% — LLM không viết chữ nào |
| Model | `claude-haiku-4-5` (~18đ/câu, 1.000 câu/tháng ≈ 18.000đ) |
| Quản FAQ | Chủ đề cố định trong code; **nội dung câu trả lời sửa qua `/admin/settings`** (pattern `SETTINGS_REGISTRY` có sẵn), không làm trang CRUD riêng |
| Admin đang chat | Bot tự phát hiện và im — xem mục 5 |

### Vì sao "LLM phân loại" chứ không "LLM tự viết câu trả lời"

Đây là bot tiền. Một câu bịa về % hoa hồng hay thời gian nhận tiền gây hậu quả thật. Cho LLM chọn
1 trong N chủ đề rồi gửi text cố định thì **không tồn tại đường nào để bot nói sai** — đổi lại mất khả
năng trả lời câu ngoài kịch bản, và đó là đánh đổi có chủ đích (câu ngoài kịch bản → im + ping admin).

## 3. Luồng xử lý 1 tin nhắn DM

```
tin DM đến
├── isSelf? (tin do CHÍNH tài khoản bot gửi ra — xem mục 5)
│   ├── msgId nằm trong SentMessageTracker → bỏ qua (tin của chính bot)
│   ├── text là "/im" / "/noi"             → bật/tắt khoá thread → bỏ qua
│   └── còn lại = ADMIN GÕ TAY            → khoá FAQ thread N phút → bỏ qua
└── tin từ user
    ├── "xemhh"           → trả dashboard         (LUÔN chạy, kể cả thread đang khoá)
    ├── có link sản phẩm  → tạo link hoàn tiền    (LUÔN chạy, kể cả thread đang khoá)
    └── còn lại
        ├── FAQ_PROVIDER=off  → im lặng (hành vi hôm nay)
        ├── thread đang khoá  → im lặng
        ├── quá rate limit    → im lặng
        └── classify(text)
            ├── khớp 1-2 chủ đề → gửi câu trả lời soạn sẵn (ghép bằng "\n\n" nếu 2)
            └── KHÔNG_BIẾT / lỗi API / timeout → im lặng + ping admin + khoá thread
```

**Ranh giới bất di bất dịch**: thread bị khoá chỉ tắt FAQ. Link sản phẩm và `xemhh` luôn chạy — đó là
tiền của user, không được im.

**Chỉ áp dụng cho `ThreadType.User`**: tin `isSelf` trong **group** vẫn `return` ngay như hôm nay. Nhánh
mới chỉ chạy khi `message.type === ThreadType.User`, nếu không bot sẽ tự khoá mình mỗi lần trả lời link
trong group.

## 4. Cấu trúc code

Giữ nguyên ranh giới core/adapter (`CLAUDE.md` → "Nguyên tắc khi sửa code"): toàn bộ nghiệp vụ vào
`src/core/faq/`, adapter chỉ format I/O.

| File | Trách nhiệm |
|---|---|
| `src/core/faq/faqTopics.ts` | `FAQ_TOPICS: FaqTopic[]` — `{id, description, defaultAnswer}`. `description` là text cho LLM đọc để phân loại (không gửi user); `defaultAnswer` là text gửi user khi admin chưa tuỳ chỉnh |
| `src/core/faq/faqClassifier.ts` | `interface FaqClassifier { classify(question: string, topics: FaqTopic[]): Promise<string[]> }` — trả mảng topicId (rỗng = không biết). Điểm nối để đổi nhà cung cấp LLM. Kèm luôn `OffFaqClassifier` (luôn trả `[]` → bot im, dùng khi `FAQ_PROVIDER=off`) — class 3 dòng không đáng một file riêng, để cạnh interface thì đọc 1 chỗ là hiểu cả hợp đồng lẫn hành vi mặc định |
| `src/core/faq/providers/claudeClassifier.ts` | Gọi `@anthropic-ai/sdk` (mục 6) |
| `src/core/faq/providers/index.ts` | Factory theo `env.faq.provider` |
| `src/core/faq/faqService.ts` | Điều phối: mute → rate limit → classify → lấy answer (settings, fallback default) → render placeholder → trả `string \| null` |
| `src/core/ledgerStore.ts` | Bảng mới `faq_thread_mutes` + API mute/unmute/isMuted |
| `src/core/settingsKeys.ts` | Thêm `faqMuteMinutes` + prefix `faq_answer_` |
| `src/config/settingsRegistry.ts` | Sinh field từ `FAQ_TOPICS` (mục 7) |
| `src/adapters/zalo/sentMessageTracker.ts` | Nhớ msgId + text bot vừa gửi để phân biệt với tin admin gõ tay |
| `src/adapters/zalo/bot.ts` | Gọi `faqService`, xử lý nhánh `isSelf` |

`faqService.resolve()` trả `string | null` — `null` nghĩa là im lặng. Adapter không tự quyết định gì.

### FAQ_PROVIDER mặc định `off`

Bắt chước đúng `AFFILIATE_PROVIDER=mock`: deploy code mới lên mà chưa set `ANTHROPIC_API_KEY` thì
**hành vi không đổi một ly nào** so với hôm nay. Bật tính năng = đổi 1 biến môi trường.

## 5. Chống chen ngang khi admin đang chat với user

Tài khoản Zalo chạy bot **chính là** tài khoản admin dùng để tư vấn user (đã xác nhận với user).

Bot khởi tạo với `new Zalo({ selfListen: true })` (`src/adapters/zalo/bot.ts:82`, bật từ 2026-09-07 cho
việc khác). Đọc source `node_modules/zca-js/dist/apis/listen.js:187` xác nhận: với cờ đó, thư viện
**emit cả tin nhắn do chính tài khoản đó gửi đi**, kể cả tin admin gõ tay từ điện thoại. Hiện
`handleMessage` vứt ngay ở dòng đầu (`if (message.isSelf) return;`).

**⚠️ Phải test thật trên Zalo trước khi tin** — điều này mới được xác minh bằng đọc source, chưa chạy.
Nếu thực tế không emit, lớp 1 chết và phải dựa vào lớp 2 (`/im`, `/noi`); lớp 3 vẫn chạy bình thường.

### Lớp 1 — tự động (chính)

Tin `isSelf` trong thread DM mà `msgId` **không** nằm trong `SentMessageTracker` → admin vừa gõ tay →
khoá FAQ thread đó `faqMuteMinutes` phút (mặc định 30).

`api.sendMessage()` trả `{message: {msgId: number} | null, attachment: []}` nên phân biệt được chính
xác, không phải đoán theo nội dung. Tracker giữ `{msgId: string, text: string, sentAt: number}`, tự dọn
sau 5 phút.

**Hỏng an toàn**: nếu `message` là `null` (không lấy được msgId), bot không nhận ra tin của chính nó →
tự khoá chính mình 30 phút. Hậu quả là bot im (không phải nói bậy) — hướng hỏng đúng. Fallback phụ:
khớp `text` y hệt trong 60s cũng tính là tin của bot.

### Lớp 2 — lệnh thủ công (dự phòng)

Admin gõ trong thread: `/im` → khoá vô thời hạn (`muted_until = NULL`); `/noi` → mở khoá. Chỉ nhận khi
`isSelf === true` nên user không gọi được. Dùng khi muốn chặn trước khi kịp gõ câu nào, hoặc khoá lâu
hơn 30 phút.

### Lớp 3 — im khi không chắc

Classifier trả rỗng (`KHÔNG_BIẾT`), lỗi API, hoặc timeout → bot không nói gì, chỉ ping admin qua
`createAdminNotifier()` có sẵn (`src/adapters/shared/adminNotifier.ts`).

Nội dung ping: `"❓ [Zalo] <tên user> (<userId>) vừa hỏi câu bot không hiểu: \"<nguyên văn>\""`.

**⚠️ Sửa 2026-09-13 (bug phát hiện từ dùng thật)**: bản đầu tiên còn khoá thread luôn ở bước này
("admin sắp vào trả lời thay"). Thực tế dùng cho thấy đây là lỗi: user hỏi 1 câu ngoài kịch bản, bot
im đúng, nhưng câu FAQ hợp lệ hỏi NGAY SAU ĐÓ cũng bị im lây trong `faqMuteMinutes` phút — dù admin
chưa hề can thiệp gì. Đã bỏ hẳn việc khoá ở lớp này. Khoá thread giờ **chỉ** xảy ra khi admin
**thật sự** gõ tay (lớp 1) hoặc gõ lệnh `/im` (lớp 2) — không còn do bot tự đoán.

### Bảng `faq_thread_mutes`

Bảng mới hoàn toàn → không cần migration (giống `zalo_groups`, `import_history`).

```sql
CREATE TABLE IF NOT EXISTS faq_thread_mutes (
  platform     TEXT    NOT NULL,
  thread_id    TEXT    NOT NULL,
  muted_until  INTEGER,            -- epoch ms; NULL = vô thời hạn (/im)
  reason       TEXT    NOT NULL,   -- 'admin_typed' | 'admin_command' (KHONG con 'unknown_question', xem Lop 3 o tren)
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (platform, thread_id)
);
```

API: `muteFaqThread(platform, threadId, untilMs | null, reason)`, `unmuteFaqThread(platform, threadId)`,
`isFaqThreadMuted(platform, threadId, nowMs): boolean`.

Lưu DB chứ không để RAM: deploy/restart Railway không được làm bot "tỉnh dậy nói leo" giữa lúc admin
đang tư vấn.

## 6. Gọi Claude API

- Package: `@anthropic-ai/sdk`, model `claude-haiku-4-5`, `max_tokens: 256`.
- **Không truyền `thinking`** — Haiku 4.5 dùng `budget_tokens`, không phải adaptive; ở đây không cần thinking.
- Output đọc từ response text thuần, lọc qua `parseTopicIds()`: chỉ nhận id **có thật** trong danh sách
  chủ đề, và trả rỗng nếu model trả về quá 2 id (dấu hiệu model đọc vẹt cả danh sách thay vì chọn).
  Chặt hơn structured outputs về mặt an toàn, không phụ thuộc shape API có thể đổi, và test được bằng
  unit test thuần.
- Timeout 10s. Bắt lỗi theo class (`Anthropic.RateLimitError` → `Anthropic.APIError`), **không** string-match.
- Không prompt caching: prompt quá ngắn để đạt ngưỡng cacheable tối thiểu, bật cũng không ăn.

System prompt (đại ý, chốt lại lúc implement):

> Bạn phân loại câu hỏi của khách hàng vào các chủ đề dưới đây. CHỈ trả về id chủ đề, tối đa 2, không
> tự viết câu trả lời. Nếu câu hỏi không khớp rõ ràng chủ đề nào, trả về mảng rỗng — thà không biết còn
> hơn đoán sai. Câu hỏi về đơn hàng/số dư cụ thể của cá nhân luôn trả về mảng rỗng.
> Chủ đề: `<id>: <description>` ...

Câu hỏi của user đi trong `messages`, không nhét vào system — giữ ranh giới prompt injection.

## 7. Bộ chủ đề FAQ (8 chủ đề)

Nội dung dưới là `defaultAnswer`; admin sửa qua `/admin/settings` không cần deploy. Placeholder render
bằng `renderTemplate()` có sẵn (`replyText.ts`): `{{userSharePercent}}`, `{{botSharePercent}}`,
`{{withdrawalThreshold}}`, `{{dashboardUrl}}` (tạo qua `findOrCreateDashboardToken`).

| id | `description` (cho LLM) | Nội dung câu trả lời |
|---|---|---|
| `co_che_hoan_tien` | Hoàn tiền là gì, bot hoạt động thế nào, tại sao lại được tiền | Giải thích: gửi link → bot trả link gắn mã → mua qua link đó → sàn trả hoa hồng → chia lại cho user |
| `ty_le_hoa_hong` | Được bao nhiêu phần trăm, tính thế nào, sao ít hơn dự tính | `{{userSharePercent}}%` sau khi trừ thuế 10% và phí sàn 1%, kèm ví dụ bằng số |
| `khi_nao_nhan_tien` | Bao lâu thì có tiền, đơn khi nào được xác nhận, sao đợi lâu | Vài ngày đến vài tuần tuỳ sàn; bot tự nhắn khi đơn được xác nhận, không cần hỏi lại |
| `xem_so_du` | Xem tiền/đơn của tôi ở đâu, dashboard là gì, mất link rồi | Nhắn `xemhh` để lấy link cố định: `{{dashboardUrl}}` |
| `cach_rut_tien` | Rút tiền thế nào, tối thiểu bao nhiêu, bao lâu nhận được | Đủ `{{withdrawalThreshold}}` → form trên dashboard, rút toàn bộ số dư, điền 3 trường ngân hàng, admin nhắn xác nhận trước khi chuyển |
| `cach_dung_bot` | Dùng bot thế nào, gửi link ở đâu, gửi link gì | Gửi link Shopee/TikTok Shop vào group hoặc nhắn riêng; bot trả link đã gắn mã |
| `don_khong_ghi_nhan` | Mua rồi mà không thấy đơn, đơn bị mất, bấm link rồi mà không có | Phải đặt hàng ngay trong phiên mở link, không xem video/live xen giữa; nếu vẫn không thấy thì nhắn admin kiểm tra |
| `san_ho_tro` | Sàn nào được hỗ trợ, Lazada/Tiki/Shopee có không | Hiện hỗ trợ Shopee và TikTok Shop |

**Lưu ý khi soạn**: `huong-dan-nguoi-dung.md` đang lỗi thời ở vài chỗ (còn ghi lệnh `idid` thay vì
`xemhh`, còn ghi bot không xử lý link trong DM). Viết `defaultAnswer` theo **hành vi hiện tại của code**,
không copy từ file đó. Cập nhật `huong-dan-nguoi-dung.md` là việc riêng, ngoài phạm vi spec này.

## 8. Cấu hình mới

`.env` (khai báo default trong `src/config/env.ts`, note trong `.env.example`):

| Biến | Default | Ý nghĩa |
|---|---|---|
| `FAQ_PROVIDER` | `off` | `off` \| `claude` |
| `ANTHROPIC_API_KEY` | — | Bắt buộc khi `FAQ_PROVIDER=claude` |
| `FAQ_MODEL` | `claude-haiku-4-5` | Đổi model không cần sửa code |
| `FAQ_RATE_LIMIT_MAX` | `5` | Số câu FAQ tối đa / cửa sổ / user |
| `FAQ_RATE_LIMIT_WINDOW_MS` | `600000` | Cửa sổ 10 phút |

`/admin/settings` (qua `SETTINGS_REGISTRY`):

- `faqMuteMinutes` — number, default 30, min 1, max 1440. Số phút khoá FAQ sau khi admin gõ tay.
- 8 field textarea `faq_answer_<topicId>` — sinh tự động từ `FAQ_TOPICS.map(...)`, `helpText` liệt kê
  placeholder khả dụng và nhắc: sửa nội dung thì giữ đúng chủ đề, vì phần mô tả LLM dùng để phân loại
  nằm trong code, không đổi theo.

Rate limit dùng lại `RateLimiter` có sẵn (`src/core/rateLimiter.ts`), key `zalo-faq:<userId>` — chống
1 user nghịch đốt tiền API.

## 9. Test

`FaqClassifier` là interface nên test bằng fake, **không gọi API thật**:

1. Classifier trả `["ty_le_hoa_hong"]` → bot gửi đúng nội dung setting của chủ đề đó, placeholder đã render.
2. Classifier trả 2 chủ đề → 2 câu trả lời ghép bằng `\n\n`.
3. Classifier trả `[]` → không gửi gì cho user, có ping admin, thread bị khoá.
4. Classifier throw (API lỗi) → xử lý y hệt case 3, không crash adapter.
5. Tin `isSelf` có msgId trong tracker → KHÔNG khoá thread (tin của chính bot).
6. Tin `isSelf` msgId lạ → khoá thread `faqMuteMinutes` phút.
7. `/im` → khoá vô thời hạn; `/noi` → mở; user gửi `/im` (không `isSelf`) → không có tác dụng.
8. Thread đang khoá: câu hỏi FAQ → im; **link sản phẩm vẫn được xử lý**; **`xemhh` vẫn trả dashboard**.
9. Mute hết hạn → bot trả lời lại bình thường.
10. Quá rate limit → im lặng, không gọi classifier.
11. `FAQ_PROVIDER=off` → không bao giờ gọi classifier, hành vi hệt hôm nay.
12. `SentMessageTracker`: hết hạn sau 5 phút; khớp theo text trong 60s khi msgId là `null`.

## 10. Ngoài phạm vi (v1)

- Trả lời FAQ trong **group** — chỉ DM.
- **Telegram** — chỉ Zalo.
- Bot đọc ledger để trả lời về đơn/số dư **cụ thể của user**.
- Trang `/admin/faq` CRUD thêm/xoá chủ đề.
- Lưu lịch sử hội thoại FAQ để xem lại trên web (v1 chỉ `console.log`).
- Cập nhật `huong-dan-nguoi-dung.md` cho khớp hành vi hiện tại.

## 11. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| `selfListen` không emit tin DM tự gửi như suy luận từ source | Test thật trước khi build tiếp; nếu sai, lớp 1 bỏ, dùng lớp 2 + 3 |
| Bot nói nhiều hơn trong DM → tăng rủi ro Zalo khoá tài khoản | Chỉ trả lời khi nhận ra chắc chắn chủ đề; rate limit; khoá thread; không đụng gì tới group |
| LLM phân loại sai chủ đề → trả lời lạc đề | Trả lời lạc đề nhưng **không sai sự thật** (text cố định); prompt ưu tiên trả rỗng khi không chắc |
| Admin sửa nội dung answer lệch khỏi chủ đề → phân loại đúng nhưng trả lời sai | `helpText` cảnh báo; mô tả chủ đề nằm trong code |
| Chi phí API tăng đột biến | Rate limit theo user; có thể tắt tức thì bằng `FAQ_PROVIDER=off` |
