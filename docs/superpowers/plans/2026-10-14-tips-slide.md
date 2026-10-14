# Tips cho user (slide) + quản trị Tips — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm nút 💡 Tips trên dashboard user mở trang slide ngang hiển thị các Tips (Tiêu đề, Ảnh, Mô tả) do Admin cấu hình tại `/admin/tips` (thêm/sửa/kéo-thả sắp xếp/tắt-bật/xoá, ảnh upload).

**Architecture:** Bảng `tips` mới trong `ledgerStore` + module `tipImage.ts` (kiểm tra chữ ký ảnh, lưu/xoá file trong `TIPS_IMAGE_DIR`) + `tipsRoutes.ts` (đăng ký 6 route admin + 2 route user, tách khỏi `server.ts` đã quá dài). Trang user là slide CSS scroll-snap thuần + một đoạn JS nhỏ chỉ để đánh dấu slide đang ở giữa. Trang admin kéo-thả bằng HTML5 Drag and Drop gốc, tự lưu qua `POST /admin/tips/reorder` (JSON).

**Tech Stack:** TypeScript (ESM, import có đuôi `.js`), Express 5 + multer, `node:sqlite`, `node:test` + `tsx --test`, Tailwind v4 (không preflight) cho `/admin`, HTML viết tay cho trang user.

**Spec:** `docs/superpowers/specs/2026-10-14-tips-slide-design.md` (đọc kèm; plan này bám theo spec).

## Global Constraints

Các ràng buộc dưới đây áp cho MỌI task (chép nguyên từ spec và `CLAUDE.md`).

- **Không đụng đường tiền**: không sửa `commissionMath.ts`, `payoutHold.ts`, `orderStatusApply.ts`, và không đổi bảng `commission_entries`/`withdrawal_requests`/`payout_debts`.
- **Ảnh**: upload tối đa **5MB**; chỉ nhận **JPEG / PNG / WebP**; **không** nhận SVG và GIF; kiểm tra **chữ ký (magic bytes)** chứ không tin mimetype; tên file lưu = `crypto.randomUUID()` + đuôi suy ra từ chữ ký (`.jpg` `.png` `.webp`).
- **Giới hạn chữ**: tiêu đề không rỗng, tối đa **120** ký tự; mô tả tối đa **2000** ký tự, qua `normalizeNewlines()` (CRLF → LF) khi LƯU.
- **Thư mục ảnh**: biến `TIPS_IMAGE_DIR`, mặc định `./data/tips-images`; khai báo mặc định trong `src/config/env.ts` VÀ note trong `.env.example` (luật chung của repo).
- **Route ảnh công khai** `GET /tips/images/:filename`: `basename()` chặn path traversal; header `Cache-Control: public, max-age=31536000, immutable` CHỈ khi gửi file thành công (404 không được kèm header này); không phục vụ file ngoài `.jpg/.png/.webp`.
- **Thứ tự khai báo route**: `POST /admin/tips/reorder` phải khai báo **trước** `POST /admin/tips/:id`.
- **`reorder`** chỉ chấp nhận khi danh sách id là **hoán vị đúng** của tập Tip đang có (không thiếu/thừa/trùng, toàn số nguyên), ghi trong **một transaction**; chưa đăng nhập trả **JSON 401** (không redirect).
- **Không dùng `window.confirm()`** (từng làm treo trình duyệt tự động khi test): xoá = `<details>` hai bước tại chỗ. Không có nút ↑↓ dự phòng (chủ bot đã bỏ).
- **Tailwind không-preflight (admin)**: ẩn/hiện phần tử có class `flex`/`grid` bằng JS → set `el.style.display`, KHÔNG dùng `.hidden =`; style kéo-thả viết thành class CSS thật trong `src/api/styles/admin.css`, KHÔNG dùng utility tuỳ ý chứa khoảng trắng; sau `npm run build:css` phải `grep -F` xác nhận class đã được sinh ra; control tự dựng phải tự reset viền/nền/font.
- **Trang user**: mobile là màn hình CHÍNH; không thư viện, không CDN; mô tả luôn qua `escapeHtml`, giữ xuống dòng bằng `white-space: pre-line`; URL ảnh luôn dựng từ `encodeURIComponent(image_path)` trên `/tips/images/`.
- **Nút Tips trên dashboard chỉ hiện khi có ≥ 1 Tip đang bật**; `hasTips` là field TUỲ CHỌN (mặc định `false`) để mọi chỗ gọi/test cũ không phải sửa.
- **`createServer()`**: tham số mới `tipsImageDir` là tham số CUỐI, có giá trị mặc định.
- **`src/core/**` không import `express`/`multer`/`telegraf`**. Mọi lỗi nghiệp vụ là `AppError` subclass với `userMessage` tiếng Việt.
- **Không `git push`** (push vào `main` tự deploy Railway; luôn hỏi trước). Các bước "Commit" chỉ chạy khi chủ bot đã đồng ý cho commit. Khi `git add` chỉ thêm đúng file của task (working tree có thể có file không liên quan, ví dụ `preview-withdrawals.ts`).
- **Mốc ngày** (nếu cần) theo giờ VN; ở tính năng này chỉ dùng `new Date().toISOString()` cho `created_at/updated_at` như các bảng khác.
- Comment trong code viết tiếng Việt không dấu như phần còn lại của repo; chuỗi hiện cho người dùng viết tiếng Việt có dấu.

## Cấu trúc file

| File | Việc | Task |
|---|---|---|
| `src/core/errors.ts` (sửa) | thêm `InvalidTipError`, mã `INVALID_TIP` | 1 |
| `src/core/types.ts` (sửa) | thêm `Tip`, `TipInput`, `TipUpdateInput` | 1 |
| `src/core/ledgerStore.ts` (sửa) | bảng `tips` + API `createTip/getTipById/updateTip/setTipActive/deleteTip/listTips/countActiveTips/reorderTips` + hằng giới hạn chữ | 1 |
| `src/core/tipImage.ts` (mới) | `detectTipImageType`, `saveTipImage`, `deleteTipImage`, `TIP_IMAGE_MAX_BYTES` | 2 |
| `src/config/env.ts`, `.env.example` (sửa) | `TIPS_IMAGE_DIR` | 2 |
| `src/api/tipsRoutes.ts` (mới) | `registerTipsRoutes()`: 6 route admin + 2 route user | 3, 4, 5 |
| `src/api/adminTipsHtml.ts` (mới) | `renderAdminTipsPage()` (thân trang admin) | 3 |
| `src/api/tipsAdminScript.ts` (mới) | `TIPS_ADMIN_SCRIPT` (đóng `<details>`, kéo-thả) | 3, 4 |
| `src/api/adminHtml.ts` (sửa) | mục menu "Tips" + icon `lightbulb` | 3 |
| `src/api/server.ts` (sửa) | tham số `tipsImageDir`, `isAdminSession`, gọi `registerTipsRoutes`, truyền `hasTips` | 3, 5, 6 |
| `src/index.ts` (sửa) | truyền `env.tips.imageDir` | 3 |
| `src/api/styles/admin.css` (sửa) | class `.tip-*` của kéo-thả | 4 |
| `src/api/tipsHtml.ts` (mới) | `renderTipsPage()` + CSS slide | 5 |
| `src/api/tipsPageScript.ts` (mới) | `TIPS_PAGE_SCRIPT` (slide đang ở giữa, chấm, mũi tên, phím) | 5 |
| `src/api/dashboardHtml.ts` (sửa) | export `pageShell` (+`extraCss`), nút Tips, field `hasTips` | 5, 6 |
| Tests mới | `tipsStore`, `tipImage`, `adminTipsHtml`, `tipsRoutes`, `tipsAdminScript`, `tipsHtml`, `tipsPageScript`, `dashboardTipsButton` | 1–6 |
| `.claude/rules/*.md`, `CLAUDE.md` (sửa) | cập nhật tài liệu | 7 |

---

### Task 1: Bảng `tips` + API LedgerStore

**Files:**
- Modify: `src/core/errors.ts` (thêm mã + class)
- Modify: `src/core/types.ts` (thêm 3 interface, đặt cạnh `ZaloGroup` ở dòng ~286)
- Modify: `src/core/ledgerStore.ts` (import; `CREATE TABLE` trong khối `db.exec` ở constructor ngay sau bảng `zalo_groups` ~dòng 540; methods ngay trước `close(): void {` ~dòng 3169; helper + hằng ở CUỐI file sau `mapZaloGroupRow`)
- Test: `src/core/__tests__/tipsStore.test.ts` (mới)

**Interfaces:**
- Produces (types):
  ```ts
  export interface Tip { id: number; title: string; description: string; imagePath: string | null;
    sortOrder: number; isActive: boolean; createdAt: string; updatedAt: string; }
  export interface TipInput { title: string; description: string; imagePath: string | null; }
  export interface TipUpdateInput { title: string; description: string; imagePath?: string | null; } // undefined = giu anh cu, null = bo anh
  ```
- Produces (errors): `class InvalidTipError extends AppError` (`new InvalidTipError(userMessage: string)`, code `"INVALID_TIP"`).
- Produces (LedgerStore):
  - `createTip(input: TipInput): Tip`
  - `getTipById(id: number): Tip | null`
  - `updateTip(id: number, input: TipUpdateInput): { tip: Tip; previousImagePath: string | null } | null` (null = không có Tip)
  - `setTipActive(id: number, active: boolean): boolean` (false = không có Tip)
  - `deleteTip(id: number): { imagePath: string | null } | null`
  - `listTips(options?: { onlyActive?: boolean }): Tip[]` (sắp `sort_order ASC, id ASC`)
  - `countActiveTips(): number`
  - `reorderTips(orderedIds: number[]): void` (ném `InvalidTipError` nếu không phải hoán vị đúng)
  - hằng export `TIP_TITLE_MAX_LENGTH = 120`, `TIP_DESCRIPTION_MAX_LENGTH = 2000`.

- [ ] **Step 1: Viết test (fail)**

Tạo `src/core/__tests__/tipsStore.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore, TIP_DESCRIPTION_MAX_LENGTH, TIP_TITLE_MAX_LENGTH } from "../ledgerStore.js";
import { AppError, InvalidTipError } from "../errors.js";

function newStore(): LedgerStore {
  return new LedgerStore(":memory:");
}

function titles(store: LedgerStore, onlyActive = false): string[] {
  return store.listTips({ onlyActive }).map((tip) => tip.title);
}

test("createTip: tip moi xep CUOI, sort_order tang dan, mac dinh dang bat", () => {
  const store = newStore();
  const a = store.createTip({ title: "A", description: "", imagePath: null });
  const b = store.createTip({ title: "B", description: "mo ta", imagePath: "b.png" });
  assert.equal(a.sortOrder, 1);
  assert.equal(b.sortOrder, 2);
  assert.equal(b.imagePath, "b.png");
  assert.equal(a.imagePath, null);
  assert.equal(a.isActive, true);
  assert.deepEqual(titles(store), ["A", "B"]);
});

test("createTip: cat khoang trang 2 dau, doi CRLF thanh LF trong mo ta", () => {
  const store = newStore();
  const tip = store.createTip({ title: "  Tieu de  ", description: "dong 1\r\ndong 2\r\n", imagePath: null });
  assert.equal(tip.title, "Tieu de");
  assert.equal(tip.description, "dong 1\ndong 2");
});

test("createTip: tieu de rong / qua dai / mo ta qua dai -> InvalidTipError (AppError) va khong ghi gi", () => {
  const store = newStore();
  assert.throws(() => store.createTip({ title: "   ", description: "", imagePath: null }), InvalidTipError);
  assert.throws(
    () => store.createTip({ title: "x".repeat(TIP_TITLE_MAX_LENGTH + 1), description: "", imagePath: null }),
    InvalidTipError
  );
  assert.throws(
    () => store.createTip({ title: "ok", description: "y".repeat(TIP_DESCRIPTION_MAX_LENGTH + 1), imagePath: null }),
    InvalidTipError
  );
  try {
    store.createTip({ title: "", description: "", imagePath: null });
    assert.fail("phai nem loi");
  } catch (err) {
    assert.ok(err instanceof AppError);
    assert.equal((err as AppError).code, "INVALID_TIP");
  }
  assert.equal(store.listTips().length, 0);
});

test("createTip: dung dung do dai toi da thi duoc chap nhan", () => {
  const store = newStore();
  store.createTip({
    title: "x".repeat(TIP_TITLE_MAX_LENGTH),
    description: "y".repeat(TIP_DESCRIPTION_MAX_LENGTH),
    imagePath: null,
  });
  assert.equal(store.listTips().length, 1);
});

test("listTips({onlyActive}) + countActiveTips + setTipActive", () => {
  const store = newStore();
  const a = store.createTip({ title: "A", description: "", imagePath: null });
  store.createTip({ title: "B", description: "", imagePath: null });
  assert.equal(store.countActiveTips(), 2);

  assert.equal(store.setTipActive(a.id, false), true);
  assert.deepEqual(titles(store, true), ["B"]);
  assert.deepEqual(titles(store), ["A", "B"]); // admin van thay tip da tat
  assert.equal(store.countActiveTips(), 1);

  assert.equal(store.setTipActive(a.id, true), true);
  assert.equal(store.countActiveTips(), 2);
  assert.equal(store.setTipActive(9999, true), false);
});

test("updateTip: undefined giu anh cu, null bo anh, chuoi doi anh; tra ve anh cu de xoa file", () => {
  const store = newStore();
  const tip = store.createTip({ title: "A", description: "d", imagePath: "old.png" });

  const kept = store.updateTip(tip.id, { title: "A2", description: "d2" });
  assert.ok(kept);
  assert.equal(kept.tip.title, "A2");
  assert.equal(kept.tip.imagePath, "old.png");
  assert.equal(kept.previousImagePath, "old.png");

  const replaced = store.updateTip(tip.id, { title: "A2", description: "d2", imagePath: "new.webp" });
  assert.ok(replaced);
  assert.equal(replaced.tip.imagePath, "new.webp");
  assert.equal(replaced.previousImagePath, "old.png");

  const removed = store.updateTip(tip.id, { title: "A2", description: "d2", imagePath: null });
  assert.ok(removed);
  assert.equal(removed.tip.imagePath, null);
  assert.equal(removed.previousImagePath, "new.webp");
});

test("updateTip: khong co tip -> null; du lieu sai -> InvalidTipError va giu nguyen ban ghi", () => {
  const store = newStore();
  assert.equal(store.updateTip(404, { title: "x", description: "" }), null);
  const tip = store.createTip({ title: "A", description: "d", imagePath: null });
  assert.throws(() => store.updateTip(tip.id, { title: " ", description: "d" }), InvalidTipError);
  assert.equal(store.getTipById(tip.id)?.title, "A");
});

test("deleteTip: tra ve anh de caller xoa file; khong co tip -> null", () => {
  const store = newStore();
  const tip = store.createTip({ title: "A", description: "", imagePath: "a.jpg" });
  assert.deepEqual(store.deleteTip(tip.id), { imagePath: "a.jpg" });
  assert.equal(store.getTipById(tip.id), null);
  assert.equal(store.deleteTip(tip.id), null);
});

test("tip moi sau khi xoa tip cuoi van xep CUOI (khong trung sort_order)", () => {
  const store = newStore();
  store.createTip({ title: "A", description: "", imagePath: null });
  const b = store.createTip({ title: "B", description: "", imagePath: null });
  store.deleteTip(b.id);
  const c = store.createTip({ title: "C", description: "", imagePath: null });
  assert.deepEqual(titles(store), ["A", "C"]);
  assert.ok(c.sortOrder > 1);
});

test("reorderTips: hoan vi dung -> doi thu tu (ke ca tip da tat)", () => {
  const store = newStore();
  const a = store.createTip({ title: "A", description: "", imagePath: null });
  const b = store.createTip({ title: "B", description: "", imagePath: null });
  const c = store.createTip({ title: "C", description: "", imagePath: null });
  store.setTipActive(b.id, false);
  store.reorderTips([c.id, a.id, b.id]);
  assert.deepEqual(titles(store), ["C", "A", "B"]);
  assert.deepEqual(titles(store, true), ["C", "A"]);
});

test("reorderTips: thieu / thua / trung / khong phai so nguyen -> tu choi va KHONG ghi gi", () => {
  const store = newStore();
  const a = store.createTip({ title: "A", description: "", imagePath: null });
  const b = store.createTip({ title: "B", description: "", imagePath: null });
  const before = store.listTips().map((tip) => tip.id);

  assert.throws(() => store.reorderTips([b.id]), InvalidTipError); // thieu
  assert.throws(() => store.reorderTips([b.id, a.id, 9999]), InvalidTipError); // thua
  assert.throws(() => store.reorderTips([a.id, a.id]), InvalidTipError); // trung
  assert.throws(() => store.reorderTips([a.id, 1.5]), InvalidTipError); // khong phai so nguyen
  assert.throws(() => store.reorderTips(["1", "2"] as unknown as number[]), InvalidTipError); // sai kieu
  assert.deepEqual(store.listTips().map((tip) => tip.id), before);
});

test("reorderTips: bang rong + danh sach rong la hop le", () => {
  const store = newStore();
  store.reorderTips([]);
  assert.equal(store.listTips().length, 0);
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx tsx --test src/core/__tests__/tipsStore.test.ts`
Expected: FAIL (không import được `TIP_TITLE_MAX_LENGTH`/`InvalidTipError`, hoặc `createTip is not a function`).

- [ ] **Step 3: Thêm lỗi `InvalidTipError`**

Trong `src/core/errors.ts`: thêm `| "INVALID_TIP"` vào cuối union `ErrorCode` (sau `| "WITHDRAWAL_NOT_CANCELLABLE"`), và thêm class (đặt cạnh `MissingBankInfoError`):

```ts
/** Du lieu Tips (tieu de rong/qua dai, anh sai dinh dang, danh sach sap xep loi thoi...) - 2026-10-14. */
export class InvalidTipError extends AppError {
  constructor(userMessage: string) {
    super("INVALID_TIP", userMessage);
  }
}
```

- [ ] **Step 4: Thêm kiểu `Tip`**

Trong `src/core/types.ts`, ngay sau `interface ZaloGroup { ... }`:

```ts
/** 1 "mau" (Tip) hien tren trang Tips cua user - noi dung chung, khong thuoc user nao, khong thuoc duong tien. */
export interface Tip {
  id: number;
  title: string;
  description: string;
  /** Ten FILE (khong phai duong dan) trong TIPS_IMAGE_DIR; null = Tip khong co anh. */
  imagePath: string | null;
  /** Thu tu hien thi (tang dan) - cung la thu tu slide ben user. */
  sortOrder: number;
  /** false = admin da tat, user khong thay. */
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TipInput {
  title: string;
  description: string;
  imagePath: string | null;
}

export interface TipUpdateInput {
  title: string;
  description: string;
  /** undefined = giu anh cu, null = bo anh, chuoi = anh moi. */
  imagePath?: string | null;
}
```

- [ ] **Step 5: Thêm bảng + API vào `ledgerStore.ts`**

(a) Import: thêm `InvalidTipError,` vào khối `import { ... } from "./errors.js"` ở đầu file (sau `WithdrawalNotCancellableError,`), và thêm `Tip, TipInput, TipUpdateInput` vào danh sách `import type { ... } from "./types.js"` hiện có.

(b) Trong khối `this.db.exec(\`...\`)` ở constructor, ngay sau `CREATE TABLE IF NOT EXISTS zalo_groups (...);`, thêm:

```sql
      -- Tips cho user (2026-10-14). Bang MOI nen khong can migration. Noi dung chung cho moi user,
      -- KHONG thuoc duong tien. sort_order la thu tu slide; is_active = 0 la admin da tat.
      CREATE TABLE IF NOT EXISTS tips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        image_path TEXT,
        sort_order INTEGER NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
```

(c) Ngay trước `  close(): void {` thêm các method:

```ts
  // --- Tips cho user (2026-10-14) ---

  /** Tip moi xep CUOI; sort_order tinh ngay trong cau INSERT nen 2 lan tao lien tiep khong trung thu tu. */
  createTip(input: TipInput): Tip {
    const clean = cleanTipFields(input.title, input.description);
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO tips (title, description, image_path, sort_order, is_active, created_at, updated_at)
         VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tips), 1, ?, ?)`
      )
      .run(clean.title, clean.description, input.imagePath, now, now);
    return this.getTipById(Number(result.lastInsertRowid)) as Tip;
  }

  getTipById(id: number): Tip | null {
    const row = this.db.prepare(`SELECT ${TIP_COLUMNS} FROM tips WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapTipRow(row) : null;
  }

  /**
   * `imagePath` undefined = giu anh cu, null = bo anh, chuoi = anh moi. Tra ve anh CU de caller xoa file
   * (store khong cham vao he thong file). null neu khong co Tip nay.
   */
  updateTip(id: number, input: TipUpdateInput): { tip: Tip; previousImagePath: string | null } | null {
    const existing = this.getTipById(id);
    if (existing === null) return null;
    const clean = cleanTipFields(input.title, input.description);
    const nextImage = input.imagePath === undefined ? existing.imagePath : input.imagePath;
    this.db
      .prepare(`UPDATE tips SET title = ?, description = ?, image_path = ?, updated_at = ? WHERE id = ?`)
      .run(clean.title, clean.description, nextImage, new Date().toISOString(), id);
    return { tip: this.getTipById(id) as Tip, previousImagePath: existing.imagePath };
  }

  setTipActive(id: number, active: boolean): boolean {
    const result = this.db
      .prepare(`UPDATE tips SET is_active = ?, updated_at = ? WHERE id = ?`)
      .run(active ? 1 : 0, new Date().toISOString(), id);
    return Number(result.changes) > 0;
  }

  /** Tra ve anh cua tip da xoa de caller xoa file; null neu khong co tip nay. */
  deleteTip(id: number): { imagePath: string | null } | null {
    const existing = this.getTipById(id);
    if (existing === null) return null;
    this.db.prepare(`DELETE FROM tips WHERE id = ?`).run(id);
    return { imagePath: existing.imagePath };
  }

  /** Sap theo sort_order, tiebreak id de on dinh neu du lieu loi lam trung thu tu. */
  listTips(options: { onlyActive?: boolean } = {}): Tip[] {
    const where = options.onlyActive ? "WHERE is_active = 1" : "";
    const rows = this.db
      .prepare(`SELECT ${TIP_COLUMNS} FROM tips ${where} ORDER BY sort_order ASC, id ASC`)
      .all() as Array<Record<string, unknown>>;
    return rows.map(mapTipRow);
  }

  countActiveTips(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM tips WHERE is_active = 1`).get() as { n: number };
    return Number(row.n);
  }

  /**
   * Doi thu tu TOAN BO tips (ke ca tip da tat). Chi chap nhan khi `orderedIds` la HOAN VI DUNG cua tap id
   * dang co: neu admin khac vua them/xoa tip trong luc minh keo-tha thi tu choi thay vi ghi de am tham.
   * BEGIN/COMMIT o day la de an toan khi crash giua chung (node:sqlite dong bo nen khong co xen ke).
   */
  reorderTips(orderedIds: number[]): void {
    const existing = (this.db.prepare(`SELECT id FROM tips`).all() as Array<{ id: number }>).map((row) =>
      Number(row.id)
    );
    const wanted = new Set(orderedIds);
    const valid =
      Array.isArray(orderedIds) &&
      orderedIds.every((id) => Number.isInteger(id)) &&
      wanted.size === orderedIds.length &&
      orderedIds.length === existing.length &&
      existing.every((id) => wanted.has(id));
    if (!valid) {
      throw new InvalidTipError("Danh sách Tips đã thay đổi, hãy tải lại trang rồi sắp xếp lại.");
    }
    const update = this.db.prepare(`UPDATE tips SET sort_order = ? WHERE id = ?`);
    this.db.exec("BEGIN");
    try {
      orderedIds.forEach((id, index) => update.run(index + 1, id));
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

```

(d) Cuối file (sau `mapZaloGroupRow`), thêm:

```ts
export const TIP_TITLE_MAX_LENGTH = 120;
export const TIP_DESCRIPTION_MAX_LENGTH = 2000;

const TIP_COLUMNS = "id, title, description, image_path, sort_order, is_active, created_at, updated_at";

/** Chuan hoa + kiem tra chu cua Tip. Mo ta qua normalizeNewlines vi <textarea> nop len dang CRLF (xem textNormalize.ts). */
function cleanTipFields(title: string, description: string): { title: string; description: string } {
  const cleanTitle = title.trim();
  const cleanDescription = normalizeNewlines(description).trim();
  if (cleanTitle === "") throw new InvalidTipError("Tiêu đề không được để trống.");
  if (cleanTitle.length > TIP_TITLE_MAX_LENGTH) {
    throw new InvalidTipError(`Tiêu đề tối đa ${TIP_TITLE_MAX_LENGTH} ký tự.`);
  }
  if (cleanDescription.length > TIP_DESCRIPTION_MAX_LENGTH) {
    throw new InvalidTipError(`Mô tả tối đa ${TIP_DESCRIPTION_MAX_LENGTH} ký tự.`);
  }
  return { title: cleanTitle, description: cleanDescription };
}

function mapTipRow(row: Record<string, unknown>): Tip {
  return {
    id: Number(row.id),
    title: String(row.title),
    description: String(row.description),
    imagePath: row.image_path === null || row.image_path === undefined ? null : String(row.image_path),
    sortOrder: Number(row.sort_order),
    isActive: Number(row.is_active) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
```

- [ ] **Step 6: Chạy test + typecheck, xác nhận PASS**

Run: `npx tsx --test src/core/__tests__/tipsStore.test.ts && npm run typecheck`
Expected: tất cả test PASS, typecheck sạch.

- [ ] **Step 7: Commit** (chỉ khi chủ bot đã đồng ý commit)

```bash
git add src/core/errors.ts src/core/types.ts src/core/ledgerStore.ts src/core/__tests__/tipsStore.test.ts
git commit -m "feat(tips): bang tips + API LedgerStore (tao/sua/tat-bat/xoa/xep thu tu)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Lưu ảnh Tips (`tipImage.ts`) + biến môi trường

**Files:**
- Create: `src/core/tipImage.ts`
- Modify: `src/config/env.ts` (thêm khối `tips` ngay sau khối `withdrawal`)
- Modify: `.env.example` (sau `WITHDRAWAL_PROOF_DIR=...`)
- Test: `src/core/__tests__/tipImage.test.ts` (mới)

**Interfaces:**
- Consumes: `InvalidTipError` (Task 1).
- Produces:
  ```ts
  export const TIP_IMAGE_MAX_BYTES: number;                         // 5 * 1024 * 1024
  export interface TipImageType { ext: ".jpg" | ".png" | ".webp"; mime: "image/jpeg" | "image/png" | "image/webp"; }
  export function detectTipImageType(buf: Uint8Array): TipImageType | null;
  export function saveTipImage(dir: string, buffer: Uint8Array): string;   // tra ten file; nem InvalidTipError neu khong phai anh hop le
  export function deleteTipImage(dir: string, filename: string | null): void; // an toan: null/khong ton tai/path traversal deu khong nem
  ```
  và `env.tips.imageDir: string`.

- [ ] **Step 1: Viết test (fail)**

Tạo `src/core/__tests__/tipImage.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteTipImage, detectTipImageType, saveTipImage } from "../tipImage.js";
import { InvalidTipError } from "../errors.js";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
// "RIFF" + 4 byte kich thuoc + "WEBP"
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
const GIF = new TextEncoder().encode("GIF89a....");
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const TEXT = new TextEncoder().encode("khong phai anh");

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "tip-images-"));
}

test("detectTipImageType: nhan JPEG / PNG / WebP theo chu ky, ra dung duoi", () => {
  assert.deepEqual(detectTipImageType(JPEG), { ext: ".jpg", mime: "image/jpeg" });
  assert.deepEqual(detectTipImageType(PNG), { ext: ".png", mime: "image/png" });
  assert.deepEqual(detectTipImageType(WEBP), { ext: ".webp", mime: "image/webp" });
});

test("detectTipImageType: tu choi GIF, SVG, van ban, rong, qua ngan", () => {
  assert.equal(detectTipImageType(GIF), null);
  assert.equal(detectTipImageType(SVG), null);
  assert.equal(detectTipImageType(TEXT), null);
  assert.equal(detectTipImageType(new Uint8Array([])), null);
  assert.equal(detectTipImageType(new Uint8Array([0xff, 0xd8])), null);
  // RIFF nhung khong phai WEBP (vd WAV) khong duoc nhan
  assert.equal(
    detectTipImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45])),
    null
  );
});

test("saveTipImage: ghi file ten ngau nhien + duoi suy ra tu chu ky, tu tao thu muc", () => {
  const root = tmpDir();
  const dir = join(root, "nested", "tips");
  try {
    const name = saveTipImage(dir, PNG);
    assert.match(name, /^[0-9a-f-]{36}\.png$/);
    assert.deepEqual(new Uint8Array(readFileSync(join(dir, name))), PNG);
    const other = saveTipImage(dir, JPEG);
    assert.match(other, /\.jpg$/);
    assert.notEqual(name, other);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("saveTipImage: file gia mao (khong phai anh) -> InvalidTipError va KHONG ghi file", () => {
  const dir = tmpDir();
  try {
    assert.throws(() => saveTipImage(dir, TEXT), InvalidTipError);
    assert.throws(() => saveTipImage(dir, SVG), InvalidTipError);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deleteTipImage: xoa file; null / khong ton tai khong nem", () => {
  const dir = tmpDir();
  try {
    const name = saveTipImage(dir, PNG);
    deleteTipImage(dir, name);
    assert.equal(existsSync(join(dir, name)), false);
    assert.doesNotThrow(() => deleteTipImage(dir, name));
    assert.doesNotThrow(() => deleteTipImage(dir, null));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deleteTipImage: path traversal khong thoat duoc thu muc ('../victim')", () => {
  const root = tmpDir();
  const dir = join(root, "tips");
  try {
    saveTipImage(dir, PNG); // tao thu muc
    const victim = join(root, "victim.txt");
    writeFileSync(victim, "dung xoa toi");
    deleteTipImage(dir, "../victim.txt");
    assert.equal(existsSync(victim), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx tsx --test src/core/__tests__/tipImage.test.ts`
Expected: FAIL (không tìm thấy module `../tipImage.js`).

- [ ] **Step 3: Viết `src/core/tipImage.ts`**

```ts
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { InvalidTipError } from "./errors.js";

/**
 * Anh cua Tips (2026-10-14): nhan dien loai anh bang CHU KY (magic bytes) cua noi dung file, KHONG tin
 * mimetype/ten file do client gui. Chi nhan JPEG/PNG/WebP: SVG chay duoc script khi mo truc tiep, GIF khong can.
 * Day la src/core nen KHONG import express/multer - route lo viec nhan file, o day chi nhan buffer.
 */

export const TIP_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export interface TipImageType {
  ext: ".jpg" | ".png" | ".webp";
  mime: "image/jpeg" | "image/png" | "image/webp";
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function hasBytes(buf: Uint8Array, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => buf[offset + index] === byte);
}

export function detectTipImageType(buf: Uint8Array): TipImageType | null {
  if (hasBytes(buf, [0xff, 0xd8, 0xff])) return { ext: ".jpg", mime: "image/jpeg" };
  if (hasBytes(buf, PNG_SIGNATURE)) return { ext: ".png", mime: "image/png" };
  // WebP = "RIFF" + 4 byte kich thuoc + "WEBP"; RIFF khong thoi chua du (WAV/AVI cung la RIFF).
  if (hasBytes(buf, [0x52, 0x49, 0x46, 0x46]) && hasBytes(buf, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { ext: ".webp", mime: "image/webp" };
  }
  return null;
}

/** Ghi anh vao `dir` voi ten ngau nhien; tra ten FILE (khong phai duong dan) de luu vao DB. */
export function saveTipImage(dir: string, buffer: Uint8Array): string {
  const type = detectTipImageType(buffer);
  if (type === null) {
    throw new InvalidTipError("Ảnh phải là JPG, PNG hoặc WebP (không nhận SVG hay GIF).");
  }
  mkdirSync(dir, { recursive: true });
  const filename = `${randomUUID()}${type.ext}`;
  writeFileSync(join(dir, filename), buffer);
  return filename;
}

/**
 * Xoa 1 file anh. An toan: null/khong ton tai khong nem, `basename()` chan '../'. Loi khac chi canh bao -
 * file mo coi vo hai hon ban ghi tro vao file da mat, nen khong de loi nay lam fail thao tac cua admin.
 */
export function deleteTipImage(dir: string, filename: string | null): void {
  if (filename === null || filename === "") return;
  try {
    unlinkSync(join(dir, basename(filename)));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[tips] khong xoa duoc file anh ${filename}:`, (err as Error).message);
    }
  }
}
```

- [ ] **Step 4: Thêm `TIPS_IMAGE_DIR`**

Trong `src/config/env.ts`, ngay sau khối `withdrawal: { ... },`:

```ts
  tips: {
    /**
     * Thu muc luu anh cua Tips (2026-10-14). PHAI nam tren volume (cung cho voi WITHDRAWAL_PROOF_DIR va DB),
     * neu khong anh mat sau moi lan deploy trong khi ban ghi trong bang tips van con.
     */
    imageDir: optional("TIPS_IMAGE_DIR", "./data/tips-images"),
  },
```

Trong `.env.example`, ngay sau dòng `WITHDRAWAL_PROOF_DIR=./data/withdrawal-proofs`:

```
# Thu muc luu anh cua Tips (trang Tips tren dashboard user, admin cau hinh tai /admin/tips).
# PHAI nam tren volume giong WITHDRAWAL_PROOF_DIR, neu khong anh mat sau moi lan deploy.
TIPS_IMAGE_DIR=./data/tips-images
```

- [ ] **Step 5: Chạy test + typecheck**

Run: `npx tsx --test src/core/__tests__/tipImage.test.ts && npm run typecheck`
Expected: PASS, typecheck sạch.

- [ ] **Step 6: Commit** (khi được phép)

```bash
git add src/core/tipImage.ts src/core/__tests__/tipImage.test.ts src/config/env.ts .env.example
git commit -m "feat(tips): luu/xoa anh Tips kiem tra chu ky file + TIPS_IMAGE_DIR" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Trang admin `/admin/tips` (thêm / sửa / tắt-bật / xoá, chưa kéo-thả)

**Files:**
- Create: `src/api/adminTipsHtml.ts`
- Create: `src/api/tipsAdminScript.ts` (bản đầu chỉ có handler đóng `<details>`; Task 4 mở rộng)
- Create: `src/api/tipsRoutes.ts` (chỉ route admin ở task này)
- Modify: `src/api/adminHtml.ts` (`ICON_PATHS` thêm `lightbulb`; `NAV_ITEMS` thêm mục Tips)
- Modify: `src/api/server.ts` (import, tham số `tipsImageDir`, `isAdminSession`, gọi `registerTipsRoutes`)
- Modify: `src/index.ts` (truyền `env.tips.imageDir`)
- Test: `src/api/__tests__/adminTipsHtml.test.ts` (mới), `src/api/__tests__/tipsRoutes.test.ts` (mới)

**Interfaces:**
- Consumes: `LedgerStore` Tip API (Task 1); `saveTipImage`/`deleteTipImage`/`TIP_IMAGE_MAX_BYTES`/`detectTipImageType` (Task 2); `adminShell`, `FIELD_CLASS`, `FIELD_LABEL_CLASS` (`adminHtml.ts`); `escapeHtml` (`htmlHelpers.ts`).
- Produces:
  ```ts
  // adminTipsHtml.ts
  export interface TipsAdminDraft { id: number | null; title: string; description: string; } // id null = form "Them Tip"
  export function renderAdminTipsPage(input: { tips: Tip[]; errorMessage?: string; draft?: TipsAdminDraft }): string; // THAN trang (chua boc adminShell)
  // tipsAdminScript.ts
  export const TIPS_ADMIN_SCRIPT: string; // JS thuan, KHONG kem the <script>
  // tipsRoutes.ts
  export interface TipsRoutesDeps { ledgerStore: LedgerStore; tipsImageDir: string; requireAdminAuth: RequestHandler;
    isAdminSession: (req: Request) => boolean; navPendingWithdrawals: () => number; }
  export function registerTipsRoutes(app: Express, deps: TipsRoutesDeps): void;
  ```
  Route (đều qua `requireAdminAuth`): `GET /admin/tips`, `POST /admin/tips`, `POST /admin/tips/:id`, `POST /admin/tips/:id/active`, `POST /admin/tips/:id/delete`. (`POST /admin/tips/reorder` thêm ở Task 4.)
  Form multipart: `title`, `description`, `image`, và khi sửa thêm `imageAction` = `keep|replace|remove`. **Quy tắc sửa ảnh**: nếu CÓ file upload và `imageAction !== "remove"` → coi là thay ảnh (kể cả khi radio đang để `keep`, tránh việc chọn file xong mà bị bỏ qua im lặng); `replace` mà không có file → 422; `remove` → bỏ ảnh; còn lại → giữ ảnh.

- [ ] **Step 1: Viết test render admin (fail)**

Tạo `src/api/__tests__/adminTipsHtml.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderAdminTipsPage } from "../adminTipsHtml.js";
import type { Tip } from "../../core/types.js";

function tip(overrides: Partial<Tip> = {}): Tip {
  return {
    id: 1,
    title: "Tieu de",
    description: "Mo ta",
    imagePath: null,
    sortOrder: 1,
    isActive: true,
    createdAt: "2026-10-14T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
    ...overrides,
  };
}

test("trang rong: co cau huong dan, khong co danh sach", () => {
  const html = renderAdminTipsPage({ tips: [] });
  assert.match(html, /Chưa có Tip nào/);
  assert.doesNotMatch(html, /id="tips-list"/);
});

test("moi tip co tay nam keo, cac form tat-bat/sua/xoa dung route, va hint 'Tat, dung Xoa'", () => {
  const html = renderAdminTipsPage({ tips: [tip({ id: 7 })] });
  assert.match(html, /data-tip-id="7"/);
  assert.match(html, /class="tip-handle"[^>]*draggable="true"/);
  assert.match(html, /action="\/admin\/tips\/7"/);
  assert.match(html, /action="\/admin\/tips\/7\/active"/);
  assert.match(html, /action="\/admin\/tips\/7\/delete"/);
  assert.match(html, /Muốn giữ lại để dùng sau thì <b>Tắt<\/b>, đừng Xoá/);
});

test("tip da tat: co nhan CHU 'Đã tắt' (khong chi dua vao do mo) va nut Bat lai", () => {
  const html = renderAdminTipsPage({ tips: [tip({ isActive: false })] });
  assert.match(html, /is-inactive/);
  assert.match(html, />Đã tắt</);
  assert.match(html, /name="active" value="1"/);
});

test("tip dang bat: nhan 'Đang hiện' va nut Tat gui active=0", () => {
  const html = renderAdminTipsPage({ tips: [tip({ isActive: true })] });
  assert.match(html, />Đang hiện</);
  assert.match(html, /name="active" value="0"/);
});

test("anh: dung URL /tips/images/ da encode, khong cho keo anh, co tuy chon bo anh; khong anh thi khong co <img>", () => {
  const withImage = renderAdminTipsPage({ tips: [tip({ imagePath: "a b.png" })] });
  assert.match(withImage, /src="\/tips\/images\/a%20b\.png"/);
  assert.match(withImage, /draggable="false"/);
  assert.match(withImage, /value="remove"/);

  const noImage = renderAdminTipsPage({ tips: [tip({ imagePath: null })] });
  assert.doesNotMatch(noImage, /<img /);
  assert.doesNotMatch(noImage, /value="remove"/);
});

test("escape HTML o tieu de va mo ta (khong chen duoc <script>)", () => {
  const html = renderAdminTipsPage({
    tips: [tip({ title: '<script>alert("x")</script>', description: "a & b <img src=x onerror=1>" })],
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;/);
});

test("xoa 2 buoc bang <details> + nut Huy, KHONG dung window.confirm / onsubmit confirm", () => {
  const html = renderAdminTipsPage({ tips: [tip({ id: 3 })] });
  assert.match(html, /<details[^>]*>\s*<summary[^>]*>Xoá<\/summary>/);
  assert.match(html, /Xác nhận xoá/);
  assert.match(html, /data-close-details/);
  assert.doesNotMatch(html, /confirm\(/);
});

test("form Them Tip: mo san khi co draft tao moi, giu nguyen chu admin da go, hien banner loi", () => {
  const html = renderAdminTipsPage({
    tips: [],
    errorMessage: "Ảnh quá lớn, tối đa 5MB.",
    draft: { id: null, title: "Tieu de dang go", description: "Mo ta dai dang go" },
  });
  assert.match(html, /Ảnh quá lớn, tối đa 5MB\./);
  assert.match(html, /<details id="tip-create"[^>]*\bopen\b/);
  assert.match(html, /value="Tieu de dang go"/);
  assert.match(html, />Mo ta dai dang go<\/textarea>/);
});

test("form sua: draft cua dung tip mo san va giu chu da go", () => {
  const html = renderAdminTipsPage({
    tips: [tip({ id: 5, title: "Cu" })],
    errorMessage: "Tiêu đề không được để trống.",
    draft: { id: 5, title: "", description: "Mo ta moi" },
  });
  assert.match(html, /<details id="tip-edit-5"[^>]*\bopen\b/);
  assert.match(html, />Mo ta moi<\/textarea>/);
});

test("form co enctype multipart, input file chi nhan jpg/png/webp, co maxlength cho tieu de", () => {
  const html = renderAdminTipsPage({ tips: [] });
  assert.match(html, /enctype="multipart\/form-data"/);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(html, /maxlength="120"/);
  assert.match(html, /maxlength="2000"/);
});
```

