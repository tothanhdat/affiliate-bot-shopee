# Chi tiết từng sản phẩm trong đơn nhiều món — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lưu và hiển thị chi tiết từng sản phẩm của đơn nhiều món (bỏ quà tặng giá 0đ) trên `/admin/orders` và dashboard user `/d/:token`; kèm 2 việc phụ: nút "Rút tiền" mờ khi chưa đủ điều kiện, và `{{san}}` cho template chào bù trong group.

**Architecture:** Bảng mới `commission_entry_items` ghi bằng một lời gọi riêng `replaceEntryItems()` từ `importShopeeReport`, **không** đi qua `orderStatusApply.ts` (đường tiền dùng chung với TikTok). `mergeOrderRows` lọc quà tặng theo giá niêm yết = 0 và trả thêm `items`. Hai trang render danh sách món bằng `<details>` native, chỉ khi cộng lại khớp đúng số của đơn.

**Tech Stack:** TypeScript, `node:sqlite`, `node:test` qua `tsx`, HTML viết tay, Tailwind v4 không preflight (khu `/admin`).

**Spec:** `docs/superpowers/specs/2026-10-11-chi-tiet-san-pham-trong-don-design.md`

## Global Constraints

- **Không đổi một đồng tiền nào.** Không sửa `orderStatusApply.ts`, `commissionMath.ts`, `payoutHold.ts`.
- Lọc quà tặng theo **giá niêm yết (`Giá(₫)`) = 0**, KHÔNG theo hoa hồng = 0 (3 món mua thật hoa hồng 0đ phải còn).
- Cột `Giá(₫)` vắng (fixture/báo cáo cũ) ⇒ KHÔNG coi là quà tặng (sai theo hướng hiện nhiều hơn, không bao giờ ẩn món thật).
- Khoá `(merchant, order_id, item_id, model_id)`; `model_id` bắt buộc trong khoá. `commission_amount` là `REAL`, **không làm tròn khi lưu**; làm tròn chỉ ở `formatVnd`.
- `order_amount` lấy cột `Giá trị đơn hàng (₫)` của dòng, không phải `Giá(₫)`.
- Dòng Sub_id rỗng/khác Sub_id của đơn: bỏ hẳn, không vào items.
- SQLite qua `node:sqlite`; bảng mới ⇒ không cần migration cột.
- `src/core/**` không import `express`/`telegraf`.
- Mọi `product_name` từ Shopee phải `escapeHtml` khi render.
- Dashboard user: mobile là màn hình chính ⇒ danh sách **dọc**, không bảng ngang; chỉ hiện khi ≥2 món **và** cộng lại khớp thẻ đơn.
- Khu `/admin` không nạp preflight: `<summary>`/`<ul>` phải tự reset; **cấm** utility tuỳ ý chứa khoảng trắng; sau khi build CSS phải grep `public/admin.css` xác nhận class được sinh.
- Default template `groupJoinBlockedReplyTemplate` **giữ nguyên câu chữ** (không thêm `{{san}}` vào default).
- Comment trong code theo style repo: tiếng Việt không dấu. Chuỗi hiển thị cho user/admin: tiếng Việt có dấu.
- Test: `npx tsx --test <file>`; toàn bộ: `npm test`; kiểu: `npm run typecheck`.
- Commit message kết thúc bằng: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`

## File Structure

| File | Trách nhiệm | Việc |
|---|---|---|
| `src/core/entryItems.ts` | Kiểu `CommissionEntryItem`/`EntryItemInput`, `entryItemsKey()`, `entryItemsReconcile()` — thuần, không DB | **Tạo** |
| `src/core/ledgerStore.ts` | Bảng `commission_entry_items`, `replaceEntryItems()`, `listEntryItemsFor()`, `getUserSummary().entryItems` | Sửa |
| `src/core/shopeeReportImport.ts` | Đọc 4 cột mới, lọc quà tặng, `items` trong `MergedOrder`, nhãn `(+N …)`, gọi `replaceEntryItems` | Sửa |
| `src/api/dashboardHtml.ts` | Khối chi tiết món trong thẻ đơn; nút "Rút tiền" mờ; CSS | Sửa |
| `src/api/adminHtml.ts` | `<details>` trong ô "Sản phẩm" của `/admin/orders` | Sửa |
| `src/api/server.ts` | Truyền `listEntryItemsFor(entries)` vào `renderOrdersPage` | Sửa |
| `src/adapters/shared/replyText.ts`, `src/config/settingsRegistry.ts` | `{{san}}` cho template chào bù | Sửa |
| Tests mới: `commissionEntryItems.test.ts`, `shopeeReportItems.test.ts`, `orderItemsRender.test.ts` | | **Tạo** |
| Tests sửa: `dashboardWithdrawHint`, `dashboardRoutes`, `adminRoutes`, `replyText`, `zaloBot` | | Thêm test |
| `.claude/rules/*.md` (5 file) + spec | Cập nhật tài liệu | Sửa |

---

### Task 1: Bảng chi tiết món + store + helper thuần

**Files:**
- Create: `src/core/entryItems.ts`
- Modify: `src/core/ledgerStore.ts` (schema ~dòng 365; import đầu file; thêm 2 method cạnh `getEntryByOrderId` ~dòng 1893)
- Test: `src/core/__tests__/commissionEntryItems.test.ts`

**Interfaces:**
- Consumes: `MerchantId` từ `./merchants.js`.
- Produces (các task sau dùng đúng tên này):
  - `type EntryItemStatus = "confirmed" | "pending" | "reversed"`
  - `interface EntryItemInput { itemId: string; modelId: string; productName: string; quantity: number; orderAmount: number; commissionAmount: number; rowStatus: EntryItemStatus }`
  - `interface CommissionEntryItem extends EntryItemInput { merchant: MerchantId; orderId: string }`
  - `entryItemsKey(merchant: string, orderId: string): string` → `` `${merchant}:${orderId}` ``
  - `entryItemsReconcile(entry: { orderAmount: number; commissionAmount: number }, items: readonly CommissionEntryItem[]): boolean`
  - `LedgerStore.replaceEntryItems(merchant: MerchantId, orderId: string, items: readonly EntryItemInput[]): void`
  - `LedgerStore.listEntryItemsFor(keys: ReadonlyArray<{ merchant: MerchantId; orderId: string }>): Map<string, CommissionEntryItem[]>`

- [ ] **Step 1: Viết test (sẽ fail)**

Tạo `src/core/__tests__/commissionEntryItems.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";
import {
  entryItemsKey,
  entryItemsReconcile,
  type CommissionEntryItem,
  type EntryItemInput,
} from "../entryItems.js";

function item(overrides: Partial<EntryItemInput> = {}): EntryItemInput {
  return {
    itemId: "100",
    modelId: "1",
    productName: "San pham A",
    quantity: 1,
    orderAmount: 100_000,
    commissionAmount: 2_500,
    rowStatus: "pending",
    ...overrides,
  };
}

function listOne(store: LedgerStore, merchant: "shopee" | "tiktokshop", orderId: string) {
  return store.listEntryItemsFor([{ merchant, orderId }]).get(entryItemsKey(merchant, orderId));
}

test("replaceEntryItems: doc lai dung thu tu bao cao va giu hoa hong le (khong lam tron)", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.replaceEntryItems("shopee", "O1", [
      item({ itemId: "1", commissionAmount: 4836.375 }),
      item({ itemId: "2", productName: "B" }),
    ]);
    const got = listOne(store, "shopee", "O1");
    assert.deepEqual(got?.map((i) => i.itemId), ["1", "2"]);
    assert.equal(got?.[0].commissionAmount, 4836.375);
    assert.equal(got?.[0].merchant, "shopee");
    assert.equal(got?.[0].orderId, "O1");
  } finally {
    store.close();
  }
});

test("replaceEntryItems: goi lai 2 lan KHONG nhan doi", () => {
  const store = new LedgerStore(":memory:");
  try {
    const items = [item({ itemId: "1" }), item({ itemId: "2" })];
    store.replaceEntryItems("shopee", "O1", items);
    store.replaceEntryItems("shopee", "O1", items);
    assert.equal(listOne(store, "shopee", "O1")?.length, 2);
  } finally {
    store.close();
  }
});

test("replaceEntryItems: dong Shopee da bo khoi bao cao bien mat (khong de lai mon ma)", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.replaceEntryItems("shopee", "O1", [item({ itemId: "1" }), item({ itemId: "2" }), item({ itemId: "3" })]);
    store.replaceEntryItems("shopee", "O1", [item({ itemId: "1" }), item({ itemId: "2" })]);
    assert.deepEqual(listOne(store, "shopee", "O1")?.map((i) => i.itemId), ["1", "2"]);
  } finally {
    store.close();
  }
});

test("replaceEntryItems: mang rong xoa sach chi tiet cua don", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.replaceEntryItems("shopee", "O1", [item()]);
    store.replaceEntryItems("shopee", "O1", []);
    assert.equal(listOne(store, "shopee", "O1"), undefined);
  } finally {
    store.close();
  }
});

test("replaceEntryItems: cung item_id KHAC model_id la 2 mon rieng (don that 2610109S28J4XY)", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.replaceEntryItems("shopee", "O1", [
      item({ itemId: "18193835545", modelId: "168152404387", commissionAmount: 4836.375 }),
      item({ itemId: "18193835545", modelId: "168152404388", commissionAmount: 4836.375 }),
    ]);
    assert.equal(listOne(store, "shopee", "O1")?.length, 2);
  } finally {
    store.close();
  }
});

test("replaceEntryItems: cung item_id + model_id trong 1 don duoc CONG DON, tong giu nguyen", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.replaceEntryItems("shopee", "O1", [
      item({ itemId: "9", modelId: "5", quantity: 1, orderAmount: 23_399, commissionAmount: 100.5 }),
      item({ itemId: "9", modelId: "5", quantity: 2, orderAmount: 25_999, commissionAmount: 200.25 }),
    ]);
    const got = listOne(store, "shopee", "O1");
    assert.equal(got?.length, 1);
    assert.equal(got?.[0].quantity, 3);
    assert.equal(got?.[0].orderAmount, 49_398);
    assert.equal(got?.[0].commissionAmount, 300.75);
  } finally {
    store.close();
  }
});

test("replaceEntryItems: gop mon cung khoa, trang thai KHONG huy thang trang thai huy", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.replaceEntryItems("shopee", "O1", [
      item({ itemId: "9", modelId: "5", rowStatus: "reversed", orderAmount: 0, commissionAmount: 0 }),
      item({ itemId: "9", modelId: "5", rowStatus: "pending" }),
    ]);
    assert.equal(listOne(store, "shopee", "O1")?.[0].rowStatus, "pending");
  } finally {
    store.close();
  }
});

test("listEntryItemsFor: chi tra don duoc hoi, tach theo merchant, don khong co item thi vang mat", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.replaceEntryItems("shopee", "O1", [item({ itemId: "1" })]);
    store.replaceEntryItems("shopee", "O2", [item({ itemId: "2" })]);
    store.replaceEntryItems("tiktokshop", "O1", [item({ itemId: "3" })]);

    const map = store.listEntryItemsFor([
      { merchant: "shopee", orderId: "O1" },
      { merchant: "shopee", orderId: "O-khong-co" },
    ]);
    assert.deepEqual([...map.keys()], [entryItemsKey("shopee", "O1")]);
    assert.deepEqual(map.get(entryItemsKey("shopee", "O1"))?.map((i) => i.itemId), ["1"]);
  } finally {
    store.close();
  }
});

test("listEntryItemsFor: danh sach rong -> Map rong, khong goi DB", () => {
  const store = new LedgerStore(":memory:");
  try {
    assert.equal(store.listEntryItemsFor([]).size, 0);
  } finally {
    store.close();
  }
});

function full(overrides: Partial<CommissionEntryItem> = {}): CommissionEntryItem {
  return { merchant: "shopee", orderId: "O1", ...item(), ...overrides };
}

test("entryItemsReconcile: khop khi cong cac mon dung bang so cua don", () => {
  const items = [
    full({ orderAmount: 193_455, commissionAmount: 4836.375 }),
    full({ itemId: "2", orderAmount: 101_000, commissionAmount: 2525 }),
  ];
  assert.equal(entryItemsReconcile({ orderAmount: 294_455, commissionAmount: 7361.375 }, items), true);
});

test("entryItemsReconcile: lech hoa hong hoac gia tri -> false", () => {
  const items = [full({ orderAmount: 100_000, commissionAmount: 5_000 })];
  assert.equal(entryItemsReconcile({ orderAmount: 100_000, commissionAmount: 5_001 }, items), false);
  assert.equal(entryItemsReconcile({ orderAmount: 100_001, commissionAmount: 5_000 }, items), false);
});

test("entryItemsReconcile: mon da huy khong duoc cong", () => {
  const items = [
    full({ orderAmount: 100_000, commissionAmount: 5_000 }),
    full({ itemId: "2", rowStatus: "reversed", orderAmount: 90_000, commissionAmount: 4_500 }),
  ];
  assert.equal(entryItemsReconcile({ orderAmount: 100_000, commissionAmount: 5_000 }, items), true);
});
```

- [ ] **Step 2: Chạy để thấy fail**

Run: `npx tsx --test src/core/__tests__/commissionEntryItems.test.ts`
Expected: FAIL — `Cannot find module '../entryItems.js'`.

- [ ] **Step 3: Tạo `src/core/entryItems.ts`**

```ts
import type { MerchantId } from "./merchants.js";

/**
 * Chi tiet TUNG SAN PHAM cua 1 don nhieu mon (2026-10-11) - CHI de HIEN THI, khong tham gia tinh
 * tien: tien cua don van la 1 entry trong commission_entries (da cong dung tu 2026-09-10 qua
 * mergeOrderRows). Bang nay chi giu lai phan chi tiet ma truoc do bi vut di sau khi gop.
 *
 * Qua tang (gia niem yet = 0) KHONG bao gio vao day - loc o shopeeReportImport.mergeOrderRows.
 */
