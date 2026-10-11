# Đối soát đơn TikTok Shop qua RioHub — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kéo đơn TikTok Shop từ RioHub về và ghi vào ledger, để tiền của user TikTok chảy qua đúng các luật tiền đang áp cho Shopee (giam đơn to/nhỏ, nợ hoàn trả, tự huỷ yêu cầu rút).

**Architecture:** Tách phần "áp trạng thái một đơn vào ledger" ra khỏi `importShopeeReport()` thành `orderStatusApply.ts` (không biết sàn nào), Shopee gọi lại nó. TikTok = nguồn mới: `riohubOrdersSource.ts` (duy nhất gọi mạng) → `tiktokOrderImport.ts` (thuần, nhận mảng) → `orderStatusApply.ts`. Admin bấm tay ở `/admin/record-orders`.

**Tech Stack:** TypeScript (ESM, Node 22+), `node:sqlite`, `node:test` + `tsx --test`, Express, HTML viết tay + Tailwind utilities.

**Spec:** `docs/superpowers/specs/2026-10-11-doi-soat-don-tiktok-design.md` (đọc cả hai trước khi làm; spec là nguồn cho mọi quyết định "vì sao").

## Global Constraints

- **Nhánh làm việc: `tiktok-riohub`. KHÔNG đụng `main`, KHÔNG `git push`** (chủ bot chưa thông báo TikTok cho user; push `main` là deploy Railway).
- **Baseline: `947 pass / 0 fail`**, typecheck sạch (đo 2026-10-11 sau khi merge `main` vào nhánh). Mọi task kết thúc phải `npm run typecheck && npm test` xanh.
- **Bất biến lớn nhất (spec 4.3): 4 file test Shopee xanh KHÔNG SỬA MỘT DÒNG** — `shopeeReportImport.test.ts`, `shopeeReportOrderDate.test.ts`, `shopeeReportSmallHold.test.ts`, `payoutDebt.test.ts`. Kiểm bằng `git diff --stat HEAD -- <4 file>` phải rỗng. Phải sửa một test Shopee = refactor đã đổi hành vi ⇒ **dừng, làm lại**, không sửa test cho khớp.
- **Không chạm**: `ledgerStore.ts`, `payoutHold.ts`, `commissionMath.ts`, `orderIngest.ts`.
- **Hoa hồng gốc TikTok = `round(Σ est_commission(dòng không huỷ) × 0,9)`**, cho cả `pending` lẫn `confirmed`. `actual_commission` KHÔNG tham gia tính tiền (chỉ đối chiếu/cảnh báo). Không sửa số sau khi entry đã `confirmed`.
- **Mốc `confirmed` = đã giao (`time_delivered_iso`) hoặc `status=2`**, không chờ quyết toán.
- **Phân loại đọc `status` (1/2/3), KHÔNG đọc `settlement_status`.**
- **`sub_id` rỗng là chuỗi `""`, không phải `null`.**
- **Giờ VN (+7)**: mọi mốc ngày/giờ từ API (UTC) phải quy đổi, không ghi thẳng.
- **Chốt cách ly**: đơn TikTok mà `findBySubId` trả merchant khác `tiktokshop` → bỏ qua + cảnh báo. Chốt này CHỈ ở phía TikTok, không thêm vào `shopeeReportImport`.
- **Quy ước code của repo**: comment và chuỗi nội bộ viết **không dấu**; chuỗi hiển thị cho admin/user viết **có dấu**. Mọi lỗi là `AppError` subclass khi đi tới user.
- **Commit**: mỗi message kết thúc bằng
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`

## File Structure

| File | Việc | Task |
|---|---|---|
| `src/core/orderStatusApply.ts` | **Mới.** Lớp áp ledger dùng chung, không biết sàn | 1 |
| `src/core/__tests__/orderStatusApply.test.ts` | **Mới.** Test trực tiếp lớp trên, chạy với CẢ 2 merchant | 1 |
| `src/core/shopeeReportImport.ts` | **Sửa ruột vòng lặp** — gọi `orderStatusApply`, map outcome → result cũ | 1 |
| `src/core/tiktokCommission.ts` | **Mới.** `TIKTOK_PIT_RETAINED_RATIO`, `estimateTiktokNetCommission`, `isActualBelowAssumed` | 2 |
| `src/core/providers/tiktokAffiliateProvider.ts` | `estimateFrom()` dùng hằng số trên | 2 |
| `src/core/vietnamDate.ts` | Thêm `formatVnTimeHms()` | 3 |
| `src/core/providers/riohubOrdersSource.ts` | **Mới.** `fetchTiktokOrders()` (phân trang) + `createTiktokOrdersFetcher()` | 4 |
| `src/core/tiktokOrderImport.ts` | **Mới.** `importTiktokOrders()` thuần | 4 |
| `src/core/types.ts` | `ImportActionType` thêm `"tiktok"` | 5 |
| `src/api/server.ts` | Route `POST /admin/record-orders/tiktok-sync` + helper thông báo dùng chung | 5 |
| `src/api/adminHtml.ts` | Thẻ "Đồng bộ đơn TikTok Shop" + nhãn lịch sử | 5 |
| `src/index.ts` | Truyền fetcher vào `createServer` | 5 |
| `.claude/rules/doi-soat-don-tiktok.md`, `CLAUDE.md`, `.claude/rules/import-bao-cao-shopee.md`, `docs/riohub-tiktok.md`, `rui-ro-tich-hop-tiktok.md` | Tài liệu | 6 |

---

### Task 1: Tách `orderStatusApply.ts` khỏi `importShopeeReport()` (refactor, không đổi hành vi)

**Files:**
- Create: `src/core/orderStatusApply.ts`
- Create: `src/core/__tests__/orderStatusApply.test.ts`
- Modify: `src/core/shopeeReportImport.ts` (thân vòng lặp `for (const [orderId, group] of grouped)`, từ dòng `const existing = ledgerStore.getEntryByOrderId(...)` đến hết vòng lặp)

**Interfaces:**
- Consumes: `LedgerStore` (các hàm có sẵn: `getEntryByOrderId`, `recordSeenOrder`, `backfillOrderDate`, `backfillOrderTime`, `resolveUserSharePercent`, `confirmPendingEntry`, `recordConversion`, `updatePendingEntry`, `reverseCommissionEntry`, `cancelWithdrawal`, `recordPayoutDebt`, `recordOrderStatusEvent`), `RecordOrderConfig` từ `orderIngest.ts`.
- Produces (Task 4 dùng):
  ```ts
  export type OrderStatusOutcome = ...            // xem Step 4
  export interface OrderStatusApplyInput { ... }  // xem Step 4
  export function applyOrderStatusToLedger(
    ledgerStore: LedgerStore, input: OrderStatusApplyInput,
    recordOrderConfig: RecordOrderConfig, importDay: string
  ): OrderStatusOutcome[]
  ```

- [ ] **Step 1: Xác nhận nhánh + đo baseline (KHÔNG chạm file nào)**

```bash
cd "/Users/ryan/Documents/Claude/Projects/Affiliate Bot Shopee"
git branch --show-current          # phải in: tiktok-riohub
git status -s                      # phải sạch (chỉ có thể có preview-withdrawals.ts untracked)
npm run typecheck
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
Expected: `tests 947`, `pass 947`, `fail 0`. Nếu khác → DỪNG, báo chủ bot (baseline đã lệch).

- [ ] **Step 2: Viết test trực tiếp cho lớp chưa tồn tại**

Tạo `src/core/__tests__/orderStatusApply.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";
import type { MerchantId } from "../merchants.js";
import { applyOrderStatusToLedger, type OrderStatusApplyInput, type OrderStatusOutcome } from "../orderStatusApply.js";
import { addDaysToVnIso, todayVnIso } from "../vietnamDate.js";

/**
 * Test TRUC TIEP lop ap ledger dung chung. Chay moi ca voi CA HAI merchant: lop nay khong duoc biet
 * san nao (neu co nhanh nao rieng cho "shopee" thi test o day phai vo). Xem spec muc 4.
 */
const TODAY = todayVnIso();
const YESTERDAY = addDaysToVnIso(TODAY, -1);
const BANK = { bankName: "Vietcombank", bankAccountNumber: "0123456789", bankAccountHolder: "Nguyen Van A" };

/** user nhan 100% de hoa hong trong input chinh la user_share - de doi chieu voi nguong 100.000. */
const CONFIG = {
  taxPercent: 0,
  platformFeePercent: 0,
  userSharePercent: 100,
  maxCommissionRatioPercent: 1000,
  holdConfig: { thresholdVnd: 100_000, holdDays: 7, smallHoldDays: 1 },
};

function input(merchant: MerchantId, over: Partial<OrderStatusApplyInput> = {}): OrderStatusApplyInput {
  return {
    orderId: "O-1",
    targetStatus: "confirmed",
    subId: "k-user-a-abc-def",
    requestEntry: { platform: "zalo", userId: "user-a", merchant },
    orderAmount: 2_000_000,
    commissionAmount: 50_000,
    productName: "San pham test",
    orderDate: null,
    orderTime: null,
    completedAt: YESTERDAY,
    reverseReason: "ly do test",
    notes: { confirmed: "ghi chu confirmed", pending: "ghi chu pending" },
    sourceLabel: "Nguon test",
    confirmedClaim: 'Nguon test ghi "Hoan thanh"',
    ...over,
  };
}

const apply = (s: LedgerStore, i: OrderStatusApplyInput): OrderStatusOutcome[] =>
  applyOrderStatusToLedger(s, i, CONFIG, TODAY);
const kinds = (o: OrderStatusOutcome[]): string[] => o.map((x) => x.kind);

for (const merchant of ["shopee", "tiktokshop"] as const) {
  test(`[${merchant}] don nho da giao tu hom qua -> confirmed-new, khong bi giam`, () => {
    const s = new LedgerStore(":memory:");
    try {
      const out = apply(s, input(merchant));
      assert.deepEqual(kinds(out), ["confirmed-new"]);
      const o = out[0] as Extract<OrderStatusOutcome, { kind: "confirmed-new" }>;
      assert.equal(o.newOrder, true);
      assert.equal(o.wasPending, false);
      assert.equal(o.held, false);
      assert.equal(s.getEntryByOrderId(merchant, "O-1")?.status, "confirmed");
    } finally {
      s.close();
    }
  });

  test(`[${merchant}] don TO -> confirmed-new va held = true (available_from o tuong lai)`, () => {
    const s = new LedgerStore(":memory:");
    try {
      const out = apply(s, input(merchant, { commissionAmount: 150_000, completedAt: TODAY }));
      const o = out[0] as Extract<OrderStatusOutcome, { kind: "confirmed-new" }>;
      assert.equal(o.kind, "confirmed-new");
      assert.equal(o.held, true);
      assert.equal(s.getEntryByOrderId(merchant, "O-1")?.availableFrom, addDaysToVnIso(TODAY, 7));
    } finally {
      s.close();
    }
  });

  test(`[${merchant}] don nho giao HOM NAY -> small-hold-deferred, entry van pending`, () => {
    const s = new LedgerStore(":memory:");
    try {
      const out = apply(s, input(merchant, { completedAt: TODAY }));
      assert.deepEqual(out, [{ kind: "small-hold-deferred", newOrder: true }]);
      assert.equal(s.getEntryByOrderId(merchant, "O-1")?.status, "pending");
    } finally {
      s.close();
    }
  });

  test(`[${merchant}] ap cung mot don confirmed 2 lan -> lan 2 la confirmed-duplicate`, () => {
    const s = new LedgerStore(":memory:");
    try {
      apply(s, input(merchant));
      assert.deepEqual(kinds(apply(s, input(merchant))), ["confirmed-duplicate"]);
    } finally {
      s.close();
    }
  });

  test(`[${merchant}] pending-new roi pending-updated`, () => {
    const s = new LedgerStore(":memory:");
    try {
      assert.deepEqual(kinds(apply(s, input(merchant, { targetStatus: "pending", completedAt: null }))), ["pending-new"]);
      assert.deepEqual(
        kinds(apply(s, input(merchant, { targetStatus: "pending", completedAt: null, commissionAmount: 60_000 }))),
        ["pending-updated"]
      );
      assert.equal(s.getEntryByOrderId(merchant, "O-1")?.commissionAmount, 60_000);
    } finally {
      s.close();
    }
  });

  test(`[${merchant}] pending -> confirmed: wasPending = true, khong phai don moi`, () => {
    const s = new LedgerStore(":memory:");
    try {
      apply(s, input(merchant, { targetStatus: "pending", completedAt: null }));
      const out = apply(s, input(merchant));
      const o = out[0] as Extract<OrderStatusOutcome, { kind: "confirmed-new" }>;
      assert.equal(o.kind, "confirmed-new");
      assert.equal(o.wasPending, true);
      assert.equal(o.newOrder, false);
    } finally {
      s.close();
    }
  });

  test(`[${merchant}] huy don CHUA TUNG THAY -> reversed-unseen, KHONG tao entry`, () => {
    const s = new LedgerStore(":memory:");
    try {
      assert.deepEqual(kinds(apply(s, input(merchant, { targetStatus: "reversed" }))), ["reversed-unseen"]);
      assert.equal(s.getEntryByOrderId(merchant, "O-1"), null);
    } finally {
      s.close();
    }
  });

  test(`[${merchant}] pending bi huy -> reversed tu pending; huy lan nua khong lam gi`, () => {
    const s = new LedgerStore(":memory:");
    try {
      apply(s, input(merchant, { targetStatus: "pending", completedAt: null }));
      assert.deepEqual(apply(s, input(merchant, { targetStatus: "reversed" })), [{ kind: "reversed", from: "pending" }]);
      assert.equal(s.getEntryByOrderId(merchant, "O-1")?.status, "reversed");
      assert.deepEqual(apply(s, input(merchant, { targetStatus: "reversed" })), []);
    } finally {
      s.close();
    }
  });

  test(`[${merchant}] confirmed chua rut bi huy -> thu hoi TRON, khong no`, () => {
    const s = new LedgerStore(":memory:");
    try {
      apply(s, input(merchant));
      assert.deepEqual(apply(s, input(merchant, { targetStatus: "reversed" })), [{ kind: "reversed", from: "confirmed" }]);
      assert.equal(s.getEntryByOrderId(merchant, "O-1")?.status, "reversed");
      assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 0);
    } finally {
      s.close();
    }
  });

  test(`[${merchant}] confirmed dang nam trong yeu cau rut bi huy -> tu huy yeu cau roi thu hoi`, () => {
    const s = new LedgerStore(":memory:");
    try {
      apply(s, input(merchant));
      const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);
      const out = apply(s, input(merchant, { targetStatus: "reversed" }));
      assert.deepEqual(kinds(out), ["withdrawal-cancelled", "reversed"]);
      const c = out[0] as Extract<OrderStatusOutcome, { kind: "withdrawal-cancelled" }>;
      assert.equal(c.withdrawalId, w.id);
      assert.equal(c.amount, 50_000);
      assert.equal(s.getEntryByOrderId(merchant, "O-1")?.status, "reversed");
    } finally {
      s.close();
    }
  });

  test(`[${merchant}] paid bi huy -> ghi NO, entry van la paid`, () => {
    const s = new LedgerStore(":memory:");
    try {
      apply(s, input(merchant));
      const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);
      s.markWithdrawalPaid(w.id, null);
      const out = apply(s, input(merchant, { targetStatus: "reversed" }));
      assert.deepEqual(out, [
        { kind: "debt-created", platform: "zalo", userId: "user-a", orderId: "O-1", amount: 50_000 },
      ]);
      assert.equal(s.getEntryByOrderId(merchant, "O-1")?.status, "paid");
      assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 50_000);
      // Nguon liet ke LAI don huy o moi lan dong bo: lan 2 KHONG duoc nhan doi no.
      assert.deepEqual(apply(s, input(merchant, { targetStatus: "reversed" })), []);
      assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 50_000);
    } finally {
      s.close();
    }
  });

  test(`[${merchant}] nguon bao confirmed nhung entry da reversed -> warning, KHONG ghi de`, () => {
    const s = new LedgerStore(":memory:");
    try {
      apply(s, input(merchant, { targetStatus: "pending", completedAt: null }));
      apply(s, input(merchant, { targetStatus: "reversed" }));
      const out = apply(s, input(merchant));
      assert.equal(out.length, 1);
      assert.equal(out[0].kind, "warning");
      assert.match((out[0] as { message: string }).message, /Nguon test ghi "Hoan thanh"/);
      assert.equal(s.getEntryByOrderId(merchant, "O-1")?.status, "reversed");
    } finally {
      s.close();
    }
  });

  test(`[${merchant}] pending bi admin khoa hoa hong + nguon bao so khac -> warning co sourceLabel, giu so da khoa`, () => {
    const s = new LedgerStore(":memory:");
    try {
      apply(s, input(merchant, { targetStatus: "pending", completedAt: null }));
      const e = s.getEntryByOrderId(merchant, "O-1")!;
      s.overrideCommissionAmount(e.id, {
        commissionAmount: 70_000,
        fallbackPercents: { taxPercent: 0, platformFeePercent: 0, userSharePercent: 100 },
        maxCommissionRatioPercent: 1000,
      });
      const out = apply(s, input(merchant, { targetStatus: "pending", completedAt: null, commissionAmount: 55_000 }));
      assert.ok(out.some((o) => o.kind === "warning" && /Nguon test bao hoa hong/.test(o.message)));
      assert.equal(s.getEntryByOrderId(merchant, "O-1")?.commissionAmount, 70_000);
    } finally {
      s.close();
    }
  });
}
```

- [ ] **Step 3: Chạy để thấy nó FAIL vì module chưa có**

```bash
npx tsx --test src/core/__tests__/orderStatusApply.test.ts 2>&1 | tail -8
```
Expected: lỗi `Cannot find module '../orderStatusApply.js'` (hoặc tương đương). Nếu nó chạy được → đã có file này từ trước, DỪNG.

- [ ] **Step 4: Tạo `src/core/orderStatusApply.ts`** — chuyển NGUYÊN VĂN logic từ vòng lặp Shopee