- [ ] **Step 2: Viết test route (fail)**

Tạo `src/api/__tests__/tipsRoutes.test.ts` (các route user sẽ thêm test ở Task 5, route reorder ở Task 4):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server.js";
import { AdminSessionStore } from "../../core/adminAuth.js";
import { LedgerStore } from "../../core/ledgerStore.js";
import { LogStore } from "../../core/logStore.js";
import { LinkResolverService } from "../../core/linkResolverService.js";
import { RateLimiter } from "../../core/rateLimiter.js";
import { MockAffiliateProvider } from "../../core/providers/mockProvider.js";

const ADMIN_PASSWORD = "test-admin-password";
const ORDER_CONFIG = {
  taxPercent: 0,
  platformFeePercent: 0,
  userSharePercent: 80,
  maxCommissionRatioPercent: 1000,
  holdConfig: { thresholdVnd: 0, holdDays: 0 },
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);

function setup() {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  const rateLimiter = new RateLimiter(1000, 60_000);
  const adminLoginRateLimiter = new RateLimiter(1000, 60_000);
  const resolver = new LinkResolverService(new MockAffiliateProvider(), logStore, rateLimiter);
  const adminSessionStore = new AdminSessionStore(ADMIN_PASSWORD);
  const proofDir = mkdtempSync(join(tmpdir(), "withdrawal-proofs-"));
  const tipsImageDir = mkdtempSync(join(tmpdir(), "tips-images-"));

  const app = createServer(
    resolver,
    logStore,
    ledgerStore,
    async () => {},
    50_000,
    adminSessionStore,
    ORDER_CONFIG,
    proofDir,
    adminLoginRateLimiter,
    "http://localhost:3002",
    async () => {},
    undefined, // notifyZaloGroup
    true, // orderImageEnabled
    undefined, // syncZaloGroupMembers
    undefined, // syncTiktokOrders
    tipsImageDir
  );
  const httpServer = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

  function cleanup() {
    httpServer.close();
    rateLimiter.stop();
    adminLoginRateLimiter.stop();
    logStore.close();
    ledgerStore.close();
    rmSync(proofDir, { recursive: true, force: true });
    rmSync(tipsImageDir, { recursive: true, force: true });
  }
  return { ledgerStore, baseUrl, tipsImageDir, cleanup };
}

async function login(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `password=${encodeURIComponent(ADMIN_PASSWORD)}`,
    redirect: "manual",
  });
  const cookie = res.headers.get("set-cookie");
  assert.ok(cookie, "dang nhap phai tra cookie");
  return cookie.split(";")[0];
}

function tipForm(
  fields: Record<string, string>,
  image?: { bytes: Uint8Array; type: string; name: string }
): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.append(key, value);
  if (image) formData.append("image", new Blob([image.bytes], { type: image.type }), image.name);
  return formData;
}

function post(baseUrl: string, path: string, cookie: string | null, body: FormData | URLSearchParams) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: cookie ? { cookie } : {},
    body,
    redirect: "manual",
  });
}

test("chua dang nhap: moi route /admin/tips* redirect ve /admin/login", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const get = await fetch(`${baseUrl}/admin/tips`, { redirect: "manual" });
    assert.equal(get.status, 303);
    assert.equal(get.headers.get("location"), "/admin/login");
    for (const path of ["/admin/tips", "/admin/tips/1", "/admin/tips/1/active", "/admin/tips/1/delete"]) {
      const res = await post(baseUrl, path, null, new URLSearchParams());
      assert.equal(res.status, 303, path);
      assert.equal(res.headers.get("location"), "/admin/login", path);
    }
  } finally {
    cleanup();
  }
});

test("GET /admin/tips: 200, co muc Tips trong menu va trang thai rong", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    const res = await fetch(`${baseUrl}/admin/tips`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /href="\/admin\/tips"/);
    assert.match(html, /Chưa có Tip nào/);
  } finally {
    cleanup();
  }
});

test("tao Tip co anh PNG: 303, ghi DB, file nam trong TIPS_IMAGE_DIR voi duoi .png", async () => {
  const { baseUrl, ledgerStore, tipsImageDir, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    const res = await post(
      baseUrl,
      "/admin/tips",
      cookie,
      tipForm({ title: "Meo 1", description: "Noi dung" }, { bytes: PNG, type: "image/png", name: "x.png" })
    );
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/admin/tips");
    const [created] = ledgerStore.listTips();
    assert.equal(created.title, "Meo 1");
    assert.match(created.imagePath ?? "", /\.png$/);
    assert.equal(existsSync(join(tipsImageDir, created.imagePath as string)), true);
  } finally {
    cleanup();
  }
});

test("tao Tip khong anh: duoc", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    const res = await post(baseUrl, "/admin/tips", cookie, tipForm({ title: "Chi co chu", description: "" }));
    assert.equal(res.status, 303);
    assert.equal(ledgerStore.listTips()[0].imagePath, null);
  } finally {
    cleanup();
  }
});

test("tao Tip: file GIA MAO (mimetype image/png nhung noi dung la chu) -> 422, khong ghi DB, khong ghi file", async () => {
  const { baseUrl, ledgerStore, tipsImageDir, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    const fake = new TextEncoder().encode("day khong phai anh");
    const res = await post(
      baseUrl,
      "/admin/tips",
      cookie,
      tipForm({ title: "Gia mao", description: "mo ta giu lai" }, { bytes: fake, type: "image/png", name: "fake.png" })
    );
    assert.equal(res.status, 422);
    const html = await res.text();
    assert.match(html, /Ảnh phải là JPG, PNG hoặc WebP/);
    assert.match(html, /value="Gia mao"/); // giu nguyen chu da go
    assert.match(html, />mo ta giu lai<\/textarea>/);
    assert.equal(ledgerStore.listTips().length, 0);
    assert.deepEqual(existsSync(tipsImageDir) ? readdirSync(tipsImageDir) : [], []);
  } finally {
    cleanup();
  }
});

test("tao Tip: SVG bi tu choi", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const res = await post(
      baseUrl,
      "/admin/tips",
      cookie,
      tipForm({ title: "SVG", description: "" }, { bytes: svg, type: "image/svg+xml", name: "a.svg" })
    );
    assert.equal(res.status, 422);
    assert.equal(ledgerStore.listTips().length, 0);
  } finally {
    cleanup();
  }
});

test("tao Tip: anh > 5MB -> 422 voi thong bao ro, khong ghi gi", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG);
    const res = await post(
      baseUrl,
      "/admin/tips",
      cookie,
      tipForm({ title: "Anh to", description: "" }, { bytes: big, type: "image/png", name: "big.png" })
    );
    assert.equal(res.status, 422);
    assert.match(await res.text(), /Ảnh quá lớn, tối đa 5MB/);
    assert.equal(ledgerStore.listTips().length, 0);
  } finally {
    cleanup();
  }
});

test("tao Tip: tieu de rong -> 422 va giu nguyen mo ta da go", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    const res = await post(baseUrl, "/admin/tips", cookie, tipForm({ title: "  ", description: "mo ta dai" }));
    assert.equal(res.status, 422);
    const html = await res.text();
    assert.match(html, /Tiêu đề không được để trống/);
    assert.match(html, />mo ta dai<\/textarea>/);
    assert.equal(ledgerStore.listTips().length, 0);
  } finally {
    cleanup();
  }
});

test("sua Tip: doi chu va GIU anh khi khong chon gi", async () => {
  const { baseUrl, ledgerStore, tipsImageDir, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    await post(
      baseUrl,
      "/admin/tips",
      cookie,
      tipForm({ title: "Cu", description: "" }, { bytes: PNG, type: "image/png", name: "a.png" })
    );
    const created = ledgerStore.listTips()[0];
    const res = await post(
      baseUrl,
      `/admin/tips/${created.id}`,
      cookie,
      tipForm({ title: "Moi", description: "mo ta moi", imageAction: "keep" })
    );
    assert.equal(res.status, 303);
    const after = ledgerStore.getTipById(created.id);
    assert.equal(after?.title, "Moi");
    assert.equal(after?.imagePath, created.imagePath);
    assert.equal(existsSync(join(tipsImageDir, created.imagePath as string)), true);
  } finally {
    cleanup();
  }
});

test("sua Tip: thay anh -> file cu bi xoa, file moi ton tai", async () => {
  const { baseUrl, ledgerStore, tipsImageDir, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    await post(
      baseUrl,
      "/admin/tips",
      cookie,
      tipForm({ title: "T", description: "" }, { bytes: PNG, type: "image/png", name: "a.png" })
    );
    const created = ledgerStore.listTips()[0];
    const oldFile = created.imagePath as string;
    const res = await post(
      baseUrl,
      `/admin/tips/${created.id}`,
      cookie,
      tipForm({ title: "T", description: "", imageAction: "replace" }, { bytes: JPEG, type: "image/jpeg", name: "b.jpg" })
    );
    assert.equal(res.status, 303);
    const after = ledgerStore.getTipById(created.id);
    assert.match(after?.imagePath ?? "", /\.jpg$/);
    assert.equal(existsSync(join(tipsImageDir, oldFile)), false);
    assert.equal(existsSync(join(tipsImageDir, after?.imagePath as string)), true);
  } finally {
    cleanup();
  }
});

test("sua Tip: chon file nhung radio van de 'keep' -> van coi la thay anh (khong bo qua im lang)", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    await post(baseUrl, "/admin/tips", cookie, tipForm({ title: "T", description: "" }));
    const created = ledgerStore.listTips()[0];
    const res = await post(
      baseUrl,
      `/admin/tips/${created.id}`,
      cookie,
      tipForm({ title: "T", description: "", imageAction: "keep" }, { bytes: PNG, type: "image/png", name: "a.png" })
    );
    assert.equal(res.status, 303);
    assert.match(ledgerStore.getTipById(created.id)?.imagePath ?? "", /\.png$/);
  } finally {
    cleanup();
  }
});

test("sua Tip: bo anh -> imagePath null va file bi xoa", async () => {
  const { baseUrl, ledgerStore, tipsImageDir, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    await post(
      baseUrl,
      "/admin/tips",
      cookie,
      tipForm({ title: "T", description: "" }, { bytes: PNG, type: "image/png", name: "a.png" })
    );
    const created = ledgerStore.listTips()[0];
    const res = await post(
      baseUrl,
      `/admin/tips/${created.id}`,
      cookie,
      tipForm({ title: "T", description: "", imageAction: "remove" })
    );
    assert.equal(res.status, 303);
    assert.equal(ledgerStore.getTipById(created.id)?.imagePath, null);
    assert.equal(existsSync(join(tipsImageDir, created.imagePath as string)), false);
  } finally {
    cleanup();
  }
});

test("sua Tip: 'replace' ma khong co file -> 422, giu nguyen anh cu", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    await post(
      baseUrl,
      "/admin/tips",
      cookie,
      tipForm({ title: "T", description: "" }, { bytes: PNG, type: "image/png", name: "a.png" })
    );
    const created = ledgerStore.listTips()[0];
    const res = await post(
      baseUrl,
      `/admin/tips/${created.id}`,
      cookie,
      tipForm({ title: "T", description: "", imageAction: "replace" })
    );
    assert.equal(res.status, 422);
    assert.equal(ledgerStore.getTipById(created.id)?.imagePath, created.imagePath);
  } finally {
    cleanup();
  }
});

test("sua Tip: tieu de rong -> 422, file anh moi vua upload KHONG bi bo mo coi", async () => {
  const { baseUrl, ledgerStore, tipsImageDir, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    await post(baseUrl, "/admin/tips", cookie, tipForm({ title: "T", description: "" }));
    const created = ledgerStore.listTips()[0];
    const res = await post(
      baseUrl,
      `/admin/tips/${created.id}`,
      cookie,
      tipForm({ title: " ", description: "" }, { bytes: PNG, type: "image/png", name: "a.png" })
    );
    assert.equal(res.status, 422);
    assert.deepEqual(existsSync(tipsImageDir) ? readdirSync(tipsImageDir) : [], []);
  } finally {
    cleanup();
  }
});

test("sua Tip khong ton tai -> 404", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    const res = await post(baseUrl, "/admin/tips/9999", cookie, tipForm({ title: "T", description: "" }));
    assert.equal(res.status, 404);
  } finally {
    cleanup();
  }
});

test("tat / bat Tip qua POST /admin/tips/:id/active", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    await post(baseUrl, "/admin/tips", cookie, tipForm({ title: "T", description: "" }));
    const id = ledgerStore.listTips()[0].id;

    const off = await post(baseUrl, `/admin/tips/${id}/active`, cookie, new URLSearchParams({ active: "0" }));
    assert.equal(off.status, 303);
    assert.equal(ledgerStore.getTipById(id)?.isActive, false);

    const on = await post(baseUrl, `/admin/tips/${id}/active`, cookie, new URLSearchParams({ active: "1" }));
    assert.equal(on.status, 303);
    assert.equal(ledgerStore.getTipById(id)?.isActive, true);

    const missing = await post(baseUrl, "/admin/tips/9999/active", cookie, new URLSearchParams({ active: "0" }));
    assert.equal(missing.status, 404);
  } finally {
    cleanup();
  }
});

