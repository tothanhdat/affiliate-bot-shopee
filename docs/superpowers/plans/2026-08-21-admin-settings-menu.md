# Menu cấu hình động cho admin (settings) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho admin tự đổi được `%` hoa hồng user nhận, ngưỡng rút tiền, và 3 tin nhắn bot tĩnh (usage text, welcome message, success reply) qua trang `/admin/settings`, không cần sửa code/redeploy.

**Architecture:** Thêm 1 bảng key-value `settings` vào `ledger.db` (qua `LedgerStore`) với generic `getSetting`/`getSettingInt`/`setSetting` + 5 typed getter tiện dùng. `env` vẫn là default/fallback khi chưa có override trong DB. Mọi nơi từng đọc giá trị tĩnh lúc khởi động (`index.ts` → `server.ts`/`telegram/bot.ts`/`zalo/bot.ts`/`ledgerAdmin.ts`) đổi sang đọc lại từ `ledgerStore` ngay tại thời điểm xử lý. Trang admin render từ 1 registry khai báo (`SETTINGS_REGISTRY`) để thêm setting mới sau này rẻ.

**Tech Stack:** TypeScript, Express, `node:sqlite` (built-in, không dùng ORM), `node:test` + `node:assert/strict`, không thêm dependency mới.

**Spec:** `docs/superpowers/specs/2026-08-21-admin-settings-menu-design.md`

## Global Constraints

- Không thêm dependency mới (đúng nguyên tắc tối giản dự án).
- `src/core/**` không được import `express`/`telegraf`/`zca-js`/`src/config/env.js` — giữ ranh giới core/adapter. `src/core/settingsKeys.ts` chỉ chứa hằng số string, không phụ thuộc gì.
- `LedgerStore` không tự đọc `env` — mọi default truyền vào qua tham số từ call site.
- Adapter (`telegram/bot.ts`, `zalo/bot.ts`) không tự import `src/config/*` — tiếp tục nhận default qua constructor options như hiện tại (pattern DI đã có).
- Chỉ đúng 5 setting: `commission_user_share_percent`, `withdrawal_threshold_vnd`, `usage_text`, `welcome_message_template`, `success_reply_template`. Không thêm setting nào khác ngoài phạm vi này.
- Text hiển thị cho user/admin bằng tiếng Việt, khớp văn phong hiện có trong `replyText.ts`/`adminHtml.ts`.
- Không thêm audit trail/lịch sử thay đổi cho settings — chỉ lưu giá trị hiện tại.
- Không thêm cache cho giá trị đọc từ `settings` — query SQLite trực tiếp mỗi lần dùng.
- Mọi bảng/cột mới dùng `CREATE TABLE IF NOT EXISTS` — không phá vỡ DB cũ, không cần migration script riêng.
- Chạy `npm run typecheck` và `npm test` phải pass sau MỖI task có thay đổi code.

---

## Task 1: Lưu trữ settings trong `LedgerStore`

**Files:**
- Create: `src/core/settingsKeys.ts`
- Modify: `src/core/ledgerStore.ts`
- Test: `src/core/__tests__/ledgerStore.test.ts`

**Interfaces:**
- Produces: `SETTINGS_KEYS` (object hằng số key string, import từ `./settingsKeys.js`), `LedgerStore.getSetting(key: string, defaultValue: string): string`, `LedgerStore.getSettingInt(key: string, defaultValue: number): number`, `LedgerStore.setSetting(key: string, value: string): void`, và 5 typed getter: `getUserSharePercent(defaultValue: number): number`, `getWithdrawalThresholdVnd(defaultValue: number): number`, `getUsageText(defaultValue: string): string`, `getWelcomeMessageTemplate(defaultValue: string): string`, `getSuccessReplyTemplate(defaultValue: string): string`.
  - Lưu ý: KHÔNG thêm typed setter riêng (`setUserSharePercent`, v.v.) — không có call site nào cần chúng ở plan này (route `/admin/settings` ở Task 9 dùng thẳng `setSetting(key, value)` generic trong 1 vòng lặp qua `SETTINGS_REGISTRY`), thêm sẽ là dead code (vi phạm YAGNI của dự án).

- [ ] **Step 1: Tạo `src/core/settingsKeys.ts`**

```ts
/**
 * Ten cac key luu trong bang `settings` cua LedgerStore - tach rieng file nay (thay vi de thang
 * trong ledgerStore.ts) de src/config/settingsRegistry.ts (biet ca env lan UI) cung import duoc
 * ma khong keo LedgerStore phu thuoc nguoc lai config layer.
 */
export const SETTINGS_KEYS = {
  userSharePercent: "commission_user_share_percent",
  withdrawalThresholdVnd: "withdrawal_threshold_vnd",
  usageText: "usage_text",
  welcomeMessageTemplate: "welcome_message_template",
  successReplyTemplate: "success_reply_template",
} as const;
```

- [ ] **Step 2: Viết test cho `settings` (generic + typed getters) — sẽ FAIL vì chưa implement**

Thêm vào cuối `src/core/__tests__/ledgerStore.test.ts` (giữ nguyên các import/test hiện có ở đầu file):

```ts
test("LedgerStore: getSetting tra default khi chua co override, tra gia tri moi sau setSetting", () => {
  const store = new LedgerStore(":memory:");
  assert.equal(store.getSetting("some_key", "default-value"), "default-value");
  store.setSetting("some_key", "new-value");
  assert.equal(store.getSetting("some_key", "default-value"), "new-value");
  store.close();
});

test("LedgerStore: setSetting goi lai voi cung key se ghi de (upsert), khong tao 2 dong", () => {
  const store = new LedgerStore(":memory:");
  store.setSetting("k", "v1");
  store.setSetting("k", "v2");
  assert.equal(store.getSetting("k", "fallback"), "v2");
  store.close();
});

test("LedgerStore: getSettingInt parse so nguyen, tra default neu chua set hoac gia tri khong phai so", () => {
  const store = new LedgerStore(":memory:");
  assert.equal(store.getSettingInt("threshold", 20_000), 20_000);
  store.setSetting("threshold", "30000");
  assert.equal(store.getSettingInt("threshold", 20_000), 30_000);
  store.close();
});

test("LedgerStore: typed getters (userSharePercent/withdrawalThresholdVnd/usageText/welcomeMessageTemplate/successReplyTemplate) doc dung key rieng va fallback dung default truyen vao", () => {
  const store = new LedgerStore(":memory:");
  assert.equal(store.getUserSharePercent(90), 90);
  assert.equal(store.getWithdrawalThresholdVnd(20_000), 20_000);
  assert.equal(store.getUsageText("default usage"), "default usage");
  assert.equal(store.getWelcomeMessageTemplate("default welcome"), "default welcome");
  assert.equal(store.getSuccessReplyTemplate("default success"), "default success");

  store.setSetting("commission_user_share_percent", "85");
  store.setSetting("withdrawal_threshold_vnd", "50000");
  store.setSetting("usage_text", "custom usage");
  store.setSetting("welcome_message_template", "custom welcome");
  store.setSetting("success_reply_template", "custom success");

  assert.equal(store.getUserSharePercent(90), 85);
  assert.equal(store.getWithdrawalThresholdVnd(20_000), 50_000);
  assert.equal(store.getUsageText("default usage"), "custom usage");
  assert.equal(store.getWelcomeMessageTemplate("default welcome"), "custom welcome");
  assert.equal(store.getSuccessReplyTemplate("default success"), "custom success");
  store.close();
});
```

- [ ] **Step 3: Chạy test để xác nhận FAIL**

Run: `npx tsx --test src/core/__tests__/ledgerStore.test.ts`
Expected: FAIL — `store.getSetting is not a function` (hoặc tương tự cho các method chưa tồn tại).

- [ ] **Step 4: Thêm bảng `settings` vào constructor của `LedgerStore`**

Trong `src/core/ledgerStore.ts`, sửa `import type { MerchantId } from "./merchants.js";` block phía trên để thêm import mới ngay dưới các import hiện có (giữ nguyên các import khác):

```ts
import { SETTINGS_KEYS } from "./settingsKeys.js";
```

Sửa khối `this.db.exec(...)` chứa `welcome_messages` (constructor) — thêm bảng `settings` ngay sau bảng `welcome_messages`, TRƯỚC dấu backtick đóng:

Tìm:
```ts
      CREATE TABLE IF NOT EXISTS welcome_messages (
        platform TEXT NOT NULL,
        user_id TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        PRIMARY KEY (platform, user_id)
      );
    `);
