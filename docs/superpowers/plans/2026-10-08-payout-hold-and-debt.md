# Giam có điều kiện + Nợ hoàn trả — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Giảm thiểu thiệt hại khi user trả hàng sau khi đơn đã chuyển "Khả dụng" — bằng cách giam đơn to vài ngày trước khi cho rút, và ghi nợ trừ dần vào Khả dụng tương lai cho phần tiền đã ra khỏi tay.

**Architecture:** Hai cơ chế độc lập nhau. (1) *Giam có điều kiện*: cột `available_from` trên `commission_entries`, tính 1 lần lúc entry chuyển `confirmed` bằng hàm thuần `resolveAvailableFrom()`, rồi **chốt** — mọi query đọc tiền chỉ còn so sánh chuỗi ngày. (2) *Nợ hoàn trả*: bảng mới `payout_debts`, trừ vào `getAvailableBalance()` với floor ở 0, và chỉ thực sự giảm `remaining` ở `markWithdrawalPaid()` — nhờ vậy `cancelWithdrawal()` không cần hoàn nợ.

**Tech Stack:** TypeScript (ESM, `.js` trong import path), `node:sqlite` (`DatabaseSync`), Express 4, `node:test` qua `tsx --test`, Tailwind v4 (không preflight) cho `/admin`.

**Spec:** `docs/superpowers/specs/2026-10-08-payout-hold-and-debt-design.md`

## Global Constraints

- **Node >= 22.5.0**, ESM. Mọi import nội bộ phải có đuôi `.js` (`from "../vietnamDate.js"`), kể cả khi file nguồn là `.ts`.
- **DB là `node:sqlite` built-in.** Không thêm `better-sqlite3` hay lib SQLite nào.
- `src/core/**` **không** được import `express`, `telegraf`, `zca-js`, hay biết về platform cụ thể.
- **Thêm cột vào bảng đã có thì BẮT BUỘC có migration** (`ALTER TABLE` + kiểm tra `hasColumn`). DB thật trên Railway đã tồn tại từ trước; quên migration là lỗi `no such column` lúc khởi động. Bảng **mới hoàn toàn** thì không cần migration.
- **Mốc ngày luôn là giờ VN (`Asia/Ho_Chi_Minh`, +07, không DST).** Railway chạy UTC. Dùng `todayVnIso()` từ `src/core/vietnamDate.js`; **không** dùng `date('now')` của SQLite — nó là UTC và sẽ lệch 7 tiếng.
- Định dạng ngày lưu trong DB cho cột ngày-lịch: chuỗi `"YYYY-MM-DD"` (sắp xếp từ điển trùng sắp xếp thời gian, so sánh trực tiếp bằng `<=`).
- **Tiền hiển thị luôn qua `formatVnd()`** từ `src/core/money.js` (luôn ra số nguyên).
- `availableBalance` **không bao giờ được âm**.
- **Lỗi hiển thị cho user luôn là `AppError` subclass** (`src/core/errors.ts`) với `userMessage` tiếng Việt.
- Lệnh test: `npm test`. Lệnh typecheck: `npm run typecheck`. Chạy 1 file: `npx tsx --test src/core/__tests__/<file>.test.ts`.
- **Comment trong code viết KHÔNG DẤU** (theo toàn bộ codebase hiện tại). Chuỗi hiển thị cho user thì CÓ DẤU.
- Giá trị số/ngày đã chốt trong bảng **không bao giờ được tính lại** khi admin đổi setting.
- Commit message: tiếng Việt không dấu, prefix conventional (`feat:`/`fix:`/`refactor:`/`docs:`), kết thúc bằng dòng `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` cách ra bằng 1 dòng trống.
- **Không deploy, không `git push`.** Repo này auto-deploy Railway khi push `main` — chỉ commit local.

---

## File Structure

**Tạo mới:**

| File | Trách nhiệm |
| --- | --- |
| `src/core/payoutHold.ts` | Hàm thuần `resolveAvailableFrom()` + type `PayoutHoldConfig`. Không DB, không I/O. |
| `src/core/__tests__/payoutHold.test.ts` | Test cho hàm trên. |
| `src/core/__tests__/payoutHoldStore.test.ts` | Test phần giam ở tầng `LedgerStore`. |
| `src/core/__tests__/payoutDebt.test.ts` | Test bảng nợ + trừ nợ + huỷ yêu cầu rút. |

**Sửa:**

| File | Nội dung |
| --- | --- |
| `src/core/vietnamDate.ts` | thêm `addDaysToVnIso()` |
| `src/core/types.ts` | `CommissionEntry` +2 field; `WithdrawalStatus` +`"cancelled"`; `WithdrawalRequest` +2 field; type mới `PayoutDebt` |
| `src/core/ledgerStore.ts` | 3 migration, bảng `payout_debts`, ~10 method mới, sửa `getAvailableBalance`/`requestWithdrawal`/`markWithdrawalPaid`/`getUserSummary`/`listUsers` |
| `src/core/shopeeReportImport.ts` | đọc `Thời gian hoàn thành`, đổi tên `parseShopeeOrderDate`→`parseShopeeReportDay`, bảng quyết định nhánh "Đã hủy", +2 counter |
| `src/core/orderIngest.ts` | truyền `holdConfig` vào `recordConversion` |
| `src/core/settingsKeys.ts` | +4 key |
| `src/config/settingsRegistry.ts` | +4 entry |
| `src/config/env.ts`, `.env.example` | +2 biến |
| `src/adapters/shared/replyText.ts` | +2 template default + 2 hàm format |
| `src/core/orderImage/orderImageLayout.ts` | +dòng "mở khoá" trong view model |
| `src/core/orderImage/ordersConfirmedNotification.ts` | truyền số tiền bị giam của lô |
| `src/api/server.ts` | route `cancel`, route `write-off-debt`, truyền dữ liệu giam/nợ vào các trang |
| `src/api/dashboardHtml.ts` | 2 dòng số mới + form rút hiện số bị trừ |
| `src/api/adminHtml.ts` | `/admin/withdrawals` (banner + nút Huỷ + tab 3), `/admin/users` (cột Nợ + nút Xoá nợ), `/admin/orders` (badge + cột Mở khoá) |
| `src/api/handbookHtml.ts` | mục mới về giam + trả hàng |
| `CLAUDE.md` | ghi lại quyết định + bẫy vận hành |

**Thứ tự task bám đúng chiều phụ thuộc:** hàm thuần → store → import → settings → thông báo → UI → docs. Task 1-8 là lõi tiền và phải xong trước mọi thứ hiển thị.

---

### Task 1: `addDaysToVnIso` — cộng ngày trên chuỗi `"YYYY-MM-DD"`

**Files:**
- Modify: `src/core/vietnamDate.ts`
- Test: `src/core/__tests__/vietnamDate.test.ts`

**Interfaces:**
- Consumes: không có.
- Produces: `addDaysToVnIso(iso: string, days: number): string` — dùng bởi Task 2.

- [ ] **Step 1: Write the failing tests**

Thêm vào cuối `src/core/__tests__/vietnamDate.test.ts`, và thêm `addDaysToVnIso` vào dòng `import` ở đầu file:

```ts
test("addDaysToVnIso: cong ngay trong cung thang", () => {
  assert.equal(addDaysToVnIso("2026-10-01", 7), "2026-10-08");
});

test("addDaysToVnIso: vat qua thang", () => {
  assert.equal(addDaysToVnIso("2026-09-28", 7), "2026-10-05");
});

test("addDaysToVnIso: vat qua nam", () => {
  assert.equal(addDaysToVnIso("2026-12-28", 7), "2027-01-04");
});

test("addDaysToVnIso: thang 2 nam nhuan", () => {
  assert.equal(addDaysToVnIso("2028-02-26", 7), "2028-03-04");
});

test("addDaysToVnIso: thang 2 nam KHONG nhuan", () => {
  assert.equal(addDaysToVnIso("2026-02-26", 7), "2026-03-05");
});

test("addDaysToVnIso: days = 0 tra lai chinh ngay do", () => {
  assert.equal(addDaysToVnIso("2026-10-08", 0), "2026-10-08");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/core/__tests__/vietnamDate.test.ts`
Expected: FAIL — `addDaysToVnIso is not a function` (hoặc lỗi import của tsx).

- [ ] **Step 3: Write minimal implementation**

Thêm vào cuối `src/core/vietnamDate.ts`:

```ts
/**
 * Cong `days` ngay vao 1 ngay lich "YYYY-MM-DD" (gio VN), tra ve cung dinh dang.
 *
 * Dung Date.UTC co chu dich: input DA la ngay lich VN roi, khong can doi mui gio lan nua - neu dung
 * `new Date("2026-10-01")` roi setDate() thi ket qua phu thuoc mui gio cua MAY CHAY (Railway chay
 * UTC, may dev chay +07), tuc cung 1 input ra 2 ket qua khac nhau.
 */
export function addDaysToVnIso(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const base = Date.UTC(year, month - 1, day);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/core/__tests__/vietnamDate.test.ts`
Expected: PASS, toàn bộ test cũ trong file vẫn pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/vietnamDate.ts src/core/__tests__/vietnamDate.test.ts
git commit -F - <<'EOF'
feat(date): addDaysToVnIso cong ngay tren chuoi YYYY-MM-DD

Dung Date.UTC thay vi new Date(iso)+setDate: input da la ngay lich VN nen
khong duoc doi mui gio lan nua, va cach cu cho ket qua khac nhau giua may
dev (+07) voi Railway (UTC).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: `payoutHold.ts` — quy tắc giam, hàm thuần

**Files:**
- Create: `src/core/payoutHold.ts`
- Test: `src/core/__tests__/payoutHold.test.ts`

**Interfaces:**
- Consumes: `addDaysToVnIso(iso, days)` từ Task 1.
- Produces:
  - `interface PayoutHoldConfig { thresholdVnd: number; holdDays: number }`
  - `function resolveAvailableFrom(params: { userShareAmount: number; completedAtVn: string | null; fallbackDayVn: string; config: PayoutHoldConfig }): string | null`

- [ ] **Step 1: Write the failing test**

Tạo `src/core/__tests__/payoutHold.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAvailableFrom } from "../payoutHold.js";

const CONFIG = { thresholdVnd: 100_000, holdDays: 7 };

test("duoi nguong -> kha dung ngay (null)", () => {
  assert.equal(
    resolveAvailableFrom({
      userShareAmount: 99_999,
      completedAtVn: "2026-10-01",
      fallbackDayVn: "2026-10-05",
      config: CONFIG,
    }),
    null
  );
});

test("DUNG nguong -> BI giam (so sanh la >=, khong phai >)", () => {
  assert.equal(
    resolveAvailableFrom({
      userShareAmount: 100_000,
      completedAtVn: "2026-10-01",
      fallbackDayVn: "2026-10-05",
      config: CONFIG,
    }),
    "2026-10-08"
  );
});

test("tren nguong -> giam, dem tu completedAt chu KHONG phai fallback", () => {
  assert.equal(
    resolveAvailableFrom({
      userShareAmount: 500_000,
      completedAtVn: "2026-09-28",
      fallbackDayVn: "2026-10-05",
      config: CONFIG,
    }),
    "2026-10-05"
  );
});

test("khong biet ngay giao hang -> lui ve fallbackDayVn", () => {
  assert.equal(
    resolveAvailableFrom({
      userShareAmount: 500_000,
      completedAtVn: null,
      fallbackDayVn: "2026-10-05",
      config: CONFIG,
    }),
    "2026-10-12"
  );
});

// userShareAmount === 0 la gia tri THAT (chu bot giu toan bo hoa hong) - dung `||` o day la sai.
test("userShareAmount = 0 -> khong giam", () => {
  assert.equal(
    resolveAvailableFrom({
      userShareAmount: 0,
      completedAtVn: "2026-10-01",
      fallbackDayVn: "2026-10-05",
      config: CONFIG,
    }),
    null
  );
});

test("thresholdVnd = 0 -> TAT han tinh nang giam, moi don kha dung ngay", () => {
  assert.equal(
    resolveAvailableFrom({
      userShareAmount: 10_000_000,
      completedAtVn: "2026-10-01",
      fallbackDayVn: "2026-10-05",
      config: { thresholdVnd: 0, holdDays: 7 },
    }),
    null
  );
});

test("thresholdVnd am -> cung coi la tat (khong duoc giam het moi don)", () => {
  assert.equal(
    resolveAvailableFrom({
      userShareAmount: 500_000,
      completedAtVn: "2026-10-01",
      fallbackDayVn: "2026-10-05",
      config: { thresholdVnd: -1, holdDays: 7 },
    }),
    null
  );
});

test("holdDays = 0 -> mo khoa ngay trong ngay giao hang", () => {
  assert.equal(
    resolveAvailableFrom({
      userShareAmount: 500_000,
      completedAtVn: "2026-10-01",
      fallbackDayVn: "2026-10-05",
      config: { thresholdVnd: 100_000, holdDays: 0 },
    }),
    "2026-10-01"
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/core/__tests__/payoutHold.test.ts`
Expected: FAIL — không resolve được module `../payoutHold.js`.

- [ ] **Step 3: Write minimal implementation**

Tạo `src/core/payoutHold.ts`:

```ts
import { addDaysToVnIso } from "./vietnamDate.js";

/**
 * Quy tac giam tien don to truoc khi cho rut (2026-10-08). Hai so nay admin sua duoc ngay tai
 * /admin/settings (xem SETTINGS_REGISTRY), .env chi la gia tri khoi tao.
 */
export interface PayoutHoldConfig {
  /** user_share_amount tu muc nay tro len thi bi giam. <= 0 = TAT han tinh nang. */
  thresholdVnd: number;
  /** So ngay giam, dem tu ngay Shopee ghi don "Hoan thanh" (= ngay giao hang). */
  holdDays: number;
}

/**
 * Tra ngay mo khoa ("YYYY-MM-DD" gio VN) cho 1 entry VUA chuyen sang confirmed, hoac null = kha
 * dung ngay.
 *
 * Vi sao dem tu completedAtVn chu khong tu ngay import: do la DUNG moc Shopee dem 15 ngay duoc tra
 * hang (chinh sach dieu 3.2), nen cau giai thich cho user kiem chung duoc, va hold khong bi dai
 * them chi vi admin import tre may ngay.
 *
 * Ket qua cua ham nay duoc GHI VAO cot available_from va KHONG BAO GIO tinh lai - admin nang hold
 * tu 7 len 15 ngay hom nay khong duoc keo dai thoi gian giam cua don user DA MUA tu tuan truoc
 * (cung ly do 3 cot *_percent phai chot theo tung don, xem CLAUDE.md).
 */
export function resolveAvailableFrom(params: {
  userShareAmount: number;
  /** Tu cot "Thời gian hoàn thành" cua bao cao Shopee. null khi bao cao thieu / ghi don le bang tay. */
  completedAtVn: string | null;
  /** Lui ve moc nay khi khong biet ngay giao hang - caller truyen todayVnIso(). */
  fallbackDayVn: string;
  config: PayoutHoldConfig;
}): string | null {
  const { userShareAmount, completedAtVn, fallbackDayVn, config } = params;
  if (config.thresholdVnd <= 0) return null;
  if (userShareAmount < config.thresholdVnd) return null;
  return addDaysToVnIso(completedAtVn ?? fallbackDayVn, config.holdDays);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/core/__tests__/payoutHold.test.ts`
Expected: PASS (8 test).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/core/payoutHold.ts src/core/__tests__/payoutHold.test.ts
git commit -F - <<'EOF'
feat(core): payoutHold - quy tac giam tien don to truoc khi cho rut