test("xoa Tip: xoa ban ghi VA file anh; id khong co -> 404", async () => {
  const { baseUrl, ledgerStore, tipsImageDir, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    await post(
      baseUrl,
      "/admin/tips",
      cookie,
      tipForm({ title: "T", description: "" }, { bytes: PNG, type: "image/png", name: "a.png" })
    );
    const created = ledgerStore.listTips()[0];
    const res = await post(baseUrl, `/admin/tips/${created.id}/delete`, cookie, new URLSearchParams());
    assert.equal(res.status, 303);
    assert.equal(ledgerStore.listTips().length, 0);
    assert.equal(existsSync(join(tipsImageDir, created.imagePath as string)), false);

    const again = await post(baseUrl, `/admin/tips/${created.id}/delete`, cookie, new URLSearchParams());
    assert.equal(again.status, 404);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 3: Chạy test, xác nhận FAIL**

Run: `npx tsx --test src/api/__tests__/adminTipsHtml.test.ts src/api/__tests__/tipsRoutes.test.ts`
Expected: FAIL (thiếu module `../adminTipsHtml.js`; route chưa có).

- [ ] **Step 4: Thêm icon + mục menu vào `adminHtml.ts`**

Trong `ICON_PATHS` (cạnh `bell`), thêm:

```ts
  lightbulb:
    '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
```

Trong `NAV_ITEMS`, thêm trước mục `settings`:

```ts
  { key: "tips", href: "/admin/tips", label: "Tips", icon: "lightbulb" },
```

- [ ] **Step 5: Viết `src/api/tipsAdminScript.ts` (bản đầu)**

```ts
/**
 * JS client cua trang /admin/tips (2026-10-14), dang chuoi de test duoc bang node:vm (xem
 * tipsAdminScript.test.ts) - giong cach cac script khac cua /admin. KHONG chua the <script>, KHONG chua
 * backtick hay "${" de nhung an toan vao template string.
 *
 * Task nay chi co handler dong <details> (nut "Huy" cua khoi xoa + nut dong form); phan keo-tha them o buoc sau.
 */
export const TIPS_ADMIN_SCRIPT = `
(function () {
  document.addEventListener("click", function (event) {
    var target = event.target;
    var closer = target && target.closest ? target.closest("[data-close-details]") : null;
    if (!closer) return;
    var details = closer.closest("details");
    if (details) details.removeAttribute("open");
  });
})();
`;
```

- [ ] **Step 6: Viết `src/api/adminTipsHtml.ts`**

```ts
import { TIP_DESCRIPTION_MAX_LENGTH, TIP_TITLE_MAX_LENGTH } from "../core/ledgerStore.js";
import type { Tip } from "../core/types.js";
import { FIELD_CLASS, FIELD_LABEL_CLASS } from "./adminHtml.js";
import { escapeHtml } from "./htmlHelpers.js";
import { TIPS_ADMIN_SCRIPT } from "./tipsAdminScript.js";

/**
 * Trang /admin/tips (2026-10-14): THAN trang, server tu boc adminShell. Xem spec
 * docs/superpowers/specs/2026-10-14-tips-slide-design.md muc 5.
 *
 * Rang buoc Tailwind khong-preflight (xem .claude/rules/admin-ui-nen-tang.md): <button> tu reset
 * vien/nen (border-0 / border + bg-*), style keo-tha la class that trong admin.css (.tip-*).
 */

export interface TipsAdminDraft {
  /** null = form "Them Tip"; so = form sua cua Tip do. */
  id: number | null;
  title: string;
  description: string;
}

const BTN_BASE =
  "inline-flex cursor-pointer items-center rounded-lg px-3.5 py-2 text-sm font-semibold transition";
const BTN_PRIMARY = `${BTN_BASE} border-0 bg-indigo-600 text-white hover:bg-indigo-700`;
const BTN_SECONDARY = `${BTN_BASE} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;
const BTN_DANGER = `${BTN_BASE} border-0 bg-rose-600 text-white hover:bg-rose-700`;
const SUMMARY_BTN = `${BTN_BASE} list-none border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;

const IMAGE_HINT = "Ảnh ngang, khoảng 1000px là đủ. JPG / PNG / WebP, tối đa 5MB.";

function imageUrl(imagePath: string): string {
  return `/tips/images/${encodeURIComponent(imagePath)}`;
}

function titleInput(value: string): string {
  return `<input type="text" name="title" required maxlength="${TIP_TITLE_MAX_LENGTH}" value="${escapeHtml(value)}" class="${FIELD_CLASS}">`;
}

function descriptionInput(value: string): string {
  return `<textarea name="description" rows="4" maxlength="${TIP_DESCRIPTION_MAX_LENGTH}" class="${FIELD_CLASS}">${escapeHtml(value)}</textarea>`;
}

function imageFileInput(): string {
  return `<input type="file" name="image" accept="image/jpeg,image/png,image/webp" class="block w-full text-sm text-slate-600">`;
}

function createForm(draft: TipsAdminDraft | undefined): string {
  const mine = draft !== undefined && draft.id === null ? draft : undefined;
  return `<details id="tip-create" class="details-plain rounded-xl border border-slate-200 bg-white p-4"${mine ? " open" : ""}>
  <summary class="${SUMMARY_BTN}">＋ Thêm Tip</summary>
  <form method="post" action="/admin/tips" enctype="multipart/form-data" class="mt-4 space-y-4">
    <div><label class="${FIELD_LABEL_CLASS}">Tiêu đề</label>${titleInput(mine?.title ?? "")}</div>
    <div><label class="${FIELD_LABEL_CLASS}">Mô tả</label>${descriptionInput(mine?.description ?? "")}</div>
    <div><label class="${FIELD_LABEL_CLASS}">Ảnh (không bắt buộc)</label>${imageFileInput()}
      <p class="mt-1 text-xs text-slate-400">${IMAGE_HINT}</p></div>
    <div class="flex gap-2"><button type="submit" class="${BTN_PRIMARY}">Thêm Tip</button>
      <button type="button" class="${BTN_SECONDARY}" data-close-details>Huỷ</button></div>
  </form>
</details>`;
}

function editForm(tip: Tip, draft: TipsAdminDraft | undefined): string {
  const mine = draft !== undefined && draft.id === tip.id ? draft : undefined;
  const removeOption = tip.imagePath
    ? `<label class="mr-4 inline-flex items-center gap-1.5 text-sm"><input type="radio" name="imageAction" value="remove"> Bỏ ảnh</label>`
    : "";
  const replaceLabel = tip.imagePath ? "Thay ảnh" : "Thêm ảnh";
  return `<details id="tip-edit-${tip.id}" class="details-plain"${mine ? " open" : ""}>
    <summary class="${SUMMARY_BTN}">Sửa</summary>
    <form method="post" action="/admin/tips/${tip.id}" enctype="multipart/form-data" class="mt-3 space-y-3">
      <div><label class="${FIELD_LABEL_CLASS}">Tiêu đề</label>${titleInput(mine?.title ?? tip.title)}</div>
      <div><label class="${FIELD_LABEL_CLASS}">Mô tả</label>${descriptionInput(mine?.description ?? tip.description)}</div>
      <div>
        <label class="${FIELD_LABEL_CLASS}">Ảnh</label>
        <label class="mr-4 inline-flex items-center gap-1.5 text-sm"><input type="radio" name="imageAction" value="keep" checked> Giữ nguyên</label>
        <label class="mr-4 inline-flex items-center gap-1.5 text-sm"><input type="radio" name="imageAction" value="replace"> ${replaceLabel}</label>
        ${removeOption}
        <div class="mt-2">${imageFileInput()}</div>
        <p class="mt-1 text-xs text-slate-400">${IMAGE_HINT}</p>
      </div>
      <div class="flex gap-2"><button type="submit" class="${BTN_PRIMARY}">Lưu</button>
        <button type="button" class="${BTN_SECONDARY}" data-close-details>Đóng</button></div>
    </form>
  </details>`;
}

function deleteForm(tip: Tip): string {
  return `<details class="details-plain">
    <summary class="${SUMMARY_BTN}">Xoá</summary>
    <form method="post" action="/admin/tips/${tip.id}/delete" class="mt-2 flex flex-wrap items-center gap-2">
      <span class="text-sm text-rose-700">Xoá vĩnh viễn Tip này và ảnh của nó?</span>
      <button type="submit" class="${BTN_DANGER}">Xác nhận xoá</button>
      <button type="button" class="${BTN_SECONDARY}" data-close-details>Huỷ</button>
    </form>
  </details>`;
}

function statusPill(active: boolean): string {
  return active
    ? `<span class="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">Đang hiện</span>`
    : `<span class="inline-flex items-center rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-600">Đã tắt</span>`;
}

function renderTipCard(tip: Tip, draft: TipsAdminDraft | undefined): string {
  const thumb = tip.imagePath
    ? `<img src="${imageUrl(tip.imagePath)}" alt="" draggable="false" loading="lazy" class="h-16 w-24 shrink-0 rounded-lg object-cover">`
    : `<div class="flex h-16 w-24 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">Không ảnh</div>`;
  const toggleLabel = tip.isActive ? "Tắt" : "Bật";
  const toggleValue = tip.isActive ? "0" : "1";
  return `<li class="tip-card rounded-xl border border-slate-200 bg-white p-4${tip.isActive ? "" : " is-inactive"}" data-tip-id="${tip.id}">
  <div class="flex items-start gap-3">
    <span class="tip-handle" draggable="true" role="button" tabindex="0" aria-label="Kéo để đổi thứ tự" title="Kéo để đổi thứ tự">⋮⋮</span>
    ${thumb}
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-2"><span class="font-semibold text-slate-900">${escapeHtml(tip.title)}</span>${statusPill(tip.isActive)}</div>
      <p class="mt-1 whitespace-pre-line text-sm text-slate-500">${escapeHtml(tip.description)}</p>
    </div>
    <form method="post" action="/admin/tips/${tip.id}/active" class="shrink-0">
      <input type="hidden" name="active" value="${toggleValue}">
      <button type="submit" class="${BTN_SECONDARY}">${toggleLabel}</button>
    </form>
  </div>
  <div class="mt-3 space-y-3 border-t border-slate-100 pt-3">
    ${editForm(tip, draft)}
    <div class="flex flex-wrap items-start gap-3">${deleteForm(tip)}
      <span class="pt-2 text-xs text-slate-400">Muốn giữ lại để dùng sau thì <b>Tắt</b>, đừng Xoá.</span></div>
  </div>
</li>`;
}

export function renderAdminTipsPage(input: { tips: Tip[]; errorMessage?: string; draft?: TipsAdminDraft }): string {
  const { tips, errorMessage, draft } = input;
  const activeCount = tips.filter((tip) => tip.isActive).length;
  const banner = errorMessage
    ? `<div class="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">${escapeHtml(errorMessage)}</div>`
    : "";
  const list =
    tips.length === 0
      ? `<div class="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
  Chưa có Tip nào. Bấm “Thêm Tip” để tạo mẹo đầu tiên — user sẽ thấy nút 💡 Tips trên dashboard khi có ít nhất 1 Tip đang bật.
</div>`
      : `<ul id="tips-list" class="tip-list space-y-3">
${tips.map((tip) => renderTipCard(tip, draft)).join("\n")}
</ul>`;
  return `<div class="space-y-4">
  <p class="text-sm text-slate-500">${tips.length} Tip, ${activeCount} đang hiện. Kéo tay nắm ⋮⋮ để đổi thứ tự — đây cũng là thứ tự slide bên user.</p>
  ${banner}
  <div id="tips-order-error" role="alert" class="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" style="display:none"></div>
  ${createForm(draft)}
  ${list}
</div>
<script>${TIPS_ADMIN_SCRIPT}</script>`;
}
```

- [ ] **Step 7: Viết `src/api/tipsRoutes.ts` (route admin)**

```ts
import multer from "multer";
import type { Express, Request, RequestHandler, Response, NextFunction } from "express";
import type { LedgerStore } from "../core/ledgerStore.js";
import { AppError, InvalidTipError } from "../core/errors.js";
import { TIP_IMAGE_MAX_BYTES, deleteTipImage, saveTipImage } from "../core/tipImage.js";
import { adminShell } from "./adminHtml.js";
import { renderAdminTipsPage } from "./adminTipsHtml.js";

/**
 * Route cua Tips (2026-10-14), tach khoi server.ts (da qua dai). Xem
 * docs/superpowers/specs/2026-10-14-tips-slide-design.md muc 4, 5 va 7.
 */

export interface TipsRoutesDeps {
  ledgerStore: LedgerStore;
  tipsImageDir: string;
  /** Redirect ve /admin/login neu chua dang nhap (dung cho route tra HTML). */
  requireAdminAuth: RequestHandler;
  /** Chi hoi co dang nhap hay khong (dung cho route JSON, de tu tra 401 thay vi redirect). */
  isAdminSession: (req: Request) => boolean;
  navPendingWithdrawals: () => number;
}

// 5MB la TRAN cua tung anh; file qua gioi han bi multer chan (LIMIT_FILE_SIZE) va doi thanh thong bao 422 ben duoi.
const tipUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: TIP_IMAGE_MAX_BYTES } });

/**
 * Boc multer de loi (qua dung luong...) KHONG roi xuong error handler chung (tra JSON 500) ma thanh thong bao
 * hien tren trang: luu vao res.locals, route doc lai va tra 422 kem chu admin da go.
 */
function parseTipForm(req: Request, res: Response, next: NextFunction): void {
  tipUpload.single("image")(req, res, (err: unknown) => {
    if (err) {
      res.locals.tipUploadError =
        err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
          ? "Ảnh quá lớn, tối đa 5MB."
          : "Không đọc được file tải lên, hãy thử lại.";
    }
    next();
  });
}

function failOnUploadError(res: Response): void {
  if (typeof res.locals.tipUploadError === "string") throw new InvalidTipError(res.locals.tipUploadError);
}

function parseTipId(raw: string): number | null {
  return /^[0-9]+$/.test(raw) ? Number(raw) : null;
}

function userMessageOf(err: unknown): string {
  if (err instanceof AppError) return err.userMessage;
  console.error("[tips] loi khong xac dinh:", err);
  return "Lỗi không xác định, vui lòng thử lại sau.";
}

export function registerTipsRoutes(app: Express, deps: TipsRoutesDeps): void {
  const { ledgerStore, tipsImageDir, requireAdminAuth, navPendingWithdrawals } = deps;

  function sendPage(res: Response, status: number, extra: { errorMessage?: string; draft?: { id: number | null; title: string; description: string } } = {}): void {
    res
      .status(status)
      .type("html")
      .send(adminShell("tips", "Tips", renderAdminTipsPage({ tips: ledgerStore.listTips(), ...extra }), navPendingWithdrawals()));
  }

  function readFields(req: Request): { title: string; description: string } {
    return {
      title: typeof req.body?.title === "string" ? req.body.title : "",
      description: typeof req.body?.description === "string" ? req.body.description : "",
    };
  }

  app.get("/admin/tips", requireAdminAuth, (_req: Request, res: Response) => {
    sendPage(res, 200);
  });

  app.post("/admin/tips", requireAdminAuth, parseTipForm, (req: Request, res: Response) => {
    const fields = readFields(req);
    let savedImage: string | null = null;
    try {
      failOnUploadError(res);
      if (req.file) savedImage = saveTipImage(tipsImageDir, req.file.buffer);
      ledgerStore.createTip({ ...fields, imagePath: savedImage });
      res.redirect(303, "/admin/tips");
    } catch (err) {
      // DB khong ghi duoc thi khong de file vua luu thanh file mo coi.
      deleteTipImage(tipsImageDir, savedImage);
      sendPage(res, 422, { errorMessage: userMessageOf(err), draft: { id: null, ...fields } });
    }
  });

  app.post("/admin/tips/:id", requireAdminAuth, parseTipForm, (req: Request, res: Response) => {
    const id = parseTipId(req.params.id);
    if (id === null || ledgerStore.getTipById(id) === null) {
      sendPage(res, 404, { errorMessage: "Không tìm thấy Tip này (có thể đã bị xoá)." });
      return;
    }
    const fields = readFields(req);
    const action = typeof req.body?.imageAction === "string" ? req.body.imageAction : "keep";
    let savedImage: string | null = null;
    try {
      failOnUploadError(res);
      // Co file va khong phai "bo anh" -> thay anh, ke ca khi radio van de "Giu nguyen": chon file xong ma bi bo qua im lang la bay.
      let nextImage: string | null | undefined = undefined;
      if (req.file && action !== "remove") {
        savedImage = saveTipImage(tipsImageDir, req.file.buffer);
        nextImage = savedImage;
      } else if (action === "replace") {
        throw new InvalidTipError("Bạn chọn “Thay ảnh” nhưng chưa chọn file ảnh nào.");
      } else if (action === "remove") {
        nextImage = null;
      }
      const result = ledgerStore.updateTip(id, { ...fields, imagePath: nextImage });
      if (result === null) {
        deleteTipImage(tipsImageDir, savedImage);
        sendPage(res, 404, { errorMessage: "Không tìm thấy Tip này (có thể đã bị xoá)." });
        return;
      }
      // Chi xoa file cu SAU khi DB da ghi xong.
      if (nextImage !== undefined) deleteTipImage(tipsImageDir, result.previousImagePath);
      res.redirect(303, "/admin/tips");
    } catch (err) {
      deleteTipImage(tipsImageDir, savedImage);
      sendPage(res, 422, { errorMessage: userMessageOf(err), draft: { id, ...fields } });
    }
  });

  app.post("/admin/tips/:id/active", requireAdminAuth, (req: Request, res: Response) => {
    const id = parseTipId(req.params.id);
    const active = req.body?.active === "1";
    if (id === null || !ledgerStore.setTipActive(id, active)) {
      sendPage(res, 404, { errorMessage: "Không tìm thấy Tip này (có thể đã bị xoá)." });
      return;
    }
    res.redirect(303, "/admin/tips");
  });

  app.post("/admin/tips/:id/delete", requireAdminAuth, (req: Request, res: Response) => {
    const id = parseTipId(req.params.id);
    const removed = id === null ? null : ledgerStore.deleteTip(id);
    if (removed === null) {
      sendPage(res, 404, { errorMessage: "Không tìm thấy Tip này (có thể đã bị xoá)." });
      return;
    }
    deleteTipImage(tipsImageDir, removed.imagePath);
    res.redirect(303, "/admin/tips");
  });
}
```

- [ ] **Step 8: Nối vào `server.ts` và `index.ts`**

Trong `src/api/server.ts`:

1. Sau dòng `import { renderHandbookPage } from "./handbookHtml.js";` thêm:
   ```ts
   import { registerTipsRoutes } from "./tipsRoutes.js";
   ```
2. Thêm tham số CUỐI của `createServer` — thay
   ```ts
     syncTiktokOrders?: () => Promise<RiohubOrderRecord[]>
   ) {
     const app = express();
   ```
   bằng
   ```ts
     syncTiktokOrders?: () => Promise<RiohubOrderRecord[]>,
     /**
      * Thu muc luu anh cua Tips (2026-10-14, env TIPS_IMAGE_DIR). Tham so CUOI co mac dinh de cac cho goi cu
      * (test) khong phai sua.
      */
     tipsImageDir = "./data/tips-images"
   ) {
     const app = express();
   ```
3. Ngay sau hàm `requireAdminAuth` (kết thúc ở `next();\n  }`) thêm:
   ```ts
     /** Chi hoi "da dang nhap admin chua" - dung cho route JSON can tra 401 thay vi redirect. */
     const isAdminSession = (req: Request): boolean =>
       adminSessionStore.isValid(parseCookies(req.headers.cookie)[ADMIN_SESSION_COOKIE]);
   ```
4. Ngay TRƯỚC dòng `// eslint-disable-next-line @typescript-eslint/no-unused-vars` đứng trước `app.use((err: unknown, _req: Request, ...` (error handler cuối file) thêm:
   ```ts
     registerTipsRoutes(app, {
       ledgerStore,
       tipsImageDir,
       requireAdminAuth,
       isAdminSession,
       navPendingWithdrawals,
     });

   ```

Trong `src/index.ts`, thay đoạn
```ts
  syncZaloGroupMembers,
  syncTiktokOrders
);
```
bằng
```ts
  syncZaloGroupMembers,
  syncTiktokOrders,
  env.tips.imageDir
);
```

- [ ] **Step 9: Chạy test + typecheck, xác nhận PASS**

Run: `npx tsx --test src/api/__tests__/adminTipsHtml.test.ts src/api/__tests__/tipsRoutes.test.ts && npm run typecheck`
Expected: PASS hết, typecheck sạch.
Nếu một test cũ kiểm tra số mục menu admin bị đỏ: sửa kỳ vọng thêm mục "Tips" (chỉ test đó).

- [ ] **Step 10: Chạy test admin cũ để chắc không vỡ**

Run: `npx tsx --test src/api/__tests__/adminRoutes.test.ts`
Expected: PASS (menu thêm một mục không được làm vỡ gì).

- [ ] **Step 11: Commit** (khi được phép)

```bash
git add src/api/adminTipsHtml.ts src/api/tipsAdminScript.ts src/api/tipsRoutes.ts src/api/adminHtml.ts src/api/server.ts src/index.ts src/api/__tests__/adminTipsHtml.test.ts src/api/__tests__/tipsRoutes.test.ts
git commit -m "feat(admin): trang /admin/tips - them/sua/tat-bat/xoa Tips, anh upload kiem tra chu ky" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Kéo-thả sắp xếp + `POST /admin/tips/reorder`

**Files:**
- Modify: `src/api/tipsAdminScript.ts` (thêm `computeDropIndex`, `restoreOrder`, wiring kéo-thả)
- Modify: `src/api/tipsRoutes.ts` (route `reorder`, **khai báo trước** `POST /admin/tips/:id`)
- Modify: `src/api/styles/admin.css` (class `.tip-*` trong `@layer components`)
- Test: `src/api/__tests__/tipsAdminScript.test.ts` (mới); mở rộng `src/api/__tests__/tipsRoutes.test.ts`

**Interfaces:**
- Consumes: `LedgerStore.reorderTips`, `InvalidTipError`/`AppError`, `deps.isAdminSession`, `TIPS_ADMIN_SCRIPT` (Task 3), markup `ul#tips-list > li.tip-card[data-tip-id] > … span.tip-handle[draggable]` và `#tips-order-error` (Task 3).
- Produces: `POST /admin/tips/reorder` body JSON `{"ids": number[]}` → `200 {ok:true}` | `401 {ok:false,message}` | `422 {ok:false,message}`. Hàm toàn cục trong script: `computeDropIndex(midpoints: number[], clientY: number): number`, `restoreOrder(list, cardsById, ids): void`.

- [ ] **Step 1: Viết test route `reorder` (fail)**

Thêm vào CUỐI `src/api/__tests__/tipsRoutes.test.ts`:

```ts
async function reorder(baseUrl: string, cookie: string | null, body: unknown) {
  const res = await fetch(`${baseUrl}/admin/tips/reorder`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  return { status: res.status, json: (await res.json()) as { ok: boolean; message?: string } };
}

function seedThree(store: LedgerStore): number[] {
  return ["A", "B", "C"].map((title) => store.createTip({ title, description: "", imagePath: null }).id);
}

test("reorder chua dang nhap -> JSON 401 (KHONG redirect ve trang login)", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const { status, json } = await reorder(baseUrl, null, { ids: [] });
    assert.equal(status, 401);
    assert.equal(json.ok, false);
  } finally {
    cleanup();
  }
});

test("reorder: hoan vi dung -> 200 va thu tu moi duoc luu", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    const [a, b, c] = seedThree(ledgerStore);
    const { status, json } = await reorder(baseUrl, cookie, { ids: [c, a, b] });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.deepEqual(ledgerStore.listTips().map((tip) => tip.title), ["C", "A", "B"]);
  } finally {
    cleanup();
  }
});

test("reorder: thieu / thua / trung / sai kieu -> 422 va DB khong doi", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    const [a, b, c] = seedThree(ledgerStore);
    for (const ids of [[a, b], [a, b, c, 9999], [a, a, b], ["x", "y", "z"], "khong phai mang"]) {
      const { status, json } = await reorder(baseUrl, cookie, { ids });
      assert.equal(status, 422, JSON.stringify(ids));
      assert.equal(json.ok, false);
    }
    assert.deepEqual(ledgerStore.listTips().map((tip) => tip.title), ["A", "B", "C"]);
  } finally {
    cleanup();
  }
});

test("reorder: khong bi hieu nham la mot :id cua POST /admin/tips/:id (thu tu khai bao route)", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    const [a, b, c] = seedThree(ledgerStore);
    const { status } = await reorder(baseUrl, cookie, { ids: [b, c, a] });
    assert.equal(status, 200); // neu bi /:id nuot thi se ra 404 voi trang HTML (json() se nem loi)
  } finally {
    cleanup();
  }
});
```

Thêm import `import type { LedgerStore as LedgerStoreType } ...` KHÔNG cần: `LedgerStore` đã import ở đầu file dưới dạng giá trị, dùng được làm kiểu.

- [ ] **Step 2: Viết test script (fail)**

Tạo `src/api/__tests__/tipsAdminScript.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { TIPS_ADMIN_SCRIPT } from "../tipsAdminScript.js";

/**
 * Script keo-tha cua /admin/tips chay tren DOM gia (khong co CSS that, khong co drag that cua trinh duyet).
 * Test nay chot LOGIC: tinh cho chen, danh sach id theo thu tu DOM, hoan tac khi luu loi. Cam giac keo bang
 * chuot that phai kiem tra tay tren trinh duyet.
 */

interface FakeNode {
  parentNode: FakeList | null;
  getAttribute(name: string): string | null;
}

class FakeList {
  children: FakeNode[] = [];
  handlers: Record<string, (event: unknown) => void> = {};
  addEventListener(type: string, fn: (event: unknown) => void) {
    this.handlers[type] = fn;
  }
  querySelectorAll(): FakeNode[] {
    return this.children.filter((node) => node.getAttribute("data-tip-id") !== null);
  }
  insertBefore(node: FakeNode, ref: FakeNode | null): FakeNode {
    this.detach(node);
    const at = ref === null ? this.children.length : this.children.indexOf(ref);
    this.children.splice(at, 0, node);
    node.parentNode = this;
    return node;
  }
  appendChild(node: FakeNode): FakeNode {
    return this.insertBefore(node, null);
  }
  removeChild(node: FakeNode): void {
    this.detach(node);
    node.parentNode = null;
  }
  private detach(node: FakeNode) {
    const index = this.children.indexOf(node);
    if (index !== -1) this.children.splice(index, 1);
  }
}

interface FakeCard extends FakeNode {
  id: number;
  classes: Set<string>;
  classList: { add(name: string): void; remove(name: string): void };
  getBoundingClientRect(): { top: number; height: number };
  closest(selector: string): FakeCard | null;
}

function makeCard(id: number, top: number): { card: FakeCard; handle: { closest(selector: string): unknown } } {
  const classes = new Set<string>();
  const card: FakeCard = {
    id,
    classes,
    parentNode: null,
    getAttribute: (name) => (name === "data-tip-id" ? String(id) : null),
    getBoundingClientRect: () => ({ top, height: 100 }),
    classList: {
      add: (name) => void classes.add(name),
      remove: (name) => void classes.delete(name),
    },
    closest: (selector) => (selector === "[data-tip-id]" ? card : null),
  };
  const handle = {
    closest: (selector: string): unknown => (selector === ".tip-handle" ? handle : selector === "[data-tip-id]" ? card : null),
  };
  return { card, handle };
}

function makeLine(): FakeNode & { className: string; setAttribute(name: string, value: string): void } {
  return { parentNode: null, className: "", getAttribute: () => null, setAttribute: () => {} };
}

function dragEvent(target: unknown, clientY = 0) {
  return {
    target,
    clientY,
    dataTransfer: { effectAllowed: "", dropEffect: "", setData() {}, setDragImage() {} },
    preventDefault() {},
  };
}

interface Harness {
  list: FakeList;
  cards: FakeCard[];
  handles: Array<{ closest(selector: string): unknown }>;
  fetchCalls: Array<{ url: string; init: { body: string; method: string } }>;
  errorBox: { textContent: string; style: { display: string } };
  clickHandlers: Array<(event: unknown) => void>;
  ids(): number[];
}

function mount(fetchImpl: (url: string, init: { body: string; method: string }) => Promise<unknown>): Harness {
  const list = new FakeList();
  const made = [makeCard(1, 0), makeCard(2, 100), makeCard(3, 200)];
  for (const { card } of made) list.appendChild(card);
  const errorBox = { textContent: "", style: { display: "none" } };
  const fetchCalls: Harness["fetchCalls"] = [];
  const clickHandlers: Array<(event: unknown) => void> = [];
  const document = {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      if (type === "click") clickHandlers.push(fn);
    },
    getElementById: (id: string) => (id === "tips-list" ? list : id === "tips-order-error" ? errorBox : null),
    createElement: () => makeLine(),
  };
  runInNewContext(TIPS_ADMIN_SCRIPT, {
    document,
    setTimeout: (fn: () => void) => fn(),
    fetch: (url: string, init: { body: string; method: string }) => {
      fetchCalls.push({ url, init });
      return fetchImpl(url, init);
    },
  });
  const cards = made.map((entry) => entry.card);
  return {
    list,
    cards,
    handles: made.map((entry) => entry.handle),
    fetchCalls,
    errorBox,
    clickHandlers,
    ids: () => list.querySelectorAll().map((node) => Number(node.getAttribute("data-tip-id"))),
  };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function pure() {
  const context: Record<string, unknown> = {
    document: { addEventListener() {}, getElementById: () => null },
  };
  runInNewContext(TIPS_ADMIN_SCRIPT, context);
  return context as {
    computeDropIndex(midpoints: number[], clientY: number): number;
  };
}

test("computeDropIndex: dem so the co diem giua nam TREN con tro", () => {
  const { computeDropIndex } = pure();
  assert.equal(computeDropIndex([], 10), 0);
  assert.equal(computeDropIndex([50, 150, 250], 10), 0);
  assert.equal(computeDropIndex([50, 150, 250], 100), 1);
  assert.equal(computeDropIndex([50, 150, 250], 180), 2);
  assert.equal(computeDropIndex([50, 150, 250], 999), 3);
});

test("keo the 1 xuong giua the 2 va 3: DOM doi thu tu, gui dung [2,1,3], khong con duong ke", async () => {
  const h = mount(async () => ({ ok: true, json: async () => ({ ok: true }) }));
  h.list.handlers.dragstart(dragEvent(h.handles[0]));
  h.list.handlers.dragover(dragEvent(h.cards[1], 180)); // giua the 2 (mid 150) va the 3 (mid 250)
  h.list.handlers.drop(dragEvent(h.cards[1], 180));
  h.list.handlers.dragend(dragEvent(h.handles[0]));
  await settle();

  assert.deepEqual(h.ids(), [2, 1, 3]);
  assert.equal(h.fetchCalls.length, 1);
  assert.equal(h.fetchCalls[0].url, "/admin/tips/reorder");
  assert.equal(h.fetchCalls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(h.fetchCalls[0].init.body), { ids: [2, 1, 3] });
  assert.equal(h.list.children.length, 3); // duong ke chi cho da bi go
  assert.equal(h.errorBox.style.display, "none");
  assert.equal(h.cards[0].classes.has("is-dragging"), false);
});

test("tha lai dung cho cu: KHONG goi luu", async () => {
  const h = mount(async () => ({ ok: true, json: async () => ({ ok: true }) }));
  h.list.handlers.dragstart(dragEvent(h.handles[1]));
  h.list.handlers.dragover(dragEvent(h.cards[0], 120)); // van trong vung cua chinh the 2
  h.list.handlers.drop(dragEvent(h.cards[0], 120));
  await settle();
  assert.deepEqual(h.ids(), [1, 2, 3]);
  assert.equal(h.fetchCalls.length, 0);
});

test("luu LOI (server tra 422): hoan tac DOM ve thu tu cu va hien thong bao", async () => {
  const h = mount(async () => ({
    ok: false,
    json: async () => ({ ok: false, message: "Danh sách Tips đã thay đổi, hãy tải lại trang." }),
  }));
  h.list.handlers.dragstart(dragEvent(h.handles[0]));
  h.list.handlers.dragover(dragEvent(h.cards[2], 999)); // xuong cuoi
  h.list.handlers.drop(dragEvent(h.cards[2], 999));
  assert.deepEqual(h.ids(), [2, 3, 1]); // DOM da doi ngay
  await settle();

  assert.deepEqual(h.ids(), [1, 2, 3]); // da hoan tac
  assert.match(h.errorBox.textContent, /đã thay đổi/);
  assert.equal(h.errorBox.style.display, "block");
});

test("luu LOI do mang (fetch reject): hoan tac + thong bao chung", async () => {
  const h = mount(async () => {
    throw new Error("Failed to fetch");
  });
  h.list.handlers.dragstart(dragEvent(h.handles[0]));
  h.list.handlers.dragover(dragEvent(h.cards[2], 999));
  h.list.handlers.drop(dragEvent(h.cards[2], 999));
  await settle();
  assert.deepEqual(h.ids(), [1, 2, 3]);
  assert.match(h.errorBox.textContent, /Không lưu được thứ tự/);
});

test("luu thanh cong sau mot lan loi: thong bao loi cu duoc an", async () => {
  let fail = true;
  const h = mount(async () =>
    fail ? { ok: false, json: async () => ({ ok: false, message: "loi" }) } : { ok: true, json: async () => ({ ok: true }) }
  );
  h.list.handlers.dragstart(dragEvent(h.handles[0]));
  h.list.handlers.dragover(dragEvent(h.cards[2], 999));
  h.list.handlers.drop(dragEvent(h.cards[2], 999));
  await settle();
  assert.equal(h.errorBox.style.display, "block");

  fail = false;
  h.list.handlers.dragstart(dragEvent(h.handles[0]));
  h.list.handlers.dragover(dragEvent(h.cards[2], 999));
  h.list.handlers.drop(dragEvent(h.cards[2], 999));
  await settle();
  assert.equal(h.errorBox.style.display, "none");
});

test("chi tay nam moi keo duoc: dragstart tu cho khac (vd anh, chu) bi bo qua", async () => {
  const h = mount(async () => ({ ok: true, json: async () => ({ ok: true }) }));
  h.list.handlers.dragstart(dragEvent({ closest: () => null })); // khong phai .tip-handle
  h.list.handlers.dragover(dragEvent(h.cards[2], 999));
  h.list.handlers.drop(dragEvent(h.cards[2], 999));
  await settle();
  assert.deepEqual(h.ids(), [1, 2, 3]);
  assert.equal(h.fetchCalls.length, 0);
});

test("nut [data-close-details] dong <details> cha cua no", () => {
  const h = mount(async () => ({ ok: true, json: async () => ({ ok: true }) }));
  const removed: string[] = [];
  const details = { removeAttribute: (name: string) => removed.push(name) };
  const button = { closest: (selector: string) => (selector === "details" ? details : null) };
  const target = { closest: (selector: string) => (selector === "[data-close-details]" ? button : null) };
  h.clickHandlers[0]({ target });
  assert.deepEqual(removed, ["open"]);

  h.clickHandlers[0]({ target: { closest: () => null } }); // click linh tinh khong lam gi
  assert.deepEqual(removed, ["open"]);
});
```

- [ ] **Step 3: Chạy test, xác nhận FAIL**

Run: `npx tsx --test src/api/__tests__/tipsAdminScript.test.ts src/api/__tests__/tipsRoutes.test.ts`
Expected: FAIL (script chưa có kéo-thả; route `reorder` chưa có → trả HTML/404).

- [ ] **Step 4: Thay `TIPS_ADMIN_SCRIPT` bằng bản đầy đủ**

Thay toàn bộ nội dung `src/api/tipsAdminScript.ts`:

```ts
/**
 * JS client cua trang /admin/tips (2026-10-14), dang chuoi de test duoc bang node:vm (xem
 * tipsAdminScript.test.ts). KHONG chua the <script>, backtick hay "${" de nhung an toan vao template string.
 *
 * Keo-tha dung HTML5 Drag and Drop GOC (khong thu vien): chi TAY NAM `.tip-handle` co draggable, vi the chua
 * <input>/<details>/nut nen keo ca the se lam khong boi chon duoc chu trong o nhap. Tha xong TU LUU qua
 * POST /admin/tips/reorder; luu loi thi tra the ve cho cu va bao loi de man hinh khong lech voi DB.
 * Han che da chap nhan: drag goc khong chay bang cam ung tren dien thoai (admin dung may tinh).
 */
export const TIPS_ADMIN_SCRIPT = `
function computeDropIndex(midpoints, clientY) {
  var index = 0;
  for (var i = 0; i < midpoints.length; i++) {
    if (clientY > midpoints[i]) index = i + 1;
  }
  return index;
}
function restoreOrder(list, cardsById, ids) {
  for (var i = 0; i < ids.length; i++) {
    if (cardsById[ids[i]]) list.appendChild(cardsById[ids[i]]);
  }
}
(function () {
  document.addEventListener("click", function (event) {
    var target = event.target;
    var closer = target && target.closest ? target.closest("[data-close-details]") : null;
    if (!closer) return;
    var details = closer.closest("details");
    if (details) details.removeAttribute("open");
  });

  var list = document.getElementById("tips-list");
  if (!list) return;
  var errorBox = document.getElementById("tips-order-error");
  var dragged = null;
  var previous = [];
  var line = document.createElement("li");
  line.className = "tip-drop-line";
  line.setAttribute("aria-hidden", "true");

  function cards() {
    return Array.prototype.slice.call(list.querySelectorAll("[data-tip-id]"));
  }
  function ids() {
    return cards().map(function (card) { return Number(card.getAttribute("data-tip-id")); });
  }
  function setError(message) {
    if (!errorBox) return;
    errorBox.textContent = message || "";
    errorBox.style.display = message ? "block" : "none";
  }
  function cleanup() {
    if (line.parentNode) line.parentNode.removeChild(line);
    if (dragged) dragged.classList.remove("is-dragging");
  }
  function persist(before) {
    var now = ids();
    if (now.join(",") === before.join(",")) return;
    fetch("/admin/tips/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ ids: now })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok || body.ok === false) {
          throw { userMessage: body && body.message ? body.message : "Không lưu được thứ tự." };
        }
        setError("");
      });
    }).catch(function (err) {
      var byId = {};
      cards().forEach(function (card) { byId[card.getAttribute("data-tip-id")] = card; });
      restoreOrder(list, byId, before);
      setError(err && err.userMessage ? err.userMessage : "Không lưu được thứ tự, kiểm tra kết nối rồi thử lại.");
    });
  }

  list.addEventListener("dragstart", function (event) {
    var handle = event.target && event.target.closest ? event.target.closest(".tip-handle") : null;
    if (!handle) return;
    dragged = handle.closest("[data-tip-id]");
    if (!dragged) return;
    previous = ids();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", dragged.getAttribute("data-tip-id"));
    if (event.dataTransfer.setDragImage) event.dataTransfer.setDragImage(dragged, 24, 24);
    // Them class SAU 1 nhip de anh keo (drag image) duoc chup luc the con ro net.
    setTimeout(function () { if (dragged) dragged.classList.add("is-dragging"); }, 0);
  });
  list.addEventListener("dragenter", function (event) {
    if (dragged) event.preventDefault();
  });
  list.addEventListener("dragover", function (event) {
    if (!dragged) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    var others = cards().filter(function (card) { return card !== dragged; });
    var midpoints = others.map(function (card) {
      var rect = card.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
    var ref = others[computeDropIndex(midpoints, event.clientY)] || null;
    list.insertBefore(line, ref);
  });
  list.addEventListener("drop", function (event) {
    if (!dragged) return;
    event.preventDefault();
    if (line.parentNode) list.insertBefore(dragged, line);
    cleanup();
    persist(previous);
  });
  list.addEventListener("dragend", function () {
    cleanup();
    dragged = null;
  });
})();
`;
```

- [ ] **Step 5: Thêm route `reorder` (trước `/admin/tips/:id`)**

Trong `src/api/tipsRoutes.ts`, đặt ngay SAU `app.post("/admin/tips", ...)` và TRƯỚC `app.post("/admin/tips/:id", ...)`:

```ts
  // PHAI khai bao TRUOC "/admin/tips/:id" - neu khong "reorder" bi hieu la mot :id. Route JSON nen tu kiem tra
  // dang nhap de tra 401 JSON (cong cu/fetch khong xu ly duoc redirect ve trang login).
  app.post("/admin/tips/reorder", (req: Request, res: Response) => {
    if (!deps.isAdminSession(req)) {
      res.status(401).json({ ok: false, message: "Chưa đăng nhập hoặc phiên đã hết hạn, hãy tải lại trang." });
      return;
    }
    const ids = req.body?.ids;
    if (!Array.isArray(ids)) {
      res.status(422).json({ ok: false, message: "Danh sách thứ tự không hợp lệ." });
      return;
    }
    try {
      ledgerStore.reorderTips(ids as number[]);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(422).json({ ok: false, message: err.userMessage });
        return;
      }
      throw err;
    }
  });
```

- [ ] **Step 6: Thêm CSS thật cho kéo-thả**

Trong `src/api/styles/admin.css`, thêm vào CUỐI khối `@layer components { ... }` (ngay trước dấu `}` đóng cuối file, sau `.details-plain > summary::-webkit-details-marker`):

```css

  /*
   * Danh sach Tips co the keo-tha (/admin/tips, tipsAdminHtml.ts). Viet thanh class that thay vi utility
   * tuy y (xem bay thu 3 o dau file). Khong co preflight nen <ul>/<li> tu bo cham tron va padding.
   */
  .tip-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .tip-card {
    list-style: none;
    transition: opacity 0.15s ease, box-shadow 0.15s ease;
  }
  .tip-card.is-inactive {
    opacity: 0.6;
  }
  .tip-card.is-dragging {
    opacity: 0.35;
  }
  .tip-handle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 1.5rem;
    height: 4rem;
    color: #94a3b8;
    font-size: 1.125rem;
    letter-spacing: -0.15em;
    cursor: grab;
    user-select: none;
    -webkit-user-select: none;
  }
  .tip-handle:hover {
    color: #475569;
  }
  .tip-handle:active {
    cursor: grabbing;
  }
  /* Duong ke chi cho se tha the - la 1 <li> that nam giua cac the nen tu day cac the ra, khong de cho trong. */
  .tip-drop-line {
    list-style: none;
    height: 3px;
    margin: 0.25rem 0;
    border-radius: 2px;
    background: #4f46e5;
  }
```

- [ ] **Step 7: Build CSS và kiểm tra class thật sự được sinh ra**

Run:
```bash
npm run build:css
for c in ".tip-handle" ".tip-drop-line" ".tip-card" ".tip-list" "is-dragging" "is-inactive"; do printf '%s: ' "$c"; grep -F -c "$c" public/admin.css; done
for u in "bg-indigo-600" "bg-rose-600" "border-slate-200" "space-y-3" "whitespace-pre-line" "object-cover" "shrink-0" "rounded-xl"; do printf '%s: ' "$u"; grep -F -c "$u" public/admin.css; done
```
Expected: mọi dòng ≥ 1. Nếu có dòng 0 với một utility → class đó không được sinh (bẫy Tailwind): thay bằng class viết tay trong `admin.css` rồi build lại.

- [ ] **Step 8: Chạy test + typecheck**

Run: `npx tsx --test src/api/__tests__/tipsAdminScript.test.ts src/api/__tests__/tipsRoutes.test.ts src/api/__tests__/adminTipsHtml.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit** (khi được phép)

```bash
git add src/api/tipsAdminScript.ts src/api/tipsRoutes.ts src/api/styles/admin.css src/api/__tests__/tipsAdminScript.test.ts src/api/__tests__/tipsRoutes.test.ts
git commit -m "feat(admin): keo-tha sap xep Tips + POST /admin/tips/reorder (hoan vi dung, tu luu, hoan tac khi loi)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Trang Tips của user (`/d/:token/tips`) dạng slide + route ảnh công khai

**Files:**
- Create: `src/api/tipsHtml.ts`, `src/api/tipsPageScript.ts`
- Modify: `src/api/dashboardHtml.ts` (export `pageShell` + tham số `extraCss`)
- Modify: `src/api/tipsRoutes.ts` (thêm `GET /d/:token/tips` và `GET /tips/images/:filename`)
- Test: `src/api/__tests__/tipsHtml.test.ts`, `src/api/__tests__/tipsPageScript.test.ts` (mới); mở rộng `src/api/__tests__/tipsRoutes.test.ts`

**Interfaces:**
- Consumes: `LedgerStore.listTips({onlyActive:true})`, `LedgerStore.getUserByToken`, `renderInvalidTokenPage()` (`dashboardHtml.ts`), `escapeHtml`, `deps.tipsImageDir`.
- Produces:
  ```ts
  // dashboardHtml.ts
  export function pageShell(title: string, body: string, extraCss = ""): string;
  // tipsHtml.ts
  export function renderTipsPage(input: { token: string; tips: Tip[] }): string;
  // tipsPageScript.ts
  export const TIPS_PAGE_SCRIPT: string; // ham toan cuc nearestSlideIndex(centers: number[], viewCenter: number): number
  ```
  Route: `GET /d/:token/tips` (200 HTML | 404 trang token sai), `GET /tips/images/:filename` (200 ảnh | 404).
  Markup hợp đồng giữa HTML và script: `#tips-track.tips-track[.tips-single] > article.tip-slide[.is-active]`, `.tips-dot[data-index]` trong `#tips-dots`, `#tips-counter`, `#tips-prev`, `#tips-next`.

- [ ] **Step 1: Export `pageShell` và thêm `extraCss`**

Trong `src/api/dashboardHtml.ts` thay dòng
`function pageShell(title: string, body: string): string {`
bằng
```ts
/** Vo trang chung cua trang user (nen tim + glow). `extraCss` la CSS rieng cua tung trang (vd trang Tips). */
export function pageShell(title: string, body: string, extraCss = ""): string {
```
và thay đoạn
```
  button:disabled:hover { filter: none; }
</style>
```
bằng
```
  button:disabled:hover { filter: none; }
${extraCss}
</style>
```

- [ ] **Step 2: Viết test script slide (fail)**

Tạo `src/api/__tests__/tipsPageScript.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { TIPS_PAGE_SCRIPT } from "../tipsPageScript.js";

/**
 * Script slide cua /d/:token/tips chay tren DOM gia (khong co CSS/scroll that). Test chot LOGIC: slide nao
 * dang o giua, class/aria theo do, bam cham -> cuon toi slide do, phim mui ten. Do muot va do mo cua hieu ung
 * phai xem bang mat tren trinh duyet that.
 */

test("nearestSlideIndex: chon slide co tam gan tam khung nhin nhat", () => {
  const context: Record<string, unknown> = { document: { getElementById: () => null } };
  runInNewContext(TIPS_PAGE_SCRIPT, context);
  const { nearestSlideIndex } = context as { nearestSlideIndex(c: number[], v: number): number };
  assert.equal(nearestSlideIndex([100, 400, 700], 90), 0);
  assert.equal(nearestSlideIndex([100, 400, 700], 380), 1);
  assert.equal(nearestSlideIndex([100, 400, 700], 560), 2);
  assert.equal(nearestSlideIndex([100, 400, 700], 9999), 2);
  assert.equal(nearestSlideIndex([], 5), 0);
});

interface FakeSlide {
  offsetLeft: number;
  offsetWidth: number;
  classes: Set<string>;
  classList: { toggle(name: string, force: boolean): void };
  scrollCalls: unknown[];
  scrollIntoView(options: unknown): void;
  handlers: Record<string, (event: unknown) => void>;
  addEventListener(type: string, fn: (event: unknown) => void): void;
}

function makeSlide(left: number): FakeSlide {
  const classes = new Set<string>();
  const slide: FakeSlide = {
    offsetLeft: left,
    offsetWidth: 300,
    classes,
    classList: { toggle: (name, force) => void (force ? classes.add(name) : classes.delete(name)) },
    scrollCalls: [],
    scrollIntoView(options) {
      slide.scrollCalls.push(options);
    },
    handlers: {},
    addEventListener(type, fn) {
      slide.handlers[type] = fn;
    },
  };
  return slide;
}

function makeDot() {
  const attrs: Record<string, string> = {};
  const dot = {
    attrs,
    handlers: {} as Record<string, (event: unknown) => void>,
    setAttribute: (name: string, value: string) => void (attrs[name] = value),
    getAttribute: (name: string) => attrs[name] ?? null,
    addEventListener(type: string, fn: (event: unknown) => void) {
      dot.handlers[type] = fn;
    },
  };
  return dot;
}

function mount(options: { reduceMotion?: boolean; slideCount?: number } = {}) {
  const slideCount = options.slideCount ?? 3;
  const slides = Array.from({ length: slideCount }, (_, i) => makeSlide(i * 300));
  const dots = slides.map((_, i) => {
    const dot = makeDot();
    dot.attrs["data-index"] = String(i);
    return dot;
  });
  const counter = { textContent: "" };
  const trackHandlers: Record<string, (event: unknown) => void> = {};
  const track = {
    scrollLeft: 0,
    clientWidth: 300,
    querySelectorAll: () => slides,
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      trackHandlers[type] = fn;
    },
  };
  const buttonHandlers: Record<string, () => void> = {};
  const button = (id: string) => ({ addEventListener: (_t: string, fn: () => void) => void (buttonHandlers[id] = fn) });
  const document = {
    getElementById: (id: string) =>
      id === "tips-track" ? track : id === "tips-counter" ? counter : id === "tips-prev" || id === "tips-next" ? button(id) : null,
    querySelectorAll: (selector: string) => (selector === ".tips-dot" ? dots : []),
  };
  runInNewContext(TIPS_PAGE_SCRIPT, {
    document,
    window: { matchMedia: () => ({ matches: options.reduceMotion === true }) },
    requestAnimationFrame: (fn: () => void) => fn(),
  });
  return { slides, dots, counter, track, trackHandlers, buttonHandlers };
}

test("khoi tao: slide dau active, chu so '1 / N', cham dau tien aria-current", () => {
  const m = mount();
  assert.equal(m.slides[0].classes.has("is-active"), true);
  assert.equal(m.slides[1].classes.has("is-active"), false);
  assert.equal(m.counter.textContent, "1 / 3");
  assert.equal(m.dots[0].attrs["aria-current"], "true");
  assert.equal(m.dots[1].attrs["aria-current"], "false");
});

test("cuon toi slide 3: doi slide active, chu so, cham tron", () => {
  const m = mount();
  m.track.scrollLeft = 600; // tam khung = 600 + 150 = 750 ~ tam slide 3 (600 + 150)
  m.trackHandlers.scroll({});
  assert.equal(m.slides[2].classes.has("is-active"), true);
  assert.equal(m.slides[0].classes.has("is-active"), false);
  assert.equal(m.counter.textContent, "3 / 3");
  assert.equal(m.dots[2].attrs["aria-current"], "true");
  assert.equal(m.dots[0].attrs["aria-current"], "false");
});

test("bam cham so 2: cuon muot toi slide 2 (inline center)", () => {
  const m = mount();
  m.dots[1].handlers.click({});
  assert.equal(m.slides[1].scrollCalls.length, 1);
  assert.deepEqual(m.slides[1].scrollCalls[0], { behavior: "smooth", inline: "center", block: "nearest" });
});

test("bam slide mo ben canh: cuon toi no; bam chinh slide dang active: khong lam gi", () => {
  const m = mount();
  let prevented = false;
  m.slides[1].handlers.click({ preventDefault: () => (prevented = true) });
  assert.equal(m.slides[1].scrollCalls.length, 1);
  assert.equal(prevented, true);

  m.slides[0].handlers.click({ preventDefault: () => assert.fail("slide dang active khong duoc chan click") });
  assert.equal(m.slides[0].scrollCalls.length, 0);
});

test("phim mui ten va nut truoc/sau di chuyen 1 slide, khong vuot bien", () => {
  const m = mount();
  let prevented = 0;
  const key = (name: string) => ({ key: name, preventDefault: () => prevented++ });

  m.trackHandlers.keydown(key("ArrowRight"));
  assert.equal(m.slides[1].scrollCalls.length, 1);
  assert.equal(prevented, 1);

  m.trackHandlers.keydown(key("ArrowLeft")); // dang o slide dau (chua co scroll event) -> khong co slide truoc
  assert.equal(m.slides[0].scrollCalls.length, 0);

  m.buttonHandlers["tips-next"]();
  assert.equal(m.slides[1].scrollCalls.length, 2);
  m.buttonHandlers["tips-prev"]();
  assert.equal(m.slides[0].scrollCalls.length, 0); // van la slide dau -> khong vuot bien
});

test("prefers-reduced-motion: cuon tuc thoi (behavior auto), khong 'smooth'", () => {
  const m = mount({ reduceMotion: true });
  m.dots[2].handlers.click({});
  assert.deepEqual(m.slides[2].scrollCalls[0], { behavior: "auto", inline: "center", block: "nearest" });
});

test("chi 1 slide: script khong gan gi (khong loi)", () => {
  assert.doesNotThrow(() => mount({ slideCount: 1 }));
});
```

- [ ] **Step 3: Viết test render trang user (fail)**

Tạo `src/api/__tests__/tipsHtml.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTipsPage } from "../tipsHtml.js";
import type { Tip } from "../../core/types.js";

function tip(id: number, overrides: Partial<Tip> = {}): Tip {
  return {
    id,
    title: `Tieu de ${id}`,
    description: `Mo ta ${id}`,
    imagePath: `anh-${id}.png`,
    sortOrder: id,
    isActive: true,
    createdAt: "2026-10-14T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
    ...overrides,
  };
}

const slideCount = (html: string) => (html.match(/<article class="tip-slide/g) ?? []).length;

test("moi slide co thu tu Tieu de -> Anh -> Mo ta", () => {
  const html = renderTipsPage({ token: "tok", tips: [tip(1), tip(2)] });
  const first = html.slice(html.indexOf('<article class="tip-slide'), html.indexOf("</article>"));
  const title = first.indexOf("Tieu de 1");
  const image = first.indexOf("<img");
  const description = first.indexOf("Mo ta 1");
  assert.ok(title !== -1 && image !== -1 && description !== -1);
  assert.ok(title < image && image < description, "phai la tieu de, roi anh, roi mo ta");
});

test("nhieu Tip: dung so slide, slide dau is-active, co cham tron + chu so + mui ten + track focus duoc", () => {
  const html = renderTipsPage({ token: "tok", tips: [tip(1), tip(2), tip(3)] });
  assert.equal(slideCount(html), 3);
  assert.match(html, /<article class="tip-slide is-active"[^>]*data-index="0"/);
  assert.equal((html.match(/class="tips-dot"/g) ?? []).length, 3);
  assert.match(html, /id="tips-counter"[^>]*>1 \/ 3</);
  assert.match(html, /id="tips-prev"/);
  assert.match(html, /id="tips-next"/);
  assert.match(html, /id="tips-track"[^>]*tabindex="0"/);
  assert.match(html, /aria-roledescription="carousel"/);
  assert.doesNotMatch(html, /tips-single/);
});

test("chi 1 Tip: khong cham, khong chu so, khong mui ten; track mang class tips-single", () => {
  const html = renderTipsPage({ token: "tok", tips: [tip(1)] });
  assert.equal(slideCount(html), 1);
  assert.match(html, /class="tips-track tips-single"/);
  assert.doesNotMatch(html, /class="tips-dot"/);
  assert.doesNotMatch(html, /id="tips-counter"/);
  assert.doesNotMatch(html, /id="tips-prev"/);
});

test("Tip khong anh: khong co <img> va khong chua khung anh trong; Tip khong mo ta: khong co the mo ta", () => {
  const html = renderTipsPage({ token: "tok", tips: [tip(1, { imagePath: null, description: "" })] });
  assert.doesNotMatch(html, /<img /);
  assert.doesNotMatch(html, /class="tip-image"/);
  assert.doesNotMatch(html, /class="tip-desc"/);
  assert.match(html, /Tieu de 1/);
});

test("anh: URL /tips/images/ da encode, slide dau khong lazy, slide sau lazy, co onerror an khung anh", () => {
  const html = renderTipsPage({ token: "tok", tips: [tip(1, { imagePath: "a b.png" }), tip(2)] });
  assert.match(html, /src="\/tips\/images\/a%20b\.png"/);
  const [first, second] = html.split('<article class="tip-slide').slice(1);
  assert.doesNotMatch(first, /loading="lazy"/);
  assert.match(second, /loading="lazy"/);
  assert.match(html, /onerror="this\.parentNode\.style\.display='none'"/);
});

test("escape HTML o tieu de va mo ta (khong chen duoc the)", () => {
  const html = renderTipsPage({
    token: "tok",
    tips: [tip(1, { title: '<script>alert("x")</script>', description: "a & b <img src=x onerror=alert(1)>" })],
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /a &amp; b &lt;img/);
});

test("mo ta giu xuong dong bang white-space: pre-line (khong doi \\n thanh <br>)", () => {
  const html = renderTipsPage({ token: "tok", tips: [tip(1, { description: "dong 1\ndong 2" })] });
  assert.match(html, /white-space: pre-line/);
  assert.match(html, /dong 1\ndong 2/);
  assert.doesNotMatch(html, /<br/);
});

test("khong co Tip: cau thong bao + link quay lai, khong co slide va khong co script slide", () => {
  const html = renderTipsPage({ token: "tok", tips: [] });
  assert.match(html, /Chưa có mẹo nào, bạn quay lại sau nhé/);
  assert.match(html, /href="\/d\/tok"/);
  assert.equal(slideCount(html), 0);
  assert.doesNotMatch(html, /nearestSlideIndex/);
});

test("link quay lai dung /d/<token> (token duoc encode)", () => {
  const html = renderTipsPage({ token: "a/b c", tips: [tip(1)] });
  assert.match(html, /href="\/d\/a%2Fb%20c"/);
});

test("CSS chot: scroll-snap, slide mo, prefers-reduced-motion, mui ten chi cho may co chuot; transition khong dung 'all'", () => {
  const html = renderTipsPage({ token: "tok", tips: [tip(1), tip(2)] });
  assert.match(html, /scroll-snap-type: x mandatory/);
  assert.match(html, /scroll-snap-align: center/);
  assert.match(html, /scroll-snap-stop: always/);
  assert.match(html, /\.tip-slide\.is-active/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(html, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.doesNotMatch(html, /transition: all/);
});

test("khong khoa zoom rieng cho trang nay va co noscript de khong bi mo hoan toan khi tat JS", () => {
  const html = renderTipsPage({ token: "tok", tips: [tip(1), tip(2)] });
  assert.match(html, /<noscript>/);
});
```

- [ ] **Step 4: Viết test route user (fail)**

Thêm vào CUỐI `src/api/__tests__/tipsRoutes.test.ts`:

```ts
import { writeFileSync, mkdirSync } from "node:fs";

function userToken(store: LedgerStore): string {
  return store.findOrCreateDashboardToken("zalo", "tips-user").token;
}

test("GET /d/:token/tips: token sai -> 404 trang khong hop le", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const res = await fetch(`${baseUrl}/d/khong-co-token/tips`);
    assert.equal(res.status, 404);
    assert.match(await res.text(), /Đường dẫn không hợp lệ/);
  } finally {
    cleanup();
  }
});

test("GET /d/:token/tips: chi hien Tip DANG BAT, dung thu tu, kem anh", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const token = userToken(ledgerStore);
    const a = ledgerStore.createTip({ title: "Dau tien", description: "", imagePath: "a.png" });
    const b = ledgerStore.createTip({ title: "Da tat", description: "", imagePath: null });
    ledgerStore.createTip({ title: "Thu ba", description: "", imagePath: null });
    ledgerStore.setTipActive(b.id, false);
    ledgerStore.reorderTips([ledgerStore.listTips()[2].id, a.id, b.id]);

    const res = await fetch(`${baseUrl}/d/${token}/tips`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.indexOf("Thu ba") < html.indexOf("Dau tien"), "thu tu theo sort_order");
    assert.doesNotMatch(html, /Da tat/);
    assert.match(html, /src="\/tips\/images\/a\.png"/);
  } finally {
    cleanup();
  }
});

test("GET /d/:token/tips: tat het Tip -> 200 voi cau 'chua co meo' (khong 404)", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const token = userToken(ledgerStore);
    const tip = ledgerStore.createTip({ title: "T", description: "", imagePath: null });
    ledgerStore.setTipActive(tip.id, false);
    const res = await fetch(`${baseUrl}/d/${token}/tips`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Chưa có mẹo nào/);
  } finally {
    cleanup();
  }
});

test("GET /tips/images/:filename: tra anh + header cache dai; KHONG can dang nhap", async () => {
  const { baseUrl, tipsImageDir, cleanup } = setup();
  try {
    mkdirSync(tipsImageDir, { recursive: true });
    writeFileSync(join(tipsImageDir, "ok.png"), PNG);
    const res = await fetch(`${baseUrl}/tips/images/ok.png`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), PNG);
  } finally {
    cleanup();
  }
});

test("GET /tips/images/:filename: khong ton tai -> 404 va KHONG kem header cache immutable", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const res = await fetch(`${baseUrl}/tips/images/khong-co.png`);
    assert.equal(res.status, 404);
    assert.doesNotMatch(res.headers.get("cache-control") ?? "", /immutable/);
  } finally {
    cleanup();
  }
});

test("GET /tips/images/:filename: path traversal khong doc duoc file ngoai thu muc; duoi la bi tu choi", async () => {
  const { baseUrl, tipsImageDir, cleanup } = setup();
  try {
    mkdirSync(tipsImageDir, { recursive: true });
    writeFileSync(join(tipsImageDir, "..", "secret.png"), PNG); // nam NGOAI thu muc anh
    writeFileSync(join(tipsImageDir, "notes.txt"), "khong phai anh");

    const traversal = await fetch(`${baseUrl}/tips/images/..%2Fsecret.png`);
    assert.equal(traversal.status, 404);

    const wrongExt = await fetch(`${baseUrl}/tips/images/notes.txt`);
    assert.equal(wrongExt.status, 404);
  } finally {
    rmSync(join(tipsImageDir, "..", "secret.png"), { force: true });
    cleanup();
  }
});
```

- [ ] **Step 5: Chạy test, xác nhận FAIL**

Run: `npx tsx --test src/api/__tests__/tipsHtml.test.ts src/api/__tests__/tipsPageScript.test.ts src/api/__tests__/tipsRoutes.test.ts`
Expected: FAIL (thiếu `tipsHtml.js`, `tipsPageScript.js`; route user chưa có).

- [ ] **Step 6: Viết `src/api/tipsPageScript.ts`**

```ts
/**
 * JS client cua trang slide /d/:token/tips (2026-10-14), dang chuoi de test bang node:vm
 * (tipsPageScript.test.ts). KHONG chua the <script>, backtick hay "${" de nhung an toan vao template string.
 *
 * Progressive enhancement: neu script nay loi thi scroll-snap van vuot duoc, chi mat hieu ung sang/mo va cham tron.
 * Script CHI lam 4 viec: danh dau slide dang o giua (is-active), dong bo cham tron + "2 / 5", bam cham/slide mo/
 * nut/phim de cuon toi slide khac, ton trong prefers-reduced-motion.
 */
export const TIPS_PAGE_SCRIPT = `
function nearestSlideIndex(centers, viewCenter) {
  var best = 0;
  var bestDistance = Infinity;
  for (var i = 0; i < centers.length; i++) {
    var distance = Math.abs(centers[i] - viewCenter);
    if (distance < bestDistance) { best = i; bestDistance = distance; }
  }
  return best;
}
(function () {
  var track = document.getElementById("tips-track");
  if (!track) return;
  var slides = Array.prototype.slice.call(track.querySelectorAll(".tip-slide"));
  if (slides.length < 2) return;
  var dots = Array.prototype.slice.call(document.querySelectorAll(".tips-dot"));
  var counter = document.getElementById("tips-counter");
  var prev = document.getElementById("tips-prev");
  var next = document.getElementById("tips-next");
  var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var active = 0;
  var ticking = false;

  function render(index) {
    active = index;
    slides.forEach(function (slide, i) { slide.classList.toggle("is-active", i === index); });
    dots.forEach(function (dot, i) { dot.setAttribute("aria-current", i === index ? "true" : "false"); });
    if (counter) counter.textContent = (index + 1) + " / " + slides.length;
  }
  function goTo(index) {
    if (index < 0 || index >= slides.length) return;
    slides[index].scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", inline: "center", block: "nearest" });
  }
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var centers = slides.map(function (slide) { return slide.offsetLeft + slide.offsetWidth / 2; });
      render(nearestSlideIndex(centers, track.scrollLeft + track.clientWidth / 2));
    });
  }

  track.addEventListener("scroll", onScroll);
  track.addEventListener("keydown", function (event) {
    if (event.key === "ArrowRight") { event.preventDefault(); goTo(active + 1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); goTo(active - 1); }
  });
  slides.forEach(function (slide, i) {
    slide.addEventListener("click", function (event) {
      if (i !== active) { event.preventDefault(); goTo(i); }
    });
  });
  dots.forEach(function (dot) {
    dot.addEventListener("click", function () { goTo(Number(dot.getAttribute("data-index"))); });
  });
  if (prev) prev.addEventListener("click", function () { goTo(active - 1); });
  if (next) next.addEventListener("click", function () { goTo(active + 1); });
  render(0);
})();
`;
```