```

Thay bằng:
```ts
      CREATE TABLE IF NOT EXISTS welcome_messages (
        platform TEXT NOT NULL,
        user_id TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        PRIMARY KEY (platform, user_id)
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
    `);
```

- [ ] **Step 5: Thêm generic `getSetting`/`getSettingInt`/`setSetting` + 5 typed getter vào `LedgerStore`**

Thêm các method sau vào class `LedgerStore`, ngay TRƯỚC method `close(): void {` (cuối class):

```ts
  /**
   * Doc 1 setting tu bang `settings` - tra defaultValue neu chua tung duoc admin luu qua
   * /admin/settings (xem SETTINGS_KEYS + src/config/settingsRegistry.ts). Khong cache - moi lan
   * goi query lai SQLite truc tiep (chi phi khong dang ke, nhat quan voi cac method khac).
   */
  getSetting(key: string, defaultValue: string): string {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
      | { value: string }
      | undefined;
    return row ? row.value : defaultValue;
  }

  getSettingInt(key: string, defaultValue: number): number {
    const raw = this.getSetting(key, String(defaultValue));
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? defaultValue : parsed;
  }

  /** Upsert - ghi de neu key da ton tai, khong throw neu chua co (khac cac insert khac trong file nay). */
  setSetting(key: string, value: string): void {
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updatedAt) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`
      )
      .run(key, value, updatedAt);
  }

  // Typed wrapper tien dung cho code nghiep vu (telegram/bot.ts, zalo/bot.ts, server.ts, index.ts,
  // ledgerAdmin.ts) - nhan defaultValue tu call site, khong hard-code default o day (giu core khong
  // phu thuoc env, giong cach recordConversion() nhan taxPercent v.v qua input).
  getUserSharePercent(defaultValue: number): number {
    return this.getSettingInt(SETTINGS_KEYS.userSharePercent, defaultValue);
  }

  getWithdrawalThresholdVnd(defaultValue: number): number {
    return this.getSettingInt(SETTINGS_KEYS.withdrawalThresholdVnd, defaultValue);
  }

  getUsageText(defaultValue: string): string {
    return this.getSetting(SETTINGS_KEYS.usageText, defaultValue);
  }

  getWelcomeMessageTemplate(defaultValue: string): string {
    return this.getSetting(SETTINGS_KEYS.welcomeMessageTemplate, defaultValue);
  }

  getSuccessReplyTemplate(defaultValue: string): string {
    return this.getSetting(SETTINGS_KEYS.successReplyTemplate, defaultValue);
  }

```

- [ ] **Step 6: Chạy lại test, xác nhận PASS**

Run: `npx tsx --test src/core/__tests__/ledgerStore.test.ts`
Expected: PASS (toàn bộ test cũ + 4 test mới).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: không lỗi.

- [ ] **Step 8: Commit**

```bash
git add src/core/settingsKeys.ts src/core/ledgerStore.ts src/core/__tests__/ledgerStore.test.ts
git commit -m "$(cat <<'EOF'
Add settings key-value table + typed getters to LedgerStore

First piece of the admin-configurable settings feature: a generic
get/set-by-key store (backed by ledger.db) plus typed convenience
getters for the 5 settings this feature will expose, each taking an
explicit default so LedgerStore stays free of an env dependency.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Template rendering trong `replyText.ts`

**Files:**
- Modify: `src/adapters/shared/replyText.ts`
- Create: `src/adapters/shared/__tests__/replyText.test.ts`
- Modify: `package.json` (glob của script `test`)

**Interfaces:**
- Consumes: không phụ thuộc Task 1.
- Produces: `renderTemplate(template: string, vars: Record<string, string>): string`, `WELCOME_MESSAGE_TEMPLATE_DEFAULT: string`, `SUCCESS_REPLY_TEMPLATE_DEFAULT: string`, chữ ký mới `formatWelcomeReply(template: string, userSharePercent: number, withdrawalThresholdVnd: number): string`, `formatSuccessReply(template: string, merchant: MerchantId, affiliateUrl: string, commissionEstimate?: CommissionEstimate | null): string`. `USAGE_TEXT` giữ nguyên như hiện tại (không đổi).

- [ ] **Step 1: Cập nhật glob test trong `package.json` để bao gồm test mới**

Trong `package.json`, tìm:
```json
    "test": "tsx --test src/core/__tests__/*.test.ts src/api/__tests__/*.test.ts",
```
Thay bằng:
```json
    "test": "tsx --test src/core/__tests__/*.test.ts src/api/__tests__/*.test.ts src/adapters/shared/__tests__/*.test.ts",
```

- [ ] **Step 2: Viết test cho `renderTemplate`/`formatWelcomeReply`/`formatSuccessReply` mới — sẽ FAIL**

Tạo file `src/adapters/shared/__tests__/replyText.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderTemplate,
  formatWelcomeReply,
  formatSuccessReply,
  WELCOME_MESSAGE_TEMPLATE_DEFAULT,
  SUCCESS_REPLY_TEMPLATE_DEFAULT,
} from "../replyText.js";

test("renderTemplate: thay dung placeholder co trong vars", () => {
  const result = renderTemplate("Xin chao {{name}}, ban co {{count}} don moi.", {
    name: "An",
    count: "3",
  });
  assert.equal(result, "Xin chao An, ban co 3 don moi.");
});

test("renderTemplate: giu nguyen placeholder khong khop trong vars, khong throw", () => {
  const result = renderTemplate("Gia tri: {{unknown}}", {});
  assert.equal(result, "Gia tri: {{unknown}}");
});

test("renderTemplate: thay duoc nhieu lan xuat hien cua cung 1 placeholder", () => {
  const result = renderTemplate("{{x}} + {{x}} = 2{{x}}", { x: "5" });
  assert.equal(result, "5 + 5 = 25");
});

test("formatWelcomeReply: template mac dinh thay dung userSharePercent/botSharePercent/withdrawalThreshold", () => {
  const result = formatWelcomeReply(WELCOME_MESSAGE_TEMPLATE_DEFAULT, 90, 20_000);
  assert.match(result, /Bạn nhận 90% hoa hồng/);
  assert.match(result, /giữ lại 10%/);
  assert.match(result, /20\.000đ/);
});

test("formatWelcomeReply: template tuy chinh chi con placeholder duoc thay dung", () => {
  const result = formatWelcomeReply(
    "Ban nhan {{userSharePercent}}%, bot giu {{botSharePercent}}%, nguong rut {{withdrawalThreshold}}.",
    80,
    50_000
  );
  assert.equal(result, "Ban nhan 80%, bot giu 20%, nguong rut 50.000đ.");
});

test("formatSuccessReply: template mac dinh chua link va dong luu y cuoi", () => {
  const result = formatSuccessReply(SUCCESS_REPLY_TEMPLATE_DEFAULT, "lazada", "https://example.com/aff", null);
  assert.match(result, /Link đây ạ: https:\/\/example\.com\/aff/);
  assert.match(result, /Lưu ý quan trọng/);
});

test("formatSuccessReply: merchant shopee khong co commissionEstimate -> dong thong bao rieng cho shopee", () => {
  const result = formatSuccessReply(SUCCESS_REPLY_TEMPLATE_DEFAULT, "shopee", "https://s.shopee.vn/abc", null);
  assert.match(result, /sàn Shopee không cho phép mình xem giá sản phẩm/);
});

test("formatSuccessReply: co commissionEstimate -> hien dong % va so tien uoc tinh", () => {
  const result = formatSuccessReply(SUCCESS_REPLY_TEMPLATE_DEFAULT, "tiktokshop", "https://example.com/aff", {
    ratePercent: 3.888,
    estimatedAmount: 12_345,
  });
  assert.match(result, /~3\.9% \(~12\.345đ\)/);
});

test("formatSuccessReply: template tuy chinh chi giu lai placeholder duoc thay", () => {
  const result = formatSuccessReply("LINK: {{link}} | GHI CHU: {{commissionLine}}", "lazada", "https://x.test", null);
  assert.equal(
    result,
    "LINK: https://x.test | GHI CHU: Đơn cần thời gian để hệ thống affiliate xác nhận, mình sẽ chủ động nhắn tin cho bạn khi đơn hoàn tất nhé."
  );
});
```

- [ ] **Step 3: Chạy test để xác nhận FAIL**

Run: `npx tsx --test src/adapters/shared/__tests__/replyText.test.ts`
Expected: FAIL — các export `renderTemplate`/`WELCOME_MESSAGE_TEMPLATE_DEFAULT`/`SUCCESS_REPLY_TEMPLATE_DEFAULT` chưa tồn tại, `formatWelcomeReply`/`formatSuccessReply` sai signature.

- [ ] **Step 4: Sửa `src/adapters/shared/replyText.ts`**

Thêm hàm `renderTemplate` ngay sau `formatVnd` (giữ nguyên `formatVnd` không đổi):

Tìm:
```ts
function formatVnd(amount: number): string {
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(amount)}đ`;
}

