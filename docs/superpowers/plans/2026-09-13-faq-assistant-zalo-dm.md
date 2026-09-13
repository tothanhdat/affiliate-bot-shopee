# FAQ tự động trả lời trong Zalo DM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bot Zalo tự trả lời các câu hỏi cơ chế chung trong DM bằng câu trả lời admin soạn sẵn, và tự im lặng khi admin đang trực tiếp chat với user.

**Architecture:** LLM (Claude Haiku 4.5) chỉ làm 1 việc là phân loại câu hỏi vào 1 trong 8 chủ đề cố định; text gửi user luôn là chuỗi admin soạn (sửa qua `/admin/settings`), nên bot không thể bịa thông tin về tiền. Toàn bộ nghiệp vụ nằm trong `src/core/faq/`, adapter Zalo chỉ format I/O. Trạng thái "đang khoá FAQ" lưu trong bảng SQLite mới của `ledgerStore`.

**Tech Stack:** TypeScript ESM, Node 22 (`node:test`, `node:sqlite`), `zca-js`, `@anthropic-ai/sdk` (mới).

**Spec:** `docs/superpowers/specs/2026-09-13-faq-assistant-zalo-dm-design.md`

## Global Constraints

- **Ranh giới core/adapter**: `src/core/**` KHÔNG import `express`, `telegraf`, `zca-js`, và không biết gì về platform cụ thể. Adapter chỉ gọi service, không tự implement lại logic.
- **Import phải có đuôi `.js`** (ESM + `node16` resolution), kể cả khi file nguồn là `.ts`.
- **Comment trong code viết tiếng Việt KHÔNG dấu**, theo đúng toàn bộ codebase hiện tại. Text hiển thị cho user thì CÓ dấu bình thường.
- **Không thêm thư viện ngoài** ngoài `@anthropic-ai/sdk`. SQLite dùng `node:sqlite` built-in, không `better-sqlite3`.
- **Test framework**: `node:test` + `node:assert/strict`, chạy qua `npm test`. DB trong test luôn dùng `":memory:"`.
- **Bảng SQLite mới** → tạo bằng `CREATE TABLE IF NOT EXISTS` trong constructor; bảng mới hoàn toàn thì không cần migration.
- **`FAQ_PROVIDER` mặc định `off`** — khi off, hành vi bot phải giống hệt hôm nay (im lặng hoàn toàn với DM không phải `xemhh`/link).
- **Không bao giờ chặn nghiệp vụ chính**: thread bị khoá FAQ vẫn phải xử lý link sản phẩm và lệnh `xemhh`.
- **Chỉ `ThreadType.User`**: mọi logic mới không được chạm nhánh group.
- Biến môi trường mới phải khai báo default trong `src/config/env.ts` và note trong `.env.example`.

### Ghi chú sai khác so với spec (có chủ đích)

1. Spec mục 6 nói dùng structured outputs (`output_config.format`). Plan này dùng **response text thuần + `parseTopicIds()`** thay thế: hàm parse chỉ nhận những id có thật trong danh sách chủ đề và trả rỗng nếu model trả về quá 2 id (dấu hiệu model đọc vẹt cả danh sách). Cách này chặt hơn về an toàn, không phụ thuộc shape API có thể đổi, và test được bằng unit test thuần.

2. Spec mục 4 tách `providers/offClassifier.ts` thành file riêng. Plan đặt `OffFaqClassifier` ngay trong `faqClassifier.ts` cạnh interface nó implement — class rỗng 3 dòng không đáng một file, và để cạnh interface thì đọc 1 chỗ là hiểu cả hợp đồng lẫn hành vi mặc định.

Spec đã được cập nhật cho khớp cả 2 điểm.

---

### Task 1: Bộ chủ đề FAQ

**Files:**
- Create: `src/core/faq/faqTopics.ts`
- Create: `src/core/faq/__tests__/faqTopics.test.ts`
- Modify: `package.json` (script `test` — thêm glob cho thư mục test mới)

**Interfaces:**
- Consumes: không có (task đầu tiên)
- Produces: `FaqTopic` = `{ id: string; label: string; description: string; defaultAnswer: string }`; `FAQ_TOPICS: FaqTopic[]` (8 phần tử); `FAQ_MUTE_MINUTES_DEFAULT = 30`; `FAQ_ANSWER_PLACEHOLDERS: string[]`

⚠️ **Bước sửa `package.json` phải làm TRƯỚC khi chạy test** — glob hiện tại là `src/core/__tests__/*.test.ts` (phẳng), không bắt được `src/core/faq/__tests__/`. Quên bước này thì test mới "pass" vì không hề chạy.

- [ ] **Step 1: Thêm glob test mới vào `package.json`**

Trong `"scripts"`, sửa dòng `"test"` thành (thêm `src/core/faq/__tests__/*.test.ts` ngay sau glob `src/core/__tests__/*.test.ts`):

```json
"test": "tsx --test src/core/__tests__/*.test.ts src/core/faq/__tests__/*.test.ts src/api/__tests__/*.test.ts src/adapters/shared/__tests__/*.test.ts src/adapters/zalo/__tests__/*.test.ts src/scripts/__tests__/*.test.ts"
```

- [ ] **Step 2: Viết test thất bại**

Tạo `src/core/faq/__tests__/faqTopics.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { FAQ_TOPICS, FAQ_ANSWER_PLACEHOLDERS } from "../faqTopics.js";

test("FAQ_TOPICS: du 8 chu de, id khong trung", () => {
  assert.equal(FAQ_TOPICS.length, 8);
  const ids = FAQ_TOPICS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("FAQ_TOPICS: id chi gom chu thuong/so/gach duoi (parseTopicIds dua vao dieu nay)", () => {
  for (const topic of FAQ_TOPICS) {
    assert.match(topic.id, /^[a-z0-9_]+$/, `id sai dinh dang: ${topic.id}`);
  }
});

test("FAQ_TOPICS: moi chu de deu co label/description/defaultAnswer khong rong", () => {
  for (const topic of FAQ_TOPICS) {
    assert.ok(topic.label.trim().length > 0, `thieu label: ${topic.id}`);
    assert.ok(topic.description.trim().length > 0, `thieu description: ${topic.id}`);
    assert.ok(topic.defaultAnswer.trim().length > 0, `thieu defaultAnswer: ${topic.id}`);
  }
});

// Placeholder go sai (vd {{dashboardURL}}) se hien nguyen xi trong tin nhan that gui cho user,
// vi renderTemplate() co y GIU NGUYEN placeholder khong khop thay vi throw.
test("FAQ_TOPICS: moi placeholder trong defaultAnswer deu nam trong danh sach duoc ho tro", () => {
  for (const topic of FAQ_TOPICS) {
    for (const match of topic.defaultAnswer.matchAll(/\{\{(\w+)\}\}/g)) {
      assert.ok(
        FAQ_ANSWER_PLACEHOLDERS.includes(match[1]),
        `placeholder la trong ${topic.id}: {{${match[1]}}}`
      );
    }
  }
});
```

- [ ] **Step 3: Chạy test để xác nhận FAIL**

Run: `npm test 2>&1 | grep -A 5 faqTopics`
Expected: FAIL — `Cannot find module '../faqTopics.js'`

- [ ] **Step 4: Viết `src/core/faq/faqTopics.ts`**