Ham thuan resolveAvailableFrom(): user_share >= nguong thi mo khoa sau N ngay
ke tu ngay Shopee ghi "Hoan thanh" (= ngay giao hang, dung moc Shopee dem 15
ngay duoc tra hang). thresholdVnd <= 0 = tat han tinh nang.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: 2 cột `completed_at` / `available_from` + ghi lúc entry chuyển `confirmed`

**Files:**
- Modify: `src/core/types.ts` (`CommissionEntry`)
- Modify: `src/core/ledgerStore.ts` (migration, `RecordConversionInput`, `recordConversion`, `confirmPendingEntry`, `rowToCommissionEntry`)
- Test: `src/core/__tests__/payoutHoldStore.test.ts` (tạo mới)
- Modify: `src/core/__tests__/ledgerStore.test.ts` (helper `recordSample` phải truyền field mới)

**Interfaces:**
- Consumes: `resolveAvailableFrom`, `PayoutHoldConfig` (Task 2); `todayVnIso()` từ `vietnamDate.js`.
- Produces:
  - `CommissionEntry.completedAt: string | null`, `CommissionEntry.availableFrom: string | null`
  - `RecordConversionInput.completedAt?: string | null` và `RecordConversionInput.holdConfig: PayoutHoldConfig` (**bắt buộc**)
  - `confirmPendingEntry(id, input)` — `input` thêm `completedAt?: string | null` và `holdConfig: PayoutHoldConfig` (**bắt buộc**)

`holdConfig` cố tình để **bắt buộc**: nó nằm trên đường tiền, mỗi call site phải quyết định rõ ràng thay vì nhận một default âm thầm. Call site nào không muốn giam thì truyền `{ thresholdVnd: 0, holdDays: 0 }`.

- [ ] **Step 1: Write the failing test**

Tạo `src/core/__tests__/payoutHoldStore.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";

const HOLD_ON = { thresholdVnd: 100_000, holdDays: 7 };
const HOLD_OFF = { thresholdVnd: 0, holdDays: 0 };

function store() {
  return new LedgerStore(":memory:");
}

function record(
  s: LedgerStore,
  overrides: Partial<{
    orderId: string;
    commissionAmount: number;
    completedAt: string | null;
    holdConfig: { thresholdVnd: number; holdDays: number };
    status: "pending" | "confirmed";
  }> = {}
) {
  return s.recordConversion({
    subId: "k-user-a-abc-def",
    platform: "zalo",
    userId: "user-a",
    merchant: "shopee",
    orderId: overrides.orderId ?? "order-1",
    orderAmount: 2_000_000,
    commissionAmount: overrides.commissionAmount ?? 200_000,
    taxPercent: 0,
    platformFeePercent: 0,
    userSharePercent: 100,
    maxCommissionRatioPercent: 50,
    completedAt: overrides.completedAt ?? "2026-10-01",
    holdConfig: overrides.holdConfig ?? HOLD_ON,
    status: overrides.status,
  });
}

test("recordConversion: don to -> available_from = completedAt + holdDays", () => {
  const s = store();
  const entry = record(s);
  assert.equal(entry.completedAt, "2026-10-01");
  assert.equal(entry.availableFrom, "2026-10-08");
});

test("recordConversion: don nho -> available_from null", () => {
  const s = store();
  const entry = record(s, { commissionAmount: 50_000 });
  assert.equal(entry.availableFrom, null);
});

test("entry dang bi giam KHONG vao getAvailableBalance, co trong getHeldBalance", () => {
  const s = store();
  record(s);
  assert.equal(s.getAvailableBalance("zalo", "user-a"), 0);
  assert.equal(s.getHeldBalance("zalo", "user-a"), 200_000);
});

test("entry da qua ngay mo khoa thi vao getAvailableBalance", () => {
  const s = store();
  // completedAt tu rat lau -> available_from da qua
  record(s, { completedAt: "2020-01-01" });
  assert.equal(s.getAvailableBalance("zalo", "user-a"), 200_000);
  assert.equal(s.getHeldBalance("zalo", "user-a"), 0);
});

test("entry cu (available_from NULL) kha dung ngay - KHONG giam hoi to", () => {
  const s = store();
  record(s, { holdConfig: HOLD_OFF });
  assert.equal(s.getAvailableBalance("zalo", "user-a"), 200_000);
  assert.equal(s.getHeldBalance("zalo", "user-a"), 0);
});

test("confirmPendingEntry: chot available_from luc duyet, lay completedAt luc duyet", () => {
  const s = store();
  const pending = record(s, { status: "pending", completedAt: null });
  assert.equal(pending.availableFrom, null, "pending chua co ngay mo khoa");

  const confirmed = s.confirmPendingEntry(pending.id, {
    orderAmount: 2_000_000,
    commissionAmount: 200_000,
    fallbackPercents: { taxPercent: 0, platformFeePercent: 0, userSharePercent: 100 },
    maxCommissionRatioPercent: 50,
    completedAt: "2026-10-02",
    holdConfig: HOLD_ON,
  });
  assert.equal(confirmed.completedAt, "2026-10-02");
  assert.equal(confirmed.availableFrom, "2026-10-09");
});

// Chot quan trong nhat cua tinh nang giam: doi setting KHONG duoc dich ngay mo khoa da hua.
test("available_from DA CHOT khong doi khi doi setting roi cap nhat lai entry", () => {
  const s = store();
  const pending = record(s, { status: "pending", completedAt: null });
  const confirmed = s.confirmPendingEntry(pending.id, {
    orderAmount: 2_000_000,
    commissionAmount: 200_000,
    fallbackPercents: { taxPercent: 0, platformFeePercent: 0, userSharePercent: 100 },
    maxCommissionRatioPercent: 50,
    completedAt: "2026-10-02",
    holdConfig: HOLD_ON,
  });
  assert.equal(confirmed.availableFrom, "2026-10-09");

  // Admin nang hold len 30 ngay roi import lai bao cao -> entry da confirmed, confirmPendingEntry
  // nem EntryNotPendingError nen khong the ghi de; doc lai tu DB phai thay ngay CU.
  const reread = s.getEntryById(confirmed.id);
  assert.equal(reread?.availableFrom, "2026-10-09");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/core/__tests__/payoutHoldStore.test.ts`
Expected: FAIL — `holdConfig` không tồn tại trên `RecordConversionInput`, `getHeldBalance` is not a function.

- [ ] **Step 3: Thêm 2 field vào `CommissionEntry`**

Trong `src/core/types.ts`, thêm vào `interface CommissionEntry` (ngay sau `orderDate`):

```ts
  /**
   * Ngay Shopee ghi don "Hoan thanh" = ngay giao hang ("YYYY-MM-DD" gio VN, 2026-10-08), doc tu cot
   * "Thời gian hoàn thành" cua bao cao. null khi bao cao khong co gia tri (don con pending, don ghi
   * tay). Day la moc Shopee dem 15 ngay duoc tra hang - xem payoutHold.ts.
   */
  completedAt: string | null;
  /**
   * Ngay tien cua don nay duoc phep rut ("YYYY-MM-DD" gio VN). null = kha dung ngay (don duoi nguong,
   * hoac entry ghi truoc 2026-10-08 nen khong giam hoi to). Tinh 1 lan luc entry chuyen confirmed roi
   * CHOT - doi setting khong tinh lai, xem resolveAvailableFrom().
   */
  availableFrom: string | null;
```

- [ ] **Step 4: Migration + mapping + ghi giá trị**

Trong `src/core/ledgerStore.ts`:

4a. Thêm import ở đầu file:

```ts
import { resolveAvailableFrom, type PayoutHoldConfig } from "./payoutHold.js";
import { todayVnIso } from "./vietnamDate.js";
```

4b. Thêm method migration (đặt cạnh `migrateAddOrderDateColumn`), và gọi nó trong constructor **ngay sau** `this.migrateAddRatePercentColumns();`:

```ts
  /**
   * 2 cot cua tinh nang giam tien don to (2026-10-08). Nullable, khong DEFAULT, KHONG backfill: bao
   * cao da import khong luu lai nen khong suy lai duoc ngay giao hang cua don cu - de NULL va don cu
   * kha dung ngay (khong giam hoi to, tien da hua roi).
   */
  private migrateAddPayoutHoldColumns(): void {
    const columns = this.db.prepare("PRAGMA table_info(commission_entries)").all() as Array<{ name: string }>;
    const hasColumn = (name: string) => columns.some((c) => c.name === name);
    if (!hasColumn("completed_at")) {
      this.db.exec("ALTER TABLE commission_entries ADD COLUMN completed_at TEXT");
    }
    if (!hasColumn("available_from")) {
      this.db.exec("ALTER TABLE commission_entries ADD COLUMN available_from TEXT");
    }
  }
```

4c. Thêm 2 cột vào `CREATE TABLE IF NOT EXISTS commission_entries` (sau `user_share_percent REAL`) để DB mới có sẵn:

```sql
        completed_at TEXT,
        available_from TEXT,
```

4d. Trong `rowToCommissionEntry()`, thêm sau `orderDate`:

```ts
    completedAt: (r.completed_at as string | null) ?? null,
    availableFrom: (r.available_from as string | null) ?? null,
```

4e. Thêm vào `interface RecordConversionInput`:

```ts
  /** Ngay Shopee ghi don "Hoan thanh" ("YYYY-MM-DD" gio VN). null/undefined = nguon khong cho biet. */
  completedAt?: string | null;
  /**
   * BAT BUOC chu khong optional: day la duong tien, moi call site phai quyet dinh ro rang thay vi
   * nhan mot default am tham. Khong muon giam thi truyen { thresholdVnd: 0, holdDays: 0 }.
   */
  holdConfig: PayoutHoldConfig;
```

4f. Trong `recordConversion()`, sau khi đã có `userShareAmount`, trước `INSERT`:

```ts
    const status = input.status ?? "confirmed";
    const completedAt = input.completedAt ?? null;
    // Chi don DA confirmed moi co ngay mo khoa - don pending chua co tien kha dung nen chua tinh.
    const availableFrom =
      status === "confirmed"
        ? resolveAvailableFrom({
            userShareAmount,
            completedAtVn: completedAt,
            fallbackDayVn: todayVnIso(),
            config: input.holdConfig,
          })
        : null;
```

Lưu ý: `recordConversion` **đã có** biến `status` sẵn — dùng lại biến đó, đừng khai báo trùng.

Rồi thêm `completed_at, available_from` vào danh sách cột của `INSERT`, thêm 2 dấu `?` vào `VALUES`, và truyền `completedAt, availableFrom` đúng thứ tự trong `.run(...)`.

4g. Trong giá trị trả về của `recordConversion()`, thêm `completedAt` và `availableFrom`.

4h. Trong `confirmPendingEntry()`: thêm `completedAt?: string | null` và `holdConfig: PayoutHoldConfig` vào `input`; tính `availableFrom` y như trên (status đích luôn là `confirmed`); thêm `completed_at = ?, available_from = ?` vào câu `UPDATE` và truyền giá trị.

- [ ] **Step 5: Thêm `getHeldBalance` / `getHeldEntries` và sửa `getAvailableBalance`**

Sửa `getAvailableBalance()` (hiện ở ~dòng 849):

```ts
  /**
   * Tien user rut duoc NGAY BAY GIO. Loai don dang bi giam (available_from > hom nay gio VN) -
   * available_from NULL nghia la kha dung ngay (don duoi nguong / don ghi truoc 2026-10-08).
   *
   * Dung todayVnIso() chu KHONG date('now') cua SQLite: cai do la UTC, se mo khoa lech 7 tieng.
   */
  getAvailableBalance(platform: Platform, userId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(user_share_amount), 0) AS total FROM commission_entries
         WHERE platform = ? AND user_id = ? AND status = 'confirmed' AND withdrawal_id IS NULL
           AND (available_from IS NULL OR available_from <= ?)`
      )
      .get(platform, userId, todayVnIso()) as { total: number };
    return row.total;
  }

  /** Tien da duoc Shopee duyet nhung con bi giam - doi xung voi getAvailableBalance(). */
  getHeldBalance(platform: Platform, userId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(user_share_amount), 0) AS total FROM commission_entries
         WHERE platform = ? AND user_id = ? AND status = 'confirmed' AND withdrawal_id IS NULL
           AND available_from IS NOT NULL AND available_from > ?`
      )
      .get(platform, userId, todayVnIso()) as { total: number };
    return row.total;
  }

  /** Danh sach don dang bi giam, de dashboard hien ngay mo khoa cua TUNG don. */
  getHeldEntries(platform: Platform, userId: string): CommissionEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM commission_entries
         WHERE platform = ? AND user_id = ? AND status = 'confirmed' AND withdrawal_id IS NULL
           AND available_from IS NOT NULL AND available_from > ?
         ORDER BY available_from ASC, rowid DESC`
      )
      .all(platform, userId, todayVnIso());
    return rows.map(rowToCommissionEntry);
  }