export function formatSuccessReply(
  merchant: MerchantId,
  affiliateUrl: string,
  commissionEstimate?: CommissionEstimate | null
): string {
```

Thay bằng:
```ts
function formatVnd(amount: number): string {
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(amount)}đ`;
}

/**
 * Thay moi `{{key}}` trong template bang vars[key] tuong ung - key khong khop (vd admin go sai
 * ten placeholder) thi GIU NGUYEN placeholder, khong throw, tranh crash luc gui tin that.
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => (key in vars ? vars[key] : match));
}

/** Default cho setting "success_reply_template" (xem SETTINGS_KEYS) - dung khi admin chua tuy chinh. */
export const SUCCESS_REPLY_TEMPLATE_DEFAULT =
  `Link đây ạ: {{link}}\n\n` +
  `{{commissionLine}}\n\n` +
  `Nếu cần theo dõi các đơn hàng đã đặt và hoa hồng nhận được, bạn vui lòng nhắn với cú pháp "xemhh" riêng cho Admin nhé.\n\n` +
  `⚠️ Lưu ý quan trọng: Bạn mở đúng link và đặt hàng ngay trong phiên đó mới được ghi nhận nhé. Không xem video/live trong phiên nhé.`;

export function formatSuccessReply(
  template: string,
  merchant: MerchantId,
  affiliateUrl: string,
  commissionEstimate?: CommissionEstimate | null
): string {
```

Tìm (cuối hàm `formatSuccessReply`, phần `return`):
```ts
  return (
    `Link đây ạ: ${affiliateUrl}\n\n` +
    `${commissionLine}\n\n` +
    `Nếu cần theo dõi các đơn hàng đã đặt và hoa hồng nhận được, bạn vui lòng nhắn với cú pháp "xemhh" riêng cho Admin nhé.\n\n` +
    `⚠️ Lưu ý quan trọng: Bạn mở đúng link và đặt hàng ngay trong phiên đó mới được ghi nhận nhé. Không xem video/live trong phiên nhé.`
  );
}
```

Thay bằng:
```ts
  return renderTemplate(template, { link: affiliateUrl, commissionLine });
}
```

Tìm (đầu hàm `formatWelcomeReply`, giữ nguyên comment phía trên hàm này không đổi):
```ts
export function formatWelcomeReply(userSharePercent: number, withdrawalThresholdVnd: number): string {
  const botSharePercent = 100 - userSharePercent;
  return (
    `Chào bạn, rất vui vì bạn đã tham gia group nha! 🎉\n\n` +
    `Mình là bot hỗ trợ săn sale hoàn tiền (cashback) khi mua hàng qua Shopee, TikTok Shop. Trước khi dùng, gửi bạn vài thông tin quan trọng để dùng cho thuận tiện nhé:\n\n` +
    `🛍️ Cách dùng: Cứ dán link sản phẩm vào group, mình tự nhận diện sàn và trả ngay link mua hàng được gắn mã hoàn tiền — bấm đúng link đó rồi mua như bình thường là được ghi nhận.\n\n` +
    `💰 Hoa hồng: Bạn nhận ${userSharePercent}% hoa hồng phát sinh (sau khi trừ thuế và phí sàn), mình giữ lại ${botSharePercent}% để duy trì vận hành.\n\n` +
    `⏳ Thời gian ghi nhận: Sau khi mua, đơn cần vài ngày đến một tuần để sàn xác nhận. Mình đối soát định kỳ hàng tuần, có đơn mới sẽ tự động nhắn báo bạn, không cần hỏi lại.\n\n` +
    `📊 Theo dõi hoa hồng: Nhắn "xemhh" cho mình qua tin nhắn riêng (không phải trong group) bất cứ lúc nào để lấy link dashboard cá nhân — xem chi tiết từng đơn và số dư.\n\n` +
    `💵 Rút tiền: Khi số dư đạt từ ${formatVnd(withdrawalThresholdVnd)}, bạn yêu cầu rút toàn bộ ngay trên dashboard (không hỗ trợ rút một phần), điền thông tin ngân hàng là xong — admin sẽ nhắn riêng xác nhận lại trước khi chuyển khoản.\n\n` +
    `⚠️ Lưu ý: Shopee không hỗ trợ xem hoa hồng ước tính trước — chỉ TikTok Shop mới trả được ước tính hoa hồng ngay khi lấy link, còn lại phải chờ đơn được xác nhận mới biết chính xác. Đơn đang chờ xác nhận có thể bị huỷ nếu không đạt yêu cầu đối soát của sàn — khi đã xác nhận (Khả dụng) rồi thì hoa hồng cho đơn đó không thay đổi nữa.\n\n` +
    `Xem Sổ tay hoàn tiền chi tiết tại link: https://docs.google.com/document/d/1-Dc7L6fHg350j3sVlpMPxZLgObspwov1gTY9eM4ajSk/edit?tab=t.0\n\n` +
    `Có gì thắc mắc cứ nhắn mình hoặc tag admin trong group nha. Chúc bạn săn sale vui! 🥳`
  );
}
```

Thay bằng:
```ts
/** Default cho setting "welcome_message_template" (xem SETTINGS_KEYS) - dung khi admin chua tuy chinh. */
export const WELCOME_MESSAGE_TEMPLATE_DEFAULT =
  `Chào bạn, rất vui vì bạn đã tham gia group nha! 🎉\n\n` +
  `Mình là bot hỗ trợ săn sale hoàn tiền (cashback) khi mua hàng qua Shopee, TikTok Shop. Trước khi dùng, gửi bạn vài thông tin quan trọng để dùng cho thuận tiện nhé:\n\n` +
  `🛍️ Cách dùng: Cứ dán link sản phẩm vào group, mình tự nhận diện sàn và trả ngay link mua hàng được gắn mã hoàn tiền — bấm đúng link đó rồi mua như bình thường là được ghi nhận.\n\n` +
  `💰 Hoa hồng: Bạn nhận {{userSharePercent}}% hoa hồng phát sinh (sau khi trừ thuế và phí sàn), mình giữ lại {{botSharePercent}}% để duy trì vận hành.\n\n` +
  `⏳ Thời gian ghi nhận: Sau khi mua, đơn cần vài ngày đến một tuần để sàn xác nhận. Mình đối soát định kỳ hàng tuần, có đơn mới sẽ tự động nhắn báo bạn, không cần hỏi lại.\n\n` +
  `📊 Theo dõi hoa hồng: Nhắn "xemhh" cho mình qua tin nhắn riêng (không phải trong group) bất cứ lúc nào để lấy link dashboard cá nhân — xem chi tiết từng đơn và số dư.\n\n` +
  `💵 Rút tiền: Khi số dư đạt từ {{withdrawalThreshold}}, bạn yêu cầu rút toàn bộ ngay trên dashboard (không hỗ trợ rút một phần), điền thông tin ngân hàng là xong — admin sẽ nhắn riêng xác nhận lại trước khi chuyển khoản.\n\n` +
  `⚠️ Lưu ý: Shopee không hỗ trợ xem hoa hồng ước tính trước — chỉ TikTok Shop mới trả được ước tính hoa hồng ngay khi lấy link, còn lại phải chờ đơn được xác nhận mới biết chính xác. Đơn đang chờ xác nhận có thể bị huỷ nếu không đạt yêu cầu đối soát của sàn — khi đã xác nhận (Khả dụng) rồi thì hoa hồng cho đơn đó không thay đổi nữa.\n\n` +
  `Xem Sổ tay hoàn tiền chi tiết tại link: https://docs.google.com/document/d/1-Dc7L6fHg350j3sVlpMPxZLgObspwov1gTY9eM4ajSk/edit?tab=t.0\n\n` +
  `Có gì thắc mắc cứ nhắn mình hoặc tag admin trong group nha. Chúc bạn săn sale vui! 🥳`;

export function formatWelcomeReply(template: string, userSharePercent: number, withdrawalThresholdVnd: number): string {
  const botSharePercent = 100 - userSharePercent;
  return renderTemplate(template, {
    userSharePercent: String(userSharePercent),
    botSharePercent: String(botSharePercent),
    withdrawalThreshold: formatVnd(withdrawalThresholdVnd),
  });
}
```

- [ ] **Step 5: Chạy lại test, xác nhận PASS**

Run: `npx tsx --test src/adapters/shared/__tests__/replyText.test.ts`
Expected: PASS toàn bộ.

- [ ] **Step 6: Typecheck (sẽ FAIL ở đây — các call site chưa cập nhật, đúng dự kiến, sửa ở Task 3/4)**

Run: `npm run typecheck`
Expected: lỗi tại `src/adapters/telegram/bot.ts` và `src/adapters/zalo/bot.ts` (thiếu tham số `template` khi gọi `formatSuccessReply`/`formatWelcomeReply`) — đây là lỗi ĐÃ BIẾT, sẽ hết sau Task 3 và Task 4. Không cần sửa ở task này.

- [ ] **Step 7: Commit**

```bash
git add src/adapters/shared/replyText.ts src/adapters/shared/__tests__/replyText.test.ts package.json
git commit -m "$(cat <<'EOF'
Add template rendering to replyText.ts for admin-editable messages