```typescript
/**
 * Bo chu de FAQ bot tu tra loi trong Zalo DM (2026-09-13).
 *
 * `description` KHONG gui cho user - day la text LLM doc de phan loai cau hoi.
 * `defaultAnswer` la text gui cho user khi admin chua tuy chinh; admin sua lai qua /admin/settings
 * (key `faq_answer_<id>`, xem settingsRegistry.ts) - noi dung sua se GHI DE defaultAnswer.
 *
 * Them chu de moi = them 1 entry o day; form /admin/settings tu sinh them 1 o textarea tuong ung.
 */
export interface FaqTopic {
  /** Chi dung [a-z0-9_] - parseTopicIds() do id trong text model tra ve bang regex nay. */
  id: string;
  /** Nhan hien thi tren form /admin/settings. */
  label: string;
  /** Mo ta cho LLM phan loai - viet theo kieu "user hoi ve X, Y, Z". */
  description: string;
  defaultAnswer: string;
}

/** Placeholder duoc phep dung trong defaultAnswer/cau tra loi admin sua - xem faqService.answerFor(). */
export const FAQ_ANSWER_PLACEHOLDERS = [
  "userSharePercent",
  "botSharePercent",
  "withdrawalThreshold",
  "dashboardUrl",
];

/** So phut khoa FAQ mac dinh sau khi admin go tay trong thread (admin doi duoc tren /admin/settings). */
export const FAQ_MUTE_MINUTES_DEFAULT = 30;

export const FAQ_TOPICS: FaqTopic[] = [
  {
    id: "co_che_hoan_tien",
    label: "Cơ chế hoàn tiền",
    description:
      "User hoi hoan tien la gi, bot hoat dong the nao, tai sao lai duoc tien, co that khong, co mat phi khong",
    defaultAnswer:
      `Dạ để em giải thích nhanh nha 😊\n\n` +
      `Khi bạn mua hàng qua link em gửi, sàn (Shopee/TikTok Shop) trả cho em một khoản hoa hồng tiếp thị. ` +
      `Em chia lại cho bạn {{userSharePercent}}% khoản đó, em giữ {{botSharePercent}}% để vận hành.\n\n` +
      `Các bước rất đơn giản:\n` +
      `1️⃣ Bạn gửi link sản phẩm cho em\n` +
      `2️⃣ Em gửi lại link đã gắn mã hoàn tiền\n` +
      `3️⃣ Bạn mở link đó và đặt hàng ngay trong phiên\n` +
      `4️⃣ Đơn được sàn xác nhận là tiền vào số dư của bạn\n\n` +
      `Bạn không mất thêm đồng nào cả, giá vẫn y như bạn mua bình thường nha!`,
  },
  {
    id: "ty_le_hoa_hong",
    label: "Tỉ lệ hoa hồng",
    description:
      "User hoi duoc bao nhieu phan tram, chia the nao, tinh ra sao, sao tien it hon minh nghi, tru nhung gi",
    defaultAnswer:
      `Bạn nhận {{userSharePercent}}% hoa hồng mỗi đơn nha 💰\n\n` +
      `Cách tính: hoa hồng sàn trả → trừ 10% thuế → trừ 1% phí sàn → phần còn lại bạn nhận {{userSharePercent}}%, em giữ {{botSharePercent}}%.\n\n` +
      `Ví dụ hoa hồng gốc 10.000đ: trừ thuế còn 9.000đ, trừ phí sàn còn 8.910đ, bạn nhận {{userSharePercent}}% của 8.910đ.\n\n` +
      `Tỉ lệ hoa hồng gốc cao hay thấp là do từng sản phẩm và từng shop quy định, không phải em đặt nha.`,
  },
  {
    id: "khi_nao_nhan_tien",
    label: "Khi nào nhận được tiền",
    description:
      "User hoi bao lau thi co tien, don khi nao duoc xac nhan, sao doi lau qua, khi nao tien vao",
    defaultAnswer:
      `Đơn cần thời gian để sàn xác nhận, thường vài ngày đến vài tuần tuỳ sàn và tuỳ đơn ạ ⏳\n\n` +
      `Lý do là sàn phải đợi bạn nhận hàng xong và hết hạn đổi trả mới chốt hoa hồng.\n\n` +
      `Bạn không cần hỏi lại đâu nha — cứ có đơn được xác nhận là em tự nhắn báo bạn liền 🔔`,
  },
  {
    id: "xem_so_du",
    label: "Xem số dư / dashboard",
    description:
      "User hoi xem tien cua minh o dau, dashboard la gi, lam sao biet co bao nhieu don, mat link roi lay lai sao",
    defaultAnswer:
      `Bạn xem ở dashboard riêng của mình nha 📊\n\n` +
      `{{dashboardUrl}}\n\n` +
      `Ở đó có đầy đủ từng đơn, số dư khả dụng và lịch sử rút tiền. Link này cố định, lưu lại xài hoài được.\n\n` +
      `Lỡ mất link thì nhắn "xemhh" cho em là em gửi lại ngay!`,
  },
  {
    id: "cach_rut_tien",
    label: "Cách rút tiền",
    description:
      "User hoi rut tien the nao, toi thieu bao nhieu, rut ve dau, bao lau nhan duoc tien, rut mot phan duoc khong",
    defaultAnswer:
      `Rút tiền dễ lắm nha 💸\n\n` +
      `Khi số dư khả dụng đạt từ {{withdrawalThreshold}} trở lên, dashboard sẽ hiện nút yêu cầu rút:\n` +
      `{{dashboardUrl}}\n\n` +
      `Vài lưu ý:\n` +
      `• Mỗi lần rút là rút TOÀN BỘ số dư khả dụng, chưa hỗ trợ rút một phần\n` +
      `• Bạn điền ngân hàng / số tài khoản / tên chủ tài khoản\n` +
      `• Admin sẽ nhắn riêng xác nhận lại với bạn trước khi chuyển khoản thật`,
  },
  {
    id: "cach_dung_bot",
    label: "Cách dùng bot",
    description:
      "User hoi dung bot the nao, gui link o dau, gui gi cho bot, copy link kieu nao, dung trong group hay nhan rieng",
    defaultAnswer:
      `Đơn giản lắm ạ 🥳\n\n` +
      `Bạn copy link sản phẩm trên Shopee hoặc TikTok Shop rồi gửi cho em — gửi trong group hoặc nhắn riêng cho em đều được nha (nhắn riêng nếu bạn không muốn người khác thấy mình mua gì 😉).\n\n` +
      `Em sẽ gửi lại link đã gắn mã hoàn tiền. Bạn mở đúng link đó và đặt hàng luôn trong phiên là xong!\n\n` +
      `⚠️ Quan trọng: đừng xem video/livestream xen giữa lúc mở link và lúc đặt hàng, đơn sẽ không được ghi nhận đó.`,
  },
  {
    id: "don_khong_ghi_nhan",
    label: "Đơn không được ghi nhận",
    description:
      "User hoi mua roi ma khong thay don, don bi mat, bam link roi ma khong duoc tinh, sao khong co hoa hong",
    defaultAnswer:
      `Bạn kiểm tra giúp em mấy điểm này nha 🔍\n\n` +
      `• Có mở đúng link em gửi và đặt hàng ngay trong phiên đó không?\n` +
      `• Có lỡ xem video hoặc livestream xen giữa không? Đây là lý do phổ biến nhất khiến đơn không được ghi nhận\n` +
      `• Đơn mới đặt thường cần vài ngày mới hiện, không lên ngay đâu ạ\n\n` +
      `Nếu chắc chắn đã làm đúng mà vẫn không thấy, bạn nhắn em kèm mã đơn để em kiểm tra giúp nha!`,
  },
  {
    id: "san_ho_tro",
    label: "Sàn được hỗ trợ",
    description:
      "User hoi san nao duoc ho tro, co Lazada/Tiki/Dien May Xanh khong, mua o dau thi duoc tinh tien",
    defaultAnswer:
      `Hiện em hỗ trợ **Shopee** và **TikTok Shop** ạ 🛒\n\n` +
      `Các sàn khác em chưa hỗ trợ, bạn gửi link vào em sẽ báo không nhận diện được nha.\n\n` +
      `Có thêm sàn mới em sẽ báo trong group liền!`,
  },
];
```

- [ ] **Step 5: Chạy test để xác nhận PASS**

Run: `npm test 2>&1 | tail -20`
Expected: toàn bộ test pass, bao gồm 4 test mới của `faqTopics`.

- [ ] **Step 6: Commit**

```bash
git add package.json src/core/faq/faqTopics.ts src/core/faq/__tests__/faqTopics.test.ts
git commit -m "Add the FAQ topic set answered in Zalo DM"
```

---

### Task 2: Bảng khoá FAQ trong LedgerStore

**Files:**
- Modify: `src/core/ledgerStore.ts` (thêm `CREATE TABLE` trong constructor + 3 method mới)
- Modify: `src/core/__tests__/ledgerStore.test.ts` (thêm test cuối file)

**Interfaces:**
- Consumes: không có
- Produces: `FaqMuteReason = "admin_typed" | "admin_command" | "unknown_question"`; `LedgerStore.muteFaqThread(platform: string, threadId: string, mutedUntilMs: number | null, reason: FaqMuteReason): void`; `LedgerStore.unmuteFaqThread(platform: string, threadId: string): void`; `LedgerStore.isFaqThreadMuted(platform: string, threadId: string, nowMs: number): boolean`

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `src/core/__tests__/ledgerStore.test.ts`:

```typescript
test("faq mute: chua khoa thi isFaqThreadMuted tra false", () => {
  const store = new LedgerStore(":memory:");
  try {
    assert.equal(store.isFaqThreadMuted("zalo", "user-1", Date.now()), false);
  } finally {
    store.close();
  }
});

test("faq mute: khoa co han - het han thi tu mo, khong can unmute", () => {
  const store = new LedgerStore(":memory:");
  try {
    const now = 1_000_000;
    store.muteFaqThread("zalo", "user-1", now + 60_000, "admin_typed");
    assert.equal(store.isFaqThreadMuted("zalo", "user-1", now + 59_000), true);
    assert.equal(store.isFaqThreadMuted("zalo", "user-1", now + 61_000), false);
  } finally {
    store.close();
  }
});

test("faq mute: mutedUntil = null la khoa vo thoi han (lenh /im)", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.muteFaqThread("zalo", "user-1", null, "admin_command");
    assert.equal(store.isFaqThreadMuted("zalo", "user-1", Date.now() + 10 * 365 * 24 * 3600_000), true);
  } finally {
    store.close();
  }
});

test("faq mute: unmute mo khoa, khoa lai duoc (upsert khong throw)", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.muteFaqThread("zalo", "user-1", null, "admin_command");
    store.unmuteFaqThread("zalo", "user-1");
    assert.equal(store.isFaqThreadMuted("zalo", "user-1", Date.now()), false);
    store.muteFaqThread("zalo", "user-1", null, "admin_command");
    assert.equal(store.isFaqThreadMuted("zalo", "user-1", Date.now()), true);
  } finally {
    store.close();
  }
});

test("faq mute: khoa theo tung thread, khong anh huong thread khac", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.muteFaqThread("zalo", "user-1", null, "admin_typed");
    assert.equal(store.isFaqThreadMuted("zalo", "user-2", Date.now()), false);
  } finally {
    store.close();
  }
});
```

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `npm test 2>&1 | grep -B 2 -A 6 "faq mute"`
Expected: FAIL — `store.muteFaqThread is not a function`

- [ ] **Step 3: Thêm bảng vào constructor `ledgerStore.ts`**

Trong khối `exec` tạo bảng (ngay sau `CREATE TABLE IF NOT EXISTS zalo_groups (...);`), thêm:

```sql
      CREATE TABLE IF NOT EXISTS faq_thread_mutes (
        platform TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        muted_until INTEGER,
        reason TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (platform, thread_id)
      );
```

- [ ] **Step 4: Thêm type + 3 method vào `ledgerStore.ts`**

Khai báo type cạnh các type export khác ở đầu file:

```typescript
/** Ly do 1 thread bi khoa FAQ - chi de chan doan khi doc DB, khong anh huong logic. */
export type FaqMuteReason = "admin_typed" | "admin_command" | "unknown_question";
```

Thêm 3 method (đặt cạnh nhóm method `zalo_groups` cho dễ tìm):