- [ ] **Step 7: Viết `src/api/tipsHtml.ts`**

```ts
import type { Tip } from "../core/types.js";
import { pageShell } from "./dashboardHtml.js";
import { escapeHtml } from "./htmlHelpers.js";
import { TIPS_PAGE_SCRIPT } from "./tipsPageScript.js";

/**
 * Trang Tips cua user: /d/:token/tips (2026-10-14). Mobile la man hinh CHINH. Slide ngang bang CSS scroll-snap
 * thuan; script chi danh dau slide dang o giua (xem tipsPageScript.ts). Spec muc 7.
 *
 * Bo cuc slide: --gap + spacer 2 dau (11% - gap) + slide 78% -> slide dau/cuoi cung nam CHINH GIUA va luon lo mep
 * slide ke ben (~11% - gap moi phia). Dung % thuan (cung quy chieu = be rong track) thay vi cqw/calc phuc tap
 * de chay duoc tren WebView Zalo cu.
 */

const TIPS_PAGE_CSS = `
  .tips-head { display: flex; align-items: center; margin-bottom: 0.5rem; }
  .tips-back { color: var(--text-muted); font-size: 0.875rem; text-decoration: none; }
  .tips-viewport { position: relative; max-width: 520px; margin: 1.25rem auto 0; }
  @media (max-width: 560px) { .tips-viewport { margin-left: -1rem; margin-right: -1rem; } }
  .tips-track {
    --gap: 0.875rem;
    display: flex;
    gap: var(--gap);
    align-items: flex-start;
    overflow-x: auto;
    position: relative;
    padding: 0.25rem 0 1.25rem;
    scroll-snap-type: x mandatory;
    scroll-behavior: smooth;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    outline: none;
  }
  .tips-track::-webkit-scrollbar { display: none; }
  .tips-track::before, .tips-track::after { content: ""; flex: 0 0 calc(11% - var(--gap)); }
  .tip-slide {
    flex: 0 0 78%;
    scroll-snap-align: center;
    scroll-snap-stop: always;
    background: var(--card-bg);
    -webkit-backdrop-filter: blur(16px);
    backdrop-filter: blur(16px);
    border: 1px solid var(--card-border);
    box-shadow: var(--card-shadow);
    border-radius: 18px;
    overflow: hidden;
    opacity: 0.45;
    transform: scale(0.92);
    transform-origin: center top;
    transition: opacity 0.35s ease, transform 0.35s ease;
    cursor: pointer;
  }
  .tip-slide.is-active { opacity: 1; transform: scale(1); cursor: default; }
  .tips-single::before, .tips-single::after { display: none; }
  .tips-single { scroll-snap-type: none; padding-left: 1rem; padding-right: 1rem; }
  .tips-single .tip-slide { flex-basis: 100%; cursor: default; }
  h2.tip-title { font-size: 1.125rem; font-weight: 700; color: #fff; margin: 1rem 1rem 0.75rem; line-height: 1.35; }
  .tip-image {
    margin: 0 0.75rem;
    aspect-ratio: 4 / 3;
    border-radius: 12px;
    overflow: hidden;
    background: oklch(1 0 0 / 0.06);
  }
  .tip-image img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .tip-desc {
    margin: 0;
    padding: 0.875rem 1rem 1.125rem;
    color: var(--text-soft);
    font-size: 0.9375rem;
    line-height: 1.55;
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
  .tips-dots { display: flex; justify-content: center; gap: 0.125rem; margin-top: 0.25rem; }
  .tips-dot {
    width: 1.5rem; height: 1.5rem; padding: 0; border: 0; background: none; cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .tips-dot::before {
    content: ""; width: 0.5rem; height: 0.5rem; border-radius: 999px;
    background: var(--text-dim); opacity: 0.55;
    transition: width 0.25s ease, opacity 0.25s ease, background-color 0.25s ease;
  }
  .tips-dot[aria-current="true"]::before { width: 1.25rem; background: var(--accent); opacity: 1; }
  .tips-counter { text-align: center; color: var(--text-dim); font-size: 0.8125rem; margin-top: 0.25rem; }
  .tips-arrow {
    display: none; position: absolute; top: 40%; z-index: 2;
    width: 2.25rem; height: 2.25rem; padding: 0; border-radius: 999px; cursor: pointer;
    border: 1px solid oklch(1 0 0 / 0.25); background: oklch(0.3 0.06 295 / 0.85); color: #fff;
    font-size: 1.25rem; line-height: 1; align-items: center; justify-content: center;
  }
  #tips-prev { left: 0.5rem; }
  #tips-next { right: 0.5rem; }
  @media (hover: hover) and (pointer: fine) { .tips-arrow { display: inline-flex; } }
  @media (prefers-reduced-motion: reduce) {
    .tips-track { scroll-behavior: auto; }
    .tip-slide, .tips-dot::before { transition: none; }
  }
`;

function renderSlide(tip: Tip, index: number, total: number): string {
  const image = tip.imagePath
    ? `<div class="tip-image"><img src="/tips/images/${encodeURIComponent(tip.imagePath)}" alt="${escapeHtml(tip.title)}"${
        index === 0 ? "" : ' loading="lazy"'
      } decoding="async" onerror="this.parentNode.style.display='none'"></div>`
    : "";
  const description = tip.description ? `<p class="tip-desc">${escapeHtml(tip.description)}</p>` : "";
  return `<article class="tip-slide${index === 0 ? " is-active" : ""}" data-index="${index}" aria-roledescription="slide" aria-label="${index + 1} / ${total}">
<h2 class="tip-title">${escapeHtml(tip.title)}</h2>
${image}
${description}
</article>`;
}

export function renderTipsPage(input: { token: string; tips: Tip[] }): string {
  const { tips } = input;
  const backHref = `/d/${encodeURIComponent(input.token)}`;
  const head = `<div class="tips-head"><a class="tips-back" href="${backHref}">← Hoa hồng của bạn</a></div>
<h1>💡 Tips</h1>`;

  if (tips.length === 0) {
    return pageShell(
      "Tips",
      `${head}
<div class="card" style="margin-top:1.25rem"><p style="margin:0">Chưa có mẹo nào, bạn quay lại sau nhé.</p></div>`,
      TIPS_PAGE_CSS
    );
  }

  const single = tips.length === 1;
  const slides = tips.map((tip, index) => renderSlide(tip, index, tips.length)).join("\n");
  const arrows = single
    ? ""
    : `<button type="button" id="tips-prev" class="tips-arrow" aria-label="Mẹo trước">‹</button>
<button type="button" id="tips-next" class="tips-arrow" aria-label="Mẹo sau">›</button>`;
  const dots = single
    ? ""
    : `<div class="tips-dots" id="tips-dots">${tips
        .map(
          (_tip, index) =>
            `<button type="button" class="tips-dot" data-index="${index}" aria-label="Mẹo ${index + 1}" aria-current="${index === 0 ? "true" : "false"}"></button>`
        )
        .join("")}</div>
<div class="tips-counter" id="tips-counter" aria-live="polite">1 / ${tips.length}</div>`;

  const body = `${head}
<div class="tips-viewport">
<div id="tips-track" class="tips-track${single ? " tips-single" : ""}" tabindex="0" role="region" aria-roledescription="carousel" aria-label="Danh sách mẹo">
${slides}
</div>
${arrows}
</div>
${dots}
<noscript><style>.tip-slide { opacity: 1; transform: none; }</style></noscript>
<script>${TIPS_PAGE_SCRIPT}</script>`;

  return pageShell("Tips", body, TIPS_PAGE_CSS);
}
```

- [ ] **Step 8: Thêm 2 route user vào `tipsRoutes.ts`**

Thêm import ở đầu file:
```ts
import { existsSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { renderInvalidTokenPage } from "./dashboardHtml.js";
import { renderTipsPage } from "./tipsHtml.js";
```
và thêm cuối hàm `registerTipsRoutes` (trước dấu `}` đóng hàm):

```ts
  // --- Route cho USER (2026-10-14) ---

  app.get("/d/:token/tips", (req: Request, res: Response) => {
    const identity = ledgerStore.getUserByToken(req.params.token);
    if (!identity) {
      res.status(404).type("html").send(renderInvalidTokenPage());
      return;
    }
    res.type("html").send(renderTipsPage({ token: req.params.token, tips: ledgerStore.listTips({ onlyActive: true }) }));
  });

  // Anh Tips phuc vu CONG KHAI (khong token): noi dung la meo huong dan chung, khong phai du lieu user, ten file ngau
  // nhien. Khac route anh chung tu rut tien o cho KHONG kiem tra chu so huu vi khong co chu so huu.
  const SERVABLE_IMAGE_EXTENSIONS = new Set([".jpg", ".png", ".webp"]);
  app.get("/tips/images/:filename", (req: Request, res: Response) => {
    const filename = basename(req.params.filename);
    const filePath = resolve(tipsImageDir, filename);
    if (!SERVABLE_IMAGE_EXTENSIONS.has(extname(filename).toLowerCase()) || !existsSync(filePath)) {
      res.status(404).end();
      return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    // headers cua sendFile chi duoc gan khi gui THANH CONG: 404 khong bao gio mang "immutable" (se bi cache vinh vien).
    res.sendFile(filePath, { headers: { "Cache-Control": "public, max-age=31536000, immutable" }, dotfiles: "deny" }, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });
```

(`existsSync` có thể đã được import ở trên cùng — chỉ giữ MỘT dòng import cho mỗi tên.)

- [ ] **Step 9: Chạy test + typecheck**

Run: `npx tsx --test src/api/__tests__/tipsHtml.test.ts src/api/__tests__/tipsPageScript.test.ts src/api/__tests__/tipsRoutes.test.ts && npm run typecheck`
Expected: PASS.

Nếu test "path traversal" đỏ vì `..%2Fsecret.png`: Express giải mã thành `../secret.png`, `basename()` còn `secret.png` → không tồn tại trong thư mục ảnh → 404 (đúng). Nếu đỏ vì file `secret.png` ở thư mục cha thực sự được trả → `basename` chưa được áp dụng, sửa lại route.

- [ ] **Step 10: Commit** (khi được phép)

```bash
git add src/api/tipsHtml.ts src/api/tipsPageScript.ts src/api/tipsRoutes.ts src/api/dashboardHtml.ts src/api/__tests__/tipsHtml.test.ts src/api/__tests__/tipsPageScript.test.ts src/api/__tests__/tipsRoutes.test.ts
git commit -m "feat(user): trang Tips dang slide (/d/:token/tips) + route anh cong khai" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Nút 💡 Tips trên dashboard user

**Files:**
- Modify: `src/api/dashboardHtml.ts` (CSS `.page-head`/`.tips-pill`; field `hasTips`; header)
- Modify: `src/api/server.ts` (truyền `hasTips` ở HAI chỗ gọi `renderDashboardPage`)
- Test: `src/api/__tests__/dashboardTipsButton.test.ts` (mới)

**Interfaces:**
- Consumes: `LedgerStore.countActiveTips()` (Task 1); `pageShell` (Task 5).
- Produces: field tuỳ chọn `hasTips?: boolean` trong input của `renderDashboardPage`.

- [ ] **Step 1: Viết test (fail)**

Tạo `src/api/__tests__/dashboardTipsButton.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDashboardPage } from "../dashboardHtml.js";

const BASE = {
  entries: [],
  availableBalance: 0,
  heldBalance: 0,
  heldEntries: [],
  debtRemaining: 0,
  debts: [],
  pendingBalance: 0,
  paidTotal: 0,
  pendingWithdrawal: null,
  thresholdVnd: 20_000,
  token: "tok123",
  platform: "zalo" as const,
  userId: "u1",
  displayName: "An",
};

// Kiem tra MARKUP, khong kiem tra stylesheet: bang CSS luon co dinh nghia .tips-pill du nut co hien hay khong.
test("co Tip dang bat: nut 💡 Tips tro dung /d/<token>/tips, nam cung hang voi tieu de", () => {
  const html = renderDashboardPage({ ...BASE, hasTips: true });
  assert.match(html, /<a class="tips-pill" href="\/d\/tok123\/tips">/);
  assert.match(html, /💡/);
  assert.match(html, /<div class="page-head"><h1>💰 Hoa hồng của bạn<\/h1><a class="tips-pill"/);
});

test("khong co Tip (hasTips false hoac vang mat): KHONG co dau vet nao cua nut trong markup", () => {
  for (const html of [renderDashboardPage(BASE), renderDashboardPage({ ...BASE, hasTips: false })]) {
    assert.doesNotMatch(html, /class="tips-pill"/);
    assert.doesNotMatch(html, /href="[^"]*\/tips"/);
    assert.doesNotMatch(html, /💡/);
    assert.match(html, /<h1>💰 Hoa hồng của bạn<\/h1>/); // tieu de van y nhu cu
  }
});

test("token duoc encode trong link", () => {
  const html = renderDashboardPage({ ...BASE, token: "a/b c", hasTips: true });
  assert.match(html, /href="\/d\/a%2Fb%20c\/tips"/);
});

test("nut Tips cho phep xuong dong tren man hinh hep va co vung bam >= 44px", () => {
  const html = renderDashboardPage({ ...BASE, hasTips: true });
  assert.match(html, /\.page-head \{[^}]*flex-wrap: wrap/);
  assert.match(html, /\.tips-pill \{[^}]*min-height: 44px/);
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx tsx --test src/api/__tests__/dashboardTipsButton.test.ts`
Expected: FAIL (chưa có `tips-pill`/`page-head`).

- [ ] **Step 3: Sửa `dashboardHtml.ts`**

(a) CSS: trong `pageShell`, ngay TRƯỚC dòng `  button:disabled:hover { filter: none; }` thêm:

```css
  /* Hang tieu de: tieu de ben trai, nut Tips (pill) ben phai; man hep thi nut xuong dong chu khong day tieu de. */
  .page-head { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; }
  .tips-pill {
    display: inline-flex; align-items: center; gap: 0.4rem;
    min-height: 44px; padding: 0 1.1rem; border-radius: 999px;
    background: oklch(0.5 0.14 300 / 0.35);
    border: 1px solid oklch(1 0 0 / 0.22);
    box-shadow: 0 0 18px oklch(0.6 0.17 300 / 0.35), inset 0 1px 0 oklch(1 0 0 / 0.12);
    -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
    color: var(--text); text-decoration: none; font-size: 0.9375rem; font-weight: 600;
  }
  .tips-pill:active { filter: brightness(1.15); }
```

(b) Input của `renderDashboardPage`: thêm field vào object type (cạnh `errorMessage?: string;`):

```ts
  /**
   * Co it nhat 1 Tip dang bat (2026-10-14) -> hien nut "💡 Tips". TUY CHON, mac dinh false: cac cho goi/test cu
   * khong phai sua, va khong co Tip thi giao dien y het truoc day (khong hien thu chua ap dung).
   */
  hasTips?: boolean;
```

(c) Trong thân hàm, ngay trước `const body = ...` thêm:

```ts
  const tipsPill = input.hasTips
    ? `<a class="tips-pill" href="/d/${encodeURIComponent(input.token)}/tips"><span aria-hidden="true">💡</span> Tips</a>`
    : "";
```
và đổi dòng đầu của `body` từ `const body = \`<h1>💰 Hoa hồng của bạn</h1>` thành:

```ts
  const body = `<div class="page-head"><h1>💰 Hoa hồng của bạn</h1>${tipsPill}</div>
```
(giữ nguyên dòng `<p class="identity-line">${identityLine}</p>` và phần còn lại).

- [ ] **Step 4: Truyền `hasTips` ở `server.ts` (hai chỗ)**

Chỗ 1 — `GET /d/:token`: thay
```ts
        userId: identity.userId,
        displayName,
      })
    );
  });