```ts
/**
 * Ap trang thai cua MOT don vao ledger - phan DUNG CHUNG giua moi nguon don (bao cao Shopee, RioHub
 * TikTok). Tach tu importShopeeReport() 2026-10-11 theo spec 2026-10-11-doi-soat-don-tiktok-design.md.
 *
 * MODULE NAY KHONG BIET SAN NAO. Moi thu "khac nhau giua cac san" (doc dinh dang nguon, gop dong,
 * phan loai trang thai, cau chu) nam o CALLER va di vao qua `OrderStatusApplyInput`. Day la module
 * cua DUONG TIEN LEDGER, khong phai cua TikTok: bo han TikTok sau nay thi file nay O LAI, Shopee van
 * goi no.
 *
 * KHONG DOI HANH VI so voi ban tung nam trong shopeeReportImport.ts - bo test Shopee la bang chung,
 * phai xanh khong sua dong nao. Sua logic o day = sua tien cua CA HAI san.
 *
 * Tra ve MANG outcome (khong phai 1): mot don co the sinh hai viec lien tiep (huy yeu cau rut roi
 * reverse). Thu tu trong mang la thu tu viec xay ra.
 */
import { AppError, DuplicateConversionError } from "./errors.js";
import type { LedgerStore } from "./ledgerStore.js";
import type { MerchantId } from "./merchants.js";
import { formatVnd } from "./money.js";
import type { RecordOrderConfig } from "./orderIngest.js";
import type { CommissionEntry, Platform } from "./types.js";
import { formatVnDateIso, todayVnIso } from "./vietnamDate.js";

export type OrderStatusOutcome =
  | { kind: "confirmed-new"; entry: CommissionEntry; wasPending: boolean; newOrder: boolean; held: boolean }
  | { kind: "confirmed-duplicate" }
  /** Don nho phai cho them vai ngay o "Cho xac nhan" (payoutHold.ts). newOrder: don vua duoc ghi moi. */
  | { kind: "small-hold-deferred"; newOrder: boolean }
  | { kind: "pending-new" }
  | { kind: "pending-updated" }
  | { kind: "reversed"; from: "pending" | "confirmed" }
  /** Huy don chua tung ghi nhan: khong co tien de thu hoi, chi dem vao chart. */
  | { kind: "reversed-unseen" }
  | { kind: "debt-created"; platform: Platform; userId: string; orderId: string; amount: number }
  | {
      kind: "withdrawal-cancelled";
      platform: Platform;
      userId: string;
      withdrawalId: string;
      /** So user DA YEU CAU rut (W = so net + no se tru), khong phai so net. */
      amount: number;
      orderId: string;
    }
  | { kind: "warning"; message: string }
  | { kind: "error"; message: string };

export interface OrderStatusApplyInput {
  orderId: string;
  targetStatus: "confirmed" | "pending" | "reversed";
  subId: string;
  requestEntry: { platform: Platform; userId: string; merchant: MerchantId };
  orderAmount: number;
  /** BI BO QUA khi targetStatus = "reversed": nhanh do thu hoi theo existing.userShareAmount da luu. */
  commissionAmount: number;
  productName: string | null;
  orderDate: string | null;
  orderTime: string | null;
  completedAt: string | null;
  /** Cau ghi vao lich su khi reverse / ghi no - moi nguon tu dien dat theo nhan cua no. */
  reverseReason: string;
  /** `note` cua entry moi, tach theo trang thai vi hai nhanh tung ghi hai cau khac nhau. */
  notes: { confirmed: string; pending: string };
  /** Ten nguon trong cau canh bao hoa hong bi khoa. Vd "Shopee". */
  sourceLabel: string;
  /** Cum "nguon noi don da hoan tat" trong canh bao entry reversed. Vd 'Bao cao Shopee ghi "Hoan thanh"'. */
  confirmedClaim: string;
}

function errorMessage(err: unknown): string {
  return err instanceof AppError ? err.userMessage : (err as Error).message;
}

export function applyOrderStatusToLedger(
  ledgerStore: LedgerStore,
  input: OrderStatusApplyInput,
  recordOrderConfig: RecordOrderConfig,
  importDay: string
): OrderStatusOutcome[] {
  const out: OrderStatusOutcome[] = [];
  const { orderId, targetStatus, subId, requestEntry } = input;
  const merchant = requestEntry.merchant;

  const existing = ledgerStore.getEntryByOrderId(merchant, orderId);

  // Chart "Don hang moi" tren dashboard (xem LedgerStore.migrateCreateSeenOrdersTable): ghi "don moi"
  // TRUOC moi nhanh trang thai ben duoi vi don huy ngay tu lan dau khong bao gio vao
  // commission_entries nhung van phai dem. Chi lan DAU thang nen nguon liet ke lai lich su khong
  // dem lai. Don DA CO trong he thong thi khong phai don moi hom nay - ghi theo ngay entry duoc ghi nhan.
  ledgerStore.recordSeenOrder(
    merchant,
    orderId,
    existing ? (existing.status === "paid" ? "confirmed" : existing.status) : targetStatus,
    existing ? formatVnDateIso(new Date(existing.createdAt)) : importDay
  );

  // Bu ngay dat don cho entry da ghi TRUOC khi he thong biet doc cot nay. Dat o day de ap dung cho MOI
  // nhanh trang thai ben duoi. Chi ghi khi dang trong (xem backfillOrderDate).
  if (existing && input.orderDate) {
    ledgerStore.backfillOrderDate(existing.id, input.orderDate);
    // Gio: bu SAU khi ngay da chot de dieu kien "cung ngay" trong backfillOrderTime dung.
    if (input.orderTime) ledgerStore.backfillOrderTime(existing.id, input.orderDate, input.orderTime);
  }

  // % user nhan cho RIENG don nay: uu dai % theo tung user tinh theo ngay user DAT don (khong phai
  // ngay import - xem userCommissionOverride.ts). Khong biet ngay dat thi lui ve hom nay gio VN,
  // KHONG doan nguoc. Voi updatePendingEntry/confirmPendingEntry no chi la FALLBACK cho entry chua
  // co ty le chot.
  const userSharePercent = ledgerStore.resolveUserSharePercent(
    requestEntry.platform,
    requestEntry.userId,
    input.orderDate ?? todayVnIso(),
    recordOrderConfig.userSharePercent
  );
  const fallbackPercents = {
    taxPercent: recordOrderConfig.taxPercent,
    platformFeePercent: recordOrderConfig.platformFeePercent,
    userSharePercent,
  };

  // Don pending ma admin da SUA TAY hoa hong goc (commissionOverriddenAt): ledgerStore giu so do chu
  // khong lay so cua nguon. Neu nguon bao so khac thi bao admin - day la cho DUY NHAT phat hien viec
  // tien tra cho user dang lech voi tien nguon tra. Khong return: van phai cap nhat trang thai/so
  // lieu khac o nhanh ben duoi.
  if (
    existing?.status === "pending" &&
    existing.commissionOverriddenAt !== null &&
    targetStatus !== "reversed" &&
    input.commissionAmount !== existing.commissionAmount
  ) {
    out.push({
      kind: "warning",
      message:
        `[${orderId}] ${input.sourceLabel} bao hoa hong ${formatVnd(input.commissionAmount)} nhung don dang khoa o ` +
        `${formatVnd(existing.commissionAmount)} (admin sua tay) - giu so da khoa. Vao Don hang > sua hoa hong > ` +
        `bo khoa neu muon lay lai so cua ${input.sourceLabel}.`,
    });
  }

  if (targetStatus === "confirmed") {
    if (existing?.status === "confirmed" || existing?.status === "paid") {
      // "paid" la trang thai SAU "confirmed" - nguon liet ke lai ca lich su nen don da tra tien se tiep
      // tuc hien "hoan tat" o moi lan dong bo sau: lap lai binh thuong, khong phai xung dot.
      out.push({ kind: "confirmed-duplicate" });
      return out;
    }
    if (existing?.status === "reversed") {
      out.push({
        kind: "warning",
        message: `[${orderId}] ${input.confirmedClaim} nhung entry noi bo dang o trang thai "reversed" - can admin kiem tra tay, khong tu dong ghi de.`,
      });
      return out;
    }

    try {
      let entry: CommissionEntry;
      const wasPending = existing?.status === "pending";
      let newOrder = false;
      if (existing?.status === "pending") {
        entry = ledgerStore.confirmPendingEntry(existing.id, {
          orderAmount: input.orderAmount,
          commissionAmount: input.commissionAmount,
          productName: input.productName || undefined,
          // FALLBACK: chi dung cho entry ghi truoc khi he thong chot ty le theo tung don.
          fallbackPercents,
          maxCommissionRatioPercent: recordOrderConfig.maxCommissionRatioPercent,
          completedAt: input.completedAt,
          holdConfig: recordOrderConfig.holdConfig,
        });
      } else {
        entry = ledgerStore.recordConversion({
          subId,
          platform: requestEntry.platform,
          userId: requestEntry.userId,
          merchant,
          orderId,
          productName: input.productName || undefined,
          orderAmount: input.orderAmount,
          commissionAmount: input.commissionAmount,
          orderDate: input.orderDate,
          orderTime: input.orderTime,
          taxPercent: recordOrderConfig.taxPercent,
          platformFeePercent: recordOrderConfig.platformFeePercent,
          userSharePercent,
          maxCommissionRatioPercent: recordOrderConfig.maxCommissionRatioPercent,
          completedAt: input.completedAt,
          holdConfig: recordOrderConfig.holdConfig,
          note: input.notes.confirmed,
        });
        newOrder = true;
      }

      // Don NHO con phai cho vai ngay o "Cho xac nhan" truoc khi vao Kha dung (xem payoutHold.ts):
      // chua co dong nao kha dung nen caller KHONG ghi chuyen trang thai, KHONG gui tin "don ve".
      if (entry.status !== "confirmed") {
        out.push({ kind: "small-hold-deferred", newOrder });
        return out;
      }

      ledgerStore.recordOrderStatusEvent(merchant, orderId, "confirmed", importDay);
      // PHAI so voi hom nay chu khong chi kiem `!== null`: don nho vua toi han cung co available_from
      // (ngay da qua) nhung khong con bi giam.
      const held = entry.availableFrom !== null && entry.availableFrom > importDay;
      out.push({ kind: "confirmed-new", entry, wasPending, newOrder, held });
    } catch (err) {
      if (err instanceof DuplicateConversionError) {
        out.push({ kind: "confirmed-duplicate" });
      } else {
        out.push({ kind: "error", message: `[${orderId}] ${errorMessage(err)}` });
      }
    }
    return out;
  }

  if (targetStatus === "reversed") {
    if (!existing) {
      // Chua tung ghi nhan - khong co tien de huy, nhung van dem vao cot "Da huy" cua chart dashboard
      // DUNG 1 LAN (ngay dau thay); cac lan sau van liet ke don nay se bi INSERT OR IGNORE bo qua.
      ledgerStore.recordOrderStatusEvent(merchant, orderId, "reversed", importDay);
      out.push({ kind: "reversed-unseen" });
      return out;
    }
    // BA ca khac nhau HAN nhau ve TIEN, khong duoc gop:
    //  - confirmed + chua nam trong yeu cau rut: tien con trong tay -> thu hoi TRON, khong no.
    //  - confirmed + da nam trong yeu cau rut 'requested': tien CHUA di -> TU DONG huy ca yeu cau rut,
    //    thu hoi TRON don nay, khong no (2026-10-08, yeu cau truc tiep cua user).
    //  - paid: tien da di that -> ghi no. Yeu cau DA 'paid' thi khong con gi de huy.
    if (existing.status === "reversed") return out;

    if (existing.status === "confirmed") {
      // existing la SNAPSHOT doc 1 lan dau - KHONG tu refresh sau khi cancelWithdrawal ghi DB, nen phai
      // dung 1 CO RIENG (released) de biet tien da ve tay chua, khong duoc re-check existing.withdrawalId.
      let released = existing.withdrawalId === null;
      if (!released) {
        const withdrawalId = existing.withdrawalId!;
        try {
          const cancelled = ledgerStore.cancelWithdrawal(withdrawalId, input.reverseReason);
          out.push({
            kind: "withdrawal-cancelled",
            platform: cancelled.platform,
            userId: cancelled.userId,
            withdrawalId,
            amount: cancelled.amount + cancelled.debtApplied,
            orderId,
          });
          released = true;
        } catch (err) {
          // WithdrawalNotCancellableError: yeu cau da chuyen sang 'paid' GIUA luc doc existing (hiem).
          // KHONG the reverse an toan nua - de nguyen cho lan dong bo SAU (luc do existing.status la
          // 'paid' that trong DB, se di vao nhanh ghi no).
          out.push({ kind: "error", message: `[${orderId}] Khong huy duoc yeu cau rut ${withdrawalId}: ${errorMessage(err)}` });
        }
      }

      if (released) {
        try {
          // allowNonPending: entry dang 'confirmed' nen reverseCommissionEntry mac dinh tu choi. An toan
          // vi tien chac chan dang trong tay (chua tung vao yeu cau rut, hoac vua duoc tha ra o tren).
          ledgerStore.reverseCommissionEntry(existing.id, input.reverseReason, { allowNonPending: true });
          ledgerStore.recordOrderStatusEvent(merchant, orderId, "reversed", importDay);
          out.push({ kind: "reversed", from: "confirmed" });
        } catch (err) {
          out.push({ kind: "error", message: `[${orderId}] ${errorMessage(err)}` });
        }
      }
      return out;
    }

    if (existing.status === "paid") {
      const debt = ledgerStore.recordPayoutDebt({
        platform: existing.platform,
        userId: existing.userId,
        merchant: existing.merchant,
        orderId,
        amount: existing.userShareAmount,
        note: input.reverseReason,
      });
      ledgerStore.recordOrderStatusEvent(merchant, orderId, "reversed", importDay);
      if (debt) {
        out.push({
          kind: "debt-created",
          platform: existing.platform,
          userId: existing.userId,
          orderId,
          amount: existing.userShareAmount,
        });
      }
      return out;
    }

    if (existing.status !== "pending") return out;
    try {
      ledgerStore.reverseCommissionEntry(existing.id, input.reverseReason);
      ledgerStore.recordOrderStatusEvent(merchant, orderId, "reversed", importDay);
      out.push({ kind: "reversed", from: "pending" });
    } catch (err) {
      out.push({ kind: "error", message: `[${orderId}] ${errorMessage(err)}` });
    }
    return out;
  }

  // targetStatus === "pending"
  if (existing) {
    if (existing.status === "pending") {
      try {
        ledgerStore.updatePendingEntry(existing.id, {
          orderAmount: input.orderAmount,
          commissionAmount: input.commissionAmount,
          productName: input.productName || undefined,
          fallbackPercents,
          maxCommissionRatioPercent: recordOrderConfig.maxCommissionRatioPercent,
        });
        out.push({ kind: "pending-updated" });
      } catch (err) {
        out.push({ kind: "error", message: `[${orderId}] ${errorMessage(err)}` });
      }
    }
    return out;
  }
  try {
    ledgerStore.recordConversion({
      subId,
      platform: requestEntry.platform,
      userId: requestEntry.userId,
      merchant,
      orderId,
      productName: input.productName || undefined,
      orderAmount: input.orderAmount,
      commissionAmount: input.commissionAmount,
      taxPercent: recordOrderConfig.taxPercent,
      platformFeePercent: recordOrderConfig.platformFeePercent,
      userSharePercent,
      maxCommissionRatioPercent: recordOrderConfig.maxCommissionRatioPercent,
      completedAt: input.completedAt,
      holdConfig: recordOrderConfig.holdConfig,
      orderDate: input.orderDate,
      orderTime: input.orderTime,
      status: "pending",
      note: input.notes.pending,
    });
    out.push({ kind: "pending-new" });
  } catch (err) {
    if (!(err instanceof DuplicateConversionError)) {
      out.push({ kind: "error", message: `[${orderId}] ${errorMessage(err)}` });
    }
  }
  return out;
}
```

- [ ] **Step 5: Chạy test mới — phải PASS**

```bash
npx tsx --test src/core/__tests__/orderStatusApply.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|✖"
```
Expected: `pass 24` (12 test × 2 merchant), `fail 0`. Test fail ở đây = bản chuyển chép sai hành vi → so lại từng nhánh với `shopeeReportImport.ts` hiện tại.

- [ ] **Step 6: Thay ruột vòng lặp Shopee bằng lời gọi `applyOrderStatusToLedger`**

Tạo script `$SCRATCH/refactor_shopee.py` (SCRATCH = thư mục scratchpad của phiên) rồi chạy bằng `python3`:

```python
import os
os.chdir("/Users/ryan/Documents/Claude/Projects/Affiliate Bot Shopee")
P = "src/core/shopeeReportImport.ts"
s = open(P, encoding="utf-8").read()

START = "    const existing = ledgerStore.getEntryByOrderId(requestEntry.merchant, orderId);\n"
END = "\n  result.confirmedByUser = summarizeOrderResultsByUser(confirmedRows);\n"
assert s.count(START) == 1, "marker START"
assert s.count(END) == 1, "marker END"
a = s.index(START)
b = s.index(END)

NEW = '''    const importDay = todayVnIso();

    // Phan ap trang thai vao ledger dung CHUNG voi moi nguon don khac - xem orderStatusApply.ts.
    // Shopee chi con lai: gop dong, phan loai nhan tieng Viet, va map outcome ve result cu.
    const outcomes = applyOrderStatusToLedger(
      ledgerStore,
      {
        orderId,
        targetStatus,
        subId,
        requestEntry: { platform: requestEntry.platform, userId: requestEntry.userId, merchant: requestEntry.merchant },
        orderAmount: order.orderAmount,
        commissionAmount: order.commissionAmount,
        productName: order.productName || null,
        orderDate: order.orderDate,
        orderTime: order.orderTime,
        completedAt: order.completedAt,
        reverseReason: reverseReason(order.rawStatusLabel),
        notes: {
          confirmed: "Nhap tu bao cao Shopee (file CSV admin upload)",
          pending: "Nhap tu bao cao Shopee - dang cho xu ly",
        },
        sourceLabel: "Shopee",
        confirmedClaim: 'Bao cao Shopee ghi "Hoan thanh"',
      },
      recordOrderConfig,
      importDay
    );

    for (const o of outcomes) {
      switch (o.kind) {
        case "confirmed-duplicate":
          result.confirmedDuplicate += 1;
          break;
        case "warning":
        case "error":
          result.errors.push(o.message);
          break;
        case "small-hold-deferred":
          // Don VAN nam trong newOrderIds khi vua duoc ghi moi: no that su vao ledger.
          if (o.newOrder) result.newOrderIds.push(orderId);
          result.smallHoldDeferred += 1;
          break;
        case "confirmed-new":
          if (o.newOrder) result.newOrderIds.push(orderId);
          if (o.wasPending) result.statusTransitions.push({ orderId, from: "pending", to: "confirmed" });
          result.confirmedNew += 1;
          if (o.held) result.heldCount += 1;
          confirmedRows.push({
            line: 0,
            subId,
            orderId,
            ok: true,
            detail: "shopee-report-import",
            platform: o.entry.platform,
            userId: o.entry.userId,
            userShareAmount: o.entry.userShareAmount,
            productName: o.entry.productName,
          });
          break;
        case "pending-new":
          result.pendingNew += 1;
          result.newOrderIds.push(orderId);
          break;
        case "pending-updated":
          result.pendingUpdated += 1;
          break;
        case "reversed":
          result.reversedCount += 1;
          result.statusTransitions.push({ orderId, from: o.from, to: "reversed" });
          break;
        case "reversed-unseen":
          break;
        case "debt-created":
          result.debtCreatedCount += 1;
          result.debtsByUser.push({ platform: o.platform, userId: o.userId, orderId: o.orderId, amount: o.amount });
          break;
        case "withdrawal-cancelled":
          result.cancelledWithdrawals.push({
            platform: o.platform,
            userId: o.userId,
            withdrawalId: o.withdrawalId,
            amount: o.amount,
            orderId: o.orderId,
          });
          break;
      }
    }
  }
'''
s = s[:a] + NEW + s[b:]

IMPORT_ANCHOR = 'import { summarizeOrderResultsByUser,'
assert s.count(IMPORT_ANCHOR) == 1
s = s.replace(IMPORT_ANCHOR, 'import { applyOrderStatusToLedger } from "./orderStatusApply.js";\n' + IMPORT_ANCHOR, 1)
open(P, "w", encoding="utf-8").write(s)
print("ok")
```

Sau đó dọn import không còn dùng trong `shopeeReportImport.ts` — kiểm từng cái bằng grep, **chỉ xoá cái thật sự hết dùng**:

```bash
for sym in AppError DuplicateConversionError formatVnd formatVnDateIso; do
  echo "$sym: $(grep -c "\b$sym\b" src/core/shopeeReportImport.ts) lan"
done
```
Cái nào chỉ còn `1` (dòng import) thì xoá khỏi import. (`todayVnIso` vẫn dùng.)

- [ ] **Step 7: Chạy typecheck + TOÀN BỘ test — đây là phép thử refactor**

```bash
npm run typecheck && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
git diff --stat HEAD -- src/core/__tests__/shopeeReportImport.test.ts src/core/__tests__/shopeeReportOrderDate.test.ts src/core/__tests__/shopeeReportSmallHold.test.ts src/core/__tests__/payoutDebt.test.ts
```
Expected: `pass 971` (947 + 24), `fail 0`, và lệnh `git diff --stat` cuối **in ra rỗng**.

Nếu một test Shopee đỏ → **KHÔNG sửa test**. Đọc diff giữa outcome mapping và vòng lặp cũ (`git diff HEAD -- src/core/shopeeReportImport.ts`), tìm nhánh chép sai, sửa ở `orderStatusApply.ts`/bảng map.

- [ ] **Step 8: Commit**

```bash
git add src/core/orderStatusApply.ts src/core/__tests__/orderStatusApply.test.ts src/core/shopeeReportImport.ts
git commit -F - <<'EOF'
refactor(ledger): tach orderStatusApply khoi importShopeeReport

Chuyen NGUYEN VAN phan ap trang thai mot don vao ledger (bang 5 ca huy, tu huy
yeu cau rut, ghi no, hoan don nho, canh bao hoa hong bi khoa) sang module dung
chung de duong doi soat TikTok khong phai chep ~200 dong logic tien.

KHONG DOI HANH VI: 4 file test Shopee xanh khong sua dong nao (baseline 947 pass).
orderStatusApply khong biet san nao; test truc tiep chay voi ca hai merchant.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```