renderTemplate() substitutes {{placeholder}} tokens; welcome and
success-reply messages become editable templates (default text
exported as constants) with formatWelcomeReply/formatSuccessReply now
taking the template as their first argument. Callers in
telegram/bot.ts and zalo/bot.ts are updated in the next two commits -
typecheck is expected to fail in between.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Cập nhật `telegram/bot.ts` đọc động usage text + success template

**Files:**
- Modify: `src/adapters/telegram/bot.ts`

**Interfaces:**
- Consumes: `LedgerStore.getUsageText(default)`, `LedgerStore.getSuccessReplyTemplate(default)` (Task 1), `formatSuccessReply(template, merchant, affiliateUrl, commissionEstimate)` (Task 2), `USAGE_TEXT`/`SUCCESS_REPLY_TEMPLATE_DEFAULT` (đã export từ `replyText.ts`).

- [ ] **Step 1: Sửa import trong `src/adapters/telegram/bot.ts`**

Tìm:
```ts
import {
  USAGE_TEXT,
  formatSuccessReply,
  formatErrorReply,
  formatSkippedReply,
  formatPromotionsReply,
  formatDashboardLinkReply,
} from "../shared/replyText.js";
```

Thay bằng:
```ts
import {
  USAGE_TEXT,
  SUCCESS_REPLY_TEMPLATE_DEFAULT,
  formatSuccessReply,
  formatErrorReply,
  formatSkippedReply,
  formatPromotionsReply,
  formatDashboardLinkReply,
} from "../shared/replyText.js";
```

- [ ] **Step 2: Thay 3 chỗ dùng `USAGE_TEXT` tĩnh bằng đọc động qua `ledgerStore`**

Tìm:
```ts
  bot.start((ctx) => ctx.reply(USAGE_TEXT));
  bot.help((ctx) => ctx.reply(USAGE_TEXT));
```

Thay bằng:
```ts
  bot.start((ctx) => ctx.reply(ledgerStore.getUsageText(USAGE_TEXT)));
  bot.help((ctx) => ctx.reply(ledgerStore.getUsageText(USAGE_TEXT)));
```

Tìm:
```ts
    if (links.length === 0) {
      await ctx.reply(USAGE_TEXT);
      return;
    }
```

Thay bằng:
```ts
    if (links.length === 0) {
      await ctx.reply(ledgerStore.getUsageText(USAGE_TEXT));
      return;
    }
```

- [ ] **Step 3: Thay chỗ gọi `formatSuccessReply` truyền thêm template động**

Tìm:
```ts
        await ctx.reply(formatSuccessReply(result.merchant, result.affiliateUrl, result.commissionEstimate), {
          reply_parameters: { message_id: ctx.message.message_id },
        });
```

Thay bằng:
```ts
        const successTemplate = ledgerStore.getSuccessReplyTemplate(SUCCESS_REPLY_TEMPLATE_DEFAULT);
        await ctx.reply(
          formatSuccessReply(successTemplate, result.merchant, result.affiliateUrl, result.commissionEstimate),
          { reply_parameters: { message_id: ctx.message.message_id } }
        );
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: hết lỗi liên quan `telegram/bot.ts` (lỗi ở `zalo/bot.ts` vẫn còn, sẽ hết ở Task 4).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/telegram/bot.ts
git commit -m "$(cat <<'EOF'
Read usage text and success-reply template dynamically in Telegram adapter

Both now come from LedgerStore (admin-editable via /admin/settings,
added in a later commit) instead of the frozen USAGE_TEXT/default
template, falling back to the same literals as before when unset.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Cập nhật `zalo/bot.ts` đọc động usage text + success template + welcome template

**Files:**
- Modify: `src/adapters/zalo/bot.ts`

**Interfaces:**
- Consumes: giống Task 3, thêm `LedgerStore.getWelcomeMessageTemplate(default)`, `LedgerStore.getUserSharePercent(default)`, `LedgerStore.getWithdrawalThresholdVnd(default)`, `WELCOME_MESSAGE_TEMPLATE_DEFAULT`.

- [ ] **Step 1: Sửa import**

Tìm:
```ts
import {
  USAGE_TEXT,
  formatSuccessReply,
  formatErrorReply,
  formatSkippedReply,
  formatPromotionsReply,
  formatDashboardLinkReply,
  formatWelcomeReply,
} from "../shared/replyText.js";
```

Thay bằng:
```ts
import {
  USAGE_TEXT,
  SUCCESS_REPLY_TEMPLATE_DEFAULT,
  WELCOME_MESSAGE_TEMPLATE_DEFAULT,
  formatSuccessReply,
  formatErrorReply,
  formatSkippedReply,
  formatPromotionsReply,
  formatDashboardLinkReply,
  formatWelcomeReply,
} from "../shared/replyText.js";
```

- [ ] **Step 2: Thay chỗ dùng `USAGE_TEXT` tĩnh**

Tìm:
```ts
    if (links.length === 0) {
      await this.sendGroupReply(api, message, USAGE_TEXT);
      return;
    }
```

Thay bằng:
```ts
    if (links.length === 0) {
      await this.sendGroupReply(api, message, this.options.ledgerStore.getUsageText(USAGE_TEXT));
      return;
    }
```

- [ ] **Step 3: Thay chỗ gọi `formatSuccessReply`**

Tìm:
```ts
        await this.sendGroupReply(
          api,
          message,
          formatSuccessReply(result.merchant, result.affiliateUrl, result.commissionEstimate)
        );
```

Thay bằng:
```ts
        const successTemplate = this.options.ledgerStore.getSuccessReplyTemplate(SUCCESS_REPLY_TEMPLATE_DEFAULT);
        await this.sendGroupReply(
          api,
          message,
          formatSuccessReply(successTemplate, result.merchant, result.affiliateUrl, result.commissionEstimate)
        );