export type EntryItemStatus = "confirmed" | "pending" | "reversed";

export interface EntryItemInput {
  itemId: string;
  /** "" khi bao cao thieu cot "ID Model". Nam trong khoa chinh: cung item_id khac model la 2 mon. */
  modelId: string;
  productName: string;
  quantity: number;
  /** VND, cot "Gia tri don hang (d)" cua CHINH dong do (KHONG phai cot "Gia" niem yet). */
  orderAmount: number;
  /** VND, cot "Tong hoa hong san pham(d)" cua chinh dong do. KHONG lam tron: Shopee tra le toi phan nghin. */
  commissionAmount: number;
  rowStatus: EntryItemStatus;
}

export interface CommissionEntryItem extends EntryItemInput {
  merchant: MerchantId;
  orderId: string;
}

export function entryItemsKey(merchant: string, orderId: string): string {
  return `${merchant}:${orderId}`;
}

/** Sai so so thuc khi cong cac mon - so goc deu la tong cua CHINH cac dong do nen thuc te la ~1e-9. */
const RECONCILE_TOLERANCE = 0.01;

/**
 * Cac mon (khong tinh mon da huy) cong lai co DUNG BANG "Gia tri don" va "Hoa hong" cua don khong.
 * Day la dieu kien de hien danh sach cho user: loi hua cua khoi chi tiet la "cong lai ra dung so
 * tren the", mot danh sach khong khop thi gay hieu nham hon la khong hien.
 * Khong khop khi: admin da khoa/sua tay hoa hong, hoac don co dong khong doc duoc (thieu item_id).
 */
export function entryItemsReconcile(
  entry: { orderAmount: number; commissionAmount: number },
  items: readonly CommissionEntryItem[]
): boolean {
  let amount = 0;
  let commission = 0;
  for (const i of items) {
    if (i.rowStatus === "reversed") continue;
    amount += i.orderAmount;
    commission += i.commissionAmount;
  }
  return (
    Math.abs(amount - entry.orderAmount) < RECONCILE_TOLERANCE &&
    Math.abs(commission - entry.commissionAmount) < RECONCILE_TOLERANCE
  );
}
```

- [ ] **Step 4: Thêm bảng + 2 method vào `ledgerStore.ts`**

4a. Import (cạnh các import `type` khác ở đầu file):

```ts
import { entryItemsKey, type CommissionEntryItem, type EntryItemInput, type EntryItemStatus } from "./entryItems.js";
```

4b. Trong khối `CREATE TABLE` lớn, ngay sau dòng `CREATE INDEX IF NOT EXISTS idx_payout_debts_user ON payout_debts(platform, user_id);`, chèn:

```sql

      -- Chi tiet tung san pham cua don nhieu mon (2026-10-11), CHI de hien thi. Bang MOI nen khong can
      -- migration. model_id nam trong khoa vi cung item_id khac model la 2 dong tinh tien rieng.
      -- commission_amount la REAL va KHONG lam tron: cong cac mon lai phai ra dung so cua don.
      CREATE TABLE IF NOT EXISTS commission_entry_items (
        merchant TEXT NOT NULL,
        order_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        order_amount INTEGER NOT NULL,
        commission_amount REAL NOT NULL,
        row_status TEXT NOT NULL,
        PRIMARY KEY (merchant, order_id, item_id, model_id)
      );