```typescript
  /**
   * Khoa FAQ cho 1 thread. mutedUntilMs = null nghia la khoa VO THOI HAN (lenh /im cua admin);
   * truyen epoch ms de khoa co han (admin vua go tay, hoac bot khong hieu cau hoi).
   * Luu DB chu khong giu trong RAM: deploy/restart khong duoc lam bot "tinh day noi leo" giua luc
   * admin dang tu van user.
   */
  muteFaqThread(platform: string, threadId: string, mutedUntilMs: number | null, reason: FaqMuteReason): void {
    this.db
      .prepare(
        `INSERT INTO faq_thread_mutes (platform, thread_id, muted_until, reason, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(platform, thread_id) DO UPDATE SET
           muted_until = excluded.muted_until,
           reason = excluded.reason,
           updated_at = excluded.updated_at`
      )
      .run(platform, threadId, mutedUntilMs, reason, Date.now());
  }

  unmuteFaqThread(platform: string, threadId: string): void {
    this.db.prepare(`DELETE FROM faq_thread_mutes WHERE platform = ? AND thread_id = ?`).run(platform, threadId);
  }

  /** muted_until NULL = vo thoi han; con lai so sanh voi nowMs (truyen vao de test duoc moc thoi gian). */
  isFaqThreadMuted(platform: string, threadId: string, nowMs: number): boolean {
    const row = this.db
      .prepare(`SELECT muted_until FROM faq_thread_mutes WHERE platform = ? AND thread_id = ?`)
      .get(platform, threadId) as { muted_until: number | null } | undefined;
    if (row === undefined) return false;
    if (row.muted_until === null) return true;
    return row.muted_until > nowMs;
  }
```

- [ ] **Step 5: Chạy test để xác nhận PASS**

Run: `npm test 2>&1 | tail -20`
Expected: toàn bộ pass, gồm 5 test `faq mute` mới.

- [ ] **Step 6: Commit**

```bash
git add src/core/ledgerStore.ts src/core/__tests__/ledgerStore.test.ts
git commit -m "Track which Zalo threads have FAQ replies muted"
```

---

### Task 3: Setting keys + form `/admin/settings`

**Files:**
- Modify: `src/core/settingsKeys.ts`
- Modify: `src/config/settingsRegistry.ts`
- Create: `src/core/faq/__tests__/faqSettings.test.ts`

**Interfaces:**
- Consumes: `FAQ_TOPICS`, `FAQ_MUTE_MINUTES_DEFAULT`, `FAQ_ANSWER_PLACEHOLDERS` (Task 1)
- Produces: `SETTINGS_KEYS.faqMuteMinutes = "faq_mute_minutes"`; `faqAnswerKey(topicId: string): string` (trả `faq_answer_<topicId>`); `SETTINGS_REGISTRY` có thêm 9 field

- [ ] **Step 1: Viết test thất bại**

Tạo `src/core/faq/__tests__/faqSettings.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { SETTINGS_KEYS, faqAnswerKey } from "../../settingsKeys.js";
import { SETTINGS_REGISTRY } from "../../../config/settingsRegistry.js";
import { FAQ_TOPICS, FAQ_MUTE_MINUTES_DEFAULT } from "../faqTopics.js";

test("faqAnswerKey: sinh key theo topic id", () => {
  assert.equal(faqAnswerKey("ty_le_hoa_hong"), "faq_answer_ty_le_hoa_hong");
});

test("SETTINGS_REGISTRY: moi chu de FAQ co dung 1 o textarea", () => {
  for (const topic of FAQ_TOPICS) {
    const field = SETTINGS_REGISTRY.filter((f) => f.key === faqAnswerKey(topic.id));
    assert.equal(field.length, 1, `thieu hoac trung field cho ${topic.id}`);
    assert.equal(field[0].type, "textarea");
    assert.equal(field[0].default, topic.defaultAnswer);
  }
});

test("SETTINGS_REGISTRY: co field so phut khoa FAQ, gioi han hop ly", () => {
  const field = SETTINGS_REGISTRY.find((f) => f.key === SETTINGS_KEYS.faqMuteMinutes);
  assert.ok(field, "thieu field faqMuteMinutes");
  assert.equal(field.type, "number");
  assert.equal(field.default, String(FAQ_MUTE_MINUTES_DEFAULT));
  assert.equal(field.min, 1);
  assert.equal(field.max, 1440);
});

test("SETTINGS_REGISTRY: khong co key trung nhau", () => {
  const keys = SETTINGS_REGISTRY.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length);
});
```

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `npm test 2>&1 | grep -A 5 faqAnswerKey`
Expected: FAIL — `faqAnswerKey` không export được từ `settingsKeys.js`

- [ ] **Step 3: Thêm key + helper vào `src/core/settingsKeys.ts`**

Thêm vào object `SETTINGS_KEYS` (trước dấu `} as const;`):

```typescript
  faqMuteMinutes: "faq_mute_minutes",
```

Thêm helper cuối file (file này zero-dependency, giữ nguyên tính chất đó):

```typescript
/**
 * Key luu cau tra loi FAQ cua 1 chu de. Tach ham thay vi liet ke tay trong SETTINGS_KEYS vi
 * danh sach chu de nam trong FAQ_TOPICS (core/faq/faqTopics.ts) - them chu de moi chi sua 1 noi.
 */
export function faqAnswerKey(topicId: string): string {
  return `faq_answer_${topicId}`;
}
```

- [ ] **Step 4: Thêm field vào `src/config/settingsRegistry.ts`**

Thêm import ở đầu file:

```typescript
import { SETTINGS_KEYS, faqAnswerKey } from "../core/settingsKeys.js";
import { FAQ_TOPICS, FAQ_MUTE_MINUTES_DEFAULT, FAQ_ANSWER_PLACEHOLDERS } from "../core/faq/faqTopics.js";
```

(dòng `import { SETTINGS_KEYS } ...` cũ được thay bằng dòng trên — không để 2 import trùng file)

Thêm vào cuối mảng `SETTINGS_REGISTRY`:

```typescript
  {
    key: SETTINGS_KEYS.faqMuteMinutes,
    label: "Số phút bot im lặng sau khi admin nhắn tay",
    type: "number",
    default: String(FAQ_MUTE_MINUTES_DEFAULT),
    min: 1,
    max: 1440,
    helpText:
      "Khi admin tự nhắn tay cho user trong Zalo DM, bot ngừng trả lời FAQ trong thread đó bằng đúng số phút này (không ảnh hưởng việc xử lý link sản phẩm và lệnh \"xemhh\" — 2 thứ đó luôn chạy). Gõ \"/im\" trong thread để khoá vô thời hạn, \"/noi\" để mở lại.",
  },
  ...FAQ_TOPICS.map((topic) => ({
    key: faqAnswerKey(topic.id),
    label: `FAQ — ${topic.label}`,
    type: "textarea" as const,
    default: topic.defaultAnswer,
    helpText:
      `Câu trả lời bot gửi khi nhận ra user đang hỏi về: ${topic.description}. ` +
      `Placeholder dùng được: ${FAQ_ANSWER_PLACEHOLDERS.map((p) => `{{${p}}}`).join(", ")}. ` +
      `Lưu ý: sửa nội dung thì giữ đúng chủ đề — phần mô tả để AI nhận diện câu hỏi nằm trong code, không đổi theo ô này.`,
  })),
```

- [ ] **Step 5: Chạy test để xác nhận PASS**

Run: `npm test 2>&1 | tail -20 && npm run typecheck`
Expected: test pass, typecheck sạch.

- [ ] **Step 6: Kiểm tra form admin render được**

Run: `npx tsx -e "import('./src/config/settingsRegistry.ts').then(m => console.log(m.SETTINGS_REGISTRY.length, m.SETTINGS_REGISTRY.slice(-9).map(f => f.key)))"`
Expected: in ra tổng số field và 9 key mới (`faq_mute_minutes` + 8 `faq_answer_*`).

- [ ] **Step 7: Commit**

```bash
git add src/core/settingsKeys.ts src/config/settingsRegistry.ts src/core/faq/__tests__/faqSettings.test.ts
git commit -m "Let the admin edit FAQ answers from the settings page"
```

---

### Task 4: FaqService (điều phối) + classifier interface

**Files:**
- Create: `src/core/faq/faqClassifier.ts`
- Create: `src/core/faq/faqService.ts`
- Create: `src/core/faq/__tests__/faqService.test.ts`

**Interfaces:**
- Consumes: `FAQ_TOPICS`, `FAQ_MUTE_MINUTES_DEFAULT` (Task 1); `LedgerStore.muteFaqThread/unmuteFaqThread/isFaqThreadMuted` (Task 2); `SETTINGS_KEYS.faqMuteMinutes`, `faqAnswerKey` (Task 3); `RateLimiter.checkAndRecord` (có sẵn); `renderTemplate` từ `src/adapters/shared/replyText.js`
- Produces:
  - `interface FaqClassifier { classify(question: string, topics: FaqTopic[]): Promise<string[]> }`
  - `class FaqService` với `resolve(input: FaqResolveInput): Promise<string | null>`, `muteByAdminTyping(platform, threadId): void`, `muteByAdminCommand(platform, threadId): void`, `unmute(platform, threadId): void`
  - `interface FaqResolveInput { platform: string; userId: string; threadId: string; question: string; userDisplayName: string; dashboardUrl: string }`
  - `interface FaqStore` (port hẹp — `LedgerStore` thoả mãn theo structural typing, không cần sửa `LedgerStore`)

⚠️ `src/core/faq/**` KHÔNG được import `zca-js`/`express`/`telegraf`. `renderTemplate` nằm trong `src/adapters/shared/replyText.ts` nhưng là hàm thuần không phụ thuộc platform — import nó là chấp nhận được và đã có tiền lệ; không import gì khác từ `adapters`.

- [ ] **Step 1: Viết `faqClassifier.ts` (chỉ interface, chưa cần test riêng)**

```typescript
import type { FaqTopic } from "./faqTopics.js";

/**
 * Diem noi de doi nha cung cap LLM (Claude, Gemini...) ma khong dung toi logic nghiep vu.
 * classify() tra ve danh sach topic id KHOP (toi da 2). Mang RONG nghia la "khong biet" - service
 * se im lang + bao admin, TUYET DOI khong doan bua mot chu de gan dung.
 */
export interface FaqClassifier {
  classify(question: string, topics: FaqTopic[]): Promise<string[]>;
}

/** Dung khi FAQ_PROVIDER=off - bot im lang y het hanh vi truoc khi co tinh nang nay. */
export class OffFaqClassifier implements FaqClassifier {
  async classify(): Promise<string[]> {
    return [];
  }
}
```

- [ ] **Step 2: Viết test thất bại cho `faqService.ts`**

Tạo `src/core/faq/__tests__/faqService.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../../ledgerStore.js";
import { RateLimiter } from "../../rateLimiter.js";
import { FaqService } from "../faqService.js";
import { FAQ_TOPICS } from "../faqTopics.js";
import { faqAnswerKey } from "../../settingsKeys.js";
import type { FaqClassifier } from "../faqClassifier.js";

/** Classifier gia - tra ve ket qua dinh san hoac throw, de test moi nhanh ma khong goi API that. */
function fakeClassifier(result: string[] | Error): FaqClassifier {
  return {
    classify: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

function setup(classifier: FaqClassifier) {
  const ledgerStore = new LedgerStore(":memory:");
  const rateLimiter = new RateLimiter(5, 600_000);
  const adminMessages: string[] = [];
  const service = new FaqService({
    classifier,
    store: ledgerStore,
    rateLimiter,
    notifyAdmin: async (message: string) => {
      adminMessages.push(message);
    },
    defaultUserSharePercent: 90,
    defaultWithdrawalThresholdVnd: 20_000,
  });
  const input = {
    platform: "zalo",
    userId: "user-1",
    threadId: "user-1",
    question: "hoàn tiền như thế nào vậy ad",
    userDisplayName: "Nguyen Van A",
    dashboardUrl: "http://localhost:3002/d/token-abc",
  };
  return {
    service,
    ledgerStore,
    adminMessages,
    input,
    cleanup: () => {
      rateLimiter.stop();
      ledgerStore.close();
    },
  };
}

test("resolve: khop 1 chu de -> tra dung cau tra loi cua chu de do", async () => {
  const { service, input, cleanup } = setup(fakeClassifier(["san_ho_tro"]));
  try {
    const answer = await service.resolve(input);
    const topic = FAQ_TOPICS.find((t) => t.id === "san_ho_tro");
    assert.equal(answer, topic.defaultAnswer);
  } finally {
    cleanup();
  }
});

test("resolve: admin sua cau tra loi tren /admin/settings -> gui ban da sua", async () => {
  const { service, ledgerStore, input, cleanup } = setup(fakeClassifier(["san_ho_tro"]));
  try {
    ledgerStore.setSetting(faqAnswerKey("san_ho_tro"), "Chỉ Shopee thôi nha");
    assert.equal(await service.resolve(input), "Chỉ Shopee thôi nha");
  } finally {
    cleanup();
  }
});

test("resolve: placeholder duoc render (khong con {{...}} trong tin gui user)", async () => {
  const { service, ledgerStore, input, cleanup } = setup(fakeClassifier(["ty_le_hoa_hong"]));
  try {
    ledgerStore.setSetting(
      faqAnswerKey("ty_le_hoa_hong"),
      "Bạn nhận {{userSharePercent}}%, em giữ {{botSharePercent}}%. Rút từ {{withdrawalThreshold}}. Xem: {{dashboardUrl}}"
    );
    const answer = await service.resolve(input);
    assert.equal(
      answer,
      "Bạn nhận 90%, em giữ 10%. Rút từ 20.000đ. Xem: http://localhost:3002/d/token-abc"
    );
  } finally {
    cleanup();
  }
});

test("resolve: % lay tu settings hien hanh, khong phai gia tri env luc khoi dong", async () => {
  const { service, ledgerStore, input, cleanup } = setup(fakeClassifier(["ty_le_hoa_hong"]));
  try {
    ledgerStore.setSetting("commission_user_share_percent", "80");
    ledgerStore.setSetting(faqAnswerKey("ty_le_hoa_hong"), "{{userSharePercent}}/{{botSharePercent}}");
    assert.equal(await service.resolve(input), "80/20");
  } finally {
    cleanup();
  }
});

test("resolve: khop 2 chu de -> ghep 2 cau tra loi bang dong trong", async () => {
  const { service, ledgerStore, input, cleanup } = setup(
    fakeClassifier(["san_ho_tro", "cach_rut_tien"])
  );
  try {
    ledgerStore.setSetting(faqAnswerKey("san_ho_tro"), "A");
    ledgerStore.setSetting(faqAnswerKey("cach_rut_tien"), "B");
    assert.equal(await service.resolve(input), "A\n\nB");
  } finally {
    cleanup();
  }
});

test("resolve: khong biet -> im lang, bao admin, khoa thread", async () => {
  const { service, ledgerStore, adminMessages, input, cleanup } = setup(fakeClassifier([]));
  try {
    assert.equal(await service.resolve(input), null);
    assert.equal(adminMessages.length, 1);
    assert.match(adminMessages[0], /hoàn tiền như thế nào vậy ad/);
    assert.equal(ledgerStore.isFaqThreadMuted("zalo", "user-1", Date.now()), true);
  } finally {
    cleanup();
  }
});

test("resolve: classifier throw (API loi) -> xu ly y het 'khong biet', khong nem ra ngoai", async () => {
  const { service, ledgerStore, adminMessages, input, cleanup } = setup(
    fakeClassifier(new Error("API 500"))
  );
  try {
    assert.equal(await service.resolve(input), null);
    assert.equal(adminMessages.length, 1);
    assert.equal(ledgerStore.isFaqThreadMuted("zalo", "user-1", Date.now()), true);
  } finally {
    cleanup();
  }
});

test("resolve: thread dang khoa -> im lang, KHONG goi classifier", async () => {
  let called = 0;
  const classifier: FaqClassifier = {
    classify: async () => {
      called += 1;
      return ["san_ho_tro"];
    },
  };
  const { service, ledgerStore, input, cleanup } = setup(classifier);
  try {
    ledgerStore.muteFaqThread("zalo", "user-1", null, "admin_command");
    assert.equal(await service.resolve(input), null);
    assert.equal(called, 0);
  } finally {
    cleanup();
  }
});

test("resolve: qua rate limit -> im lang, khong goi classifier them", async () => {
  let called = 0;
  const classifier: FaqClassifier = {
    classify: async () => {
      called += 1;
      return ["san_ho_tro"];
    },
  };
  const { service, input, cleanup } = setup(classifier);
  try {
    for (let i = 0; i < 5; i += 1) {
      assert.notEqual(await service.resolve(input), null);
    }
    assert.equal(await service.resolve(input), null);
    assert.equal(called, 5);
  } finally {
    cleanup();
  }
});

test("muteByAdminTyping: khoa theo so phut trong settings", async () => {
  const { service, ledgerStore, cleanup } = setup(fakeClassifier([]));
  try {
    ledgerStore.setSetting("faq_mute_minutes", "10");
    service.muteByAdminTyping("zalo", "user-1");
    assert.equal(ledgerStore.isFaqThreadMuted("zalo", "user-1", Date.now() + 9 * 60_000), true);
    assert.equal(ledgerStore.isFaqThreadMuted("zalo", "user-1", Date.now() + 11 * 60_000), false);
  } finally {
    cleanup();
  }
});

test("muteByAdminCommand (/im) khoa vo thoi han, unmute (/noi) mo lai", async () => {
  const { service, ledgerStore, cleanup } = setup(fakeClassifier([]));
  try {
    service.muteByAdminCommand("zalo", "user-1");
    assert.equal(ledgerStore.isFaqThreadMuted("zalo", "user-1", Date.now() + 365 * 24 * 3600_000), true);
    service.unmute("zalo", "user-1");
    assert.equal(ledgerStore.isFaqThreadMuted("zalo", "user-1", Date.now()), false);
  } finally {
    cleanup();
  }
});

test("notifyAdmin that bai -> khong lam hong resolve (best-effort)", async () => {
  const ledgerStore = new LedgerStore(":memory:");
  const rateLimiter = new RateLimiter(5, 600_000);
  try {
    const service = new FaqService({
      classifier: fakeClassifier([]),
      store: ledgerStore,
      rateLimiter,
      notifyAdmin: async () => {
        throw new Error("Telegram 429");
      },
      defaultUserSharePercent: 90,
      defaultWithdrawalThresholdVnd: 20_000,
    });
    assert.equal(
      await service.resolve({
        platform: "zalo",
        userId: "user-1",
        threadId: "user-1",
        question: "abc",
        userDisplayName: "A",
        dashboardUrl: "http://x/d/t",
      }),
      null
    );
  } finally {
    rateLimiter.stop();
    ledgerStore.close();
  }
});
```

- [ ] **Step 3: Chạy test để xác nhận FAIL**

Run: `npm test 2>&1 | grep -A 5 faqService`
Expected: FAIL — `Cannot find module '../faqService.js'`

- [ ] **Step 4: Viết `src/core/faq/faqService.ts`**

```typescript
import { renderTemplate } from "../../adapters/shared/replyText.js";
import { SETTINGS_KEYS, faqAnswerKey } from "../settingsKeys.js";
import type { RateLimiter } from "../rateLimiter.js";
import type { FaqClassifier } from "./faqClassifier.js";
import { FAQ_TOPICS, FAQ_MUTE_MINUTES_DEFAULT, type FaqTopic } from "./faqTopics.js";

/**
 * Port hep toi LedgerStore - khai bao o day thay vi import class that de core/faq khong phu thuoc
 * nguoc vao toan bo LedgerStore. LedgerStore thoa man interface nay theo structural typing, khong
 * can sua gi ben do.
 */
export interface FaqStore {
  isFaqThreadMuted(platform: string, threadId: string, nowMs: number): boolean;
  muteFaqThread(
    platform: string,
    threadId: string,
    mutedUntilMs: number | null,
    reason: "admin_typed" | "admin_command" | "unknown_question"
  ): void;
  unmuteFaqThread(platform: string, threadId: string): void;
  getSetting(key: string, defaultValue: string): string;
  getSettingInt(key: string, defaultValue: number): number;
}

export interface FaqServiceOptions {
  classifier: FaqClassifier;
  store: FaqStore;
  /** Rate limit RIENG cho FAQ (khong dung chung voi rate limit tao link) - chan 1 user dot tien API. */
  rateLimiter: RateLimiter;
  /** Bao cho CHU BOT, khong phai user - xem adapters/shared/adminNotifier.ts. */
  notifyAdmin: (message: string) => Promise<void>;
  /** Fallback khi admin chua override tren /admin/settings (dong bo voi env, giong cac cho khac). */
  defaultUserSharePercent: number;
  defaultWithdrawalThresholdVnd: number;
}

export interface FaqResolveInput {
  platform: string;
  userId: string;
  threadId: string;
  question: string;
  userDisplayName: string;
  /** Link dashboard ca nhan cua user - adapter tao san qua findOrCreateDashboardToken. */
  dashboardUrl: string;
}

function formatVnd(amount: number): string {
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(amount)}đ`;
}