```

- [ ] **Step 6: Sửa test cũ để truyền `holdConfig`**

Trong `src/core/__tests__/ledgerStore.test.ts`, helper `recordSample()` thêm `holdConfig: { thresholdVnd: 0, holdDays: 0 }` vào object truyền cho `recordConversion`. Chạy test, sửa mọi call site `recordConversion`/`confirmPendingEntry` còn thiếu `holdConfig` trong tất cả file test (grep `recordConversion(` và `confirmPendingEntry(` trong `src/**/__tests__`).

Dùng `{ thresholdVnd: 0, holdDays: 0 }` cho test cũ là có chủ đích: tắt giam nên mọi assertion về số dư hiện có vẫn đúng y nguyên.

- [ ] **Step 7: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS toàn bộ.

- [ ] **Step 8: Commit**

```bash
git add src/core/types.ts src/core/ledgerStore.ts src/core/__tests__/
git commit -F - <<'EOF'
feat(ledger): cot completed_at/available_from - giam tien don to truoc khi cho rut

available_from tinh 1 lan luc entry chuyen confirmed roi CHOT (cung ly do 3 cot
*_percent phai chot theo tung don): admin nang hold len khong duoc keo dai thoi
gian giam cua don user da mua tu truoc.

getAvailableBalance loai don dang bi giam, them getHeldBalance/getHeldEntries.
Moc so sanh la todayVnIso() chu khong date('now') cua SQLite - cai do la UTC va
se mo khoa lech 7 tieng.

holdConfig la tham so BAT BUOC: day la duong tien, moi call site phai quyet dinh
ro rang thay vi nhan default am tham.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: `requestWithdrawal` không hút đơn đang bị giam

**Files:**
- Modify: `src/core/ledgerStore.ts:1359-1421` (`requestWithdrawal`)
- Test: `src/core/__tests__/payoutHoldStore.test.ts`

**Interfaces:**
- Consumes: `getAvailableBalance` đã sửa (Task 3).
- Produces: không đổi chữ ký.

- [ ] **Step 1: Write the failing test**

Thêm vào `src/core/__tests__/payoutHoldStore.test.ts`:

```ts
const BANK = { bankName: "Vietcombank", bankAccountNumber: "0123456789", bankAccountHolder: "Nguyen Van A" };

test("requestWithdrawal KHONG hut don dang bi giam vao yeu cau rut", () => {
  const s = store();
  // don nho, kha dung ngay
  record(s, { orderId: "small", commissionAmount: 50_000 });
  // don to, dang bi giam
  record(s, { orderId: "big", commissionAmount: 300_000 });

  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);

  assert.equal(w.amount, 50_000, "chi rut duoc don da mo khoa");
  assert.equal(s.getHeldBalance("zalo", "user-a"), 300_000, "don to con nguyen trong vung giam");

  const big = s.listCommissionEntries({ userId: "user-a" }).find((e) => e.orderId === "big");
  assert.equal(big?.withdrawalId, null, "don bi giam khong duoc gan withdrawal_id");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/core/__tests__/payoutHoldStore.test.ts`
Expected: FAIL — `w.amount` là 50_000 (đúng, vì `getAvailableBalance` đã lọc) nhưng `big.withdrawalId` **không** null, vì câu `UPDATE` trong `requestWithdrawal` vẫn gom mọi entry `confirmed`.

- [ ] **Step 3: Sửa câu `UPDATE`**

Trong `requestWithdrawal()`, đổi khối `UPDATE commission_entries SET withdrawal_id = ?`:

```ts
      // Phai lap LAI dieu kien available_from giong getAvailableBalance(): thieu no thi don dang bi
      // giam van bi gan withdrawal_id (tuc bi khoa vao mot yeu cau rut khong he tinh tien cua no),
      // user mat quyen rut so tien do cho den khi admin tra xong yeu cau kia.
      this.db
        .prepare(
          `UPDATE commission_entries SET withdrawal_id = ?
           WHERE platform = ? AND user_id = ? AND status = 'confirmed' AND withdrawal_id IS NULL
             AND (available_from IS NULL OR available_from <= ?)`
        )
        .run(id, platform, userId, todayVnIso());
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/ledgerStore.ts src/core/__tests__/payoutHoldStore.test.ts
git commit -F - <<'EOF'
fix(ledger): requestWithdrawal khong hut don dang bi giam

Thieu dieu kien available_from trong cau UPDATE thi don bi giam van bi gan
withdrawal_id du so tien cua no khong nam trong yeu cau rut - user mat quyen rut
so do cho den khi admin tra xong yeu cau kia.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Bảng `payout_debts` + API CRUD

**Files:**
- Modify: `src/core/types.ts` (type `PayoutDebt`)
- Modify: `src/core/ledgerStore.ts` (CREATE TABLE + 6 method)
- Test: `src/core/__tests__/payoutDebt.test.ts` (tạo mới)

**Interfaces:**
- Consumes: không có.
- Produces:
  - `interface PayoutDebt { id; createdAt; platform; userId; merchant; orderId; amount; remaining; note: string | null; settledAt: string | null; writtenOffAt: string | null }`
  - `recordPayoutDebt(input: { platform: Platform; userId: string; merchant: MerchantId; orderId: string; amount: number; note?: string }): PayoutDebt | null` — `null` = đơn này đã có nợ, bỏ qua
  - `listOutstandingDebts(platform: Platform, userId: string): PayoutDebt[]`
  - `getOutstandingDebtTotal(platform: Platform, userId: string): number`
  - `writeOffDebt(id: string): void`
  - `deleteDebtByOrder(merchant: MerchantId, orderId: string): void`
  - `getDebtByOrder(merchant: MerchantId, orderId: string): PayoutDebt | null`

- [ ] **Step 1: Write the failing test**

Tạo `src/core/__tests__/payoutDebt.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";

function store() {
  return new LedgerStore(":memory:");
}

const DEBT = {
  platform: "zalo" as const,
  userId: "user-a",
  merchant: "shopee" as const,
  orderId: "order-1",
  amount: 40_000,
  note: "tra hang",
};

test("recordPayoutDebt: ghi 1 dong no, remaining = amount", () => {
  const s = store();
  const debt = s.recordPayoutDebt(DEBT);
  assert.ok(debt);
  assert.equal(debt.amount, 40_000);
  assert.equal(debt.remaining, 40_000);
  assert.equal(debt.settledAt, null);
  assert.equal(debt.writtenOffAt, null);
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 40_000);
});

// Chot song con: bao cao Shopee liet ke LAI ca lich su moi lan import, nen don huy hom qua se lai
// hien "Da huy" hom nay. Khong co UNIQUE la no nhan doi moi ngay.
test("recordPayoutDebt: import lai cung don KHONG nhan doi no", () => {
  const s = store();
  assert.ok(s.recordPayoutDebt(DEBT));
  assert.equal(s.recordPayoutDebt(DEBT), null, "lan 2 tra null");
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 40_000);
  assert.equal(s.listOutstandingDebts("zalo", "user-a").length, 1);
});

test("writeOffDebt: no da xoa khong tinh vao tong nua nhung dong van con de doi soat", () => {
  const s = store();
  const debt = s.recordPayoutDebt(DEBT);
  s.writeOffDebt(debt!.id);
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 0);
  assert.equal(s.listOutstandingDebts("zalo", "user-a").length, 0);
  assert.ok(s.getDebtByOrder("shopee", "order-1")?.writtenOffAt, "dong van con, co moc xoa");
});

test("deleteDebtByOrder: xoa han dong no (dung khi admin huy yeu cau rut)", () => {
  const s = store();
  s.recordPayoutDebt(DEBT);
  s.deleteDebtByOrder("shopee", "order-1");
  assert.equal(s.getDebtByOrder("shopee", "order-1"), null);
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 0);
});

test("no cua user khac khong lan sang nhau", () => {
  const s = store();
  s.recordPayoutDebt(DEBT);
  s.recordPayoutDebt({ ...DEBT, userId: "user-b", orderId: "order-2", amount: 10_000 });
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 40_000);
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-b"), 10_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/core/__tests__/payoutDebt.test.ts`
Expected: FAIL — `recordPayoutDebt is not a function`.

- [ ] **Step 3: Thêm type `PayoutDebt`**

Trong `src/core/types.ts`, thêm (cạnh `WithdrawalRequest`):

```ts
/**
 * 1 khoan tien da tra cho user roi Shopee thu lai vi khach tra hang (2026-10-08). Tru DAN vao Kha
 * dung tuong lai, KHONG bao gio ep user chuyen tien ra.
 *
 * `remaining` chi giam o markWithdrawalPaid() - xem ledgerStore.
 */
export interface PayoutDebt {
  id: string;
  createdAt: string;
  platform: Platform;
  userId: string;
  merchant: MerchantId;
  orderId: string;
  /** So tien user da nhan cua don bi huy (= user_share_amount cua entry). */
  amount: number;
  /** Con phai tru. Ve 0 thi settledAt duoc dien. */
  remaining: number;
  note: string | null;
  settledAt: string | null;
  /** Admin xoa no (user bo di, no treo vinh vien lam meo moi con so tong). Dong van duoc giu lai. */
  writtenOffAt: string | null;
}
```

Nếu `types.ts` chưa import `MerchantId`, thêm `import type { MerchantId } from "./merchants.js";` ở đầu file (kiểm tra trước — `CommissionEntry.merchant` có thể đã dùng nó).

- [ ] **Step 4: Tạo bảng + 6 method**

Trong `src/core/ledgerStore.ts`, thêm vào khối `this.db.exec(...)` tạo bảng (bảng **mới hoàn toàn** nên không cần migration — cùng lý do `user_commission_overrides`/`zalo_groups`):

```sql
      CREATE TABLE IF NOT EXISTS payout_debts (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        platform TEXT NOT NULL,
        user_id TEXT NOT NULL,
        merchant TEXT NOT NULL,
        order_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        remaining INTEGER NOT NULL,
        note TEXT,
        settled_at TEXT,
        written_off_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_payout_debts_order ON payout_debts(merchant, order_id);
      CREATE INDEX IF NOT EXISTS idx_payout_debts_user ON payout_debts(platform, user_id);
```

Thêm các method (đặt cạnh `requestWithdrawal`) + import `PayoutDebt` vào khối `import type`:

```ts
  /**
   * Ghi 1 khoan no do khach tra hang sau khi tien da ra khoi tay. Tra null khi don nay DA co no.
   *
   * ON CONFLICT DO NOTHING la chot song con, khong phai toi uu: bao cao Shopee liet ke LAI ca lich
   * su o moi lan import, nen don huy hom qua se lai hien "Da huy" hom nay - khong co no se nhan doi
   * moi ngay. Day dung cai bay ma order_status_events da phai dung INSERT OR IGNORE de tranh.
   */
  recordPayoutDebt(input: {
    platform: Platform;
    userId: string;
    merchant: MerchantId;
    orderId: string;
    amount: number;
    note?: string;
  }): PayoutDebt | null {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO payout_debts
          (id, created_at, platform, user_id, merchant, order_id, amount, remaining, note, settled_at, written_off_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
         ON CONFLICT(merchant, order_id) DO NOTHING`
      )
      .run(
        id,
        createdAt,
        input.platform,
        input.userId,
        input.merchant,
        input.orderId,
        input.amount,
        input.amount,
        input.note ?? null
      );
    if (result.changes === 0) return null;
    return this.getDebtByOrder(input.merchant, input.orderId);
  }

  getDebtByOrder(merchant: MerchantId, orderId: string): PayoutDebt | null {
    const row = this.db
      .prepare(`SELECT * FROM payout_debts WHERE merchant = ? AND order_id = ?`)
      .get(merchant, orderId);
    return row ? rowToPayoutDebt(row) : null;
  }

  /** No con phai tru: chua settled VA chua bi admin xoa. */
  listOutstandingDebts(platform: Platform, userId: string): PayoutDebt[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM payout_debts
         WHERE platform = ? AND user_id = ? AND settled_at IS NULL AND written_off_at IS NULL
         ORDER BY created_at ASC, rowid ASC`
      )
      .all(platform, userId);
    return rows.map(rowToPayoutDebt);
  }

  getOutstandingDebtTotal(platform: Platform, userId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(remaining), 0) AS total FROM payout_debts
         WHERE platform = ? AND user_id = ? AND settled_at IS NULL AND written_off_at IS NULL`
      )
      .get(platform, userId) as { total: number };
    return row.total;
  }

  /** Admin xoa no. GIU dong lai (chi dien written_off_at) de con doi soat duoc. */
  writeOffDebt(id: string): void {
    this.db
      .prepare(`UPDATE payout_debts SET written_off_at = ? WHERE id = ? AND written_off_at IS NULL`)
      .run(new Date().toISOString(), id);
  }

  /**
   * Xoa HAN dong no. Chi dung khi don hoa ra khong he mat tien (admin huy yeu cau rut truoc khi
   * chuyen khoan) - khac writeOffDebt() la "mat tien thuc nhung thoi khong doi".
   */
  deleteDebtByOrder(merchant: MerchantId, orderId: string): void {
    this.db.prepare(`DELETE FROM payout_debts WHERE merchant = ? AND order_id = ?`).run(merchant, orderId);
  }
```

Thêm mapper cạnh `rowToCommissionEntry`:

```ts
function rowToPayoutDebt(row: unknown): PayoutDebt {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    createdAt: r.created_at as string,
    platform: r.platform as Platform,
    userId: r.user_id as string,
    merchant: r.merchant as MerchantId,
    orderId: r.order_id as string,
    amount: r.amount as number,
    remaining: r.remaining as number,
    note: (r.note as string | null) ?? null,
    settledAt: (r.settled_at as string | null) ?? null,
    writtenOffAt: (r.written_off_at as string | null) ?? null,
  };
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx tsx --test src/core/__tests__/payoutDebt.test.ts && npm run typecheck`
Expected: PASS (5 test).

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/ledgerStore.ts src/core/__tests__/payoutDebt.test.ts
git commit -F - <<'EOF'
feat(ledger): bang payout_debts - no hoan tra khi khach tra hang sau khi da tra tien

UNIQUE(merchant, order_id) + ON CONFLICT DO NOTHING la chot song con: bao cao
Shopee liet ke lai ca lich su moi lan import nen don huy hom qua lai hien "Da
huy" hom nay, khong co no se nhan doi moi ngay.

writeOffDebt (mat tien that, thoi khong doi) khac deleteDebtByOrder (hoa ra
khong mat tien vi admin huy yeu cau rut kip).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Khả dụng trừ nợ + `debt_applied` + trừ nợ ở `markWithdrawalPaid`

**Files:**
- Modify: `src/core/types.ts` (`WithdrawalRequest.debtApplied`)
- Modify: `src/core/ledgerStore.ts` (migration, `getAvailableBalance`, `requestWithdrawal`, `markWithdrawalPaid`, `rowToWithdrawalRequest`)
- Test: `src/core/__tests__/payoutDebt.test.ts`

**Interfaces:**
- Consumes: Task 5 API.
- Produces:
  - `WithdrawalRequest.debtApplied: number`
  - `getAvailableBalance` giờ đã trừ nợ (floor 0)
  - `getGrossAvailableBalance(platform, userId): number` — số trước khi trừ nợ, dùng cho UI giải thích

Vì sao trừ nợ ở `markWithdrawalPaid` chứ không ở `requestWithdrawal`: nếu trừ lúc tạo yêu cầu thì `cancelWithdrawal` (Task 7) phải hoàn nợ lại đúng từng dòng — chỗ dễ sai nhất trên cả đường tiền. Trừ ở bước cuối thì cả 2 nhánh terminal (`paid`, `cancelled`) đều đơn giản. Không có cửa sổ đếm trùng: trong lúc withdrawal còn `requested`, mọi entry đã mở khoá đều đã bị gom nên gross = 0.

- [ ] **Step 1: Write the failing test**

Thêm vào `src/core/__tests__/payoutDebt.test.ts`:

```ts
const BANK = { bankName: "Vietcombank", bankAccountNumber: "0123456789", bankAccountHolder: "Nguyen Van A" };
const HOLD_OFF = { thresholdVnd: 0, holdDays: 0 };

function recordConfirmed(s: LedgerStore, orderId: string, commissionAmount: number) {
  return s.recordConversion({
    subId: "k-user-a-abc-def",
    platform: "zalo",
    userId: "user-a",
    merchant: "shopee",
    orderId,
    orderAmount: commissionAmount * 10,
    commissionAmount,
    taxPercent: 0,
    platformFeePercent: 0,
    userSharePercent: 100,
    maxCommissionRatioPercent: 50,
    holdConfig: HOLD_OFF,
  });
}

test("getAvailableBalance tru no, co floor 0 - KHONG BAO GIO am", () => {
  const s = store();
  recordConfirmed(s, "order-1", 10_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 40_000 });
  assert.equal(s.getAvailableBalance("zalo", "user-a"), 0, "10k - 40k phai la 0, khong phai -30k");
  assert.equal(s.getGrossAvailableBalance("zalo", "user-a"), 10_000);
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 40_000, "no van con nguyen 40k");
});

test("requestWithdrawal: amount = net, ghi debt_applied, CHUA tru no", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 40_000 });

  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);
  assert.equal(w.amount, 60_000, "100k - 40k");
  assert.equal(w.debtApplied, 40_000);
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 40_000, "no CHUA bi tru o buoc nay");
});

test("markWithdrawalPaid: tru no, dien settled_at khi remaining ve 0", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 40_000 });
  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);

  s.markWithdrawalPaid(w.id, null);
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 0);
  assert.ok(s.getDebtByOrder("shopee", "old-order")?.settledAt);
});

test("markWithdrawalPaid: tru no CU TRUOC, no moi con lai mot phan", () => {
  const s = store();
  recordConfirmed(s, "order-1", 50_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "debt-old", amount: 30_000 });
  s.recordPayoutDebt({ ...DEBT, orderId: "debt-new", amount: 30_000 });

  const w = s.requestWithdrawal("zalo", "user-a", 10_000, BANK);
  assert.equal(w.amount, 0 /* 50k - 60k -> floor 0 */);
  // net = 0 < nguong 10_000 -> dang le nem loi; test nay doi hanh vi o test duoi
});

test("no lon hon tien -> khong rut duoc (net duoi nguong)", () => {
  const s = store();
  recordConfirmed(s, "order-1", 10_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 40_000 });
  assert.throws(() => s.requestWithdrawal("zalo", "user-a", 10_000, BANK), /./);
});