```
bằng
```ts
        userId: identity.userId,
        displayName,
        hasTips: ledgerStore.countActiveTips() > 0,
      })
    );
  });
```
Chỗ 2 — nhánh lỗi của `POST /d/:token/withdraw` (trang lỗi rút tiền cũng là dashboard user thấy): thay
```ts
          displayName,
          errorMessage,
        })
```
bằng
```ts
          displayName,
          errorMessage,
          hasTips: ledgerStore.countActiveTips() > 0,
        })
```

- [ ] **Step 5: Test route cho cả hai chỗ**

Thêm vào CUỐI `src/api/__tests__/tipsRoutes.test.ts`:

```ts
test("dashboard /d/:token: co Tip dang bat -> co nut Tips; tat het -> mat nut", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const token = userToken(ledgerStore);
    const before = await (await fetch(`${baseUrl}/d/${token}`)).text();
    assert.doesNotMatch(before, /class="tips-pill"/);

    const tip = ledgerStore.createTip({ title: "T", description: "", imagePath: null });
    const withTip = await (await fetch(`${baseUrl}/d/${token}`)).text();
    assert.match(withTip, new RegExp(`href="/d/${token}/tips"`));

    ledgerStore.setTipActive(tip.id, false);
    const after = await (await fetch(`${baseUrl}/d/${token}`)).text();
    assert.doesNotMatch(after, /class="tips-pill"/);
  } finally {
    cleanup();
  }
});