```

- [ ] **Step 4: Thay chỗ gọi `formatWelcomeReply` trong `maybeSendWelcomeMessage`**

Tìm:
```ts
    try {
      await api.sendMessage(
        formatWelcomeReply(this.options.commissionUserSharePercent, this.options.withdrawalThresholdVnd),
        userId,
        ThreadType.User
      );
    } catch (err) {
```

Thay bằng:
```ts
    try {
      const welcomeTemplate = this.options.ledgerStore.getWelcomeMessageTemplate(WELCOME_MESSAGE_TEMPLATE_DEFAULT);
      const userSharePercent = this.options.ledgerStore.getUserSharePercent(this.options.commissionUserSharePercent);
      const withdrawalThresholdVnd = this.options.ledgerStore.getWithdrawalThresholdVnd(
        this.options.withdrawalThresholdVnd
      );
      await api.sendMessage(
        formatWelcomeReply(welcomeTemplate, userSharePercent, withdrawalThresholdVnd),
        userId,
        ThreadType.User
      );
    } catch (err) {
```

Không đổi field `commissionUserSharePercent`/`withdrawalThresholdVnd` trong interface `ZaloGroupBotOptions` — 2 field này giữ nguyên, chỉ đổi Ý NGHĨA (giờ là default/fallback thay vì giá trị dùng thẳng), `index.ts` không cần sửa lời gọi `createZaloGroupBot(...)`.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: không còn lỗi nào (toàn bộ codebase pass, kể cả lỗi tồn đọng từ Task 2).

- [ ] **Step 6: Chạy toàn bộ test suite**

Run: `npm test`
Expected: PASS toàn bộ (chưa có gì đổi hành vi được test hiện có, chỉ thêm test mới đã pass từ Task 1/2).

- [ ] **Step 7: Commit**

```bash
git add src/adapters/zalo/bot.ts
git commit -m "$(cat <<'EOF'
Read usage text, success-reply, and welcome templates dynamically in Zalo adapter

Same pattern as the Telegram adapter (previous commit), plus the
welcome DM's commission %/threshold and message template all now
come from LedgerStore at send time instead of values frozen at
process startup. ZaloGroupBotOptions fields keep their names but now
mean "fallback default" rather than "final value" - index.ts's call
site is unchanged.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Cập nhật `index.ts` và `ledgerAdmin.ts` đọc động `userSharePercent`

**Files:**
- Modify: `src/index.ts`
- Modify: `src/scripts/ledgerAdmin.ts`

**Interfaces:**
- Consumes: `LedgerStore.getUserSharePercent(defaultValue: number): number` (Task 1).

- [ ] **Step 1: Sửa `runAccesstradeSync()` trong `src/index.ts`**

Tìm:
```ts
async function runAccesstradeSync(): Promise<void> {
  console.log("[accesstrade-sync] Bat dau dong bo dinh ky...");
  try {
    const result = await syncAccesstradeTransactions(logStore, ledgerStore, {
      apiKey: env.accesstrade.apiKey,
      apiBase: env.accesstrade.apiBase,
      timeoutMs: env.accesstrade.timeoutMs,
      lookbackDays: env.accesstradeSync.lookbackDays,
      recordOrderConfig: {
        taxPercent: env.commission.taxPercent,
        platformFeePercent: env.commission.platformFeePercent,
        userSharePercent: env.commission.userSharePercent,
        maxCommissionRatioPercent: env.commission.maxRatioPercent,
      },
    });
```

Thay bằng:
```ts
async function runAccesstradeSync(): Promise<void> {
  console.log("[accesstrade-sync] Bat dau dong bo dinh ky...");
  try {
    const result = await syncAccesstradeTransactions(logStore, ledgerStore, {
      apiKey: env.accesstrade.apiKey,
      apiBase: env.accesstrade.apiBase,
      timeoutMs: env.accesstrade.timeoutMs,
      lookbackDays: env.accesstradeSync.lookbackDays,
      recordOrderConfig: {
        taxPercent: env.commission.taxPercent,
        platformFeePercent: env.commission.platformFeePercent,
        userSharePercent: ledgerStore.getUserSharePercent(env.commission.userSharePercent),
        maxCommissionRatioPercent: env.commission.maxRatioPercent,
      },
    });
```

- [ ] **Step 2: Sửa `orderConfig` trong `src/scripts/ledgerAdmin.ts`**

Tìm:
```ts
  const logStore = new LogStore(env.databasePath);
  const ledgerStore = new LedgerStore(env.ledgerDatabasePath);
  const orderConfig: RecordOrderConfig = {
    taxPercent: env.commission.taxPercent,
    platformFeePercent: env.commission.platformFeePercent,
    userSharePercent: env.commission.userSharePercent,
    maxCommissionRatioPercent: env.commission.maxRatioPercent,
  };
```

Thay bằng:
```ts
  const logStore = new LogStore(env.databasePath);
  const ledgerStore = new LedgerStore(env.ledgerDatabasePath);
  const orderConfig: RecordOrderConfig = {
    taxPercent: env.commission.taxPercent,
    platformFeePercent: env.commission.platformFeePercent,
    userSharePercent: ledgerStore.getUserSharePercent(env.commission.userSharePercent),
    maxCommissionRatioPercent: env.commission.maxRatioPercent,
  };
```

Lưu ý: CLI chạy 1 lần rồi thoát (không phải long-running process), nên đọc 1 lần lúc script khởi động là đủ "động" — không cần đọc lại nhiều lần trong 1 lần chạy.

- [ ] **Step 3: Typecheck + test**

Run: `npm run typecheck && npm test`
Expected: PASS toàn bộ (không có test nào assert giá trị `userSharePercent` cụ thể phụ thuộc `env.commission.userSharePercent` trực tiếp trong 2 file này — `accesstradeSync.test.ts` gọi `syncAccesstradeTransactions` trực tiếp với config tự truyền vào test, không qua `index.ts`/`ledgerAdmin.ts`, không bị ảnh hưởng).

- [ ] **Step 4: Commit**

```bash
git add src/index.ts src/scripts/ledgerAdmin.ts
git commit -m "$(cat <<'EOF'
Read commission user-share % dynamically in daily sync and CLI

runAccesstradeSync() (runs once/day in the running process) and the
ledgerAdmin.ts CLI now pull userSharePercent from LedgerStore at the
point of use, falling back to env.commission.userSharePercent when
no admin override has been saved yet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Cập nhật `server.ts` (route hiện có) đọc động `userSharePercent`/`thresholdVnd`

**Files:**
- Modify: `src/api/server.ts`
- Test: `src/api/__tests__/adminRoutes.test.ts`, `src/api/__tests__/dashboardRoutes.test.ts`

**Interfaces:**
- Consumes: `LedgerStore.getUserSharePercent(defaultValue)`, `LedgerStore.getWithdrawalThresholdVnd(defaultValue)` (Task 1). Không đổi signature `createServer(...)`.

- [ ] **Step 1: Sửa route `/admin/record-orders/single`**

Tìm:
```ts
    try {
      const entry = recordOrderFromAccesstrade(logStore, ledgerStore, orderConfig, {
        subId,
        orderId,
        productName,
        orderAmount,
        commissionAmount,
        note,
      });
```

Thay bằng:
```ts
    try {
      const requestOrderConfig = {
        ...orderConfig,
        userSharePercent: ledgerStore.getUserSharePercent(orderConfig.userSharePercent),
      };
      const entry = recordOrderFromAccesstrade(logStore, ledgerStore, requestOrderConfig, {
        subId,
        orderId,
        productName,
        orderAmount,
        commissionAmount,
        note,
      });
```

- [ ] **Step 2: Sửa route `/admin/record-orders/csv`**

Tìm:
```ts
      const results = recordOrdersFromCsv(logStore, ledgerStore, orderConfig, rows);
```

Thay bằng:
```ts
      const requestOrderConfig = {
        ...orderConfig,
        userSharePercent: ledgerStore.getUserSharePercent(orderConfig.userSharePercent),
      };
      const results = recordOrdersFromCsv(logStore, ledgerStore, requestOrderConfig, rows);
```

- [ ] **Step 3: Sửa route `GET /d/:token`**

Tìm:
```ts
    const summary = ledgerStore.getUserSummary(identity.platform, identity.userId);
    const pendingWithdrawal = ledgerStore.getPendingWithdrawal(identity.platform, identity.userId);
    const displayName = ledgerStore.getDisplayName(identity.platform, identity.userId);
    res.type("html").send(
      renderDashboardPage({
        ...summary,
        pendingWithdrawal,
        thresholdVnd: withdrawalThresholdVnd,
        token: req.params.token,
        platform: identity.platform,
        userId: identity.userId,
        displayName,
      })
    );
  });
```

Thay bằng:
```ts
    const summary = ledgerStore.getUserSummary(identity.platform, identity.userId);
    const pendingWithdrawal = ledgerStore.getPendingWithdrawal(identity.platform, identity.userId);
    const displayName = ledgerStore.getDisplayName(identity.platform, identity.userId);
    res.type("html").send(
      renderDashboardPage({
        ...summary,
        pendingWithdrawal,
        thresholdVnd: ledgerStore.getWithdrawalThresholdVnd(withdrawalThresholdVnd),
        token: req.params.token,
        platform: identity.platform,
        userId: identity.userId,
        displayName,
      })
    );
  });
```

- [ ] **Step 4: Sửa route `POST /d/:token/withdraw`**

Tìm:
```ts
    try {
      const bankName = typeof req.body?.bankName === "string" ? req.body.bankName : "";
      const bankAccountNumber =
        typeof req.body?.bankAccountNumber === "string" ? req.body.bankAccountNumber : "";
      const bankAccountHolder =
        typeof req.body?.bankAccountHolder === "string" ? req.body.bankAccountHolder : "";
      const withdrawal = ledgerStore.requestWithdrawal(identity.platform, identity.userId, withdrawalThresholdVnd, {
        bankName,
        bankAccountNumber,
        bankAccountHolder,
      });
```

Thay bằng:
```ts
    try {
      const bankName = typeof req.body?.bankName === "string" ? req.body.bankName : "";
      const bankAccountNumber =
        typeof req.body?.bankAccountNumber === "string" ? req.body.bankAccountNumber : "";
      const bankAccountHolder =
        typeof req.body?.bankAccountHolder === "string" ? req.body.bankAccountHolder : "";
      const currentThresholdVnd = ledgerStore.getWithdrawalThresholdVnd(withdrawalThresholdVnd);
      const withdrawal = ledgerStore.requestWithdrawal(identity.platform, identity.userId, currentThresholdVnd, {
        bankName,
        bankAccountNumber,
        bankAccountHolder,
      });
```

Và trong khối `catch` NGAY DƯỚI của route này, tìm:
```ts
    } catch (err) {
      const summary = ledgerStore.getUserSummary(identity.platform, identity.userId);
      const pendingWithdrawal = ledgerStore.getPendingWithdrawal(identity.platform, identity.userId);
      const displayName = ledgerStore.getDisplayName(identity.platform, identity.userId);
      const errorMessage = err instanceof AppError ? err.userMessage : "Loi khong xac dinh, vui long thu lai sau.";
      res.status(422).type("html").send(
        renderDashboardPage({
          ...summary,
          pendingWithdrawal,
          thresholdVnd: withdrawalThresholdVnd,
          token: req.params.token,
          platform: identity.platform,
          userId: identity.userId,
          displayName,
          errorMessage,
        })
      );
    }
```

Thay bằng:
```ts
    } catch (err) {
      const summary = ledgerStore.getUserSummary(identity.platform, identity.userId);
      const pendingWithdrawal = ledgerStore.getPendingWithdrawal(identity.platform, identity.userId);
      const displayName = ledgerStore.getDisplayName(identity.platform, identity.userId);
      const errorMessage = err instanceof AppError ? err.userMessage : "Loi khong xac dinh, vui long thu lai sau.";
      res.status(422).type("html").send(
        renderDashboardPage({
          ...summary,
          pendingWithdrawal,
          thresholdVnd: ledgerStore.getWithdrawalThresholdVnd(withdrawalThresholdVnd),
          token: req.params.token,
          platform: identity.platform,
          userId: identity.userId,
          displayName,
          errorMessage,
        })
      );
    }