/**
 * Dieu phoi FAQ: mute -> rate limit -> classify -> lay cau tra loi soan san -> render placeholder.
 * Tra ve null nghia la IM LANG (adapter khong gui gi ca) - moi quyet dinh im/noi nam o day, adapter
 * khong tu suy luan.
 */
export class FaqService {
  constructor(private readonly options: FaqServiceOptions) {}

  async resolve(input: FaqResolveInput): Promise<string | null> {
    const { platform, threadId, userId, question } = input;

    if (this.options.store.isFaqThreadMuted(platform, threadId, Date.now())) return null;
    if (!this.options.rateLimiter.checkAndRecord(`${platform}-faq:${userId}`).allowed) return null;

    let topicIds: string[] = [];
    try {
      topicIds = await this.options.classifier.classify(question, FAQ_TOPICS);
    } catch (err: unknown) {
      // Loi API khong duoc lam hong luong tin nhan - xu ly y het "khong nhan ra cau hoi".
      console.warn("[faq] classifier loi:", err instanceof Error ? err.message : err);
      topicIds = [];
    }

    const topics = topicIds
      .map((id) => FAQ_TOPICS.find((t) => t.id === id))
      .filter((t): t is FaqTopic => t !== undefined);

    if (topics.length === 0) {
      this.escalateToAdmin(input);
      return null;
    }

    return topics.map((topic) => this.answerFor(topic, input)).join("\n\n");
  }