test("trang loi rut tien (POST /d/:token/withdraw 422) cung giu nut Tips", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const token = userToken(ledgerStore);
    ledgerStore.createTip({ title: "T", description: "", imagePath: null });
    const res = await fetch(`${baseUrl}/d/${token}/withdraw`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ bankName: "", bankAccountNumber: "", bankAccountHolder: "" }),
      redirect: "manual",
    });
    assert.equal(res.status, 422);
    assert.match(await res.text(), /class="tips-pill"/);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 6: Chạy toàn bộ test dashboard + Tips + typecheck**

Run:
```bash
npx tsx --test src/api/__tests__/dashboardTipsButton.test.ts src/api/__tests__/tipsRoutes.test.ts
npx tsx --test src/api/__tests__/dashboard*.test.ts
npm run typecheck
```
Expected: PASS. Nếu một test dashboard cũ đỏ vì khớp cứng `<h1>…</h1>\n<p class="identity-line">`: chỉ cập nhật đúng assert đó cho khớp bọc `<div class="page-head">`, không đổi ý nghĩa.

- [ ] **Step 7: Commit** (khi được phép)

```bash
git add src/api/dashboardHtml.ts src/api/server.ts src/api/__tests__/dashboardTipsButton.test.ts src/api/__tests__/tipsRoutes.test.ts
git commit -m "feat(user): nut Tips tren dashboard, chi hien khi co Tip dang bat" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Kiểm tra bằng mắt + toàn bộ test + cập nhật tài liệu

**Files:**
- Tạo tạm (NGOÀI repo): `<scratchpad>/preview-tips.ts` — scratchpad của phiên là `/private/tmp/claude-501/-Users-ryan-Documents-Claude-Projects-Affiliate-Bot-Shopee/75175d1a-e99e-499e-a2b3-647b6d73192e/scratchpad`
- Modify: `.claude/rules/ledger-va-tien.md`, `.claude/rules/trang-cho-user.md`, `.claude/rules/admin-ui-tung-trang.md`, `.claude/rules/server-va-wiring.md`, `.claude/rules/van-hanh-va-deploy.md`, `CLAUDE.md`

**Interfaces:** không có interface mới.

- [ ] **Step 1: Chạy toàn bộ test + typecheck + build**

Run:
```bash
npm test
npm run typecheck
npm run build
```
Expected: toàn bộ xanh. Báo số test pass/fail thật; nếu có test cũ đỏ vì thay đổi của tính năng này, sửa đúng chỗ rồi chạy lại, đừng bỏ qua.

- [ ] **Step 2: Dựng server preview trên DB tạm (KHÔNG dùng `npm run dev`)**

`npm run dev` nạp token bot thật (tránh). Tạo `<scratchpad>/preview-tips.ts`:

```ts
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = "/Users/ryan/Documents/Claude/Projects/Affiliate Bot Shopee";
const require = createRequire(`${REPO}/package.json`);
const jpeg = require("jpeg-js") as { encode(img: { data: Buffer; width: number; height: number }, quality: number): { data: Buffer } };