```

- [ ] **Step 5: Typecheck + chạy test hiện có**

Run: `npm run typecheck && npm test`
Expected: PASS toàn bộ — hành vi mặc định (chưa có override trong `settings`) giữ nguyên y hệt trước khi sửa vì `getUserSharePercent`/`getWithdrawalThresholdVnd` fallback đúng về giá trị `orderConfig`/`withdrawalThresholdVnd` cũ khi bảng `settings` rỗng.

- [ ] **Step 6: Thêm test xác nhận đọc ĐỘNG (không chỉ fallback đúng mà còn phản ánh override mới)**

Thêm vào `src/api/__tests__/adminRoutes.test.ts` (dùng `setup()` đã có sẵn trong file):

```ts
test("POST /admin/record-orders/single dung userSharePercent MOI NHAT tu ledgerStore.setUserSharePercent thay vi gia tri tinh luc khoi tao", async () => {
  const { ledgerStore, logStore, baseUrl, cleanup } = setup();
  try {
    seedRequestLog(logStore, "sub-dynamic-percent");
    ledgerStore.setSetting("commission_user_share_percent", "50");
    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/record-orders/single`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie ?? "" },
      body: new URLSearchParams({
        subId: "sub-dynamic-percent",
        orderId: "order-dynamic-percent",
        orderAmount: "1000000",
        commissionAmount: "100000",
      }).toString(),
    });
    assert.equal(res.status, 200);
    const entries = ledgerStore.listCommissionEntries({});
    const entry = entries.find((e) => e.orderId === "order-dynamic-percent");
    assert.ok(entry);
    // ORDER_CONFIG mac dinh trong setup() la userSharePercent=80 - neu con dung gia tri tinh nay
    // thi userShareAmount se la 80% cua 100_000 (=80_000) thay vi 50% (=50_000) nhu setting moi.
    assert.equal(entry!.userShareAmount, 50_000);
  } finally {
    cleanup();
  }
});
```

Thêm vào `src/api/__tests__/dashboardRoutes.test.ts` — trước tiên đọc file để lấy đúng helper `setup()`/pattern hiện có của file này:

- [ ] **Step 7: Thêm test xác nhận `GET /d/:token` đọc động ngưỡng rút tiền**

`src/api/__tests__/dashboardRoutes.test.ts` đã có sẵn hàm `setup()` (không cần sửa) trả về `{ ledgerStore, logStore, baseUrl, notifyCalls, withdrawalProofDir, cleanup }`, với `createServer(...)` được gọi cố định `THRESHOLD_VND = 50_000` (hằng số khai báo đầu file). Thêm test sau vào cuối file:

```ts
test("GET /d/:token hien dung nguong rut tien MOI NHAT tu setting, khong phai gia tri tinh luc khoi tao server", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    ledgerStore.setSetting("withdrawal_threshold_vnd", "123456");
    const { token } = ledgerStore.findOrCreateDashboardToken("telegram", "user-threshold-test");
    const res = await fetch(`${baseUrl}/d/${token}`);
    const html = await res.text();
    assert.match(html, /123\.456/);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 8: Chạy lại toàn bộ test**

Run: `npm test`
Expected: PASS toàn bộ (test cũ + 2 test mới).

- [ ] **Step 9: Commit**

```bash
git add src/api/server.ts src/api/__tests__/adminRoutes.test.ts src/api/__tests__/dashboardRoutes.test.ts
git commit -m "$(cat <<'EOF'
Read commission % and withdrawal threshold dynamically in server.ts routes

/admin/record-orders/*, GET /d/:token, and POST /d/:token/withdraw now
pull the current values from LedgerStore at request time instead of
using the value frozen when createServer() was called, falling back
to the same constructor-injected defaults as before when unset.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `SETTINGS_REGISTRY` (config layer)

**Files:**
- Create: `src/config/settingsRegistry.ts`

**Interfaces:**
- Consumes: `SETTINGS_KEYS` (Task 1), `env` (`src/config/env.ts`, đã có sẵn), `USAGE_TEXT`/`WELCOME_MESSAGE_TEMPLATE_DEFAULT`/`SUCCESS_REPLY_TEMPLATE_DEFAULT` (Task 2).
- Produces: `export type SettingFieldType = "number" | "textarea"`, `export interface SettingFieldConfig { key: string; label: string; type: SettingFieldType; default: string; helpText?: string; min?: number; max?: number }`, `export const SETTINGS_REGISTRY: SettingFieldConfig[]` (5 phần tử, thứ tự: `%` hoa hồng, ngưỡng rút tiền, usage text, welcome message, success reply — khớp thứ tự hiển thị mong muốn trên form).

- [ ] **Step 1: Tạo `src/config/settingsRegistry.ts`**

```ts
import { SETTINGS_KEYS } from "../core/settingsKeys.js";
import {
  USAGE_TEXT,
  WELCOME_MESSAGE_TEMPLATE_DEFAULT,
  SUCCESS_REPLY_TEMPLATE_DEFAULT,
} from "../adapters/shared/replyText.js";
import { env } from "./env.js";

/**
 * Danh sach khai bao 5 setting admin sua duoc qua /admin/settings - dung CHUNG boi ca route GET
 * (build gia tri hien tai + render form) lan POST (validate + luu). Day la noi DUY NHAT can sua
 * khi them 1 setting moi sau nay (xem "Nguyen tac mo rong" trong spec) - trang settings tu dong
 * hien field moi, khong phai sua adminHtml.ts thu cong.
 *
 * CHI dung boi src/api/* (trang settings) - KHONG import vao adapter (telegram/bot.ts, zalo/bot.ts)
 * hay core, giu nguyen pattern DI hien co (adapter nhan default qua constructor option tu index.ts,
 * khong tu import src/config/*).
 */
export type SettingFieldType = "number" | "textarea";

export interface SettingFieldConfig {
  key: string;
  label: string;
  type: SettingFieldType;
  default: string;
  helpText?: string;
  min?: number;
  max?: number;
}

export const SETTINGS_REGISTRY: SettingFieldConfig[] = [
  {
    key: SETTINGS_KEYS.userSharePercent,
    label: "% hoa hồng user nhận",
    type: "number",
    default: String(env.commission.userSharePercent),
    min: 0,
    max: 100,
    helpText: "Phần trăm user nhận trên hoa hồng sau khi trừ thuế/phí sàn (0-100). Phần còn lại thuộc về chủ bot.",
  },
  {
    key: SETTINGS_KEYS.withdrawalThresholdVnd,
    label: "Ngưỡng rút tiền tối thiểu (VNĐ)",
    type: "number",
    default: String(env.withdrawal.thresholdVnd),
    min: 1,
    helpText: "Số dư khả dụng tối thiểu để user gửi được yêu cầu rút tiền.",
  },
  {
    key: SETTINGS_KEYS.usageText,
    label: "Hướng dẫn khi chưa gửi link sản phẩm",
    type: "textarea",
    default: USAGE_TEXT,
    helpText: "Không có placeholder động.",
  },
  {
    key: SETTINGS_KEYS.welcomeMessageTemplate,
    label: "Tin nhắn chào mừng (Zalo DM, gửi 1 lần/user)",
    type: "textarea",
    default: WELCOME_MESSAGE_TEMPLATE_DEFAULT,
    helpText: "Placeholder hợp lệ: {{userSharePercent}}, {{botSharePercent}}, {{withdrawalThreshold}}.",
  },
  {
    key: SETTINGS_KEYS.successReplyTemplate,
    label: "Tin nhắn trả link mua hàng thành công",
    type: "textarea",
    default: SUCCESS_REPLY_TEMPLATE_DEFAULT,
    helpText: "Placeholder hợp lệ: {{link}}, {{commissionLine}} (dòng hoa hồng ước tính, tự tính theo sản phẩm).",
  },
];
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: không lỗi (file mới chưa được import ở đâu, nhưng vẫn phải tự hợp lệ).

- [ ] **Step 3: Commit**

```bash
git add src/config/settingsRegistry.ts
git commit -m "$(cat <<'EOF'
Add SETTINGS_REGISTRY declaring the 5 admin-configurable settings

Single source of field metadata (label, type, default, validation
range, placeholder legend) for the upcoming /admin/settings page.
Adding a future setting is meant to start here.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Trang admin `renderSettingsPage` trong `adminHtml.ts`

**Files:**
- Modify: `src/api/adminHtml.ts`

**Interfaces:**
- Consumes: `SETTINGS_REGISTRY`, `SettingFieldConfig` (Task 7), `escapeHtml` (đã có trong `htmlHelpers.ts`).
- Produces: `export function renderSettingsPage(currentValues: Record<string, string>, errorMessage?: string | null): string`.

- [ ] **Step 1: Thêm import + nav item**

Tìm:
```ts
import { getMerchantConfig, MERCHANTS, type MerchantId } from "../core/merchants.js";
import type { OrderRowResult } from "../core/orderIngest.js";
```

Thay bằng:
```ts
import { getMerchantConfig, MERCHANTS, type MerchantId } from "../core/merchants.js";
import type { OrderRowResult } from "../core/orderIngest.js";
import { SETTINGS_REGISTRY } from "../config/settingsRegistry.js";
```

Tìm:
```ts
const NAV_ITEMS: Array<{ key: string; href: string; label: string }> = [
  { key: "withdrawals", href: "/admin/withdrawals", label: "Yêu cầu rút tiền" },
  { key: "users", href: "/admin/users", label: "Người dùng" },
  { key: "orders", href: "/admin/orders", label: "Đơn hàng" },
  { key: "record-orders", href: "/admin/record-orders", label: "Ghi nhận đơn hàng" },
  { key: "accesstrade-payments", href: "/admin/accesstrade-payments", label: "Đối chiếu Accesstrade" },
];
```

Thay bằng:
```ts
const NAV_ITEMS: Array<{ key: string; href: string; label: string }> = [
  { key: "withdrawals", href: "/admin/withdrawals", label: "Yêu cầu rút tiền" },
  { key: "users", href: "/admin/users", label: "Người dùng" },
  { key: "orders", href: "/admin/orders", label: "Đơn hàng" },
  { key: "record-orders", href: "/admin/record-orders", label: "Ghi nhận đơn hàng" },
  { key: "accesstrade-payments", href: "/admin/accesstrade-payments", label: "Đối chiếu Accesstrade" },
  { key: "settings", href: "/admin/settings", label: "Cấu hình" },
];
```

- [ ] **Step 2: Thêm CSS cho form settings**

Tìm (cuối `shellStyles()`):
```ts
  textarea {
    width: 100%; min-height: 90px; padding: 0.6rem 0.75rem; border: 1px solid var(--card-border);
    border-radius: 8px; font-size: 0.88rem; font-family: inherit; margin-bottom: 1rem; resize: vertical;
  }
</style>`;
```

Thay bằng:
```ts
  textarea {
    width: 100%; min-height: 90px; padding: 0.6rem 0.75rem; border: 1px solid var(--card-border);
    border-radius: 8px; font-size: 0.88rem; font-family: inherit; margin-bottom: 1rem; resize: vertical;
  }
  .settings-form { display: flex; flex-direction: column; gap: 0.25rem; max-width: 680px; }
  .settings-form .field { margin-bottom: 0.75rem; }
  .settings-form label { display: block; font-size: 0.72rem; color: var(--text-muted); margin-bottom: 0.35rem; text-transform: uppercase; letter-spacing: 0.03em; }
  .settings-form input[type="number"] {
    width: 200px; padding: 0.45rem 0.6rem; border: 1px solid var(--card-border); border-radius: 8px; font-size: 0.85rem;
  }
  .settings-form textarea { min-height: 140px; margin-bottom: 0.35rem; }
  .settings-form .help { font-size: 0.75rem; color: var(--text-muted); margin: 0; }
</style>`;
```

- [ ] **Step 3: Thêm hàm `renderSettingsPage` vào cuối file**

Thêm vào CUỐI `src/api/adminHtml.ts` (sau hàm `renderRecordOrdersPage`):

```ts

export function renderSettingsPage(currentValues: Record<string, string>, errorMessage?: string | null): string {
  const errorBlock = errorMessage ? `<div class="error">${escapeHtml(errorMessage)}</div>` : "";

  const fields = SETTINGS_REGISTRY.map((entry) => {
    const value = currentValues[entry.key] ?? entry.default;
    const helpBlock = entry.helpText ? `<p class="help">${escapeHtml(entry.helpText)}</p>` : "";
    const control =
      entry.type === "number"
        ? `<input type="number" id="${entry.key}" name="${entry.key}" value="${escapeHtml(value)}"${
            entry.min !== undefined ? ` min="${entry.min}"` : ""
          }${entry.max !== undefined ? ` max="${entry.max}"` : ""} required>`
        : `<textarea id="${entry.key}" name="${entry.key}" required>${escapeHtml(value)}</textarea>`;
    return `<div class="field">
  <label for="${entry.key}">${escapeHtml(entry.label)}</label>
  ${control}
  ${helpBlock}
</div>`;
  }).join("\n");

  const body = `<div class="card">
<h2>Cấu hình</h2>
${errorBlock}
<form method="POST" action="/admin/settings" class="settings-form">
${fields}
<div><button type="submit" class="primary">Lưu thay đổi</button></div>
</form>
</div>`;

  return adminShell("settings", "Cấu hình", body);
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: không lỗi.

- [ ] **Step 5: Commit**

```bash
git add src/api/adminHtml.ts
git commit -m "$(cat <<'EOF'
Add renderSettingsPage to admin HTML, driven by SETTINGS_REGISTRY

Renders the settings form generically from the registry array instead
of hand-written markup per field, so a future setting only needs a
new registry entry. Route wiring (server.ts) comes in the next commit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Route `GET`/`POST /admin/settings` trong `server.ts` + test

**Files:**
- Modify: `src/api/server.ts`
- Test: `src/api/__tests__/adminRoutes.test.ts`

**Interfaces:**
- Consumes: `renderSettingsPage` (Task 8), `SETTINGS_REGISTRY` (Task 7), `ledgerStore.getSetting`/`setSetting` (Task 1).

- [ ] **Step 1: Viết test cho route mới — sẽ FAIL (route chưa tồn tại)**

Thêm vào `src/api/__tests__/adminRoutes.test.ts` (đầu file thêm import `renderSettingsPage` không cần thiết vì test gọi qua HTTP, không cần import trực tiếp):

```ts
test("GET /admin/settings tra ve form voi gia tri mac dinh khi chua tung luu setting nao", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/settings`, { headers: { cookie: cookie ?? "" } });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /name="commission_user_share_percent"/);
    assert.match(html, /name="withdrawal_threshold_vnd"/);
    assert.match(html, /name="usage_text"/);
    assert.match(html, /name="welcome_message_template"/);
    assert.match(html, /name="success_reply_template"/);
  } finally {
    cleanup();
  }
});

test("POST /admin/settings luu thanh cong -> GET sau do phan anh dung gia tri moi", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/settings`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie ?? "" },
      body: new URLSearchParams({
        commission_user_share_percent: "70",
        withdrawal_threshold_vnd: "99000",
        usage_text: "usage moi",
        welcome_message_template: "welcome moi {{userSharePercent}}",
        success_reply_template: "success moi {{link}}",
      }).toString(),
      redirect: "manual",
    });
    assert.equal(res.status, 303);
    assert.equal(ledgerStore.getSetting("commission_user_share_percent", ""), "70");
    assert.equal(ledgerStore.getSetting("withdrawal_threshold_vnd", ""), "99000");
    assert.equal(ledgerStore.getSetting("usage_text", ""), "usage moi");
  } finally {
    cleanup();
  }
});