  /** Admin vua go tay trong thread -> bot im N phut de khong chen ngang cuoc tro chuyen. */
  muteByAdminTyping(platform: string, threadId: string): void {
    this.options.store.muteFaqThread(platform, threadId, Date.now() + this.muteMs(), "admin_typed");
  }

  /** Lenh "/im" - khoa vo thoi han cho toi khi admin go "/noi". */
  muteByAdminCommand(platform: string, threadId: string): void {
    this.options.store.muteFaqThread(platform, threadId, null, "admin_command");
  }

  unmute(platform: string, threadId: string): void {
    this.options.store.unmuteFaqThread(platform, threadId);
  }

  private muteMs(): number {
    return this.options.store.getSettingInt(SETTINGS_KEYS.faqMuteMinutes, FAQ_MUTE_MINUTES_DEFAULT) * 60_000;
  }

  /**
   * Khong nhan ra cau hoi -> bao chu bot VA khoa thread luon: admin sap vao tra loi tay, neu khong
   * khoa thi bot se chen ngang giua luc admin dang go.
   */
  private escalateToAdmin(input: FaqResolveInput): void {
    this.options.store.muteFaqThread(
      input.platform,
      input.threadId,
      Date.now() + this.muteMs(),
      "unknown_question"
    );
    const message =
      `❓ [${input.platform}] ${input.userDisplayName} (${input.userId}) vừa hỏi câu bot không hiểu:\n` +
      `"${input.question}"`;
    this.options.notifyAdmin(message).catch((err: unknown) => {
      console.warn("[faq] khong bao duoc admin:", err instanceof Error ? err.message : err);
    });
  }

  private answerFor(topic: FaqTopic, input: FaqResolveInput): string {
    const template = this.options.store.getSetting(faqAnswerKey(topic.id), topic.defaultAnswer);
    const userShare = this.options.store.getSettingInt(
      SETTINGS_KEYS.userSharePercent,
      this.options.defaultUserSharePercent
    );
    const threshold = this.options.store.getSettingInt(
      SETTINGS_KEYS.withdrawalThresholdVnd,
      this.options.defaultWithdrawalThresholdVnd
    );
    return renderTemplate(template, {
      userSharePercent: String(userShare),
      botSharePercent: String(100 - userShare),
      withdrawalThreshold: formatVnd(threshold),
      dashboardUrl: input.dashboardUrl,
    });
  }
}
```

- [ ] **Step 5: Chạy test để xác nhận PASS**

Run: `npm test 2>&1 | tail -20 && npm run typecheck`
Expected: 12 test `faqService` pass, typecheck sạch.

- [ ] **Step 6: Commit**

```bash
git add src/core/faq/faqClassifier.ts src/core/faq/faqService.ts src/core/faq/__tests__/faqService.test.ts
git commit -m "Decide FAQ replies from preset answers, never from the model"
```

---

### Task 5: Claude classifier

**Files:**
- Create: `src/core/faq/providers/claudeClassifier.ts`
- Create: `src/core/faq/providers/index.ts`
- Create: `src/core/faq/__tests__/claudeClassifier.test.ts`
- Modify: `package.json` (dependency `@anthropic-ai/sdk`)

**Interfaces:**
- Consumes: `FaqClassifier`, `OffFaqClassifier` (Task 4); `FaqTopic`, `FAQ_TOPICS` (Task 1)
- Produces: `buildClassifierSystemPrompt(topics: FaqTopic[]): string`; `parseTopicIds(raw: string, topics: FaqTopic[]): string[]`; `class ClaudeFaqClassifier implements FaqClassifier`; `createFaqClassifier(config: {provider: string; apiKey: string; model: string}): FaqClassifier`

- [ ] **Step 1: Cài SDK**

Run: `npm install @anthropic-ai/sdk`
Expected: `package.json` có thêm `@anthropic-ai/sdk` trong `dependencies`.

- [ ] **Step 2: Viết test thất bại**

Tạo `src/core/faq/__tests__/claudeClassifier.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClassifierSystemPrompt, parseTopicIds } from "../providers/claudeClassifier.js";
import { createFaqClassifier } from "../providers/index.js";
import { FAQ_TOPICS } from "../faqTopics.js";

test("buildClassifierSystemPrompt: liet ke du id + mo ta cua moi chu de", () => {
  const prompt = buildClassifierSystemPrompt(FAQ_TOPICS);
  for (const topic of FAQ_TOPICS) {
    assert.ok(prompt.includes(topic.id), `thieu id ${topic.id}`);
    assert.ok(prompt.includes(topic.description), `thieu mo ta ${topic.id}`);
  }
});

test("parseTopicIds: nhan dung 1 id", () => {
  assert.deepEqual(parseTopicIds("ty_le_hoa_hong", FAQ_TOPICS), ["ty_le_hoa_hong"]);
});

test("parseTopicIds: chiu duoc dinh dang JSON array va chu thua xung quanh", () => {
  assert.deepEqual(parseTopicIds('["cach_rut_tien"]', FAQ_TOPICS), ["cach_rut_tien"]);
  assert.deepEqual(parseTopicIds("Chu de: cach_rut_tien.", FAQ_TOPICS), ["cach_rut_tien"]);
});

test("parseTopicIds: nhan 2 id, giu thu tu xuat hien", () => {
  assert.deepEqual(parseTopicIds('["cach_rut_tien", "xem_so_du"]', FAQ_TOPICS), [
    "cach_rut_tien",
    "xem_so_du",
  ]);
});

test("parseTopicIds: id la / KHONG_BIET -> rong", () => {
  assert.deepEqual(parseTopicIds("KHONG_BIET", FAQ_TOPICS), []);
  assert.deepEqual(parseTopicIds("khong_ro_chu_de_nay", FAQ_TOPICS), []);
  assert.deepEqual(parseTopicIds("", FAQ_TOPICS), []);
});

// Model doc vet ca danh sach chu de thay vi chon -> khong duoc coi la "khop 2 chu de dau tien".
test("parseTopicIds: qua 2 id -> coi nhu khong dang tin, tra rong", () => {
  const raw = FAQ_TOPICS.map((t) => t.id).join(", ");
  assert.deepEqual(parseTopicIds(raw, FAQ_TOPICS), []);
});

test("parseTopicIds: id trung lap chi tinh 1 lan", () => {
  assert.deepEqual(parseTopicIds("xem_so_du xem_so_du", FAQ_TOPICS), ["xem_so_du"]);
});

test("createFaqClassifier: provider 'off' luon tra rong", async () => {
  const classifier = createFaqClassifier({ provider: "off", apiKey: "", model: "claude-haiku-4-5" });
  assert.deepEqual(await classifier.classify("hoàn tiền sao?", FAQ_TOPICS), []);
});

test("createFaqClassifier: provider 'claude' thieu apiKey -> rot ve off thay vi crash luc khoi dong", async () => {
  const classifier = createFaqClassifier({ provider: "claude", apiKey: "", model: "claude-haiku-4-5" });
  assert.deepEqual(await classifier.classify("hoàn tiền sao?", FAQ_TOPICS), []);
});
```

- [ ] **Step 3: Chạy test để xác nhận FAIL**

Run: `npm test 2>&1 | grep -A 5 claudeClassifier`
Expected: FAIL — `Cannot find module '../providers/claudeClassifier.js'`

- [ ] **Step 4: Viết `src/core/faq/providers/claudeClassifier.ts`**

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { FaqClassifier } from "../faqClassifier.js";
import type { FaqTopic } from "../faqTopics.js";

/** Toi da 2 chu de cho 1 cau hoi - nhieu hon la dau hieu model doc vet danh sach, xem parseTopicIds. */
const MAX_TOPICS = 2;

export function buildClassifierSystemPrompt(topics: FaqTopic[]): string {
  const list = topics.map((t) => `- ${t.id}: ${t.description}`).join("\n");
  return (
    `Bạn phân loại câu hỏi của khách hàng vào các chủ đề dưới đây.\n\n` +
    `Chủ đề:\n${list}\n\n` +
    `Quy tắc:\n` +
    `- CHỈ trả về id chủ đề, cách nhau bằng dấu phẩy. Không viết câu trả lời, không giải thích.\n` +
    `- Tối đa ${MAX_TOPICS} id. Nếu câu hỏi hỏi nhiều hơn ${MAX_TOPICS} thứ, chọn ${MAX_TOPICS} ý chính nhất.\n` +
    `- Nếu câu hỏi không khớp rõ ràng chủ đề nào, trả về đúng chữ KHONG_BIET. ` +
    `Thà không biết còn hơn đoán sai — người thật sẽ vào trả lời thay bạn.\n` +
    `- Câu hỏi về đơn hàng, số dư, hoặc tình trạng cụ thể của cá nhân người này ` +
    `(ví dụ "đơn hôm qua của tôi đâu", "sao tôi chưa nhận được tiền") LUÔN trả về KHONG_BIET, ` +
    `vì bạn không có dữ liệu của họ.`
  );
}

/**
 * Chi chap nhan id CO THAT trong danh sach chu de - model tra ve gi khac deu bi bo qua, nen khong
 * co duong nao de model bia ra mot chu de moi. Qua MAX_TOPICS id thi coi nhu model doc vet ca danh
 * sach thay vi chon, tra rong (im lang + bao admin) thay vi doan 2 chu de dau tien.
 */
export function parseTopicIds(raw: string, topics: FaqTopic[]): string[] {
  const valid = new Set(topics.map((t) => t.id));
  const found: string[] = [];
  for (const match of raw.matchAll(/[a-z0-9_]+/g)) {
    const token = match[0];
    if (valid.has(token) && !found.includes(token)) found.push(token);
  }
  return found.length <= MAX_TOPICS ? found : [];
}

export interface ClaudeFaqClassifierOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

/**
 * Goi Claude de PHAN LOAI cau hoi, KHONG de sinh cau tra loi - text gui user luon la chuoi admin
 * soan san (xem faqService.answerFor). Day la ly do bot khong the bia thong tin ve tien.
 */
export class ClaudeFaqClassifier implements FaqClassifier {
  private readonly client: Anthropic;

  constructor(private readonly options: ClaudeFaqClassifierOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      timeout: options.timeoutMs ?? 10_000,
    });
  }

  async classify(question: string, topics: FaqTopic[]): Promise<string[]> {
    const response = await this.client.messages.create({
      model: this.options.model,
      max_tokens: 64,
      system: buildClassifierSystemPrompt(topics),
      // Cau hoi cua user di trong messages, KHONG nhet vao system - giu ranh gioi prompt injection.
      messages: [{ role: "user", content: question }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join(" ");

    return parseTopicIds(text, topics);
  }
}
```