---

### Task 2: `tiktokCommission.ts` + sửa `estimateFrom()` (hằng số 0,9 dùng ở HAI nơi)

**Files:**
- Create: `src/core/tiktokCommission.ts`
- Create: `src/core/__tests__/tiktokCommission.test.ts`
- Modify: `src/core/providers/tiktokAffiliateProvider.ts` (hàm `estimateFrom`, dòng ~122-126)
- Modify: `src/core/__tests__/tiktokAffiliateProvider.test.ts` (3 assertion số tiền: 300→270, 12000→10800, 500→450)

**Interfaces:**
- Produces (Task 4 dùng):
  ```ts
  export const TIKTOK_PIT_RETAINED_RATIO = 0.9;
  export const TIKTOK_ACTUAL_SHORTFALL_SLACK = 0.02;
  export function estimateTiktokNetCommission(grossVnd: number): number;
  export function isActualBelowAssumed(estVnd: number, actualVnd: number): boolean;
  ```

**Vì sao task này sửa code đang chạy thật:** `estimateFrom()` hiện tính `price × rate` = cùng cơ sở thô với `est_commission`. Để nguyên thì bot hứa cao hơn số ghi vào ledger trên mọi đơn (spec 5.4b).

- [ ] **Step 1: Viết test (sẽ FAIL vì module chưa có)**

`src/core/__tests__/tiktokCommission.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { RiohubClient, type RiohubFetchLike } from "../providers/riohubClient.js";
import { TiktokAffiliateProvider } from "../providers/tiktokAffiliateProvider.js";
import {
  TIKTOK_ACTUAL_SHORTFALL_SLACK,
  TIKTOK_PIT_RETAINED_RATIO,
  estimateTiktokNetCommission,
  isActualBelowAssumed,
} from "../tiktokCommission.js";

test("hang so: giu 90% sau khi TikTok khau tru pit, bien canh bao 2%", () => {
  assert.equal(TIKTOK_PIT_RETAINED_RATIO, 0.9);
  assert.equal(TIKTOK_ACTUAL_SHORTFALL_SLACK, 0.02);
});

test("estimateTiktokNetCommission: don that 2.136d -> 1.922d, lam tron 1 lan", () => {
  assert.equal(estimateTiktokNetCommission(2136), 1922);
  assert.equal(estimateTiktokNetCommission(3190), 2871);
  assert.equal(estimateTiktokNetCommission(0), 0);
  assert.equal(estimateTiktokNetCommission(5), 5); // 4,5 -> 5 (Math.round)
});

test("isActualBelowAssumed: so sanh thang voi assumed tru bien", () => {
  // est 2136 -> assumed 1922, bien round(42,72)=43 -> nguong 1879
  assert.equal(isActualBelowAssumed(2136, 1922), false, "dung bang so da tra");
  assert.equal(isActualBelowAssumed(2136, 1879), false, "cham nguong van chua canh bao");
  assert.equal(isActualBelowAssumed(2136, 1878), true);
  assert.equal(isActualBelowAssumed(2136, 0), true, "MCN giu het");
  assert.equal(isActualBelowAssumed(2136, 2136), false, "thuc nhan CAO hon so da tra: khong phai van de");
});

function providerReturning(payload: unknown) {
  const fetchImpl: RiohubFetchLike = async () => ({ ok: true, status: 200, json: async () => payload });
  return new TiktokAffiliateProvider({
    client: new RiohubClient({ apiKey: "k", baseUrls: ["https://a.test/api/v1"], fetchImpl }),
    creatorUsername: "creator1",
    channel: "bot",
  });
}

test("estimateFrom (cau bot gui luc tra link) va ledger dung CUNG mot cong thuc", async () => {
  // gia 10.000d, rate 5,00% -> hoa hong tho 500d. Ledger ghi estimateTiktokNetCommission(500).
  const out = await providerReturning({
    affiliate_link: "https://x",
    product: { commission: { rate: 500 }, sales_price: { minimum_amount: "10000" } },
  }).createAffiliateLink({
    merchant: "tiktokshop",
    productUrl: "https://shop.tiktok.com/vn/pdp/1",
    subId: "m-1-a-b",
  });
  assert.equal(out.commissionEstimate?.estimatedAmount, estimateTiktokNetCommission(500));
  assert.equal(out.commissionEstimate?.estimatedAmount, 450);
});
```

- [ ] **Step 2: Chạy → FAIL**

```bash
npx tsx --test src/core/__tests__/tiktokCommission.test.ts 2>&1 | tail -6
```
Expected: `Cannot find module '../tiktokCommission.js'`.

- [ ] **Step 3: Tạo `src/core/tiktokCommission.ts`**

```ts
/**
 * Hang so + phep tinh hoa hong TikTok dung CHUNG o hai noi (spec 5.4b):
 *  1. tiktokOrderImport.ts  - hoa hong goc ghi vao ledger.
 *  2. tiktokAffiliateProvider.ts (estimateFrom) - cau uoc tinh bot gui LUC TRA LINK.
 * Lech nhau = bot noi sai. Co test chan.
 */

/**
 * Phan hoa hong con lai SAU khi TikTok khau tru thue TNCN tai nguon (field `pit`).
 *
 * 0,9 doc tu tai lieu RioHub ("10% phan HH chuan, ap cho ca creator thuong") - CHUA DO duoc tren don
 * that nao vi chua don nao quyet toan. Doi so nay khi thay `pit` that: canh bao
 * `tiktok_actual_below_assumed` (spec 7.1b) la thu bat duoc dung luc do.
 *
 * Vi sao phai co: `est_commission` va gia tri `estimateFrom()` deu la so THO (GMV x rate), chua tru
 * thue. Dua so tho vao duong tien la hua cao hon thuc nhan tren MOI don.
 */
export const TIKTOK_PIT_RETAINED_RATIO = 0.9;

/** Bien bo qua khi so actual voi so da tra user: hap thu lam tron va phi reward nho (spec 7.1b). */
export const TIKTOK_ACTUAL_SHORTFALL_SLACK = 0.02;

/** Hoa hong goc TikTok dua vao ledger / cau uoc tinh, tu hoa hong THO. Lam tron DUNG MOT LAN. */
export function estimateTiktokNetCommission(grossVnd: number): number {
  return Math.round(grossVnd * TIKTOK_PIT_RETAINED_RATIO);
}

/**
 * actual_commission (sau khi quyet toan) co THAP HON so da dung de tra user khong? So thang voi
 * `assumed` tru bien - KHONG dung bieu thuc thu hai cho cung mot nguong (de lech khi sua).
 * Thuc nhan CAO hon so da tra thi KHONG phai van de (tra it hon nhan).
 */
export function isActualBelowAssumed(estVnd: number, actualVnd: number): boolean {
  const assumed = estimateTiktokNetCommission(estVnd);
  const slack = Math.round(estVnd * TIKTOK_ACTUAL_SHORTFALL_SLACK);
  return actualVnd < assumed - slack;
}
```

- [ ] **Step 4: Sửa `estimateFrom()`** — trong `src/core/providers/tiktokAffiliateProvider.ts`

Thêm import ở đầu file (cạnh các import khác):
```ts
import { estimateTiktokNetCommission } from "../tiktokCommission.js";
```
Thay khối `return { ratePercent, estimatedAmount: ..., currency: "VND" }`:

```ts
  // TikTok KHONG co tran hoa hong nhu Shopee (40k) nen nhan tay la hop le - khac han quy tac cung
  // cua Shopee la phai lay thang field `commission`. Nhung price x rate la hoa hong THO (chua tru
  // `pit` TikTok khau tru tai nguon) - phai qua estimateTiktokNetCommission de khop so ghi vao ledger.
  return {
    ratePercent,
    estimatedAmount: estimateTiktokNetCommission((price * ratePercent) / 100),
    currency: "VND",
  };
```

- [ ] **Step 5: Sửa 3 assertion cũ** trong `src/core/__tests__/tiktokAffiliateProvider.test.ts` (đây là thay đổi hành vi CÓ CHỦ ĐÍCH, đã duyệt ở spec 2.2b)

| Dòng | Cũ | Mới | Tính |
|---|---|---|---|
| 65 | `estimatedAmount, 300` | `270` | 300 × 0,9 |
| 81 | `estimatedAmount, 12000` | `10800` | 12000 × 0,9 |
| 92 | `estimatedAmount, 500` | `450` | 500 × 0,9 |

Thêm 1 dòng comment trên mỗi assertion: `// 0,9 = TIKTOK_PIT_RETAINED_RATIO (spec 2.2b)`.

- [ ] **Step 6: Chạy test + typecheck**

```bash
npm run typecheck && npx tsx --test src/core/__tests__/tiktokCommission.test.ts src/core/__tests__/tiktokAffiliateProvider.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|✖"
npm test 2>&1 | grep -E "^ℹ (pass|fail)"
git diff --stat HEAD -- src/core/__tests__/shopeeReport*.test.ts src/core/__tests__/payoutDebt.test.ts
```
Expected: mọi test xanh, `fail 0`, lệnh `git diff --stat` cuối **rỗng**.

- [ ] **Step 7: Commit**

```bash
git add src/core/tiktokCommission.ts src/core/__tests__/tiktokCommission.test.ts src/core/providers/tiktokAffiliateProvider.ts src/core/__tests__/tiktokAffiliateProvider.test.ts
git commit -F - <<'EOF'
fix(tiktok): uoc tinh luc tra link tru pit, dung chung hang so voi ledger

estimateFrom() tinh price x rate = hoa hong THO, cung co so voi est_commission,
chua tru thue pit TikTok khau tru tai nguon. De nguyen thi bot hua cao hon so se
ghi vao ledger tren MOI don (1.522d vs 1.370d tren don that).

Dua 0,9 thanh hang so TIKTOK_PIT_RETAINED_RATIO dung o ca hai noi (ledger va cau
bot gui), co test chan lech. 3 assertion cu doi theo, co chu dich (spec 2.2b).

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: `formatVnTimeHms()` trong `vietnamDate.ts`

**Files:**
- Modify: `src/core/vietnamDate.ts` (thêm hàm cuối file)
- Modify: `src/core/__tests__/vietnamDate.test.ts` (thêm test; **import mở rộng**)

**Interfaces:**
- Produces (Task 4 dùng): `export function formatVnTimeHms(date: Date): string` — `"HH:mm:ss"` giờ VN, 24 giờ, `00:xx:xx` cho nửa đêm (KHÔNG phải `24:xx:xx`).

- [ ] **Step 1: Viết test FAIL trước**

Sửa dòng import đầu `src/core/__tests__/vietnamDate.test.ts` thành:
```ts
import { addDaysToVnIso, formatVnDateDdMm, formatVnDateIso, formatVnTimeHms, todayVnIso, yesterdayVnDdMm } from "../vietnamDate.js";
```
Thêm cuối file:
```ts
test("formatVnTimeHms: doi UTC sang gio VN (+07), dung vi du trong tai lieu RioHub", () => {
  // API tra 2026-10-08 06:52:18 UTC, dashboard RioHub hien 13:52:18 gio VN.
  assert.equal(formatVnTimeHms(new Date("2026-10-08T06:52:18Z")), "13:52:18");
});

test("formatVnTimeHms: nua dem gio VN la 00:xx, KHONG phai 24:xx", () => {
  // 2026-09-05T17:30:00Z = 00:30 ngay 06/09 gio VN
  assert.equal(formatVnTimeHms(new Date("2026-09-05T17:30:00Z")), "00:30:00");
});

test("formatVnTimeHms: doi thang va doi nam van dung gio, ngay di cung nhau", () => {
  const monthEnd = new Date("2026-09-30T17:00:00Z"); // 00:00 ngay 01/10 gio VN
  assert.equal(formatVnTimeHms(monthEnd), "00:00:00");
  assert.equal(formatVnDateIso(monthEnd), "2026-10-01");
  const yearEnd = new Date("2026-12-31T17:00:00Z"); // 00:00 ngay 01/01/2027 gio VN
  assert.equal(formatVnTimeHms(yearEnd), "00:00:00");
  assert.equal(formatVnDateIso(yearEnd), "2027-01-01");
});
```

- [ ] **Step 2: Chạy → FAIL** (`formatVnTimeHms is not a function` / lỗi import)

```bash
npx tsx --test src/core/__tests__/vietnamDate.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|SyntaxError|not.*function" | head
```

- [ ] **Step 3: Thêm hàm** vào cuối `src/core/vietnamDate.ts`:

```ts

/**
 * "HH:mm:ss" cua 1 thoi diem theo gio VN, 24 gio. Dung cho cot order_time (gio dat don) khi nguon tra
 * thoi diem dang UTC (RioHub `time_created_iso`) - bao cao Shopee thi tra san gio VN nen chua can.
 *
 * hourCycle "h23" la BAT BUOC: hour12:false tren mot so ban ICU in nua dem la "24:30:00".
 */
export function formatVnTimeHms(date: Date): string {
  return date.toLocaleTimeString("en-GB", { timeZone: VN_TIME_ZONE, hourCycle: "h23" });
}
```

- [ ] **Step 4: Chạy → PASS, rồi toàn bộ + commit**

```bash
npx tsx --test src/core/__tests__/vietnamDate.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"
npm run typecheck && npm test 2>&1 | grep -E "^ℹ (pass|fail)"
git add src/core/vietnamDate.ts src/core/__tests__/vietnamDate.test.ts
git commit -F - <<'EOF'
feat(vietnamDate): formatVnTimeHms cho gio dat don tu moc UTC

Shopee doc thang gio tu chuoi CSV nen chua bao gio can doi mui gio cho gio.
RioHub tra UTC (time_created_iso) nen can. hourCycle h23 tranh "24:30:00".

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: `riohubOrdersSource.ts` + `tiktokOrderImport.ts`

**Files:**
- Create: `src/core/providers/riohubOrdersSource.ts`
- Create: `src/core/tiktokOrderImport.ts`
- Create: `src/core/__tests__/riohubOrdersSource.test.ts`
- Create: `src/core/__tests__/tiktokOrderImport.test.ts`
- Create: `src/core/__tests__/tiktokOrderIsolation.test.ts`

**Interfaces:**
- Consumes: `applyOrderStatusToLedger` / `OrderStatusOutcome` (Task 1), `estimateTiktokNetCommission` / `isActualBelowAssumed` (Task 2), `formatVnTimeHms` (Task 3), `RiohubClient.get` + `RIOHUB_TIKTOK_PATH_PREFIX` (có sẵn trên nhánh).
- Produces (Task 5 dùng):
  ```ts
  // riohubOrdersSource.ts
  export async function fetchTiktokOrders(client: Pick<RiohubClient, "get">, creatorUsername: string): Promise<RiohubOrderRecord[]>;
  export function createTiktokOrdersFetcher(cfg: {
    enabled: boolean; apiKey: string; creatorUsername: string; baseUrls: readonly string[]; timeoutMs: number;
  }): (() => Promise<RiohubOrderRecord[]>) | null;
  // tiktokOrderImport.ts
  export interface RiohubOrderRecord { ... }
  export interface TiktokOrderImportResult { ... }   // xem Step 6
  export function importTiktokOrders(logStore: LogStore, ledgerStore: LedgerStore,
    config: { recordOrderConfig: RecordOrderConfig }, orders: RiohubOrderRecord[]): TiktokOrderImportResult;
  export function parseRiohubMoney(v: unknown): number | null;
  ```

#### Phần A — nguồn dữ liệu (chỗ DUY NHẤT gọi mạng)

- [ ] **Step 1: Viết test nguồn (FAIL trước)** — `src/core/__tests__/riohubOrdersSource.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTiktokOrdersFetcher, fetchTiktokOrders } from "../providers/riohubOrdersSource.js";
import type { RiohubOrderRecord } from "../tiktokOrderImport.js";

type Query = Record<string, string | number | undefined>;

function fakeClient(pages: Array<RiohubOrderRecord[] | object>, calls: Query[] = []) {
  return {
    get: async <T>(_path: string, query: Query): Promise<T> => {
      calls.push(query);
      const page = Number(query.page);
      const body = pages[page - 1] ?? [];
      return (Array.isArray(body) ? { data: body } : body) as T;
    },
  };
}

const row = (i: number): RiohubOrderRecord => ({ order_id: `O${i}`, sku_id: `S${i}` });
const rows = (from: number, n: number) => Array.from({ length: n }, (_, k) => row(from + k));

test("1 trang chua day -> tra het, goi dung 1 lan, gui creator_username va page_size", async () => {
  const calls: Query[] = [];
  const out = await fetchTiktokOrders(fakeClient([rows(0, 3)], calls) as never, "creator1");
  assert.equal(out.length, 3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].creator_username, "creator1");
  assert.equal(calls[0].page_size, 200);
});

test("trang day 200 -> lay tiep trang sau, gop lai", async () => {
  const calls: Query[] = [];
  const out = await fetchTiktokOrders(fakeClient([rows(0, 200), rows(200, 3)], calls) as never, "c");
  assert.equal(out.length, 203);
  assert.deepEqual(calls.map((c) => c.page), [1, 2]);
});

test("tham so `page` bi API nuot (trang sau tra y het trang truoc) -> NEM LOI, khong lap vo han", async () => {
  const same = rows(0, 200);
  await assert.rejects(
    () => fetchTiktokOrders(fakeClient([same, same, same]) as never, "c"),
    /phan trang/i
  );
});

test("phan hoi khong co `data` lan `orders` -> nem loi, KHONG coi la 0 don", async () => {
  await assert.rejects(() => fetchTiktokOrders(fakeClient([{ total: 5 }]) as never, "c"), /dinh dang/i);
});

test("createTiktokOrdersFetcher: tat hoac thieu cau hinh -> null", () => {
  const base = { enabled: true, apiKey: "k", creatorUsername: "u", baseUrls: [], timeoutMs: 1000 };
  assert.equal(createTiktokOrdersFetcher({ ...base, enabled: false }), null);
  assert.equal(createTiktokOrdersFetcher({ ...base, apiKey: "" }), null);
  assert.equal(createTiktokOrdersFetcher({ ...base, creatorUsername: "" }), null);
  assert.equal(typeof createTiktokOrdersFetcher(base), "function");
});
```

- [ ] **Step 2: Chạy → FAIL** (module chưa có)

```bash
npx tsx --test src/core/__tests__/riohubOrdersSource.test.ts 2>&1 | tail -5
```

- [ ] **Step 3: Tạo `src/core/providers/riohubOrdersSource.ts`**

```ts
/**
 * Keo toan bo don TikTok tu RioHub (GET /orders). Day la CHO DUY NHAT cua duong doi soat goi mang -
 * tiktokOrderImport.ts nhan mot mang va khong biet gi ve HTTP.
 *
 * KHONG loc theo ngay (spec 3.2): tham so sai ten/sai dinh dang bi API nuot im lang va tra ve toan
 * bo lich su, nen code buoc phai chiu duoc ca quet toan bo. Voi vai tram don thi quet het la du.
 *
 * Chinh bai hoc "tham so bi nuot" cung ap cho `page`: neu API bo qua no, trang sau se tra Y HET trang
 * truoc va vong lap chay den het MAX_PAGES voi du lieu nhan doi. Nen moi trang phai co it nhat mot don
 * MOI so voi cac trang truoc, khong thi nem loi.
 */
import type { RiohubOrderRecord } from "../tiktokOrderImport.js";
import { RIOHUB_TIKTOK_PATH_PREFIX, RiohubClient } from "./riohubClient.js";

const ORDERS_PATH = `${RIOHUB_TIKTOK_PATH_PREFIX}/orders`;
const PAGE_SIZE = 200;
const MAX_PAGES = 50;

interface OrdersResponse {
  data?: RiohubOrderRecord[];
  orders?: RiohubOrderRecord[];
}

export async function fetchTiktokOrders(
  client: Pick<RiohubClient, "get">,
  creatorUsername: string
): Promise<RiohubOrderRecord[]> {
  const all: RiohubOrderRecord[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await client.get<OrdersResponse>(ORDERS_PATH, {
      creator_username: creatorUsername,
      page,
      page_size: PAGE_SIZE,
    });
    const rows = res.data ?? res.orders;
    if (rows === undefined) {
      throw new Error(
        "RioHub /orders tra ve khong co `data` lan `orders` - dinh dang da doi. Dung dong bo de khong ghi sai tien."
      );
    }

    let fresh = 0;
    for (const r of rows) {
      const key = `${r.order_id ?? ""}|${r.sku_id ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(r);
      fresh += 1;
    }
    if (rows.length > 0 && fresh === 0) {
      throw new Error(
        `RioHub /orders trang ${page} tra ve toan don da thay o trang truoc - tham so phan trang co the dang bi bo qua. Dung dong bo.`
      );
    }
    if (rows.length < PAGE_SIZE) return all;
  }
  throw new Error(`RioHub /orders vuot ${MAX_PAGES} trang (${MAX_PAGES * PAGE_SIZE} don) - can them bo loc ngay (xem spec 3.2).`);
}