test("POST /admin/settings voi % ngoai khoang 0-100 -> 422, khong luu gi ca", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/settings`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie ?? "" },
      body: new URLSearchParams({
        commission_user_share_percent: "150",
        withdrawal_threshold_vnd: "99000",
        usage_text: "usage moi",
        welcome_message_template: "welcome moi",
        success_reply_template: "success moi",
      }).toString(),
    });
    assert.equal(res.status, 422);
    const html = await res.text();
    assert.match(html, /class="error"/);
    // Khong co gia tri nao duoc luu - kiem tra field khong lien quan (usage_text) cung KHONG duoc
    // luu, xac nhan hanh vi "tat ca hoac khong gi" (atomic) thay vi luu rieng le tung field hop le.
    assert.equal(ledgerStore.getSetting("usage_text", "__default__"), "__default__");
  } finally {
    cleanup();
  }
});

test("POST /admin/settings voi text rong -> 422", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/settings`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie ?? "" },
      body: new URLSearchParams({
        commission_user_share_percent: "80",
        withdrawal_threshold_vnd: "20000",
        usage_text: "   ",
        welcome_message_template: "welcome moi",
        success_reply_template: "success moi",
      }).toString(),
    });
    assert.equal(res.status, 422);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `npx tsx --test src/api/__tests__/adminRoutes.test.ts`