test("tru no uu tien no CU nhat truoc", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "debt-old", amount: 30_000 });
  s.recordPayoutDebt({ ...DEBT, orderId: "debt-new", amount: 50_000 });

  const w = s.requestWithdrawal("zalo", "user-a", 10_000, BANK);
  assert.equal(w.amount, 20_000, "100k - 80k");
  s.markWithdrawalPaid(w.id, null);

  assert.ok(s.getDebtByOrder("shopee", "debt-old")?.settledAt, "no cu settled");
  assert.ok(s.getDebtByOrder("shopee", "debt-new")?.settledAt, "no moi cung settled");
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 0);
});

test("tru no mot phan: no con lai dung so du", () => {
  const s = store();
  recordConfirmed(s, "order-1", 50_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "debt-old", amount: 30_000 });
  s.recordPayoutDebt({ ...DEBT, orderId: "debt-new", amount: 40_000 });

  const w = s.requestWithdrawal("zalo", "user-a", 10_000, BANK);
  assert.equal(w.amount, 0, "50k - 70k -> 0");
  // net=0 duoi nguong 10_000 nen khong tao duoc yeu cau - xem test "no lon hon tien"
});
```

Xoá 2 test có comment "test nay doi hanh vi o test duoi" / trùng lặp phía trên trước khi chạy — chúng chỉ là ghi chú trong quá trình suy nghĩ. Bộ test cuối cùng gồm: floor 0, net + debtApplied, markPaid trừ nợ, nợ > tiền thì không rút được, ưu tiên nợ cũ.

Thay 2 test bị xoá bằng 1 test trừ nợ một phần có thể chạy thật:

```ts
test("tru no MOT PHAN: no con lai dung so du sau khi tra", () => {
  const s = store();
  recordConfirmed(s, "order-1", 50_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "debt-big", amount: 80_000 });
  // net = 0 -> khong rut duoc. Them tien cho du nguong.
  recordConfirmed(s, "order-2", 50_000);

  const w = s.requestWithdrawal("zalo", "user-a", 10_000, BANK);
  assert.equal(w.amount, 20_000, "100k - 80k");
  assert.equal(w.debtApplied, 80_000);

  s.markWithdrawalPaid(w.id, null);
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/core/__tests__/payoutDebt.test.ts`
Expected: FAIL — `getGrossAvailableBalance is not a function`, `w.debtApplied` undefined.

- [ ] **Step 3: Migration + type cho `debt_applied`**

Trong `src/core/types.ts`, thêm vào `WithdrawalRequest`:

```ts
  /**
   * So tien no hoan tra DA TRU khoi yeu cau nay (2026-10-08): amount = gross - debtApplied. Ghi luc
   * tao yeu cau nhung chi THUC SU tru vao payout_debts o markWithdrawalPaid() - nho vay
   * cancelWithdrawal() khong phai hoan no lai tung dong.
   */
  debtApplied: number;
```

Trong `ledgerStore.ts`, thêm cột vào `CREATE TABLE IF NOT EXISTS withdrawal_requests` (`debt_applied INTEGER NOT NULL DEFAULT 0`), thêm vào method migration mới gọi từ constructor:

```ts
  /** Cot cua tinh nang no hoan tra + huy yeu cau rut (2026-10-08). */
  private migrateAddWithdrawalDebtColumns(): void {
    const columns = this.db.prepare("PRAGMA table_info(withdrawal_requests)").all() as Array<{ name: string }>;
    const hasColumn = (name: string) => columns.some((c) => c.name === name);
    if (!hasColumn("debt_applied")) {
      this.db.exec("ALTER TABLE withdrawal_requests ADD COLUMN debt_applied INTEGER NOT NULL DEFAULT 0");
    }
    if (!hasColumn("cancelled_at")) {
      this.db.exec("ALTER TABLE withdrawal_requests ADD COLUMN cancelled_at TEXT");
    }
  }
```

(`cancelled_at` thêm luôn ở đây để Task 7 không cần migration thứ hai trên cùng bảng.)

Thêm `cancelled_at TEXT` vào `CREATE TABLE` và `debtApplied: r.debt_applied as number` + `cancelledAt: (r.cancelled_at as string | null) ?? null` vào `rowToWithdrawalRequest` (field `cancelledAt` vào type ở Task 7 — thêm cả 2 ngay bây giờ để tránh 2 lần sửa cùng hàm).

- [ ] **Step 4: Sửa `getAvailableBalance` + `requestWithdrawal` + `markWithdrawalPaid`**

Đổi tên phần SQL hiện tại của `getAvailableBalance` thành `getGrossAvailableBalance`, rồi:

```ts
  /**
   * Tien don da mo khoa, CHUA tru no hoan tra. Dung cho UI giai thich va cho phep tinh debt_applied.
   */
  getGrossAvailableBalance(platform: Platform, userId: string): number {
    /* SQL cu cua getAvailableBalance - xem Task 3 */
  }

  /**
   * Tien user rut duoc that su = don da mo khoa TRU no hoan tra, floor o 0.
   *
   * Floor la bat buoc: so am se chay vao moi the KPI, moi bieu do, va vao ca cau "Tich luy them X
   * nua" tren dashboard. No khong bao gio ep user chuyen tien ra - no ngoi do cho den khi co hoa
   * hong moi.
   */
  getAvailableBalance(platform: Platform, userId: string): number {
    const gross = this.getGrossAvailableBalance(platform, userId);
    return Math.max(0, gross - this.getOutstandingDebtTotal(platform, userId));
  }
```

Trong `requestWithdrawal()`: `const gross = this.getGrossAvailableBalance(...)`, `const debt = this.getOutstandingDebtTotal(...)`, `const balance = Math.max(0, gross - debt)`, `const debtApplied = Math.min(gross, debt)`. Giữ nguyên check `balance < thresholdVnd → InsufficientBalanceError`. Thêm `debt_applied` vào `INSERT` và vào object trả về.

Trong `markWithdrawalPaid()`, bên trong transaction đã có, **sau** 2 câu `UPDATE` hiện tại:

```ts
      // Tru no o DAY chu khong o requestWithdrawal: nho vay cancelWithdrawal() chi viec tha entry ra,
      // khong phai hoan no lai dung tung dong (cho de sai nhat tren ca duong tien).
      let left = (row as Record<string, unknown>).debt_applied as number;
      if (left > 0) {
        const debts = this.db
          .prepare(
            `SELECT id, remaining FROM payout_debts
             WHERE platform = ? AND user_id = ? AND settled_at IS NULL AND written_off_at IS NULL
             ORDER BY created_at ASC, rowid ASC`
          )
          .all(
            (row as Record<string, unknown>).platform as string,
            (row as Record<string, unknown>).user_id as string
          ) as Array<{ id: string; remaining: number }>;
        for (const debt of debts) {
          if (left <= 0) break;
          const take = Math.min(left, debt.remaining);
          const remaining = debt.remaining - take;
          this.db
            .prepare(`UPDATE payout_debts SET remaining = ?, settled_at = ? WHERE id = ?`)
            .run(remaining, remaining === 0 ? paidAt : null, debt.id);
          left -= take;
        }
      }
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. Nếu test cũ của `requestWithdrawal` fail vì thiếu `debtApplied` trong object so sánh, cập nhật expectation thành `debtApplied: 0`.

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/ledgerStore.ts src/core/__tests__/payoutDebt.test.ts
git commit -F - <<'EOF'
feat(ledger): Kha dung tru no hoan tra, tru that o markWithdrawalPaid

getAvailableBalance = gross - no, floor 0 (so am se chay vao moi the KPI va ca
cau "Tich luy them X nua"). getGrossAvailableBalance giu so truoc khi tru de UI
giai thich duoc.

No chi THUC SU bi tru o markWithdrawalPaid, khong o requestWithdrawal: nho vay
cancelWithdrawal chi viec tha entry ra, khong phai hoan no lai dung tung dong.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Huỷ yêu cầu rút

**Files:**
- Modify: `src/core/types.ts` (`WithdrawalStatus`, `WithdrawalRequest.cancelledAt`)
- Modify: `src/core/ledgerStore.ts` (`cancelWithdrawal`, audit query)
- Modify: `src/core/errors.ts` (`WithdrawalNotCancellableError`)
- Test: `src/core/__tests__/payoutDebt.test.ts`

**Interfaces:**
- Consumes: Task 6 (`cancelled_at` đã có cột).
- Produces:
  - `WithdrawalStatus = "requested" | "paid" | "cancelled"`
  - `WithdrawalRequest.cancelledAt: string | null`
  - `cancelWithdrawal(id: string, reason: string): WithdrawalRequest`
  - `listCancelledWithdrawals(limit?: number): WithdrawalRequest[]`
  - `listEntriesByWithdrawal(withdrawalId: string): CommissionEntry[]` — route cancel (Task 12) phải chụp danh sách entry **trước** khi huỷ, vì `cancelWithdrawal` xoá `withdrawal_id`
  - `class WithdrawalNotCancellableError extends AppError`

- [ ] **Step 1: Write the failing test**

```ts
test("cancelWithdrawal: tha entry ve confirmed/chua rut, KHONG cong vao tien da chi tra", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);

  const cancelled = s.cancelWithdrawal(w.id, "don bi tra hang");
  assert.equal(cancelled.status, "cancelled");
  assert.ok(cancelled.cancelledAt);

  assert.equal(s.getAvailableBalance("zalo", "user-a"), 100_000, "tien ve lai Kha dung");
  assert.equal(s.getPendingWithdrawal("zalo", "user-a"), null, "khong con yeu cau dang cho");
  assert.equal(s.getPaidWithdrawalTotal(), 0, "yeu cau da huy KHONG phai tien da chi tra");

  const entry = s.listCommissionEntries({ userId: "user-a" })[0];
  assert.equal(entry.status, "confirmed");
  assert.equal(entry.withdrawalId, null);
});

test("cancelWithdrawal: KHONG hoan no vi chua tung bi tru", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 40_000 });
  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);

  s.cancelWithdrawal(w.id, "test");
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 40_000, "no van dung 40k, khong nhan doi");
});

test("cancelWithdrawal: khong huy duoc yeu cau da tra", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);
  s.markWithdrawalPaid(w.id, null);
  assert.throws(() => s.cancelWithdrawal(w.id, "test"), /./);
});

test("sau khi huy, user gui lai yeu cau rut duoc", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  const first = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);
  s.cancelWithdrawal(first.id, "test");
  const second = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);
  assert.equal(second.amount, 100_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/core/__tests__/payoutDebt.test.ts`
Expected: FAIL — `cancelWithdrawal is not a function`.

- [ ] **Step 3: Thêm error class**

Trong `src/core/errors.ts`, theo đúng pattern các subclass đang có:

```ts
export class WithdrawalNotCancellableError extends AppError {
  constructor() {
    super(
      "WITHDRAWAL_NOT_CANCELLABLE",
      "Chỉ huỷ được yêu cầu rút đang chờ thanh toán."
    );
  }
}
```

Kiểm tra chữ ký constructor của `AppError` trong file đó và khớp theo (code + userMessage, có thể thêm `message` nội bộ).

- [ ] **Step 4: Type + method**

`src/core/types.ts`: `export type WithdrawalStatus = "requested" | "paid" | "cancelled";` và thêm vào `WithdrawalRequest`:

```ts
  /** Moc admin huy yeu cau (2026-10-08). Yeu cau da huy KHONG tinh vao bat ky tong tien nao. */
  cancelledAt: string | null;
```

`ledgerStore.ts`, cạnh `markWithdrawalPaid`:

```ts
  /**
   * Admin huy 1 yeu cau rut dang cho (2026-10-08) - dung khi bao cao Shopee ghi don trong yeu cau
   * nay da bi tra hang va admin CHUA chuyen khoan.
   *
   * KHONG hoan payout_debts: no chi bi tru o markWithdrawalPaid nen chua tung bi tru o day.
   */
  cancelWithdrawal(id: string, reason: string): WithdrawalRequest {
    const row = this.db.prepare(`SELECT * FROM withdrawal_requests WHERE id = ?`).get(id);
    if (!row) {
      throw new Error(`Khong tim thay yeu cau rut tien voi id "${id}"`);
    }
    const existing = rowToWithdrawalRequest(row);
    if (existing.status !== "requested") {
      throw new WithdrawalNotCancellableError();
    }

    const cancelledAt = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(`UPDATE withdrawal_requests SET status = 'cancelled', cancelled_at = ? WHERE id = ?`)
        .run(cancelledAt, id);
      // Tha entry ra: status van la 'confirmed' (chua bao gio doi), chi bo withdrawal_id.
      this.db.prepare(`UPDATE commission_entries SET withdrawal_id = NULL WHERE withdrawal_id = ?`).run(id);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }

    return { ...existing, status: "cancelled", cancelledAt };
  }

  listCancelledWithdrawals(limit = 50): WithdrawalRequest[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM withdrawal_requests WHERE status = 'cancelled'
         ORDER BY cancelled_at DESC, rowid DESC LIMIT ?`
      )
      .all(limit);
    return rows.map(rowToWithdrawalRequest);
  }
```

- [ ] **Step 5: Audit mọi query giả định chỉ có `requested`/`paid`**

Chạy `grep -n "requested\|'paid'" src/core/ledgerStore.ts` và kiểm từng chỗ. Kết luận bắt buộc: **yêu cầu `cancelled` không được cộng vào bất kỳ tổng tiền nào.** Các hàm phải kiểm: `getPendingWithdrawal` (đã lọc `status='requested'` → ok), `listPendingWithdrawals`, `listPaidWithdrawals` (đã lọc `'paid'` → ok), `getOutstandingTotals`, `getPaidWithdrawalTotal`, `getDashboardMoneyTotals`. Nếu hàm nào chỉ lọc `status != 'paid'` hoặc không lọc, thêm điều kiện rõ ràng.

Ghi lại kết luận của từng hàm trong commit message.

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/core/errors.ts src/core/ledgerStore.ts src/core/__tests__/payoutDebt.test.ts
git commit -F - <<'EOF'
feat(ledger): cancelWithdrawal - huy yeu cau rut dang cho

Truoc day withdrawal_requests chi di 1 chieu requested -> paid. Them trang thai
'cancelled' de admin huy duoc khi bao cao ghi don trong yeu cau da bi tra hang
ma CHUA chuyen khoan.

Huy chi tha withdrawal_id cua entry (status van la confirmed, chua bao gio doi)
va KHONG hoan payout_debts - no chi bi tru o markWithdrawalPaid.

Da audit moi query gia dinh chi co requested/paid: yeu cau cancelled khong cong
vao bat ky tong tien nao.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 8: `getUserSummary` / `listUsers` đọc tiền từ `withdrawal_requests`

**Files:**
- Modify: `src/core/ledgerStore.ts` (`getUserSummary`, `listUsers`)
- Modify: `src/core/ledgerStore.ts` (`UserLedgerSummary`)
- Test: `src/core/__tests__/payoutDebt.test.ts`

**Interfaces:**
- Produces:
  - `UserLedgerSummary` thêm `heldBalance: number`, `heldEntries: CommissionEntry[]`, `debtRemaining: number`, `grossAvailableBalance: number`
  - `listUsers()` row thêm `debtRemaining: number`, `heldBalance: number`

Sau Task 6, `withdrawal_requests.amount` (net) **nhỏ hơn** tổng `user_share_amount` của entry gắn vào nó khi có nợ. Mọi chỗ cộng theo entry phải chuyển sang cộng theo withdrawal.

- [ ] **Step 1: Write the failing test**

```ts
test("pendingBalance doc tu withdrawal_requests.amount (net), khong cong entry (gross)", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 40_000 });
  s.requestWithdrawal("zalo", "user-a", 20_000, BANK);

  const summary = s.getUserSummary("zalo", "user-a");
  assert.equal(summary.pendingBalance, 60_000, "so THAT se duoc chuyen, khong phai 100k");
});