- [ ] **Step 5: Viết `src/core/faq/providers/index.ts`**

```typescript
import { OffFaqClassifier, type FaqClassifier } from "../faqClassifier.js";
import { ClaudeFaqClassifier } from "./claudeClassifier.js";

export interface FaqClassifierConfig {
  provider: string;
  apiKey: string;
  model: string;
}

/**
 * Factory theo env.faq.provider - giong pattern createAffiliateProvider().
 * Thieu apiKey thi ROT VE off kem canh bao thay vi throw: bot van chay binh thuong (chi mat FAQ),
 * khong duoc chet ca process chi vi thieu 1 key cua tinh nang phu.
 */
export function createFaqClassifier(config: FaqClassifierConfig): FaqClassifier {
  if (config.provider !== "claude") return new OffFaqClassifier();
  if (config.apiKey === "") {
    console.warn("[faq] FAQ_PROVIDER=claude nhung thieu ANTHROPIC_API_KEY - tat FAQ, bot van chay binh thuong.");
    return new OffFaqClassifier();
  }
  return new ClaudeFaqClassifier({ apiKey: config.apiKey, model: config.model });
}
```

- [ ] **Step 6: Chạy test để xác nhận PASS**

Run: `npm test 2>&1 | tail -20 && npm run typecheck`
Expected: 9 test mới pass, typecheck sạch.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/core/faq/providers/
git add src/core/faq/__tests__/claudeClassifier.test.ts
git commit -m "Classify FAQ questions with Claude Haiku"
```

---

### Task 6: SentMessageTracker (phân biệt tin bot gửi vs admin gõ tay)

**Files:**
- Create: `src/adapters/zalo/sentMessageTracker.ts`
- Create: `src/adapters/zalo/__tests__/sentMessageTracker.test.ts`

**Interfaces:**
- Consumes: không có
- Produces: `class SentMessageTracker` với `record(msgId: number | string | null | undefined, text: string): void` và `isOwn(msgId: string, text: string): boolean`; constructor `(options?: { ttlMs?: number; textMatchWindowMs?: number; now?: () => number })`

- [ ] **Step 1: Viết test thất bại**

Tạo `src/adapters/zalo/__tests__/sentMessageTracker.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { SentMessageTracker } from "../sentMessageTracker.js";

function trackerAt(clock: { now: number }) {
  return new SentMessageTracker({ now: () => clock.now });
}

test("isOwn: msgId da ghi -> dung la tin cua bot", () => {
  const clock = { now: 1_000_000 };
  const tracker = trackerAt(clock);
  tracker.record(12345, "xin chao");
  assert.equal(tracker.isOwn("12345", "xin chao"), true);
});

test("isOwn: msgId la -> khong phai tin cua bot (admin go tay)", () => {
  const clock = { now: 1_000_000 };
  const tracker = trackerAt(clock);
  tracker.record(12345, "xin chao");
  assert.equal(tracker.isOwn("99999", "admin go tay"), false);
});

// api.sendMessage co the tra message: null -> khong co msgId de doi chieu, roi ve so khop noi dung.
test("isOwn: khong co msgId -> so khop noi dung trong 60s", () => {
  const clock = { now: 1_000_000 };
  const tracker = trackerAt(clock);
  tracker.record(null, "cau tra loi cua bot");
  assert.equal(tracker.isOwn("77777", "cau tra loi cua bot"), true);
  clock.now += 61_000;
  assert.equal(tracker.isOwn("77777", "cau tra loi cua bot"), false);
});

test("isOwn: entry het han sau 5 phut", () => {
  const clock = { now: 1_000_000 };
  const tracker = trackerAt(clock);
  tracker.record(12345, "xin chao");
  clock.now += 4 * 60_000;
  assert.equal(tracker.isOwn("12345", "xin chao"), true);
  clock.now += 2 * 60_000;
  assert.equal(tracker.isOwn("12345", "xin chao"), false);
});

test("record: khong phinh vo han - entry cu bi don khi ghi them", () => {
  const clock = { now: 1_000_000 };
  const tracker = trackerAt(clock);
  for (let i = 0; i < 100; i += 1) tracker.record(i, `tin ${i}`);
  clock.now += 6 * 60_000;
  tracker.record(999, "tin moi");
  assert.equal(tracker.size, 1);
});
```

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `npm test 2>&1 | grep -A 5 sentMessageTracker`
Expected: FAIL — `Cannot find module '../sentMessageTracker.js'`

- [ ] **Step 3: Viết `src/adapters/zalo/sentMessageTracker.ts`**

```typescript
interface SentEntry {
  msgId: string | null;
  text: string;
  sentAt: number;
}

/**
 * Nho cac tin bot VUA TU GUI de phan biet voi tin ADMIN GO TAY.
 *
 * Ly do ton tai: bot chay voi `selfListen: true` nen nhan duoc CA tin do chinh tai khoan nay gui di
 * (xem zca-js listen.js - message co isSelf=true van duoc emit). Tin do co 2 nguon: bot tu gui, hoac
 * chu bot mo Zalo go tay tra loi user. Nguon thu 2 la tin hieu "admin dang tu van, bot im di".
 *
 * api.sendMessage() tra ve { message: { msgId } | null } nen thuong doi chieu duoc bang msgId. Truong
 * hop message la null thi roi xuong so khop noi dung trong 60s. Neu ca 2 deu truot, bot se tuong tin
 * cua CHINH MINH la admin go tay va tu khoa minh - huong hong AN TOAN (im lang, khong noi bay).
 */
export class SentMessageTracker {
  private entries: SentEntry[] = [];
  private readonly ttlMs: number;
  private readonly textMatchWindowMs: number;
  private readonly now: () => number;