const { createServer } = await import(`${REPO}/src/api/server.ts`);
const { LedgerStore } = await import(`${REPO}/src/core/ledgerStore.ts`);
const { LogStore } = await import(`${REPO}/src/core/logStore.ts`);
const { LinkResolverService } = await import(`${REPO}/src/core/linkResolverService.ts`);
const { RateLimiter } = await import(`${REPO}/src/core/rateLimiter.ts`);
const { AdminSessionStore } = await import(`${REPO}/src/core/adminAuth.ts`);
const { MockAffiliateProvider } = await import(`${REPO}/src/core/providers/mockProvider.ts`);
const { saveTipImage } = await import(`${REPO}/src/core/tipImage.ts`);

function gradient(r: number, g: number, b: number): Buffer {
  const width = 800;
  const height = 600;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = Math.floor(r * (x / width));
      data[i + 1] = Math.floor(g * (y / height));
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return jpeg.encode({ data, width, height }, 80).data;
}

const imageDir = mkdtempSync(join(tmpdir(), "preview-tips-img-"));
const proofDir = mkdtempSync(join(tmpdir(), "preview-tips-proof-"));
const ledger = new LedgerStore(":memory:");
const logs = new LogStore(":memory:");
const limiter = new RateLimiter(1000, 60_000);
const app = createServer(
  new LinkResolverService(new MockAffiliateProvider(), logs, limiter),
  logs, ledger, async () => {}, 20_000, new AdminSessionStore("preview"),
  { taxPercent: 10, platformFeePercent: 1, userSharePercent: 80, maxCommissionRatioPercent: 1000, holdConfig: { thresholdVnd: 0, holdDays: 0 } },
  proofDir, new RateLimiter(1000, 60_000), "http://localhost:3999", async () => {},
  undefined, true, undefined, undefined, imageDir
);

const seeds: Array<[string, string, Buffer | null]> = [
  ["Gửi link trong group để bot trả link hoàn tiền", "Dán link sản phẩm Shopee vào group, bot sẽ trả link đã gắn hoàn tiền.\nBạn mua qua link đó là được tính hoa hồng.", gradient(238, 77, 45)],
  ["Mua xong nhớ giữ nguyên đơn", "Đừng huỷ đơn trong 15 ngày đầu để tiền không bị thu hồi.", gradient(70, 140, 220)],
  ["Mẹo chỉ có chữ, không có ảnh", "Tip này cố ý không có ảnh để xem layout khi thiếu ảnh. ".repeat(6), null],
  ["Tiêu đề rất rất dài để xem tiêu đề xuống dòng như thế nào trên màn hình điện thoại hẹp", "Mô tả ngắn.", gradient(60, 200, 120)],
];
for (const [title, description, image] of seeds) {
  ledger.createTip({ title, description, imagePath: image ? saveTipImage(imageDir, image) : null });
}
const token = ledger.findOrCreateDashboardToken("zalo", "preview-user").token;

app.get("/_frame", (_req: unknown, res: { type(t: string): { send(b: string): void } }) => {
  res.type("html").send(`<body style="margin:0;background:#222"><iframe src="/d/${token}/tips" style="width:390px;height:780px;border:0;display:block;margin:0 auto"></iframe></body>`);
});
app.get("/_frame-dash", (_req: unknown, res: { type(t: string): { send(b: string): void } }) => {
  res.type("html").send(`<body style="margin:0;background:#222"><iframe src="/d/${token}" style="width:390px;height:780px;border:0;display:block;margin:0 auto"></iframe></body>`);
});
app.listen(3999, () => {
  console.log("Preview: http://localhost:3999/_frame (trang Tips 390px)  /_frame-dash (dashboard 390px)");
  console.log("Admin: http://localhost:3999/admin/tips  (mat khau: preview)");
});
```

Run (nền): `npx tsx "<scratchpad>/preview-tips.ts"` (dùng `run_in_background`).

- [ ] **Step 3: Xem bằng mắt trên Chrome (iframe 390px cho user, cửa sổ rộng cho admin)**

Tải công cụ Chrome (`ToolSearch` một lần cho `tabs_context_mcp, tabs_create_mcp, navigate, computer, read_page, resize_window`), rồi:

1. `http://localhost:3999/_frame-dash` — nút 💡 Tips nằm bên phải tiêu đề, trên cùng hàng, không bị cắt.
2. `http://localhost:3999/_frame` — slide đầu ở giữa và sáng; mép slide kế bên trái/phải lộ và **mờ**; ảnh 4:3 không méo; Tip không ảnh không chừa khung trống; tiêu đề dài xuống dòng ổn; chấm tròn + "1 / 4" bên dưới.
3. Cuộn/vuốt (dùng `computer` scroll ngang hoặc gõ phím →/←): slide đổi, chấm đổi, chuyển sáng/mờ mượt.
4. `http://localhost:3999/admin/tips` — đăng nhập mật khẩu `preview`; card, tay nắm `⋮⋮`, nhãn trạng thái, nút Tắt/Sửa/Xoá; bấm "Xoá" mở xác nhận tại chỗ, "Huỷ" đóng lại; bấm "Tắt" một Tip rồi xem card mờ + nhãn "Đã tắt", mở lại `/_frame` thấy Tip đó biến mất.
5. Ghi lại những gì **thực sự thấy**. Nếu một thứ không quan sát được (ví dụ không giả lập được vuốt cảm ứng), nói rõ là chưa kiểm tra, đừng suy diễn.

Chụp màn hình bằng công cụ `computer` và đính vào báo cáo cuối.

- [ ] **Step 4: Kéo-thả thật — chỉ chủ bot thử tay được**

Tự động hoá không giả lập tin cậy được HTML5 drag. Làm: thử một lần kéo bằng `computer` (left_click_drag) vào tay nắm; nếu kéo được thì xác nhận thứ tự mới sau khi tải lại trang; nếu không thì ghi rõ "chưa kiểm tra bằng chuột thật" và nhờ chủ bot thử tay các việc: kéo lên/xuống, thả sát đầu/cuối danh sách, tải lại trang xem thứ tự còn nguyên, và vuốt slide trong **Zalo in-app browser** trên điện thoại thật (chỉ máy thật mới biết quán tính/snap).

- [ ] **Step 5: Tắt server preview**

Dừng tiến trình nền của preview (`TaskStop` hoặc kill theo PID) và xác nhận cổng 3999 đã đóng.

- [ ] **Step 6: Cập nhật tài liệu `.claude/rules/`**

Thêm các đoạn sau (giữ văn phong từng file; mỗi đoạn là một mục mới ở CUỐI file trừ khi ghi khác).

`.claude/rules/ledger-va-tien.md` — thêm:

```markdown
## tips — nội dung Tips cho user (2026-10-14)

Bảng MỚI (không cần migration): `tips(id, title, description, image_path, sort_order, is_active, created_at, updated_at)`. **Nằm chung DB ledger nhưng KHÔNG thuộc đường tiền** — không tham gia phép chia, số dư, rút tiền. `image_path` là TÊN FILE trong `TIPS_IMAGE_DIR`, không phải đường dẫn. `createTip` tính `sort_order` NGAY trong câu INSERT (`MAX+1`) nên hai lần tạo liên tiếp không trùng thứ tự. `reorderTips(ids)` chỉ chấp nhận HOÁN VỊ ĐÚNG của tập id hiện có, ghi trong một transaction: admin khác vừa thêm/xoá Tip lúc mình kéo-thả thì bị từ chối thay vì ghi đè âm thầm. `store` không chạm hệ thống file: `updateTip`/`deleteTip` trả ảnh cũ để route xoá file SAU khi DB đã ghi xong.
```

`.claude/rules/trang-cho-user.md` — thêm:

```markdown
## Nút 💡 Tips + trang Tips dạng slide (2026-10-14)

**Nút** (`dashboardHtml.ts`, field tuỳ chọn `hasTips`): pill cùng hàng với `<h1>`, **chỉ hiện khi có ≥ 1 Tip đang bật** (cùng nguyên tắc thẻ "Đang tạm giữ"). `hasTips` mặc định false nên chỗ gọi/test cũ không sửa; **cả hai chỗ gọi trong `server.ts` (GET `/d/:token` và nhánh lỗi POST withdraw) đều phải truyền**. Test kiểm MARKUP (`class="tips-pill"`), không kiểm stylesheet — CSS luôn định nghĩa `.tips-pill`.

**Trang `/d/:token/tips`** (`tipsHtml.ts` + `tipsPageScript.ts`): slide CSS scroll-snap thuần, thứ tự Tiêu đề → Ảnh → Mô tả. Bố cục dùng `%` thuần (spacer 2 đầu `calc(11% - gap)` + slide 78%) chứ không `cqw`/`calc` lồng — mọi `%` cùng quy chiếu bề rộng track nên slide đầu/cuối nằm CHÍNH GIỮA và lộ mép slide kề; dùng padding-% trộn với flex-basis-% sẽ lệch (hai % quy chiếu hai hộp khác nhau). Slide không active mờ 0.45 + scale 0.92 chỉ là HIỆU ỨNG, không mang nghĩa. JS chỉ là tăng cường: lỗi JS thì vẫn vuốt được (`<noscript>` bỏ mờ). Một Tip → `tips-single`, không snap/chấm/mũi tên. Mũi tên chỉ hiện ở `(hover: hover) and (pointer: fine)`. Test DOM giả KHÔNG biết hiệu ứng có mượt/đẹp không — luôn xem bằng mắt trên iframe 390px, và cảm giác vuốt trong Zalo in-app chỉ kiểm được trên máy thật. `pageShell(title, body, extraCss)` đã được export để dùng chung nền với dashboard.

**Ảnh** phục vụ CÔNG KHAI ở `/tips/images/:filename` (không token: nội dung là mẹo chung, tên file ngẫu nhiên); header cache `immutable` chỉ khi gửi thành công — 404 mà kèm `immutable` sẽ bị cache vĩnh viễn.
```

`.claude/rules/admin-ui-tung-trang.md` — thêm:

```markdown
## /admin/tips (adminTipsHtml.ts, tipsAdminScript.ts, tipsRoutes.ts) — 2026-10-14

Thêm / sửa / **Tắt-Bật** / Xoá Tips; thứ tự kéo-thả chính là thứ tự slide bên user. Ràng buộc:

- **Kéo-thả = HTML5 Drag and Drop gốc, CHỈ tay nắm `.tip-handle` có `draggable`** (kéo cả card sẽ làm không bôi chọn được chữ trong ô nhập). Là `<span>` chứ không `<button>` (Firefox không bắn `dragstart` từ `<button>`). Thả xong TỰ LƯU qua `POST /admin/tips/reorder` (JSON); lưu lỗi thì card tự trả về chỗ cũ + hiện `#tips-order-error`. **Không dùng được bằng cảm ứng** — chủ bot chốt bỏ nút ↑↓ dự phòng vì admin dùng máy tính.
- **`POST /admin/tips/reorder` khai báo TRƯỚC `/admin/tips/:id`** (nếu không `reorder` bị hiểu là một `:id`) và tự kiểm tra đăng nhập để trả **JSON 401** thay vì redirect.
- **Xoá = `<details>` hai bước tại chỗ**, nút "Huỷ" đóng bằng `data-close-details` trong script. **Không `window.confirm()`** (từng treo trình duyệt tự động khi test).
- **Tip đã tắt vẫn nằm trong danh sách admin** (mờ + nhãn CHỮ "Đã tắt", vẫn kéo được); trạng thái không chỉ dựa vào độ mờ. Hint "Muốn giữ lại để dùng sau thì Tắt, đừng Xoá" là bắt buộc: Xoá mất cả file ảnh.
- **Sửa ảnh**: có file upload mà radio không phải "Bỏ ảnh" → coi là thay ảnh (kể cả radio đang "Giữ nguyên" — chọn file xong mà bị bỏ qua im lặng là bẫy); `replace` mà không có file → 422. File ảnh mới lưu trước, DB lỗi thì xoá lại; file cũ chỉ xoá SAU khi DB ghi xong.
- Lỗi multer (quá 5MB) KHÔNG rơi xuống error handler chung (JSON 500) mà thành 422 trên trang, giữ nguyên chữ admin đã gõ.
- Class `.tip-*` là CSS thật trong `admin.css`. Script test bằng `node:vm` trên DOM giả: chốt logic (chỗ chèn, thứ tự id, hoàn tác khi lỗi), KHÔNG chứng minh được cảm giác kéo bằng chuột thật.
```

`.claude/rules/server-va-wiring.md` — thêm:

```markdown
## Route Tips (2026-10-14) — `tipsRoutes.ts`

`registerTipsRoutes(app, deps)` gọi ở cuối `createServer()` (tách khỏi `server.ts`): admin `GET/POST /admin/tips`, `POST /admin/tips/reorder` (JSON, **trước** `/:id`), `POST /admin/tips/:id`, `/:id/active`, `/:id/delete`; user `GET /d/:token/tips` và `GET /tips/images/:filename` (công khai, chỉ `.jpg/.png/.webp`, `basename()` chặn path traversal). `createServer()` nhận `tipsImageDir` là tham số CUỐI (mặc định `./data/tips-images`, env `TIPS_IMAGE_DIR`). `isAdminSession(req)` được tạo cạnh `requireAdminAuth` cho route JSON.
```

`.claude/rules/van-hanh-va-deploy.md` — thêm vào mục "Triển khai nhiều chủ bot":

```markdown
**`TIPS_IMAGE_DIR` PHẢI nằm trên volume (2026-10-14)**: ảnh của Tips (`/admin/tips`) lưu ở thư mục này, mặc định `./data/tips-images` cùng chỗ với DB và ảnh chứng từ rút tiền. Instance mới nào mount volume ở chỗ khác thì phải trỏ biến này vào volume, nếu không ảnh mất sau mỗi lần deploy trong khi bản ghi `tips` vẫn còn (trang user đã tự ẩn `<img>` hỏng nên không vỡ, nhưng Tip mất ảnh).
```

`CLAUDE.md` — trong "Bản đồ code", dòng `src/api/` thêm, và dòng core thêm:

```
  tipImage                                              -> trang-cho-user.md (+ ledger-va-tien.md: bảng tips)
  ...
  dashboardHtml handbookHtml tipsHtml tipsPageScript    -> trang-cho-user.md
  adminTipsHtml tipsAdminScript tipsRoutes              -> admin-ui-tung-trang.md + server-va-wiring.md
```
(đặt vào đúng khối `src/core/` và `src/api/` hiện có, giữ nguyên căn lề). Trong bảng "đọc file nào khi nào", ở dòng `trang-cho-user.md` đổi cột "Đọc khi" thành `Sửa dashboard cá nhân (/d/:token), trang Tips (/d/:token/tips) hoặc Sổ tay hoàn tiền (/so-tay)`; ở dòng `admin-ui-tung-trang.md` thêm `/admin/tips` vào danh sách.

- [ ] **Step 7: Rà lại bằng `git diff --stat` và chạy lần cuối**

Run:
```bash
git status --short
git diff --stat
npm test && npm run typecheck
```
Expected: chỉ có các file của tính năng này (không có `preview-withdrawals.ts` hay file lạ được thêm), test + typecheck xanh.

- [ ] **Step 8: Commit** (khi được phép; KHÔNG `git push`)

```bash
git add .claude/rules/ledger-va-tien.md .claude/rules/trang-cho-user.md .claude/rules/admin-ui-tung-trang.md .claude/rules/server-va-wiring.md .claude/rules/van-hanh-va-deploy.md CLAUDE.md docs/superpowers/specs/2026-10-14-tips-slide-design.md docs/superpowers/plans/2026-10-14-tips-slide.md
git commit -m "docs(tips): cap nhat rules + ban do code + spec/plan cho Tips" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review (đối chiếu spec)

**1. Phủ spec**
- §3 Dữ liệu → Task 1 (bảng, `is_active`, mọi method, tiebreak `id`, `sort_order` trong câu INSERT, CRLF, giới hạn 120/2000).
- §4 Ảnh → Task 2 (magic bytes, UUID, 5MB, không SVG/GIF, `TIPS_IMAGE_DIR` + `.env.example`, xoá file lỗi chỉ cảnh báo) + Task 3 (xoá file cũ SAU khi DB ghi, dọn file mồ côi khi DB lỗi) + Task 5 (route ảnh công khai, `immutable` chỉ khi thành công, `basename`, chỉ 3 đuôi).
- §5 Admin → Task 3 (menu + icon, form thêm/sửa, tắt-bật, xoá `<details>` hai bước + "Huỷ", hint "Tắt, đừng Xoá", trạng thái rỗng, 422 giữ chữ, tham số `tipsImageDir`) + Task 4 (kéo-thả chỉ tay nắm, `reorder` JSON 401/422, hoán vị đúng, hoàn tác khi lỗi, CSS thật + `grep -F`, route trước `:id`).
- §6 Dashboard → Task 6 (`hasTips` tuỳ chọn, hai chỗ gọi, pill, `flex-wrap`, 44px, ẩn khi không có Tip).
- §7 Trang user → Task 5 (token sai 404, `pageShell` export, slide scroll-snap, mờ/sáng, chấm + "n / N", mũi tên `hover: hover`, phím, reduced-motion, một Tip, Tip không ảnh, mô tả dài căn mép trên, `onerror`, escape, `pre-line`, `encodeURIComponent`, lazy trừ slide đầu, trạng thái rỗng 200).
- §8 Kiểm thử → các file test ở Task 1–6; phần "test không chứng minh được" → Task 7 bước 3–4 (xem bằng mắt iframe 390px, kéo chuột thật + Zalo in-app nhờ chủ bot).
- §9 Tài liệu → Task 7 bước 6. §10 rủi ro volume → mục `van-hanh-va-deploy.md`.
- **Điều chỉnh có chủ ý so với spec** (cần nêu khi bàn giao): (a) spec §5.1 gợi ý "Giữ nguyên / Thay ảnh / Bỏ ảnh" — giữ nguyên UI này, nhưng server coi "có file + không phải Bỏ ảnh" là thay ảnh để file chọn xong không bị bỏ qua im lặng (ghi trong rule); (b) spec §7 nói "không có dấu vết nào" của nút khi tắt — test kiểm markup (`class="tips-pill"`), vì stylesheet luôn có định nghĩa `.tips-pill`; (c) spec §7.1 phác `padding-inline` kiểu `calc((100% - w)/2)` — plan dùng spacer `calc(11% - gap)` + slide 78% vì `%` của padding và của flex-basis quy chiếu hai hộp khác nhau nên công thức trong spec sẽ lệch tâm.

**2. Quét placeholder:** không còn "TBD/TODO"; mọi bước code đều có code thật. (Lưu ý duy nhất: Task 2 bước 1 có ghi chú sửa `readdirSafe` → `readdirSync` ngay trong bước, không để lại hàm dùng `require`.)

**3. Nhất quán kiểu:** `Tip`/`TipInput`/`TipUpdateInput`, `createTip/getTipById/updateTip/setTipActive/deleteTip/listTips/countActiveTips/reorderTips`, `InvalidTipError`, `saveTipImage/deleteTipImage/detectTipImageType/TIP_IMAGE_MAX_BYTES`, `renderAdminTipsPage/TipsAdminDraft/TIPS_ADMIN_SCRIPT`, `registerTipsRoutes/TipsRoutesDeps`, `renderTipsPage/TIPS_PAGE_SCRIPT/nearestSlideIndex`, `pageShell(title, body, extraCss)`, `hasTips` — cùng tên và chữ ký ở mọi task dùng tới chúng.