test("paidTotal doc tu withdrawal_requests.amount (net)", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 40_000 });
  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);
  s.markWithdrawalPaid(w.id, null);

  const summary = s.getUserSummary("zalo", "user-a");
  assert.equal(summary.paidTotal, 60_000, "so THAT da vao tai khoan user");
});

test("getUserSummary tra them heldBalance/debtRemaining/grossAvailableBalance", () => {
  const s = store();
  recordConfirmed(s, "small", 10_000);
  s.recordConversion({
    subId: "k-user-a-abc-def",
    platform: "zalo",
    userId: "user-a",
    merchant: "shopee",
    orderId: "big",
    orderAmount: 3_000_000,
    commissionAmount: 300_000,
    taxPercent: 0,
    platformFeePercent: 0,
    userSharePercent: 100,
    maxCommissionRatioPercent: 50,
    completedAt: "2026-10-01",
    holdConfig: { thresholdVnd: 100_000, holdDays: 7 },
  });
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 4_000 });

  const summary = s.getUserSummary("zalo", "user-a");
  assert.equal(summary.heldBalance, 300_000);
  assert.equal(summary.heldEntries.length, 1);
  assert.equal(summary.heldEntries[0].availableFrom, "2026-10-08");
  assert.equal(summary.debtRemaining, 4_000);
  assert.equal(summary.grossAvailableBalance, 10_000);
  assert.equal(summary.availableBalance, 6_000);
});