/**
 * Tra ve ham keo don, hoac `null` khi TikTok tat / thieu cau hinh - null nghia la duong doi soat TRO
 * HOAN TOAN (khong the, khong route). Giong cach createTiktokProvider() tu tat khi thieu key.
 */
export function createTiktokOrdersFetcher(cfg: {
  enabled: boolean;
  apiKey: string;
  creatorUsername: string;
  baseUrls: readonly string[];
  timeoutMs: number;
}): (() => Promise<RiohubOrderRecord[]>) | null {
  if (!cfg.enabled || cfg.apiKey === "" || cfg.creatorUsername === "") return null;
  const client = new RiohubClient({ apiKey: cfg.apiKey, baseUrls: cfg.baseUrls, timeoutMs: cfg.timeoutMs });
  return () => fetchTiktokOrders(client, cfg.creatorUsername);
}
```

(Test nguồn sẽ còn đỏ tới hết Step 6 vì `RiohubOrderRecord` nằm ở `tiktokOrderImport.ts` — chạy lại ở Step 9.)

#### Phần B — import thuần

- [ ] **Step 4: Viết test import (FAIL trước)** — `src/core/__tests__/tiktokOrderImport.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCommissionBreakdown } from "../commissionMath.js";
import { LedgerStore } from "../ledgerStore.js";
import { LogStore } from "../logStore.js";
import { estimateTiktokNetCommission } from "../tiktokCommission.js";
import { importTiktokOrders, parseRiohubMoney, type RiohubOrderRecord } from "../tiktokOrderImport.js";
import { addDaysToVnIso, todayVnIso } from "../vietnamDate.js";

const TODAY = todayVnIso();
const iso = (daysAgo: number): string => new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString();

/** user nhan 100% de hoa hong trong fixture chinh la user_share - de doi chieu voi nguong 100.000. */
const CONFIG = {
  recordOrderConfig: {
    taxPercent: 0,
    platformFeePercent: 0,
    userSharePercent: 100,
    maxCommissionRatioPercent: 1000,
    holdConfig: { thresholdVnd: 100_000, holdDays: 7, smallHoldDays: 1 },
  },
};

const BOT_SUB = "k-9053348487804998642-mv16nixs-f85f8a";

function seed(logStore: LogStore, subId = BOT_SUB, merchant: "tiktokshop" | "shopee" = "tiktokshop") {
  logStore.record({
    platform: "zalo",
    merchant,
    userId: "user-a",
    originalUrl: "https://shop.tiktok.com/vn/pdp/1",
    subId,
    outcome: "success",
    errorCode: null,
    affiliateUrl: "https://www.tiktok.com/t/x/",
  });
}

/** Dong don co ban. Moi truong co the ghi de. status 1 = cho, chua giao. */
function row(over: Partial<RiohubOrderRecord> = {}): RiohubOrderRecord {
  return {
    order_id: "O1",
    sku_id: "S1",
    product_name: "San pham test",
    sub_id: BOT_SUB,
    status: 1,
    commission_gmv: "100000.00",
    est_commission: "3000.00",
    actual_commission: null,
    shared_with_partner: null,
    pit: null,
    time_created_iso: "2026-10-08T06:52:18Z",
    time_delivered_iso: null,
    ...over,
  };
}

function run(orders: RiohubOrderRecord[], seedLog = true) {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  if (seedLog) seed(logStore);
  const result = importTiktokOrders(logStore, ledgerStore, CONFIG, orders);
  return {
    result,
    ledgerStore,
    logStore,
    entry: (id = "O1") => ledgerStore.getEntryByOrderId("tiktokshop", id),
    done: () => {
      logStore.close();
      ledgerStore.close();
    },
  };
}

// ---------------------------------------------------------------- parse tien

test("parseRiohubMoney: chuoi rong va null la null, KHAC so 0 (0 la gia tri that)", () => {
  assert.equal(parseRiohubMoney(""), null);
  assert.equal(parseRiohubMoney("  "), null);
  assert.equal(parseRiohubMoney(null), null);
  assert.equal(parseRiohubMoney(undefined), null);
  assert.equal(parseRiohubMoney("0"), 0);
  assert.equal(parseRiohubMoney("0.00"), 0);
  assert.equal(parseRiohubMoney("2136.00"), 2136);
  assert.equal(parseRiohubMoney(-500), -500);
  assert.equal(parseRiohubMoney("abc"), null);
});

// ------------------------------------------------- 4 don THAT (output CLI 2026-10-11)
// Fixture dung lai tu output `npm run riohub:orders`: order_id, sub_id, est_commission, moc thoi gian
// la SO THAT; commission_gmv va ten san pham la uoc luong (CLI khong in) - khong anh huong ket qua.

const REAL = {
  botLatest: row({
    order_id: "586514613873640731",
    sub_id: "k-9053348487804998642-mv19z39z-acc5c0",
    est_commission: "3190.00",
    time_created_iso: "2026-10-10T08:47:28Z",
  }),
  botFirst: row({
    order_id: "586502233699747518",
    sub_id: BOT_SUB,
    est_commission: "2136.00",
    time_created_iso: "2026-10-09T16:34:52Z",
  }),
  external: row({
    order_id: "586494603346282174",
    sub_id: "u35008-m1791535058",
    est_commission: "500.00",
    time_created_iso: "2026-10-09T08:38:20Z",
  }),
  externalDelivered: row({
    order_id: "586474851567371966",
    sub_id: "",
    est_commission: "480.00",
    time_created_iso: "2026-10-08T06:52:18Z",
    time_delivered_iso: "2026-10-10T07:49:05Z",
  }),
};