  constructor(options: { ttlMs?: number; textMatchWindowMs?: number; now?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? 5 * 60_000;
    this.textMatchWindowMs = options.textMatchWindowMs ?? 60_000;
    this.now = options.now ?? (() => Date.now());
  }

  get size(): number {
    return this.entries.length;
  }

  record(msgId: number | string | null | undefined, text: string): void {
    this.prune();
    this.entries.push({
      msgId: msgId === null || msgId === undefined ? null : String(msgId),
      text,
      sentAt: this.now(),
    });
  }

  isOwn(msgId: string, text: string): boolean {
    this.prune();
    const now = this.now();
    return this.entries.some((entry) => {
      if (entry.msgId !== null && msgId !== "" && entry.msgId === msgId) return true;
      return entry.text === text && now - entry.sentAt <= this.textMatchWindowMs;
    });
  }

  private prune(): void {
    const cutoff = this.now() - this.ttlMs;
    this.entries = this.entries.filter((entry) => entry.sentAt > cutoff);
  }
}
```

- [ ] **Step 4: Chạy test để xác nhận PASS**

Run: `npm test 2>&1 | tail -20`
Expected: 5 test mới pass.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/zalo/sentMessageTracker.ts src/adapters/zalo/__tests__/sentMessageTracker.test.ts
git commit -m "Tell the bot's own Zalo messages apart from the admin's"
```

---

### Task 7: Nối vào Zalo adapter

**Files:**
- Modify: `src/adapters/zalo/bot.ts`
- Modify: `src/adapters/zalo/__tests__/zaloBot.test.ts`

**Interfaces:**
- Consumes: `FaqService` (Task 4), `SentMessageTracker` (Task 6)
- Produces: `ZaloGroupBotOptions.faqService?: FaqService` (optional — không truyền thì bot im lặng hệt hôm nay)

- [ ] **Step 1: Viết test thất bại**

Thêm vào `src/adapters/zalo/__tests__/zaloBot.test.ts`. Trước hết bổ sung import và helper (đặt cạnh `makeMessage` có sẵn):

```typescript
import { FaqService } from "../../../core/faq/faqService.js";
import { faqAnswerKey } from "../../../core/settingsKeys.js";

/** Tin do CHINH tai khoan bot gui ra (admin go tay hoac bot tu gui) - zca-js emit khi selfListen=true. */
function makeSelfMessage(text: string, msgId: string, threadId = "user-1"): Message {
  return {
    type: ThreadType.User,
    threadId,
    isSelf: true,
    data: { uidFrom: "bot-uid", dName: "Admin", content: text, msgId },
  } as unknown as Message;
}
```

Rồi thêm các test:

```typescript
test("Zalo DM: cau hoi FAQ -> bot tra loi bang cau soan san", async () => {
  const { sent, ledgerStore, handleMessage, attachFaq, cleanup } = setup();
  try {
    ledgerStore.tryClaimWelcomeMessage("zalo", "user-1");
    attachFaq(async () => ["san_ho_tro"]);
    ledgerStore.setSetting(faqAnswerKey("san_ho_tro"), "Shopee và TikTok Shop nha");

    await handleMessage(makeMessage(ThreadType.User, "ad ơi bot hỗ trợ sàn nào v"));

    assert.equal(sent.length, 1);
    assert.equal(bodyOf(sent[0]), "Shopee và TikTok Shop nha");
  } finally {
    cleanup();
  }
});

test("Zalo DM: khong gan faqService -> im lang y het hanh vi cu", async () => {
  const { sent, ledgerStore, handleMessage, cleanup } = setup();
  try {
    ledgerStore.tryClaimWelcomeMessage("zalo", "user-1");
    await handleMessage(makeMessage(ThreadType.User, "hoàn tiền sao vậy ad"));
    assert.equal(sent.length, 0);
  } finally {
    cleanup();
  }
});

test("Zalo group: cau hoi khong phai link -> van tra USAGE_TEXT, KHONG dung FAQ", async () => {
  const { sent, handleMessage, attachFaq, cleanup } = setup();
  try {
    let called = 0;
    attachFaq(async () => {
      called += 1;
      return ["san_ho_tro"];
    });

    await handleMessage(makeMessage(ThreadType.Group, "hoàn tiền sao vậy ad"));

    assert.equal(called, 0, "FAQ khong duoc chay trong group");
    assert.equal(sent.length, 1);
    assert.match(bodyOf(sent[0]), /link sản phẩm/i);
  } finally {
    cleanup();
  }
});

test("Zalo DM: admin go tay -> khoa FAQ thread do", async () => {
  const { ledgerStore, handleMessage, attachFaq, cleanup } = setup();
  try {
    attachFaq(async () => ["san_ho_tro"]);
    await handleMessage(makeSelfMessage("để mình check giúp bạn nha", "msg-admin-1"));
    assert.equal(ledgerStore.isFaqThreadMuted("zalo", "user-1", Date.now()), true);
  } finally {
    cleanup();
  }
});

test("Zalo DM: tin do CHINH bot gui ra -> KHONG tu khoa minh", async () => {
  const { sent, ledgerStore, handleMessage, attachFaq, cleanup } = setup();
  try {
    ledgerStore.tryClaimWelcomeMessage("zalo", "user-1");
    attachFaq(async () => ["san_ho_tro"]);
    ledgerStore.setSetting(faqAnswerKey("san_ho_tro"), "Shopee và TikTok Shop nha");

    await handleMessage(makeMessage(ThreadType.User, "bot hỗ trợ sàn nào"));
    assert.equal(sent.length, 1);

    // zca-js phat lai chinh tin bot vua gui (selfListen) - phai duoc nhan ra qua SentMessageTracker.
    await handleMessage(makeSelfMessage("Shopee và TikTok Shop nha", "msg-bot-1"));
    assert.equal(ledgerStore.isFaqThreadMuted("zalo", "user-1", Date.now()), false);
  } finally {
    cleanup();
  }
});

test("Zalo DM: lenh /im khoa vo thoi han, /noi mo lai", async () => {
  const { ledgerStore, handleMessage, attachFaq, cleanup } = setup();
  try {
    attachFaq(async () => ["san_ho_tro"]);

    await handleMessage(makeSelfMessage("/im", "msg-admin-2"));
    assert.equal(ledgerStore.isFaqThreadMuted("zalo", "user-1", Date.now() + 365 * 24 * 3600_000), true);

    await handleMessage(makeSelfMessage("/noi", "msg-admin-3"));
    assert.equal(ledgerStore.isFaqThreadMuted("zalo", "user-1", Date.now()), false);
  } finally {
    cleanup();
  }
});

test("Zalo DM: user go /im khong kich hoat duoc lenh admin (khong phai isSelf)", async () => {
  const { ledgerStore, handleMessage, attachFaq, cleanup } = setup();
  try {
    attachFaq(async () => []);
    await handleMessage(makeMessage(ThreadType.User, "/im"));
    // "/im" cua user di vao luong FAQ binh thuong -> classifier khong khop -> khoa CO HAN theo
    // faq_mute_minutes. Neu lenh admin bi kich hoat nham thi khoa se la VO THOI HAN - moc 10 nam
    // duoi day chinh la cho phan biet 2 truong hop do.
    assert.equal(
      ledgerStore.isFaqThreadMuted("zalo", "user-1", Date.now() + 10 * 365 * 24 * 3600_000),
      false,
      "user khong duoc phep khoa vo thoi han bang /im"
    );
  } finally {
    cleanup();
  }
});

test("Zalo DM: thread bi khoa -> link san pham VA xemhh van chay", async () => {
  const { sent, ledgerStore, handleMessage, attachFaq, cleanup } = setup();
  try {
    ledgerStore.tryClaimWelcomeMessage("zalo", "user-1");
    attachFaq(async () => ["san_ho_tro"]);
    ledgerStore.muteFaqThread("zalo", "user-1", null, "admin_command");

    await handleMessage(makeMessage(ThreadType.User, PRODUCT_URL));
    assert.equal(sent.length, 1, "link san pham phai duoc xu ly du thread bi khoa");
    assert.match(bodyOf(sent[0]), /https:\/\/mock-aff\.local\//);

    await handleMessage(makeMessage(ThreadType.User, "xemhh"));
    assert.equal(sent.length, 2, "xemhh phai chay du thread bi khoa");
    assert.match(bodyOf(sent[1]), /\/d\//);

    await handleMessage(makeMessage(ThreadType.User, "bot hỗ trợ sàn nào"));
    assert.equal(sent.length, 2, "cau hoi FAQ phai bi im khi thread bi khoa");
  } finally {
    cleanup();
  }
});
```

Sửa `setup()` để trả thêm `attachFaq` — thêm vào cuối hàm `setup()`, ngay trước `return {`:

```typescript
  // RateLimiter da duoc import san o dau file test nay (dung cho LinkResolverService).
  const faqRateLimiter = new RateLimiter(100, 60_000);
  /** Gan FaqService vao bot sau khi tao (giong index.ts) - truyen ham classify gia de khoi goi API. */
  const attachFaq = (classify: (question: string) => Promise<string[]>) => {
    (bot as unknown as { options: { faqService?: FaqService } }).options.faqService = new FaqService({
      classifier: { classify: (question: string) => classify(question) },
      store: ledgerStore,
      rateLimiter: faqRateLimiter,
      notifyAdmin: async () => {},
      defaultUserSharePercent: 90,
      defaultWithdrawalThresholdVnd: 20_000,
    });
  };
```

và thêm `attachFaq` vào object `return {...}`, thêm `faqRateLimiter.stop();` vào `cleanup()`.

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `npm test 2>&1 | grep -c "not ok"`
Expected: một số test mới FAIL (bot chưa có `faqService`).

- [ ] **Step 3: Sửa `src/adapters/zalo/bot.ts` — import + option + tracker**

Thêm import:

```typescript
import type { FaqService } from "../../core/faq/faqService.js";
import { SentMessageTracker } from "./sentMessageTracker.js";
```

Thêm vào `ZaloGroupBotOptions`:

```typescript
  /**
   * Tra loi cau hoi FAQ trong DM. Khong truyen (vd FAQ_PROVIDER=off) thi bot IM LANG voi moi DM
   * khong phai "xemhh"/link san pham - dung hanh vi truoc 2026-09-13.
   */
  faqService?: FaqService;
```

Thêm field vào class `ZaloGroupBot`:

```typescript
  /** Nho msgId bot vua gui de khong nham tin cua chinh minh voi tin admin go tay - xem handleSelfMessage. */
  private readonly sentTracker = new SentMessageTracker();
```

- [ ] **Step 4: Thêm helper gửi DM có ghi nhận + nhánh `isSelf`**

Thêm 2 method mới vào class:

```typescript
  /**
   * Gui DM va GHI NHAN msgId - bat buoc dung cho MOI tin bot gui trong DM. Gui thang qua
   * api.sendMessage ma quen ghi nhan se lam bot tuong do la tin admin go tay roi TU KHOA CHINH MINH.
   */
  private async sendTrackedDirect(api: API, threadId: string, body: string): Promise<void> {
    const result = (await api.sendMessage(body, threadId, ThreadType.User)) as
      | { message?: { msgId?: number } | null }
      | undefined;
    this.sentTracker.record(result?.message?.msgId, body);
  }

  /**
   * Tin do CHINH tai khoan bot gui ra (selfListen=true moi thay duoc). Hai nguon: bot tu gui, hoac
   * CHU BOT mo Zalo go tay tra loi user - nguon thu 2 la tin hieu "admin dang tu van, bot im di".
   * CHI xu ly DM: trong group bo qua nhu cu, neu khong bot se tu khoa minh moi lan tra link.
   */
  private async handleSelfMessage(message: Message): Promise<void> {
    if (message.type !== ThreadType.User) return;
    const faqService = this.options.faqService;
    if (faqService === undefined) return;

    const text = extractMessageText(message.data.content);
    if (text === null) return;

    const msgId = message.data.msgId === undefined ? "" : String(message.data.msgId);
    if (this.sentTracker.isOwn(msgId, text)) return;

    const threadId = message.threadId;
    const command = text.trim().toLowerCase();
    if (command === "/im") {
      faqService.muteByAdminCommand("zalo", threadId);
      return;
    }
    if (command === "/noi") {
      faqService.unmute("zalo", threadId);
      return;
    }
    faqService.muteByAdminTyping("zalo", threadId);
  }

  /** Cau hoi trong DM khong phai "xemhh" va khong chua link - tra loi FAQ neu nhan ra chu de. */
  private async maybeAnswerFaq(api: API, message: Message, text: string): Promise<void> {
    const faqService = this.options.faqService;
    if (faqService === undefined) return;

    const userId = message.data.uidFrom;
    const { token } = this.options.ledgerStore.findOrCreateDashboardToken("zalo", userId);
    const answer = await faqService.resolve({
      platform: "zalo",
      userId,
      threadId: message.threadId,
      question: text,
      userDisplayName: message.data.dName ?? "",
      dashboardUrl: `${this.options.dashboardBaseUrl}/d/${token}`,
    });
    if (answer === null) return;
    await this.sendTrackedDirect(api, message.threadId, answer);
  }
```

- [ ] **Step 5: Nối vào `handleMessage`**

Thay dòng đầu của `handleMessage`:

```typescript
    if (message.isSelf) return;
```

bằng:

```typescript
    if (message.isSelf) {
      await this.handleSelfMessage(message);
      return;
    }
```

Trong nhánh `ThreadType.User`, thay khối `if (dmLinks.length === 0) { ... return; }` bằng:

```typescript
      const dmLinks = extractProductUrls(text);
      if (dmLinks.length === 0) {
        // Truoc 2026-09-13 nhanh nay IM LANG tuyet doi (quyet dinh 2026-08-21). Gio thu nhan dien
        // cau hoi FAQ - khong nhan ra chu de nao thi VAN im lang y nhu cu (faqService tra null).
        await this.maybeAnswerFaq(api, message, text);
        return;
      }
```

- [ ] **Step 6: Chuyển mọi lệnh gửi DM còn lại sang `sendTrackedDirect`**

Sửa 3 chỗ gọi `api.sendMessage(..., ThreadType.User)` trong DM để đi qua `sendTrackedDirect`:

1. Nhánh `xemhh`: thay `await api.sendMessage(formatDashboardLinkReply(...), message.threadId, message.type)` bằng `await this.sendTrackedDirect(api, message.threadId, formatDashboardLinkReply(...))`.
2. `processProductLinks` trong DM: sendReply đổi thành `(body) => this.sendTrackedDirect(api, message.threadId, body)`.
3. `sendDirectMessage(userId, message)` và `maybeSendWelcomeMessage`: đi qua `sendTrackedDirect` (lấy `api` từ `this.api`, giữ nguyên hành vi cảnh báo khi chưa đăng nhập).

Run: `grep -n "sendMessage(" src/adapters/zalo/bot.ts`
Expected: chỉ còn lệnh `api.sendMessage` bên trong `sendTrackedDirect`, `sendGroupReply` và `sendGroupMessage` (2 cái sau là group, không cần tracker).

- [ ] **Step 7: Chạy test để xác nhận PASS**

Run: `npm test 2>&1 | tail -20 && npm run typecheck`
Expected: toàn bộ test pass (gồm 8 test Zalo mới), typecheck sạch.

- [ ] **Step 8: Commit**

```bash
git add src/adapters/zalo/bot.ts src/adapters/zalo/__tests__/zaloBot.test.ts
git commit -m "Answer FAQ questions in Zalo DM and stand down while the admin replies"
```

---

### Task 8: Cấu hình, wiring và tài liệu

**Files:**
- Modify: `src/config/env.ts`
- Modify: `src/index.ts`
- Modify: `.env.example`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `createFaqClassifier` (Task 5), `FaqService` (Task 4), `ZaloGroupBotOptions.faqService` (Task 7)
- Produces: `env.faq = { provider, apiKey, model, rateLimit: { maxRequests, windowMs } }`

- [ ] **Step 1: Thêm config vào `src/config/env.ts`**

Thêm vào object `env` (đặt cạnh `zaloGroup` cho dễ tìm):

```typescript
  /**
   * FAQ tu dong tra loi trong Zalo DM (2026-09-13). Mac dinh "off" - giong AFFILIATE_PROVIDER=mock:
   * deploy code moi ma chua set key thi hanh vi bot KHONG DOI so voi truoc.
   */
  faq: {
    provider: optional("FAQ_PROVIDER", "off"),
    apiKey: optional("ANTHROPIC_API_KEY", ""),
    model: optional("FAQ_MODEL", "claude-haiku-4-5"),
    rateLimit: {
      maxRequests: optionalInt("FAQ_RATE_LIMIT_MAX", 5),
      windowMs: optionalInt("FAQ_RATE_LIMIT_WINDOW_MS", 10 * 60 * 1000),
    },
  },
```

- [ ] **Step 2: Wiring trong `src/index.ts`**

Thêm import:

```typescript
import { FaqService } from "./core/faq/faqService.js";
import { createFaqClassifier } from "./core/faq/providers/index.js";
```

Tạo service **sau** `notifyAdmin` (vì `FaqService` cần nó) và **trước** lời gọi `createZaloGroupBot`:

```typescript
// Rate limiter RIENG cho FAQ - khong dung chung voi rate limit tao link, de 1 user hoi nhieu khong
// bi chan mat quyen tao link (va nguoc lai).
const faqRateLimiter = new RateLimiter(env.faq.rateLimit.maxRequests, env.faq.rateLimit.windowMs);
const faqService = new FaqService({
  classifier: createFaqClassifier({
    provider: env.faq.provider,
    apiKey: env.faq.apiKey,
    model: env.faq.model,
  }),
  store: ledgerStore,
  rateLimiter: faqRateLimiter,
  notifyAdmin,
  defaultUserSharePercent: env.commission.userSharePercent,
  defaultWithdrawalThresholdVnd: env.withdrawal.thresholdVnd,
});
```

Thêm `faqService,` vào object option của `createZaloGroupBot(...)`.

Thêm `faqRateLimiter.stop();` vào hàm graceful shutdown, cạnh các `.stop()` có sẵn.

- [ ] **Step 3: Cập nhật `.env.example`**

Thêm khối mới:

```bash
# --- FAQ tu dong tra loi trong Zalo DM (2026-09-13) ---
# off = tat hoan toan (mac dinh, bot im lang voi DM khong phai "xemhh"/link nhu truoc day)
# claude = bat, can ANTHROPIC_API_KEY
FAQ_PROVIDER=off
ANTHROPIC_API_KEY=
FAQ_MODEL=claude-haiku-4-5
# So cau hoi FAQ toi da 1 user duoc hoi trong 1 cua so (chong dot tien API)
FAQ_RATE_LIMIT_MAX=5
FAQ_RATE_LIMIT_WINDOW_MS=600000
```

- [ ] **Step 4: Cập nhật `CLAUDE.md`**

Thêm vào sơ đồ `src/core/` (sau dòng `vietnamDate.ts`):

```
  faq/                        (2026-09-13) FAQ tu dong tra loi trong Zalo DM. LLM CHI PHAN LOAI cau hoi vao 1 trong 8 chu de co dinh (faqTopics.ts), text gui user LUON la chuoi admin soan san (sua qua /admin/settings, key faq_answer_<id>) - nen bot KHONG THE bia thong tin ve tien. faqService.ts dieu phoi: mute -> rate limit -> classify -> render placeholder, tra null = IM LANG. Classifier la interface (faqClassifier.ts) -> doi nha cung cap LLM khong dung logic; providers/index.ts chon theo FAQ_PROVIDER (off|claude), MAC DINH off nen chua set ANTHROPIC_API_KEY thi hanh vi bot khong doi. parseTopicIds() chi chap nhan id CO THAT va tra RONG neu model tra ve qua 2 id (dau hieu doc vet danh sach). Bang faq_thread_mutes trong ledgerStore luu thread dang bi khoa.
```

Thêm vào mô tả `zalo/bot.ts` (nối vào cuối đoạn hiện có):

```
(2026-09-13) DM con tra loi cau hoi FAQ qua faqService - nhanh "khong phai xemhh, khong co link" truoc day im lang tuyet doi gio thu nhan dien chu de, khong nhan ra thi VAN im lang. **Chong chen ngang khi admin dang chat**: bot chay selfListen=true nen nhan duoc ca tin do CHINH tai khoan nay gui ra - tin nao msgId khong nam trong SentMessageTracker (sentMessageTracker.ts) thi la ADMIN GO TAY -> khoa FAQ thread do N phut (setting faq_mute_minutes). Lenh "/im" (khoa vo thoi han) / "/noi" (mo) chi nhan khi isSelf. MOI tin DM bot gui PHAI di qua sendTrackedDirect() - gui thang api.sendMessage se lam bot tuong tin cua chinh minh la admin go tay roi TU KHOA CHINH MINH. Thread bi khoa CHI tat FAQ, link san pham va "xemhh" van luon chay.
```

- [ ] **Step 5: Kiểm tra toàn bộ**

Run: `npm test && npm run typecheck && npx tsx -e "import('./src/config/env.ts').then(m => console.log(m.env.faq))"`
Expected: test pass hết, typecheck sạch, in ra `{ provider: 'off', apiKey: '', model: 'claude-haiku-4-5', rateLimit: { maxRequests: 5, windowMs: 600000 } }`.

- [ ] **Step 6: Commit**

```bash
git add src/config/env.ts src/index.ts .env.example CLAUDE.md
git commit -m "Wire the FAQ service into startup, off by default"
```

---

## Kiểm tra thật trước khi bật trên production

Các bước này cần tài khoản Zalo thật, **không tự động hoá được** — người vận hành làm tay sau khi deploy:

1. **Xác minh giả định cốt lõi của lớp 1** (spec mục 5 đánh dấu ⚠️): deploy với `FAQ_PROVIDER=off`, thêm tạm `console.log` khi nhận `isSelf` message trong DM, rồi mở Zalo trên điện thoại nhắn 1 câu cho 1 user bất kỳ. Nếu log không hiện → `selfListen` không emit tin DM tự gửi như suy luận từ source; lớp 1 vô hiệu, phải dựa vào `/im` + lớp 3, và cần sửa lại `CLAUDE.md` cho đúng thực tế.
2. Bật `FAQ_PROVIDER=claude` + `ANTHROPIC_API_KEY`, tự nhắn vài câu hỏi thật từ 1 tài khoản Zalo khác (hỏi đúng trọng tâm, hỏi lệch, hỏi teencode không dấu) và xem bot chọn đúng chủ đề không.
3. Thử kịch bản chen ngang: user hỏi → bot trả lời → admin gõ tay 1 câu → user hỏi tiếp → xác nhận bot im.
4. Kiểm tra `/admin/settings` hiện đủ 9 field mới và sửa 1 câu trả lời thấy có hiệu lực ngay (không cần restart).