```

4c. Thêm 2 method ngay trước `getEntryByOrderId(`:

```ts
  /**
   * Thay TOAN BO chi tiet san pham cua 1 don (2026-10-11): XOA roi chen lai trong 1 transaction.
   * Khong dung upsert thuan vi bao cao Shopee liet ke lai ca lich su moi lan import: upsert chong duoc
   * nhan doi nhung KHONG don duoc dong Shopee da bo khoi bao cao -> de lai "mon ma" trong don.
   *
   * 2 dong cung (item_id, model_id) trong 1 don (khac promotion, vd mua le + mua trong combo) duoc
   * CONG DON thanh 1 mon: tong tien giu nguyen va khong vi pham khoa chinh. Trang thai KHONG huy
   * thang trang thai huy, de mon con tien that khong bi gach ngang.
   */
  replaceEntryItems(merchant: MerchantId, orderId: string, items: readonly EntryItemInput[]): void {
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(`DELETE FROM commission_entry_items WHERE merchant = ? AND order_id = ?`)
        .run(merchant, orderId);
      const insert = this.db.prepare(
        `INSERT INTO commission_entry_items
           (merchant, order_id, item_id, model_id, product_name, quantity, order_amount, commission_amount, row_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(merchant, order_id, item_id, model_id) DO UPDATE SET
           quantity = quantity + excluded.quantity,
           order_amount = order_amount + excluded.order_amount,
           commission_amount = commission_amount + excluded.commission_amount,
           row_status = CASE WHEN row_status = 'reversed' THEN excluded.row_status ELSE row_status END`
      );
      for (const it of items) {
        insert.run(
          merchant,
          orderId,
          it.itemId,
          it.modelId,
          it.productName,
          it.quantity,
          it.orderAmount,
          it.commissionAmount,
          it.rowStatus
        );
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /**
   * Chi tiet mon cua NHIEU don trong MOT query (khong N+1) - khoa Map la entryItemsKey(merchant,
   * orderId). Don khong co chi tiet thi vang mat khoi Map. Thu tu mon = thu tu dong trong bao cao.
   * Dung json_each (1 tham so) thay vi IN (?,?,...) de khong cham tran so tham so khi user co nhieu don.
   */
  listEntryItemsFor(
    keys: ReadonlyArray<{ merchant: MerchantId; orderId: string }>
  ): Map<string, CommissionEntryItem[]> {
    const result = new Map<string, CommissionEntryItem[]>();
    if (keys.length === 0) return result;
    const rows = this.db
      .prepare(
        `SELECT merchant, order_id, item_id, model_id, product_name, quantity, order_amount,
                commission_amount, row_status
         FROM commission_entry_items
         WHERE (merchant, order_id) IN (
           SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)
         )
         ORDER BY rowid`
      )
      .all(JSON.stringify(keys.map((k) => [k.merchant, k.orderId]))) as unknown as Array<{
      merchant: MerchantId;
      order_id: string;
      item_id: string;
      model_id: string;
      product_name: string;
      quantity: number;
      order_amount: number;
      commission_amount: number;
      row_status: EntryItemStatus;
    }>;
    for (const r of rows) {
      const key = entryItemsKey(r.merchant, r.order_id);
      const list = result.get(key) ?? [];
      list.push({
        merchant: r.merchant,
        orderId: r.order_id,
        itemId: r.item_id,
        modelId: r.model_id,
        productName: r.product_name,
        quantity: r.quantity,
        orderAmount: r.order_amount,
        commissionAmount: r.commission_amount,
        rowStatus: r.row_status,
      });
      result.set(key, list);
    }
    return result;
  }

```

- [ ] **Step 5: Chạy test, phải pass**

Run: `npx tsx --test src/core/__tests__/commissionEntryItems.test.ts`
Expected: PASS (12 test). Nếu `listEntryItemsFor` fail vì cú pháp row-value `IN (SELECT …)`, báo lại — đó là giả định về bản SQLite của `node:sqlite` cần xác minh, không tự đổi sang cách khác.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/core/entryItems.ts src/core/ledgerStore.ts src/core/__tests__/commissionEntryItems.test.ts
git commit -m "$(cat <<'MSG'
feat(ledger): bang commission_entry_items luu chi tiet tung mon cua don nhieu mon

Bang moi (khong can migration), khoa (merchant, order_id, item_id, model_id).
replaceEntryItems xoa roi chen lai trong 1 transaction de mon Shopee da bo
khoi bao cao khong de lai "mon ma". Chua co ai goi - noi vao import o task sau.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: Đọc cột mới, lọc quà tặng, nhãn `(+N sản phẩm khác)` và `items` trong `mergeOrderRows`

**Files:**
- Modify: `src/core/shopeeReportImport.ts` (import đầu file; `ShopeeReportRow` + `parseShopeeReportRows` ~dòng 179-215; `MergedOrder` ~dòng 232; `mergeOrderRows` ~dòng 301-345)
- Test: `src/core/__tests__/shopeeReportItems.test.ts` (tạo; Task 3 sẽ thêm test vào cùng file)

**Interfaces:**
- Consumes: `EntryItemInput` từ Task 1.
- Produces: `MergedOrder.items: EntryItemInput[]` (Task 3 đọc); quy tắc nhãn `(+N …)` đếm theo dòng không phải quà tặng.

- [ ] **Step 1: Tạo file test với builder + 3 test nhãn**

Tạo `src/core/__tests__/shopeeReportItems.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";
import { LogStore } from "../logStore.js";
import { importShopeeReport } from "../shopeeReportImport.js";

const ORDER_CONFIG = {
  taxPercent: 0,
  platformFeePercent: 0,
  userSharePercent: 80,
  maxCommissionRatioPercent: 1000,
  holdConfig: { thresholdVnd: 0, holdDays: 0 },
};

const SUB_PARTS = ["zalo", "user-a", "abc", "def"];
const SUB_ID = SUB_PARTS.join("-");

// Du 4 cot ma bao cao Shopee THAT co va file test cu (shopeeReportImport.test.ts) khong co:
// "Item id", "ID Model", "Giá(₫)" (gia niem yet), "Số lượng".
const HEADER = [
  "ID đơn hàng",
  "Tên Item",
  "Item id",
  "ID Model",
  "Giá(₫)",
  "Số lượng",
  "Giá trị đơn hàng (₫)",
  "Tổng hoa hồng sản phẩm(₫)",
  "Trạng thái sản phẩm liên kết",
  "Sub_id1",
  "Sub_id2",
  "Sub_id3",
  "Sub_id4",
  "Sub_id5",
];

interface ItemRow {
  orderId?: string;
  name: string;
  itemId: string;
  modelId?: string;
  /** Cot "Gia(d)" niem yet - 0 nghia la qua tang. */
  listPrice: number;
  quantity?: number;
  /** Cot "Gia tri don hang (d)" cua dong. */
  amount: number;
  commission: number;
  status?: string;
  subIdParts?: string[];
}

function csv(rows: ItemRow[]): string {
  const lines = [HEADER.join(",")];
  for (const r of rows) {
    const parts = r.subIdParts ?? SUB_PARTS;
    const sub = [0, 1, 2, 3, 4].map((i) => parts[i] ?? "");
    lines.push(
      [
        r.orderId ?? "ORD1",
        `"${r.name.replace(/"/g, '""')}"`,
        r.itemId,
        r.modelId ?? "1",
        String(r.listPrice),
        String(r.quantity ?? 1),
        String(r.amount),
        String(r.commission),
        r.status ?? "Đang chờ xử lý",
        ...sub,
      ].join(",")
    );
  }
  return lines.join("\n");
}

function seedRequestLog(logStore: LogStore, subId = SUB_ID) {
  logStore.record({
    platform: "zalo",
    merchant: "shopee",
    userId: "user-a",
    originalUrl: "https://shopee.vn/product/1/2",
    subId,
    outcome: "success",
    errorCode: null,
    affiliateUrl: "https://bot.example.com/s/abc",
  });
}

function withStores<T>(fn: (logStore: LogStore, ledgerStore: LedgerStore) => T): T {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seedRequestLog(logStore);
    return fn(logStore, ledgerStore);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
}

function runImport(logStore: LogStore, ledgerStore: LedgerStore, rows: ItemRow[]) {
  return importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv(rows));
}

function firstEntry(ledgerStore: LedgerStore) {
  return ledgerStore.getUserSummary("zalo", "user-a").entries[0];
}

test("nhan (+N san pham khac): qua tang gia niem yet = 0 KHONG duoc dem", () => {
  withStores((logStore, ledgerStore) => {
    runImport(logStore, ledgerStore, [
      { name: "Mon that", itemId: "1", listPrice: 249_000, amount: 193_455, commission: 4_836.375 },
      { name: "Qua tang A", itemId: "2", listPrice: 0, amount: 0, commission: 0 },
      { name: "Qua tang B", itemId: "3", listPrice: 0, amount: 0, commission: 0 },
    ]);
    assert.equal(firstEntry(ledgerStore).productName, "Mon that");
  });
});

test("nhan (+N san pham khac): 2 mon that + 1 qua tang -> (+1), khong phai (+2)", () => {
  withStores((logStore, ledgerStore) => {
    runImport(logStore, ledgerStore, [
      { name: "Mon re", itemId: "1", listPrice: 50_000, amount: 40_000, commission: 1_000 },
      { name: "Mon dat", itemId: "2", listPrice: 90_000, amount: 80_000, commission: 2_000 },
      { name: "Qua tang", itemId: "3", listPrice: 0, amount: 0, commission: 0 },
    ]);
    assert.equal(firstEntry(ledgerStore).productName, "Mon dat (+1 sản phẩm khác)");
  });
});

test("nhan (+N san pham khac): mon MUA THAT hoa hong 0d van duoc dem (khong bi coi la qua tang)", () => {
  withStores((logStore, ledgerStore) => {
    runImport(logStore, ledgerStore, [
      { name: "Mon chinh", itemId: "1", listPrice: 100_000, amount: 80_000, commission: 5_000 },
      // Sua tuoi Vinamilk that: gia 316.224d, nganh hang 0% -> hoa hong 0 nhung la hang user mua that.
      { name: "Sua tuoi", itemId: "2", listPrice: 316_224, amount: 278_277, commission: 0 },
    ]);
    assert.equal(firstEntry(ledgerStore).productName, "Mon chinh (+1 sản phẩm khác)");
  });
});
```

- [ ] **Step 2: Chạy để thấy fail**

Run: `npx tsx --test src/core/__tests__/shopeeReportItems.test.ts`
Expected: test 1 FAIL (nhận `"Mon that (+2 sản phẩm khác)"`), test 2 FAIL (nhận `(+2`), test 3 PASS (là test chặn hồi quy, đúng cả trước lẫn sau).

- [ ] **Step 3: Sửa `shopeeReportImport.ts`**

3a. Import (đầu file, cạnh các import khác):

```ts
import type { EntryItemInput } from "./entryItems.js";
```

3b. Trong `interface ShopeeReportRow`, thêm 4 field sau `commissionAmount: number;`:

```ts
  /** Cot "Item id" - "" khi bao cao thieu cot. Dong khong co item_id khong dinh danh duoc mon -> khong luu chi tiet. */
  itemId: string;
  /** Cot "ID Model" - "" khi thieu. */
  modelId: string;
  /** Cot "Số lượng". */
  quantity: number;
  /**
   * Cot "Giá(₫)" = gia NIEM YET cua dong (2026-10-11). null khi bao cao khong co cot/gia tri hong.
   * Chi dung de nhan ra QUA TANG (= 0). KHONG phai "Gia tri don hang" - xem isGiftRow.
   */
  listPrice: number | null;
```

3c. Thêm 2 hàm ngay TRƯỚC `function parseShopeeReportRows`:

```ts
function parseOptionalNumber(raw: string | undefined): number | null {
  const text = raw?.trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * Dong QUA TANG = gia niem yet bang 0 (2026-10-11, chot voi chu bot). TIEU CHI LA GIA, KHONG PHAI
 * HOA HONG: do tren bao cao that, 0 dong nao co gia 0 ma van ra hoa hong, nhung co 3 mon user MUA THAT
 * (gia 241k-316k, nganh hang 0%) co hoa hong 0 - loc theo hoa hong se lam mat dung nhung mon do.
 *
 * Cot "Gia" vang/hong (listPrice null) -> KHONG coi la qua tang: sai theo huong hien nhieu hon,
 * khong bao gio an mat mot mon that.
 */
function isGiftRow(row: ShopeeReportRow): boolean {
  return row.listPrice === 0;
}

```

3d. Trong `parseShopeeReportRows`, thêm 4 dòng sau `commissionAmount: Number(row["Tổng hoa hồng sản phẩm(₫)"]),`:

```ts
      itemId: row["Item id"]?.trim() ?? "",
      modelId: row["ID Model"]?.trim() ?? "",
      quantity: Number(row["Số lượng"]),
      listPrice: parseOptionalNumber(row["Giá(₫)"]),
```

3e. Trong `interface MergedOrder`, thêm sau `productName: string;`:

```ts
  /**
   * Chi tiet tung mon (2026-10-11), DA bo qua tang. Chi gom dong cung Sub_id voi don, co item_id.
   * Dong da huy van co mat (rowStatus 'reversed') nhung khong cong vao orderAmount/commissionAmount.
   */
  items: EntryItemInput[];
```

3f. Trong `mergeOrderRows`, thay khối:

```ts
  const nameSource = summed.length > 0 ? summed : counted;
  const mainRow = [...nameSource].sort((a, b) => b.row.commissionAmount - a.row.commissionAmount)[0];
  let productName = mainRow?.row.productName ?? "";
  if (productName && summed.length > 1) {
    productName = `${productName} (+${summed.length - 1} sản phẩm khác)`;
  }
```

bằng:

```ts
  // Nhan "(+N san pham khac)" dem CUNG tieu chi voi khoi chi tiet tung mon (items ben duoi): bo qua tang.
  // Neu khong, hang ghi "(+2 san pham khac)" ma mo ra chi co 1 mon (2026-10-11).
  const visibleSummed = summed.filter((c) => !isGiftRow(c.row));
  const nameSource = summed.length > 0 ? summed : counted;
  const namePool = nameSource.filter((c) => !isGiftRow(c.row));
  const mainRow = [...(namePool.length > 0 ? namePool : nameSource)].sort(
    (a, b) => b.row.commissionAmount - a.row.commissionAmount
  )[0];
  let productName = mainRow?.row.productName ?? "";
  if (productName && visibleSummed.length > 1) {
    productName = `${productName} (+${visibleSummed.length - 1} sản phẩm khác)`;
  }

  // Chi tiet tung mon: dong cung Sub_id cua don (counted), bo qua tang, bo dong khong co item_id (khong
  // dinh danh duoc -> khong co khoa), bo dong co so khong doc duoc. Dong da huy VAN co mat voi
  // rowStatus 'reversed' (de sau nay hien "mon nay da tra") nhung khong cong vao tong cua don o tren.
  const items: EntryItemInput[] = [];
  for (const c of counted) {
    if (c.status === "unknown" || isGiftRow(c.row) || c.row.itemId === "") continue;
    if (!Number.isFinite(c.row.orderAmount) || !Number.isFinite(c.row.commissionAmount)) continue;
    items.push({
      itemId: c.row.itemId,
      modelId: c.row.modelId,
      productName: c.row.productName,
      quantity: Number.isFinite(c.row.quantity) ? c.row.quantity : 0,
      orderAmount: c.row.orderAmount,
      commissionAmount: c.row.commissionAmount,
      rowStatus: c.status,
    });
  }
```

3g. Trong object `order: { ... }` của `return`, thêm `items,` ngay sau `productName,`.

- [ ] **Step 4: Chạy test mới + 4 file test Shopee cũ**

Run:
```bash
npx tsx --test src/core/__tests__/shopeeReportItems.test.ts src/core/__tests__/shopeeReportImport.test.ts src/core/__tests__/shopeeReportOrderDate.test.ts src/core/__tests__/shopeeReportSmallHold.test.ts
```
Expected: tất cả PASS. Các test cũ (`"Bo doi dau goi (+2 sản phẩm khác)"`, `"San pham dat (+1 …"`) vẫn xanh **không sửa dòng nào** vì CSV của chúng không có cột `Giá(₫)` ⇒ `listPrice = null` ⇒ không coi là quà tặng. Nếu một test cũ đỏ, DỪNG và báo — đó là dấu hiệu quy tắc "vắng cột ⇒ không phải quà" bị sai.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/core/shopeeReportImport.ts src/core/__tests__/shopeeReportItems.test.ts
git commit -m "$(cat <<'MSG'
feat(import-shopee): loc qua tang theo gia niem yet = 0, nhan (+N) khong dem qua tang

Doc them 4 cot (Item id, ID Model, So luong, Gia). Loc theo GIA chu khong theo hoa hong:
3 mon user mua that nganh hang 0% van phai con. mergeOrderRows tra them items cho task sau.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: Nối `importShopeeReport` → `replaceEntryItems`

**Files:**
- Modify: `src/core/shopeeReportImport.ts` (vòng lặp `importShopeeReport`, ngay sau `applyOrderStatusToLedger(...)`)
- Test: `src/core/__tests__/shopeeReportItems.test.ts` (thêm test)

**Interfaces:**
- Consumes: `MergedOrder.items` (Task 2), `LedgerStore.replaceEntryItems/getEntryByOrderId/listEntryItemsFor`, `entryItemsKey` (Task 1).
- Produces: sau mỗi lần import, mọi đơn đã có entry đều có chi tiết món đúng với báo cáo mới nhất.

- [ ] **Step 1: Thêm test (sẽ fail)**

Thêm import ở đầu `shopeeReportItems.test.ts` (nếu chưa có):

```ts
import { entryItemsKey, entryItemsReconcile } from "../entryItems.js";
```

Rồi thêm vào cuối file:

```ts
// Don that 2610109S28J4XY trong AffiliateCommissionReport_202610110849.csv: 7 dong, 2 dong cung item_id
// 18193835545 khac model_id. Cot "Tong hoa hong don hang" cua Shopee chi co o dong dau (31.621), nhung
// cot hoa hong SAN PHAM co o moi dong - day chinh la thu bi nham thanh "mon mua kem khong co hoa hong".
const REAL_ORDER_ID = "2610109S28J4XY";
function realOrderRows(): ItemRow[] {
  const base = { orderId: REAL_ORDER_ID, status: "Đang chờ xử lý" };
  return [
    { ...base, name: "Loi Vai Bo Aukobe", itemId: "18193835545", modelId: "168152404387", listPrice: 249_000, amount: 193_455, commission: 4_836.375 },
    { ...base, name: "Loi Vai Bo Aukobe", itemId: "18193835545", modelId: "168152404388", listPrice: 249_000, amount: 193_455, commission: 4_836.375 },
    { ...base, name: "Nac Nong Heo", itemId: "29526033790", modelId: "237366680880", listPrice: 338_000, amount: 262_601, commission: 6_565.025 },
    { ...base, name: "Mandu Bibigo", itemId: "5976750561", modelId: "55655847274", listPrice: 65_000, quantity: 2, amount: 101_000, commission: 2_525 },
    { ...base, name: "De Suon Bo My", itemId: "6586835646", modelId: "112622507365", listPrice: 265_000, amount: 205_886, commission: 5_147.15 },
    { ...base, name: "Dau hu ca pho mai", itemId: "8460423469", modelId: "65656100957", listPrice: 125_000, amount: 97_119, commission: 2_427.975 },
    { ...base, name: "Loi Vai Bo My", itemId: "8746499482", modelId: "65982781693", listPrice: 272_000, amount: 211_324, commission: 5_283.1 },
  ];
}

function itemsOf(ledgerStore: LedgerStore, orderId: string) {
  return ledgerStore.listEntryItemsFor([{ merchant: "shopee", orderId }]).get(entryItemsKey("shopee", orderId));
}

test("import: don that 7 mon -> du 7 mon, cong lai KHOP dung so cua don", () => {
  withStores((logStore, ledgerStore) => {
    runImport(logStore, ledgerStore, realOrderRows());
    const entry = ledgerStore.getEntryByOrderId("shopee", REAL_ORDER_ID)!;
    const items = itemsOf(ledgerStore, REAL_ORDER_ID)!;

    assert.equal(items.length, 7);
    assert.equal(items.filter((i) => i.itemId === "18193835545").length, 2, "2 model cung item_id phai ra 2 dong");
    assert.equal(items.reduce((s, i) => s + i.orderAmount, 0), entry.orderAmount);
    assert.ok(Math.abs(items.reduce((s, i) => s + i.commissionAmount, 0) - 31_621) < 1e-6);
    assert.ok(Math.abs(entry.commissionAmount - 31_621) < 1e-6);
    assert.equal(entryItemsReconcile(entry, items), true);
  });
});

test("import: qua tang gia 0 khong vao items, mon hoa hong 0d van vao", () => {
  withStores((logStore, ledgerStore) => {
    runImport(logStore, ledgerStore, [
      { name: "Mon chinh", itemId: "1", listPrice: 100_000, amount: 80_000, commission: 5_000 },
      { name: "Sua tuoi 0 phan tram", itemId: "2", listPrice: 316_224, amount: 278_277, commission: 0 },
      { name: "Qua tang", itemId: "3", listPrice: 0, amount: 0, commission: 0 },
    ]);
    assert.deepEqual(itemsOf(ledgerStore, "ORD1")?.map((i) => i.itemId), ["1", "2"]);
  });
});

test("import: chay 2 lan cung file -> van dung 7 mon, khong nhan doi", () => {
  withStores((logStore, ledgerStore) => {
    runImport(logStore, ledgerStore, realOrderRows());
    runImport(logStore, ledgerStore, realOrderRows());
    assert.equal(itemsOf(ledgerStore, REAL_ORDER_ID)?.length, 7);
  });
});

test("import: bao cao lan sau bot 1 dong -> mon do bien mat (khong de lai mon ma)", () => {
  withStores((logStore, ledgerStore) => {
    runImport(logStore, ledgerStore, realOrderRows());
    runImport(logStore, ledgerStore, realOrderRows().slice(0, 6));
    assert.equal(itemsOf(ledgerStore, REAL_ORDER_ID)?.length, 6);
  });
});

test("import: dong Sub_id rong khong vao items (hoa hong gian tiep cua chu bot)", () => {
  withStores((logStore, ledgerStore) => {
    runImport(logStore, ledgerStore, [
      { name: "Mon chinh", itemId: "1", listPrice: 100_000, amount: 80_000, commission: 5_000 },
      { name: "Mon khac shop", itemId: "2", listPrice: 90_000, amount: 70_000, commission: 4_000, subIdParts: [] },
    ]);
    assert.deepEqual(itemsOf(ledgerStore, "ORD1")?.map((i) => i.itemId), ["1"]);
  });
});

test("import: dong da huy VAN co mat (reversed) nhung KHONG cong vao tong cua don", () => {
  withStores((logStore, ledgerStore) => {
    runImport(logStore, ledgerStore, [
      { name: "Mon con", itemId: "1", listPrice: 100_000, amount: 100_000, commission: 5_000, status: "Hoàn thành" },
      { name: "Mon da tra", itemId: "2", listPrice: 90_000, quantity: 0, amount: 0, commission: 0, status: "Đã hủy" },
    ]);
    const entry = ledgerStore.getEntryByOrderId("shopee", "ORD1")!;
    const items = itemsOf(ledgerStore, "ORD1")!;
    assert.equal(entry.orderAmount, 100_000);
    assert.deepEqual(items.map((i) => [i.itemId, i.rowStatus]), [["1", "confirmed"], ["2", "reversed"]]);
    assert.equal(entryItemsReconcile(entry, items), true);
  });
});

test("import: don bi bo qua vi trang thai la -> khong co entry, khong co items", () => {
  withStores((logStore, ledgerStore) => {
    const result = runImport(logStore, ledgerStore, [
      { name: "Mon", itemId: "1", listPrice: 100_000, amount: 80_000, commission: 5_000, status: "Trạng thái lạ" },
    ]);
    assert.equal(result.skippedUnknownStatus, 1);
    assert.equal(itemsOf(ledgerStore, "ORD1"), undefined);
  });
});

test("import: dong khong co item_id (bao cao cu) -> khong luu items, tien van ghi binh thuong", () => {
  withStores((logStore, ledgerStore) => {
    const result = runImport(logStore, ledgerStore, [
      { name: "Mon", itemId: "", listPrice: 100_000, amount: 80_000, commission: 5_000 },
    ]);
    assert.equal(result.pendingNew, 1);
    assert.equal(itemsOf(ledgerStore, "ORD1"), undefined);
  });
});

test("import: luu chi tiet mon loi -> TIEN van ghi binh thuong, loi chi vao danh sach canh bao", () => {
  withStores((logStore, ledgerStore) => {
    (ledgerStore as unknown as { replaceEntryItems: () => void }).replaceEntryItems = () => {
      throw new Error("boom");
    };
    const result = runImport(logStore, ledgerStore, [
      { name: "Mon", itemId: "1", listPrice: 100_000, amount: 80_000, commission: 5_000 },
    ]);
    assert.equal(result.pendingNew, 1, "tien khong duoc phep bi chan boi du lieu hien thi");
    assert.ok(result.errors.some((e) => e.includes("chi tiet san pham") && e.includes("boom")));
    assert.ok(ledgerStore.getEntryByOrderId("shopee", "ORD1"));
  });
});

test("import: cong dong 2 dong cung item+model trong 1 don, tong van khop don", () => {
  withStores((logStore, ledgerStore) => {
    runImport(logStore, ledgerStore, [
      { name: "Mon A", itemId: "9", modelId: "5", listPrice: 23_399, amount: 20_000, commission: 500 },
      { name: "Mon A", itemId: "9", modelId: "5", listPrice: 25_999, amount: 22_000, commission: 550 },
    ]);
    const entry = ledgerStore.getEntryByOrderId("shopee", "ORD1")!;
    const items = itemsOf(ledgerStore, "ORD1")!;
    assert.equal(items.length, 1);
    assert.equal(entryItemsReconcile(entry, items), true);
  });
});
```

- [ ] **Step 2: Chạy để thấy fail**

Run: `npx tsx --test src/core/__tests__/shopeeReportItems.test.ts`
Expected: các test mới FAIL (`itemsOf` trả `undefined`/`items.length` sai) vì import chưa gọi `replaceEntryItems`; test "luu chi tiet mon loi" FAIL vì `replaceEntryItems` bị stub chưa bao giờ được gọi nên không có lỗi trong `errors`.

- [ ] **Step 3: Gọi `replaceEntryItems` trong `importShopeeReport`**

Ngay SAU khối `const outcomes = applyOrderStatusToLedger(...);` (trước `for (const o of outcomes)`), thêm:

```ts
    // Chi tiet tung san pham (2026-10-11) - thuan HIEN THI, nen o DAY chu KHONG nam trong
    // orderStatusApply.ts: module do la duong quyet dinh tien dung chung voi TikTok (huy, ghi no, huy
    // yeu cau rut). Chi ghi khi don that su co entry (don bi bo qua vi trang thai la / loi thi khong
    // co). Loi o day KHONG duoc chan viec ghi tien phia tren - chi vao danh sach canh bao.
    if (ledgerStore.getEntryByOrderId(requestEntry.merchant, orderId)) {
      try {
        ledgerStore.replaceEntryItems(requestEntry.merchant, orderId, order.items);
      } catch (err) {
        result.errors.push(`[${orderId}] Khong luu duoc chi tiet san pham: ${(err as Error).message}`);
      }
    }
```

- [ ] **Step 4: Chạy test, phải pass**

Run: `npx tsx --test src/core/__tests__/shopeeReportItems.test.ts src/core/__tests__/shopeeReportImport.test.ts src/core/__tests__/orderStatusApply.test.ts`
Expected: tất cả PASS. (`orderStatusApply.test.ts` phải xanh **không đổi** — chứng minh đường tiền không bị chạm.)

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add src/core/shopeeReportImport.ts src/core/__tests__/shopeeReportItems.test.ts
git commit -m "$(cat <<'MSG'
feat(import-shopee): ghi chi tiet tung mon sau moi lan import (backfill tu dong)

Goi replaceEntryItems RIENG, khong dua vao orderStatusApply (duong tien dung chung TikTok).
Loi ghi chi tiet khong chan viec ghi tien. Don cu duoc dien dan khi xuat hien lai trong bao cao.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: Dashboard user — khối chi tiết món

**Files:**
- Modify: `src/core/ledgerStore.ts` (`UserLedgerSummary` ~dòng 118-135; `getUserSummary` ~dòng 1324)
- Modify: `src/api/dashboardHtml.ts` (import; CSS trong `<style>`; hàm `renderOrderItems`; input type; vòng `cards`)
- Test: `src/api/__tests__/orderItemsRender.test.ts` (tạo), thêm 1 test vào `src/api/__tests__/dashboardRoutes.test.ts`

**Interfaces:**
- Consumes: `entryItemsKey`, `entryItemsReconcile`, `CommissionEntryItem` (Task 1); `listEntryItemsFor`.
- Produces: `UserLedgerSummary.entryItems: Map<string, CommissionEntryItem[]>` (server truyền qua `...summary`); `renderDashboardPage` nhận `entryItems?: Map<string, CommissionEntryItem[]>` (optional để các test cũ không phải sửa).

- [ ] **Step 1: Viết test render (sẽ fail)**

Tạo `src/api/__tests__/orderItemsRender.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDashboardPage } from "../dashboardHtml.js";
import type { CommissionEntry } from "../../core/types.js";
import { entryItemsKey, type CommissionEntryItem } from "../../core/entryItems.js";

function entry(overrides: Partial<CommissionEntry> = {}): CommissionEntry {
  return {
    id: "e1",
    createdAt: "2026-10-10T03:00:00.000Z",
    orderDate: "2026-10-10",
    orderTime: null,
    completedAt: null,
    availableFrom: null,
    platform: "zalo",
    userId: "u1",
    merchant: "shopee",
    subId: "k-u1-abc-xyz",
    orderId: "2610109S28J4XY",
    productName: "Loi Vai Bo Aukobe (+1 sản phẩm khác)",
    orderAmount: 300_000,
    commissionAmount: 10_000,
    taxAmount: 1_000,
    platformFeeAmount: 90,
    afterTaxAmount: 8_910,
    userShareAmount: 7_128,
    taxPercent: 10,
    platformFeePercent: 1,
    userSharePercent: 80,
    commissionOverriddenAt: null,
    status: "pending",
    withdrawalId: null,
    note: null,
    proofImagePath: null,
    ...overrides,
  };
}

function item(overrides: Partial<CommissionEntryItem> = {}): CommissionEntryItem {
  return {
    merchant: "shopee",
    orderId: "2610109S28J4XY",
    itemId: "1",
    modelId: "1",
    productName: "Mon A",
    quantity: 1,
    orderAmount: 200_000,
    commissionAmount: 6_000,
    rowStatus: "pending",
    ...overrides,
  };
}

function renderDashboard(e: CommissionEntry, items?: CommissionEntryItem[]): string {
  const entryItems = items ? new Map([[entryItemsKey(e.merchant, e.orderId), items]]) : undefined;
  return renderDashboardPage({
    entries: [e],
    entryItems,
    availableBalance: 0,
    heldBalance: 0,
    heldEntries: [],
    debtRemaining: 0,
    debts: [],
    pendingBalance: 0,
    paidTotal: 0,
    pendingWithdrawal: null,
    thresholdVnd: 20_000,
    token: "tok",
    platform: "zalo",
    userId: "u1",
    displayName: "Yến Nhi",
  });
}

const TWO_ITEMS = [
  item({ itemId: "1", productName: "Mon A", orderAmount: 200_000, commissionAmount: 6_000 }),
  item({ itemId: "2", productName: "Mon B", orderAmount: 100_000, commissionAmount: 4_000 }),
];

test("dashboard: don >= 2 mon va cong lai khop -> hien khoi chi tiet kem dong tong", () => {
  const html = renderDashboard(entry(), TWO_ITEMS);
  assert.match(html, /<details class="order-items">/);
  assert.match(html, /2 sản phẩm trong đơn/);
  assert.ok(html.includes("Mon A") && html.includes("Mon B"));
  const block = html.match(/<details class="order-items">[\s\S]*?<\/details>/)![0];
  assert.ok(block.includes("300.000đ"), "tong gia tri phai bang o Gia tri don tren the");
  assert.ok(block.includes("10.000đ"), "tong hoa hong phai bang o Hoa hong tren the");
});

test("dashboard: don 1 mon hoac khong co chi tiet -> KHONG co khoi chi tiet", () => {
  const one = [item({ orderAmount: 300_000, commissionAmount: 10_000 })];
  assert.doesNotMatch(renderDashboard(entry(), one), /<details class="order-items">/);
  assert.doesNotMatch(renderDashboard(entry(), undefined), /<details class="order-items">/);
});

test("dashboard: cong lai KHONG khop the (vd admin da sua tay hoa hong) -> AN, khong hien so lech", () => {
  const html = renderDashboard(entry({ commissionAmount: 12_345 }), TWO_ITEMS);
  assert.doesNotMatch(html, /<details class="order-items">/);
});

test("dashboard: ten mon la chuoi nguoi la -> bi escape", () => {
  const html = renderDashboard(entry(), [
    item({ itemId: "1", productName: `<script>alert(1)</script>`, orderAmount: 200_000, commissionAmount: 6_000 }),
    item({ itemId: "2", orderAmount: 100_000, commissionAmount: 4_000 }),
  ]);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
});

test("dashboard: mon mua that hoa hong 0d hien 'chua co hoa hong', khong bi an", () => {
  const html = renderDashboard(entry({ orderAmount: 478_277, commissionAmount: 6_000 }), [
    item({ itemId: "1", orderAmount: 200_000, commissionAmount: 6_000 }),
    item({ itemId: "2", productName: "Sua tuoi", orderAmount: 278_277, commissionAmount: 0 }),
  ]);
  assert.ok(html.includes("Sua tuoi"));
  assert.match(html, /chưa có hoa hồng/);
});

test("dashboard: mon da huy gach ngang va KHONG cong vao dong tong", () => {
  const html = renderDashboard(entry({ orderAmount: 200_000, commissionAmount: 6_000 }), [
    item({ itemId: "1", orderAmount: 200_000, commissionAmount: 6_000 }),
    item({ itemId: "2", productName: "Mon da tra", orderAmount: 0, commissionAmount: 0, rowStatus: "reversed" }),
  ]);
  assert.match(html, /order-item order-item-void/);
});

test("dashboard: mon co so luong > 1 hien xN", () => {
  const html = renderDashboard(entry(), [
    item({ itemId: "1", orderAmount: 200_000, commissionAmount: 6_000 }),
    item({ itemId: "2", quantity: 2, orderAmount: 100_000, commissionAmount: 4_000 }),
  ]);
  assert.match(html, /<span class="item-qty">x2<\/span>/);
});
```

- [ ] **Step 2: Chạy để thấy fail**

Run: `npx tsx --test src/api/__tests__/orderItemsRender.test.ts`
Expected: FAIL — typecheck/runtime không biết `entryItems`, không có `order-items`.

- [ ] **Step 3: `ledgerStore.ts` — `getUserSummary` trả thêm `entryItems`**

3a. Trong `interface UserLedgerSummary`, thêm sau `entries: CommissionEntry[];`:

```ts
  /**
   * Chi tiet tung mon cua cac don trong `entries` (2026-10-11), khoa Map = entryItemsKey(merchant,
   * orderId). Don khong co chi tiet thi vang mat. Lay trong MOT query cho ca danh sach don.
   */
  entryItems: Map<string, CommissionEntryItem[]>;
```

3b. Trong `getUserSummary`, thêm `entryItems: this.listEntryItemsFor(entries),` ngay sau `entries,` trong object `return`.

- [ ] **Step 4: `dashboardHtml.ts`**

4a. Import: thêm

```ts
import { entryItemsKey, entryItemsReconcile, type CommissionEntryItem } from "../core/entryItems.js";
```

4b. Trong `renderDashboardPage(input: {...})`, thêm sau `entries: CommissionEntry[];`:

```ts
  /** Chi tiet tung mon (2026-10-11) - optional de cac cho goi/test cu khong phai doi. Xem renderOrderItems. */
  entryItems?: Map<string, CommissionEntryItem[]>;
```

4c. Thêm hàm ngay TRƯỚC `export function renderDashboardPage`:

```ts
/**
 * Khoi chi tiet tung san pham cua don nhieu mon (2026-10-11, yeu cau truc tiep cua chu bot). Chi ve
 * khi >= 2 mon VA cong lai KHOP dung "Gia tri don"/"Hoa hong" tren the: loi hua cua khoi nay la
 * "tu cong lai ra dung so tren the", khong khop (admin da sua tay hoa hong, don co dong khong doc
 * duoc) thi AN con hon hien so lech.
 *
 * KHONG hien "phan ban nhan" tung mon: chia thue/phi/% roi lam tron tung mon thi tong lech vai dong
 * so voi o "Ban nhan" - dung cai bay hai-nguon-tinh-tien ma money.ts da phai don mot lan.
 * Danh sach DOC (khong bang ngang): trang nay chu yeu mo tu dien thoai.
 */
function renderOrderItems(e: CommissionEntry, items: CommissionEntryItem[] | undefined): string {
  if (!items || items.length < 2 || !entryItemsReconcile(e, items)) return "";
  const active = items.filter((i) => i.rowStatus !== "reversed");
  const totalAmount = active.reduce((sum, i) => sum + i.orderAmount, 0);
  const totalCommission = active.reduce((sum, i) => sum + i.commissionAmount, 0);
  const rows = items
    .map((i) => {
      const reversed = i.rowStatus === "reversed";
      const qty = i.quantity > 1 ? ` <span class="item-qty">x${i.quantity}</span>` : "";
      const noCommission =
        !reversed && i.commissionAmount === 0 ? ` <span class="item-qty">(chưa có hoa hồng)</span>` : "";
      return `<li class="order-item${reversed ? " order-item-void" : ""}">
      <div class="item-name">${escapeHtml(i.productName)}${qty}</div>
      <div class="item-figures"><span>Giá trị <b>${formatVnd(i.orderAmount)}</b></span><span>Hoa hồng <b>${formatVnd(i.commissionAmount)}</b>${noCommission}</span></div>
    </li>`;
    })
    .join("\n");
  return `<details class="order-items">
    <summary>${items.length} sản phẩm trong đơn</summary>
    <ul>
    ${rows}
    <li class="order-item order-item-total">
      <div class="item-name">Tổng cộng</div>
      <div class="item-figures"><span>Giá trị <b>${formatVnd(totalAmount)}</b></span><span>Hoa hồng <b>${formatVnd(totalCommission)}</b></span></div>
    </li>
    </ul>
  </details>`;
}

```

4d. Trong vòng `input.entries.map((e) => {...})`, ngay sau khai báo `const reason = cancelReason(e);` thêm:

```ts
      const itemsBlock = renderOrderItems(e, input.entryItems?.get(entryItemsKey(e.merchant, e.orderId)));
```

và trong template của thẻ, ngay SAU dòng `${product ? `<div class="order-card-product">${product}</div>` : ""}` thêm một dòng:

```
  ${itemsBlock}
```

4e. CSS: trong khối `<style>` của `dashboardHtml.ts`, ngay sau dòng `.order-card-product { ... }` thêm:

```css
  .order-items { margin: -0.5rem 0 1.125rem; }
  .order-items summary {
    cursor: pointer; list-style: none; color: var(--accent);
    font-size: 0.8125rem; font-weight: 600; padding: 0.5rem 0;
  }
  .order-items summary::-webkit-details-marker { display: none; }
  .order-items summary::before { content: "▸ "; }
  .order-items[open] summary::before { content: "▾ "; }
  .order-items ul { list-style: none; margin: 0.25rem 0 0; padding: 0; }
  .order-item { border-top: 1px solid var(--card-border); padding: 0.625rem 0; }
  .item-name { font-size: 0.875rem; line-height: 1.4; color: var(--text); overflow-wrap: anywhere; }
  .item-qty { color: var(--text-dim); font-weight: 400; }
  .item-figures {
    display: flex; flex-wrap: wrap; gap: 0.125rem 1rem; margin-top: 0.25rem;
    font-size: 0.8125rem; color: var(--text-muted);
  }
  .item-figures b { color: var(--text); font-weight: 600; }
  .order-item-void .item-name, .order-item-void .item-figures {
    color: var(--text-dim); text-decoration: line-through; opacity: 0.7;
  }
  .order-item-total .item-name { font-weight: 600; }
```

- [ ] **Step 5: Chạy test render, phải pass**

Run: `npx tsx --test src/api/__tests__/orderItemsRender.test.ts`
Expected: PASS (7 test).

- [ ] **Step 6: Test route thật (bắt lỗi quên nối dây)**

Thêm vào CUỐI `src/api/__tests__/dashboardRoutes.test.ts` (dùng `setup()` sẵn có của file):

```ts
test("GET /d/:token hien chi tiet tung mon cua don nhieu mon (chi tiet lay tu bang commission_entry_items)", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    const { token } = ledgerStore.findOrCreateDashboardToken("telegram", "user-a");
    ledgerStore.recordConversion({
      subId: "telegram-user-a-multi",
      platform: "telegram",
      userId: "user-a",
      merchant: "shopee",
      orderId: "order-nhieu-mon",
      orderAmount: 300_000,
      commissionAmount: 10_000,
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
    });
    ledgerStore.replaceEntryItems("shopee", "order-nhieu-mon", [
      { itemId: "1", modelId: "1", productName: "Mon chinh ABC", quantity: 1, orderAmount: 200_000, commissionAmount: 6_000, rowStatus: "confirmed" },
      { itemId: "2", modelId: "1", productName: "Mon mua kem XYZ", quantity: 1, orderAmount: 100_000, commissionAmount: 4_000, rowStatus: "confirmed" },
    ]);

    const html = await (await fetch(`${baseUrl}/d/${token}`)).text();
    assert.match(html, /2 sản phẩm trong đơn/);
    assert.ok(html.includes("Mon mua kem XYZ"));
  } finally {
    cleanup();
  }
});
```

Run: `npx tsx --test src/api/__tests__/dashboardRoutes.test.ts`
Expected: PASS. (Server đã `...summary` nên `entryItems` tự chảy vào; nếu FAIL, kiểm tra `server.ts` dòng truyền vào `renderDashboardPage` — cả nhánh lỗi POST withdraw ~dòng 471 cũng dựng từ `getUserSummary`.)

- [ ] **Step 7: Typecheck + chạy bộ test dashboard cũ + commit**

```bash
npm run typecheck
npx tsx --test src/api/__tests__/dashboardWithdrawHint.test.ts src/api/__tests__/dashboardRoutes.test.ts src/api/__tests__/orderItemsRender.test.ts
git add src/core/ledgerStore.ts src/api/dashboardHtml.ts src/api/__tests__/orderItemsRender.test.ts src/api/__tests__/dashboardRoutes.test.ts
git commit -m "$(cat <<'MSG'
feat(dashboard): hien chi tiet tung mon trong the don nhieu mon

Danh sach doc (mobile la man hinh chinh), kem dong tong de user tu doi chieu voi the.
Chi hien khi cong lai khop dung so tren the - lech thi an. Khong hien phan ban nhan
tung mon vi lam tron tung mon se lech tong.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: `/admin/orders` — `<details>` trong ô "Sản phẩm"

**Files:**
- Modify: `src/api/adminHtml.ts` (import; hàm `orderItemsDetails`; `renderOrdersPage` thêm tham số + ô sản phẩm ~dòng 1972)
- Modify: `src/api/server.ts` (route `GET /admin/orders` ~dòng 808)
- Test: `src/api/__tests__/orderItemsRender.test.ts` (thêm), `src/api/__tests__/adminRoutes.test.ts` (thêm 1 test)

**Interfaces:**
- Consumes: `CommissionEntryItem`, `entryItemsKey`, `entryItemsReconcile` (Task 1); `listEntryItemsFor`.
- Produces: `renderOrdersPage(..., debtOrderIds, entryItems: Map<string, CommissionEntryItem[]> = new Map())` — tham số CUỐI, có default nên các cho gọi cũ không đổi.

- [ ] **Step 1: Thêm test render admin (sẽ fail)**

Thêm vào cuối `orderItemsRender.test.ts` (và thêm `import { renderOrdersPage } from "../adminHtml.js";` ở đầu file):

```ts
const PAGINATION = { page: 1, totalPages: 1, totalEntries: 1 };
const TOTALS = {
  totalEntries: 1,
  pendingEntries: 1,
  userShareTotal: 7_128,
  ownerShareTotal: 1_782,
  ownerShareBeforeTaxTotal: 2_000,
} as Parameters<typeof renderOrdersPage>[4];

function renderAdmin(e: CommissionEntry, items?: CommissionEntryItem[]): string {
  const map = items ? new Map([[entryItemsKey(e.merchant, e.orderId), items]]) : new Map();
  return renderOrdersPage([e], {}, new Map(), PAGINATION, TOTALS, 0, new Set(), map);
}

test("admin: don >= 2 mon -> co <details> ngay trong o San pham, mo ra thay tung mon", () => {
  const html = renderAdmin(entry(), TWO_ITEMS);
  assert.match(html, /<details class="details-plain/);
  assert.match(html, /2 sản phẩm/);
  assert.ok(html.includes("Mon A") && html.includes("Mon B"));
});

test("admin: don 1 mon hoac khong co chi tiet -> khong co khoi chi tiet, hang y nhu cu", () => {
  const one = [item({ orderAmount: 300_000, commissionAmount: 10_000 })];
  assert.doesNotMatch(renderAdmin(entry(), one), />\d+ sản phẩm<\/summary>/);
  assert.doesNotMatch(renderAdmin(entry(), undefined), />\d+ sản phẩm<\/summary>/);
});

test("admin: don admin da KHOA hoa hong tay -> co ghi chu 'sua tay, so Shopee bao'", () => {
  const html = renderAdmin(entry({ commissionOverriddenAt: "2026-10-10T05:00:00.000Z", commissionAmount: 12_345 }), TWO_ITEMS);
  assert.match(html, /Hoa hồng đã được sửa tay/);
  assert.match(html, /số Shopee báo/);
});

test("admin: tong cac mon khac so tren hang (khong phai do khoa tay) -> ghi chu lech", () => {
  const html = renderAdmin(entry({ commissionAmount: 12_345 }), TWO_ITEMS);
  assert.match(html, /Tổng các món bên dưới khác số trên hàng này/);
  assert.doesNotMatch(html, /Hoa hồng đã được sửa tay/);
});

test("admin: cong lai khop va khong khoa -> KHONG co ghi chu nao", () => {
  const html = renderAdmin(entry(), TWO_ITEMS);
  assert.doesNotMatch(html, /Hoa hồng đã được sửa tay|Tổng các món bên dưới khác/);
});

test("admin: ten mon la chuoi nguoi la -> bi escape; mon da huy gach ngang", () => {
  const html = renderAdmin(entry(), [
    item({ itemId: "1", productName: `<img src=x onerror=alert(1)>`, orderAmount: 200_000, commissionAmount: 6_000 }),
    item({ itemId: "2", productName: "Mon da tra", orderAmount: 100_000, commissionAmount: 4_000, rowStatus: "reversed" }),
  ]);
  assert.ok(!html.includes("<img src=x onerror=alert(1)>"));
  assert.match(html, /text-slate-400 line-through/);
});
```

Run: `npx tsx --test src/api/__tests__/orderItemsRender.test.ts`
Expected: các test `admin:` FAIL.

- [ ] **Step 2: `adminHtml.ts`**

2a. Import (cạnh các import `../core/...`):

```ts
import { entryItemsKey, entryItemsReconcile, type CommissionEntryItem } from "../core/entryItems.js";
```

2b. Thêm hàm ngay TRƯỚC `export function renderOrdersPage(`:

```ts
/**
 * Chi tiet tung san pham cua don nhieu mon, mo TAI CHO trong o "San pham" (2026-10-11). KHONG them cot
 * thu 11: bang da 10 cot va px-4 la muc vua du de nut "Huy don" khong bi day ra ngoai man ~1700px.
 *
 * <details> native, khong JS. Khu /admin khong nap preflight nen <summary>/<ul> tu reset: `list-none`
 * cho Chrome/Firefox, class `details-plain` (admin.css) an mui ten cua Safari.
 * Chi hien khi >= 2 mon. Co ghi chu khi cong lai KHONG khop so tren hang - bat buoc, khong phai trang
 * tri: thieu no thi lan doi soat sau admin thay tong cac mon khac so tren hang va tuong bang tinh sai.
 */
function orderItemsDetails(e: CommissionEntry, items: CommissionEntryItem[] | undefined): string {
  if (!items || items.length < 2) return "";
  const active = items.filter((i) => i.rowStatus !== "reversed");
  const totalAmount = active.reduce((sum, i) => sum + i.orderAmount, 0);
  const totalCommission = active.reduce((sum, i) => sum + i.commissionAmount, 0);
  const note = entryItemsReconcile(e, items)
    ? ""
    : `<p class="m-0 mb-1.5 whitespace-normal rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700">${
        e.commissionOverriddenAt !== null
          ? "Hoa hồng đã được sửa tay, các số bên dưới là số Shopee báo."
          : "Tổng các món bên dưới khác số trên hàng này."
      }</p>`;
  // Don khoa tay van phai co ghi chu "sua tay" du cong lai tinh co khop (admin co the nhap dung so Shopee).
  const lockedNote =
    note === "" && e.commissionOverriddenAt !== null
      ? `<p class="m-0 mb-1.5 whitespace-normal rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700">Hoa hồng đã được sửa tay, các số bên dưới là số Shopee báo.</p>`
      : "";
  const rows = items
    .map((i) => {
      const reversed = i.rowStatus === "reversed";
      const qty = i.quantity > 1 ? ` <span class="text-slate-400">x${i.quantity}</span>` : "";
      const noCommission =
        !reversed && i.commissionAmount === 0 ? ` <span class="text-slate-400">· chưa có hoa hồng</span>` : "";
      return `<li class="border-t border-slate-100 py-1.5 ${reversed ? "text-slate-400 line-through" : "text-slate-600"}">
        <div class="whitespace-normal break-words">${escapeHtml(i.productName)}${qty}</div>
        <div class="tabular-nums text-slate-500">${formatVnd(i.orderAmount)} · HH ${formatVnd(i.commissionAmount)}${noCommission}</div>
      </li>`;
    })
    .join("");
  return `<details class="details-plain mt-1.5 text-[11px]">
    <summary class="cursor-pointer list-none text-xs font-medium text-indigo-600">${items.length} sản phẩm</summary>
    <div class="mt-1.5">${note}${lockedNote}
      <ul class="m-0 list-none p-0">${rows}
        <li class="border-t border-slate-200 py-1.5 font-medium text-slate-700 tabular-nums">Tổng ${formatVnd(totalAmount)} · HH ${formatVnd(totalCommission)}</li>
      </ul>
    </div>
  </details>`;
}

```

2c. Trong chữ ký `renderOrdersPage`, sau tham số `debtOrderIds: Set<string> = new Set()` thêm dấu phẩy và:

```ts
  ,
  /** Chi tiet tung mon cua cac don tren trang nay (2026-10-11) - xem orderItemsDetails. */
  entryItems: Map<string, CommissionEntryItem[]> = new Map()
```

(đặt đúng cú pháp: `debtOrderIds: Set<string> = new Set(),` rồi dòng chú thích và `entryItems: ... = new Map()`.)

2d. Đổi ô sản phẩm (`<td class="max-w-[200px] px-4 py-3.5">${product}</td>`) thành:

```
  <td class="max-w-[200px] px-4 py-3.5">${product}${orderItemsDetails(e, entryItems.get(entryItemsKey(e.merchant, e.orderId)))}</td>
```

- [ ] **Step 3: `server.ts`**

Trong route `GET /admin/orders`, đổi lời gọi `renderOrdersPage(...)`: sau đối số `new Set(...)` (đối số thứ 7) thêm đối số thứ 8. Cụ thể thay đoạn

```ts
            .map((e) => e.orderId)
        )
      )
    );
  });
```

bằng

```ts
            .map((e) => e.orderId)
        ),
        // Chi tiet tung mon cua 50 don tren trang - MOT query, khong N+1 (2026-10-11).
        ledgerStore.listEntryItemsFor(entries)
      )
    );
  });
```

(Chỉ sửa đúng đoạn trong route `/admin/orders`; `grep -n "renderOrdersPage(" src/api/server.ts` để chắc chắn chỉ có một chỗ gọi.)

- [ ] **Step 4: Test route admin**

Thêm vào cuối `src/api/__tests__/adminRoutes.test.ts`:

```ts
test("/admin/orders hien chi tiet tung mon cua don nhieu mon trong o San pham", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    ledgerStore.recordConversion({
      subId: "telegram-user-a-multi",
      platform: "telegram",
      userId: "user-a",
      merchant: "shopee",
      orderId: "order-nhieu-mon",
      orderAmount: 300_000,
      commissionAmount: 10_000,
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
    });
    ledgerStore.replaceEntryItems("shopee", "order-nhieu-mon", [
      { itemId: "1", modelId: "1", productName: "Mon chinh ABC", quantity: 1, orderAmount: 200_000, commissionAmount: 6_000, rowStatus: "confirmed" },
      { itemId: "2", modelId: "1", productName: "Mon mua kem XYZ", quantity: 1, orderAmount: 100_000, commissionAmount: 4_000, rowStatus: "confirmed" },
    ]);

    const cookie = await loginAndGetCookie(baseUrl);
    const html = await (await fetch(`${baseUrl}/admin/orders`, { headers: { cookie: cookie! } })).text();
    assert.match(html, />2 sản phẩm</);
    assert.ok(html.includes("Mon mua kem XYZ"));
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 5: Chạy test + build CSS + xác nhận Tailwind sinh class**

```bash
npx tsx --test src/api/__tests__/orderItemsRender.test.ts src/api/__tests__/adminRoutes.test.ts src/api/__tests__/ordersStatusDropdown.test.ts
npm run build:css
for c in 'list-none' 'break-words' 'whitespace-normal' 'bg-amber-50' 'text-amber-700' 'line-through' 'border-slate-100' 'mb-1\.5' 'mt-1\.5'; do printf '%-18s' "$c"; grep -c "\.$c" public/admin.css; done
```
Expected: test PASS; mỗi dòng grep in số **≥ 1**. Nếu có class ra `0`, utility đó không được sinh (bẫy Tailwind đã gặp 3 lần — xem `admin-ui-nen-tang.md`): thay bằng class có sẵn hoặc viết class thật trong `src/api/styles/admin.css`, **không** ghim bằng cách bỏ kiểm tra.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/api/adminHtml.ts src/api/server.ts src/api/__tests__/orderItemsRender.test.ts src/api/__tests__/adminRoutes.test.ts
git commit -m "$(cat <<'MSG'
feat(admin): /admin/orders hien chi tiet tung mon ngay trong o San pham

details native, khong them cot (bang da 10 cot). Co ghi chu khi hoa hong da khoa tay hoac
tong cac mon lech so tren hang. 1 query cho ca trang, khong N+1.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6 (việc phụ A): Nút "Rút tiền" mờ ở 3 trạng thái chưa đủ điều kiện

**Files:**
- Modify: `src/api/dashboardHtml.ts` (biến `meetsWithdrawTarget`; điều kiện của `withdrawBlock`; `disabledWithdrawAction`; `${withdrawBlock}` trong `body`; CSS)
- Test: `src/api/__tests__/dashboardWithdrawHint.test.ts` (thêm test; dùng sẵn helper `render()`, `entry()`, `withdrawal()` của file)

**Interfaces:**
- Consumes: không.
- Produces: không (thuần giao diện). **Không đụng backend**: `POST /d/:token/withdraw` vẫn tự chặn ở ledger.

Quy tắc (chốt với chủ bot): nút mờ chỉ ở 3 trạng thái **chưa đủ điều kiện** (tiền đang tạm giữ / chờ sàn xác nhận / chưa đủ ngưỡng). Trạng thái "đã gửi yêu cầu, đang chờ Admin" và "đủ điều kiện" **không** có nút mờ. Không render 3 trường ngân hàng ở trạng thái mờ.

- [ ] **Step 1: Thêm test (sẽ fail)**

Thêm vào cuối `dashboardWithdrawHint.test.ts`:

```ts
// 2026-10-11 (yeu cau truc tiep cua chu bot): hien nut "Rut tien" MO o moi trang thai CHUA du dieu kien
// rut. CHI nut - tuyet doi khong hien form nhap STK. Trang thai "da gui yeu cau, dang cho Admin" va
// "du dieu kien" KHONG co nut mo.
const DISABLED_BTN = /<button type="button" class="withdraw-disabled" disabled aria-disabled="true">Rút tiền<\/button>/;

function assertDisabledButtonOnly(html: string): void {
  assert.match(html, DISABLED_BTN, "phai co nut Rut tien mo + disabled");
  assert.ok(!html.includes('action="/d/tok/withdraw"'), "khong duoc co form rut tien");
  assert.ok(!html.includes("bankAccountNumber"), "khong duoc hien cac truong ngan hang");
}

test("nut Rut tien mo: tien dang bi tam giu", () => {
  assertDisabledButtonOnly(
    render({
      availableBalance: 0,
      heldBalance: 25_000,
      entries: [entry({ status: "confirmed", userShareAmount: 25_000 })],
    })
  );
});

test("nut Rut tien mo: tien dang cho san xac nhan", () => {
  assertDisabledButtonOnly(render({ availableBalance: 0, entries: [entry({ userShareAmount: 48_114 })] }));
});

test("nut Rut tien mo: chua du nguong ('tich luy them')", () => {
  assertDisabledButtonOnly(render({ availableBalance: 5_000, entries: [] }));
});

test("nut Rut tien mo: kha dung < no (no la moc chan, khong phai nguong)", () => {
  assertDisabledButtonOnly(
    render({
      availableBalance: 30_000,
      debtRemaining: 40_000,
      entries: [entry({ status: "confirmed", userShareAmount: 30_000 })],
    })
  );
});

test("nut Rut tien: du dieu kien -> la FORM that, KHONG co nut mo", () => {
  const html = render({ availableBalance: 30_000, entries: [entry({ status: "confirmed", userShareAmount: 30_000 })] });
  assert.ok(html.includes('action="/d/tok/withdraw"'));
  assert.doesNotMatch(html, /class="withdraw-disabled"/);
});

test("nut Rut tien: da gui yeu cau dang cho Admin -> KHONG co nut mo (giu nguyen nhu cu)", () => {
  const html = render({
    availableBalance: 0,
    entries: [entry({ status: "confirmed" })],
    pendingWithdrawal: withdrawal({ amount: 60_000 }),
  });
  assert.doesNotMatch(html, /class="withdraw-disabled"/);
  assert.ok(!html.includes('action="/d/tok/withdraw"'));
});

test("nut Rut tien mo: nut nam NGOAI moi <form> (gỡ disabled bang DevTools cung khong gui duoc gi)", () => {
  const html = render({ availableBalance: 5_000, entries: [] });
  assert.ok(!/<form[\s\S]*withdraw-disabled[\s\S]*<\/form>/.test(html));
});
```

- [ ] **Step 2: Chạy để thấy fail**

Run: `npx tsx --test src/api/__tests__/dashboardWithdrawHint.test.ts`
Expected: 4 test `assertDisabledButtonOnly` FAIL; 3 test còn lại PASS (là test chặn hồi quy).

- [ ] **Step 3: Sửa `dashboardHtml.ts`**

3a. Ngay TRƯỚC dòng `const withdrawBlock = input.pendingWithdrawal`, thêm:

```ts
  // MOT bien duy nhat cho "da du dieu kien rut": form rut va nut mo ben duoi doc CUNG bien nay nen
  // khong the lech nhau (co form thi khong co nut mo, va nguoc lai).
  const meetsWithdrawTarget = input.availableBalance >= withdrawTargetVnd;
```

3b. Trong `withdrawBlock`, đổi điều kiện:

```ts
    : input.availableBalance >= withdrawTargetVnd
      ? `<form method="POST"
```
thành
```ts
    : meetsWithdrawTarget
      ? `<form method="POST"
```
(chỉ đổi phần điều kiện, giữ nguyên toàn bộ phần còn lại của dòng/nhánh.)

3c. Ngay SAU khi `withdrawBlock` kết thúc (sau dấu `;` đóng nhánh ternary cuối cùng, trước `const platformLabel = ...`), thêm:

```ts
  // (2026-10-11, yeu cau chu bot) Nut "Rut tien" MO o 3 trang thai chua du dieu kien (tam giu / cho san
  // xac nhan / chua du nguong). CHI nut, khong form, KHONG nam trong <form> nao nen khong co duong gui.
  // Ly do chua rut duoc nam trong o thong bao ngay phia tren (khong nhet vao title: dien thoai khong
  // hover duoc). Backend khong doi: POST /d/:token/withdraw van tu chan o ledger.
  // "Da gui yeu cau, dang cho Admin" KHONG co nut mo - user o do DU dieu kien, chi la da gui roi.
  const disabledWithdrawAction =
    !input.pendingWithdrawal && !meetsWithdrawTarget
      ? `<div class="withdraw-action"><button type="button" class="withdraw-disabled" disabled aria-disabled="true">Rút tiền</button></div>`
      : "";
```

3d. Trong `body`, dòng `${withdrawBlock}` đổi thành hai dòng:

```
${withdrawBlock}
${disabledWithdrawAction}
```

3e. CSS: ngay sau dòng `button:hover { filter: brightness(1.08); }` thêm:

```css
  .withdraw-action { display: flex; justify-content: flex-end; margin-bottom: 1.25rem; }
  button:disabled {
    cursor: not-allowed; opacity: 0.55; box-shadow: none; filter: none;
  }
  button:disabled:hover { filter: none; }
```

- [ ] **Step 4: Chạy test, phải pass**

Run: `npx tsx --test src/api/__tests__/dashboardWithdrawHint.test.ts src/api/__tests__/dashboardRoutes.test.ts`
Expected: PASS, gồm mọi test cũ về câu chữ "Tích luỹ thêm"/"chờ sàn xác nhận" (không đổi một chữ nào).

- [ ] **Step 5: Kiểm tra bằng mắt (test không bắt được CSS)**

Test chỉ chốt cấu trúc; **độ mờ có còn đọc được chữ hay không thì test không biết** (cùng loại bẫy `node:vm` không bắt được CSS ở `admin-ui-nen-tang.md`). Dựng HTML thật rồi xem trên viewport điện thoại (bọc iframe — `--window-size` không đổi layout viewport, xem memory `feedback_verify_mobile_with_chrome_harness`); **không** dùng `npm run dev` (nó nạp token bot thật):

```bash
cd "/Users/ryan/Documents/Claude/Projects/Affiliate Bot Shopee" && cat > "$TMPDIR/preview-disabled.ts" <<'EOF'
import { writeFileSync } from "node:fs";
import { renderDashboardPage } from "/Users/ryan/Documents/Claude/Projects/Affiliate Bot Shopee/src/api/dashboardHtml.ts";
const html = renderDashboardPage({
  entries: [], availableBalance: 5_000, heldBalance: 0, heldEntries: [], debtRemaining: 0, debts: [],
  pendingBalance: 0, paidTotal: 0, pendingWithdrawal: null, thresholdVnd: 20_000,
  token: "tok", platform: "zalo", userId: "u1", displayName: "Yến Nhi",
});
writeFileSync(`${process.env.TMPDIR}/preview-disabled.html`, html);
console.log("ghi:", `${process.env.TMPDIR}/preview-disabled.html`);
EOF
npx tsx "$TMPDIR/preview-disabled.ts"
```
Mở file HTML, kiểm: nút "Rút tiền" nhìn thấy rõ là **bị khoá** nhưng chữ **vẫn đọc được** trên nền kính tối; không có ô ngân hàng. Nếu chữ chìm, tăng `opacity` (ví dụ 0.7) rồi chạy lại Step 4.

- [ ] **Step 6: Commit**

```bash
npm run typecheck
git add src/api/dashboardHtml.ts src/api/__tests__/dashboardWithdrawHint.test.ts
git commit -m "$(cat <<'MSG'
feat(dashboard): nut Rut tien mo o 3 trang thai chua du dieu kien rut

Tam giu / cho san xac nhan / chua du nguong -> nut disabled nam ngoai moi form, khong hien
truong ngan hang. Trang thai da gui yeu cau cho Admin giu nguyen (khong nut). Backend khong doi.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 7 (việc phụ B): `{{san}}` cho template chào bù trong group

**Files:**
- Modify: `src/adapters/shared/replyText.ts:439-441`
- Modify: `src/config/settingsRegistry.ts:101` (helpText)
- Test: `src/adapters/shared/__tests__/replyText.test.ts` (thêm), `src/adapters/zalo/__tests__/zaloBot.test.ts` (thêm)

**Interfaces:**
- Consumes: `supportedMerchantNames()` từ `src/core/merchants.ts` (đã import sẵn trong `replyText.ts`).
- Produces: placeholder `{{san}}` hợp lệ cho `groupJoinBlockedReplyTemplate`; chip "bấm để chèn biến" tự xuất hiện vì `extractPlaceholders()` quét từ helpText.

**Giữ nguyên default template** (không thêm `{{san}}` vào câu chữ mặc định).

- [ ] **Step 1: Thêm test (sẽ fail)**

Thêm vào `src/adapters/shared/__tests__/replyText.test.ts`, ngay sau test `"formatGroupJoinBlockedGroupReply: template default co {{name}} va link So tay"` (đảm bảo `supportedMerchantNames` được import từ `../../../core/merchants.js` — nếu file chưa import thì thêm):

```ts
test("formatGroupJoinBlockedGroupReply: dien {{san}} theo danh sach san bot dang ho tro", () => {
  const body = formatGroupJoinBlockedGroupReply(
    "Chào {{name}}, em hỗ trợ {{san}} nha.",
    "@Tô Diễm",
    "https://bot.example.com/so-tay"
  );
  assert.equal(body, `Chào @Tô Diễm, em hỗ trợ ${supportedMerchantNames()} nha.`);
  assert.ok(!body.includes("{{"), "khong duoc con placeholder chua thay the");
});

test("formatGroupJoinBlockedGroupReply: template cu KHONG co {{san}} chay y nhu cu", () => {
  const body = formatGroupJoinBlockedGroupReply(
    GROUP_JOIN_BLOCKED_REPLY_TEMPLATE_DEFAULT,
    "@Tô Diễm",
    "https://bot.example.com/so-tay"
  );
  assert.ok(!body.includes("{{"));
  assert.ok(!GROUP_JOIN_BLOCKED_REPLY_TEMPLATE_DEFAULT.includes("{{san}}"), "default KHONG duoc tu them {{san}}");
});
```

Thêm vào `src/adapters/zalo/__tests__/zaloBot.test.ts`, ngay sau test `"Zalo group join: DM bi chan -> chao bu trong group kem mention @ten nguoi moi"`. Lấy `ledgerStore` từ `setup()` như các test FAQ ~dòng 451 đang làm (nếu `setup()` chưa trả `ledgerStore` thì thêm vào object `return`); thêm import `SETTINGS_KEYS` từ `../../../core/settingsKeys.js` và `supportedMerchantNames` từ `../../../core/merchants.js` nếu chưa có:

```ts
test("Zalo group join: {{san}} dung TRUOC {{name}} trong template van tag dung vi tri @ten", async () => {
  const { sent, ledgerStore, handleGroupEvent, setDirectMessageError, cleanup } = setup();
  try {
    // {{san}} sinh ra chuoi DAI HON placeholder, nam TRUOC ten: offset mention phai tinh SAU khi render.
    ledgerStore.setSetting(
      SETTINGS_KEYS.groupJoinBlockedReplyTemplate,
      "Em hỗ trợ {{san}} nhé. Chào {{name}} nha."
    );
    setDirectMessageError(new Error(BLOCKED_ERROR_MESSAGE));

    await handleGroupEvent(makeJoinEvent([{ id: "user-9", dName: "Tô Diễm" }]));

    const body = bodyOf(sent[0]);
    assert.ok(body.includes(supportedMerchantNames()), "{{san}} phai duoc thay");
    assert.ok(!body.includes("{{"));
    const mentions = (sent[0].payload as { mentions?: { pos: number; uid: string; len: number }[] }).mentions;
    assert.ok(mentions !== undefined);
    assert.equal(mentions[0].pos, body.indexOf("@Tô Diễm"));
    assert.equal(body.slice(mentions[0].pos, mentions[0].pos + mentions[0].len), "@Tô Diễm");
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Chạy để thấy fail**

Run: `npx tsx --test src/adapters/shared/__tests__/replyText.test.ts src/adapters/zalo/__tests__/zaloBot.test.ts`
Expected: 2 test dùng `{{san}}` FAIL (body còn nguyên chữ `{{san}}`); test "template cu" PASS.

- [ ] **Step 3: Sửa code**

3a. `src/adapters/shared/replyText.ts`:

```ts
export function formatGroupJoinBlockedGroupReply(template: string, name: string, handbookUrl: string): string {
  return renderTemplate(template, { name, handbookUrl, san: supportedMerchantNames() });
}
```

3b. `src/config/settingsRegistry.ts` — trong `helpText` của entry `groupJoinBlockedReplyTemplate`, đổi đoạn cuối `{{handbookUrl}} (link trang Sổ tay hoàn tiền của bot, /so-tay).",` thành:

```
{{handbookUrl}} (link trang Sổ tay hoàn tiền của bot, /so-tay) và {{san}} (danh sách sàn bot đang hỗ trợ, tự đổi theo cấu hình).",
```

- [ ] **Step 4: Chạy test + toàn bộ bộ test settings/replyText**

Run: `npx tsx --test src/adapters/shared/__tests__/replyText.test.ts src/adapters/zalo/__tests__/zaloBot.test.ts src/api/__tests__/adminRoutes.test.ts`
Expected: PASS. (`adminRoutes.test.ts` chạy cả trang `/admin/settings` nên bắt luôn lỗi chip placeholder nếu helpText sai cú pháp.)

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add src/adapters/shared/replyText.ts src/config/settingsRegistry.ts src/adapters/shared/__tests__/replyText.test.ts src/adapters/zalo/__tests__/zaloBot.test.ts
git commit -m "$(cat <<'MSG'
feat(tin-nhan): {{san}} cho template chao bu trong group khi user chan tin nguoi la

Default giu nguyen cau chu (khong gan ten san nao nen khong co loi sai san). Instance da bam Luu
khong can sua tay - khi nao muon dung thi tu chen {{san}}. Offset mention van tinh sau khi render.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: Cập nhật tài liệu (`.claude/rules/` + spec)

**Files:**
- Modify: `.claude/rules/import-bao-cao-shopee.md`, `.claude/rules/ledger-va-tien.md`, `.claude/rules/admin-ui-tung-trang.md`, `.claude/rules/trang-cho-user.md`, `.claude/rules/settings-va-template.md`
- Modify: `docs/superpowers/specs/2026-10-11-chi-tiet-san-pham-trong-don-design.md`

(CLAUDE.md quy định: đổi tính năng thì cập nhật rule ngay trong cùng đợt.) Dùng `cat >>` để **thêm** đoạn mới vào cuối file tương ứng, không sửa nội dung cũ.

- [ ] **Step 1: `import-bao-cao-shopee.md` — thêm vào cuối file**

```markdown

## Chi tiết từng sản phẩm của đơn nhiều món (2026-10-11)

`mergeOrderRows` trả thêm `items` và `importShopeeReport` ghi chúng qua `ledgerStore.replaceEntryItems()` — **một lời gọi RIÊNG, không nằm trong `orderStatusApply.ts`** (module đó là đường quyết định tiền dùng chung với TikTok; đây là dữ liệu hiển thị thuần tuý, trộn vào là chạm cỗ máy nợ hoàn trả của cả hai sàn). Lỗi khi ghi chi tiết chỉ vào `result.errors` (`"Khong luu duoc chi tiet san pham"`), **không bao giờ chặn việc ghi tiền**.

- **Quà tặng = cột `Giá(₫)` (giá niêm yết) bằng 0. KHÔNG lọc theo hoa hồng = 0.** Đo trên báo cáo 11/10/2026: 0 dòng nào giá 0 mà vẫn ra hoa hồng, nhưng có 3 món user **mua thật** (241k–316k) hoa hồng 0 vì ngành hàng 0% — lọc theo hoa hồng sẽ làm mất đúng những món đó. Cột `Giá(₫)` **vắng** (fixture/báo cáo cũ) ⇒ KHÔNG coi là quà tặng (sai theo hướng hiện nhiều hơn, không bao giờ ẩn món thật). Có test chặn cả hai chiều.
- **Nhãn `(+N sản phẩm khác)` đếm cùng tiêu chí** (không tính quà tặng). Lệch tiêu chí thì hàng ghi "(+2)" mà mở ra chỉ có 1 món.
- **Cột "Tổng hoa hồng đơn hàng" Shopee chỉ điền ở MỘT dòng của nhóm**, các dòng còn lại là 0; cột "Tổng hoa hồng sản phẩm" thì đủ ở mọi dòng. Đừng đọc nhầm "mua kèm không có hoa hồng". Đo: 160/160 đơn có Σ hoa hồng sản phẩm = hoa hồng đơn.
- Dòng Sub_id rỗng/khác Sub_id đơn **không vào items** (hoa hồng gián tiếp của chủ bot, quyết định 2026-08-23 giữ nguyên). Dòng đã huỷ vào items với `rowStatus='reversed'` nhưng không cộng vào tổng đơn. Dòng không có `Item id` bị bỏ khỏi items (không có khoá).
- **Backfill không có bước riêng**: Shopee liệt kê lại cả lịch sử ở mỗi lần import ⇒ lần import kế tiếp tự điền cho mọi đơn còn trong báo cáo. Đơn ghi tay qua form "Ghi 1 đơn lẻ" không có chi tiết ⇒ hiện như cũ.
- **Chưa làm cho TikTok** — rule đối soát TikTok ghi "đơn nhiều SKU" chưa quan sát lần nào.
```

- [ ] **Step 2: `ledger-va-tien.md` — thêm vào cuối file**

```markdown

## commission_entry_items — chi tiết món của đơn nhiều món (2026-10-11)

Bảng MỚI (không cần migration), **chỉ để hiển thị, không tham gia tính tiền**. Khoá `(merchant, order_id, item_id, model_id)` — `model_id` bắt buộc vì cùng `item_id` khác model là 2 dòng tính tiền riêng (đơn `2610109S28J4XY` có đúng ca này). `order_amount` = cột "Giá trị đơn hàng" của dòng (không phải giá niêm yết) để cộng các món lại ra đúng `orderAmount` của entry; `commission_amount` là `REAL`, **không làm tròn khi lưu** (Shopee trả lẻ tới phần nghìn: 4836,375) — làm tròn chỉ ở `formatVnd`.

`replaceEntryItems()` = **XOÁ rồi chèn lại trong một transaction**, không upsert thuần: upsert chống nhân đôi nhưng không dọn được dòng Shopee đã bỏ khỏi báo cáo (để lại "món ma"). Hai dòng cùng `(item_id, model_id)` trong một đơn được CỘNG DỒN thành một món (tổng giữ nguyên); trạng thái không-huỷ thắng trạng thái huỷ. `listEntryItemsFor()` lấy nhiều đơn trong một query bằng `json_each` (không N+1, không chạm trần số tham số). `entryItemsReconcile()` (`src/core/entryItems.ts`) là điều kiện để hiện danh sách cho user: cộng các món (trừ món huỷ) phải khớp đúng `orderAmount` và `commissionAmount` của entry.
```

- [ ] **Step 3: `admin-ui-tung-trang.md` — thêm vào cuối mục `## /admin/orders`**

Chèn ngay trước dòng tiêu đề `## /admin/users` đầu tiên sau mục `/admin/orders` (tìm bằng `grep -n "^## /admin/users" .claude/rules/admin-ui-tung-trang.md`), một đoạn:

```markdown
(2026-10-11, yêu cầu trực tiếp của chủ bot) **Chi tiết từng món của đơn nhiều món nằm TRONG ô "Sản phẩm"** (`orderItemsDetails()`), KHÔNG thêm cột thứ 11 (bảng đã 10 cột, `px-4` là mức vừa đủ để nút "Huỷ đơn" không bị đẩy ra ngoài màn ~1700px). `<details class="details-plain">` native, không JS; `<summary>` tự reset bằng `list-none` + `details-plain` ẩn mũi tên Safari. Chỉ hiện khi ≥2 món. **Ghi chú bắt buộc** khi cộng các món KHÔNG khớp số trên hàng: nếu `commission_overridden_at` ≠ null thì "Hoa hồng đã được sửa tay, các số bên dưới là số Shopee báo" (kể cả khi tình cờ khớp), còn lại "Tổng các món bên dưới khác số trên hàng này" — thiếu thì lần đối soát sau admin tưởng bảng tính sai. Tên món qua `escapeHtml`. Sau khi thêm utility mới đã `grep` `public/admin.css` xác nhận được sinh ra (bẫy Tailwind thứ ba).
```

- [ ] **Step 4: `trang-cho-user.md` — thêm dưới mục `## dashboardHtml.ts`**

Thêm vào cuối file:

```markdown

## Chi tiết món trong thẻ đơn + nút "Rút tiền" mờ (2026-10-11)

**Chi tiết từng món** (`renderOrderItems()` trong `dashboardHtml.ts`): `<details class="order-items">` dưới dòng tên sản phẩm, danh sách **dọc** (không bảng ngang — trang này chủ yếu mở từ điện thoại và user đã 2 lần báo "không thấy cột X") + dòng **Tổng cộng**. Chỉ hiện khi ≥2 món **và** `entryItemsReconcile()` đúng: tổng giá trị = ô "Giá trị đơn", tổng hoa hồng = ô "Hoa hồng" ngay phía trên — lời hứa của khối này là "tự cộng lại ra đúng số", nên không khớp (admin đã sửa tay hoa hồng, đơn có dòng không đọc được) thì **ẩn** chứ không hiện số lệch. **KHÔNG hiện "phần bạn nhận" theo từng món**: chia thuế/phí/% rồi làm tròn từng món thì tổng lệch vài đồng so với ô "Bạn nhận" (bẫy hai-nguồn-tính-tiền). Món mua thật hoa hồng 0đ hiện "(chưa có hoa hồng)"; món thuộc dòng đã huỷ gạch ngang và không cộng vào tổng. Tên món qua `escapeHtml`.

**Nút "Rút tiền" mờ**: ở 3 trạng thái CHƯA đủ điều kiện (tiền đang tạm giữ / chờ sàn xác nhận / chưa đủ ngưỡng, kể cả khả dụng < nợ) hiện `<button type="button" class="withdraw-disabled" disabled>` **dưới** ô thông báo (giữ nguyên câu chữ các ô đó). Chỉ nút, **không** form/ô ngân hàng; nút **nằm ngoài mọi `<form>`** nên gỡ `disabled` bằng DevTools cũng không gửi được gì; backend không đổi (`POST /d/:token/withdraw` vẫn tự chặn ở ledger). Trạng thái "đã gửi yêu cầu, đang chờ Admin" và "đủ điều kiện" **không** có nút mờ. Form và nút mờ cùng đọc biến `meetsWithdrawTarget` nên không thể lệch nhau. Lý do KHÔNG nhét vào `title`: điện thoại không hover được. Độ mờ (`opacity: .55`) phải kiểm bằng mắt — test chỉ chốt cấu trúc, không biết chữ có còn đọc được không.
```

- [ ] **Step 5: `settings-va-template.md` — thêm vào cuối mục "Không viết thẳng tên sàn…"**

Thêm vào cuối file:

```markdown

- **`groupJoinBlockedReplyTemplate` cũng nhận `{{san}}` (2026-10-11)** — `formatGroupJoinBlockedGroupReply()` truyền `san: supportedMerchantNames()`, helpText liệt kê placeholder nên chip "bấm để chèn biến" tự có. **Default giữ nguyên câu chữ** (không gõ tên sàn nào nên không có lỗi nói sai sàn; thêm vào là đổi văn phong). Instance đã bấm Lưu không cần sửa tay — khi nào muốn dùng thì tự chèn `{{san}}`. Offset mention `@tên` được tính bằng `body.indexOf` **sau khi render** (`greetBlockedUserInGroup`), nên `{{san}}` đứng trước `{{name}}` vẫn đúng vị trí — có test chặn.
```

- [ ] **Step 6: Cập nhật spec cho khớp những gì đã quyết khi lập kế hoạch**

Thêm vào cuối `docs/superpowers/specs/2026-10-11-chi-tiet-san-pham-trong-don-design.md`:

```markdown

## 13. Bổ sung khi lập kế hoạch (2026-10-11)

Ba chỗ plan **tinh chỉnh/bổ sung** so với bản spec ở trên — ghi lại để spec không nói khác code:

1. **Hai dòng cùng `(item_id, model_id)` trong một đơn được cộng dồn** thành một món (mục 4). Có trong dữ liệu thật: đơn `260923SDX2CYF2` có 3 dòng cùng `item_id`+`model_id`, khác promotion. Không xử lý thì vi phạm khoá chính và làm sập cả transaction.
2. **Dashboard user chỉ hiện danh sách khi cộng lại KHỚP thẻ** (`entryItemsReconcile`), khác với `/admin/orders` luôn hiện kèm ghi chú (mục 6, 7). Spec ban đầu chỉ nói về ghi chú cho admin và bỏ sót trường hợp user xem một đơn đã bị admin khoá hoa hồng tay: lúc đó tổng các món lệch thẻ ngay trước mắt user và phá lời hứa "tự cộng lại ra đúng số".
3. **Món mua thật hoa hồng 0đ hiện "(chưa có hoa hồng)"** ở cả hai trang — cách nói trung tính, vì từ báo cáo chỉ biết rate 0%, không biết lý do.
```

- [ ] **Step 7: Commit**

```bash
git add .claude/rules docs/superpowers/specs/2026-10-11-chi-tiet-san-pham-trong-don-design.md
git commit -m "$(cat <<'MSG'
docs(rules): chi tiet mon cua don nhieu mon, nut Rut tien mo, {{san}} cho chao bu

Cap nhat 5 file rule va spec cho khop code: cong don 2 dong cung khoa, dashboard chi hien khi
cong lai khop the.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: Kiểm chứng cuối — toàn bộ test, build, và chạy thử trên file báo cáo THẬT

**Files:** không sửa code. Script tạm đặt ở thư mục scratchpad/`$TMPDIR`, **không** commit.

- [ ] **Step 1: Toàn bộ test + typecheck + build**

```bash
npm run typecheck && npm test && npm run build
```
Expected: không lỗi; `npm test` toàn xanh. Nếu có test cũ đỏ, **dừng** và báo (đừng sửa test cũ để cho xanh): đặc biệt `orderStatusApply.test.ts`, `shopeeReportImport.test.ts`, `dashboardWithdrawHint.test.ts` phải xanh **không sửa một dòng**.

- [ ] **Step 2: Chạy thử import trên file báo cáo thật vào DB trong bộ nhớ**

```bash
cat > "$TMPDIR/verify-real.ts" <<'EOF'
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = "/Users/ryan/Documents/Claude/Projects/Affiliate Bot Shopee";
const load = (p: string) => import(pathToFileURL(join(REPO, p)).href);
const { LedgerStore } = await load("src/core/ledgerStore.ts");
const { LogStore } = await load("src/core/logStore.ts");
const { importShopeeReport } = await load("src/core/shopeeReportImport.ts");
const { parseCsv } = await load("src/scripts/csv.ts");
const { entryItemsKey, entryItemsReconcile } = await load("src/core/entryItems.ts");

const csvText = readFileSync("/Users/ryan/Downloads/AffiliateCommissionReport_202610110849.csv", "utf8");
const logStore = new LogStore(":memory:");
const ledgerStore = new LedgerStore(":memory:");

// Moi Sub_id khac nhau -> 1 luot tao link gia lap cua 1 user rieng, de moi don co chu.
const subIds = new Set<string>();
for (const row of parseCsv(csvText)) {
  const parts = [row.Sub_id1, row.Sub_id2, row.Sub_id3, row.Sub_id4, row.Sub_id5].map((p: string) => p?.trim()).filter(Boolean);
  if (parts.length) subIds.add(parts.join("-"));
}
let n = 0;
for (const subId of subIds) {
  logStore.record({ platform: "zalo", merchant: "shopee", userId: `u${n++}`, originalUrl: "https://shopee.vn/product/1/2", subId, outcome: "success", errorCode: null, affiliateUrl: "https://x/s/a" });
}

const result = importShopeeReport(logStore, ledgerStore, {
  recordOrderConfig: { taxPercent: 10, platformFeePercent: 1, userSharePercent: 80, maxCommissionRatioPercent: 1000, holdConfig: { thresholdVnd: 0, holdDays: 0 } },
}, csvText);

const entries = ledgerStore.listCommissionEntries({}, { limit: 1000, offset: 0 });
const items = ledgerStore.listEntryItemsFor(entries);
let multi = 0, reconciled = 0;
const bad: string[] = [];
for (const e of entries) {
  const list = items.get(entryItemsKey(e.merchant, e.orderId));
  if (!list || list.length < 2) continue;
  multi++;
  if (entryItemsReconcile(e, list)) reconciled++; else bad.push(e.orderId);
}
console.log({ ordersScanned: result.ordersScanned, entries: entries.length, errors: result.errors.length });
console.log({ donCoTu2MonTroLen: multi, khopThe: reconciled, khongKhop: bad });
const big = items.get(entryItemsKey("shopee", "2610109S28J4XY"));
console.log("2610109S28J4XY:", big?.length, "mon, khop =", big ? entryItemsReconcile(ledgerStore.getEntryByOrderId("shopee", "2610109S28J4XY"), big) : "khong co");
EOF
npx tsx "$TMPDIR/verify-real.ts"
```
Expected (đối chiếu với số đã đo trước đó trên cùng file):
- `2610109S28J4XY: 7 mon, khop = true`.
- `donCoTu2MonTroLen` ≈ **13** (con số đo được: 13 đơn còn ≥2 món sau khi bỏ quà tặng; có thể thấp hơn nếu vài đơn trong 13 đó là đơn không có Sub_id).
- `khongKhop: []`. Nếu có đơn không khớp, **đừng nới `RECONCILE_TOLERANCE`**: in ra đơn đó, so từng dòng với CSV để tìm nguyên nhân (nghi nhất: dòng bị loại vì thiếu `Item id`, hoặc entry bị làm tròn ở đâu đó).
- Không có item nào là quà tặng giá 0 (có thể kiểm: không đơn nào hiện món có tên bắt đầu `[Quà tặng`/`[Gift]`/`[Hàng tặng`).

- [ ] **Step 3: Dọn dẹp + báo cáo**

```bash
rm -f "$TMPDIR/verify-real.ts" "$TMPDIR/preview-disabled.ts" "$TMPDIR/preview-disabled.html"
git status --short
```
Expected: không còn file lạ ngoài `preview-withdrawals.ts` (đã untracked từ trước, không phải của đợt này). Báo lại cho chủ bot: số đơn thực sự có chi tiết trên file thật, kết quả khớp thẻ, và **nhắc 2 việc vận hành sau deploy** — (1) chi tiết món chỉ xuất hiện sau lần import 9h30 kế tiếp (chưa có nút backfill, cố ý); (2) muốn dùng `{{san}}` trong tin chào bù thì vào `/admin/settings` của từng instance chèn tay một lần.

---

## Self-Review (đối chiếu với spec)

| Mục spec | Task |
|---|---|
| 3 — bỏ quà tặng theo giá, món hoa hồng 0 vẫn hiện | 2 (lọc + test 3 chiều), 3 |
| 4 — bảng, khoá có `model_id`, `REAL`, không ghi quà tặng, dòng huỷ vẫn ghi | 1, 2, 3 |
| 4 — hai dòng trùng khoá | 1 (cộng dồn), 3 (test), 8 (spec §13) |
| 5 — `replaceEntryItems` riêng, không đụng `orderStatusApply`, xoá-rồi-chèn, chỉ khi có entry, backfill tự động | 1, 3 (có kiểm `orderStatusApply.test.ts` không đổi) |
| 6 — admin: không thêm cột, `<details>`, ghi chú khoá tay, nhãn `(+N)` đồng bộ | 2 (nhãn), 5 |
| 7 — dashboard: danh sách dọc, dòng tổng, `escapeHtml`, 1 query | 4 |
| 9 — bảng test | 1–5 (từng dòng đều có test tương ứng) |
| 10 — nút mờ 3 trạng thái, không form, ngoài `<form>`, backend giữ nguyên | 6 |
| 11 — `{{san}}`, default giữ nguyên, offset mention | 7 |
| 12 — tài liệu | 8 |

Khoảng trống spec đã phát hiện và xử lý trong plan (ghi ở spec §13): cộng dồn khoá trùng; dashboard ẩn khi lệch; nhãn "(chưa có hoa hồng)".

Kiểu/tên đã đối chiếu xuyên task: `EntryItemInput`, `CommissionEntryItem`, `entryItemsKey`, `entryItemsReconcile`, `replaceEntryItems(merchant, orderId, items)`, `listEntryItemsFor(keys)`, `UserLedgerSummary.entryItems`, `renderDashboardPage({ entryItems })`, `renderOrdersPage(..., debtOrderIds, entryItems)`, `meetsWithdrawTarget`, `disabledWithdrawAction` — nhất quán ở mọi task.