test("4 don that: 2 don bot -> pending, tien = est x 0,9; don ngoai bi bo qua dung ly do", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seed(logStore, "k-9053348487804998642-mv19z39z-acc5c0");
    seed(logStore, BOT_SUB);
    const r = importTiktokOrders(logStore, ledgerStore, CONFIG, Object.values(REAL));

    assert.equal(r.ordersScanned, 4);
    assert.equal(r.pendingNew, 2);
    assert.equal(r.confirmedNew, 0);
    assert.equal(r.skippedSubIdNotFound, 1, "sub_id kieu app RioHub (2 doan) khong co trong log bot");
    assert.equal(r.skippedNoSubId, 1, "sub_id la chuoi RONG, khong phai null");
    assert.deepEqual(r.newOrderIds.sort(), ["586502233699747518", "586514613873640731"]);

    const a = ledgerStore.getEntryByOrderId("tiktokshop", "586502233699747518");
    assert.equal(a?.commissionAmount, estimateTiktokNetCommission(2136)); // 1.922
    assert.equal(a?.commissionAmount, 1922);
    assert.equal(ledgerStore.getEntryByOrderId("tiktokshop", "586514613873640731")?.commissionAmount, 2871);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

test("don that 2.136d voi cau hinh chot 10/1/80: user nhan dung bang computeCommissionBreakdown(1.922)", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seed(logStore);
    const cfg = { recordOrderConfig: { ...CONFIG.recordOrderConfig, taxPercent: 10, platformFeePercent: 1, userSharePercent: 80 } };
    importTiktokOrders(logStore, ledgerStore, cfg, [REAL.botFirst]);
    const expected = computeCommissionBreakdown({
      commissionAmount: 1922,
      taxPercent: 10,
      platformFeePercent: 1,
      userSharePercent: 80,
    }).userShareAmount;
    assert.equal(ledgerStore.getEntryByOrderId("tiktokshop", REAL.botFirst.order_id!)?.userShareAmount, expected);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

// ------------------------------------------------ moc confirmed = GIAO HANG (spec 5.3)

test("DA GIAO nhung chua quyet toan (status 1) -> CONFIRMED ngay, khong cho actual_commission", () => {
  // Test chan quan trong nhat cua spec 5.3: viet sai la user phai doi ~15 ngay.
  const t = run([row({ est_commission: "3000.00", time_delivered_iso: iso(2) })]);
  try {
    assert.equal(t.entry()?.status, "confirmed");
    assert.equal(t.result.confirmedNew, 1);
    assert.equal(t.result.confirmedByUser.length, 1);
  } finally {
    t.done();
  }
});

test("don NHO giao HOM NAY -> nam lai pending (giam 1 ngay), khong sinh tin 'don ve'", () => {
  const t = run([row({ time_delivered_iso: new Date().toISOString() })]);
  try {
    assert.equal(t.entry()?.status, "pending");
    assert.equal(t.result.smallHoldDeferred, 1);
    assert.equal(t.result.confirmedNew, 0);
    assert.deepEqual(t.result.confirmedByUser, []);
    assert.deepEqual(t.result.newOrderIds, ["O1"]);
  } finally {
    t.done();
  }
});

test("don TO giao hom nay -> confirmed nhung bi giam 7 ngay (available_from), dem vao heldCount", () => {
  const t = run([row({ est_commission: "150000.00", commission_gmv: "3000000.00", time_delivered_iso: new Date().toISOString() })]);
  try {
    assert.equal(t.entry()?.commissionAmount, 135_000);
    assert.equal(t.entry()?.status, "confirmed");
    assert.equal(t.entry()?.availableFrom, addDaysToVnIso(TODAY, 7));
    assert.equal(t.result.heldCount, 1);
  } finally {
    t.done();
  }
});

test("status 2 (da quyet toan) KHONG co time_delivered -> van di nhanh confirmed, completedAt null", () => {
  // Dung don TO: don nho khong biet ngay giao lui ve HOM NAY roi bi giu 1 ngay o pending (dung
  // resolveConfirmPlan), nen khong thay duoc "confirmed" - khong phai loi.
  const t = run([row({ status: 2, est_commission: "150000.00", commission_gmv: "3000000.00", actual_commission: "135000.00" })]);
  try {
    assert.equal(t.entry()?.status, "confirmed");
    assert.equal(t.entry()?.completedAt, null);
    assert.equal(t.entry()?.availableFrom, addDaysToVnIso(TODAY, 7), "lui ve hom nay + 7 ngay giam don to");
  } finally {
    t.done();
  }
});

test("hoa hong ghi vao ledger KHONG doi khi don chuyen pending -> confirmed -> quyet toan (1 cong thuc)", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seed(logStore);
    importTiktokOrders(logStore, ledgerStore, CONFIG, [row()]);
    const before = ledgerStore.getEntryByOrderId("tiktokshop", "O1")!.commissionAmount;
    importTiktokOrders(logStore, ledgerStore, CONFIG, [row({ time_delivered_iso: iso(2) })]);
    importTiktokOrders(logStore, ledgerStore, CONFIG, [
      row({ status: 2, time_delivered_iso: iso(2), actual_commission: "1000.00" }),
    ]);
    // actual THAP hon nhieu nhung KHONG duoc phep sua so da chot - chi canh bao.
    assert.equal(ledgerStore.getEntryByOrderId("tiktokshop", "O1")!.commissionAmount, before);
    assert.equal(before, 2700);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

// ------------------------------------------------------------- gop dong / SKU

test("don nhieu SKU: dong da huy (status 3) bi LOAI khoi tong tien; mergedMultiSku dem 1", () => {
  const t = run([
    row({ sku_id: "S1", status: 2, est_commission: "1000.00", commission_gmv: "10000.00", time_delivered_iso: iso(2) }),
    row({ sku_id: "S2", status: 3, est_commission: "5000.00", commission_gmv: "50000.00" }),
  ]);
  try {
    assert.equal(t.result.mergedMultiSku, 1);
    assert.equal(t.entry()?.commissionAmount, 900); // 1000 x 0,9 - khong tinh dong da huy
    assert.equal(t.entry()?.orderAmount, 10_000);
    assert.equal(t.entry()?.status, "confirmed");
  } finally {
    t.done();
  }
});

test("don nhieu SKU: con 1 dong chua giao & chua quyet toan -> ca don van PENDING", () => {
  const t = run([
    row({ sku_id: "S1", status: 2 }),
    row({ sku_id: "S2", status: 1, time_delivered_iso: null }),
  ]);
  try {
    assert.equal(t.entry()?.status, "pending");
  } finally {
    t.done();
  }
});

test("ten san pham: dong hoa hong cao nhat + hau to (+N san pham khac)", () => {
  const t = run([
    row({ sku_id: "S1", product_name: "Re", est_commission: "100.00" }),
    row({ sku_id: "S2", product_name: "Dat", est_commission: "900.00" }),
    row({ sku_id: "S3", product_name: "Giua", est_commission: "500.00" }),
  ]);
  try {
    assert.equal(t.entry()?.productName, "Dat (+2 san pham khac)");
  } finally {
    t.done();
  }
});

// -------------------------------------------------------------- huy / hoan

test("TOAN dong status 3 -> reversed, KE CA khi est_commission rong o moi dong (khong bi chot 'no estimate' chan)", () => {
  // Bay da gap khi soat spec: dieu kien "khong dong nao co est" dung mot cach RONG TUECH voi don
  // toan dong da huy, va se bo qua MOI don huy => tien khong bao gio duoc thu hoi.
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seed(logStore);
    importTiktokOrders(logStore, ledgerStore, CONFIG, [row()]); // pending
    const r = importTiktokOrders(logStore, ledgerStore, CONFIG, [row({ status: 3, est_commission: null })]);
    assert.equal(r.skippedNoEstimate, 0);
    assert.equal(r.reversedCount, 1);
    assert.equal(ledgerStore.getEntryByOrderId("tiktokshop", "O1")?.status, "reversed");
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

test("don huy chua tung thay -> khong tao entry, khong dem reversedCount", () => {
  const t = run([row({ status: 3 })]);
  try {
    assert.equal(t.entry(), null);
    assert.equal(t.result.reversedCount, 0);
  } finally {
    t.done();
  }
});

test("status la (khong phai 1/2/3) -> bo qua CA DON, khong ghi", () => {
  const t = run([row({ status: 9 })]);
  try {
    assert.equal(t.result.skippedUnknownStatus, 1);
    assert.equal(t.entry(), null);
    const t2 = run([row({ status: null })]);
    assert.equal(t2.result.skippedUnknownStatus, 1);
    t2.done();
  } finally {
    t.done();
  }
});

test("don con song ma KHONG dong nao co est_commission -> bo qua + dem skippedNoEstimate", () => {
  const t = run([row({ est_commission: null })]);
  try {
    assert.equal(t.result.skippedNoEstimate, 1);
    assert.equal(t.entry(), null);
  } finally {
    t.done();
  }
});

test("dong co refunded_quantity > 0 nhung status khac 3 -> den bao re trong errors (khoang ho spec 5.8)", () => {
  const t = run([row({ refunded_quantity: 1 })]);
  try {
    assert.ok(t.result.errors.some((e) => /refunded_quantity/.test(e) && /O1/.test(e)));
    assert.equal(t.entry()?.status, "pending", "van ghi don, chi bao");
  } finally {
    t.done();
  }
});

// ---------------------------------------------------------------- quy ve user

test("sub_id null va sub_id rong deu la skippedNoSubId", () => {
  const t = run([row({ order_id: "A", sub_id: null }), row({ order_id: "B", sub_id: "" })]);
  try {
    assert.equal(t.result.skippedNoSubId, 2);
  } finally {
    t.done();
  }
});

test("sub_id khong co trong log bot -> skippedSubIdNotFound", () => {
  const t = run([row({ sub_id: "k-khong-ton-tai-0-0" })]);
  try {
    assert.equal(t.result.skippedSubIdNotFound, 1);
  } finally {
    t.done();
  }
});

// ---------------------------------------------------------------------- ngay

test("ngay/gio dat don doi tu UTC sang gio VN: 06:52:18Z -> 13:52:18, cung ngay", () => {
  const t = run([row({ time_created_iso: "2026-10-08T06:52:18Z" })]);
  try {
    assert.equal(t.entry()?.orderDate, "2026-10-08");
    assert.equal(t.entry()?.orderTime, "13:52:18");
  } finally {
    t.done();
  }
});

test("17:30Z da sang NGAY SAU o VN: orderDate +1 ngay, gio 00:30:00", () => {
  const t = run([row({ time_created_iso: "2026-10-09T17:30:00Z" })]);
  try {
    assert.equal(t.entry()?.orderDate, "2026-10-10");
    assert.equal(t.entry()?.orderTime, "00:30:00");
  } finally {
    t.done();
  }
});

test("don nhieu dong: ngay dat lay dong SOM nhat, completedAt lay dong giao MUON nhat", () => {
  const t = run([
    row({ sku_id: "S1", status: 2, time_created_iso: "2026-10-08T06:00:00Z", time_delivered_iso: "2026-10-09T05:00:00Z" }),
    row({ sku_id: "S2", status: 2, time_created_iso: "2026-10-07T06:00:00Z", time_delivered_iso: "2026-10-12T05:00:00Z" }),
  ]);
  try {
    assert.equal(t.entry()?.orderDate, "2026-10-07");
    assert.equal(t.entry()?.completedAt, "2026-10-12");
  } finally {
    t.done();
  }
});

// -------------------------------------------- doi chieu / canh bao (spec muc 7)

test("settledTotals: chua don nao quyet toan -> orderCount 0 va cac tong la null (khong phai 0)", () => {
  const t = run([row()]);
  try {
    assert.deepEqual(t.result.settledTotals, {
      orderCount: 0,
      estTotal: 0,
      actualTotal: null,
      pitTotal: null,
      sharedWithPartnerTotal: null,
      shortfallCount: 0,
    });
    assert.deepEqual(t.result.alerts, []);
  } finally {
    t.done();
  }
});

test("pit khac 0 KHONG sinh canh bao (ky vong khac 0 vinh vien) nhung HIEN trong settledTotals", () => {
  const t = run([row({ status: 2, est_commission: "10000.00", actual_commission: "9000.00", pit: "-1000.00", shared_with_partner: "0.00" })]);
  try {
    assert.equal(t.result.settledTotals.orderCount, 1);
    assert.equal(t.result.settledTotals.pitTotal, -1000);
    assert.equal(t.result.settledTotals.actualTotal, 9000);
    assert.equal(t.result.settledTotals.sharedWithPartnerTotal, 0);
    assert.deepEqual(t.result.alerts, []);
  } finally {
    t.done();
  }
});

test("shared_with_partner khac 0 -> canh bao tiktok_mcn_cut, ghi ro ma don va he qua", () => {
  const t = run([row({ status: 2, est_commission: "10000.00", actual_commission: "4000.00", shared_with_partner: "-5000.00" })]);
  try {
    const mcn = t.result.alerts.filter((a) => a.key === "tiktok_mcn_cut");
    assert.equal(mcn.length, 1);
    assert.match(mcn[0].message, /O1/);
    assert.match(mcn[0].message, /CAO hơn thực nhận/);
    assert.ok(t.result.errors.some((e) => /tiktok_mcn_cut|MCN/.test(e)), "cung hien tren trang ket qua");
  } finally {
    t.done();
  }
});

test("actual THAP hon so da tra (tru bien) -> canh bao tiktok_actual_below_assumed, dem shortfallCount", () => {
  // est 10.000 -> assumed 9.000, bien 200 -> nguong 8.800
  const low = run([row({ status: 2, est_commission: "10000.00", actual_commission: "8000.00" })]);
  const ok = run([row({ status: 2, est_commission: "10000.00", actual_commission: "8900.00" })]);
  try {
    assert.equal(low.result.settledTotals.shortfallCount, 1);
    assert.equal(low.result.alerts.filter((a) => a.key === "tiktok_actual_below_assumed").length, 1);
    assert.equal(ok.result.settledTotals.shortfallCount, 0);
    assert.deepEqual(ok.result.alerts, []);
  } finally {
    low.done();
    ok.done();
  }
});

test("canh bao gop theo key: nhieu don -> MOT alert moi key, liet ke don", () => {
  const t = run([
    row({ order_id: "A", status: 2, est_commission: "10000.00", actual_commission: "1000.00" }),
    row({ order_id: "B", status: 2, est_commission: "10000.00", actual_commission: "2000.00" }),
  ]);
  try {
    const a = t.result.alerts.filter((x) => x.key === "tiktok_actual_below_assumed");
    assert.equal(a.length, 1);
    assert.match(a[0].message, /A/);
    assert.match(a[0].message, /B/);
  } finally {
    t.done();
  }
});

test("canh bao tinh ca don KHONG quy duoc ve user (la tai khoan creator, khong phai chuyen cua bot)", () => {
  const t = run([row({ sub_id: "", status: 2, est_commission: "10000.00", actual_commission: "1000.00" })]);
  try {
    assert.equal(t.result.skippedNoSubId, 1);
    assert.equal(t.result.alerts.filter((a) => a.key === "tiktok_actual_below_assumed").length, 1);
  } finally {
    t.done();
  }
});

// ------------------------------------------------ dong bo lai nhieu lan (idempotent)

test("dong bo lai CUNG du lieu 2 lan khong sinh don/no moi", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seed(logStore);
    const orders = [row({ time_delivered_iso: iso(2) })];
    importTiktokOrders(logStore, ledgerStore, CONFIG, orders);
    const second = importTiktokOrders(logStore, ledgerStore, CONFIG, orders);
    assert.equal(second.confirmedNew, 0);
    assert.equal(second.confirmedDuplicate, 1);
    assert.deepEqual(second.newOrderIds, []);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});
```

`src/core/__tests__/tiktokOrderIsolation.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";
import { LogStore } from "../logStore.js";
import { importTiktokOrders } from "../tiktokOrderImport.js";

/**
 * CHOT CACH LY (spec 6.1): dong bo TikTok khong bao gio duoc ghi mot don Shopee. subId chi ma hoa
 * NEN TANG CHAT (k/m/w), khong ma hoa san, nen findBySubId co the tra ve mot request Shopee.
 */
const CONFIG = {
  recordOrderConfig: {
    taxPercent: 0,
    platformFeePercent: 0,
    userSharePercent: 100,
    maxCommissionRatioPercent: 1000,
    holdConfig: { thresholdVnd: 0, holdDays: 0 },
  },
};

test("don TikTok mang sub_id cua mot request SHOPEE -> bo qua + canh bao, ledger KHONG them dong nao", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    logStore.record({
      platform: "zalo",
      merchant: "shopee",
      userId: "user-a",
      originalUrl: "https://shopee.vn/product/1/2",
      subId: "k-user-a-abc-def",
      outcome: "success",
      errorCode: null,
      affiliateUrl: "https://s.shopee.vn/x",
    });
    const result = importTiktokOrders(logStore, ledgerStore, CONFIG, [
      {
        order_id: "TT-LAC",
        sku_id: "S1",
        sub_id: "k-user-a-abc-def",
        status: 2,
        commission_gmv: "100000.00",
        est_commission: "5000.00",
        actual_commission: "4500.00",
        time_created_iso: "2026-10-08T06:52:18Z",
      },
    ]);

    assert.equal(result.skippedForeignMerchant, 1);
    assert.equal(result.confirmedNew, 0);
    assert.equal(result.pendingNew, 0);
    assert.deepEqual(result.newOrderIds, []);
    assert.ok(result.errors.some((e) => /TT-LAC/.test(e) && /shopee/.test(e)));
    assert.equal(ledgerStore.getEntryByOrderId("shopee", "TT-LAC"), null);
    assert.equal(ledgerStore.getEntryByOrderId("tiktokshop", "TT-LAC"), null);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});
```

- [ ] **Step 5: Chạy → FAIL** (module chưa có)

```bash
npx tsx --test src/core/__tests__/tiktokOrderImport.test.ts src/core/__tests__/tiktokOrderIsolation.test.ts 2>&1 | tail -5
```

- [ ] **Step 6: Tạo `src/core/tiktokOrderImport.ts`**

```ts
/**
 * Doi soat don TikTok Shop tu RioHub vao ledger (spec 2026-10-11-doi-soat-don-tiktok-design.md).
 *
 * THUAN: nhan MANG don da keo san, khong goi mang - y het importShopeeReport nhan csvText. Phan ap
 * trang thai vao ledger la orderStatusApply.ts (dung chung voi Shopee).
 *
 * QUYET DINH TIEN (doc spec 2.2/2.2b/5.3/5.4 truoc khi sua):
 *  - Don vao Kha dung LUC GIAO HANG (time_delivered_iso) hoac status=2, KHONG cho RioHub quyet toan
 *    (SETTLED nam sau cua so tra hang 15+ ngay). Tuong duong "Hoan thanh" cua Shopee.
 *  - Hoa hong goc = round(tong est_commission dong khong huy x TIKTOK_PIT_RETAINED_RATIO), cho CA
 *    pending lan confirmed. Mot cong thuc nen KHONG bao gio phai sua so sau khi da chot.
 *  - actual_commission/pit/shared_with_partner CHI de doi chieu & canh bao, KHONG tham gia tinh tien.
 *    (Neu ai dinh dung actual de tinh tien: lay THANG field, tuyet doi khong cong lai 6 thanh phan -
 *    tra thua ~10 lan.)
 *  - Phan loai doc `status` (1/2/3), KHONG doc `settlement_status` (passthrough TikTok, co the them
 *    gia tri la).
 */
import type { LedgerStore } from "./ledgerStore.js";
import type { LogStore } from "./logStore.js";
import { formatVnd } from "./money.js";
import {
  summarizeOrderResultsByUser,
  type OrderRowResult,
  type RecordOrderConfig,
  type UserOrderSummary,
} from "./orderIngest.js";
import { applyOrderStatusToLedger } from "./orderStatusApply.js";
import { estimateTiktokNetCommission, isActualBelowAssumed } from "./tiktokCommission.js";
import type { Platform, StatusTransition } from "./types.js";
import { formatVnDateIso, formatVnTimeHms, todayVnIso } from "./vietnamDate.js";

/** Mot DONG cua GET /orders (mot SKU). Tien/decimal ve dang STRING trong JSON de giu do chinh xac. */
export interface RiohubOrderRecord {
  order_id?: string | null;
  sku_id?: string | null;
  product_name?: string | null;
  /** Don khong co subId la CHUOI RONG, khong phai null (do that 2026-10-09). */
  sub_id?: string | null;
  /** 1 cho · 2 da quyet toan · 3 huy/hoan (da chuan hoa boi RioHub). */
  status?: number | string | null;
  settlement_status?: string | null;
  commission_gmv?: string | number | null;
  est_commission?: string | number | null;
  actual_commission?: string | number | null;
  shared_with_partner?: string | number | null;
  pit?: string | number | null;
  refunded_quantity?: number | string | null;
  returned_quantity?: number | string | null;
  fully_refunded?: number | boolean | string | null;
  time_created_iso?: string | null;
  time_delivered_iso?: string | null;
}

export interface TiktokOrderImportConfig {
  recordOrderConfig: RecordOrderConfig;
}

export interface TiktokAlert {
  /** Khoa gop AlertThrottle o tang gui tin. */
  key: "tiktok_mcn_cut" | "tiktok_actual_below_assumed";
  message: string;
}

export interface TiktokOrderImportResult {
  ordersScanned: number;
  confirmedNew: number;
  confirmedDuplicate: number;
  pendingNew: number;
  pendingUpdated: number;
  reversedCount: number;
  /** Don nhieu SKU (nhieu dong) da gop thanh 1. */
  mergedMultiSku: number;
  skippedNoSubId: number;
  skippedSubIdNotFound: number;
  /** sub_id khop request cua SAN KHAC (chot cach ly, spec 6.1). */
  skippedForeignMerchant: number;
  skippedUnknownStatus: number;
  /** Don con song nhung khong dong nao co est_commission - khong co gi de ghi. */
  skippedNoEstimate: number;
  smallHoldDeferred: number;
  heldCount: number;
  debtCreatedCount: number;
  debtsByUser: Array<{ platform: Platform; userId: string; orderId: string; amount: number }>;
  cancelledWithdrawals: Array<{
    platform: Platform;
    userId: string;
    withdrawalId: string;
    amount: number;
    orderId: string;
  }>;
  confirmedByUser: UserOrderSummary[];
  newOrderIds: string[];
  statusTransitions: StatusTransition[];
  /**
   * CHI de doi chieu/canh bao, KHONG tham gia tinh tien (spec 7.2). null o field nao nghia la chua
   * quan sat duoc gia tri nao - KHAC voi 0.
   */
  settledTotals: {
    orderCount: number;
    estTotal: number;
    actualTotal: number | null;
    pitTotal: number | null;
    sharedWithPartnerTotal: number | null;
    /** So don co actual thap hon so da dung de tra user (spec 7.1b). > 0 la phai xem ngay. */
    shortfallCount: number;
  };
  /** Canh bao can DAY CHO ADMIN qua notifyAdmin (da gop theo key). Tang gui tin tu loc qua AlertThrottle. */
  alerts: TiktokAlert[];
  errors: string[];
}

/** Chuoi rong/null -> null, KHAC so 0 (0 la gia tri that). */
export function parseRiohubMoney(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseStatus(v: unknown): 1 | 2 | 3 | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return n === 1 || n === 2 || n === 3 ? n : null;
}

function parseIso(v: unknown): Date | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function truthyFlag(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

interface Row {
  raw: RiohubOrderRecord;
  status: 1 | 2 | 3;
  est: number | null;
  actual: number | null;
  shared: number | null;
  pit: number | null;
  gmv: number;
  created: Date | null;
  delivered: Date | null;
}

const MAX_ALERT_LINES = 5;

function buildAlert(key: TiktokAlert["key"], headline: string, lines: string[]): TiktokAlert {
  const shown = lines.slice(0, MAX_ALERT_LINES).join("\n");
  const more = lines.length > MAX_ALERT_LINES ? `\n(+${lines.length - MAX_ALERT_LINES} đơn khác)` : "";
  return { key, message: `${headline}\n${shown}${more}` };
}

export function importTiktokOrders(
  logStore: LogStore,
  ledgerStore: LedgerStore,
  config: TiktokOrderImportConfig,
  orders: RiohubOrderRecord[]
): TiktokOrderImportResult {
  const { recordOrderConfig } = config;

  const grouped = new Map<string, RiohubOrderRecord[]>();
  let missingOrderId = 0;
  for (const o of orders) {
    const id = typeof o.order_id === "string" ? o.order_id.trim() : "";
    if (id === "") {
      missingOrderId += 1;
      continue;
    }
    const list = grouped.get(id);
    if (list) list.push(o);
    else grouped.set(id, [o]);
  }

  const result: TiktokOrderImportResult = {
    ordersScanned: grouped.size,
    confirmedNew: 0,
    confirmedDuplicate: 0,
    pendingNew: 0,
    pendingUpdated: 0,
    reversedCount: 0,
    mergedMultiSku: 0,
    skippedNoSubId: 0,
    skippedSubIdNotFound: 0,
    skippedForeignMerchant: 0,
    skippedUnknownStatus: 0,
    skippedNoEstimate: 0,
    smallHoldDeferred: 0,
    heldCount: 0,
    debtCreatedCount: 0,
    debtsByUser: [],
    cancelledWithdrawals: [],
    confirmedByUser: [],
    newOrderIds: [],
    statusTransitions: [],
    settledTotals: {
      orderCount: 0,
      estTotal: 0,
      actualTotal: null,
      pitTotal: null,
      sharedWithPartnerTotal: null,
      shortfallCount: 0,
    },
    alerts: [],
    errors: [],
  };
  if (missingOrderId > 0) {
    result.errors.push(`${missingOrderId} dong tu RioHub thieu order_id - bo qua cac dong do.`);
  }

  const confirmedRows: OrderRowResult[] = [];
  const mcnLines: string[] = [];
  const shortfallLines: string[] = [];
  const addNullable = (current: number | null, add: number | null): number | null =>
    add === null ? current : (current ?? 0) + add;

  for (const [orderId, rawRows] of grouped) {
    const statuses = rawRows.map((r) => parseStatus(r.status));
    if (statuses.some((s) => s === null)) {
      result.skippedUnknownStatus += 1;
      result.errors.push(
        `[${orderId}] status la ${JSON.stringify(rawRows.map((r) => r.status ?? null))} - khong khop 1/2/3 da biet, bo qua ca don de tranh doan sai.`
      );
      continue;
    }

    const rows: Row[] = rawRows.map((raw, i) => ({
      raw,
      status: statuses[i] as 1 | 2 | 3,
      est: parseRiohubMoney(raw.est_commission),
      actual: parseRiohubMoney(raw.actual_commission),
      shared: parseRiohubMoney(raw.shared_with_partner),
      pit: parseRiohubMoney(raw.pit),
      gmv: parseRiohubMoney(raw.commission_gmv) ?? 0,
      created: parseIso(raw.time_created_iso),
      delivered: parseIso(raw.time_delivered_iso),
    }));

    // ---- Doi chieu quyet toan (muc 7): tinh cho MOI don, ke ca don khong quy duoc ve user - MCN giu
    // tien la su that cua ca tai khoan creator, khong phai chuyen rieng cua bot.
    const settled = rows.filter((r) => r.status === 2);
    if (settled.length > 0) {
      const t = result.settledTotals;
      t.orderCount += 1;
      for (const r of settled) {
        t.estTotal += r.est ?? 0;
        t.actualTotal = addNullable(t.actualTotal, r.actual);
        t.pitTotal = addNullable(t.pitTotal, r.pit);
        t.sharedWithPartnerTotal = addNullable(t.sharedWithPartnerTotal, r.shared);
      }
      const mcn = settled.reduce((s, r) => s + (r.shared ?? 0), 0);
      if (mcn !== 0) mcnLines.push(`${orderId}: MCN giữ ${formatVnd(Math.abs(mcn))}`);

      const comparable = settled.filter((r) => r.actual !== null && r.est !== null);
      if (comparable.length > 0) {
        const estSum = comparable.reduce((s, r) => s + (r.est as number), 0);
        const actualSum = comparable.reduce((s, r) => s + (r.actual as number), 0);
        if (isActualBelowAssumed(estSum, actualSum)) {
          t.shortfallCount += 1;
          shortfallLines.push(
            `${orderId}: ước tính ${formatVnd(estSum)} → đã trả user theo ${formatVnd(estimateTiktokNetCommission(estSum))}, thực nhận ${formatVnd(actualSum)}`
          );
        }
      }
    }

    // ---- Quy ve user (giong thu tu cua Shopee: khong co subId → khong khop → (them) sai san)
    const subIds = [
      ...new Set(
        rows
          .map((r) => (typeof r.raw.sub_id === "string" ? r.raw.sub_id.trim() : ""))
          .filter((s) => s !== "")
      ),
    ];
    if (subIds.length === 0) {
      result.skippedNoSubId += 1;
      continue;
    }
    if (subIds.length > 1) {
      result.errors.push(`[${orderId}] cac dong cua don co ${subIds.length} sub_id khac nhau - dung sub_id dau tien (${subIds[0]}).`);
    }
    const subId = subIds[0];

    const requestEntry = logStore.findBySubId(subId);
    if (!requestEntry || !requestEntry.merchant) {
      result.skippedSubIdNotFound += 1;
      continue;
    }
    // CHOT CACH LY (spec 6.1): CHI phia TikTok. subId khong ma hoa san nen co the khop request Shopee.
    if (requestEntry.merchant !== "tiktokshop") {
      result.skippedForeignMerchant += 1;
      result.errors.push(
        `[${orderId}] sub_id khop voi mot request cua san "${requestEntry.merchant}" chu khong phai TikTok Shop - bo qua, khong ghi ledger.`
      );
      continue;
    }

    if (rows.length > 1) result.mergedMultiSku += 1;

    // ---- Canh bao hoan mot phan (den bao re, spec 5.8): thiet ke khong doc cac field nay.
    for (const r of rows) {
      const refunded = parseRiohubMoney(r.raw.refunded_quantity) ?? 0;
      const returned = parseRiohubMoney(r.raw.returned_quantity) ?? 0;
      if (r.status !== 3 && (refunded > 0 || returned > 0 || truthyFlag(r.raw.fully_refunded))) {
        result.errors.push(
          `[${orderId}] sku ${r.raw.sku_id ?? "?"} co refunded_quantity=${refunded} returned_quantity=${returned} ` +
            `fully_refunded=${String(r.raw.fully_refunded ?? null)} nhung status=${r.status} - hoan MOT PHAN trong cung SKU chua co thiet ke xu ly, kiem tra tay.`
        );
      }
    }

    // ---- Phan loai ca don (thu tu LA MOT PHAN CUA LUAT, spec 5.3)
    const live = rows.filter((r) => r.status !== 3);
    let targetStatus: "confirmed" | "pending" | "reversed";
    if (live.length === 0) targetStatus = "reversed";
    else if (live.some((r) => r.status === 1 && r.delivered === null)) targetStatus = "pending";
    else targetStatus = "confirmed";

    // ---- Tien
    let commissionAmount = 0;
    if (targetStatus !== "reversed") {
      const ests = live.map((r) => r.est).filter((e): e is number => e !== null);
      if (ests.length === 0) {
        result.skippedNoEstimate += 1;
        result.errors.push(`[${orderId}] don con song nhung khong dong nao co est_commission - bo qua, khong co gi de ghi.`);
        continue;
      }
      if (ests.length < live.length) {
        result.errors.push(`[${orderId}] ${live.length - ests.length} dong thieu est_commission - tong hoa hong co the THAP hon thuc te.`);
      }
      commissionAmount = estimateTiktokNetCommission(ests.reduce((s, e) => s + e, 0));
    }
    const orderAmount = live.reduce((s, r) => s + r.gmv, 0);

    // ---- Ten san pham: dong hoa hong cao nhat + hau to (+N san pham khac)
    const nameRows = live.length > 0 ? live : rows;
    const best = nameRows.reduce((a, b) => ((b.est ?? 0) > (a.est ?? 0) ? b : a));
    const baseName = (best.raw.product_name ?? "").trim();
    const productName =
      baseName === "" ? null : nameRows.length > 1 ? `${baseName} (+${nameRows.length - 1} san pham khac)` : baseName;

    // ---- Ngay: dat don = dong SOM nhat (moi dong), giao hang = MUON nhat trong dong khong huy
    const createdTimes = rows.map((r) => r.created).filter((d): d is Date => d !== null);
    const earliest = createdTimes.length > 0 ? new Date(Math.min(...createdTimes.map((d) => d.getTime()))) : null;
    const deliveredTimes = live.map((r) => r.delivered).filter((d): d is Date => d !== null);
    const latestDelivered =
      deliveredTimes.length > 0 ? new Date(Math.max(...deliveredTimes.map((d) => d.getTime()))) : null;

    const importDay = todayVnIso();
    const outcomes = applyOrderStatusToLedger(
      ledgerStore,
      {
        orderId,
        targetStatus,
        subId,
        requestEntry: { platform: requestEntry.platform, userId: requestEntry.userId, merchant: requestEntry.merchant },
        orderAmount,
        commissionAmount,
        productName,
        orderDate: earliest ? formatVnDateIso(earliest) : null,
        orderTime: earliest ? formatVnTimeHms(earliest) : null,
        completedAt: latestDelivered ? formatVnDateIso(latestDelivered) : null,
        reverseReason: "RioHub ghi tat ca san pham cua don o trang thai huy/hoan (status 3)",
        notes: {
          confirmed: "Nhap tu RioHub TikTok (dong bo don) - da giao",
          pending: "Nhap tu RioHub TikTok (dong bo don) - chua giao hang",
        },
        sourceLabel: "RioHub",
        confirmedClaim: "RioHub ghi don da giao",
      },
      recordOrderConfig,
      importDay
    );

    for (const o of outcomes) {
      switch (o.kind) {
        case "confirmed-duplicate":
          result.confirmedDuplicate += 1;
          break;
        case "warning":
        case "error":
          result.errors.push(o.message);
          break;
        case "small-hold-deferred":
          if (o.newOrder) result.newOrderIds.push(orderId);
          result.smallHoldDeferred += 1;
          break;
        case "confirmed-new":
          if (o.newOrder) result.newOrderIds.push(orderId);
          if (o.wasPending) result.statusTransitions.push({ orderId, from: "pending", to: "confirmed" });
          result.confirmedNew += 1;
          if (o.held) result.heldCount += 1;
          confirmedRows.push({
            line: 0,
            subId,
            orderId,
            ok: true,
            detail: "tiktok-order-import",
            platform: o.entry.platform,
            userId: o.entry.userId,
            userShareAmount: o.entry.userShareAmount,
            productName: o.entry.productName,
          });
          break;
        case "pending-new":
          result.pendingNew += 1;
          result.newOrderIds.push(orderId);
          break;
        case "pending-updated":
          result.pendingUpdated += 1;
          break;
        case "reversed":
          result.reversedCount += 1;
          result.statusTransitions.push({ orderId, from: o.from, to: "reversed" });
          break;
        case "reversed-unseen":
          break;
        case "debt-created":
          result.debtCreatedCount += 1;
          result.debtsByUser.push({ platform: o.platform, userId: o.userId, orderId: o.orderId, amount: o.amount });
          break;
        case "withdrawal-cancelled":
          result.cancelledWithdrawals.push({
            platform: o.platform,
            userId: o.userId,
            withdrawalId: o.withdrawalId,
            amount: o.amount,
            orderId: o.orderId,
          });
          break;
      }
    }
  }

  if (mcnLines.length > 0) {
    const alert = buildAlert(
      "tiktok_mcn_cut",
      "⚠️ TikTok: MCN đang giữ một phần hoa hồng (shared_with_partner ≠ 0). Thoả thuận 0% không còn đúng, và số ước tính bot đã báo/trả cho user đang CAO hơn thực nhận.",
      mcnLines
    );
    result.alerts.push(alert);
    result.errors.push(alert.message);
  }
  if (shortfallLines.length > 0) {
    const alert = buildAlert(
      "tiktok_actual_below_assumed",
      "⚠️ TikTok: hoa hồng thực nhận (actual_commission) THẤP hơn số đã dùng để trả user. Kiểm tra pit thật / TIKTOK_PIT_RETAINED_RATIO (tiktokCommission.ts). Tiền đã trả user không lấy lại được.",
      shortfallLines
    );
    result.alerts.push(alert);
    result.errors.push(alert.message);
  }

  result.confirmedByUser = summarizeOrderResultsByUser(confirmedRows);
  return result;
}
```

- [ ] **Step 7: Chạy test import → PASS**

```bash
npx tsx --test src/core/__tests__/tiktokOrderImport.test.ts src/core/__tests__/tiktokOrderIsolation.test.ts src/core/__tests__/riohubOrdersSource.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|✖"
```
Expected: `fail 0`. Nếu một test đỏ, ĐỌC lý do trước khi sửa: test hay code sai? Test được viết từ spec — nếu code đúng spec mà test sai thì sửa test và ghi vì sao trong commit; nếu code lệch spec thì sửa code.

- [ ] **Step 8: Typecheck + toàn bộ + bất biến Shopee**

```bash
npm run typecheck && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
git diff --stat HEAD -- src/core/__tests__/shopeeReport*.test.ts src/core/__tests__/payoutDebt.test.ts
```
Expected: `fail 0`, lệnh diff cuối **rỗng**.

- [ ] **Step 9: Commit**

```bash
git add src/core/tiktokOrderImport.ts src/core/providers/riohubOrdersSource.ts src/core/__tests__/tiktokOrderImport.test.ts src/core/__tests__/tiktokOrderIsolation.test.ts src/core/__tests__/riohubOrdersSource.test.ts
git commit -F - <<'EOF'
feat(tiktok): doi soat don TikTok - keo don RioHub va ghi vao ledger

importTiktokOrders (thuan, nhan mang) + riohubOrdersSource (cho duy nhat goi mang).
Don vao Kha dung LUC GIAO HANG chu khong cho RioHub quyet toan; hoa hong goc =
est x 0,9 cho ca pending lan confirmed nen khong bao gio phai sua so sau khi chot.
actual/pit/shared_with_partner chi de doi chieu, co canh bao khi MCN giu tien hoac
actual thap hon so da tra.

Chot cach ly: sub_id khop request cua san khac -> bo qua + canh bao, co test chan.
Phan trang chong tham so bi API nuot (trang sau khong co don moi -> nem loi).

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```


---

### Task 4b: Smoke trên JSON THẬT của RioHub (đọc + chạy trên DB bộ nhớ, KHÔNG ghi gì)

**Vì sao có task này:** toàn bộ test ở Task 4 dùng fixture dựng từ output CLI — CLI chỉ in một phần field. Nếu API thật đặt tên/kiểu field khác với giả định (`commission_gmv`, `sku_id`, `time_delivered_iso`…) thì test xanh mà production hỏng. Task này là cách duy nhất chạm dữ liệu thật trước khi đưa nút vào giao diện.

**Files:** không sửa file nào trong repo. Script tạm nằm ở scratchpad.

- [ ] **Step 1: Tạo script tạm** `$SCRATCH/smoke_tiktok_import.mts` (SCRATCH = thư mục scratchpad của phiên; KHÔNG nằm trong repo, không commit)

```ts
const ROOT = "/Users/ryan/Documents/Claude/Projects/Affiliate Bot Shopee/src";
const { env } = await import(`${ROOT}/config/env.js`);
const { createTiktokOrdersFetcher } = await import(`${ROOT}/core/providers/riohubOrdersSource.js`);
const { importTiktokOrders } = await import(`${ROOT}/core/tiktokOrderImport.js`);
const { looksLikeBotSubId } = await import(`${ROOT}/core/subId.js`);
const { LogStore } = await import(`${ROOT}/core/logStore.js`);
const { LedgerStore } = await import(`${ROOT}/core/ledgerStore.js`);

// enabled ghi de: .env cuc bo co the de TIKTOK_ENABLED trong. Van doc key tu .env.
const fetcher = createTiktokOrdersFetcher({ ...env.tiktok, enabled: true });
if (!fetcher) {
  console.error("Thieu RIOHUB_API_KEY / RIOHUB_CREATOR_USERNAME trong .env");
  process.exit(1);
}

const orders = await fetcher();
console.log(`Keo ve ${orders.length} dong don.`);

// 1. Hinh dang field THAT so voi gia dinh trong tiktokOrderImport.ts
const expected = [
  "order_id", "sku_id", "product_name", "sub_id", "status", "commission_gmv",
  "est_commission", "actual_commission", "shared_with_partner", "pit",
  "time_created_iso", "time_delivered_iso",
];
const keys = new Set(orders.flatMap((o) => Object.keys(o)));
console.log("Field GIA DINH nhung API KHONG tra:", expected.filter((k) => !keys.has(k)));
console.log("Field API tra ma code chua dung (de xem lai):", [...keys].filter((k) => !expected.includes(k)).sort().join(", "));
console.log("Kieu that:", Object.fromEntries(expected.map((k) => [k, typeof (orders[0] as Record<string, unknown>)?.[k]])));

// 2. Chay import tren DB BO NHO, seed sub_id cua bot de don bot duoc quy ve user
const logStore = new LogStore(":memory:");
const ledgerStore = new LedgerStore(":memory:");
for (const o of orders) {
  const sub = typeof o.sub_id === "string" ? o.sub_id : "";
  if (sub !== "" && looksLikeBotSubId(sub)) {
    logStore.record({
      platform: "zalo", merchant: "tiktokshop", userId: "smoke-user",
      originalUrl: "https://shop.tiktok.com/x", subId: sub, outcome: "success",
      errorCode: null, affiliateUrl: "https://www.tiktok.com/t/x/",
    });
  }
}
const result = importTiktokOrders(
  logStore, ledgerStore,
  { recordOrderConfig: {
      taxPercent: 10, platformFeePercent: 1, userSharePercent: 80, maxCommissionRatioPercent: 1000,
      holdConfig: { thresholdVnd: 100_000, holdDays: 7, smallHoldDays: 1 },
  } },
  orders
);
const { confirmedByUser, ...summary } = result;
console.log(JSON.stringify(summary, null, 2));
for (const o of orders) {
  const e = ledgerStore.getEntryByOrderId("tiktokshop", String(o.order_id));
  if (e) console.log(e.orderId, e.status, "hoa hong goc", e.commissionAmount, "user nhan", e.userShareAmount, "mo khoa", e.availableFrom, "dat", e.orderDate, e.orderTime);
}
logStore.close();
ledgerStore.close();
```

- [ ] **Step 2: Chạy**

```bash
cd "/Users/ryan/Documents/Claude/Projects/Affiliate Bot Shopee" && npx tsx "$SCRATCH/smoke_tiktok_import.mts"
```
(Cần `.env` có `RIOHUB_API_KEY` + `RIOHUB_CREATOR_USERNAME` — chủ bot đã đặt ngày 2026-10-10. **Không in key.** Script chỉ đọc API, ghi vào DB bộ nhớ.)

**Kết quả kỳ vọng với 4 đơn thật ngày 2026-10-11:**
- `Field GIA DINH nhung API KHONG tra: []` — nếu KHÁC rỗng → DỪNG, sửa `RiohubOrderRecord`/`tiktokOrderImport.ts` cho đúng tên thật, thêm vào fixture của test, rồi chạy lại.
- 2 đơn bot (`586514613873640731`, `586502233699747518`) → `pending`, hoa hồng gốc **2871** và **1922**, `dat` = ngày/giờ VN (đơn 10/10 08:47:28Z ⇒ `2026-10-10 15:47:28`).
- `586474851567371966` (sub_id rỗng, đã giao): `skippedNoSubId`.
- `586494603346282174` (sub_id kiểu app, 2 đoạn): `skippedSubIdNotFound`.
- `settledTotals.orderCount = 0` và các tổng `null` (chưa đơn nào quyết toán).

Báo kết quả cho chủ bot bằng số thật. **Không commit gì ở task này.**

---

### Task 5: Route đồng bộ + thẻ giao diện + `ImportActionType` + nối `index.ts`

**Files:**
- Modify: `src/core/types.ts:262` (`ImportActionType`)
- Modify: `src/core/providers/riohubOrdersSource.ts` (thêm `describeRiohubSyncError`)
- Modify: `src/api/adminHtml.ts` (nhãn lịch sử + thẻ TikTok + tham số mới của `renderRecordOrdersPage`)
- Modify: `src/api/server.ts` (helper dùng chung + route mới + `tiktokView()` ở 6 chỗ gọi render)
- Modify: `src/index.ts` (truyền fetcher)
- Create: `src/api/__tests__/adminTiktokSyncRoute.test.ts`

**Interfaces:**
- Consumes: `importTiktokOrders`, `RiohubOrderRecord`, `TiktokOrderImportResult` (Task 4), `createTiktokOrdersFetcher` (Task 4), `AlertThrottle` (có sẵn, `src/core/alertThrottle.ts`).
- Produces: `createServer(..., syncZaloGroupMembers?, syncTiktokOrders?: () => Promise<RiohubOrderRecord[]>)` — tham số MỚI cuối cùng; `undefined` ⇒ đường TikTok trơ hoàn toàn (chốt cách ly 3).

**Ràng buộc cách ly cho task này (spec 6):** hai route riêng, `syncTiktokOrders === undefined` ⇒ thẻ ẩn + route 404, route Shopee không bao giờ gọi fetcher. Việc rút `currentOrderConfig()` và `notifyImportOutcomes()` khỏi route Shopee là **di chuyển nguyên văn**, không đổi hành vi — các test `adminRoutes.test.ts` hiện có là bằng chứng và phải xanh không sửa.

- [ ] **Step 1: `ImportActionType` — để trình biên dịch tự chỉ chỗ phải sửa**

`src/core/types.ts` dòng 262:
```ts
export type ImportActionType = "csv" | "single" | "tiktok";
```
```bash
npm run typecheck 2>&1 | head
```
Expected: **LỖI** ở `src/api/adminHtml.ts` (`ACTION_TYPE_LABELS` thiếu key `tiktok`). Đó là chủ đích — bằng chứng nhãn không thể bị quên.

- [ ] **Step 2: Hàm mô tả lỗi cho admin** — thêm cuối `src/core/providers/riohubOrdersSource.ts`

```ts

import { RiohubApiError, RiohubUnreachableError } from "./riohubClient.js";

/**
 * Cau bao loi cho ADMIN khi keo don that bai. Tach 404 va 401 vi nhin giong nhau ma nguyen nhan khac
 * han: 404 = sai DUONG DAN (thieu tien to /partner/tiktok/affiliate), 401 = sai KEY (da dinh that 2026-10-10).
 * Luon nhac Shopee khong bi anh huong - day la thong diep cach ly cho nguoi dang hoang.
 */
export function describeRiohubSyncError(err: unknown): string {
  if (err instanceof RiohubApiError) {
    const hint =
      err.httpStatus === 401
        ? " — API key sai hoặc hết hạn."
        : err.httpStatus === 404
          ? " — sai đường dẫn endpoint, KHÔNG phải sai key."
          : ".";
    return `RioHub từ chối: HTTP ${err.httpStatus} ${err.code}${hint} Đơn Shopee không bị ảnh hưởng.`;
  }
  if (err instanceof RiohubUnreachableError) {
    return "Không với tới được RioHub ở cả 3 tên miền — thử lại sau vài phút. Đơn Shopee không bị ảnh hưởng.";
  }
  return `Lỗi khi đồng bộ đơn TikTok: ${(err as Error).message} Đơn Shopee không bị ảnh hưởng.`;
}
```
(Gom `import` lên đầu file cho đúng thứ tự — sửa dòng import `RIOHUB_TIKTOK_PATH_PREFIX, RiohubClient` hiện có thành `import { RIOHUB_TIKTOK_PATH_PREFIX, RiohubApiError, RiohubClient, RiohubUnreachableError } from "./riohubClient.js";` và bỏ dòng import thứ hai.)

- [ ] **Step 3: Viết test route (FAIL trước)** — `src/api/__tests__/adminTiktokSyncRoute.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server.js";
import { AdminSessionStore } from "../../core/adminAuth.js";
import { LedgerStore } from "../../core/ledgerStore.js";
import { LinkResolverService } from "../../core/linkResolverService.js";
import { LogStore } from "../../core/logStore.js";
import type { NotifyUser } from "../../core/notification.js";
import { MockAffiliateProvider } from "../../core/providers/mockProvider.js";
import { RiohubApiError } from "../../core/providers/riohubClient.js";
import { RateLimiter } from "../../core/rateLimiter.js";
import type { RiohubOrderRecord } from "../../core/tiktokOrderImport.js";

/**
 * Route dong bo don TikTok (spec muc 6, 8). Trong tam la CACH LY: Shopee khong bao gio goi RioHub,
 * RioHub hong khong lam hong trang, tat TikTok thi the + route bien mat.
 */
const ADMIN_PASSWORD = "test-admin-password";
const BOT_SUB = "k-9053348487804998642-mv16nixs-f85f8a";
// Tat giam tien (threshold 0) de don giao 2 ngay truoc vao Kha dung ngay, de assert.
const ORDER_CONFIG = {
  taxPercent: 0,
  platformFeePercent: 0,
  userSharePercent: 80,
  maxCommissionRatioPercent: 1000,
  holdConfig: { thresholdVnd: 0, holdDays: 0 },
};

function order(over: Partial<RiohubOrderRecord> = {}): RiohubOrderRecord {
  return {
    order_id: "TT-1",
    sku_id: "S1",
    product_name: "Khan lau kinh",
    sub_id: BOT_SUB,
    status: 1,
    commission_gmv: "100000.00",
    est_commission: "3000.00",
    time_created_iso: "2026-10-08T06:52:18Z",
    time_delivered_iso: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
    ...over,
  };
}

function setup(syncTiktokOrders?: () => Promise<RiohubOrderRecord[]>) {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  const rateLimiter = new RateLimiter(1000, 60_000);
  const adminLoginRateLimiter = new RateLimiter(1000, 60_000);
  const resolver = new LinkResolverService(new MockAffiliateProvider(), logStore, rateLimiter);
  const withdrawalProofDir = mkdtempSync(join(tmpdir(), "withdrawal-proofs-"));
  const adminMessages: string[] = [];
  const notifyAdmin = async (message: string): Promise<void> => {
    adminMessages.push(message);
  };
  const userMessages: string[] = [];
  const notifyUser: NotifyUser = async (_p, _u, n) => {
    userMessages.push(n.text);
  };

  logStore.record({
    platform: "zalo",
    merchant: "tiktokshop",
    userId: "user-a",
    originalUrl: "https://shop.tiktok.com/vn/pdp/1",
    subId: BOT_SUB,
    outcome: "success",
    errorCode: null,
    affiliateUrl: "https://www.tiktok.com/t/x/",
  });

  const app = createServer(
    resolver,
    logStore,
    ledgerStore,
    notifyAdmin,
    50_000,
    new AdminSessionStore(ADMIN_PASSWORD),
    ORDER_CONFIG,
    withdrawalProofDir,
    adminLoginRateLimiter,
    "http://localhost:3002",
    notifyUser,
    undefined,
    false, // text, khong render anh - de assert noi dung chu
    undefined,
    syncTiktokOrders
  );
  const httpServer = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

  return {
    baseUrl,
    ledgerStore,
    logStore,
    adminMessages,
    userMessages,
    cleanup: () => {
      httpServer.close();
      rateLimiter.stop();
      adminLoginRateLimiter.stop();
      logStore.close();
      ledgerStore.close();
      rmSync(withdrawalProofDir, { recursive: true, force: true });
    },
  };
}

async function login(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `password=${encodeURIComponent(ADMIN_PASSWORD)}`,
    redirect: "manual",
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

test("CHOT CACH LY 3: khong truyen fetcher -> the TikTok KHONG hien, route POST tra 404", async () => {
  const t = setup(undefined);
  try {
    const cookie = await login(t.baseUrl);
    const page = await (await fetch(`${t.baseUrl}/admin/record-orders`, { headers: { cookie } })).text();
    assert.doesNotMatch(page, /Đồng bộ đơn TikTok Shop/);
    const res = await fetch(`${t.baseUrl}/admin/record-orders/tiktok-sync`, { method: "POST", headers: { cookie } });
    assert.equal(res.status, 404);
  } finally {
    t.cleanup();
  }
});

test("co fetcher -> the TikTok hien tren /admin/record-orders", async () => {
  const t = setup(async () => []);
  try {
    const cookie = await login(t.baseUrl);
    const page = await (await fetch(`${t.baseUrl}/admin/record-orders`, { headers: { cookie } })).text();
    assert.match(page, /Đồng bộ đơn TikTok Shop/);
    assert.match(page, /action="\/admin\/record-orders\/tiktok-sync"/);
  } finally {
    t.cleanup();
  }
});

test("bam dong bo: don da giao -> ledger confirmed, DM user, lich su ghi actionType tiktok", async () => {
  const t = setup(async () => [order()]);
  try {
    const cookie = await login(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/admin/record-orders/tiktok-sync`, { method: "POST", headers: { cookie } });
    assert.equal(res.status, 200);

    const entry = t.ledgerStore.getEntryByOrderId("tiktokshop", "TT-1");
    assert.equal(entry?.status, "confirmed");
    assert.equal(entry?.commissionAmount, 2700); // 3000 x 0,9
    assert.equal(entry?.userShareAmount, 2160); // 80% cua 2700

    // notifyUser chay bat dong bo (promise) - cho mot nhip
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(t.userMessages.length, 1, "user nhan DUNG 1 tin 'don ve'");

    const history = t.ledgerStore.listImportHistory(1)[0];
    assert.equal(history.actionType, "tiktok");
    assert.deepEqual(history.newOrderIds, ["TT-1"]);

    const html = await res.text();
    assert.match(html, /Đồng bộ thành công/);
  } finally {
    t.cleanup();
  }
});

test("CHOT CACH LY 2: RioHub tu choi 401 -> trang bao loi cho the TikTok, ledger nguyen, KHONG 500", async () => {
  const t = setup(async () => {
    throw new RiohubApiError("unauthorized", "bad key", 401);
  });
  try {
    const cookie = await login(t.baseUrl);
    const res = await fetch(`${t.baseUrl}/admin/record-orders/tiktok-sync`, { method: "POST", headers: { cookie } });
    assert.equal(res.status, 502);
    const html = await res.text();
    assert.match(html, /API key sai hoặc hết hạn/);
    assert.match(html, /Đơn Shopee không bị ảnh hưởng/);
    assert.equal(t.ledgerStore.getEntryByOrderId("tiktokshop", "TT-1"), null);
  } finally {
    t.cleanup();
  }
});

test("CHOT CACH LY 2: import Shopee KHONG BAO GIO goi fetcher RioHub", async () => {
  let calls = 0;
  const t = setup(async () => {
    calls += 1;
    return [];
  });
  try {
    const cookie = await login(t.baseUrl);
    // Khong chon file -> route Shopee tra 422 (da du de chung minh no khong cham fetcher) va the van hien.
    const res = await fetch(`${t.baseUrl}/admin/record-orders/shopee-report`, {
      method: "POST",
      headers: { cookie },
      body: new FormData(),
    });
    assert.equal(res.status, 422);
    assert.equal(calls, 0);
    // Trang loi cua Shopee van phai VE THE TikTok (tiktokView() truyen o moi cho goi render).
    assert.match(await res.text(), /Đồng bộ đơn TikTok Shop/);
  } finally {
    t.cleanup();
  }
});

test("MCN giu tien -> notifyAdmin 1 lan; bam lai trong 15 phut KHONG bao lai (AlertThrottle)", async () => {
  const settled = order({
    order_id: "TT-MCN",
    status: 2,
    est_commission: "10000.00",
    actual_commission: "4000.00",
    shared_with_partner: "-5000.00",
  });
  const t = setup(async () => [settled]);
  try {
    const cookie = await login(t.baseUrl);
    await fetch(`${t.baseUrl}/admin/record-orders/tiktok-sync`, { method: "POST", headers: { cookie } });
    await fetch(`${t.baseUrl}/admin/record-orders/tiktok-sync`, { method: "POST", headers: { cookie } });
    await new Promise((r) => setTimeout(r, 50));
    const mcn = t.adminMessages.filter((m) => /MCN đang giữ/.test(m));
    assert.equal(mcn.length, 1);
    assert.match(mcn[0], /TT-MCN/);
  } finally {
    t.cleanup();
  }
});

test("trang ket qua luon co khoi 'So lieu da quyet toan'; chua co don quyet toan thi hien dau —", async () => {
  const t = setup(async () => [order()]);
  try {
    const cookie = await login(t.baseUrl);
    const html = await (await fetch(`${t.baseUrl}/admin/record-orders/tiktok-sync`, { method: "POST", headers: { cookie } })).text();
    assert.match(html, /Số liệu đã quyết toán/);
    assert.match(html, /Thuế pit/);
  } finally {
    t.cleanup();
  }
});
```

- [ ] **Step 4: Chạy → FAIL** (createServer chưa nhận tham số, route chưa có)

```bash
npx tsx --test src/api/__tests__/adminTiktokSyncRoute.test.ts 2>&1 | grep -E "^ℹ (pass|fail)" 
```

- [ ] **Step 5: `adminHtml.ts` — nhãn lịch sử, kiểu trạng thái thẻ, thẻ TikTok**

(a) Import (cạnh `import type { ShopeeReportImportResult }` ở dòng 7):
```ts
import type { TiktokOrderImportResult } from "../core/tiktokOrderImport.js";
```
(b) `ACTION_TYPE_LABELS` (dòng ~2318) thêm một dòng:
```ts
  tiktok: "Đồng bộ đơn TikTok Shop",
```
(c) Ngay trên `export function renderRecordOrdersPage(`, thêm:
```ts
/**
 * Trang thai cua the "Dong bo don TikTok Shop". CO mat (khac undefined) = TikTok dang bat va the duoc
 * ve; undefined = TikTok tat, the KHONG ton tai (chot cach ly 3, spec 6).
 */
export interface TiktokCardState {
  result?: TiktokOrderImportResult | null;
  error?: string | null;
}
```
(d) Thêm tham số cuối `tiktok?: TiktokCardState` vào chữ ký `renderRecordOrdersPage` (sau `pendingWithdrawals?: number`).
(e) Ngay SAU khai báo `const shopeeReportCard = ...;` (nơi `statRow`, `banner`, `icon`, `confirmOnSubmit`, `successToast` đều trong phạm vi) thêm:

```ts
  // ---- The "Dong bo don TikTok Shop" (spec muc 8). Chi ve khi `tiktok` co mat.
  const textRow = (label: string, value: string): string =>
    `<div class="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
      <dt class="text-slate-500">${label}</dt>
      <dd class="font-semibold tabular-nums text-slate-800">${escapeHtml(value)}</dd>
    </div>`;

  const tiktokToast = tiktok?.result
    ? successToast(
        tiktok.result.newOrderIds.length > 0 || tiktok.result.statusTransitions.length > 0
          ? `Đồng bộ thành công: ${tiktok.result.newOrderIds.length} đơn mới, ${tiktok.result.statusTransitions.length} đơn cập nhật trạng thái.`
          : "Đồng bộ hoàn tất: không có đơn nào thay đổi."
      )
    : "";

  const tiktokErrorBlock = tiktok?.error ? banner("error", tiktok.error) : "";

  const tiktokResultBlock = tiktok?.result
    ? (() => {
        const r = tiktok.result;
        const s = r.settledTotals;
        const money = (v: number | null): string => (v === null ? "—" : formatVnd(v));
        return `<div class="mt-4 border-t border-slate-100 pt-4">
    <dl class="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
      ${statRow("Số đơn quét được", r.ordersScanned)}
      ${statRow(`Ghi mới "Khả dụng" (trùng bỏ qua ${r.confirmedDuplicate})`, r.confirmedNew)}
      ${statRow(`Ghi mới "Chờ xác nhận" (cập nhật lại ${r.pendingUpdated})`, r.pendingNew)}
      ${statRow(`Đơn nhỏ đang chờ vào "Khả dụng"`, r.smallHoldDeferred)}
      ${statRow("Đã huỷ / hoàn", r.reversedCount)}
      ${statRow("Đơn nhiều SKU đã gộp", r.mergedMultiSku)}
      ${statRow("Bỏ qua - không có sub_id", r.skippedNoSubId)}
      ${statRow("Bỏ qua - sub_id không khớp user", r.skippedSubIdNotFound)}
      ${statRow("Bỏ qua - sub_id của sàn khác", r.skippedForeignMerchant)}
      ${statRow("Bỏ qua - trạng thái lạ", r.skippedUnknownStatus)}
      ${statRow("Bỏ qua - không có est_commission", r.skippedNoEstimate)}
    </dl>
    <h3 class="mt-4 text-xs font-bold text-slate-900">Số liệu đã quyết toán</h3>
    <p class="mb-2 text-[11px] text-slate-500">Chỉ để đối chiếu — không tham gia tính tiền. Chưa có đơn quyết toán thì hiện —.</p>
    <dl class="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
      ${statRow("Đơn đã quyết toán", s.orderCount)}
      ${textRow("Tổng ước tính (est)", formatVnd(s.estTotal))}
      ${textRow("Tổng thực nhận (actual)", money(s.actualTotal))}
      ${textRow("Thuế pit TikTok khấu trừ", money(s.pitTotal))}
      ${textRow("MCN giữ (shared_with_partner)", money(s.sharedWithPartnerTotal))}
      ${statRow("Đơn thực nhận THẤP hơn số đã trả", s.shortfallCount)}
    </dl>${
      r.errors.length > 0
        ? `
    <ul class="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800">
      ${r.errors.map((e) => `<li class="whitespace-pre-line">• ${escapeHtml(e)}</li>`).join("\n")}
    </ul>`
        : ""
    }
  </div>`;
      })()
    : "";

  const tiktokCard = tiktok
    ? `<div class="mb-6 rounded-xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="flex items-center gap-2">
      <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-xs font-bold text-slate-700">T</div>
      <div>
        <h2 class="text-sm font-bold text-slate-900">Đồng bộ đơn TikTok Shop</h2>
        <span class="text-[11px] text-slate-500">Kéo đơn từ RioHub — đơn đã giao vào Khả dụng, áp luật giam như Shopee</span>
      </div>
    </div>
    <form method="POST" action="/admin/record-orders/tiktok-sync" ${confirmOnSubmit(
      "Đồng bộ đơn TikTok Shop từ RioHub? Sẽ ghi nhận/cập nhật đơn vào hệ thống."
    )}>
      <button type="submit" class="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900">
        ${icon("refresh-cw", "h-4 w-4")} Đồng bộ ngay
      </button>
    </form>
  </div>
  ${tiktokErrorBlock}
  ${tiktokResultBlock}
</div>`
    : "";
```
(f) Sửa `const body = ...` ở cuối hàm: thêm `${tiktokToast}` cạnh `${shopeeReportToast}` và `${tiktokCard}` giữa khối lưới và `${historyCard}`:

```ts
  const body = `${shopeeReportToast}${tiktokToast}
${supportBadge}
<div class="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
  ${singleCard}
  ${shopeeReportCard}
</div>
${tiktokCard}
${historyCard}
${pageScript}`;
```

- [ ] **Step 6: `server.ts` — rút helper, thêm route, nối 6 chỗ render**

(a) Imports (đầu file, cạnh các import cùng loại):
```ts
import { AlertThrottle } from "../core/alertThrottle.js";
import { describeRiohubSyncError } from "../core/providers/riohubOrdersSource.js";
import { importTiktokOrders, type RiohubOrderRecord } from "../core/tiktokOrderImport.js";
import type { TiktokCardState } from "./adminHtml.js";
```
(`renderRecordOrdersPage` đã import từ `./adminHtml.js` — gộp `type TiktokCardState` vào import hiện có nếu gọn hơn.)

(b) Chữ ký `createServer`: thêm tham số CUỐI (sau `syncZaloGroupMembers?`):
```ts
  syncZaloGroupMembers?: (groupId: string) => Promise<void>,
  /**
   * Keo toan bo don TikTok tu RioHub (2026-10-11). undefined khi TikTok tat/thieu cau hinh: luc do the
   * "Dong bo don TikTok" khong hien va route tra 404 - duong TikTok TRO HOAN TOAN (spec 6, chot 3).
   */
  syncTiktokOrders?: () => Promise<RiohubOrderRecord[]>
```
(nhớ thêm dấu phẩy sau `syncZaloGroupMembers?: ...`).

(c) Chạy script di chuyển (đặt ở `$SCRATCH/extract_import_helpers.py`):

```python
import os
os.chdir("/Users/ryan/Documents/Claude/Projects/Affiliate Bot Shopee")
P = "src/api/server.ts"
s = open(P, encoding="utf-8").read()

# ---- 1. currentOrderConfig(): rut khoi route Shopee ----
CFG_START = "      const requestOrderConfig = {\n        ...orderConfig,\n"
CFG_END = "      };\n      const result = importShopeeReport(\n"
assert s.count(CFG_START) == 1 and s.count(CFG_END) == 1, "marker config"
a = s.index(CFG_START)
b = s.index(CFG_END) + len("      };\n")
cfg_block = s[a:b]                       # 'const requestOrderConfig = {...};'
s = s[:a] + "      const requestOrderConfig = currentOrderConfig();\n" + s[b:]

body = cfg_block.replace("      const requestOrderConfig = {", "    return {", 1)
# ha thut 2 o cho phan con lai (route o indent 6, ham o indent 4)
lines = body.split("\n")
fixed = [lines[0]] + [l[2:] if l.startswith("  ") else l for l in lines[1:]]
body = "\n".join(fixed)
CONFIG_HELPER = (
    "  /**\n"
    "   * Cau hinh ghi don DOC LUC XU LI (khong dung gia tri env dong bang luc khoi dong): admin doi\n"
    "   * %/nguong/so ngay giam o /admin/settings phai co hieu luc ngay, khong can restart. Dung chung\n"
    "   * cho import Shopee va dong bo TikTok - 2 noi tu dung rieng thi mot ben se quen truyen smallHoldDays.\n"
    "   */\n"
    "  function currentOrderConfig(): RecordOrderConfig {\n" + body + "\n  }\n\n"
)

# ---- 2. notifyImportOutcomes(): rut khoi route Shopee ----
N_START = "      for (const summary of result.confirmedByUser) {\n"
N_END = "      // 2026-09-11 (yeu cau truc tiep cua user): bao CA GROUP biet"
assert s.count(N_START) == 1 and s.count(N_END) == 1, "marker notify"
a = s.index(N_START)
b = s.index(N_END)
notify_region = s[a:b]
s = s[:a] + "      notifyImportOutcomes(result);\n\n" + s[b:]
dedented = "\n".join(l[2:] if l.startswith("  ") else l for l in notify_region.rstrip("\n").split("\n"))
NOTIFY_HELPER = (
    "  /**\n"
    "   * Thong bao sau khi mot lan dong bo ghi don xong: DM 'don ve' gop theo user, thong bao no hoan tra,\n"
    "   * thong bao yeu cau rut bi tu huy. Dung CHUNG cho import Shopee va dong bo TikTok - cung mot cau\n"
    "   * cho cung mot su kien. KHONG gui vao group Zalo: tin hang ngay thuoc nhip import Shopee 9h30.\n"
    "   */\n"
    "  function notifyImportOutcomes(result: ImportOutcomesToNotify): void {\n" + dedented + "\n  }\n\n"
)

# ---- 3. chen 2 helper ngay truoc route shopee-report ----
ANCHOR = '  app.post(\n    "/admin/record-orders/shopee-report",\n'
assert s.count(ANCHOR) == 1, "anchor"
s = s.replace(ANCHOR, CONFIG_HELPER + NOTIFY_HELPER + ANCHOR, 1)

# ---- 4. kieu ImportOutcomesToNotify: ngay truoc 'export function createServer(' ----
TYPE_ANCHOR = "export function createServer("
assert s.count(TYPE_ANCHOR) == 1
TYPE_DECL = '''/** Phan cua ket qua dong bo don (Shopee hoac TikTok) can de gui thong bao cho user - xem notifyImportOutcomes. */
interface ImportOutcomesToNotify {
  confirmedByUser: UserOrderSummary[];
  debtsByUser: Array<{ platform: Platform; userId: string; orderId: string; amount: number }>;
  cancelledWithdrawals: Array<{ platform: Platform; userId: string; withdrawalId: string; amount: number; orderId: string }>;
}

'''
s = s.replace(TYPE_ANCHOR, TYPE_DECL + TYPE_ANCHOR, 1)
open(P, "w", encoding="utf-8").write(s)
print("ok")
```
Rồi bổ sung import còn thiếu mà `npm run typecheck` báo (`RecordOrderConfig` từ `../core/orderIngest.js`, `UserOrderSummary` cùng file). Đây là **di chuyển thuần**: không đổi một ký tự logic.

(d) Thêm `tiktokView()` + throttle + route. Đặt ngay sau `notifyImportOutcomes` (cùng chỗ chèn ở trên; thêm vào cuối `NOTIFY_HELPER`, trước `app.post(` của shopee-report):

```ts
  // Canh bao admin cua duong TikTok: gop theo key trong 15 phut (xem AlertThrottle). Tin DAU luon gui.
  const tiktokAlertThrottle = new AlertThrottle(15 * 60 * 1000);

  /** undefined khi TikTok tat → renderRecordOrdersPage khong ve the. */
  function tiktokView(result: TiktokOrderImportResult | null = null, error: string | null = null): TiktokCardState | undefined {
    return syncTiktokOrders ? { result, error } : undefined;
  }

  app.post("/admin/record-orders/tiktok-sync", requireAdminAuth, async (_req: Request, res: Response) => {
    if (!syncTiktokOrders) {
      res.status(404).type("text").send("TikTok chua duoc bat (TIKTOK_ENABLED, RIOHUB_API_KEY, RIOHUB_CREATOR_USERNAME).");
      return;
    }

    let result: TiktokOrderImportResult;
    try {
      const orders = await syncTiktokOrders();
      result = importTiktokOrders(logStore, ledgerStore, { recordOrderConfig: currentOrderConfig() }, orders);
    } catch (err) {
      console.warn("[tiktok-sync] dong bo don that bai:", err);
      res
        .status(502)
        .type("html")
        .send(
          renderRecordOrdersPage(
            ledgerStore.listImportHistory(20),
            null,
            null,
            null,
            navPendingWithdrawals(),
            tiktokView(null, describeRiohubSyncError(err))
          )
        );
      return;
    }

    notifyImportOutcomes(result);
    for (const alert of result.alerts) {
      if (tiktokAlertThrottle.shouldSend(alert.key)) {
        notifyAdmin(alert.message).catch((alertErr) => {
          console.warn("[tiktok-sync] gui canh bao admin that bai:", alertErr);
        });
      }
    }
    ledgerStore.recordImportHistory({
      actionType: "tiktok",
      newOrderIds: result.newOrderIds,
      statusTransitions: result.statusTransitions,
    });
    res
      .type("html")
      .send(
        renderRecordOrdersPage(ledgerStore.listImportHistory(20), null, null, null, navPendingWithdrawals(), tiktokView(result))
      );
  });
```
Thêm vào import: `type TiktokOrderImportResult` từ `../core/tiktokOrderImport.js` (gộp với dòng `importTiktokOrders` ở (a)).

(e) **Nối `tiktokView()` vào CẢ 6 chỗ gọi `renderRecordOrdersPage(`** trong `server.ts` (grep: `grep -n "renderRecordOrdersPage(" src/api/server.ts` ⇒ 6 kết quả + 1 mới ở route TikTok). Mỗi chỗ cũ kết thúc bằng `navPendingWithdrawals()` làm đối số cuối ⇒ thêm `, tiktokView()` ngay sau nó. Sau khi sửa:

```bash
# moi chi goi cu phai co tiktokView (ngoai 2 chi goi trong route TikTok da tu truyen)
grep -n "renderRecordOrdersPage(" -A 14 src/api/server.ts | grep -c "tiktokView("
```
Expected: ≥ 8 (6 cũ + 2 trong route TikTok). Test "import Shopee KHÔNG gọi fetcher" ở Step 3 cũng chặn trường hợp quên chỗ 422.

- [ ] **Step 7: Nối `index.ts`**

Import (cạnh các import khác): `import { createTiktokOrdersFetcher } from "./core/providers/riohubOrdersSource.js";`

Trước `const app = createServer(` thêm:
```ts
// 2026-10-11: dong bo don TikTok qua RioHub. null (TikTok tat / thieu key) → undefined → the va route
// khong ton tai. Cung dieu kien voi createTiktokProvider() nen hai duong TikTok bat/tat CUNG NHAU.
const syncTiktokOrders = createTiktokOrdersFetcher(env.tiktok) ?? undefined;
```
và truyền làm đối số cuối của `createServer(...)`: sau `syncZaloGroupMembers` thêm `,\n  syncTiktokOrders`.

- [ ] **Step 8: Typecheck + test mới + TOÀN BỘ + bất biến**

```bash
npm run typecheck
npx tsx --test src/api/__tests__/adminTiktokSyncRoute.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|✖"
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
git diff --stat HEAD -- src/core/__tests__/shopeeReport*.test.ts src/core/__tests__/payoutDebt.test.ts src/api/__tests__/adminRoutes.test.ts
```
Expected: `fail 0`; lệnh diff cuối **rỗng** — đặc biệt `adminRoutes.test.ts` (route Shopee sau khi rút helper) phải xanh KHÔNG SỬA.

- [ ] **Step 9: Kiểm tra bằng mắt trên trình duyệt thật** (rule `admin-ui-nen-tang.md`: test không bắt được lỗi CSS)

Dựng server xem trang theo `feedback_preview_admin_without_bots` (server riêng trên DB tạm, KHÔNG `npm run dev`; xem `preview-server.ts` ở gốc repo), truyền một fetcher giả trả vài đơn, mở `/admin/record-orders`, chụp ở cả 1440px và 375px. Kiểm: thẻ TikTok nằm dưới lưới 2 cột, 11+6 ô thống kê không tràn ngang trên mobile, chip "Loại" của dòng lịch sử `tiktok` có nhãn "Đồng bộ đơn TikTok Shop". Nếu `public/admin.css` chưa chứa class mới → `npm run build:css` rồi `grep` class trong `public/admin.css` (xem bẫy Tailwind trong rule `admin-ui-nen-tang.md`; mọi class dùng ở đây đã có sẵn ở thẻ Shopee ngoại trừ `bg-slate-900`/`hover:bg-slate-800` — **grep hai class này trong `public/admin.css`**, thiếu thì kiểm lại).

- [ ] **Step 10: Commit**

```bash
git add src/core/types.ts src/core/providers/riohubOrdersSource.ts src/api/adminHtml.ts src/api/server.ts src/index.ts src/api/__tests__/adminTiktokSyncRoute.test.ts
git commit -F - <<'EOF'
feat(tiktok): nut dong bo don TikTok o /admin/record-orders

Route POST /admin/record-orders/tiktok-sync + the giao dien. Cach ly Shopee:
hai route rieng, fetcher undefined (TikTok tat) thi the an va route 404, import
Shopee khong bao gio goi RioHub (co test). RioHub hong → 502 voi cau noi ro don
Shopee khong bi anh huong, phan biet 401 (sai key) voi 404 (sai duong dan).

Rut currentOrderConfig() va notifyImportOutcomes() khoi route Shopee de dung chung -
di chuyen nguyen van, adminRoutes.test.ts xanh khong sua.

Canh bao MCN giu tien / actual thap hon so da tra di qua AlertThrottle 15 phut/key.
Khong gui tin vao group Zalo: tin hang ngay thuoc nhip import Shopee 9h30.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Tài liệu (rule mới, CLAUDE.md, docs RioHub, file rủi ro, spec)

**Files:**
- Create: `.claude/rules/doi-soat-don-tiktok.md`
- Modify: `CLAUDE.md` (bảng "đọc file nào khi nào" + bản đồ code)
- Modify: `.claude/rules/import-bao-cao-shopee.md` (1 đoạn: phần áp ledger đã chuyển)
- Modify: `docs/riohub-tiktok.md` (nhật ký verify, mục 1.3b, mục 2.9, "Việc còn treo")
- Modify: `rui-ro-tich-hop-tiktok.md` (xoá rủi ro 2 và 8; cập nhật 1, 3, đoạn đầu)
- Modify: `docs/superpowers/specs/2026-10-11-doi-soat-don-tiktok-design.md` (khớp với code đã làm)

**Quy ước repo:** `.claude/rules/` là nguồn duy nhất cho chi tiết implementation; viết cùng lần sửa code, không để chỉ nằm trong commit message. File rủi ro: giải xong thì **xoá hẳn**, **không đánh lại số**.

- [ ] **Step 1: Tạo `.claude/rules/doi-soat-don-tiktok.md`**

```markdown
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

## Bẫy đã biết

- `sub_id` rỗng là chuỗi `""`, không phải `null`.
- API trả **UTC**; dùng `*_iso`, quy đổi bằng `formatVnDateIso`/`formatVnTimeHms`. Không dùng `settled_at` (bị xoá về null khi đơn chuyển huỷ rồi chốt lại).
- Tham số lọc sai tên/định dạng bị API nuốt im lặng và trả cả lịch sử — kể cả `page`. `fetchTiktokOrders` nén lỗi nếu trang sau không có đơn mới. Chưa lọc ngày: thêm `update_time_start` khi số đơn lớn lên, KÈM phép thử "kết quả phải khác đối chứng".
- Đơn nhỏ vào Khả dụng ở lần đồng bộ KẾ TIẾP sau ngày đã chốt (không tự mở theo ngày) — nghỉ 3 ngày thì chậm 3 ngày.
- `fully_refunded`/`refunded_quantity` KHÔNG được đọc để tính tiền; hoàn MỘT PHẦN trong cùng một SKU chưa có thiết kế. Có đèn báo: dòng có `refunded_quantity > 0` mà `status ≠ 3` → dòng trong `errors`.
- Sáu thứ CHƯA quan sát lần nào (đừng đọc nhánh code của chúng như bằng chứng): `status=2`, `status=3`, `actual_commission` có giá trị, `status` lạ, đơn nhiều SKU, hoàn một phần cùng SKU.

## Cảnh báo admin

`shared_with_partner ≠ 0` (key `tiktok_mcn_cut`) và `actual` thấp hơn số đã trả trừ biên 2% (key `tiktok_actual_below_assumed`, so thẳng với `assumed`) đi qua `AlertThrottle` 15 phút/key. `pit` khác 0 KHÔNG cảnh báo (kỳ vọng vĩnh viễn — báo mỗi ngày thì sau một tuần bị bỏ qua và cảnh báo thật cũng bị bỏ qua); nó hiện ở khối "Số liệu đã quyết toán". Cảnh báo nổ SAU khi tiền mấy đơn đầu đã trả user — giá trị là chặn lỗ âm thầm kéo dài, không chặn được đơn đã trả. Chủ bot chọn chỉ cảnh báo, không tự khoá đồng bộ.
```

- [ ] **Step 2: `CLAUDE.md`** — hai chỗ (dùng script có assert như các task trước hoặc Edit; mỗi chuỗi cũ phải xuất hiện đúng 1 lần)

Trong bảng "đọc file nào khi nào", thêm dòng NGAY SAU dòng `import-bao-cao-shopee.md`:
```
| `doi-soat-don-tiktok.md` | Sửa `tiktokOrderImport.ts`, `tiktokCommission.ts`, `orderStatusApply.ts`, `riohubOrdersSource.ts`, nút đồng bộ đơn TikTok; đổi mốc chốt đơn hoặc cách tính hoa hồng TikTok |
```
Trong "Bản đồ code", dòng `shopeeReportImport -> import-bao-cao-shopee.md` thêm kế bên:
```
  shopeeReportImport                                    -> import-bao-cao-shopee.md
  orderStatusApply tiktokOrderImport tiktokCommission   -> doi-soat-don-tiktok.md
```
Đồng thời sửa câu đầu mục "Project": "TikTok Shop đang được tích hợp qua RioHub" → "TikTok Shop đã tích hợp qua RioHub (tạo link đã chạy thật; đối soát đơn: `.claude/rules/doi-soat-don-tiktok.md`), xem `docs/riohub-tiktok.md`".

- [ ] **Step 3: `.claude/rules/import-bao-cao-shopee.md`** — thêm ngay dưới tiêu đề `## shopeeReportImport.ts` một đoạn:

```markdown
**(2026-10-11) Phần ÁP trạng thái một đơn vào ledger đã chuyển sang `src/core/orderStatusApply.ts`** (bảng quyết định 5 ca bên dưới, tự huỷ yêu cầu rút, ghi nợ, hoãn đơn nhỏ, cảnh báo hoa hồng bị khoá, `recordSeenOrder`/`recordOrderStatusEvent`) vì đường đối soát TikTok dùng chung. `importShopeeReport` giờ chỉ còn: đọc CSV, gộp dòng, phân loại nhãn tiếng Việt, rồi gọi `applyOrderStatusToLedger` và map outcome về `ShopeeReportImportResult`. **Sửa luật tiền của các nhánh dưới đây = sửa `orderStatusApply.ts` và đổi cả TikTok** — bộ test trực tiếp của nó (`orderStatusApply.test.ts`) chạy với cả hai merchant. Refactor đó không đổi hành vi: 4 file test Shopee xanh không sửa dòng nào.
```

- [ ] **Step 4: `docs/riohub-tiktok.md`**

(a) **Nhật ký verify**: thêm các dòng (trước `\n## Việc còn treo`):
```
| 2026-10-11 | `GET /orders` sau khi user đặt thêm đơn qua link bot | 4 đơn; **đơn thứ 2 từ link bot** (`…-mv19z39z-acc5c0`, `trace_type: SPECIFIC`) cũng về nguyên văn |
| 2026-10-11 | Một đơn đã giao (`586474851567371966`) | ✅ **`time_delivered_iso` có giá trị thật** (`2026-10-10T07:49:05Z`) — nhưng `actual_commission` vẫn `—`, `settlement_status` vẫn `To-SETTLE`: giao hàng và có số thật cách nhau rất xa → chốt đơn theo mốc giao hàng |
| 2026-10-11 | Smoke `importTiktokOrders` trên JSON thật (DB bộ nhớ) | (điền kết quả Task 4b: field thật khớp giả định, hoa hồng 2871/1922, ngày VN) |
```
(b) **Mục 1.3b** — thêm đoạn cuối:
```markdown
**Cập nhật 2026-10-11 (đối soát đơn):** đầu vào của đường tiền KHÔNG phải `actual_commission` như bảng số trên giả định, mà là `est_commission × 0,9` (`TIKTOK_PIT_RETAINED_RATIO`, `src/core/tiktokCommission.ts`). Lý do: đơn vào Khả dụng lúc **giao hàng**, lúc đó chỉ có `est` (số thô, chưa trừ `pit`); `actual` phải chờ ~15 ngày. Kết quả cho user giống bảng trên (hoa hồng gốc 1.922đ thay vì 2.136đ ⇒ user nhận 1.370đ), nhưng nguồn số và lý do khác. Xem `.claude/rules/doi-soat-don-tiktok.md`.
```
(c) **Mục 2.9** — thay đoạn "Việc cần làm" cho khớp thực tế: link tạo xong; đối soát đã có (`orderStatusApply` → `tiktokOrderImport`); `tiktokshop` về `MERCHANTS` khi `TIKTOK_ENABLED=true`.
(d) **"Việc còn treo"**: gạch `[x]` dòng "Đơn thật đi hết vòng đời → chốt `time_delivered_iso`" thành hai dòng: `[x] time_delivered_iso` (2026-10-11) và `[ ] pit, shared_with_partner, status=2/3 — chờ đơn quyết toán đầu tiên`; thêm `[ ] Đối chiếu TIKTOK_PIT_RETAINED_RATIO=0,9 với pit thật`.

- [ ] **Step 5: `rui-ro-tich-hop-tiktok.md`** — script (assert từng marker đúng 1 lần)

```python
import os
os.chdir("/Users/ryan/Documents/Claude/Projects/Affiliate Bot Shopee")
R = "rui-ro-tich-hop-tiktok.md"
s = open(R, encoding="utf-8").read()

# Xoa han rui ro 2 (time_delivered_iso da co gia tri that)
a = s.index("### 2. `time_delivered_iso` luôn `null`")
b = s.index("### 3. `shared_with_partner`")
s = s[:a] + s[b:]

# Xoa han rui ro 8 (da quyet polling, khong lam webhook)
a = s.index("### 8. Webhook")
b = s.index("---\n\n## Rủi ro nhỏ")
s = s[:a] + s[b:]

# Doan dau
old = "Đường **đối soát đơn chưa làm** — đó là nơi phần lớn rủi ro còn lại nằm."
assert s.count(old) == 1
s = s.replace(old, "Đường **đối soát đơn đã làm** (2026-10-11, bấm tay — `.claude/rules/doi-soat-don-tiktok.md`) nhưng mới chạy trên 4 đơn chưa quyết toán: phần lớn rủi ro còn lại là những thứ CHƯA TỪNG QUAN SÁT.", 1)
open(R, "w", encoding="utf-8").write(s)
print("ok")
```
Sau đó sửa tay:
- **Rủi ro 1**: thêm đoạn "2026-10-11: bảng quyết định đã dựng (spec mục 5.3) và có test, nhưng 6 ca vẫn chưa quan sát: `status=2`, `status=3`, `actual_commission` có giá trị, `status` lạ, đơn nhiều SKU, hoàn một phần cùng SKU (xem mục 5.8 của spec). Đèn báo `refunded_quantity` ở `errors` bắt ca cuối."
- **Rủi ro 3**: thêm "Đã có cơ chế cảnh báo (`tiktok_mcn_cut`, `tiktok_actual_below_assumed`, spec mục 7) và khối 'Số liệu đã quyết toán' trên trang đồng bộ. Còn CHỜ DỮ LIỆU: bản thân giá trị `shared_with_partner`/`pit`. Cảnh báo nổ sau khi tiền mấy đơn đầu đã trả user — chặn lỗ kéo dài, không hoàn lại được."
- Ghi chú kỹ thuật về `sub3`/`sub4` ("Ghi chú kỹ thuật giữ lại từ mục 7") **đã được code áp dụng** (`sub_id !== ""`) — xoá ghi chú đó.

- [ ] **Step 6: Khớp spec với code đã làm** — `docs/superpowers/specs/2026-10-11-doi-soat-don-tiktok-design.md`

- Mục 4.2 & 9: `withdrawalId: number` → `withdrawalId: string` (khớp `ShopeeReportImportResult`).
- Mục 9: thêm `skippedNoEstimate: number;` và `alerts: Array<{ key: "tiktok_mcn_cut" | "tiktok_actual_below_assumed"; message: string }>;` (import trả cảnh báo, tầng route lọc qua `AlertThrottle` — giữ `core` thuần).
- Mục 4.2: `OrderStatusOutcome` cho đúng bản đã cài: `confirmed-new` có thêm `newOrder`; `small-hold-deferred` có `newOrder`; `reversed.from: "pending" | "confirmed"`; `OrderStatusApplyInput` có `notes: { confirmed; pending }` và `confirmedClaim` thay cho `sourceNote`.
- Mục 8: thêm 1 dòng — "hàm `describeRiohubSyncError()` phân biệt 401 (sai key) với 404 (sai đường dẫn)".

- [ ] **Step 7: Kiểm tra toàn bộ + commit**

```bash
npm run typecheck && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
git diff --stat HEAD -- src/core/__tests__/shopeeReport*.test.ts src/core/__tests__/payoutDebt.test.ts src/api/__tests__/adminRoutes.test.ts
grep -rn "TODO\|TBD" .claude/rules/doi-soat-don-tiktok.md || echo "sach"
git add .claude/rules/doi-soat-don-tiktok.md .claude/rules/import-bao-cao-shopee.md CLAUDE.md docs/riohub-tiktok.md rui-ro-tich-hop-tiktok.md docs/superpowers/specs/2026-10-11-doi-soat-don-tiktok-design.md
git commit -F - <<'EOF'
docs(tiktok): rule doi soat don, dong rui ro 2 va 8, khop spec voi code

- Rule moi .claude/rules/doi-soat-don-tiktok.md + dong tra trong CLAUDE.md
- import-bao-cao-shopee.md: ghi phan ap ledger da chuyen sang orderStatusApply
- docs/riohub-tiktok.md: nhat ky verify, muc 1.3b (dau vao la est x 0,9, khong phai actual)
- rui-ro-tich-hop-tiktok.md: xoa rui ro 2 (time_delivered_iso co gia tri that 10/10)
  va 8 (chon polling), cap nhat 1 va 3; khong danh lai so
- spec: withdrawalId la string, them skippedNoEstimate/alerts, khop OrderStatusOutcome

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

## Self-Review (đã chạy sau khi viết xong)

**1. Phủ spec** — mỗi mục spec → task:

| Spec | Task |
|---|---|
| 2.1 bấm tay | 5 (route + thẻ), không `setInterval` |
| 2.2 mốc giao hàng, 5.3 bảng 4 ca | 4 (`importTiktokOrders`; test "ĐÃ GIAO chưa quyết toán → CONFIRMED") |
| 2.2b / 5.4 / 5.4b hoa hồng `est × 0,9` | 2 (hằng số + `estimateFrom`), 4 (ledger) |
| 2.3 / 4 tách lớp, 4.3 bất biến | 1 |
| 2.4 / 6 bốn chốt cách ly | 4 (chốt 1: `tiktokOrderIsolation.test.ts`), 5 (chốt 2, 3: `adminTiktokSyncRoute.test.ts`), 6 (chốt 4 ghi vào rule) |
| 2.5 / 7 cảnh báo | 4 (alerts + settledTotals), 5 (AlertThrottle, khối "Số liệu đã quyết toán") |
| 3.2 quét toàn bộ, phân trang | 4 (`fetchTiktokOrders` chống tham số bị nuốt) |
| 5.5 ngày | 3 (`formatVnTimeHms`), 4 (test UTC→VN, 17:30Z sang ngày sau) |
| 5.6 quy về user | 4 (`""` vs `null`, không khớp, sai sàn) |
| 5.8 khoảng hở hoàn một phần | 4 (đèn báo `refunded_quantity`) |
| 8 route + UI + `ImportActionType` | 5 (Step 1 để trình biên dịch tự chỉ) |
| 10 test | 1, 2, 3, 4, 5 |
| 11 tài liệu | 6 |

Spec 9 liệt kê `skippedNoEstimate`/`alerts`? **Không** — plan thêm hai thứ đó cho khớp code; Task 6 Step 6 sửa spec cho khớp (đây là chỗ plan đi trước spec, đã ghi).

**2. Quét placeholder** — không có "TBD/TODO/implement later". Hai chỗ cố ý ghi kết quả sau khi chạy: dòng nhật ký "(điền kết quả Task 4b…)" ở Task 6 Step 4(a) — đó là số đo thật phải điền từ Task 4b, không phải lỗ hổng thiết kế.

**3. Nhất quán kiểu** — kiểm chéo:
- `OrderStatusOutcome.confirmed-new` có `newOrder` — Task 1 (định nghĩa) = Task 1 (map Shopee) = Task 4 (map TikTok) ✔.
- `withdrawalId: string` ở `orderStatusApply`, `ShopeeReportImportResult`, `TiktokOrderImportResult`, `ImportOutcomesToNotify` ✔ (spec ghi `number` — sửa ở Task 6 Step 6).
- `estimateTiktokNetCommission`/`isActualBelowAssumed` — Task 2 (định nghĩa) = Task 4 (dùng) ✔.
- `importTiktokOrders(logStore, ledgerStore, { recordOrderConfig }, orders)` — Task 4 = Task 5 route = Task 4b smoke ✔.
- `createTiktokOrdersFetcher(env.tiktok)` — `env.tiktok` có thêm `linkChannel`; TypeScript chấp nhận vì không phải object literal ✔.
- `tiktokView()` trả `undefined` khi fetcher vắng ⇒ `renderRecordOrdersPage(..., tiktok?)` ✔.

**Rủi ro còn lại của chính plan này** (nói thẳng để người thực thi không bị bất ngờ):
1. Task 1 Step 6 và Task 5 Step 6(c) là hai chỗ **sửa code Shopee đang chạy**. Cả hai đều có "phép thử" tự động (4 file test Shopee + `adminRoutes.test.ts` không sửa) — nhưng đó là phép thử *hành vi qua test*, không chứng minh được các nhánh chưa có test. Trước khi báo xong, đọc `git diff HEAD~N -- src/core/shopeeReportImport.ts` một lượt bằng mắt đối chiếu với bản cũ.
2. Task 4b là bước duy nhất chạm API thật và **phụ thuộc `.env` cục bộ có key**. Nếu thiếu key ⇒ báo chủ bot, KHÔNG bỏ qua bước (fixture dựng từ output CLI chỉ có một phần field).
3. Cú pháp `toLocaleTimeString("en-GB", { hourCycle: "h23" })` đã được chọn thay vì `hour12:false` vì lý do `24:xx`; test ở Task 3 Step 1 là thứ xác nhận trên đúng phiên bản Node đang dùng.

---

## Execution Handoff

Plan lưu tại `docs/superpowers/plans/2026-10-11-doi-soat-don-tiktok.md`. Chủ bot đã nói "code đi" và cho phép tự quyết — em chọn **Inline Execution** (`superpowers:executing-plans`) thay vì subagent: bất biến lớn nhất của đợt này (test Shopee xanh không sửa) cần một người giữ toàn bộ ngữ cảnh baseline xuyên suốt 6 task, và Task 1 + Task 5 sửa code Shopee nên cần soi diff bằng chính mắt người làm.