test("listUsers tra debtRemaining va heldBalance", () => {
  const s = store();
  recordConfirmed(s, "order-1", 10_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 4_000 });
  const row = s.listUsers().find((u) => u.userId === "user-a");
  assert.equal(row?.debtRemaining, 4_000);
  assert.equal(row?.heldBalance, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/core/__tests__/payoutDebt.test.ts`
Expected: FAIL — `pendingBalance` là 100_000, `heldBalance` undefined.

- [ ] **Step 3: Implement**

`UserLedgerSummary` (trong `ledgerStore.ts`):

```ts
export interface UserLedgerSummary {
  entries: CommissionEntry[];
  /** So rut duoc that su = gross - no, floor 0. */
  availableBalance: number;
  /** Truoc khi tru no - de UI giai thich duoc con so da bi tru. */
  grossAvailableBalance: number;
  /** Tien da duoc Shopee duyet nhung con bi giam (2026-10-08). */
  heldBalance: number;
  heldEntries: CommissionEntry[];
  /** No hoan tra con phai tru. */
  debtRemaining: number;
  pendingBalance: number;
  paidTotal: number;
}
```

Trong `getUserSummary()`, thay 2 query `pendingRow`/`paidRow`:

```ts
    // Doc tu withdrawal_requests.amount chu KHONG cong user_share_amount cua entry: tu 2026-10-08
    // amount la so NET (da tru no hoan tra) nen nho hon tong entry gan vao no. Cong theo entry se
    // noi "dang cho chi tra 100k" trong khi yeu cau that la 60k.
    const pendingRow = this.db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM withdrawal_requests
         WHERE platform = ? AND user_id = ? AND status = 'requested'`
      )
      .get(platform, userId) as { total: number };

    const paidRow = this.db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM withdrawal_requests
         WHERE platform = ? AND user_id = ? AND status = 'paid'`
      )
      .get(platform, userId) as { total: number };
```

và trả về thêm 4 field mới.

Trong `listUsers()`, thêm 2 subquery vào `SELECT` (giữ `FROM commission_entries ce` + `GROUP BY` như cũ):

```sql
            COALESCE((SELECT SUM(pd.remaining) FROM payout_debts pd
              WHERE pd.platform = ce.platform AND pd.user_id = ce.user_id
                AND pd.settled_at IS NULL AND pd.written_off_at IS NULL), 0) AS debt_remaining,
            COALESCE(SUM(CASE WHEN ce.status = 'confirmed' AND ce.withdrawal_id IS NULL
              AND ce.available_from IS NOT NULL AND ce.available_from > :today
              THEN ce.user_share_amount ELSE 0 END), 0) AS held,
```

Và cột `available` hiện có phải loại đơn bị giam (thêm `AND (ce.available_from IS NULL OR ce.available_from <= :today)`) rồi trừ `debt_remaining` ở JS với `Math.max(0, ...)` — **không** trừ trong SQL, để quy tắc floor chỉ tồn tại ở một chỗ. Tương tự, `pending`/`paid` của `listUsers` đổi sang subquery trên `withdrawal_requests` cho khớp `getUserSummary`.

**Hệ quả phải xử cùng lúc: `ORDER BY available DESC` của SQL giờ sai.** Nó sắp theo số **gross** trong khi `availableBalance` trả về là số đã trừ nợ, mà `/admin/users` mặc định hiển thị "khả dụng giảm dần" (xem `CLAUDE.md`) — user có nợ sẽ đứng sai vị trí. Sort lại ở JS **sau** khi đã trừ:

```ts
    return rows
      .map((r) => ({ /* ...map, availableBalance: Math.max(0, r.available - r.debt_remaining) */ }))
      // Sap lai o JS vi ORDER BY cua SQL chi biet so gross - sap theo so DA TRU NO moi khop con so
      // hien tren trang. Tiebreak theo userId de thu tu on dinh giua cac lan goi.
      .sort((a, b) => b.availableBalance - a.availableBalance || a.userId.localeCompare(b.userId));
```

`node:sqlite` dùng tham số theo vị trí `?` — thay `:today` bằng `?` và truyền `todayVnIso()` đúng số lần xuất hiện.

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. Sửa mọi call site của `getUserSummary`/`listUsers` bị typecheck báo thiếu field.

- [ ] **Step 5: Commit**

```bash
git add src/core/ledgerStore.ts src/core/__tests__/payoutDebt.test.ts
git commit -F - <<'EOF'
fix(ledger): pendingBalance/paidTotal doc tu withdrawal_requests.amount

Tu khi co no hoan tra, amount cua withdrawal la so NET nen nho hon tong entry
gan vao no. Cong theo entry se noi "dang cho chi tra 100k" trong khi yeu cau
that la 60k, va "da nhan 100k" trong khi ngan hang chi di 60k.

getUserSummary/listUsers tra them heldBalance/debtRemaining/grossAvailableBalance.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 9: 4 setting mới + 2 biến env

**Files:**
- Modify: `src/core/settingsKeys.ts`
- Modify: `src/config/settingsRegistry.ts`
- Modify: `src/config/env.ts`, `.env.example`
- Modify: `src/core/ledgerStore.ts` (2 getter)
- Modify: `src/api/adminHtml.ts` (`settingsTabOf`)
- Test: `src/api/__tests__/adminRoutes.test.ts`

**Interfaces:**
- Produces:
  - `SETTINGS_KEYS.payoutHoldThresholdVnd`, `.payoutHoldDays`, `.payoutDebtNoticeTemplate`, `.withdrawalCancelledTemplate`
  - `LedgerStore.getPayoutHoldThresholdVnd(defaultValue: number): number`
  - `LedgerStore.getPayoutHoldDays(defaultValue: number): number`
  - `LedgerStore.getPayoutDebtNoticeTemplate(defaultValue: string): string`
  - `LedgerStore.getWithdrawalCancelledTemplate(defaultValue: string): string`
  - `env.payoutHold = { thresholdVnd: number; holdDays: number }`

- [ ] **Step 1: Write the failing test**

Thêm vào `src/api/__tests__/adminRoutes.test.ts` (theo pattern test `/admin/settings` đã có trong file):

```ts
test("GET /admin/settings hien 4 setting moi cua giam/no", async () => {
  // Dung helper dung san trong file nay de dang nhap admin roi GET /admin/settings.
  // Assert: html chua 'payout_hold_threshold_vnd', 'payout_hold_days',
  // 'payout_debt_notice_template', 'withdrawal_cancelled_template'.
});
```

Viết test này theo đúng helper/pattern đang có trong file (đọc 20 dòng đầu của file để lấy cách dựng app + đăng nhập). Assert bằng `assert.match(html, /payout_hold_threshold_vnd/)` cho cả 4 key.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/api/__tests__/adminRoutes.test.ts`
Expected: FAIL — không tìm thấy 4 key trong HTML.

- [ ] **Step 3: Thêm 4 key**

`src/core/settingsKeys.ts`:

```ts
  /** Nguong user_share bi giam truoc khi cho rut (2026-10-08) - xem payoutHold.ts. 0 = tat han. */
  payoutHoldThresholdVnd: "payout_hold_threshold_vnd",
  /** So ngay giam, dem tu ngay Shopee ghi don "Hoan thanh". */
  payoutHoldDays: "payout_hold_days",
  /** DM khi phat sinh no hoan tra (khach tra hang sau khi da tra tien). */
  payoutDebtNoticeTemplate: "payout_debt_notice_template",
  /** DM khi admin huy 1 yeu cau rut dang cho. */
  withdrawalCancelledTemplate: "withdrawal_cancelled_template",
```

- [ ] **Step 4: Thêm 2 template default vào `replyText.ts`**

```ts
/**
 * Cau "khong phai chuyen tien lai" la BAT BUOC chu khong phai cho lich su: nhan tin "ban dang no
 * 40.000d" ma khong co cau do thi user tuong phai tra tien ra.
 */
export const PAYOUT_DEBT_NOTICE_TEMPLATE_DEFAULT = `Đơn {{orderId}} đã được trả hàng nên Shopee thu lại hoa hồng của đơn này.
{{amount}} sẽ được trừ dần vào các đơn tới của bạn — bạn không phải chuyển tiền lại cho em nhé.
Xem chi tiết: {{dashboardUrl}}`;

/**
 * Cau "tien van nam nguyen trong so du" la BAT BUOC: cancelWithdrawal tha entry ve 'confirmed' nen
 * cau do dung, va khong noi ra thi user doc "yeu cau bi huy" thanh "mat tien".
 */
export const WITHDRAWAL_CANCELLED_TEMPLATE_DEFAULT = `Yêu cầu rút {{amount}} của bạn đã được huỷ, lí do: {{reason}}
Tiền vẫn nằm nguyên trong số dư của bạn, bạn gửi lại yêu cầu rút được nhé: {{dashboardUrl}}`;

export function formatPayoutDebtNotice(
  template: string,
  params: { orderId: string; amount: number; dashboardUrl: string }
): string {
  return renderTemplate(template, {
    orderId: params.orderId,
    amount: formatVnd(params.amount),
    dashboardUrl: params.dashboardUrl,
  });
}

export function formatWithdrawalCancelledReply(
  template: string,
  params: { amount: number; reason: string; dashboardUrl: string }
): string {
  return renderTemplate(template, {
    amount: formatVnd(params.amount),
    reason: params.reason,
    dashboardUrl: params.dashboardUrl,
  });
}
```

Dùng đúng `renderTemplate` và `formatVnd` đang được import trong file đó.

- [ ] **Step 5: Thêm 4 entry vào `SETTINGS_REGISTRY`**

Theo đúng hình dạng của entry đã có trong `src/config/settingsRegistry.ts`:

```ts
  {
    key: SETTINGS_KEYS.payoutHoldThresholdVnd,
    label: "Ngưỡng giam đơn to (đ)",
    type: "number",
    min: 0,
    defaultValue: () => String(env.payoutHold.thresholdVnd),
    helpText:
      "Đơn có tiền user nhận từ mức này trở lên sẽ bị giam trước khi cho rút. Đặt 0 để tắt hẳn việc giam. Không có placeholder động.",
  },
  {
    key: SETTINGS_KEYS.payoutHoldDays,
    label: "Số ngày giam đơn to",
    type: "number",
    min: 0,
    max: 60,
    defaultValue: () => String(env.payoutHold.holdDays),
    helpText:
      "Đếm từ ngày Shopee ghi đơn Hoàn thành (= ngày giao hàng), đúng mốc Shopee đếm 15 ngày được trả hàng. Ngày mở khoá được chốt lúc đơn chuyển Khả dụng — đổi số này không dịch ngày của đơn đã chốt. Không có placeholder động.",
  },
  {
    key: SETTINGS_KEYS.payoutDebtNoticeTemplate,
    label: "Tin nhắn khi đơn bị trả hàng (đã trả tiền)",
    type: "textarea",
    defaultValue: () => PAYOUT_DEBT_NOTICE_TEMPLATE_DEFAULT,
    helpText: "Placeholder hợp lệ: {{orderId}}, {{amount}}, {{dashboardUrl}}",
  },
  {
    key: SETTINGS_KEYS.withdrawalCancelledTemplate,
    label: "Tin nhắn khi huỷ yêu cầu rút",
    type: "textarea",
    defaultValue: () => WITHDRAWAL_CANCELLED_TEMPLATE_DEFAULT,
    helpText: "Placeholder hợp lệ: {{amount}}, {{reason}}, {{dashboardUrl}}",
  },
```

Đọc 1 entry number và 1 entry textarea đang có để khớp chính xác tên field (`defaultValue` có thể là giá trị trực tiếp thay vì hàm).

Cú pháp `helpText` quan trọng: chip "bấm để chèn biến" trên `/admin/settings` **tự sinh** bằng cách quét `{{...}}` trong câu "Placeholder hợp lệ: ..." của `helpText` (xem `extractPlaceholders()`). Viết sai cú pháp đó là mất chip. Field không có placeholder thì phải ghi "Không có placeholder động".

- [ ] **Step 6: env + getter + tab**

`src/config/env.ts`:

```ts
  payoutHold: {
    thresholdVnd: optionalInt("PAYOUT_HOLD_THRESHOLD_VND", 100_000),
    holdDays: optionalInt("PAYOUT_HOLD_DAYS", 7),
  },
```

`.env.example` (kèm comment giải thích, theo style các biến khác):

```
# Giam tien don to truoc khi cho rut (2026-10-08). Chi la gia tri khoi tao -
# admin doi duoc ngay tai /admin/settings khong can restart.
# Dat 0 de tat han viec giam.
PAYOUT_HOLD_THRESHOLD_VND=100000
PAYOUT_HOLD_DAYS=7
```

`ledgerStore.ts`, cạnh `getWithdrawalThresholdVnd`, theo đúng pattern của nó:

```ts
  getPayoutHoldThresholdVnd(defaultValue: number): number { /* nhu getWithdrawalThresholdVnd */ }
  getPayoutHoldDays(defaultValue: number): number { /* nhu tren */ }
  getPayoutDebtNoticeTemplate(defaultValue: string): string { /* nhu getWithdrawalPaidTemplate */ }
  getWithdrawalCancelledTemplate(defaultValue: string): string { /* nhu tren */ }
```

`adminHtml.ts` → `settingsTabOf()`: 2 key số vào tab "Hoa hồng & rút tiền", 2 key template vào tab "Mẫu tin nhắn bot".

- [ ] **Step 7: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core/settingsKeys.ts src/config/settingsRegistry.ts src/config/env.ts .env.example src/core/ledgerStore.ts src/adapters/shared/replyText.ts src/api/adminHtml.ts src/api/__tests__/adminRoutes.test.ts
git commit -F - <<'EOF'
feat(settings): 4 setting cho giam don to + no hoan tra

2 so (nguong + so ngay giam) va 2 template DM. Dat nguong = 0 de tat han viec
giam, cung pattern PROMOTIONS_DISPLAY_LIMIT=0.

helpText viet dung cu phap "Placeholder hop le: ..." de chip bam-de-chen-bien
tren /admin/settings tu sinh duoc (extractPlaceholders quet {{...}} trong do).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 10: Đọc cột `Thời gian hoàn thành` từ báo cáo

**Files:**
- Modify: `src/core/shopeeReportImport.ts` (`parseShopeeOrderDate` → `parseShopeeReportDay`, `ShopeeReportRow`, `mergeOrderRows`)
- Test: `src/core/__tests__/shopeeReportOrderDate.test.ts`

**Interfaces:**
- Produces:
  - `parseShopeeReportDay(raw: string | undefined): string | null` (đổi tên từ `parseShopeeOrderDate`)
  - `ShopeeReportRow.completedAt: string | null` và order đã merge có `completedAt: string | null`

- [ ] **Step 1: Write the failing test**

Thêm vào `src/core/__tests__/shopeeReportOrderDate.test.ts` (và đổi import sang tên mới):

```ts
test("doc cot 'Thời gian hoàn thành' vao completedAt", () => {
  // CSV 2 dong: 1 don "Hoàn thành" co thoi gian hoan thanh, 1 don pending de trong.
  // Dung helper dung CSV da co trong file nay (hoac trong shopeeReportImport.test.ts).
  // Assert: order "Hoàn thành" co completedAt === "2026-09-26", order pending co completedAt === null.
});

test("don gop nhieu dong: completedAt lay ngay MUON NHAT trong cac dong khong bi huy", () => {
  // 1 ma don, 2 dong "Hoàn thành" voi thoi gian hoan thanh 2026-09-26 va 2026-09-28.
  // Assert: completedAt === "2026-09-28".
  // Nguoc voi orderDate (lay som nhat) va co chu dich: cua so tra hang cua ca don chi dong khi mon
  // giao cuoi cung da het han tra.
});

test("thieu/sai dinh dang cot hoan thanh -> completedAt null, KHONG lam fail don", () => {
  // Dong co "Thời gian hoàn thành" = "30/09/2026" (dinh dang khac) -> completedAt null nhung don
  // VAN duoc ghi nhan (confirmedNew === 1).
});
```

Viết 3 test này bằng cách đọc helper dựng CSV đang có trong `shopeeReportImport.test.ts` và tái dùng đúng helper đó (đừng tự viết parser CSV mới trong test).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/core/__tests__/shopeeReportOrderDate.test.ts`
Expected: FAIL — `completedAt` undefined.

- [ ] **Step 3: Đổi tên hàm**

```bash
grep -rn "parseShopeeOrderDate" src/
```

Đổi mọi chỗ sang `parseShopeeReportDay`, và cập nhật doc comment của hàm:

```ts
/**
 * Doc 1 cot ngay cua bao cao Shopee -> "YYYY-MM-DD" (gio VN), bo phan gio. Tra null khi thieu/sai
 * dinh dang: day la cot THONG KE, khong duoc quyen lam hong viec ghi nhan hoa hong (bang tien).
 * KHONG doan dinh dang khac ("30/09/2026" co the la dd/mm hoac mm/dd tuy locale may xuat file -
 * doan sai se lech ngay am tham ca thang).
 *
 * Ham nay phuc vu CA 2 cot ngay dang doc: "Thời Gian Đặt Hàng" (-> order_date) va "Thời gian hoàn
 * thành" (-> completed_at). Luu y Shopee viet HOA "G"/"H" o cot dau nhung viet thuong o cot sau -
 * da doi chieu file that, dung "sua lai cho dong nhat".
 */
export function parseShopeeReportDay(raw: string | undefined): string | null {
```

- [ ] **Step 4: Đọc cột mới**

Thêm `completedAt: string | null` vào `ShopeeReportRow` và vào type của order đã merge. Chỗ đang đọc `Thời Gian Đặt Hàng`, thêm:

```ts
    completedAt: parseShopeeReportDay(row["Thời gian hoàn thành"]),
```

Trong `mergeOrderRows()`, gộp theo quy tắc **muộn nhất trong các dòng không bị huỷ**:

```ts
  // Nguoc voi orderDate (lay SOM nhat) va co chu dich: cua so tra hang cua ca don chi dong khi mon
  // giao CUOI CUNG da het han tra. Dong bi huy luon trong cot nay (da doi chieu file that) va da bi
  // loai khoi tong nen khong tinh vao day.
  const completedAt = rows
    .filter((r) => !isCancelledRow(r) && r.completedAt !== null)
    .reduce<string | null>((latest, r) => (latest === null || r.completedAt! > latest ? r.completedAt! : latest), null);
```

Dùng đúng tên hàm/biến phân loại dòng huỷ đang có trong file (đọc `classifyRowStatus`/`mergeOrderRows` trước khi viết).

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/shopeeReportImport.ts src/core/__tests__/
git commit -F - <<'EOF'
feat(import): doc cot "Thời gian hoàn thành" -> completedAt

Doi ten parseShopeeOrderDate -> parseShopeeReportDay: nay no phuc vu 2 cot ngay,
giu ten cu la gay hieu sai ngay cho de nham nhat (Shopee viet hoa G/H o cot dat
hang nhung viet thuong o cot hoan thanh).

Don gop nhieu dong lay ngay hoan thanh MUON NHAT trong cac dong khong bi huy -
nguoc voi orderDate (som nhat) vi cua so tra hang cua ca don chi dong khi mon
giao cuoi cung da het han tra.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 11: Bảng quyết định nhánh "Đã hủy" + 2 counter

**Files:**
- Modify: `src/core/shopeeReportImport.ts` (nhánh `targetStatus === "reversed"`, nhánh confirm, `ShopeeReportImportResult`)
- Modify: `src/core/orderIngest.ts` (`RecordOrderConfig` + truyền `holdConfig`)
- Test: `src/core/__tests__/shopeeReportImport.test.ts`

**Interfaces:**
- Consumes: `recordPayoutDebt` (Task 5), `getPendingWithdrawal` / `cancelWithdrawal` (Task 7), `holdConfig` (Task 3).
- Produces:
  - `ShopeeReportImportResult.heldCount: number`, `.debtCreatedCount: number`
  - `ShopeeReportImportResult.debtsByUser: Array<{ platform: Platform; userId: string; orderId: string; amount: number }>` — để route web gửi DM
  - `RecordOrderConfig.holdConfig: PayoutHoldConfig`

Bảng quyết định (từ spec §4):

| Trạng thái entry | Hành động | Mất tiền |
| --- | --- | --- |
| `pending` | `reverseCommissionEntry` (như hiện nay) | không |
| `confirmed`, `withdrawal_id IS NULL` *(kể cả đang bị giam)* | `reverseCommissionEntry` | **không** |
| `confirmed`, nằm trong withdrawal `requested` | `recordPayoutDebt` + cảnh báo admin | có, trừ khi admin huỷ |
| `paid` | `recordPayoutDebt` + DM user | có |
| `reversed` | bỏ qua | — |

- [ ] **Step 1: Write the failing test**

Thêm vào `src/core/__tests__/shopeeReportImport.test.ts`:

```ts
test("don 'Da huy' ma entry confirmed CHUA rut -> reverse, KHONG sinh no (thu hoi tron)", () => {
  // Setup: import bao cao 1 lan cho don X "Hoàn thành" -> entry confirmed.
  // Import lan 2 cung don X nhung "Đã hủy".
  // Assert: entry.status === "reversed"; result.reversedCount === 1;
  //         result.debtCreatedCount === 0; getOutstandingDebtTotal === 0.
});

test("don 'Da huy' ma entry confirmed DANG BI GIAM -> van reverse, khong no", () => {
  // Nhu tren nhung don to + holdConfig bat -> entry co available_from tuong lai.
  // Assert: status === "reversed", debtCreatedCount === 0.
});

test("don 'Da huy' ma entry da 'paid' -> sinh no, status VAN la 'paid'", () => {
  // Setup: entry confirmed -> requestWithdrawal -> markWithdrawalPaid -> entry 'paid'.
  // Import "Đã hủy".
  // Assert: entry.status === "paid" (KHONG doi);
  //         result.debtCreatedCount === 1;
  //         getOutstandingDebtTotal === user_share_amount cua don do;
  //         result.debtsByUser co 1 phan tu dung platform/userId/orderId/amount.
});

test("don 'Da huy' ma entry dang trong yeu cau rut 'requested' -> sinh no + canh bao", () => {
  // Setup: entry confirmed -> requestWithdrawal (chua mark paid).
  // Import "Đã hủy".
  // Assert: result.debtCreatedCount === 1; result.errors co 1 dong nhac den ma don.
});

test("import LAI cung bao cao huy 2 lan -> no KHONG nhan doi", () => {
  // Import "Đã hủy" 2 lan lien tiep tren entry 'paid'.
  // Assert: getOutstandingDebtTotal khong doi sau lan 2; lan 2 debtCreatedCount === 0.
});

test("heldCount dem so don MOI bi giam", () => {
  // Import bao cao co 1 don to (user_share >= nguong) + 1 don nho.
  // Assert: result.heldCount === 1.
});
```

Viết chi tiết từng test bằng helper dựng CSV + `LedgerStore(":memory:")` + `LogStore(":memory:")` đang dùng trong file đó.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/core/__tests__/shopeeReportImport.test.ts`
Expected: FAIL — entry `confirmed` không bị reverse (chỉ có dòng warning), `debtCreatedCount` undefined.

- [ ] **Step 3: Thêm counter vào result**

```ts
  /** Don MOI bi giam vi user_share >= nguong (2026-10-08) - xem payoutHold.ts. */
  heldCount: number;
  /** Don phat sinh NO hoan tra trong lan import nay (tien da ra khoi tay roi khach moi tra hang). */
  debtCreatedCount: number;
  /** Chi tiet no vua sinh - route web dung de DM user. */
  debtsByUser: Array<{ platform: Platform; userId: string; orderId: string; amount: number }>;
```

Khởi tạo `heldCount: 0, debtCreatedCount: 0, debtsByUser: []` cùng chỗ khởi tạo các counter khác.

- [ ] **Step 4: Viết lại nhánh `reversed`**

Thay khối `if (existing.status !== "pending") { ... continue; }` bằng:

```ts
      // Ba ca khac nhau han nhau ve TIEN, khong duoc gop (xem spec muc 4):
      //  - confirmed + chua nam trong yeu cau rut: tien con trong tay -> thu hoi TRON, khong no.
      //    (Ke ca don dang bi giam: hold da lam dung viec cua no.)
      //  - confirmed + da nam trong yeu cau rut 'requested': tien chua di nhung admin co the da
      //    chuyen khoan ma chua bam "da tra" -> ghi no NGAY (mac dinh an toan, so van khop) va canh
      //    bao admin de ho co co hoi huy yeu cau neu chua chuyen.
      //  - paid: tien da di that -> ghi no + DM user.
      if (existing.status === "reversed") continue;

      if (existing.status === "confirmed" && existing.withdrawalId === null) {
        try {
          ledgerStore.reverseCommissionEntry(existing.id, reverseReason);
          result.reversedCount += 1;
          result.statusTransitions.push({ orderId, from: "confirmed", to: "reversed" });
          ledgerStore.recordOrderStatusEvent(requestEntry.merchant, orderId, "reversed", importDay);
        } catch (err) {
          const msg = err instanceof AppError ? err.userMessage : (err as Error).message;
          result.errors.push(`[${orderId}] ${msg}`);
        }
        continue;
      }

      if (existing.status === "confirmed" || existing.status === "paid") {
        const debt = ledgerStore.recordPayoutDebt({
          platform: existing.platform,
          userId: existing.userId,
          merchant: existing.merchant,
          orderId,
          amount: existing.userShareAmount,
          note: reverseReason,
        });
        ledgerStore.recordOrderStatusEvent(requestEntry.merchant, orderId, "reversed", importDay);
        if (debt) {
          result.debtCreatedCount += 1;
          result.debtsByUser.push({
            platform: existing.platform,
            userId: existing.userId,
            orderId,
            amount: existing.userShareAmount,
          });
        }
        if (existing.status === "confirmed") {
          // Tien CHUA di - admin con co thi huy yeu cau rut de khoi mat. Canh bao nay la co hoi lam
          // tot hon, khong phai dieu kien de dung: no da duoc ghi nen so van khop du admin bo qua.
          result.errors.push(
            `[${orderId}] Don bi tra hang nhung dang nam trong 1 yeu cau rut CHUA thanh toan - da ghi no. Neu CHUA chuyen khoan, vao /admin/withdrawals huy yeu cau do de khoi mat tien.`
          );
        }
        continue;
      }

      if (existing.status !== "pending") continue;
```

với `const reverseReason = \`Bao cao Shopee ghi trang thai san pham lien ket = "${order.rawStatusLabel}"\`;` khai báo trước khối (dùng lại cho cả nhánh `pending` phía dưới).

- [ ] **Step 5: Truyền `holdConfig` + đếm `heldCount`**

`src/core/orderIngest.ts`: thêm `holdConfig: PayoutHoldConfig` vào `RecordOrderConfig`, và truyền `holdConfig: config.holdConfig` + `completedAt: null` vào `recordConversion` trong `recordSingleOrder` (form "Ghi 1 đơn lẻ" không có trường ngày giao hàng, nên `completedAt` là `null` và `resolveAvailableFrom` tự lùi về hôm nay).

`shopeeReportImport.ts`: truyền `completedAt: order.completedAt` và `holdConfig: recordOrderConfig.holdConfig` vào **cả** `recordConversion` và `confirmPendingEntry`. Sau mỗi lần ghi/duyệt thành công:

```ts
        if (entry.availableFrom !== null) result.heldCount += 1;
```

Nơi dựng `RecordOrderConfig` (grep `maxCommissionRatioPercent:` trong `src/api/server.ts`, `src/scripts/ledgerAdmin.ts`, `src/index.ts`) phải thêm:

```ts
    holdConfig: {
      thresholdVnd: ledgerStore.getPayoutHoldThresholdVnd(env.payoutHold.thresholdVnd),
      holdDays: ledgerStore.getPayoutHoldDays(env.payoutHold.holdDays),
    },
```

Đọc từ `ledgerStore` chứ không từ `env` trực tiếp: admin đổi ở `/admin/settings` phải có hiệu lực ngay không cần restart.

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/shopeeReportImport.ts src/core/orderIngest.ts src/core/__tests__/
git commit -F - <<'EOF'
feat(import): bang quyet dinh day du cho nhanh "Da huy"

Truoc day chi ca 'pending' duoc xu li; 4 ca con lai roi het vao 1 dong warning,
nen entry confirmed CHUA rut cung khong bi reverse - tien LAY LAI DUOC ma van
mat. Gio:
  confirmed + chua trong yeu cau rut (ke ca dang bi giam) -> reverse, khong no
  confirmed + trong yeu cau rut 'requested'               -> ghi no + canh bao
  paid                                                     -> ghi no + DM user

Ghi no NGAY o ca thu 2 thay vi cho admin quyet la mac dinh an toan: admin bo qua
canh bao thi so van khop, khong ro ri.

Them heldCount/debtCreatedCount vao ket qua import - de nam trong result.errors
thi lan vao cac canh bao khac va khong ai de y, dung cai benh dang di chua.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 12: Route huỷ yêu cầu rút + xoá nợ + DM

**Files:**
- Modify: `src/api/server.ts`
- Test: `src/api/__tests__/adminRoutes.test.ts`

**Interfaces:**
- Consumes: `cancelWithdrawal`, `writeOffDebt`, `deleteDebtByOrder`, `getDebtByOrder` (Task 5/7); `formatPayoutDebtNotice`, `formatWithdrawalCancelledReply` (Task 9); `result.debtsByUser` (Task 11).
- Produces:
  - `POST /admin/withdrawals/:id/cancel` — body `reason` (optional, default "Đơn hàng bị trả lại")
  - `POST /admin/users/:platform/:userId/debts/:debtId/write-off`

- [ ] **Step 1: Write the failing test**

```ts
test("POST /admin/withdrawals/:id/cancel: huy yeu cau, tien ve Kha dung, DM user", async () => {
  // Setup: entry confirmed -> requestWithdrawal. Dang nhap admin.
  // POST /admin/withdrawals/<id>/cancel
  // Assert: 303 redirect /admin/withdrawals;
  //         ledgerStore.getAvailableBalance(...) === so cu;
  //         notifyUser spy duoc goi 1 lan voi text chua "đã được huỷ".
});

test("POST /admin/withdrawals/:id/cancel tren yeu cau da tra -> 422", async () => {
  // Assert: status 422, khong doi gi trong DB.
});

test("POST .../debts/:debtId/write-off: xoa no, Kha dung tang lai", async () => {
  // Setup: entry confirmed 10k + no 4k -> available 6k.
  // POST write-off -> available 10k.
});
```

Dùng đúng helper dựng app + spy `notifyUser` đang có trong `adminRoutes.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/api/__tests__/adminRoutes.test.ts`
Expected: FAIL — 404 cho cả 2 route.

- [ ] **Step 3: Thêm route cancel**

Đặt ngay sau route `mark-paid` trong `src/api/server.ts`, theo đúng pattern của nó (`requireAdminAuth`, try/catch trả 422 bằng `renderWithdrawalsPage`):

```ts
  app.post("/admin/withdrawals/:id/cancel", requireAdminAuth, (req: Request, res: Response) => {
    try {
      const reason =
        typeof req.body?.reason === "string" && req.body.reason.trim()
          ? req.body.reason.trim()
          : "Đơn hàng bị trả lại";
      // Phai chup danh sach entry TRUOC khi huy: cancelWithdrawal() set withdrawal_id = NULL nen sau
      // do khong con cach nao biet entry nao thuoc yeu cau vua huy. Loc bang status === "confirmed"
      // tren TOAN BO entry cua user thi hien tai vo tinh dung (moi user chi co 1 yeu cau 'requested',
      // entry 'paid' bi status chan) - nhung do la dung-do-may, khong phai dung-do-thiet-ke.
      const entriesInWithdrawal = ledgerStore.listEntriesByWithdrawal(req.params.id);
      const cancelled = ledgerStore.cancelWithdrawal(req.params.id, reason);

      // Don bi tra hang nam trong yeu cau nay: gio tien CHUA di nen khong con la no - reverse entry
      // va xoa HAN dong no (khac writeOffDebt la "mat tien that nhung thoi khong doi").
      for (const entry of entriesInWithdrawal) {
        const debt = ledgerStore.getDebtByOrder(entry.merchant, entry.orderId);
        if (!debt || debt.settledAt || debt.writtenOffAt) continue;
        ledgerStore.reverseCommissionEntry(entry.id, `Huy yeu cau rut: ${reason}`);
        ledgerStore.deleteDebtByOrder(entry.merchant, entry.orderId);
      }

      const { token } = ledgerStore.findOrCreateDashboardToken(cancelled.platform, cancelled.userId);
      notifyUser(cancelled.platform, cancelled.userId, {
        text: formatWithdrawalCancelledReply(
          ledgerStore.getWithdrawalCancelledTemplate(WITHDRAWAL_CANCELLED_TEMPLATE_DEFAULT),
          { amount: cancelled.amount, reason, dashboardUrl: `${dashboardBaseUrl}/d/${token}` }
        ),
      }).catch((notifyErr) => {
        console.warn("[user-notify] gui thong bao huy yeu cau rut that bai:", notifyErr);
      });

      res.redirect(303, "/admin/withdrawals");
    } catch (err) {
      const message = err instanceof AppError ? err.userMessage : "Lỗi không xác định, vui lòng thử lại sau.";
      res
        .status(422)
        .type("html")
        .send(
          renderWithdrawalsPage(
            ledgerStore.listPendingWithdrawals(),
            ledgerStore.listPaidWithdrawals(),
            ledgerStore.getDisplayNamesMap(),
            message
          )
        );
    }
  });
```

- [ ] **Step 4: Route write-off**

```ts
  app.post(
    "/admin/users/:platform/:userId/debts/:debtId/write-off",
    requireAdminAuth,
    (req: Request, res: Response) => {
      if (!VALID_PLATFORMS.includes(req.params.platform as Platform)) {
        res.status(404).type("html").send("Không tìm thấy kênh này.");
        return;
      }
      ledgerStore.writeOffDebt(req.params.debtId);
      res.redirect(303, "/admin/users");
    }
  );
```

Dùng đúng tên hằng `VALID_PLATFORMS` và cách trả 404 đang dùng ở 3 route `/admin/users/:platform/:userId/commission`.

- [ ] **Step 5: DM khi import sinh nợ**

Trong route `POST /admin/record-orders/shopee-report`, sau khi import xong và **sau** khi đã gửi thông báo đơn confirmed, thêm:

```ts
      // Best-effort, khong lam fail response upload: don da ghi no trong DB roi.
      const debtTemplate = ledgerStore.getPayoutDebtNoticeTemplate(PAYOUT_DEBT_NOTICE_TEMPLATE_DEFAULT);
      for (const debt of result.debtsByUser) {
        const { token } = ledgerStore.findOrCreateDashboardToken(debt.platform, debt.userId);
        notifyUser(debt.platform, debt.userId, {
          text: formatPayoutDebtNotice(debtTemplate, {
            orderId: debt.orderId,
            amount: debt.amount,
            dashboardUrl: `${dashboardBaseUrl}/d/${token}`,
          }),
        }).catch((notifyErr) => {
          console.warn("[user-notify] gui thong bao don bi tra hang that bai:", notifyErr);
        });
      }
```

**Chỉ ở route web**, không ở CLI `record-shopee-report` — cùng lý do cũ: rủi ro `DuplicateConnection` với bot thật đang đăng nhập.

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/api/server.ts src/api/__tests__/adminRoutes.test.ts
git commit -F - <<'EOF'
feat(admin): route huy yeu cau rut + xoa no + DM khi don bi tra hang

Huy yeu cau rut con reverse don bi tra hang va xoa HAN dong no cua no: luc nay
tien chua di nen khong con la no (khac writeOffDebt = mat tien that nhung thoi
khong doi).

DM "don bi tra hang" CHI gui tu route web, khong tu CLI - rui ro
DuplicateConnection voi bot that dang dang nhap.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 13: Dashboard user — 2 dòng số mới + form rút hiện số bị trừ

**Files:**
- Modify: `src/api/dashboardHtml.ts`
- Modify: `src/api/server.ts` (truyền field mới vào `renderDashboardPage`)
- Test: `src/api/__tests__/dashboardRoutes.test.ts`

**Interfaces:**
- Consumes: `UserLedgerSummary` đã mở rộng (Task 8).
- Produces: input của `renderDashboardPage` thêm `heldBalance`, `heldEntries`, `debtRemaining`, `grossAvailableBalance`.

- [ ] **Step 1: Write the failing test**

```ts
test("dashboard: khong co don bi giam / khong no -> KHONG hien 2 dong moi", async () => {
  // Assert: html KHONG chua "Đang giữ" va KHONG chua "Đã trừ hoàn trả".
  // Hien "0đ" cho user chua bao gio bi giam la tao lo lang ve mot luat khong ap dung cho ho.
});

test("dashboard: co don bi giam -> hien 'Đang giữ' + ngay mo khoa cua TUNG don", async () => {
  // Assert: html chua "Đang giữ", chua so tien, va chua "08/10" (ngay mo khoa cua don do).
});

test("dashboard: co no -> hien 'Đã trừ hoàn trả' TREN dong Kha dung, mang dau tru", async () => {
  // Assert: vi tri cua "Đã trừ hoàn trả" trong html NHO HON vi tri cua "Khả dụng";
  //         va co dau "−" truoc so tien no.
  const posDebt = html.indexOf("Đã trừ hoàn trả");
  const posAvail = html.indexOf("Khả dụng");
  assert.ok(posDebt > -1 && posDebt < posAvail, "dong no phai nam TREN Kha dung");
});

test("form rut hien so bi tru truoc khi user bam gui", async () => {
  // Setup: gross 100k, no 40k, nguong 20k.
  // Assert: html chua ca "100.000" (gross) lan "40.000" (no) lan "60.000" (nhan duoc).
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/api/__tests__/dashboardRoutes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Trong `src/api/dashboardHtml.ts`, mở rộng interface input với 4 field, rồi thêm vào khối `.stat` (hiện ở ~dòng 472) — **thứ tự bắt buộc**: `Chờ xác nhận` → `Đang giữ` → `Đã trừ hoàn trả` → `Khả dụng`:

```ts
  // Thu tu va cach goi ten la BAT BUOC, khong phai tham my: availableBalance DA la so net (da tru
  // no), nen neu dat dong no DUOI no va goi la "Dang tru lai" thi user doc ra "32.000d nay con bi
  // tru 40.000d nua" - hieu sai theo huong TE HON thuc te. Vi vay: dong no nam TREN Kha dung, mang
  // dau tru, ten o the DA HOAN THANH, va Kha dung co chu thich "da tru o tren".
  const heldRow =
    input.heldBalance > 0
      ? `<div class="stat warning"><div class="label">Đang giữ</div><div class="value">${formatVnd(input.heldBalance)}</div><div class="hint">${input.heldEntries
          .map((e) => `mở khoá ${formatVnDateDdMm(new Date(`${e.availableFrom}T00:00:00Z`))}`)
          .join(" · ")}</div></div>`
      : "";
  const debtRow =
    input.debtRemaining > 0
      ? `<div class="stat danger"><div class="label">Đã trừ hoàn trả</div><div class="value">−${formatVnd(input.debtRemaining)}</div><div class="hint">đơn đã trả hàng, trừ dần vào các đơn tới</div></div>`
      : "";
```

Và dòng `Khả dụng` thêm hint `đã trừ ở trên` **chỉ khi** `input.debtRemaining > 0`.

Trong nhánh form rút (hiện ở ~dòng 417/433), khi `input.debtRemaining > 0` thêm một dòng giải thích trước nút submit:

```ts
`<p class="note">Số dư ${formatVnd(input.grossAvailableBalance)} trừ ${formatVnd(input.debtRemaining)} đã hoàn trả — bạn sẽ nhận ${formatVnd(input.availableBalance)}.</p>`
```

Dùng đúng tên class CSS đang có trong file (`.stat accent/info/success` → kiểm xem có `warning`/`danger` chưa, nếu chưa thì thêm vào `<style>` của file này theo đúng cách 3 class kia được định nghĩa).

Trong `server.ts`, mọi chỗ gọi `renderDashboardPage` truyền thêm 4 field từ `summary`.

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/dashboardHtml.ts src/api/server.ts src/api/__tests__/dashboardRoutes.test.ts
git commit -F - <<'EOF'
feat(dashboard): hien "Dang giu" va "Da tru hoan tra"

Thu tu va cach goi ten la rang buoc chu khong phai tham my: Kha dung DA la so
net, nen dat dong no DUOI no va goi "Dang tru lai" thi user doc ra "so nay con
bi tru nua" - hieu sai theo huong te hon thuc te. Dong no nam TREN, mang dau
tru, ten o the da hoan thanh.

2 dong chi hien khi > 0: hien "0d" cho user chua bao gio bi giam la tao lo lang
ve mot luat khong ap dung cho ho.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 14: Ảnh "đơn về" — dòng mở khoá

**Files:**
- Modify: `src/core/orderImage/orderImageLayout.ts`
- Modify: `src/core/orderImage/ordersConfirmedNotification.ts`
- Modify: `src/adapters/shared/replyText.ts` (`formatOrdersConfirmedReply` + 2 template default)
- Test: `src/core/__tests__/orderImageLayout.test.ts`, `src/core/__tests__/ordersConfirmedNotification.test.ts`

**Interfaces:**
- Produces: view model của `orderImageLayout` thêm `heldLine: string | null`; `buildOrdersConfirmedNotification` nhận thêm `heldAmount: number`.

Bẫy đang xử: ảnh in `Tổng cộng` của lô đơn vừa ghi **cạnh** `Số dư khả dụng`. Đơn bị giam vào `Tổng cộng` nhưng **không** vào `Số dư khả dụng` → user soi đúng một tấm ảnh thấy 2 số không khớp. Y hệt bẫy thứ-tự-đọc-số-dư đã ghi trong `CLAUDE.md`, chỉ khác nguyên nhân.

- [ ] **Step 1: Write the failing test**

```ts
test("lo KHONG co don bi giam -> heldLine null, view model khong doi", () => {
  // Assert: layout.heldLine === null
});

test("lo co don bi giam -> heldLine noi ro so tien va ngay mo khoa", () => {
  // Assert: layout.heldLine chua "150.000" va chua "14/10"
});

test("TONG van tinh tren TAT CA don, khong phai 3 the dang hien", () => {
  // Test hoi quy da co san trong file - dam bao khong bi pha khi them heldLine.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/core/__tests__/orderImageLayout.test.ts`
Expected: FAIL — `heldLine` undefined.

- [ ] **Step 3: Implement**

`orderImageLayout.ts`: thêm `heldAmount: number` và `heldUnlockDay: string | null` vào input, `heldLine: string | null` vào view model:

```ts
  // Chi hien khi lo nay THAT SU co don bi giam - lo khong co thi anh y nhu cu, khong doi 1 pixel.
  heldLine:
    input.heldAmount > 0 && input.heldUnlockDay
      ? `Trong đó ${formatVnd(input.heldAmount)} mở khoá từ ${input.heldUnlockDay}`
      : null,
```

`ordersConfirmedNotification.ts`: nhận `heldAmount`/`heldUnlockDay`, truyền xuống layout. Renderer vẽ `heldLine` dưới dòng `Tổng cộng` khi khác `null` — **chữ phải có nền riêng** (chữ sáng đặt trần trên nền cam thì chìm, đã gặp thật; xem `CLAUDE.md`).

**Bước xác minh bắt buộc, không được bỏ:** `CLAUDE.md` ghi 4 cái bẫy đã gặp thật ở renderer này (`lineClamp` chỉ ăn khi `display:"block"` — để `"flex"` thì satori **im lặng** bỏ qua; chữ sáng đặt trần trên nền cam thì chìm; `backgroundClip:"text"` của satori không cắt sạch theo nét chữ; đo cỡ chữ bằng mắt trên ảnh đã ghép là sai). Test không bắt được cái nào trong 4 cái đó. Sau khi code xong, **render ảnh thật ra file và xem bằng mắt**:

```bash
npx tsx -e "
import { renderOrderImage } from './src/core/orderImage/orderImageRenderer.js';
import { writeFileSync } from 'node:fs';
// Dung dung view model co heldLine - xem orderImageLayout.test.ts de lay hinh dang input.
const buf = await renderOrderImage(/* view model co heldLine */);
writeFileSync('/private/tmp/claude-501/-Users-ryan-Documents-Claude-Projects-Affiliate-Bot-Shopee/05316d76-8813-4c1b-b504-bd77cf5e9dcb/scratchpad/order-held.jpg', buf);
"
```

rồi đọc file đó bằng tool Read (nó hiển thị ảnh). Kiểm 3 điều: dòng mở khoá **đọc được** (không chìm vào nền cam), **không đẩy** số tiền hay thẻ đơn nào ra khỏi khung, và lô **không** có đơn bị giam thì ảnh **giống y** bản cũ.

`replyText.ts`: `formatOrdersConfirmedReply` và caption nhận thêm placeholder `{{heldLine}}`, render thành câu trên hoặc chuỗi rỗng — theo đúng pattern một-slot-nhiều-trạng-thái của `{{commissionLine}}`, **không bao giờ hiện cả hai**.

`server.ts`: tính `heldAmount` = tổng `user_share_amount` của các đơn trong lô có `availableFrom !== null`, và `heldUnlockDay` = ngày mở khoá **sớm nhất** trong lô (dd/mm giờ VN).

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/orderImage/ src/adapters/shared/replyText.ts src/api/server.ts src/core/__tests__/
git commit -F - <<'EOF'
fix(order-image): them dong "mo khoa tu" khi lo co don bi giam

Anh in Tong cong cua lo CANH So du kha dung. Don bi giam vao Tong cong nhung
khong vao So du kha dung -> user soi dung 1 tam anh thay 2 so khong khop. Y het
bay thu-tu-doc-so-du da ghi trong CLAUDE.md, chi khac nguyen nhan.

Lo khong co don bi giam thi anh y nhu cu, khong doi 1 pixel.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 15: `/admin/withdrawals` — banner + nút Huỷ + tab "Đã huỷ"

**Files:**
- Modify: `src/api/adminHtml.ts` (`renderWithdrawalsPage`)
- Modify: `src/api/server.ts` (truyền `listCancelledWithdrawals()` + map nợ)
- Test: `src/api/__tests__/withdrawalsPageScript.test.ts`

**Interfaces:**
- Consumes: `listCancelledWithdrawals` (Task 7), `getDebtByOrder` (Task 5).
- Produces: `renderWithdrawalsPage(pending, paid, cancelled, displayNames, message?, debtWarnings?)` — `debtWarnings: Map<string, { orderId: string; amount: number }[]>` khoá theo `withdrawal.id`.

- [ ] **Step 1: Write the failing test**

```ts
test("nut Huy dung form=... va <form> nam NGOAI <table>", () => {
  // Cung rang buoc da co cho nut "Danh dau da tra": trinh duyet day mot <form> la con truc tiep cua
  // <tr> ra khoi bang luc phan tich HTML, mat ca action/enctype.
  // Assert: html chua `form="cancel-<id>"`; va vi tri cua <form id="cancel-<id>" nam NGOAI cap
  //         <table>...</table> chua hang do.
});

test("hang co don bi tra hang hien banner kem so dung", () => {
  // Assert: html chua "vừa bị trả hàng" va chua so tien dung.
});

test("tab 'Đã huỷ' chi hien khi co yeu cau da huy", () => {
  // Assert: khong co yeu cau huy -> html KHONG chua "Đã huỷ"; co -> chua.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/api/__tests__/withdrawalsPageScript.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Theo đúng pattern 2 tab hiện có (JS client-side, không reload) — thêm tab thứ 3. Nút Huỷ dùng `form="cancel-<id>"` với `<form id="cancel-<id>" method="POST" action="/admin/withdrawals/<id>/cancel">` đặt **ngoài** `<table>`, giống `form="pay-<id>"`.

Banner trên hàng:

```html
<tr class="..."><td colspan="N">
  <div class="...border-[--danger]...">
    ⚠ 1 đơn trong yêu cầu này vừa bị trả hàng (−40.000đ) — số đúng là 60.000đ.
    Nếu CHƯA chuyển khoản, bấm Huỷ yêu cầu để khỏi mất tiền.
  </div>
</td></tr>
```

Tuân thủ ràng buộc Tailwind của khu `/admin`: **không nạp preflight**, nên `<button>` mới phải tự reset viền/nền/font; mọi bảng phải nằm trong `.card`; **không** dùng utility tuỳ ý chứa khoảng trắng (SVG data-URI, JSON) — viết class thật trong `admin.css`.

- [ ] **Step 4: Run tests + build CSS + typecheck**

Run: `npm run build:css && npm test && npm run typecheck`
Sau đó `grep -c "cancel" public/admin.css` để xác nhận utility mới thật sự được sinh ra (typecheck/test **không** bắt được lỗi tầng build CSS).

- [ ] **Step 5: Commit**

```bash
git add src/api/adminHtml.ts src/api/server.ts src/api/styles/admin.css src/api/__tests__/withdrawalsPageScript.test.ts
git commit -F - <<'EOF'
feat(admin): /admin/withdrawals - banner don bi tra hang + nut Huy + tab Da huy

Nut Huy dung form="cancel-<id>" voi <form> dat NGOAI <table>: trinh duyet day
mot <form> la con truc tiep cua <tr> ra khoi bang luc phan tich HTML, mat ca
action/enctype (cung rang buoc da co cho nut "Danh dau da tra").

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 16: `/admin/users` cột Nợ + `/admin/orders` badge & cột Mở khoá

**Files:**
- Modify: `src/api/adminHtml.ts` (`renderUsersPage`, `renderOrdersPage`)
- Modify: `src/api/server.ts`
- Test: `src/api/__tests__/usersSearchScript.test.ts`, `src/api/__tests__/adminRoutes.test.ts`

**Interfaces:**
- Consumes: `listUsers()` có `debtRemaining`/`heldBalance` (Task 8), `listOutstandingDebts` (Task 5).
- Produces: `renderOrdersPage` nhận thêm `debtOrderIds: Set<string>`.

- [ ] **Step 1: Write the failing test**

```ts
test("/admin/users: cot No hien so va nut Xoa no khi user co no", () => {
  // Assert: html chua "Nợ" trong <thead>; hang cua user co no chua so tien + nut "Xoá nợ".
});

test("/admin/users: user khong no -> o No lam mo (so 0 luon lam mo)", () => {
  // Rang buoc da co cua moneyCell(): bang nhieu cot tien ma to dam ca loat thi mat phai doc tung so.
});

test("/admin/orders: entry 'paid' co no hien badge canh bao", () => {
  // Assert: html chua "đã trả hàng" tren hang cua don do.
});

test("/admin/orders: cot 'Mở khoá' hien ngay cua don dang bi giam, '—' cho don khac", () => {
});

test("data-orders/data-paid/data-index cua /admin/users khong bi pha khi them cot No", () => {
  // Test hoi quy: sap xep client-side dua vao 3 attribute nay.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/api/__tests__/usersSearchScript.test.ts src/api/__tests__/adminRoutes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`/admin/users`: thêm cột "Nợ" dùng `moneyCell()` (số 0 **luôn** làm mờ). Nút "Xoá nợ" dùng `button.danger`, POST sang route Task 12 với `<form>` ngoài `<table>`. 4 thẻ KPI hiện cộng thẳng từ `list` đang render — nếu thêm thẻ nào thì phải cộng từ cùng nguồn đó để không venh với bảng; **không thêm thẻ KPI mới** ở task này.

`/admin/orders`: thêm cột "Mở khoá" (`availableFrom` hoặc `—`), và badge `⚠ đã trả hàng` cho entry `paid`/`confirmed` có `orderId` trong `debtOrderIds`. Chip giữ góc vuông, pill trạng thái giữ `rounded-full` — hai cái phân biệt nhau bằng **hình dạng** chứ không bằng màu.

- [ ] **Step 4: Run tests + build CSS + typecheck**

Run: `npm run build:css && npm test && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/api/adminHtml.ts src/api/server.ts src/api/styles/admin.css src/api/__tests__/
git commit -F - <<'EOF'
feat(admin): cot No + nut Xoa no o /admin/users, badge tra hang + cot Mo khoa o /admin/orders

Khong them the KPI nao: vua cat tu 12 xuong 9 the (2026-10-07, "qua nhieu, roi").
Tien dang giam va no chua thu thuoc ve /admin/users va /admin/withdrawals - cho
admin thuc su hanh dong.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 17: `/so-tay` — mục giam đơn to + trả hàng

**Files:**
- Modify: `src/api/handbookHtml.ts`
- Modify: `src/api/server.ts` (truyền 2 số mới vào `renderHandbookPage`)
- Test: `src/api/__tests__/handbookHtml.test.ts`

**Interfaces:**
- Consumes: `getPayoutHoldThresholdVnd` / `getPayoutHoldDays` (Task 9).
- Produces: `renderHandbookPage` input thêm `payoutHoldThresholdVnd`, `payoutHoldDays`.

- [ ] **Step 1: Write the failing test**

```ts
test("so tay: muc giam don to doc LIVE tu setting, khong hardcode", () => {
  const a = renderHandbookPage({ /* ...input hien co..., */ payoutHoldThresholdVnd: 100_000, payoutHoldDays: 7 });
  const b = renderHandbookPage({ /* ... */ payoutHoldThresholdVnd: 250_000, payoutHoldDays: 3 });
  assert.match(a, /100\.000/);
  assert.match(a, /7 ngày/);
  assert.doesNotMatch(b, /100\.000/, "khong con vet cua so cu");
  assert.match(b, /250\.000/);
  assert.match(b, /3 ngày/);
});

test("so tay: giai thich viec tra hang thi tien bi tru the nao", () => {
  assert.match(html, /trả hàng/);
  assert.match(html, /trừ dần/);
  assert.match(html, /không phải chuyển tiền lại/);
});

test("so tay: nguong giam = 0 -> KHONG hien muc giam (tinh nang dang tat)", () => {
  const html = renderHandbookPage({ /* ... */ payoutHoldThresholdVnd: 0, payoutHoldDays: 7 });
  assert.doesNotMatch(html, /mở khoá sau/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/api/__tests__/handbookHtml.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Thêm mục mới (nội dung tiếng Việt, tông giống các mục đang có, xưng "em"), nội dung:

- Đơn có tiền hoàn từ `{threshold}` trở lên: mở khoá sau `{holdDays}` ngày kể từ ngày nhận hàng, vì đó là khoảng Shopee cho phép trả hàng.
- Nếu trả hàng sau khi đã rút tiền: khoản đó được trừ dần vào các đơn sau, **không phải chuyển tiền lại**.
- Ẩn cả mục khi `payoutHoldThresholdVnd === 0`.

Mục này phải nằm trong `data-search` của section (chuỗi `data-search` của section **bao trùm** chuỗi của mọi mục con), và đi qua `searchKey()` — hàm này **bỏ hẳn dấu ngoặc kép** trước khi chuẩn hoá, và cùng quy tắc được lặp trong script client, **sửa 1 bên phải sửa cả 2**.

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS, kể cả `handbookResponsive.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/api/handbookHtml.ts src/api/server.ts src/api/__tests__/handbookHtml.test.ts
git commit -F - <<'EOF'
docs(so-tay): muc giam don to + tra hang thi tien bi tru the nao

Khong noi ra thi luat nay la bay voi user. Moi so doc LIVE tu setting (co test
chan hardcode: render voi so khac roi assert khong con vet cua so cu).

Nguong = 0 thi an ca muc - tinh nang dang tat, noi ra la gay lo vo ich.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 18: Cập nhật `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:** không có code.

- [ ] **Step 1: Viết các mục mới**

Thêm vào `CLAUDE.md`:

1. Mục `payoutHold.ts` trong sơ đồ `src/core/` — quy tắc giam, lý do chốt `available_from`, lý do đếm từ `completed_at` (đúng mốc Shopee đếm 15 ngày), `thresholdVnd = 0` để tắt.
2. Trong mục `ledgerStore.ts` — 2 cột `completed_at`/`available_from` (không backfill, không giam hồi tố), bảng `payout_debts` (UNIQUE(merchant, order_id) là chốt sống còn vì báo cáo liệt kê lại cả lịch sử), `debt_applied`/`cancelled_at`, và **quyết định trừ nợ ở `markWithdrawalPaid` chứ không ở `requestWithdrawal`** kèm lý do.
3. Cảnh báo: `withdrawal_requests.amount` **khác** tổng `user_share_amount` của entry gắn vào nó — `pendingBalance`/`paidTotal` phải đọc từ `withdrawal_requests`.
4. Trong mục `shopeeReportImport.ts` — bảng quyết định 5 ca của nhánh "Đã hủy"; `parseShopeeOrderDate` đã đổi tên thành `parseShopeeReportDay`; `completedAt` của đơn gộp lấy **muộn nhất** (ngược với `orderDate`).
5. Entry `paid` bị huỷ **không** đổi status — lý do: lịch sử đơn user xem phải khớp sao kê ngân hàng.
6. Bẫy vận hành: 2 template mới có default trong code nhưng instance đã bấm Lưu ở `/admin/settings` sẽ không tự nhận.
7. `/so-tay` có mục mới đọc live từ setting, có test chặn hardcode.
8. Số liệu research: Shopee cho trả hàng **15 ngày** kể từ giao hàng thành công (điều 3.2); báo cáo bật "Hoàn thành" median 2,5 ngày sau đặt hàng → cửa sổ rủi ro gần như trọn 15 ngày; hold 7 ngày phủ ~6/15; **chưa có case thật nào confirmed→reversed** nên không có dữ liệu về việc khách trả hàng vào ngày thứ mấy.

- [ ] **Step 2: Đọc lại kiểm tính nhất quán**

Xác nhận không mâu thuẫn với các mục đã có — đặc biệt mục `/admin/dashboard` (không thêm thẻ KPI) và mục thứ tự đọc số dư của ảnh "đơn về".

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -F - <<'EOF'
docs(claude): ghi lai quyet dinh giam don to + no hoan tra

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Self-Review

**1. Spec coverage**

| Spec § | Task |
| --- | --- |
| §3.1 quy tắc giam | 2, 9 |
| §3.2 2 cột + không backfill | 3 |
| §3.3 chốt `available_from` | 3 (test chốt), 2 |
| §3.4 `payoutHold.ts` + `addDaysToVnIso` | 1, 2 |
| §3.5 ghi ở đâu | 3, 11 |
| §3.6 đọc cột hoàn thành + rename | 10 |
| §3.7 khả dụng + `getHeldBalance` | 3 |
| §4 bảng quyết định + counter | 11 |
| §4.2 entry `paid` không đổi status | 11 |
| §5.1 bảng nợ | 5 |
| §5.2 khả dụng trừ nợ floor 0 | 6 |
| §5.3 trừ nợ ở `markWithdrawalPaid` | 6 |
| §5.4 audit tổng tiền | 7 (step 5), 8 |
| §5.5 xoá nợ | 5, 12, 16 |
| §6 huỷ yêu cầu rút | 7, 12, 15 |
| §7.1 dashboard | 13 |
| §7.2 ảnh "đơn về" | 14 |
| §7.3 admin | 15, 16 |
| §7.4 `/so-tay` | 17 |
| §8 cấu hình | 9 |
| §9 thông báo | 9, 12 |
| §10 test | rải khắp các task |

Không còn mục spec nào thiếu task.

**2. Placeholder scan**

Task 9 step 1, Task 10 step 1, Task 11 step 1, Task 12 step 1, Task 15/16 step 1 mô tả test bằng comment thay vì code đầy đủ, vì chúng **phải** tái dùng helper dựng app/CSV/spy đã có trong chính file test đó — viết sẵn code mà đoán sai tên helper sẽ tệ hơn là chỉ rõ assertion cần đạt. Mỗi chỗ đều nêu rõ: file nào, helper nào phải đọc trước, và assertion chính xác. Đây là giới hạn có ý thức, không phải "TODO".

**3. Type consistency**

Đã rà: `PayoutHoldConfig` (Task 2) → dùng ở Task 3/9/11 cùng tên field `thresholdVnd`/`holdDays`. `resolveAvailableFrom` nhận `config` (không phải `holdConfig`) ở param object — Task 3 gọi đúng `config: input.holdConfig`. `getGrossAvailableBalance` giới thiệu ở Task 6, dùng ở Task 6/8/13 cùng tên. `PayoutDebt.writtenOffAt` dùng thống nhất (không phải `wroteOffAt`). `debtApplied` (camel, type) vs `debt_applied` (snake, SQL) nhất quán. `parseShopeeReportDay` đổi tên ở Task 10 và không task nào sau đó còn gọi tên cũ. `listCancelledWithdrawals` giới thiệu Task 7, dùng Task 15. `debtsByUser` giới thiệu Task 11, dùng Task 12.

Một chỗ đã sửa trong lúc review: Task 6 ban đầu có 2 test nháp mâu thuẫn nhau (một test assert `w.amount === 0` rồi comment là "test này đợi hành vi ở test dưới") — đã nêu rõ phải xoá và thay bằng 1 test trừ nợ một phần chạy được thật.