Expected: FAIL — `GET /admin/settings` trả 303 (redirect về `/admin/login` vì route chưa đăng ký, rơi vào catch-all Express 404 thực ra trả 404, không phải redirect — điều quan trọng là KHÔNG PHẢI 200/303 như test mong đợi).

- [ ] **Step 3: Sửa import trong `src/api/server.ts`**

Tìm:
```ts
import {
  renderAccesstradePaymentsPage,
  renderAdminLoginPage,
  renderOrdersPage,
  renderRecordOrdersPage,
  renderReverseConfirmPage,
  renderUsersPage,
  renderWithdrawalsPage,
  type OrdersFilters,
} from "./adminHtml.js";
```

Thay bằng:
```ts
import {
  renderAccesstradePaymentsPage,
  renderAdminLoginPage,
  renderOrdersPage,
  renderRecordOrdersPage,
  renderReverseConfirmPage,
  renderSettingsPage,
  renderUsersPage,
  renderWithdrawalsPage,
  type OrdersFilters,
} from "./adminHtml.js";
```

Tìm:
```ts
import { RateLimiter } from "../core/rateLimiter.js";
import type { CommissionStatus, Platform } from "../core/types.js";
import { formatOrdersConfirmedReply } from "../adapters/shared/replyText.js";
```

Thay bằng:
```ts
import { RateLimiter } from "../core/rateLimiter.js";
import type { CommissionStatus, Platform } from "../core/types.js";
import { formatOrdersConfirmedReply } from "../adapters/shared/replyText.js";
import { SETTINGS_REGISTRY } from "../config/settingsRegistry.js";
```

- [ ] **Step 4: Thêm 2 route mới, ngay TRƯỚC error handler cuối file**

Tìm:
```ts
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
```

Thay bằng:
```ts
  app.get("/admin/settings", requireAdminAuth, (_req: Request, res: Response) => {
    const currentValues: Record<string, string> = {};
    for (const entry of SETTINGS_REGISTRY) {
      currentValues[entry.key] = ledgerStore.getSetting(entry.key, entry.default);
    }
    res.type("html").send(renderSettingsPage(currentValues));
  });

  app.post("/admin/settings", requireAdminAuth, (req: Request, res: Response) => {
    const submitted: Record<string, string> = {};
    const errors: string[] = [];

    for (const entry of SETTINGS_REGISTRY) {
      const raw = typeof req.body?.[entry.key] === "string" ? req.body[entry.key] : "";
      const trimmed = raw.trim();

      if (entry.type === "number") {
        const num = Number(trimmed);
        const outOfRange =
          (entry.min !== undefined && num < entry.min) || (entry.max !== undefined && num > entry.max);
        if (trimmed === "" || !Number.isFinite(num) || outOfRange) {
          const rangeHint =
            entry.min !== undefined && entry.max !== undefined
              ? ` (${entry.min}-${entry.max})`
              : entry.min !== undefined
                ? ` (>= ${entry.min})`
                : "";
          errors.push(`"${entry.label}" phải là số hợp lệ${rangeHint}.`);
        } else {
          submitted[entry.key] = String(Math.round(num));
        }
      } else {
        if (trimmed === "") {
          errors.push(`"${entry.label}" không được để trống.`);
        } else {
          submitted[entry.key] = trimmed;
        }
      }
    }

    if (errors.length > 0) {
      const previewValues: Record<string, string> = {};
      for (const entry of SETTINGS_REGISTRY) {
        const raw = typeof req.body?.[entry.key] === "string" ? req.body[entry.key] : "";
        previewValues[entry.key] = submitted[entry.key] ?? raw;
      }
      res.status(422).type("html").send(renderSettingsPage(previewValues, errors.join(" ")));
      return;
    }

    for (const entry of SETTINGS_REGISTRY) {
      ledgerStore.setSetting(entry.key, submitted[entry.key]);
    }
    res.redirect(303, "/admin/settings");
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
```

- [ ] **Step 5: Chạy lại test route, xác nhận PASS**

Run: `npx tsx --test src/api/__tests__/adminRoutes.test.ts`
Expected: PASS toàn bộ (test cũ + 4 test mới của Task 6 + Task 9).

- [ ] **Step 6: Chạy toàn bộ test suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS toàn bộ, không lỗi.

- [ ] **Step 7: Commit**

```bash
git add src/api/server.ts src/api/__tests__/adminRoutes.test.ts
git commit -m "$(cat <<'EOF'
Add GET/POST /admin/settings routes

Renders the settings form (Task 8) and validates + persists all 5
fields atomically - a single invalid field rejects the whole submit
with no partial save, redisplaying the form with the submitted values
and an error banner. Success redirects back to /admin/settings.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Kiểm tra thủ công qua trình duyệt

**Files:** không sửa file nào — chỉ chạy thủ công để xác nhận tính năng hoạt động đúng end-to-end (typecheck/test đã pass ở các task trước, nhưng chưa xác nhận trải nghiệm thật qua UI).

- [ ] **Step 1: Chạy dev server**

Run: `npm run dev`
Expected: server chạy tại `http://localhost:3000`, không lỗi khởi động. Cần `ADMIN_PASSWORD` đã đặt trong `.env` để đăng nhập được `/admin` (nếu chưa có, đặt tạm 1 giá trị bất kỳ trong `.env` cho lần chạy thử này).

- [ ] **Step 2: Đăng nhập `/admin`, vào mục "Cấu hình"**

Mở `http://localhost:3000/admin/login`, đăng nhập, click mục "Cấu hình" ở sidebar (mới thêm). Xác nhận: form hiện đúng 5 field với giá trị mặc định khớp `.env` hiện tại (vd `%` = 90 nếu `COMMISSION_USER_SHARE_PERCENT` đang là 90, hoặc mặc định 90 nếu chưa đặt).

- [ ] **Step 3: Thử lưu giá trị không hợp lệ**

Sửa `%` hoa hồng thành `150`, bấm Lưu. Xác nhận: trang hiện lại với banner lỗi đỏ, không mất các giá trị khác đã nhập, KHÔNG có setting nào bị lưu (kiểm tra bằng cách reload trang, giá trị vẫn là mặc định cũ).

- [ ] **Step 4: Lưu giá trị hợp lệ, xác nhận áp dụng ngay không cần restart**

Sửa `%` hoa hồng thành `70`, Usage text thành 1 câu khác dễ nhận biết (vd thêm "[TEST]" vào cuối câu), bấm Lưu. Xác nhận: redirect về `/admin/settings`, form hiện đúng giá trị mới.

Gọi thử `POST /api/v1/resolve` với 1 link Shopee/TikTok Shop giả lập qua `AFFILIATE_PROVIDER=mock` (đặt trong `.env` nếu chưa có), hoặc dùng Telegram bot thật nếu đã cấu hình `TELEGRAM_BOT_TOKEN` — gửi 1 tin nhắn KHÔNG phải link, xác nhận bot trả lời đúng "usage text" MỚI (có "[TEST]"), không phải bản cũ, và KHÔNG cần restart server giữa lúc đổi setting và lúc gửi tin nhắn.

- [ ] **Step 5: Trả lại giá trị test về mặc định (dọn dẹp)**

Sửa lại `%` hoa hồng + Usage text về giá trị gốc (hoặc đơn giản là ghi nhớ đây chỉ là dữ liệu test trên máy dev, không cần lo nếu dùng DB local `:memory:`/file tạm riêng cho dev, không phải DB production).

- [ ] **Step 6: Dừng dev server**

Ctrl+C để dừng `npm run dev`.

---

## Tổng kết sau khi hoàn tất tất cả task

- Chạy lại `npm run typecheck && npm test` lần cuối để chắc chắn toàn bộ thay đổi qua 9 task code không phá vỡ gì.
- Không cần cập nhật `.env.example` — không có biến môi trường mới nào được thêm (chỉ thêm cách override qua UI cho biến đã có).
- Có thể cân nhắc cập nhật `huong-dan-van-hanh-admin.md` (ngoài phạm vi plan này, hỏi user riêng nếu muốn) để nhắc admin về trang `/admin/settings` mới trong tài liệu vận hành.
