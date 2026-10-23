# Trang "Cửa hàng hôm nay" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm trang admin `/admin/cua-hang` mô phỏng 3D (Three.js) các lượt tạo link thành công của user Zalo trong ngày: nhân vật chibi đi vào cửa hàng Shopee/TikTok đúng số link, hàng chờ dài theo số user unique, bảng tin bên cạnh.

**Architecture:** Server đọc dữ liệu (chỉ đọc) từ `logStore` + `ledgerStore`, hàm thuần `storeTraffic.ts` chuẩn hoá thành tóm tắt + bảng tin + dữ liệu cảnh (không `userId`), trang HTML render ở server và nhúng JSON. Trình duyệt chạy bundle esbuild `public/store-scene.js`: lớp mô phỏng thuần TS (đồ thị điểm đi bộ, hàng chờ có giữ chỗ, máy trạng thái) điều khiển lớp hiển thị Three.js.

**Tech Stack:** TypeScript, Node 22+ (`node:sqlite`, `node:test` qua `tsx --test`), Express, Three.js (`three` + `three/addons`), esbuild, Tailwind v4 (không preflight) + CSS viết tay trong `admin.css`.

**Spec:** `docs/superpowers/specs/2026-10-23-cua-hang-hom-nay-design.md` — đọc cùng plan này; mọi quyết định "vì sao" nằm ở spec.

## Global Constraints

- Chỉ user **Zalo** (`platform='zalo'`), chỉ `outcome='success'`, mỗi link 1 lượt kể cả trùng link.
- Ngày = [00:00, 00:00 ngày sau) giờ **Asia/Ho_Chi_Minh**; active = ≥ 1 link trong **7 ngày lịch** D−6…D.
- Tối đa **30** nhân vật; tối đa **5** người trong shop cùng lúc; tối đa **10** ô chờ mỗi shop.
- `queueTarget(S) = shop đóng ? 0 : max(0, min(10, ceil(U_S/2), E_S − 1))`; cổng cửa: `hasFreeBrowseSpot && (queueLength >= queueTarget || waited >= maxWait)`, `maxWait` 20–25s.
- Bảng tin tối đa **200** dòng; 50 mẫu nhân vật, không trùng mẫu trong cùng cảnh.
- JSON gửi xuống trình duyệt **không chứa `userId`, không chứa giờ**. Nhúng qua `embedJson` (`<` → `<`). Mọi chuỗi trong HTML qua `escapeHtml`; nhãn trong cảnh gán bằng `textContent`.
- Không ghi DB, không route/API JSON mới; trang nằm sau `requireAdminAuth`.
- Không CDN cho Three.js; bundle trong `public/` (đã gitignore). `src/core/**` không import `three`/`express`.
- Chữ trên trang không nói "mua"/"đặt": dùng "vừa săn" / "vừa tạo link". Chú thích dưới cảnh bắt buộc (mục 4 spec).
- Cảnh chỉ cam kết đẹp ở viewport ≥ 1440px; chỉ máy tính.
- Commit message theo phong cách repo (không dấu), kết thúc bằng dòng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Không push / không deploy** (Railway auto-deploy từ `main`, phải hỏi chủ bot trước).
- Comment trong code theo phong cách repo: tiếng Việt không dấu, giải thích "vì sao".

## File Structure

| File | Trách nhiệm |
|---|---|
| `src/core/vietnamDate.ts` (sửa) | + `vnDayStartUtcIso()` đổi mốc 00:00 giờ VN sang ISO UTC |
| `src/core/logStore.ts` (sửa) | + `LinkActivityRow`, `listZaloLinkActivity()` (chỉ đọc) |
| `src/core/ledgerStore.ts` (sửa) | + `UserProfileInfo`, `getUserProfilesMap()` (chỉ đọc) |
| `src/core/storeSceneContract.ts` (mới) | Kiểu dữ liệu cảnh dùng chung server ↔ trình duyệt (chỉ type + hằng) |
| `src/core/storeTraffic.ts` (mới) | Hàm thuần: chọn 30 user, lượt ghé, bảng tin, tóm tắt, phân bổ mẫu |
| `src/api/htmlHelpers.ts` (sửa) | + `embedJson()` (chuyển từ `adminDashboardHtml.ts`) |
| `src/api/adminDashboardHtml.ts` (sửa) | import `embedJson` từ `htmlHelpers` |
| `src/api/adminAssets.ts` (sửa) | `assetHref()` dùng chung + `storeSceneJsHref()` |
| `src/api/adminHtml.ts` (sửa) | export `safeAvatarUrl`; nav item "Cửa hàng hôm nay"; icon `store` |
| `src/api/adminStoreHtml.ts` (mới) | Render thân trang `/admin/cua-hang` |
| `src/api/server.ts` (sửa) | Route `GET /admin/cua-hang` |
| `src/api/styles/admin.css` (sửa) | Class `.store-*`, `.scene-*` (CSS viết tay, `@layer components`) |
| `src/web/storeScene/layout.ts` | Dữ liệu thế giới thuần: toạ độ, node, cạnh, footprint, decor, `groundY` |
| `src/web/storeScene/variants.ts` | 50 mẫu nhân vật cố định (thuần) |
| `src/web/storeScene/quality.ts` | `QualityGovernor` + `p95` (thuần) |
| `src/web/storeScene/sim/rng.ts` | mulberry32 |
| `src/web/storeScene/sim/pathfinding.ts` | Dijkstra trên đồ thị tĩnh |
| `src/web/storeScene/sim/queue.ts` | `queueTarget()` + `StoreQueue` (giữ chỗ, cổng cửa) |
| `src/web/storeScene/sim/director.ts` | Máy trạng thái + điều phối nhân vật |
| `src/web/storeScene/render/textures.ts` | Texture canvas (biển hiệu, mái hiên, cửa cuốn, gạch, bóng) |
| `src/web/storeScene/render/stage.ts` | Renderer, camera ortho, ánh sáng, bloom, CSS2DRenderer, chất lượng |
| `src/web/storeScene/render/environment.ts` | Đường, vỉa hè, vạch, cây, đèn, ghế, bồn cây |
| `src/web/storeScene/render/stores.ts` | 2 cửa hàng (nội thất, kính, neon, cửa cuốn) |
| `src/web/storeScene/render/characters.ts` | Dựng chibi theo mẫu + tạo dáng mỗi khung |
| `src/web/storeScene/render/labels.ts` | Nhãn tên ×N, bảng đếm biển hiệu, thứ tự chiều sâu |
| `src/web/storeScene/main.ts` | Điểm vào bundle: đọc JSON → director → vòng vẽ |
| `src/web/storeScene/__tests__/*.test.ts` | Test thuần (layout, pathfinding, queue, director, variants, quality) |
| `tsconfig.json` (sửa), `tsconfig.web.json` (mới), `package.json` (sửa) | Build/test/typecheck |
| `.claude/rules/cua-hang-hom-nay.md` (mới), `CLAUDE.md`, `.claude/rules/admin-ui-nen-tang.md` (sửa) | Tài liệu |

---

### Task 1: Lớp đọc dữ liệu (repository) + mốc ngày VN

**Files:**
- Modify: `src/core/vietnamDate.ts` (thêm cuối file)
- Modify: `src/core/logStore.ts` (thêm interface sau `CreatedLinkFilters`, method sau `findBySubId`)
- Modify: `src/core/ledgerStore.ts` (method ngay sau `getDisplayNamesMap()`, ~dòng 1777)
- Test: `src/core/__tests__/storeTrafficRepository.test.ts`

**Interfaces:**
- Produces:
  - `vnDayStartUtcIso(dayIso: string): string` — `"2026-10-23"` → `"2026-10-22T17:00:00.000Z"`
  - `interface LinkActivityRow { userId: string; merchant: string | null; timestamp: string; productName: string | null }` (export từ `logStore.ts`)
  - `LogStore.listZaloLinkActivity(fromUtcIso: string, toUtcIso: string): LinkActivityRow[]` — `[from, to)`, `ORDER BY timestamp ASC, rowid ASC`
  - `interface UserProfileInfo { displayName: string; avatarUrl: string | null }` (export từ `ledgerStore.ts`)
  - `LedgerStore.getUserProfilesMap(platform: Platform): Map<string, UserProfileInfo>` — key = `userId`

- [ ] **Step 1: Viết test hỏng**

`src/core/__tests__/storeTrafficRepository.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { LogStore } from "../logStore.js";
import { LedgerStore } from "../ledgerStore.js";
import { vnDayStartUtcIso } from "../vietnamDate.js";

function rec(store: LogStore, over: Partial<Parameters<LogStore["record"]>[0]> & { timestamp: string; userId: string }) {
  store.record({
    platform: "zalo",
    merchant: "shopee",
    originalUrl: "https://shopee.vn/product/1/2",
    subId: `k-${over.userId}-x`,
    outcome: "success",
    errorCode: null,
    affiliateUrl: "https://bot.example/s/abc",
    ...over,
  });
}

test("vnDayStartUtcIso: 00:00 gio VN = 17:00Z ngay hom truoc, ke ca doi thang/nam", () => {
  assert.equal(vnDayStartUtcIso("2026-10-23"), "2026-10-22T17:00:00.000Z");
  assert.equal(vnDayStartUtcIso("2026-11-01"), "2026-10-31T17:00:00.000Z");
  assert.equal(vnDayStartUtcIso("2027-01-01"), "2026-12-31T17:00:00.000Z");
});

test("listZaloLinkActivity: chi zalo + success, khoang [from, to), sap theo timestamp roi rowid", () => {
  const store = new LogStore(":memory:");
  try {
    rec(store, { userId: "a", timestamp: "2026-10-22T16:59:59.999Z" }); // truoc from -> loai
    rec(store, { userId: "b", timestamp: "2026-10-22T17:00:00.000Z", productName: "Ao" }); // dung from -> lay
    rec(store, { userId: "c", timestamp: "2026-10-23T05:00:00.000Z", platform: "telegram" }); // khac nen tang
    rec(store, { userId: "d", timestamp: "2026-10-23T05:00:00.000Z", outcome: "error", merchant: null, affiliateUrl: null, errorCode: "X" });
    rec(store, { userId: "e2", timestamp: "2026-10-23T06:00:00.000Z", merchant: "tiktokshop" }); // cung mili-giay,
    rec(store, { userId: "e1", timestamp: "2026-10-23T06:00:00.000Z" }); //   ghi sau -> dung sau
    rec(store, { userId: "f", timestamp: "2026-10-23T17:00:00.000Z" }); // dung to -> loai

    const rows = store.listZaloLinkActivity("2026-10-22T17:00:00.000Z", "2026-10-23T17:00:00.000Z");
    assert.deepEqual(rows.map((r) => r.userId), ["b", "e2", "e1"]);
    assert.deepEqual(rows[0], { userId: "b", merchant: "shopee", timestamp: "2026-10-22T17:00:00.000Z", productName: "Ao" });
    assert.equal(rows[1].merchant, "tiktokshop");
    assert.equal(rows[2].productName, null);
  } finally {
    store.close();
  }
});

test("getUserProfilesMap: chi dung nen tang, avatar thieu -> null", () => {
  const ledger = new LedgerStore(":memory:");
  try {
    ledger.upsertUserProfile("zalo", "u1", "Thảo", "https://avatar.example/u1.jpg");
    ledger.upsertUserProfile("zalo", "u2", "Minh");
    ledger.upsertUserProfile("telegram", "u3", "Khac nen tang");
    const map = ledger.getUserProfilesMap("zalo");
    assert.equal(map.size, 2);
    assert.deepEqual(map.get("u1"), { displayName: "Thảo", avatarUrl: "https://avatar.example/u1.jpg" });
    assert.deepEqual(map.get("u2"), { displayName: "Minh", avatarUrl: null });
    assert.equal(map.get("u3"), undefined);
  } finally {
    ledger.close();
  }
});
```

- [ ] **Step 2: Chạy test, xác nhận hỏng**

Run: `npx tsx --test src/core/__tests__/storeTrafficRepository.test.ts`
Expected: FAIL — `vnDayStartUtcIso` không được export / `listZaloLinkActivity is not a function`.

- [ ] **Step 3: Cài đặt**

`src/core/vietnamDate.ts` — thêm cuối file:

```ts
/**
 * Moc 00:00 gio VN cua ngay lich `dayIso` ("YYYY-MM-DD"), doi sang ISO UTC (2026-10-23, trang
 * /admin/cua-hang). Cot requests.timestamp luu toISOString() (UTC) nen so sanh chuoi voi moc nay
 * dung duoc index timestamp - khong phai date(timestamp,'+7 hours') quet ca bang.
 * VN khong co DST nen tru co dinh 7 tieng luon dung.
 */
export function vnDayStartUtcIso(dayIso: string): string {
  const [year, month, day] = dayIso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) - 7 * 60 * 60 * 1000).toISOString();
}
```

`src/core/logStore.ts` — thêm interface ngay sau khối `export interface CreatedLinkFilters { ... }`:

```ts
/** 1 luot tao link THANH CONG cua user Zalo - nguon cua trang /admin/cua-hang (2026-10-23). */
export interface LinkActivityRow {
  userId: string;
  merchant: string | null;
  timestamp: string;
  productName: string | null;
}
```

Thêm method ngay sau `findBySubId(...)`:

```ts
  /**
   * Cac luot tao link THANH CONG cua user Zalo trong khoang [fromUtcIso, toUtcIso) - CHI DOC, dung boi
   * /admin/cua-hang (2026-10-23). Chi lay 4 cot can dung. Tiebreak rowid ASC: 1 tin nhan nhieu link ghi
   * nhieu row cung mili-giay, thieu tiebreak thi thu tu luot ghe cua nhan vat khong on dinh.
   */
  listZaloLinkActivity(fromUtcIso: string, toUtcIso: string): LinkActivityRow[] {
    const rows = this.db
      .prepare(
        `SELECT user_id, merchant, timestamp, product_name FROM requests
         WHERE platform = 'zalo' AND outcome = 'success' AND timestamp >= ? AND timestamp < ?
         ORDER BY timestamp ASC, rowid ASC`
      )
      .all(fromUtcIso, toUtcIso) as Array<{
      user_id: string;
      merchant: string | null;
      timestamp: string;
      product_name: string | null;
    }>;
    return rows.map((r) => ({
      userId: r.user_id,
      merchant: r.merchant,
      timestamp: r.timestamp,
      productName: r.product_name,
    }));
  }
```

`src/core/ledgerStore.ts` — thêm export interface gần đầu file (sau các import):

```ts
/** Ho so hien thi cua 1 user (2026-10-23, /admin/cua-hang). */
export interface UserProfileInfo {
  displayName: string;
  avatarUrl: string | null;
}
```

Thêm method ngay sau `getDisplayNamesMap()`:

```ts
  /**
   * Ten + avatar cua MOI user mot nen tang, key = userId (2026-10-23, /admin/cua-hang). Chi doc. Bang
   * requests nam o DB khac nen route gop 2 nguon trong JS (giong /admin/links).
   */
  getUserProfilesMap(platform: Platform): Map<string, UserProfileInfo> {
    const rows = this.db
      .prepare(`SELECT user_id, display_name, avatar_url FROM user_profiles WHERE platform = ?`)
      .all(platform) as Array<{ user_id: string; display_name: string; avatar_url: string | null }>;
    const map = new Map<string, UserProfileInfo>();
    for (const r of rows) {
      map.set(r.user_id, { displayName: r.display_name, avatarUrl: r.avatar_url ? r.avatar_url : null });
    }
    return map;
  }
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx tsx --test src/core/__tests__/storeTrafficRepository.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/vietnamDate.ts src/core/logStore.ts src/core/ledgerStore.ts src/core/__tests__/storeTrafficRepository.test.ts
git commit -m "feat(cua-hang): lop doc du lieu luot tao link Zalo + ho so user + moc ngay VN

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `storeTraffic.ts` — chuẩn hoá dữ liệu (thuần) + data contract

**Files:**
- Create: `src/core/storeSceneContract.ts`
- Create: `src/core/storeTraffic.ts`
- Test: `src/core/__tests__/storeTraffic.test.ts`

**Interfaces:**
- Consumes: `LinkActivityRow` (logStore), `UserProfileInfo` (ledgerStore), `formatVnDateIso`, `formatVnTimeHms`, `addDaysToVnIso` (vietnamDate).
- Produces (`storeSceneContract.ts`):
  ```ts
  export type StoreId = "shopee" | "tiktokshop";
  export const STORE_IDS: readonly StoreId[];
  export const VARIANT_COUNT = 50;
  export interface SceneCharacter { key: string; seed: number; variant: number; name: string; initials: string; avatarUrl: string | null; visits: StoreId[] }
  export interface StoreSceneData { dayVn: string; isToday: boolean; tiktokOpen: boolean; storeLinks: Record<StoreId, number>; storeUsers: Record<StoreId, number>; characters: SceneCharacter[] }
  ```
- Produces (`storeTraffic.ts`):
  ```ts
  export const MAX_SCENE_CHARACTERS = 30; export const FEED_LIMIT = 200;
  export interface FeedItem { name: string; avatarUrl: string | null; initials: string; merchant: StoreId; timeVn: string; productName: string | null }
  export interface StoreTrafficSummary { dayVn: string; visitorsToday: number; shopeeLinks: number; tiktokLinks: number; activeUsers7d: number; shownCharacters: number }
  export interface StoreTrafficResult { summary: StoreTrafficSummary; feed: FeedItem[]; feedOverflow: number; scene: StoreSceneData }
  export interface StoreTrafficInput { rows: LinkActivityRow[]; profiles: Map<string, UserProfileInfo>; dayVn: string; isToday: boolean; tiktokOpen: boolean; safeAvatar: (url: string | null) => string | null }
  export function buildStoreTraffic(input: StoreTrafficInput): StoreTrafficResult;
  export function fnv1a32(text: string): number;
  export function initialsOf(name: string): string;
  export function fallbackName(userId: string): string;
  export function allocateVariants(items: Array<{ key: string; seed: number }>, count?: number): Map<string, number>;
  ```

- [ ] **Step 1: Viết test hỏng**

`src/core/__tests__/storeTraffic.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allocateVariants,
  buildStoreTraffic,
  fallbackName,
  fnv1a32,
  initialsOf,
  type StoreTrafficInput,
} from "../storeTraffic.js";
import type { LinkActivityRow } from "../logStore.js";
import type { UserProfileInfo } from "../ledgerStore.js";

const D = "2026-10-23"; // ngay dang xem; 00:00 VN = 2026-10-22T17:00Z

function row(userId: string, timestamp: string, merchant: string | null = "shopee", productName: string | null = null): LinkActivityRow {
  return { userId, merchant, timestamp, productName };
}

function input(rows: LinkActivityRow[], over: Partial<StoreTrafficInput> = {}): StoreTrafficInput {
  return {
    rows,
    profiles: new Map<string, UserProfileInfo>(),
    dayVn: D,
    isToday: true,
    tiktokOpen: true,
    safeAvatar: (url) => (url && url.startsWith("https://") ? url : null),
    ...over,
  };
}

test("cat ngay theo gio VN: 00:30 VN va 23:59 VN thuoc D, 00:00 VN ngay sau thi khong", () => {
  const r = buildStoreTraffic(
    input([
      row("u1", "2026-10-22T17:30:00.000Z"), // 00:30 VN 23/10
      row("u1", "2026-10-23T16:59:00.000Z"), // 23:59 VN 23/10
      row("u2", "2026-10-22T16:59:00.000Z"), // 23:59 VN 22/10 -> active, khong phai hom nay
      row("u3", "2026-10-23T17:00:00.000Z"), // 00:00 VN 24/10 -> ngoai cua so
    ])
  );
  assert.equal(r.summary.shopeeLinks, 2);
  assert.equal(r.summary.visitorsToday, 1);
  assert.equal(r.summary.activeUsers7d, 2); // u3 o tuong lai so voi D -> khong tinh
  const u1 = r.scene.characters.find((c) => c.visits.length === 2);
  assert.ok(u1);
  assert.equal(r.feed[0].timeVn, "23:59");
  assert.equal(r.feed[1].timeVn, "00:30");
});

test("cua so 7 ngay lich: D-6 tinh active, D-7 khong", () => {
  const r = buildStoreTraffic(
    input([
      row("old", "2026-10-16T05:00:00.000Z"), // 12:00 VN 16/10 = D-7
      row("edge", "2026-10-17T05:00:00.000Z"), // 12:00 VN 17/10 = D-6
    ])
  );
  assert.equal(r.summary.activeUsers7d, 1);
  assert.equal(r.scene.characters.length, 1);
  assert.deepEqual(r.scene.characters[0].visits, []);
});

test("xep hang 3 tang: so link ngay D -> link gan nhat -> userId tang dan", () => {
  const rows = [
    row("b", "2026-10-20T05:00:00.000Z"), // 0 link hom nay, gan nhat 20/10
    row("a", "2026-10-20T05:00:00.000Z"), // hoa voi b -> a truoc b
    row("c", "2026-10-21T05:00:00.000Z"), // 0 link, gan hon -> truoc a,b
    row("z", "2026-10-23T01:00:00.000Z"), // 1 link hom nay
    row("y", "2026-10-23T02:00:00.000Z"),
    row("y", "2026-10-23T03:00:00.000Z"), // 2 link -> dung dau
  ];
  const profiles = new Map<string, UserProfileInfo>(
    ["a", "b", "c", "y", "z"].map((id) => [id, { displayName: `ten-${id}`, avatarUrl: null }])
  );
  const r = buildStoreTraffic(input(rows, { profiles }));
  assert.deepEqual(r.scene.characters.map((c) => c.name), ["ten-y", "ten-z", "ten-c", "ten-a", "ten-b"]);
  assert.deepEqual(r.scene.characters.map((c) => c.key), ["c01", "c02", "c03", "c04", "c05"]);
});

test("toi da 30 nhan vat; tom tat van dem tren toan bo", () => {
  const rows: LinkActivityRow[] = [];
  for (let i = 0; i < 40; i++) rows.push(row(`u${String(i).padStart(2, "0")}`, "2026-10-23T05:00:00.000Z"));
  const r = buildStoreTraffic(input(rows));
  assert.equal(r.scene.characters.length, 30);
  assert.equal(r.summary.shownCharacters, 30);
  assert.equal(r.summary.activeUsers7d, 40);
  assert.equal(r.summary.visitorsToday, 40);
  assert.equal(r.scene.storeUsers.shopee, 40); // storeUsers KHONG bi gioi han 30
});

test("nhieu link cung timestamp giu thu tu dau vao (rowid); visits dung thu tu thoi gian", () => {
  const r = buildStoreTraffic(
    input([
      row("u", "2026-10-23T01:00:00.000Z", "shopee"),
      row("u", "2026-10-23T01:00:00.000Z", "shopee"),
      row("u", "2026-10-23T01:00:00.000Z", "tiktokshop"),
      row("u", "2026-10-23T02:00:00.000Z", "shopee"),
    ])
  );
  assert.deepEqual(r.scene.characters[0].visits, ["shopee", "shopee", "tiktokshop", "shopee"]);
  // Bang tin moi nhat truoc: dong cuoi dau vao dung dau, dong tiktok (ghi sau 2 dong shopee cung ms) truoc 2 dong do.
  assert.deepEqual(r.feed.map((f) => f.merchant), ["shopee", "tiktokshop", "shopee", "shopee"]);
});

test("storeLinks/storeUsers: 1 user 10 link = 1 user; user 2 san dem o ca 2", () => {
  const rows: LinkActivityRow[] = [];
  for (let i = 0; i < 10; i++) rows.push(row("nhieu", `2026-10-23T0${i}:00:00.000Z`, "shopee"));
  rows.push(row("hai", "2026-10-23T05:00:00.000Z", "shopee"), row("hai", "2026-10-23T06:00:00.000Z", "tiktokshop"));
  const r = buildStoreTraffic(input(rows));
  assert.deepEqual(r.scene.storeLinks, { shopee: 11, tiktokshop: 1 });
  assert.deepEqual(r.scene.storeUsers, { shopee: 2, tiktokshop: 1 });
  assert.equal(r.summary.shopeeLinks, r.scene.storeLinks.shopee);
  assert.equal(r.summary.tiktokLinks, r.scene.storeLinks.tiktokshop);
});

test("merchant la (lazada/null) bi bo khoi luot ghe + bang tin nhung user van active", () => {
  const r = buildStoreTraffic(input([row("x", "2026-10-23T05:00:00.000Z", "lazada")]));
  assert.equal(r.summary.activeUsers7d, 1);
  assert.equal(r.feed.length, 0);
  assert.deepEqual(r.scene.characters[0].visits, []);
});

test("bang tin cat o 200 + feedOverflow; tom tat khop tong bang tin", () => {
  const rows: LinkActivityRow[] = [];
  for (let i = 0; i < 230; i++) rows.push(row(`u${i % 7}`, `2026-10-23T05:${String(i % 60).padStart(2, "0")}:00.000Z`));
  const r = buildStoreTraffic(input(rows));
  assert.equal(r.feed.length, 200);
  assert.equal(r.feedOverflow, 30);
  assert.equal(r.summary.shopeeLinks + r.summary.tiktokLinks, r.feed.length + r.feedOverflow);
});

test("ten thieu/rong -> 'Khách …xxxx', initials 'K'; avatar qua safeAvatar", () => {
  const profiles = new Map<string, UserProfileInfo>([
    ["1234567890", { displayName: "   ", avatarUrl: "javascript:alert(1)" }],
    ["u-ok", { displayName: "Nguyễn Hoàng Trâm Anh", avatarUrl: "https://a.example/x.jpg" }],
  ]);
  const r = buildStoreTraffic(
    input([row("1234567890", "2026-10-23T05:00:00.000Z"), row("u-ok", "2026-10-23T05:00:00.000Z"), row("noprof", "2026-10-23T04:00:00.000Z")], { profiles })
  );
  const byName = new Map(r.scene.characters.map((c) => [c.name, c]));
  assert.ok(byName.has("Khách …7890"));
  assert.equal(byName.get("Khách …7890")!.initials, "K");
  assert.equal(byName.get("Khách …7890")!.avatarUrl, null);
  assert.equal(byName.get("Nguyễn Hoàng Trâm Anh")!.initials, "NA");
  assert.equal(byName.get("Nguyễn Hoàng Trâm Anh")!.avatarUrl, "https://a.example/x.jpg");
  assert.ok(byName.has(fallbackName("noprof")));
});

test("30 user chi vai nguoi co link ngay D: phan con lai visits = []", () => {
  const rows: LinkActivityRow[] = [];
  for (let i = 0; i < 30; i++) rows.push(row(`u${i}`, "2026-10-20T05:00:00.000Z"));
  rows.push(row("u1", "2026-10-23T05:00:00.000Z"), row("u2", "2026-10-23T05:00:00.000Z", "tiktokshop"));
  const r = buildStoreTraffic(input(rows));
  assert.equal(r.scene.characters.filter((c) => c.visits.length > 0).length, 2);
  assert.equal(r.scene.characters.filter((c) => c.visits.length === 0).length, 28);
  assert.equal(r.summary.visitorsToday, 2);
});

test("JSON canh khong chua userId cua ai", () => {
  const r = buildStoreTraffic(input([row("zalo-uid-9988776655", "2026-10-23T05:00:00.000Z")]));
  assert.equal(JSON.stringify(r.scene).includes("9988776655"), false);
});

test("phan bo mau: khong trung trong canh, on dinh voi cung du lieu", () => {
  // 30 seed deu chia het cho 50 -> cung roi vao mau 0 neu chi lay seed mod 50.
  const items = Array.from({ length: 30 }, (_, i) => ({ key: `c${i}`, seed: 50 * (i + 1) }));
  const a = allocateVariants(items);
  const b = allocateVariants([...items].reverse());
  assert.equal(new Set(a.values()).size, 30);
  assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort());
  for (const v of a.values()) assert.ok(v >= 0 && v < 50);
});

test("fnv1a32 + initialsOf co dinh", () => {
  assert.equal(fnv1a32(""), 0x811c9dc5);
  assert.equal(fnv1a32("a"), 0xe40c292c);
  assert.equal(initialsOf("minhlee"), "M");
  assert.equal(initialsOf("to dat"), "TD");
});

test("isToday/tiktokOpen/dayVn di thang vao scene", () => {
  const r = buildStoreTraffic(input([], { isToday: false, tiktokOpen: false, dayVn: "2026-10-22" }));
  assert.equal(r.scene.isToday, false);
  assert.equal(r.scene.tiktokOpen, false);
  assert.equal(r.scene.dayVn, "2026-10-22");
  assert.equal(r.summary.dayVn, "2026-10-22");
});
```

- [ ] **Step 2: Chạy test, xác nhận hỏng**

Run: `npx tsx --test src/core/__tests__/storeTraffic.test.ts`
Expected: FAIL — `Cannot find module '../storeTraffic.js'`.

- [ ] **Step 3: Cài đặt**

`src/core/storeSceneContract.ts`:

```ts
/**
 * Hop dong du lieu giua server va canh 3D cua /admin/cua-hang (2026-10-23). CHI type + hang so: file
 * nay duoc ca src/core lan bundle trinh duyet (src/web) import, khong duoc keo theo thu vien nao.
 *
 * KHONG co userId va KHONG co gio trong du lieu gui xuong: canh chi can thu tu luot ghe, con gio
 * that da hien o bang tin render phia server.
 */
export type StoreId = "shopee" | "tiktokshop";

export const STORE_IDS: readonly StoreId[] = ["shopee", "tiktokshop"];

/** So mau nhan vat co dinh (xem src/web/storeScene/variants.ts). */
export const VARIANT_COUNT = 50;

export interface SceneCharacter {
  /** "c01".."c30" theo thu tu uu tien. */
  key: string;
  /** FNV-1a 32-bit cua userId: on dinh theo user, lam seed PRNG. */
  seed: number;
  /** 0..VARIANT_COUNT-1, da phan bo khong trung trong canh. */
  variant: number;
  name: string;
  initials: string;
  /** Da qua safeAvatarUrl (chi https, khong co ky tu pha CSS). */
  avatarUrl: string | null;
  /** Thu tu thoi gian that cua ngay dang xem; [] = chi di dao. */
  visits: StoreId[];
}

export interface StoreSceneData {
  dayVn: string;
  isToday: boolean;
  tiktokOpen: boolean;
  /** So link tung san ngay D, dem tren MOI user. */
  storeLinks: Record<StoreId, number>;
  /** U_S: so user UNIQUE co >=1 link o san do ngay D, dem tren MOI user. */
  storeUsers: Record<StoreId, number>;
  characters: SceneCharacter[];
}
```

`src/core/storeTraffic.ts`:

```ts
import type { LinkActivityRow } from "./logStore.js";
import type { UserProfileInfo } from "./ledgerStore.js";
import { STORE_IDS, VARIANT_COUNT, type SceneCharacter, type StoreId, type StoreSceneData } from "./storeSceneContract.js";
import { addDaysToVnIso, formatVnDateIso, formatVnTimeHms } from "./vietnamDate.js";

/**
 * Chuan hoa du lieu cho trang /admin/cua-hang (2026-10-23) - HAM THUAN: khong DB, khong express, khong
 * three. Route doc du lieu (chi doc) roi goi ham nay; xem spec
 * docs/superpowers/specs/2026-10-23-cua-hang-hom-nay-design.md muc 3.
 *
 * Mot luot "ghe cua hang" = 1 link tao THANH CONG, KHONG phai don hang.
 */

export const MAX_SCENE_CHARACTERS = 30;
export const FEED_LIMIT = 200;

export interface FeedItem {
  name: string;
  avatarUrl: string | null;
  initials: string;
  merchant: StoreId;
  /** "HH:mm" gio VN that cua luot tao link. */
  timeVn: string;
  productName: string | null;
}

export interface StoreTrafficSummary {
  dayVn: string;
  visitorsToday: number;
  shopeeLinks: number;
  tiktokLinks: number;
  activeUsers7d: number;
  shownCharacters: number;
}

export interface StoreTrafficResult {
  summary: StoreTrafficSummary;
  feed: FeedItem[];
  feedOverflow: number;
  scene: StoreSceneData;
}

export interface StoreTrafficInput {
  /** Da loc 7 ngay lich D-6..D, sap timestamp ASC + rowid ASC (xem logStore.listZaloLinkActivity). */
  rows: LinkActivityRow[];
  profiles: Map<string, UserProfileInfo>;
  dayVn: string;
  isToday: boolean;
  tiktokOpen: boolean;
  /** safeAvatarUrl cua src/api duoc tiem vao - core khong import nguoc src/api. */
  safeAvatar: (url: string | null) => string | null;
}

function isStoreId(value: string | null): value is StoreId {
  return value === "shopee" || value === "tiktokshop";
}

/** FNV-1a 32-bit, ket qua khong dau. On dinh giua cac lan chay (khong phu thuoc may). */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Ten du phong khi bot chua tung thay ten: 4 ky tu cuoi userId de admin van doi chieu duoc. */
export function fallbackName(userId: string): string {
  return `Khách …${userId.slice(-4)}`;
}

/** Chu cai tu DAU + tu CUOI (ten goi tieng Viet nam o cuoi) - cung quy tac userAvatar() o /admin/users. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return "?";
  const first = words[0].charAt(0);
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : "";
  return `${first}${last}`.toLocaleUpperCase("vi");
}

/**
 * Phan bo mau KHONG TRUNG trong canh: sap theo seed (trung seed -> key), moi nguoi lay seed mod count,
 * da dung thi lay mau trong ke tiep. 30 <= 50 nen luon du. Danh doi da chap nhan (spec 3.3): user
 * thuong giu nguyen mau nhung co the doi khi tap nguoi trong canh doi.
 */
export function allocateVariants(items: Array<{ key: string; seed: number }>, count = VARIANT_COUNT): Map<string, number> {
  if (items.length > count) throw new Error(`Qua nhieu nhan vat (${items.length}) so voi so mau (${count})`);
  const sorted = [...items].sort((a, b) => a.seed - b.seed || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const used = new Set<number>();
  const result = new Map<string, number>();
  for (const item of sorted) {
    let v = item.seed % count;
    while (used.has(v)) v = (v + 1) % count;
    used.add(v);
    result.set(item.key, v);
  }
  return result;
}

interface UserAcc {
  userId: string;
  todayVisits: StoreId[];
  lastTs: string;
}

export function buildStoreTraffic(input: StoreTrafficInput): StoreTrafficResult {
  const { rows, profiles, dayVn, isToday, tiktokOpen, safeAvatar } = input;
  const windowStart = addDaysToVnIso(dayVn, -6);

  const users = new Map<string, UserAcc>();
  const todayRows: Array<{ row: LinkActivityRow; merchant: StoreId }> = [];
  for (const row of rows) {
    const day = formatVnDateIso(new Date(row.timestamp));
    // Phong thu: caller dua du lieu rong hon cua so -> bo, khong de ngay ngoai cua so lam lech active.
    if (day < windowStart || day > dayVn) continue;
    let acc = users.get(row.userId);
    if (!acc) {
      acc = { userId: row.userId, todayVisits: [], lastTs: row.timestamp };
      users.set(row.userId, acc);
    }
    if (row.timestamp > acc.lastTs) acc.lastTs = row.timestamp;
    if (day !== dayVn || !isStoreId(row.merchant)) continue;
    acc.todayVisits.push(row.merchant);
    todayRows.push({ row, merchant: row.merchant });
  }

  const profileOf = (userId: string) => {
    const p = profiles.get(userId);
    const trimmed = p?.displayName.trim() ?? "";
    const name = trimmed !== "" ? trimmed : fallbackName(userId);
    return {
      name,
      initials: trimmed !== "" ? initialsOf(trimmed) : "K",
      avatarUrl: safeAvatar(p?.avatarUrl ?? null),
    };
  };

  const ranked = [...users.values()].sort(
    (a, b) =>
      b.todayVisits.length - a.todayVisits.length ||
      (a.lastTs < b.lastTs ? 1 : a.lastTs > b.lastTs ? -1 : 0) ||
      (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0)
  );
  const chosen = ranked.slice(0, MAX_SCENE_CHARACTERS).map((acc, i) => ({
    acc,
    key: `c${String(i + 1).padStart(2, "0")}`,
    seed: fnv1a32(acc.userId),
  }));
  const variants = allocateVariants(chosen.map((c) => ({ key: c.key, seed: c.seed })));
  const characters: SceneCharacter[] = chosen.map((c) => ({
    key: c.key,
    seed: c.seed,
    variant: variants.get(c.key)!,
    ...profileOf(c.acc.userId),
    visits: [...c.acc.todayVisits],
  }));

  const storeLinks: Record<StoreId, number> = { shopee: 0, tiktokshop: 0 };
  const storeUserSets: Record<StoreId, Set<string>> = { shopee: new Set(), tiktokshop: new Set() };
  for (const { row, merchant } of todayRows) {
    storeLinks[merchant] += 1;
    storeUserSets[merchant].add(row.userId);
  }
  const storeUsers = Object.fromEntries(STORE_IDS.map((s) => [s, storeUserSets[s].size])) as Record<StoreId, number>;

  const newestFirst = [...todayRows].reverse();
  const feed: FeedItem[] = newestFirst.slice(0, FEED_LIMIT).map(({ row, merchant }) => {
    const p = profileOf(row.userId);
    return {
      name: p.name,
      avatarUrl: p.avatarUrl,
      initials: p.initials,
      merchant,
      timeVn: formatVnTimeHms(new Date(row.timestamp)).slice(0, 5),
      productName: row.productName && row.productName.trim() !== "" ? row.productName.trim() : null,
    };
  });

  return {
    summary: {
      dayVn,
      visitorsToday: [...users.values()].filter((u) => u.todayVisits.length > 0).length,
      shopeeLinks: storeLinks.shopee,
      tiktokLinks: storeLinks.tiktokshop,
      activeUsers7d: users.size,
      shownCharacters: characters.length,
    },
    feed,
    feedOverflow: Math.max(0, newestFirst.length - FEED_LIMIT),
    scene: { dayVn, isToday, tiktokOpen, storeLinks, storeUsers, characters },
  };
}
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx tsx --test src/core/__tests__/storeTraffic.test.ts`
Expected: PASS (14 tests). Nếu test `fnv1a32("a")` lệch, in giá trị thật bằng `node -e` và **kiểm lại thuật toán** (FNV-1a chuẩn của "a" là `0xe40c292c`) chứ không sửa số trong test.

- [ ] **Step 5: Commit**

```bash
git add src/core/storeSceneContract.ts src/core/storeTraffic.ts src/core/__tests__/storeTraffic.test.ts
git commit -m "feat(cua-hang): chuan hoa du lieu canh (chon 30 user, luot ghe, bang tin, phan bo mau)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Trang `/admin/cua-hang` (server render) + route + menu

**Files:**
- Modify: `src/api/htmlHelpers.ts` (thêm `embedJson`)
- Modify: `src/api/adminDashboardHtml.ts:470-479` (xoá `embedJson` cục bộ, import từ `htmlHelpers`)
- Modify: `src/api/adminAssets.ts` (toàn file)
- Modify: `src/api/adminHtml.ts` (`NAV_ITEMS` dòng 49-58; `ICON_PATHS`; `function safeAvatarUrl` dòng 1671 → `export function`)
- Create: `src/api/adminStoreHtml.ts`
- Modify: `src/api/server.ts` (import + route ngay sau `GET /admin/dashboard`)
- Modify: `src/api/styles/admin.css` (thêm cuối khối `@layer components`)
- Test: `src/api/__tests__/adminStoreRoute.test.ts`

**Interfaces:**
- Consumes: `buildStoreTraffic`, `StoreTrafficResult`, `FeedItem` (Task 2); `listZaloLinkActivity`, `getUserProfilesMap`, `vnDayStartUtcIso` (Task 1).
- Produces:
  - `embedJson(value: unknown): string` (htmlHelpers)
  - `safeAvatarUrl(url: string | null | undefined): string | null` (adminHtml, nay export)
  - `storeSceneJsHref(): string` (adminAssets) → `/admin/assets/store-scene.js?v=...`
  - `type StoreView = "today" | "yesterday"`; `renderStorePage(result: StoreTrafficResult, view: StoreView, sceneScriptHref: string): string`
  - DOM cho bundle: `#store-scene` (khung cảnh), `#store-scene-status` (chữ trạng thái), `#store-scene-data` (`<script type="application/json">`)

- [ ] **Step 1: Viết test hỏng**

`src/api/__tests__/adminStoreRoute.test.ts`:

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
import { LogStore } from "../../core/logStore.js";
import { LinkResolverService } from "../../core/linkResolverService.js";
import { RateLimiter } from "../../core/rateLimiter.js";
import { MockAffiliateProvider } from "../../core/providers/mockProvider.js";
import { MERCHANTS } from "../../core/merchants.js";
import { addDaysToVnIso, todayVnIso } from "../../core/vietnamDate.js";
import type { StoreSceneData } from "../../core/storeSceneContract.js";

/** Trang /admin/cua-hang (2026-10-23) - xem spec 2026-10-23-cua-hang-hom-nay-design.md. */

const ADMIN_PASSWORD = "test-admin-password";
const ORDER_CONFIG = { taxPercent: 0, platformFeePercent: 0, userSharePercent: 80, maxCommissionRatioPercent: 1000, holdConfig: { thresholdVnd: 0, holdDays: 0 } };

function setup() {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  const rateLimiter = new RateLimiter(1000, 60_000);
  const adminLoginRateLimiter = new RateLimiter(1000, 60_000);
  const resolver = new LinkResolverService(new MockAffiliateProvider(), logStore, rateLimiter);
  const withdrawalProofDir = mkdtempSync(join(tmpdir(), "withdrawal-proofs-store-"));
  const app = createServer(resolver, logStore, ledgerStore, async () => {}, 50_000, new AdminSessionStore(ADMIN_PASSWORD), ORDER_CONFIG, withdrawalProofDir, adminLoginRateLimiter, "http://localhost:3002", async () => {});
  const httpServer = app.listen(0);
  const port = (httpServer.address() as AddressInfo).port;
  return {
    logStore,
    ledgerStore,
    baseUrl: `http://127.0.0.1:${port}`,
    cleanup() {
      httpServer.close();
      rateLimiter.stop();
      adminLoginRateLimiter.stop();
      logStore.close();
      ledgerStore.close();
      rmSync(withdrawalProofDir, { recursive: true, force: true });
    },
  };
}

async function loginCookie(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `password=${encodeURIComponent(ADMIN_PASSWORD)}`,
    redirect: "manual",
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function getPage(baseUrl: string, query = ""): Promise<string> {
  const cookie = await loginCookie(baseUrl);
  const res = await fetch(`${baseUrl}/admin/cua-hang${query}`, { headers: { cookie } });
  assert.equal(res.status, 200);
  return res.text();
}

function sceneJson(html: string): StoreSceneData {
  const m = html.match(/<script type="application\/json" id="store-scene-data">([\s\S]*?)<\/script>/);
  assert.ok(m, "thieu khoi JSON du lieu canh");
  return JSON.parse(m[1]) as StoreSceneData;
}

/** 12:00 gio VN cua ngay `dayIso` - luon nam trong ngay do bat ke may chay test luc may gio. */
function noonVn(dayIso: string): string {
  return `${dayIso}T05:00:00.000Z`;
}

function recordLink(logStore: LogStore, userId: string, timestamp: string, merchant: "shopee" | "tiktokshop" = "shopee", productName?: string) {
  logStore.record({ platform: "zalo", merchant, userId, originalUrl: "https://shopee.vn/product/1/2", subId: `k-${userId}-x`, outcome: "success", errorCode: null, affiliateUrl: "https://bot.example/s/abc", productName, timestamp });
}

test("chua dang nhap -> 303 ve trang login", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const res = await fetch(`${baseUrl}/admin/cua-hang`, { redirect: "manual" });
    assert.equal(res.status, 303);
    assert.match(res.headers.get("location") ?? "", /\/admin\/login/);
  } finally {
    cleanup();
  }
});

test("hom nay: tom tat, bang tin, JSON canh, menu, chu thich bat buoc", async () => {
  const { baseUrl, logStore, ledgerStore, cleanup } = setup();
  try {
    const today = todayVnIso();
    ledgerStore.upsertUserProfile("zalo", "uid-111122223333", "minhlee", "https://avatar.example/m.jpg");
    recordLink(logStore, "uid-111122223333", noonVn(today), "shopee", "Áo linen form chuẩn Hàn Quốc");
    recordLink(logStore, "uid-111122223333", noonVn(today), "shopee");
    const html = await getPage(baseUrl);
    assert.match(html, /Cửa hàng hôm nay/);
    assert.match(html, /href="\/admin\/cua-hang"[^>]*aria-current="page"/);
    assert.match(html, /<strong>1<\/strong> người ghé cửa hàng · <strong>2<\/strong> link Shopee/);
    assert.match(html, /vừa săn <strong>Áo linen form chuẩn Hàn Quốc<\/strong>/);
    assert.match(html, /vừa tạo link Shopee/);
    assert.match(html, /không phải đơn hàng/);
    assert.match(html, /id="store-scene-status"/);
    assert.match(html, /src="\/admin\/assets\/store-scene\.js\?v=/);
    const scene = sceneJson(html);
    assert.equal(scene.isToday, true);
    assert.equal(scene.dayVn, today);
    assert.equal(scene.characters[0].visits.length, 2);
    assert.equal(scene.tiktokOpen, MERCHANTS.some((m) => m.id === "tiktokshop"));
    assert.equal(html.includes("111122223333"), false, "userId khong duoc lot ra trang");
  } finally {
    cleanup();
  }
});

test("?ngay=homqua lui 1 ngay; ?ngay= la -> hom nay", async () => {
  const { baseUrl, logStore, cleanup } = setup();
  try {
    const yesterday = addDaysToVnIso(todayVnIso(), -1);
    recordLink(logStore, "u-y", noonVn(yesterday));
    const y = sceneJson(await getPage(baseUrl, "?ngay=homqua"));
    assert.equal(y.isToday, false);
    assert.equal(y.dayVn, yesterday);
    assert.deepEqual(y.characters[0].visits, ["shopee"]);
    const t = sceneJson(await getPage(baseUrl, "?ngay=abc"));
    assert.equal(t.isToday, true);
    assert.deepEqual(t.characters[0].visits, []); // hom qua co link -> hom nay chi di dao
  } finally {
    cleanup();
  }
});

test("ten doc hai khong pha trang; avatar khong an toan -> null", async () => {
  const { baseUrl, logStore, ledgerStore, cleanup } = setup();
  try {
    const evil = `</script><img src=x onerror=alert(1)>`;
    ledgerStore.upsertUserProfile("zalo", "u-evil", evil, "https://x.example/a.jpg')");
    recordLink(logStore, "u-evil", noonVn(todayVnIso()), "shopee", `<b>${evil}</b>`);
    const html = await getPage(baseUrl);
    assert.equal(html.includes("<img src=x"), false);
    assert.equal(html.includes("</script><img"), false);
    const scene = sceneJson(html);
    assert.equal(scene.characters[0].name, evil); // JSON.parse tra lai dung chuoi goc
    assert.equal(scene.characters[0].avatarUrl, null);
  } finally {
    cleanup();
  }
});

test("ngay khong co link: bang tin rong co cau thong bao", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const html = await getPage(baseUrl);
    assert.match(html, /Chưa có lượt tạo link nào trong ngày/);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Chạy test, xác nhận hỏng**

Run: `npx tsx --test src/api/__tests__/adminStoreRoute.test.ts`
Expected: FAIL — route trả 404 (sau login) / `assert.equal(res.status, 200)` hỏng.

- [ ] **Step 3a: Helper dùng chung**

`src/api/htmlHelpers.ts` — thêm:

```ts
/**
 * Nhung du lieu vao <script type="application/json"> roi JSON.parse o client - KHONG noi chuoi du
 * lieu thang vao ma JS. Ten user/ten san pham la chuoi NGUOI LA nhap. Van phai chan "</script" (ke ca
 * viet hoa) vi trinh duyet dong the script ngay tai do; "<" -> \\u003c vua du va van la JSON hop le.
 * (Chuyen tu adminDashboardHtml.ts 2026-10-23 de /admin/cua-hang dung chung.)
 */
export function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
```

`src/api/adminDashboardHtml.ts`: xoá nguyên khối comment + `function embedJson(...) { ... }` (dòng ~470-479) và thêm `embedJson` vào import từ `"./htmlHelpers.js"` (nếu file chưa import gì từ đó thì thêm dòng `import { embedJson } from "./htmlHelpers.js";`).

`src/api/adminAssets.ts` — thay phần sau comment đầu file:

```ts
const cachedHrefs = new Map<string, string>();

/** Duong dan 1 file da build trong public/, kem "van" theo mtime (xem comment dau file). */
function assetHref(file: string): string {
  const cached = cachedHrefs.get(file);
  if (cached !== undefined) return cached;
  let version = "dev";
  try {
    version = Math.trunc(statSync(resolve(process.cwd(), "public", file)).mtimeMs).toString(36);
  } catch {
    // Khong co file - giu "dev". Voi CSS: canh bao da in o server.ts. Voi store-scene.js: the script
    // tai loi -> onerror tren trang hien cau "Khong hien thi duoc canh 3D".
  }
  const href = `/admin/assets/${file}?v=${version}`;
  cachedHrefs.set(file, href);
  return href;
}

export function adminCssHref(): string {
  return assetHref("admin.css");
}

/** Bundle canh 3D cua /admin/cua-hang (2026-10-23), sinh boi `npm run build:scene`. */
export function storeSceneJsHref(): string {
  return assetHref("store-scene.js");
}
```

`src/api/adminHtml.ts`:
- Đổi `function safeAvatarUrl(` thành `export function safeAvatarUrl(`.
- `NAV_ITEMS`: thêm ngay sau dòng `dashboard`:
  ```ts
  { key: "store", href: "/admin/cua-hang", label: "Cửa hàng hôm nay", icon: "store" },
  ```
- `ICON_PATHS`: thêm entry (icon Lucide "store"):
  ```ts
  store:
    '<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/><path d="M22 7v3a2 2 0 0 1-2 2 2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7"/>',
  ```

- [ ] **Step 3b: Trang**

`src/api/adminStoreHtml.ts`:

```ts
import type { FeedItem, StoreTrafficResult } from "../core/storeTraffic.js";
import { getMerchantAdminName } from "../core/merchants.js";
import { embedJson, escapeHtml } from "./htmlHelpers.js";

/**
 * Trang "Cua hang hom nay" (/admin/cua-hang, 2026-10-23). Chi render phan THAN - server boc adminShell.
 * Tom tat + bang tin la HTML thuan (khong phu thuoc JS); canh 3D do bundle public/store-scene.js ve vao
 * #store-scene tu du lieu trong #store-scene-data. Spec: docs/superpowers/specs/2026-10-23-cua-hang-hom-nay-design.md.
 *
 * Chu tren trang KHONG noi "mua"/"dat": 1 luot vao cua hang = 1 link tao thanh cong, khong phai don.
 */

export type StoreView = "today" | "yesterday";

const SCENE_FAIL_TEXT = "Không hiển thị được cảnh 3D trên trình duyệt này.";

function ddmm(dayIso: string): string {
  const [, month, day] = dayIso.split("-");
  return `${day}/${month}`;
}

function avatarHtml(item: { avatarUrl: string | null; initials: string }): string {
  // avatarUrl da qua safeAvatarUrl (chi https, khong co ' " ( ) \\ hay khoang trang) nen dat duoc vao url('').
  return item.avatarUrl
    ? `<span class="store-card-avatar" style="background-image:url('${item.avatarUrl}')" aria-hidden="true"></span>`
    : `<span class="store-card-avatar" aria-hidden="true">${escapeHtml(item.initials)}</span>`;
}

function feedCard(item: FeedItem): string {
  const merchantName = getMerchantAdminName(item.merchant);
  const action = item.productName
    ? `vừa săn <strong>${escapeHtml(item.productName)}</strong>`
    : `vừa tạo link ${escapeHtml(merchantName)}`;
  return `<li class="store-card">
    ${avatarHtml(item)}
    <div class="min-w-0">
      <p class="store-card-text"><strong>${escapeHtml(item.name)}</strong> ${action}</p>
      <div class="store-card-meta"><span class="store-chip store-chip-${item.merchant}">${escapeHtml(merchantName)}</span><span>${item.timeVn}</span></div>
    </div>
  </li>`;
}

export function renderStorePage(result: StoreTrafficResult, view: StoreView, sceneScriptHref: string): string {
  const { summary, feed, feedOverflow, scene } = result;
  const day = ddmm(summary.dayVn);
  const tab = (target: StoreView, href: string, label: string) =>
    `<a class="store-tab${view === target ? " is-active" : ""}" href="${href}"${view === target ? ' aria-current="true"' : ""}>${label}</a>`;
  const shownNote =
    summary.activeUsers7d > summary.shownCharacters
      ? ` · Cảnh hiển thị ${summary.shownCharacters}/${summary.activeUsers7d} người`
      : "";
  const feedHtml =
    feed.length === 0
      ? `<li class="store-feed-empty">Chưa có lượt tạo link nào trong ngày</li>`
      : feed.map(feedCard).join("") +
        (feedOverflow > 0 ? `<li class="store-feed-empty">… và ${feedOverflow} lượt khác</li>` : "");

  return `
<div class="store-head">
  <nav class="store-tabs" aria-label="Chọn ngày">
    ${tab("today", "/admin/cua-hang", "Hôm nay")}
    ${tab("yesterday", "/admin/cua-hang?ngay=homqua", "Hôm qua")}
  </nav>
  <p class="store-summary">Ngày ${day}: <strong>${summary.visitorsToday}</strong> người ghé cửa hàng · <strong>${summary.shopeeLinks}</strong> link Shopee · <strong>${summary.tiktokLinks}</strong> link TikTok · <strong>${summary.activeUsers7d}</strong> người active 7 ngày${shownNote}</p>
</div>
<div class="store-layout">
  <section>
    <div id="store-scene" class="store-scene">
      <p id="store-scene-status" class="store-scene-status">Đang tải cảnh 3D…</p>
    </div>
    <p class="store-caption">Cảnh diễn lại các lượt tạo link thành công của ngày ${day} với nhịp rút gọn. Mỗi lần vào cửa hàng = 1 link, không phải đơn hàng. Giờ thật xem ở bảng bên cạnh.</p>
  </section>
  <aside class="store-feed" aria-label="Lượt tạo link trong ngày">
    <ol class="store-feed-list">${feedHtml}</ol>
  </aside>
</div>
<script type="application/json" id="store-scene-data">${embedJson(scene)}</script>
<script type="module" src="${sceneScriptHref}" onerror="var s=document.getElementById('store-scene-status');if(s){s.textContent='${SCENE_FAIL_TEXT}'}"></script>`;
}
```

- [ ] **Step 3c: Route**

`src/api/server.ts` — thêm import (gộp vào dòng import sẵn có nếu đã import từ cùng module):

```ts
import { buildStoreTraffic } from "../core/storeTraffic.js";
import { addDaysToVnIso, todayVnIso, vnDayStartUtcIso } from "../core/vietnamDate.js";
import { renderStorePage } from "./adminStoreHtml.js";
import { storeSceneJsHref } from "./adminAssets.js";
// + them safeAvatarUrl vao import tu "./adminHtml.js"
```

Thêm route ngay sau `app.get("/admin/dashboard", ...)`:

```ts
  // Trang "Cua hang hom nay" (2026-10-23): mo phong 3D luot tao link THANH CONG cua user Zalo trong
  // ngay. CHI DOC 2 DB; khong API JSON moi - du lieu nhung thang vao trang. Spec 2026-10-23-cua-hang-hom-nay.
  app.get("/admin/cua-hang", requireAdminAuth, (req: Request, res: Response) => {
    const view = req.query.ngay === "homqua" ? "yesterday" : "today";
    const today = todayVnIso();
    const dayVn = view === "today" ? today : addDaysToVnIso(today, -1);
    const rows = logStore.listZaloLinkActivity(
      vnDayStartUtcIso(addDaysToVnIso(dayVn, -6)),
      vnDayStartUtcIso(addDaysToVnIso(dayVn, 1))
    );
    const result = buildStoreTraffic({
      rows,
      profiles: ledgerStore.getUserProfilesMap("zalo"),
      dayVn,
      isToday: view === "today",
      // Trang thai mo/dong lay tu CAU HINH hien tai, khong suy tu du lieu (spec muc 7).
      tiktokOpen: MERCHANTS.some((m) => m.id === "tiktokshop"),
      safeAvatar: (url) => safeAvatarUrl(url),
    });
    res
      .type("html")
      .send(adminShell("store", "Cửa hàng hôm nay", renderStorePage(result, view, storeSceneJsHref()), navPendingWithdrawals()));
  });
```

- [ ] **Step 3d: CSS**

`src/api/styles/admin.css` — thêm vào CUỐI khối `@layer components { ... }` (trước dấu `}` đóng khối). CSS viết tay có chủ đích (bẫy Tailwind thứ ba: không đưa giá trị phức tạp vào utility tuỳ ý):

```css
  /* ---- /admin/cua-hang (2026-10-23) ---- */
  .store-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
  .store-tabs { display: inline-flex; gap: 4px; padding: 4px; border-radius: 12px; background: #eef0f4; }
  .store-tab { padding: 6px 14px; border-radius: 9px; font-size: 13px; font-weight: 600; color: #475569; text-decoration: none; }
  .store-tab.is-active { background: #fff; color: #0f172a; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08); }
  .store-summary { margin: 0; font-size: 13px; color: #334155; }
  .store-layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: stretch; }
  @media (max-width: 1439px) { .store-layout { grid-template-columns: minmax(0, 1fr) 300px; } }
  .store-scene { position: relative; aspect-ratio: 16 / 10; border-radius: 16px; overflow: hidden; background: #f6efe6; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06), 0 8px 24px rgba(15, 23, 42, 0.08); }
  .store-scene canvas { display: block; }
  .store-scene-status { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; margin: 0; padding: 16px; text-align: center; font-size: 14px; color: #64748b; }
  .store-caption { margin: 8px 2px 0; font-size: 12px; color: #64748b; }
  .store-feed { position: relative; min-height: 320px; }
  .store-feed-list { position: absolute; inset: 0; margin: 0; padding: 2px 4px 2px 2px; list-style: none; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
  .store-feed-empty { padding: 16px; font-size: 13px; color: #64748b; text-align: center; }
  .store-card { display: flex; gap: 10px; padding: 10px 12px; border-radius: 12px; background: linear-gradient(180deg, #fff, #f8fafc); border: 1px solid #e2e8f0; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 2px 4px rgba(15, 23, 42, 0.06), 0 8px 16px -8px rgba(15, 23, 42, 0.18); }
  .store-card-avatar { flex: none; width: 32px; height: 32px; border-radius: 9999px; background: #e2e8f0 center / cover no-repeat; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: #475569; }
  .store-card-text { margin: 0; font-size: 13px; line-height: 1.4; color: #0f172a; overflow-wrap: anywhere; }
  .store-card-meta { margin-top: 4px; display: flex; gap: 6px; align-items: center; font-size: 11px; color: #64748b; }
  .store-chip { padding: 1px 6px; border-radius: 4px; font-weight: 600; }
  .store-chip-shopee { background: #fff1ea; color: #c2410c; }
  .store-chip-tiktokshop { background: #0f172a; color: #fff; }
  .scene-label-layer { position: absolute; inset: 0; pointer-events: none; }
  .scene-label { display: flex; align-items: center; gap: 5px; padding: 3px 8px 3px 3px; border-radius: 9999px; background: #fff; box-shadow: 0 2px 6px rgba(15, 23, 42, 0.18); font: 600 11px/1 Inter, system-ui, sans-serif; color: #0f172a; white-space: nowrap; pointer-events: none; }
  .scene-label-avatar { width: 18px; height: 18px; border-radius: 9999px; background: #e2e8f0 center / cover no-repeat; display: flex; align-items: center; justify-content: center; font-size: 9px; color: #475569; }
  .scene-label-name { max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
  .scene-label-count { padding: 2px 5px; border-radius: 9999px; background: #0f172a; color: #fff; font-size: 10px; font-weight: 800; }
  .scene-board { padding: 6px 12px; border-radius: 10px; font: 800 14px/1 Inter, system-ui, sans-serif; white-space: nowrap; pointer-events: none; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.25); }
  .scene-board-shopee { background: #ee4d2d; color: #fff; }
  .scene-board-tiktokshop { background: #111; color: #fff; border: 2px solid #25f4ee; box-shadow: 0 0 0 2px #fe2c55, 0 4px 12px rgba(15, 23, 42, 0.25); }
  .scene-board.is-closed { background: #64748b; color: #fff; border-color: #94a3b8; box-shadow: none; }
```

- [ ] **Step 4: Chạy test, xác nhận xanh + không hồi quy**

Run: `npx tsx --test src/api/__tests__/adminStoreRoute.test.ts src/api/__tests__/adminDashboardRoute.test.ts`
Expected: PASS toàn bộ.

Run: `npm run typecheck && npm run build:css && grep -F ".store-card{" public/admin.css | head -c 80`
Expected: typecheck sạch; grep in ra một đoạn CSS (xác nhận class được build, xem bẫy Tailwind thứ ba trong `admin-ui-nen-tang.md`; dùng `grep -F`).

- [ ] **Step 5: Commit**

```bash
git add src/api/htmlHelpers.ts src/api/adminDashboardHtml.ts src/api/adminAssets.ts src/api/adminHtml.ts src/api/adminStoreHtml.ts src/api/server.ts src/api/styles/admin.css src/api/__tests__/adminStoreRoute.test.ts
git commit -m "feat(cua-hang): trang /admin/cua-hang (tom tat, bang tin, du lieu canh) + menu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Hạ tầng bundle trình duyệt + bản đồ thế giới + tìm đường

**Files:**
- Modify: `package.json` (scripts + devDependencies)
- Modify: `tsconfig.json` (`exclude`)
- Create: `tsconfig.web.json`
- Create: `src/web/storeScene/layout.ts`
- Create: `src/web/storeScene/sim/rng.ts`
- Create: `src/web/storeScene/sim/pathfinding.ts`
- Create: `src/web/storeScene/main.ts` (bản tạm, thay ở Task 7)
- Test: `src/web/storeScene/__tests__/layout.test.ts`

**Interfaces:**
- Consumes: `StoreId` (`src/core/storeSceneContract.ts`).
- Produces (`layout.ts`):
  ```ts
  export interface Vec2 { x: number; z: number }
  export type NodeKind = "corner"|"sidewalk"|"spawn"|"approach"|"door-out"|"door-in"|"hub"|"spot"|"queue"|"bench";
  export interface LayoutNode { id: string; x: number; z: number; kind: NodeKind; store?: StoreId; facing?: number; outdoor: boolean }
  export interface LayoutEdge { a: string; b: string; crosswalk: boolean }
  export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }
  export const MAP_HALF, ROAD_HALF, SIDEWALK_CENTER, CURB_HEIGHT, VIEW_PITCH_DEG, VIEW_TAN, STORE_DEPTH, STORE_WIDTH, STORE_WALL_HEIGHT, STORE_HEIGHT, GLASS_TOP, HEAD_HEIGHT, QUEUE_SLOTS, BROWSE_SPOTS, FLOOR_HEIGHT
  export const NODES: readonly LayoutNode[]; export const EDGES: readonly LayoutEdge[];
  export function node(id: string): LayoutNode;
  export function storeNode(store: StoreId, name: string): string;   // name: "A"|"Dout"|"Din"|"H"|"S1".."S5"|"Q1".."Q10"|"C"
  export const SPAWN_NODES: readonly string[];
  export const STROLL_LOOPS: { front: readonly string[]; frontBench: readonly string[]; back: readonly string[] };
  export const FOOTPRINTS: Record<StoreId, Rect>;
  export const STORE_FACADE_CENTER: Record<StoreId, Vec2>;   // tam mat tien (the gioi)
  export const CROSSWALKS: readonly Rect[];
  export const DECOR: { trees: Vec2[]; lamps: Vec2[]; planters: Vec2[]; bench: { x: number; z: number; rotationY: number } };
  export function toShopeeFrame(store: StoreId, p: Vec2): Vec2;
  export function groundY(x: number, z: number): number;
  ```
- Produces (`sim/rng.ts`): `type Rng = () => number; mulberry32(seed: number): Rng; randRange(rng: Rng, min: number, max: number): number`
- Produces (`sim/pathfinding.ts`): `findPath(from: string, to: string): readonly string[]` (gồm cả `from` và `to`; mảng cache — caller KHÔNG được sửa)

- [ ] **Step 1: Cài thư viện + cấu hình build**

Run: `npm install -D three @types/three esbuild`

`package.json` → `scripts` (giữ nguyên các script khác):

```json
"dev": "npm run build:css && npm run build:scene && tsx watch src/index.ts",
"build:scene": "esbuild src/web/storeScene/main.ts --bundle --format=esm --minify --target=es2020 --legal-comments=none --outfile=public/store-scene.js",
"build": "npm run build:css && npm run build:scene && tsc -p tsconfig.json && npm run build:assets",
"test": "tsx --test src/core/__tests__/*.test.ts src/core/faq/__tests__/*.test.ts src/api/__tests__/*.test.ts src/adapters/shared/__tests__/*.test.ts src/adapters/zalo/__tests__/*.test.ts src/scripts/__tests__/*.test.ts src/web/storeScene/__tests__/*.test.ts",
"typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.web.json"
```

`tsconfig.json`: đổi `"exclude": ["node_modules", "dist"]` thành `"exclude": ["node_modules", "dist", "src/web"]` (code trình duyệt cần lib DOM, tsconfig chính không có).

`tsconfig.web.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "types": ["node"]
  },
  "include": ["src/web/**/*.ts", "src/core/storeSceneContract.ts"]
}
```

`src/web/storeScene/main.ts` (tạm, để `build:scene` chạy được; Task 7 thay toàn bộ):

```ts
// Diem vao bundle canh 3D cua /admin/cua-hang. Ban tam - xem Task 7 cua plan 2026-10-23-cua-hang-hom-nay.
export {};
```

- [ ] **Step 2: Viết test hỏng**

`src/web/storeScene/__tests__/layout.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BROWSE_SPOTS, CROSSWALKS, EDGES, FOOTPRINTS, GLASS_TOP, HEAD_HEIGHT, MAP_HALF, NODES, QUEUE_SLOTS,
  ROAD_HALF, SPAWN_NODES, STORE_HEIGHT, STROLL_LOOPS, VIEW_TAN, node, storeNode, toShopeeFrame, type Vec2,
} from "../layout.js";
import { findPath } from "../sim/pathfinding.js";
import { STORE_IDS } from "../../../core/storeSceneContract.js";

const inRect = (p: Vec2, r: { minX: number; maxX: number; minZ: number; maxZ: number }) =>
  p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ;
const onRoad = (p: Vec2) => Math.abs(p.x) < ROAD_HALF || Math.abs(p.z) < ROAD_HALF;
const SHOPEE_FACADE_X = FOOTPRINTS.shopee.maxX;
const SHOPEE_SIDE_GLASS_Z = FOOTPRINTS.shopee.maxZ;

function sampleSegment(a: Vec2, b: Vec2, step = 0.05): Vec2[] {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / step));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n }));
}

test("id node duy nhat, moi canh tro toi node co that, node nam trong ban do", () => {
  const ids = new Set(NODES.map((n) => n.id));
  assert.equal(ids.size, NODES.length);
  for (const e of EDGES) {
    assert.ok(ids.has(e.a), e.a);
    assert.ok(ids.has(e.b), e.b);
  }
  for (const n of NODES) assert.ok(Math.abs(n.x) <= MAP_HALF && Math.abs(n.z) <= MAP_HALF, n.id);
});

test("moi shop co du 5 cho xem hang, 10 o cho, va storeNode tra id co that", () => {
  for (const s of STORE_IDS) {
    for (let i = 1; i <= BROWSE_SPOTS; i++) assert.equal(node(storeNode(s, `S${i}`)).kind, "spot");
    for (let i = 1; i <= QUEUE_SLOTS; i++) assert.equal(node(storeNode(s, `Q${i}`)).kind, "queue");
    for (const name of ["A", "Dout", "Din", "H", "C"]) assert.ok(node(storeNode(s, name)));
  }
});

test("(12) do thi lien thong: moi cap node deu co duong", () => {
  for (const n of NODES) assert.ok(findPath(SPAWN_NODES[0], n.id).length > 0, n.id);
});

test("(12) duong tim duoc chi dung canh co that va bat dau/ket thuc dung", () => {
  const edgeSet = new Set(EDGES.flatMap((e) => [`${e.a}|${e.b}`, `${e.b}|${e.a}`]));
  for (const from of SPAWN_NODES) {
    for (const s of STORE_IDS) {
      const path = findPath(from, storeNode(s, "S3"));
      assert.equal(path[0], from);
      assert.equal(path[path.length - 1], storeNode(s, "S3"));
      for (let i = 1; i < path.length; i++) assert.ok(edgeSet.has(`${path[i - 1]}|${path[i]}`));
    }
  }
});

test("(12) qua duong CHI bang canh vach: canh thuong khong cham long duong", () => {
  for (const e of EDGES) {
    if (e.crosswalk) continue;
    for (const p of sampleSegment(node(e.a), node(e.b))) assert.equal(onRoad(p), false, `${e.a}-${e.b} cat qua duong`);
  }
  for (const e of EDGES.filter((x) => x.crosswalk)) {
    const mid = { x: (node(e.a).x + node(e.b).x) / 2, z: (node(e.a).z + node(e.b).z) / 2 };
    assert.ok(CROSSWALKS.some((r) => inRect(mid, r)), `${e.a}-${e.b} khong nam tren vach`);
  }
});

test("canh ngoai troi khong xuyen nha; chi cap cua (Dout-Din) di qua mat tien", () => {
  for (const e of EDGES) {
    const a = node(e.a), b = node(e.b);
    if (!a.outdoor || !b.outdoor) continue;
    for (const p of sampleSegment(a, b)) for (const s of STORE_IDS) assert.equal(inRect(p, FOOTPRINTS[s]), false, `${e.a}-${e.b}`);
  }
});

test("(13) khong diem ngoai troi nao bi nha che theo huong camera", () => {
  const reach = (STORE_HEIGHT - HEAD_HEIGHT) / VIEW_TAN;
  for (const n of NODES.filter((x) => x.outdoor)) {
    for (let d = 0; d <= reach; d += 0.05) {
      const s = d / Math.SQRT2;
      const p = { x: n.x + s, z: n.z + s };
      for (const st of STORE_IDS) assert.equal(inRect(p, FOOTPRINTS[st]), false, `${n.id} bi ${st} che`);
    }
  }
});

test("(13) cho xem hang nhin thay duoc qua kinh (dau nhan vat khong bi mai che)", () => {
  const maxDiag = (GLASS_TOP - HEAD_HEIGHT) / VIEW_TAN;
  for (const s of STORE_IDS) {
    for (let i = 1; i <= BROWSE_SPOTS; i++) {
      const p = toShopeeFrame(s, node(storeNode(s, `S${i}`)));
      const delta = Math.min(SHOPEE_FACADE_X - p.x, SHOPEE_SIDE_GLASS_Z - p.z);
      assert.ok(delta * Math.SQRT2 <= maxDiag, `${s} S${i} bi mai che (delta ${delta.toFixed(2)})`);
    }
  }
});

test("hang cho: cach deu, khong chan vach sang duong, khong che mat kinh", () => {
  const shade = HEAD_HEIGHT / VIEW_TAN; // trong khoang nay nguoi dung che mat kinh phia sau
  for (const s of STORE_IDS) {
    const slots = Array.from({ length: QUEUE_SLOTS }, (_, i) => node(storeNode(s, `Q${i + 1}`)));
    for (let i = 1; i < slots.length; i++) {
      const gap = Math.hypot(slots[i].x - slots[i - 1].x, slots[i].z - slots[i - 1].z);
      assert.ok(gap >= 0.6 && gap <= 0.9, `${s} Q${i}-Q${i + 1} cach ${gap.toFixed(2)}`);
    }
    for (const q of slots) {
      for (const r of CROSSWALKS) assert.equal(inRect(q, { minX: r.minX - 1, maxX: r.maxX + 1, minZ: r.minZ - 1, maxZ: r.maxZ + 1 }), false);
      const p = toShopeeFrame(s, q);
      for (let d = 0; d <= shade; d += 0.02) {
        const k = d / Math.SQRT2;
        const back = { x: p.x - k, z: p.z - k };
        const hitsFacade = Math.abs(back.x - SHOPEE_FACADE_X) < 0.03 && back.z >= FOOTPRINTS.shopee.minZ && back.z <= SHOPEE_SIDE_GLASS_Z;
        const hitsSide = Math.abs(back.z - SHOPEE_SIDE_GLASS_Z) < 0.03 && back.x >= FOOTPRINTS.shopee.minX && back.x <= SHOPEE_FACADE_X;
        assert.equal(hitsFacade || hitsSide, false, `${s} ${q.id} che mat kinh`);
      }
    }
  }
});

test("TikTok = Shopee doi x<->z (camera doi xung qua mat x=z)", () => {
  const shopeeSpot = node(storeNode("shopee", "S1"));
  const tiktokSpot = node(storeNode("tiktokshop", "S1"));
  assert.equal(tiktokSpot.x, shopeeSpot.z);
  assert.equal(tiktokSpot.z, shopeeSpot.x);
  assert.deepEqual(FOOTPRINTS.tiktokshop, { minX: FOOTPRINTS.shopee.minZ, maxX: FOOTPRINTS.shopee.maxZ, minZ: FOOTPRINTS.shopee.minX, maxZ: FOOTPRINTS.shopee.maxX });
});

test("vong dao khep kin va di duoc", () => {
  for (const loop of [STROLL_LOOPS.front, STROLL_LOOPS.frontBench, STROLL_LOOPS.back]) {
    assert.equal(loop[0], loop[loop.length - 1]);
    for (let i = 1; i < loop.length; i++) assert.equal(findPath(loop[i - 1], loop[i]).length, 2, `${loop[i - 1]}-${loop[i]} khong ke nhau`);
  }
});
```

- [ ] **Step 3: Chạy test, xác nhận hỏng**

Run: `npx tsx --test src/web/storeScene/__tests__/layout.test.ts`
Expected: FAIL — `Cannot find module '../layout.js'`.

- [ ] **Step 4: Cài đặt**

`src/web/storeScene/sim/rng.ts`:

```ts
/** PRNG mulberry32: cung seed -> cung chuoi so, nen cung du lieu thi canh dien y het (de debug). */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randRange(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}
```

`src/web/storeScene/layout.ts`:

```ts
import type { StoreId } from "../../core/storeSceneContract.js";

/**
 * Ban do the gioi cua canh /admin/cua-hang (2026-10-23) - DU LIEU THUAN, dung chung boi lop mo phong va
 * lop hien thi nen 2 ben khong the lech nhau. Mat phang XZ, Y huong len. Camera nhin tu goc (+X,+Z):
 * - goc trai man hinh = -X, goc phai man hinh = -Z, phia truoc (gan nguoi xem) = +X+Z.
 * Shopee o khoi trai (-X,+Z), TikTok o khoi phai (+X,-Z) = Shopee doi x<->z (camera doi xung qua x=z).
 * Test hinh hoc o __tests__/layout.test.ts chot cac rang buoc (khong bi nha che, qua duong o vach...).
 */

export interface Vec2 { x: number; z: number }
export type NodeKind = "corner" | "sidewalk" | "spawn" | "approach" | "door-out" | "door-in" | "hub" | "spot" | "queue" | "bench";
export interface LayoutNode { id: string; x: number; z: number; kind: NodeKind; store?: StoreId; facing?: number; outdoor: boolean }
export interface LayoutEdge { a: string; b: string; crosswalk: boolean }
export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }

export const MAP_HALF = 14;
export const ROAD_HALF = 2;
export const SIDEWALK_CENTER = 3.2;
export const CURB_HEIGHT = 0.15;
export const FLOOR_HEIGHT = CURB_HEIGHT + 0.05;
export const VIEW_PITCH_DEG = 35;
export const VIEW_TAN = Math.tan((VIEW_PITCH_DEG * Math.PI) / 180);
export const STORE_DEPTH = 3.6;
export const STORE_WIDTH = 4.4;
export const STORE_WALL_HEIGHT = 3.2;
export const STORE_HEIGHT = 3.4; // gom mai
export const GLASS_TOP = 2.8;
export const HEAD_HEIGHT = 1.0;
export const QUEUE_SLOTS = 10;
export const BROWSE_SPOTS = 5;

function swap(p: Vec2): Vec2 {
  return { x: p.z, z: p.x };
}
/** Huong (heading = atan2(dx, dz)) sau khi doi x<->z. */
function swapFacing(facing: number): number {
  return Math.PI / 2 - facing;
}
function headingTo(from: Vec2, to: Vec2): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

// ---- Shopee (toa do the gioi); TikTok sinh bang swap ----
const SHOPEE_FOOTPRINT: Rect = { minX: -5 - STORE_DEPTH, maxX: -5, minZ: 6.8 - STORE_WIDTH / 2, maxZ: 6.8 + STORE_WIDTH / 2 };

interface StoreDef { name: string; x: number; z: number; kind: NodeKind; facing?: number; outdoor: boolean }
const SHOPEE_DEFS: StoreDef[] = [
  { name: "A", x: -3.2, z: 6.4, kind: "approach", outdoor: true },
  { name: "Dout", x: -4.4, z: 7.9, kind: "door-out", facing: -Math.PI / 2, outdoor: true },
  { name: "Din", x: -5.6, z: 7.9, kind: "door-in", outdoor: false },
  { name: "H", x: -6.2, z: 7.3, kind: "hub", outdoor: false },
  { name: "S1", x: -6.3, z: 5.2, kind: "spot", facing: -Math.PI / 2, outdoor: false },
  { name: "S2", x: -6.3, z: 6.3, kind: "spot", facing: -Math.PI / 2, outdoor: false },
  { name: "S3", x: -7.7, z: 7.7, kind: "spot", facing: -Math.PI / 2, outdoor: false },
  { name: "S4", x: -7.7, z: 8.5, kind: "spot", facing: -Math.PI / 2, outdoor: false },
  { name: "S5", x: -6.6, z: 8.4, kind: "spot", facing: 0, outdoor: false },
];
// Hang cho uon doc via he: 7 o doc x=-3.2 roi re trai doc z=13.3. Khoang cach 0.7.
const QUEUE_POINTS: Vec2[] = [
  ...Array.from({ length: 7 }, (_, i) => ({ x: -3.2, z: 8.6 + 0.7 * i })),
  { x: -3.9, z: 13.3 },
  { x: -4.6, z: 13.3 },
  { x: -5.3, z: 13.3 },
];
QUEUE_POINTS.forEach((p, i) => {
  // Moi o nhin ve phia o truoc no (o 1 nhin ve cua) - nguoi xep hang quay mat ve cua hang.
  const ahead = i === 0 ? { x: -4.4, z: 7.9 } : QUEUE_POINTS[i - 1];
  SHOPEE_DEFS.push({ name: `Q${i + 1}`, x: p.x, z: p.z, kind: "queue", facing: headingTo(p, ahead), outdoor: true });
});

const SHOPEE_EDGE_NAMES: Array<[string, string]> = [
  ["C", "A"], ["A", "Q1"], ["Q1", "Dout"], ["A", "Dout"], ["Dout", "Din"], ["Din", "H"],
  ["H", "S2"], ["S2", "S1"], ["H", "S3"], ["S3", "S4"], ["H", "S5"],
  ...Array.from({ length: QUEUE_SLOTS - 1 }, (_, i) => [`Q${i + 1}`, `Q${i + 2}`] as [string, string]),
];

const STORE_CORNER: Record<StoreId, string> = { shopee: "c_L", tiktokshop: "c_R" };

export function storeNode(store: StoreId, name: string): string {
  return name === "C" ? STORE_CORNER[store] : `${store}:${name}`;
}

// ---- Node chung ----
const GLOBAL_NODES: LayoutNode[] = [
  { id: "c_F", x: 3.2, z: 3.2, kind: "corner", outdoor: true },
  { id: "c_L", x: -3.2, z: 3.2, kind: "corner", outdoor: true },
  { id: "c_R", x: 3.2, z: -3.2, kind: "corner", outdoor: true },
  { id: "c_B", x: -3.2, z: -3.2, kind: "corner", outdoor: true },
  { id: "f_z1", x: 3.2, z: 7.5, kind: "sidewalk", outdoor: true },
  { id: "f_z2", x: 3.2, z: 12.0, kind: "sidewalk", outdoor: true },
  { id: "f_x1", x: 7.5, z: 3.2, kind: "sidewalk", outdoor: true },
  { id: "f_bench", x: 9.8, z: 3.2, kind: "bench", facing: 0, outdoor: true },
  { id: "f_x2", x: 12.0, z: 3.2, kind: "sidewalk", outdoor: true },
  { id: "f_p", x: 7.2, z: 7.2, kind: "sidewalk", outdoor: true },
  { id: "b_z1", x: -3.2, z: -8, kind: "sidewalk", outdoor: true },
  { id: "b_x1", x: -8, z: -3.2, kind: "sidewalk", outdoor: true },
  { id: "b_p", x: -7.5, z: -7.5, kind: "sidewalk", outdoor: true },
  { id: "sp_F1", x: 3.2, z: 13.6, kind: "spawn", outdoor: true },
  { id: "sp_F2", x: 13.6, z: 3.2, kind: "spawn", outdoor: true },
  { id: "sp_B1", x: -3.2, z: -13.6, kind: "spawn", outdoor: true },
  { id: "sp_B2", x: -13.6, z: -3.2, kind: "spawn", outdoor: true },
];
const GLOBAL_EDGES: LayoutEdge[] = [
  ["c_F", "f_z1"], ["f_z1", "f_z2"], ["f_z2", "sp_F1"], ["c_F", "f_x1"], ["f_x1", "f_bench"], ["f_bench", "f_x2"],
  ["f_x2", "sp_F2"], ["f_z1", "f_p"], ["f_p", "f_x1"],
  ["c_B", "b_z1"], ["b_z1", "sp_B1"], ["c_B", "b_x1"], ["b_x1", "sp_B2"], ["b_z1", "b_p"], ["b_p", "b_x1"],
].map(([a, b]) => ({ a, b, crosswalk: false }))
  .concat(
    [["c_L", "c_F"], ["c_F", "c_R"], ["c_R", "c_B"], ["c_B", "c_L"]].map(([a, b]) => ({ a, b, crosswalk: true }))
  );

function buildStoreNodes(store: StoreId): LayoutNode[] {
  return SHOPEE_DEFS.map((d) => {
    const p = store === "shopee" ? { x: d.x, z: d.z } : swap(d);
    const facing = d.facing === undefined ? undefined : store === "shopee" ? d.facing : swapFacing(d.facing);
    return { id: storeNode(store, d.name), x: p.x, z: p.z, kind: d.kind, store, facing, outdoor: d.outdoor };
  });
}

export const NODES: readonly LayoutNode[] = [...GLOBAL_NODES, ...buildStoreNodes("shopee"), ...buildStoreNodes("tiktokshop")];
export const EDGES: readonly LayoutEdge[] = [
  ...GLOBAL_EDGES,
  ...(["shopee", "tiktokshop"] as StoreId[]).flatMap((s) =>
    SHOPEE_EDGE_NAMES.map(([a, b]) => ({ a: storeNode(s, a), b: storeNode(s, b), crosswalk: false }))
  ),
];

const NODE_BY_ID = new Map(NODES.map((n) => [n.id, n]));
export function node(id: string): LayoutNode {
  const n = NODE_BY_ID.get(id);
  if (!n) throw new Error(`Khong co node ${id}`);
  return n;
}

export const SPAWN_NODES: readonly string[] = ["sp_F1", "sp_F2", "sp_B1", "sp_B2"];
export const STROLL_LOOPS = {
  front: ["c_F", "f_z1", "f_p", "f_x1", "c_F"],
  frontBench: ["c_F", "f_z1", "f_p", "f_x1", "f_bench", "f_x1", "c_F"],
  back: ["c_B", "b_z1", "b_p", "b_x1", "c_B"],
} as const;

export const FOOTPRINTS: Record<StoreId, Rect> = {
  shopee: SHOPEE_FOOTPRINT,
  tiktokshop: { minX: SHOPEE_FOOTPRINT.minZ, maxX: SHOPEE_FOOTPRINT.maxZ, minZ: SHOPEE_FOOTPRINT.minX, maxZ: SHOPEE_FOOTPRINT.maxX },
};
export const STORE_FACADE_CENTER: Record<StoreId, Vec2> = { shopee: { x: -5, z: 6.8 }, tiktokshop: { x: 6.8, z: -5 } };

const CW_HALF = 0.6;
export const CROSSWALKS: readonly Rect[] = [
  { minX: -ROAD_HALF, maxX: ROAD_HALF, minZ: SIDEWALK_CENTER - CW_HALF, maxZ: SIDEWALK_CENTER + CW_HALF },
  { minX: -ROAD_HALF, maxX: ROAD_HALF, minZ: -SIDEWALK_CENTER - CW_HALF, maxZ: -SIDEWALK_CENTER + CW_HALF },
  { minX: SIDEWALK_CENTER - CW_HALF, maxX: SIDEWALK_CENTER + CW_HALF, minZ: -ROAD_HALF, maxZ: ROAD_HALF },
  { minX: -SIDEWALK_CENTER - CW_HALF, maxX: -SIDEWALK_CENTER + CW_HALF, minZ: -ROAD_HALF, maxZ: ROAD_HALF },
];

export const DECOR = {
  trees: [
    { x: 11.5, z: 7.5 }, { x: 7.5, z: 11.5 }, { x: 12.2, z: 12.2 },
    { x: -9.5, z: -9.5 }, { x: -12, z: -6.5 }, { x: -6.5, z: -12 },
    { x: -11.5, z: 11 }, { x: 11, z: -11.5 },
  ] as Vec2[],
  lamps: [
    { x: 4.6, z: 4.6 }, { x: -4.6, z: 4.6 }, { x: 4.6, z: -4.6 }, { x: -4.6, z: -4.6 },
    { x: 4.6, z: 12.6 }, { x: 12.6, z: 4.6 },
  ] as Vec2[],
  planters: [{ x: 6.0, z: 4.6 }, { x: 4.6, z: 6.0 }, { x: -6.5, z: -4.6 }, { x: -4.6, z: -6.5 }] as Vec2[],
  bench: { x: 9.8, z: 2.75, rotationY: 0 },
};

/** Dua 1 diem ve he toa do cua Shopee (TikTok = swap) - dung cho test hinh hoc va dung shop. */
export function toShopeeFrame(store: StoreId, p: Vec2): Vec2 {
  return store === "shopee" ? { x: p.x, z: p.z } : swap(p);
}

/** Do cao mat dat tai (x,z): san trong shop, mat duong, hoac mat via he. */
export function groundY(x: number, z: number): number {
  for (const r of Object.values(FOOTPRINTS)) {
    if (x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ) return FLOOR_HEIGHT;
  }
  return Math.abs(x) < ROAD_HALF || Math.abs(z) < ROAD_HALF ? 0.02 : CURB_HEIGHT;
}
```

`src/web/storeScene/sim/pathfinding.ts`:

```ts
import { EDGES, NODES, node } from "../layout.js";

/**
 * Dijkstra tren do thi TINH (khong khoa canh dong - spec muc 6). O(V^2) voi ~70 node la du, va duyet
 * theo thu tu NODES nen hoa thi ket qua luon nhu nhau (de debug). Ket qua duoc cache: caller CHI duoc
 * doc/slice, khong duoc sua mang tra ve.
 */
const index = new Map(NODES.map((n, i) => [n.id, i]));
const adjacency: Array<Array<{ to: number; w: number }>> = NODES.map(() => []);
for (const e of EDGES) {
  const a = index.get(e.a)!, b = index.get(e.b)!;
  const w = Math.hypot(node(e.a).x - node(e.b).x, node(e.a).z - node(e.b).z);
  adjacency[a].push({ to: b, w });
  adjacency[b].push({ to: a, w });
}
const cache = new Map<string, readonly string[]>();

export function findPath(from: string, to: string): readonly string[] {
  const key = `${from}>${to}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const start = index.get(from), goal = index.get(to);
  if (start === undefined || goal === undefined) throw new Error(`Node la: ${from} -> ${to}`);
  const dist = new Array<number>(NODES.length).fill(Infinity);
  const prev = new Array<number>(NODES.length).fill(-1);
  const done = new Array<boolean>(NODES.length).fill(false);
  dist[start] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < NODES.length; i++) if (!done[i] && dist[i] < Infinity && (u === -1 || dist[i] < dist[u])) u = i;
    if (u === -1 || u === goal) break;
    done[u] = true;
    for (const { to: v, w } of adjacency[u]) {
      if (dist[u] + w < dist[v] - 1e-9) {
        dist[v] = dist[u] + w;
        prev[v] = u;
      }
    }
  }
  if (dist[goal] === Infinity) throw new Error(`Khong co duong ${from} -> ${to}`);
  const path: string[] = [];
  for (let v = goal; v !== -1; v = prev[v]) path.unshift(NODES[v].id);
  cache.set(key, path);
  return path;
}
```

- [ ] **Step 5: Chạy test, xác nhận xanh**

Run: `npx tsx --test src/web/storeScene/__tests__/layout.test.ts`
Expected: PASS. **Nếu một test hình học hỏng** (vd node bị nhà che), sửa TOẠ ĐỘ trong `layout.ts` cho đúng ràng buộc — không nới điều kiện test. Ghi lại toạ độ đã đổi trong commit message.

Run: `npm run typecheck && npm run build:scene && ls -la public/store-scene.js`
Expected: typecheck sạch cả 2 tsconfig; file bundle tồn tại.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.web.json src/web/storeScene
git commit -m "feat(cua-hang): ha tang bundle canh 3D (esbuild + three) + ban do the gioi + tim duong

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Hàng chờ có giữ chỗ + cổng cửa (`queue.ts`)

**Files:**
- Create: `src/web/storeScene/sim/queue.ts`
- Test: `src/web/storeScene/__tests__/queue.test.ts`

**Interfaces:**
- Consumes: `QUEUE_SLOTS`, `BROWSE_SPOTS` (layout).
- Produces:
  ```ts
  export function queueTarget(input: { open: boolean; uniqueUsers: number; eligible: number }): number;
  export class StoreQueue {
    constructor(slots?: number, spotCount?: number);
    join(key: string, now: number): number | null;   // vi tri 0-based, null = het o
    position(key: string): number | null;
    get length(): number;
    insideCount(): number;
    spotOf(key: string): number | null;
    tryAdmit(now: number, target: number, maxWaitOf: (key: string) => number): { key: string; spot: number } | null;
    releaseSpot(key: string): boolean;
    releaseAll(key: string): void;
  }
  ```

- [ ] **Step 1: Viết test hỏng**

`src/web/storeScene/__tests__/queue.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { StoreQueue, queueTarget } from "../sim/queue.js";

test("(15a) queueTarget theo bang so trong spec", () => {
  const t = (uniqueUsers: number, eligible: number, open = true) => queueTarget({ open, uniqueUsers, eligible });
  assert.equal(t(0, 0), 0);
  assert.equal(t(1, 1), 0);
  assert.equal(t(3, 3), 2);
  assert.equal(t(12, 12), 6);
  assert.equal(t(19, 19), 10);
  assert.equal(t(30, 30), 10);
  assert.equal(t(100, 4), 3);
  assert.equal(t(40, 8), 7); // (15h) chan E-1, khong tinh theo E (4) cung khong theo U (10)
  assert.equal(t(30, 30, false), 0);
});

test("join FIFO, het 10 o tra null, khong ai chiem trung o", () => {
  const q = new StoreQueue();
  for (let i = 0; i < 10; i++) assert.equal(q.join(`k${i}`, 0), i);
  assert.equal(q.join("k10", 0), null);
  assert.equal(q.join("k3", 0), 3); // join lai = vi tri cu, khong nhan doi
  assert.equal(q.length, 10);
});

test("(15b) target 0: vao ngay khi co cho, thoi gian cho = 0", () => {
  const q = new StoreQueue();
  q.join("solo", 5);
  assert.deepEqual(q.tryAdmit(5, 0, () => 20), { key: "solo", spot: 0 });
  assert.equal(q.length, 0);
  assert.equal(q.insideCount(), 1);
});

test("(15f) hang < muc tieu: nguoi dau cho, toi maxWait thi vao", () => {
  const q = new StoreQueue();
  q.join("a", 0);
  q.join("b", 1);
  assert.equal(q.tryAdmit(10, 6, () => 20), null);
  assert.equal(q.tryAdmit(19.99, 6, () => 20), null);
  assert.deepEqual(q.tryAdmit(20, 6, () => 20), { key: "a", spot: 0 });
  assert.equal(q.position("b"), 0); // dồn len
});

test("hang >= muc tieu: nguoi dau vao ngay", () => {
  const q = new StoreQueue();
  for (let i = 0; i < 6; i++) q.join(`k${i}`, 0);
  assert.deepEqual(q.tryAdmit(0, 6, () => 20), { key: "k0", spot: 0 });
  assert.equal(q.tryAdmit(0, 6, () => 20), null); // con 5 < 6
});

test("(15d) target 10, hang du 10, shop day: tra 1 cho -> nguoi dau vao NGAY", () => {
  const q = new StoreQueue();
  for (let i = 0; i < 5; i++) { q.join(`in${i}`, 0); q.tryAdmit(0, 0, () => 20); }
  for (let i = 0; i < 10; i++) q.join(`k${i}`, 1);
  assert.equal(q.tryAdmit(2, 10, () => 20), null); // (15e) shop day -> cong dong
  assert.equal(q.insideCount(), 5);
  assert.equal(q.releaseSpot("in2"), true);
  assert.deepEqual(q.tryAdmit(2, 10, () => 20), { key: "k0", spot: 2 });
  assert.equal(q.insideCount(), 5);
});

test("(16) releaseAll: roi canh khi dang giu o cho hoac cho xem hang", () => {
  const q = new StoreQueue();
  q.join("a", 0); q.tryAdmit(0, 0, () => 20); // a vao trong
  q.join("b", 0); q.join("c", 0);
  q.releaseAll("b");
  assert.equal(q.position("c"), 0);
  q.releaseAll("a");
  assert.equal(q.spotOf("a"), null);
  assert.deepEqual(q.tryAdmit(0, 0, () => 20), { key: "c", spot: 0 });
});
```

- [ ] **Step 2: Chạy test, xác nhận hỏng**

Run: `npx tsx --test src/web/storeScene/__tests__/queue.test.ts`
Expected: FAIL — `Cannot find module '../sim/queue.js'`.

- [ ] **Step 3: Cài đặt**

`src/web/storeScene/sim/queue.ts`:

```ts
import { BROWSE_SPOTS, QUEUE_SLOTS } from "../layout.js";

/**
 * Hang cho + giu cho cua 1 cua hang (spec muc 6, yeu cau chu bot 2026-10-23: shop dong user thi hang dai).
 * Hai tai nguyen, lay theo thu tu CO DINH (o cho -> cho xem hang) nen khong the co chu trinh cho.
 */

/** Do dai hang muc tieu. U = user unique cua san (toan bo du lieu), E = nhan vat trong canh co luot ghe san. */
export function queueTarget(input: { open: boolean; uniqueUsers: number; eligible: number }): number {
  if (!input.open) return 0;
  return Math.max(0, Math.min(QUEUE_SLOTS, Math.ceil(input.uniqueUsers / 2), input.eligible - 1));
}

export class StoreQueue {
  private readonly line: Array<{ key: string; joinedAt: number }> = [];
  private readonly spots: Array<string | null>;

  constructor(private readonly slots = QUEUE_SLOTS, spotCount = BROWSE_SPOTS) {
    this.spots = new Array<string | null>(spotCount).fill(null);
  }

  join(key: string, now: number): number | null {
    const existing = this.position(key);
    if (existing !== null) return existing;
    if (this.line.length >= this.slots) return null;
    this.line.push({ key, joinedAt: now });
    return this.line.length - 1;
  }

  position(key: string): number | null {
    const i = this.line.findIndex((e) => e.key === key);
    return i === -1 ? null : i;
  }

  get length(): number {
    return this.line.length;
  }

  insideCount(): number {
    return this.spots.filter((s) => s !== null).length;
  }

  spotOf(key: string): number | null {
    const i = this.spots.indexOf(key);
    return i === -1 ? null : i;
  }

  /**
   * Cong cua (spec muc 6): nguoi DAU hang vao khi va chi khi co cho xem hang trong VA
   * (do dai hang - tinh ca nguoi dau - >= muc tieu HOAC nguoi dau da cho >= maxWait).
   * target = 0 -> 0 >= 0 luon dung: shop vang/1 nguoi vao ngay, khong co thoi gian cho nhan tao.
   */
  tryAdmit(now: number, target: number, maxWaitOf: (key: string) => number): { key: string; spot: number } | null {
    if (this.line.length === 0) return null;
    const spot = this.spots.indexOf(null);
    if (spot === -1) return null;
    const head = this.line[0];
    if (!(this.line.length >= target || now - head.joinedAt >= maxWaitOf(head.key))) return null;
    this.line.shift();
    this.spots[spot] = head.key;
    return { key: head.key, spot };
  }

  releaseSpot(key: string): boolean {
    const i = this.spots.indexOf(key);
    if (i === -1) return false;
    this.spots[i] = null;
    return true;
  }

  /** Goi o MOI loi ra khoi trang thai co giu cho (ke ca roi canh) - khong de cho "mo coi". */
  releaseAll(key: string): void {
    const i = this.line.findIndex((e) => e.key === key);
    if (i !== -1) this.line.splice(i, 1);
    this.releaseSpot(key);
  }
}
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx tsx --test src/web/storeScene/__tests__/queue.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/web/storeScene/sim/queue.ts src/web/storeScene/__tests__/queue.test.ts
git commit -m "feat(cua-hang): hang cho giu cho + cong cua theo queueTarget

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Máy trạng thái + đạo diễn (`director.ts`)

**Files:**
- Create: `src/web/storeScene/sim/director.ts`
- Test: `src/web/storeScene/__tests__/director.test.ts`

**Interfaces:**
- Consumes: `layout.ts` (`node`, `storeNode`, `SPAWN_NODES`, `STROLL_LOOPS`), `findPath`, `mulberry32`/`randRange`, `StoreQueue`/`queueTarget`, `StoreId`.
- Produces:
  ```ts
  export type AgentState = "OFFSTAGE"|"GO_TO_STORE"|"QUEUED"|"DETOUR_STROLL"|"ENTER_STORE"|"BROWSE"|"EXIT_STORE"|"AT_SHUTTER"|"STROLL"|"SIT"|"LEAVE_SCENE";
  export type Activity = "walk"|"idle"|"browse"|"sit";
  export interface SimCharacter { key: string; seed: number; visits: readonly StoreId[] }
  export interface SimConfig { tiktokOpen: boolean; storeUsers: Readonly<Record<StoreId, number>> }
  export interface AgentView { key: string; visible: boolean; x: number; z: number; heading: number; state: AgentState; activity: Activity; bags: readonly StoreId[]; walkPhase: number }
  export interface VisitLogEntry { cycle: number; store: StoreId; kind: "enter" | "shutter" }
  export interface AgentDebug { state: AgentState; store: StoreId | null; cycle: number; log: readonly VisitLogEntry[]; queuedStores: ReadonlySet<StoreId>; statesSeen: ReadonlySet<AgentState> }
  export const SIM_STEP = 1/30, MAX_DT = 0.1, WARMUP_MIN_S = 40, WARMUP_MAX_S = 120;
  export class Director {
    constructor(characters: readonly SimCharacter[], config: SimConfig);
    get now(): number;
    step(dt: number): void;            // dt <= 0 -> khong lam gi; dt kep <= MAX_DT
    warmUp(): number;                  // so giay mo phong da tua
    views(): AgentView[];
    queueLength(store: StoreId): number;
    insideCount(store: StoreId): number;
    queueTargetOf(store: StoreId): number;
    debug(key: string): AgentDebug;
  }
  ```

- [ ] **Step 1: Viết test hỏng**

`src/web/storeScene/__tests__/director.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Director, SIM_STEP, WARMUP_MAX_S, WARMUP_MIN_S, type AgentState, type SimCharacter } from "../sim/director.js";
import type { StoreId } from "../../../core/storeSceneContract.js";

const INSIDE: ReadonlySet<AgentState> = new Set(["ENTER_STORE", "BROWSE", "EXIT_STORE"]);
const SHOP_STATES: ReadonlySet<AgentState> = new Set(["GO_TO_STORE", "QUEUED", "DETOUR_STROLL", "ENTER_STORE", "BROWSE", "EXIT_STORE", "AT_SHUTTER"]);

function chars(groups: Array<[number, StoreId[]]>): SimCharacter[] {
  const out: SimCharacter[] = [];
  for (const [count, visits] of groups) {
    for (let i = 0; i < count; i++) out.push({ key: `c${String(out.length + 1).padStart(2, "0")}`, seed: (out.length + 1) * 7919, visits });
  }
  return out;
}
function storeUsersOf(cs: SimCharacter[]): Record<StoreId, number> {
  return { shopee: cs.filter((c) => c.visits.includes("shopee")).length, tiktokshop: cs.filter((c) => c.visits.includes("tiktokshop")).length };
}
/** Chay `seconds` giay mo phong, goi `each` sau MOI buoc. */
function run(d: Director, seconds: number, each?: (t: number) => void) {
  for (let t = 0; t < seconds; t += SIM_STEP) {
    d.step(SIM_STEP);
    each?.(t);
  }
}
/** 30 nhan vat, luot ghe ngau nhien nhung co dinh. */
function mixed(): SimCharacter[] {
  const patterns: StoreId[][] = [[], ["shopee"], ["shopee", "shopee"], ["tiktokshop"], ["shopee", "tiktokshop", "shopee"], ["tiktokshop", "tiktokshop"]];
  return Array.from({ length: 30 }, (_, i) => ({ key: `c${i + 1}`, seed: 1000 + i * 37, visits: patterns[(i * 7) % patterns.length] }));
}

test("(14)(17) 30 nhan vat x 10 phut: khong bao gio > 5 nguoi trong shop, ai cung xong >= 1 vong", () => {
  const cs = mixed();
  const d = new Director(cs, { tiktokOpen: true, storeUsers: storeUsersOf(cs) });
  run(d, 600, () => {
    for (const s of ["shopee", "tiktokshop"] as StoreId[]) {
      assert.ok(d.insideCount(s) <= 5);
      const inside = cs.filter((c) => { const g = d.debug(c.key); return INSIDE.has(g.state) && g.store === s; }).length;
      assert.ok(inside <= 5, `${s}: ${inside} nguoi trong shop`);
      assert.ok(d.queueLength(s) <= 10);
    }
  });
  for (const c of cs) assert.ok(d.debug(c.key).cycle >= 1, `${c.key} chua xong vong nao`);
});

test("(15) 25 nguoi cung den 1 shop: het 15 cho thi co nguoi di vong dao, hang khong vuot 10", () => {
  const cs = chars([[25, ["shopee", "shopee"]]]);
  const d = new Director(cs, { tiktokOpen: true, storeUsers: { shopee: 25, tiktokshop: 0 } });
  let maxQueue = 0;
  run(d, 300, () => { maxQueue = Math.max(maxQueue, d.queueLength("shopee")); });
  assert.ok(maxQueue <= 10);
  assert.ok(cs.some((c) => d.debug(c.key).statesSeen.has("DETOUR_STROLL")), "khong ai phai di vong dao");
});

test("(15b) U=1: nguoi duy nhat khong bao gio dung trong hang sau khi buoc ket thuc", () => {
  const cs = chars([[1, ["shopee"]]]);
  const d = new Director(cs, { tiktokOpen: true, storeUsers: { shopee: 1, tiktokshop: 0 } });
  run(d, 120, () => assert.notEqual(d.debug("c01").state, "QUEUED"));
  assert.ok(d.debug("c01").log.length >= 1);
});

test("(15c)(15g) shop dong co hang dai hon ro; khong khach gia; so lan vao = so luot", () => {
  const cs = chars([[12, ["shopee", "shopee", "shopee"]], [3, ["tiktokshop", "tiktokshop", "tiktokshop"]], [15, []]]);
  const d = new Director(cs, { tiktokOpen: true, storeUsers: { shopee: 12, tiktokshop: 3 } });
  assert.equal(d.queueTargetOf("shopee"), 6);
  assert.equal(d.queueTargetOf("tiktokshop"), 2);
  d.warmUp();
  let sumS = 0, sumT = 0, samples = 0, maxS = 0, nextSample = 0;
  run(d, 600, (t) => {
    maxS = Math.max(maxS, d.queueLength("shopee"));
    if (t >= nextSample) { sumS += d.queueLength("shopee"); sumT += d.queueLength("tiktokshop"); samples++; nextSample += 1; }
  });
  const avgS = sumS / samples, avgT = sumT / samples;
  assert.ok(avgS >= 4.2, `trung binh hang Shopee ${avgS.toFixed(2)} < 4.2`);
  assert.ok(avgS >= avgT + 2, `Shopee ${avgS.toFixed(2)} khong dai hon TikTok ${avgT.toFixed(2)} + 2`);
  assert.ok(maxS <= 10);
  for (const c of cs) {
    const g = d.debug(c.key);
    for (const s of g.queuedStores) assert.ok(c.visits.includes(s), `${c.key} xep hang o ${s} ma khong co luot`);
    for (let cycle = 0; cycle < g.cycle; cycle++) {
      const entered = g.log.filter((e) => e.cycle === cycle).map((e) => e.store);
      assert.deepEqual(entered, [...c.visits], `${c.key} vong ${cycle}`);
    }
  }
});

test("(18) nguoi 0 link khong bao gio vao trang thai lien quan shop", () => {
  const cs = chars([[5, []], [5, ["shopee"]]]);
  const d = new Director(cs, { tiktokOpen: true, storeUsers: storeUsersOf(cs) });
  run(d, 300);
  for (const c of cs.filter((x) => x.visits.length === 0)) {
    for (const s of d.debug(c.key).statesSeen) assert.equal(SHOP_STATES.has(s), false, `${c.key} vao ${s}`);
  }
});

test("(19) TikTok dong: luot TikTok -> AT_SHUTTER, khong tui, khong xep hang", () => {
  const cs = chars([[4, ["tiktokshop", "shopee"]]]);
  const d = new Director(cs, { tiktokOpen: false, storeUsers: { shopee: 4, tiktokshop: 4 } });
  assert.equal(d.queueTargetOf("tiktokshop"), 0);
  run(d, 300, () => {
    assert.equal(d.queueLength("tiktokshop"), 0);
    assert.equal(d.insideCount("tiktokshop"), 0);
    for (const v of d.views()) assert.equal(v.bags.includes("tiktokshop"), false);
  });
  for (const c of cs) {
    const g = d.debug(c.key);
    assert.ok(g.statesSeen.has("AT_SHUTTER"));
    assert.equal(g.queuedStores.has("tiktokshop"), false);
    assert.deepEqual(g.log.filter((e) => e.cycle === 0).map((e) => `${e.kind}:${e.store}`), ["shutter:tiktokshop", "enter:shopee"]);
  }
});

test("(20) xac dinh: cung du lieu + cung chuoi dt -> cung vi tri", () => {
  const cs = mixed();
  const a = new Director(cs, { tiktokOpen: true, storeUsers: storeUsersOf(cs) });
  const b = new Director(cs, { tiktokOpen: true, storeUsers: storeUsersOf(cs) });
  const dts = [0.016, 0.033, 0.1, 0.25, 0.008];
  for (let i = 0; i < 2000; i++) { a.step(dts[i % dts.length]); b.step(dts[i % dts.length]); }
  assert.deepEqual(a.views(), b.views());
});

test("(21) dong bang: step(0) khong doi vi tri nao", () => {
  const cs = mixed();
  const d = new Director(cs, { tiktokOpen: true, storeUsers: storeUsersOf(cs) });
  run(d, 60);
  const before = JSON.stringify(d.views());
  d.step(0);
  assert.equal(JSON.stringify(d.views()), before);
});

test("(15i) khoi dong am: trong [40, 120] giay va tat dinh", () => {
  const cs = chars([[12, ["shopee", "shopee", "shopee"]], [3, ["tiktokshop"]], [15, []]]);
  const cfg = { tiktokOpen: true, storeUsers: { shopee: 12, tiktokshop: 3 } };
  const t1 = new Director(cs, cfg).warmUp();
  const t2 = new Director(cs, cfg).warmUp();
  assert.equal(t1, t2);
  assert.ok(t1 >= WARMUP_MIN_S - 1e-6 && t1 <= WARMUP_MAX_S + SIM_STEP, `warmUp ${t1}`);
});
```

- [ ] **Step 2: Chạy test, xác nhận hỏng**

Run: `npx tsx --test src/web/storeScene/__tests__/director.test.ts`
Expected: FAIL — `Cannot find module '../sim/director.js'`.

- [ ] **Step 3: Cài đặt**

`src/web/storeScene/sim/director.ts`:

```ts
import type { StoreId } from "../../../core/storeSceneContract.js";
import { SPAWN_NODES, STROLL_LOOPS, node, storeNode } from "../layout.js";
import { findPath } from "./pathfinding.js";
import { StoreQueue, queueTarget } from "./queue.js";
import { mulberry32, randRange, type Rng } from "./rng.js";

/**
 * Dao dien canh /admin/cua-hang (spec muc 6-7). THUAN TS, khong biet gi ve three/DOM - test bang tsx.
 *
 * Kich ban cua moi nhan vat = `visits` (thu tu thoi gian that cua ngay dang xem). Moi vong dien tieu thu
 * danh sach DUNG 1 lan, roi roi canh, nghi, dien lai tu dau. Thoi gian o day la thoi gian NEN, khong lien
 * quan gio that. Khong co gi tren trang doi trong luc dien - day chi la hoat anh.
 */

export type AgentState =
  | "OFFSTAGE" | "GO_TO_STORE" | "QUEUED" | "DETOUR_STROLL" | "ENTER_STORE" | "BROWSE"
  | "EXIT_STORE" | "AT_SHUTTER" | "STROLL" | "SIT" | "LEAVE_SCENE";
export type Activity = "walk" | "idle" | "browse" | "sit";
export interface SimCharacter { key: string; seed: number; visits: readonly StoreId[] }
export interface SimConfig { tiktokOpen: boolean; storeUsers: Readonly<Record<StoreId, number>> }
export interface AgentView {
  key: string; visible: boolean; x: number; z: number; heading: number;
  state: AgentState; activity: Activity; bags: readonly StoreId[]; walkPhase: number;
}
export interface VisitLogEntry { cycle: number; store: StoreId; kind: "enter" | "shutter" }
export interface AgentDebug {
  state: AgentState; store: StoreId | null; cycle: number; log: readonly VisitLogEntry[];
  queuedStores: ReadonlySet<StoreId>; statesSeen: ReadonlySet<AgentState>;
}

export const SIM_STEP = 1 / 30;
export const MAX_DT = 0.1;
export const WARMUP_MIN_S = 40;
export const WARMUP_MAX_S = 120;

const WALK_SPEED = 1.15;
const STROLL_PACE = 0.75; // di dao cham hon di mua
const SLOW_GAP = 0.5;
const MIN_SLOW = 0.35; // cung chieu chi giam toc, KHONG bao gio dung han (spec muc 6)
const STORES: readonly StoreId[] = ["shopee", "tiktokshop"];
const MOVING = new Set<AgentState>(["GO_TO_STORE", "DETOUR_STROLL", "ENTER_STORE", "EXIT_STORE", "STROLL", "LEAVE_SCENE"]);

interface Agent {
  key: string; seed: number; rng: Rng; visits: StoreId[];
  speed: number; maxWait: number; laneOffset: number;
  state: AgentState; visible: boolean;
  x: number; z: number; heading: number;
  atNode: string | null; // node vua di qua (khi dang di) / dang dung (khi path rong)
  path: string[]; // cac node con phai toi, path[0] = dich ke tiep
  timer: number; visitIndex: number; store: StoreId | null;
  bags: StoreId[]; activity: Activity; walkPhase: number; cycle: number;
  strollLaps: number; sitPending: boolean; afterSit: string[];
  log: VisitLogEntry[]; queuedStores: Set<StoreId>; statesSeen: Set<AgentState>;
}

export class Director {
  private readonly agents: Agent[];
  private readonly byKey = new Map<string, Agent>();
  private readonly queues: Record<StoreId, StoreQueue> = { shopee: new StoreQueue(), tiktokshop: new StoreQueue() };
  private readonly targets: Record<StoreId, number>;
  private readonly open: Record<StoreId, boolean>;
  private time = 0;

  constructor(characters: readonly SimCharacter[], config: SimConfig) {
    this.open = { shopee: true, tiktokshop: config.tiktokOpen };
    const eligible = (s: StoreId) => characters.filter((c) => c.visits.includes(s)).length;
    this.targets = {
      shopee: queueTarget({ open: this.open.shopee, uniqueUsers: config.storeUsers.shopee, eligible: eligible("shopee") }),
      tiktokshop: queueTarget({ open: this.open.tiktokshop, uniqueUsers: config.storeUsers.tiktokshop, eligible: eligible("tiktokshop") }),
    };
    this.agents = characters.map((c) => {
      const rng = mulberry32(c.seed);
      const agent: Agent = {
        key: c.key, seed: c.seed, rng, visits: [...c.visits],
        speed: randRange(rng, 0.9, 1.15), maxWait: randRange(rng, 20, 25), laneOffset: 0.25 + (c.seed % 3) * 0.05,
        state: "OFFSTAGE", visible: false, x: 0, z: 0, heading: 0, atNode: null, path: [],
        timer: randRange(rng, 0, 20), visitIndex: 0, store: null, bags: [], activity: "idle", walkPhase: 0, cycle: 0,
        strollLaps: 0, sitPending: false, afterSit: [],
        log: [], queuedStores: new Set(), statesSeen: new Set(["OFFSTAGE"]),
      };
      this.byKey.set(c.key, agent);
      return agent;
    });
  }

  get now(): number {
    return this.time;
  }

  step(dt: number): void {
    if (!(dt > 0)) return; // dong bang: dt = 0 khong doi gi (spec muc 7)
    const d = Math.min(dt, MAX_DT);
    this.time += d;
    this.admitAll();
    for (const a of this.agents) this.update(a, d);
    this.admitAll(); // nguoi vua join (hang rong + cong mo) vao ngay trong CUNG buoc
  }

  /** Tua nhanh truoc khung hinh dau: toi thieu 40s, dung som khi hang cho da gan muc tieu, toi da 120s. */
  warmUp(): number {
    let t = 0;
    while (t < WARMUP_MAX_S - 1e-9) {
      this.step(SIM_STEP);
      t += SIM_STEP;
      if (t >= WARMUP_MIN_S && STORES.every((s) => !this.open[s] || this.queues[s].length >= this.targets[s] - 1)) break;
    }
    return t;
  }

  views(): AgentView[] {
    return this.agents.map((a) => {
      let x = a.x, z = a.z;
      if (a.visible && a.path.length > 0 && a.atNode) {
        // Lech lan sang PHAI theo huong di -> nguoi nguoc chieu khong doi dau. Muot dan o 2 dau canh.
        const from = node(a.atNode), to = node(a.path[0]);
        const sx = to.x - from.x, sz = to.z - from.z;
        const len = Math.hypot(sx, sz);
        if (len > 1e-6) {
          const done = Math.hypot(a.x - from.x, a.z - from.z);
          const ease = Math.max(0, Math.min(1, done / 0.6, (len - done) / 0.6));
          x += (sz / len) * a.laneOffset * ease;
          z += (-sx / len) * a.laneOffset * ease;
        }
      }
      return { key: a.key, visible: a.visible, x, z, heading: a.heading, state: a.state, activity: a.activity, bags: [...a.bags], walkPhase: a.walkPhase };
    });
  }

  queueLength(store: StoreId): number { return this.queues[store].length; }
  insideCount(store: StoreId): number { return this.queues[store].insideCount(); }
  queueTargetOf(store: StoreId): number { return this.targets[store]; }

  debug(key: string): AgentDebug {
    const a = this.byKey.get(key);
    if (!a) throw new Error(`Khong co nhan vat ${key}`);
    return { state: a.state, store: a.store, cycle: a.cycle, log: a.log, queuedStores: a.queuedStores, statesSeen: a.statesSeen };
  }

  // ---------------- noi bo ----------------

  private setState(a: Agent, s: AgentState): void {
    a.state = s;
    a.statesSeen.add(s);
  }

  private admitAll(): void {
    for (const s of STORES) {
      for (;;) {
        const admitted = this.queues[s].tryAdmit(this.time, this.targets[s], (k) => this.byKey.get(k)!.maxWait);
        if (!admitted) break;
        const a = this.byKey.get(admitted.key)!;
        this.setState(a, "ENTER_STORE");
        this.repath(a, storeNode(s, `S${admitted.spot + 1}`));
      }
    }
  }

  private update(a: Agent, dt: number): void {
    switch (a.state) {
      case "OFFSTAGE":
        a.timer -= dt;
        if (a.timer <= 0) this.spawn(a);
        return;
      case "BROWSE":
        a.timer -= dt;
        if (a.timer <= 0) this.finishBrowse(a);
        return;
      case "AT_SHUTTER":
        a.timer -= dt;
        if (a.timer <= 0) {
          a.log.push({ cycle: a.cycle, store: a.store!, kind: "shutter" });
          this.afterVisit(a);
        }
        return;
      case "SIT":
        a.timer -= dt;
        if (a.timer <= 0) {
          this.setState(a, "STROLL");
          a.path = a.afterSit;
          a.afterSit = [];
        }
        return;
      case "QUEUED":
        this.followQueue(a);
        this.move(a, dt);
        if (a.path.length === 0) a.heading = node(a.atNode!).facing ?? a.heading;
        return;
      default:
        this.move(a, dt);
        if (a.path.length === 0 && MOVING.has(a.state)) this.arrive(a);
    }
  }

  private move(a: Agent, dt: number): void {
    if (a.path.length === 0) {
      if (a.activity === "walk") a.activity = "idle";
      return;
    }
    a.activity = "walk";
    const pace = a.state === "STROLL" || a.state === "DETOUR_STROLL" ? STROLL_PACE : 1;
    let budget = WALK_SPEED * a.speed * pace * this.slowFactor(a) * dt;
    while (budget > 0 && a.path.length > 0) {
      const target = node(a.path[0]);
      const dx = target.x - a.x, dz = target.z - a.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1e-6) a.heading = Math.atan2(dx, dz);
      if (dist <= budget) {
        a.x = target.x;
        a.z = target.z;
        budget -= dist;
        a.atNode = a.path.shift()!;
      } else {
        a.x += (dx / dist) * budget;
        a.z += (dz / dist) * budget;
        budget = 0;
      }
    }
    a.walkPhase += dt * a.speed * pace * 9;
    if (a.path.length === 0) a.activity = "idle";
  }

  private slowFactor(a: Agent): number {
    if (a.path.length === 0 || a.atNode === null) return 1;
    const next = node(a.path[0]);
    const mine = Math.hypot(next.x - a.x, next.z - a.z);
    let factor = 1;
    for (const b of this.agents) {
      if (b === a || !b.visible || b.path.length === 0 || b.path[0] !== a.path[0] || b.atNode !== a.atNode) continue;
      const gap = mine - Math.hypot(next.x - b.x, next.z - b.z);
      if (gap > 0 && gap < SLOW_GAP) factor = Math.min(factor, Math.max(MIN_SLOW, gap / SLOW_GAP));
    }
    return factor;
  }

  /** Doi dich: neu dang di thi di het canh hien tai roi moi re (khong dich chuyen tuc thoi). */
  private repath(a: Agent, goal: string): void {
    if (a.path.length > 0) {
      const next = a.path[0];
      a.path = [next, ...findPath(next, goal).slice(1)];
    } else {
      a.path = findPath(a.atNode!, goal).slice(1);
    }
  }

  private spawn(a: Agent): void {
    const id = SPAWN_NODES[Math.floor(a.rng() * SPAWN_NODES.length)];
    const n = node(id);
    a.x = n.x;
    a.z = n.z;
    a.atNode = id;
    a.path = [];
    a.visible = true;
    a.visitIndex = 0;
    a.bags = [];
    if (a.visits.length > 0) this.goToStore(a);
    else this.startStroll(a, 1 + Math.floor(a.rng() * 3), a.rng() < 0.4);
  }

  private goToStore(a: Agent): void {
    const store = a.visits[a.visitIndex];
    a.store = store;
    this.setState(a, "GO_TO_STORE");
    this.repath(a, this.open[store] ? storeNode(store, "A") : storeNode(store, "Dout"));
  }

  private arrive(a: Agent): void {
    switch (a.state) {
      case "GO_TO_STORE":
        if (!this.open[a.store!]) {
          this.setState(a, "AT_SHUTTER");
          a.timer = 1.5;
          a.heading = node(storeNode(a.store!, "Dout")).facing ?? a.heading;
          a.activity = "idle";
        } else {
          this.joinQueue(a);
        }
        return;
      case "DETOUR_STROLL":
        this.joinQueue(a);
        return;
      case "ENTER_STORE":
        this.setState(a, "BROWSE");
        a.timer = randRange(a.rng, 3.5, 6);
        a.heading = node(a.atNode!).facing ?? a.heading;
        a.activity = "browse";
        return;
      case "EXIT_STORE":
        this.queues[a.store!].releaseSpot(a.key);
        this.afterVisit(a);
        return;
      case "STROLL":
        this.continueStroll(a);
        return;
      case "LEAVE_SCENE":
        for (const s of STORES) this.queues[s].releaseAll(a.key);
        this.setState(a, "OFFSTAGE");
        a.visible = false;
        a.activity = "idle";
        a.timer = randRange(a.rng, 5, 15);
        a.cycle += 1;
        return;
      default:
        return;
    }
  }

  private joinQueue(a: Agent): void {
    const store = a.store!;
    const pos = this.queues[store].join(a.key, this.time);
    if (pos === null) {
      // Het o cho: di dao vong ngan toi goc pho cua shop roi quay lai thu tiep (spec muc 6).
      this.setState(a, "DETOUR_STROLL");
      const corner = storeNode(store, "C");
      a.path = [...findPath(a.atNode!, corner).slice(1), ...findPath(corner, storeNode(store, "A")).slice(1)];
      return;
    }
    a.queuedStores.add(store);
    this.setState(a, "QUEUED");
    this.repath(a, storeNode(store, `Q${pos + 1}`));
  }

  private followQueue(a: Agent): void {
    const pos = this.queues[a.store!].position(a.key);
    if (pos === null) return;
    const desired = storeNode(a.store!, `Q${pos + 1}`);
    const finalTarget = a.path.length > 0 ? a.path[a.path.length - 1] : a.atNode;
    if (finalTarget !== desired) this.repath(a, desired);
  }

  private finishBrowse(a: Agent): void {
    a.bags = [...a.bags, a.store!].slice(-2);
    a.log.push({ cycle: a.cycle, store: a.store!, kind: "enter" });
    this.setState(a, "EXIT_STORE");
    this.repath(a, storeNode(a.store!, "Dout"));
  }

  private afterVisit(a: Agent): void {
    a.visitIndex += 1;
    if (a.visitIndex < a.visits.length) this.goToStore(a);
    else this.startStroll(a, 1, false);
  }

  private startStroll(a: Agent, laps: number, bench: boolean): void {
    this.setState(a, "STROLL");
    a.strollLaps = laps;
    a.sitPending = bench;
    this.queueLap(a);
  }

  private queueLap(a: Agent): void {
    const loop = a.sitPending ? STROLL_LOOPS.frontBench : a.rng() < 0.5 ? STROLL_LOOPS.front : STROLL_LOOPS.back;
    const seq = [...findPath(a.atNode!, loop[0]).slice(1), ...loop.slice(1)];
    const benchAt = a.sitPending ? seq.indexOf("f_bench") : -1;
    if (benchAt >= 0) {
      a.path = seq.slice(0, benchAt + 1);
      a.afterSit = seq.slice(benchAt + 1);
    } else {
      a.path = seq;
    }
  }

  private continueStroll(a: Agent): void {
    if (a.sitPending && a.atNode === "f_bench") {
      a.sitPending = false;
      this.setState(a, "SIT");
      a.timer = randRange(a.rng, 3, 5);
      a.heading = node("f_bench").facing ?? a.heading;
      a.activity = "sit";
      return;
    }
    a.strollLaps -= 1;
    if (a.strollLaps > 0) {
      this.queueLap(a);
      return;
    }
    this.setState(a, "LEAVE_SCENE");
    this.repath(a, SPAWN_NODES[Math.floor(a.rng() * SPAWN_NODES.length)]);
  }
}
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx tsx --test src/web/storeScene/__tests__/director.test.ts`
Expected: PASS (9 tests). Thời gian chạy dự kiến < 30s.

**Nếu (15c) hỏng ở ngưỡng** (trung bình hàng Shopee < 4.2 hoặc không hơn TikTok 2): **không hạ ngưỡng** (spec 9.15c). Chỉnh tham số nhịp theo thứ tự: (1) giảm khoảng nghỉ OFFSTAGE `randRange(a.rng, 5, 15)` → `(3, 8)`; (2) tăng `maxWait` lên `(24, 30)`; (3) tăng thời gian xem hàng lên `(4.5, 7)`. Sau mỗi lần chỉnh chạy lại TOÀN BỘ file test (các test khác cũng phụ thuộc nhịp). Ghi tham số cuối cùng vào commit message.

**Nếu (15) không thấy `DETOUR_STROLL`**: tăng `[[25, ...]]` lên `[[30, ...]]` trong test (đây là dựng kịch bản, không phải hạ chuẩn).

- [ ] **Step 5: Commit**

```bash
git add src/web/storeScene/sim/director.ts src/web/storeScene/__tests__/director.test.ts
git commit -m "feat(cua-hang): may trang thai + dao dien nhan vat (hang cho, giu cho, dong bang, khoi dong am)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Dựng cảnh tĩnh (đường phố + 2 cửa hàng + bảng đếm) + server preview

**Files:**
- Create: `src/web/storeScene/render/textures.ts`
- Create: `src/web/storeScene/render/stage.ts`
- Create: `src/web/storeScene/render/environment.ts`
- Create: `src/web/storeScene/render/stores.ts`
- Create: `src/web/storeScene/render/labels.ts` (phần bảng đếm; nhãn tên thêm ở Task 8)
- Create: `src/web/storeScene/quality.ts` + `src/web/storeScene/__tests__/quality.test.ts`
- Modify: `src/web/storeScene/main.ts` (thay bản tạm)
- Create (KHÔNG commit, giống `preview-withdrawals.ts`): `preview-store.ts`

**Interfaces:**
- Consumes: `layout.ts` (hằng số, `DECOR`, `FOOTPRINTS`, `STORE_FACADE_CENTER`, `CROSSWALKS`), `StoreSceneData`.
- Produces:
  - `type QualityLevel = 0 | 1 | 2`; `class QualityGovernor { level: QualityLevel; constructor(onChange: (l: QualityLevel) => void); record(frameMs: number): void }`; `p95(values: number[]): number`
  - `createStage(container: HTMLElement): Stage` với `interface Stage { scene: THREE.Scene; camera: THREE.OrthographicCamera; toCamera: THREE.Vector3; render(): void; setQuality(l: QualityLevel): void; resize(): void }`
  - `buildEnvironment(): THREE.Group`
  - `buildStore(store: StoreId, open: boolean): { group: THREE.Group; boardAnchor: THREE.Vector3 }`
  - `buildStoreBoard(store: StoreId, text: string, closed: boolean): CSS2DObject`
  - `canvasTexture`, `shopeeSignTexture`, `tiktokSignTexture`, `awningTexture`, `shutterTexture`, `pavingTexture`, `blobShadowTexture`

- [ ] **Step 1: Test hỏng cho `QualityGovernor`**

`src/web/storeScene/__tests__/quality.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { QualityGovernor, p95 } from "../quality.js";

test("p95", () => {
  assert.equal(p95([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]), 19);
});

test("ha 1 muc sau 3 cua so 120 khung lien tiep co p95 > 28ms; khong tu nang lai", () => {
  const levels: number[] = [];
  const g = new QualityGovernor((l) => levels.push(l));
  const windowOf = (ms: number) => { for (let i = 0; i < 120; i++) g.record(ms); };
  windowOf(40); windowOf(40); windowOf(16); // bi ngat quang -> dem lai
  assert.deepEqual(levels, []);
  windowOf(40); windowOf(40); windowOf(40);
  assert.deepEqual(levels, [1]);
  windowOf(10); windowOf(10); windowOf(10);
  assert.equal(g.level, 1);
  windowOf(40); windowOf(40); windowOf(40);
  windowOf(40); windowOf(40); windowOf(40);
  assert.deepEqual(levels, [1, 0]);
});
```

Run: `npx tsx --test src/web/storeScene/__tests__/quality.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 2: `quality.ts`**

```ts
/** Muc chat luong tu ha (spec muc 8): 2 cao (bloom, shadow 2048) -> 1 vua (tat bloom) -> 0 thap (shadow 1024, pixelRatio 1). */
export type QualityLevel = 0 | 1 | 2;

const WINDOW = 120;
const P95_LIMIT_MS = 28;
const BAD_WINDOWS = 3;

export function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

export class QualityGovernor {
  level: QualityLevel = 2;
  private frames: number[] = [];
  private badWindows = 0;

  constructor(private readonly onChange: (level: QualityLevel) => void) {}

  record(frameMs: number): void {
    this.frames.push(frameMs);
    if (this.frames.length < WINDOW) return;
    const bad = p95(this.frames) > P95_LIMIT_MS;
    this.frames = [];
    this.badWindows = bad ? this.badWindows + 1 : 0;
    if (this.badWindows >= BAD_WINDOWS && this.level > 0) {
      this.level = (this.level - 1) as QualityLevel;
      this.badWindows = 0;
      this.onChange(this.level);
    }
  }
}
```

Run lại test → Expected: PASS.

- [ ] **Step 3: `render/textures.ts`**

```ts
import * as THREE from "three";

/** Texture ve bang canvas (khong tai anh ngoai). Font Inter da nap boi adminShell; main.ts doi fonts.ready. */
export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d")!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function drawShopeeBag(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, bg: string, fg: string) {
  ctx.fillStyle = fg;
  roundRect(ctx, x, y + size * 0.25, size, size * 0.75, size * 0.12);
  ctx.strokeStyle = fg;
  ctx.lineWidth = size * 0.08;
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size * 0.27, size * 0.22, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = bg;
  ctx.font = `900 ${size * 0.55}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("S", x + size / 2, y + size * 0.65);
}

export function shopeeSignTexture(): THREE.CanvasTexture {
  return canvasTexture(1024, 256, (ctx) => {
    ctx.fillStyle = "#ee4d2d";
    roundRect(ctx, 0, 0, 1024, 256, 48);
    drawShopeeBag(ctx, 90, 40, 170, "#ee4d2d", "#ffffff");
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 150px Inter, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText("Shopee", 300, 138);
  });
}

export function shopeeCubeTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = "#ee4d2d";
    ctx.fillRect(0, 0, 256, 256);
    drawShopeeBag(ctx, 48, 40, 160, "#ee4d2d", "#ffffff");
  });
}

function drawTiktokNote(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  ctx.font = `900 ${size}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#25f4ee";
  ctx.fillText("♪", cx - size * 0.05, cy - size * 0.03);
  ctx.fillStyle = "#fe2c55";
  ctx.fillText("♪", cx + size * 0.05, cy + size * 0.03);
  ctx.fillStyle = "#ffffff";
  ctx.fillText("♪", cx, cy);
}

export function tiktokSignTexture(): THREE.CanvasTexture {
  return canvasTexture(1024, 256, (ctx) => {
    ctx.fillStyle = "#141414";
    roundRect(ctx, 0, 0, 1024, 256, 48);
    drawTiktokNote(ctx, 170, 128, 190);
    ctx.font = "800 150px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#25f4ee";
    ctx.fillText("TikTok", 312, 132);
    ctx.fillStyle = "#fe2c55";
    ctx.fillText("TikTok", 324, 144);
    ctx.fillStyle = "#ffffff";
    ctx.fillText("TikTok", 318, 138);
  });
}

export function tiktokCubeTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = "#141414";
    ctx.fillRect(0, 0, 256, 256);
    drawTiktokNote(ctx, 128, 128, 200);
  });
}

export function awningTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(512, 64, (ctx) => {
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 === 0 ? "#f05a28" : "#fff6ee";
      ctx.fillRect(i * 64, 0, 64, 64);
    }
  });
  return tex;
}

export function shutterTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = "#9aa3ad";
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = "#7d8792";
    for (let y = 0; y < 256; y += 16) ctx.fillRect(0, y, 256, 4);
  });
}

export function pavingTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = "#dcd5ca";
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = "#cbc3b6";
    ctx.lineWidth = 4;
    for (let i = 0; i <= 256; i += 64) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function blobShadowTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, "rgba(40,30,20,0.45)");
    g.addColorStop(1, "rgba(40,30,20,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
}
```

- [ ] **Step 4: `render/stage.ts`**

```ts
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { VIEW_PITCH_DEG } from "../layout.js";
import type { QualityLevel } from "../quality.js";

/**
 * Renderer + camera ORTHOGRAPHIC co dinh (khong xoay/zoom - spec muc 5). Pitch dung CHUNG hang so voi
 * test hinh hoc (layout.VIEW_PITCH_DEG) - doi goc camera ma khong chay lai test la nhan vat co the bi
 * nha che. VIEW_WIDTH/CAMERA_TARGET chinh khi so voi anh tham chieu (Task 9).
 */
export const VIEW_WIDTH = 30;
export const CAMERA_TARGET = new THREE.Vector3(-0.5, 0.6, -0.5);

export interface Stage {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  /** Vector don vi huong TOI camera - dung de xep chieu sau nhan. */
  toCamera: THREE.Vector3;
  render(): void;
  setQuality(level: QualityLevel): void;
  resize(): void;
}

export function createStage(container: HTMLElement): Stage {
  // Nem loi khi trinh duyet khong tao duoc WebGL - main.ts bat va hien cau du phong.
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = "scene-label-layer";
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf6efe6);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const pitch = THREE.MathUtils.degToRad(VIEW_PITCH_DEG);
  const yaw = THREE.MathUtils.degToRad(45);
  const toCamera = new THREE.Vector3(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)).normalize();
  camera.position.copy(CAMERA_TARGET).addScaledVector(toCamera, 60);
  camera.lookAt(CAMERA_TARGET);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8c8b4, 1.15));
  const sun = new THREE.DirectionalLight(0xfff4e5, 2.1);
  sun.position.set(9, 18, 14);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 60 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.4, 0.85);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let level: QualityLevel = 2;

  function resize() {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    const halfW = VIEW_WIDTH / 2;
    const halfH = halfW / (w / h);
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(level === 0 ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    composer.setSize(w, h);
    labelRenderer.setSize(w, h);
  }

  function setQuality(next: QualityLevel) {
    level = next;
    bloom.enabled = next === 2;
    const size = next === 0 ? 1024 : 2048;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    resize();
  }

  new ResizeObserver(() => resize()).observe(container);
  setQuality(2);

  return {
    scene,
    camera,
    toCamera,
    render() {
      if (bloom.enabled) composer.render();
      else renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    },
    setQuality,
    resize,
  };
}
```

- [ ] **Step 5: `render/environment.ts`**

```ts
import * as THREE from "three";
import { CROSSWALKS, CURB_HEIGHT, DECOR, MAP_HALF, ROAD_HALF } from "../layout.js";
import { pavingTexture } from "./textures.js";

/** Duong pho, via he, vach, cay, den, ghe, bon cay. Chi trang tri - moi toa do lay tu layout.DECOR. */
function std(color: number, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
}

function box(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

export function buildEnvironment(): THREE.Group {
  const g = new THREE.Group();

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), std(0xefe6da));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  g.add(ground);

  const asphalt = std(0x4a4d55, { roughness: 0.95 });
  g.add(box(MAP_HALF * 2, 0.02, ROAD_HALF * 2, asphalt, 0, 0.01, 0, false));
  g.add(box(ROAD_HALF * 2, 0.021, MAP_HALF * 2, asphalt, 0, 0.0105, 0, false));

  const paving = pavingTexture();
  const blockSize = MAP_HALF - ROAD_HALF;
  paving.repeat.set(blockSize / 2, blockSize / 2);
  const blockMat = std(0xffffff, { map: paving, roughness: 0.9 });
  const curbMat = std(0xf2c230, { roughness: 0.6 });
  const mid = ROAD_HALF + blockSize / 2;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(box(blockSize, CURB_HEIGHT, blockSize, blockMat, sx * mid, CURB_HEIGHT / 2, sz * mid, false));
      // Vien le vang o 2 canh giap duong
      g.add(box(0.12, 0.03, blockSize, curbMat, sx * (ROAD_HALF + 0.06), CURB_HEIGHT + 0.015, sz * mid, false));
      g.add(box(blockSize, 0.03, 0.12, curbMat, sx * mid, CURB_HEIGHT + 0.015, sz * (ROAD_HALF + 0.06), false));
    }
  }

  const white = std(0xf7f7f2, { roughness: 0.7 });
  for (const r of CROSSWALKS) {
    const alongX = r.maxX - r.minX > r.maxZ - r.minZ; // vach cat ngang duong truc Z thi soc nam theo X
    for (let i = -2; i <= 2; i++) {
      if (alongX) g.add(box(0.42, 0.025, r.maxZ - r.minZ, white, i * 0.75, 0.03, (r.minZ + r.maxZ) / 2, false));
      else g.add(box(r.maxX - r.minX, 0.025, 0.42, white, (r.minX + r.maxX) / 2, 0.03, i * 0.75, false));
    }
  }
  for (let d = 5; d < MAP_HALF; d += 1.6) {
    for (const s of [-1, 1]) {
      g.add(box(0.8, 0.022, 0.1, white, s * d, 0.025, 0, false));
      g.add(box(0.1, 0.022, 0.8, white, 0, 0.025, s * d, false));
    }
  }

  const trunk = std(0x8a5a3b);
  const leaves = [0x6cb84a, 0x7fc957, 0x5aa83f].map((c) => std(c, { roughness: 0.7 }));
  for (const [i, t] of DECOR.trees.entries()) {
    const tree = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 1.1, 10), trunk);
    stem.position.y = 0.55;
    stem.castShadow = true;
    tree.add(stem);
    const blobs: Array<[number, number, number, number]> = [[0, 1.6, 0, 0.75], [0.45, 1.4, 0.2, 0.55], [-0.4, 1.45, -0.2, 0.58], [0.1, 2.1, -0.1, 0.5]];
    for (const [j, [bx, by, bz, r]] of blobs.entries()) {
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), leaves[(i + j) % leaves.length]);
      crown.position.set(bx, by, bz);
      crown.castShadow = true;
      tree.add(crown);
    }
    tree.position.set(t.x, CURB_HEIGHT, t.z);
    g.add(tree);
  }

  const pole = std(0x3b3f47, { metalness: 0.4, roughness: 0.5 });
  const bulb = new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffc46b, emissiveIntensity: 2.4 });
  for (const l of DECOR.lamps) {
    const lamp = new THREE.Group();
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.6, 8), pole);
    p.position.y = 1.3;
    p.castShadow = true;
    lamp.add(p);
    lamp.add(box(0.34, 0.3, 0.34, pole, 0, 2.7, 0));
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), bulb);
    b.position.y = 2.5;
    lamp.add(b);
    lamp.position.set(l.x, CURB_HEIGHT, l.z);
    g.add(lamp);
  }

  const wood = std(0xb07a4f);
  const bench = new THREE.Group();
  bench.add(box(1.3, 0.08, 0.42, wood, 0, 0.45, 0));
  bench.add(box(1.3, 0.35, 0.06, wood, 0, 0.7, -0.2));
  for (const lx of [-0.55, 0.55]) bench.add(box(0.06, 0.45, 0.38, pole, lx, 0.22, 0));
  bench.position.set(DECOR.bench.x, CURB_HEIGHT, DECOR.bench.z);
  bench.rotation.y = DECOR.bench.rotationY;
  g.add(bench);

  const pot = std(0xa86b45);
  for (const pl of DECOR.planters) {
    const planter = new THREE.Group();
    planter.add(box(1.0, 0.4, 0.5, pot, 0, 0.2, 0));
    for (const bx of [-0.28, 0, 0.28]) {
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 1), leaves[1]);
      bush.position.set(bx, 0.5, 0);
      bush.castShadow = true;
      planter.add(bush);
    }
    planter.position.set(pl.x, CURB_HEIGHT, pl.z);
    g.add(planter);
  }
  return g;
}
```

- [ ] **Step 6: `render/stores.ts`**

```ts
import * as THREE from "three";
import type { StoreId } from "../../../core/storeSceneContract.js";
import { CURB_HEIGHT, GLASS_TOP, STORE_DEPTH, STORE_FACADE_CENTER, STORE_WALL_HEIGHT, STORE_WIDTH } from "../layout.js";
import { awningTexture, shopeeCubeTexture, shopeeSignTexture, shutterTexture, tiktokCubeTexture, tiktokSignTexture } from "./textures.js";

/**
 * Dung cua hang trong HE TOA DO RIENG: mat tien (kinh) o x=0 nhin +X, tuong sau o x=-STORE_DEPTH, rong
 * theo z. Tuong kinh ben nam o z = side * W/2 (Shopee side=+1). TikTok dung CUNG ham voi side=-1 roi xoay
 * -90 do -> trung dung toa do layout (TikTok = Shopee doi x<->z) ma chu tren bien khong bi lat guong.
 * Do dat noi that: toa do trong comment la cua Shopee (local x = world x + 5, local z = world z - 6.8).
 */
const D = STORE_DEPTH, W = STORE_WIDTH, H = STORE_WALL_HEIGHT;
const DOOR_LOCAL_Z = 1.1; // world z 7.9 cua Shopee
const DOOR_HALF = 0.5;

interface Palette { body: number; trim: number; floor: number; roof: number; light: number }
const PALETTES: Record<StoreId, Palette> = {
  shopee: { body: 0xfff4ec, trim: 0xee4d2d, floor: 0xd9b48a, roof: 0xf7e6d8, light: 0xffd29a },
  tiktokshop: { body: 0x1b1b1f, trim: 0x2a2a30, floor: 0x3a3a44, roof: 0x26262c, light: 0xffe6f0 },
};

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x: number, y: number, z: number, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

export interface StoreBuild { group: THREE.Group; boardAnchor: THREE.Vector3 }

export function buildStore(store: StoreId, open: boolean): StoreBuild {
  const side = store === "shopee" ? 1 : -1;
  const pal = PALETTES[store];
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: pal.body, roughness: 0.6 });
  const trim = new THREE.MeshStandardMaterial({ color: pal.trim, roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xcfe9ff, transparent: true, opacity: 0.18, roughness: 0.05, depthWrite: false });
  const lz = (worldOffset: number) => worldOffset * side; // doi toa do noi that Shopee sang shop hien tai

  g.add(mesh(new THREE.BoxGeometry(D, 0.05, W), new THREE.MeshStandardMaterial({ color: pal.floor, roughness: 0.7 }), -D / 2, 0.025, 0, false));
  g.add(mesh(new THREE.BoxGeometry(0.15, H, W), body, -D + 0.075, H / 2, 0));
  g.add(mesh(new THREE.BoxGeometry(D, H, 0.15), body, -D / 2, H / 2, -side * (W / 2 - 0.075)));

  // Tuong kinh ben (de nhin vao trong) + dai tuong phia tren kinh.
  g.add(mesh(new THREE.BoxGeometry(D, GLASS_TOP, 0.04), glass, -D / 2, GLASS_TOP / 2, side * (W / 2 - 0.02), false));
  g.add(mesh(new THREE.BoxGeometry(D, H - GLASS_TOP, 0.15), body, -D / 2, (H + GLASS_TOP) / 2, side * (W / 2 - 0.075)));

  // Mat tien kinh, chua khe cua.
  const doorZ = DOOR_LOCAL_Z * side;
  const panes: Array<[number, number]> = [[-W / 2, doorZ - DOOR_HALF], [doorZ + DOOR_HALF, W / 2]].map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as [number, number]);
  for (const [a, b] of panes) {
    if (b - a < 0.05) continue;
    g.add(mesh(new THREE.BoxGeometry(0.04, GLASS_TOP, b - a), glass, -0.02, GLASS_TOP / 2, (a + b) / 2, false));
  }
  g.add(mesh(new THREE.BoxGeometry(0.15, H - GLASS_TOP, W), body, -0.075, (H + GLASS_TOP) / 2, 0));
  for (const z of [-W / 2, doorZ - DOOR_HALF, doorZ + DOOR_HALF, W / 2]) g.add(mesh(new THREE.BoxGeometry(0.08, GLASS_TOP, 0.08), trim, 0, GLASS_TOP / 2, z));

  g.add(mesh(new THREE.BoxGeometry(D + 0.3, 0.2, W + 0.3), new THREE.MeshStandardMaterial({ color: pal.roof, roughness: 0.8 }), -D / 2, H + 0.1, 0));

  // Bien hieu tren mat tien (mat +X cua hop mang texture).
  const signTex = store === "shopee" ? shopeeSignTexture() : tiktokSignTexture();
  const signFace = new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: open ? 0.35 : 0, roughness: 0.4 });
  const signMats = [signFace, trim, trim, trim, trim, trim];
  g.add(mesh(new THREE.BoxGeometry(0.25, 0.95, W * 0.85), signMats, 0.15, H + 0.55, 0));

  const cubeTex = store === "shopee" ? shopeeCubeTexture() : tiktokCubeTexture();
  g.add(mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), new THREE.MeshStandardMaterial({ map: cubeTex, roughness: 0.5 }), -D + 0.8, H + 0.65, -side * (W / 2 - 0.8)));

  if (store === "shopee") {
    const tex = awningTexture();
    const awningMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
    const awning = mesh(new THREE.BoxGeometry(0.9, 0.06, W * 0.95), [trim, trim, awningMat, trim, trim, trim], 0.42, GLASS_TOP + 0.08, 0);
    awning.rotation.z = -0.35;
    g.add(awning);
  } else {
    const neon = (color: number) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: open ? 2.4 : 0 });
    g.add(mesh(new THREE.BoxGeometry(0.06, 0.06, W), neon(0x25f4ee), 0.05, GLASS_TOP + 0.02, 0, false));
    g.add(mesh(new THREE.BoxGeometry(0.06, 0.06, W), neon(0xfe2c55), 0.05, H + 0.02, 0, false));
    for (const z of [-W / 2, W / 2]) g.add(mesh(new THREE.BoxGeometry(0.06, H, 0.06), neon(z * side > 0 ? 0x25f4ee : 0xfe2c55), 0.05, H / 2, z, false));
  }

  // Noi that (toa do Shopee-local): ke dao, ke tuong sau, ban trung bay canh kinh ben, quay thu ngan.
  const shelfMat = new THREE.MeshStandardMaterial({ color: store === "shopee" ? 0xf1e3d3 : 0x2f2f38, roughness: 0.6 });
  const productColors = [0xee4d2d, 0xffb84d, 0x4db6ff, 0x7bd389, 0xff8fb1, 0xb18cff, 0x25f4ee];
  const products = productColors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }));
  const addShelf = (x: number, z: number, sx: number, sy: number, sz: number) => {
    g.add(mesh(new THREE.BoxGeometry(sx, sy, sz), shelfMat, x, sy / 2 + 0.05, lz(z)));
    let k = 0;
    for (let y = 0.35; y < sy; y += 0.38) {
      for (let t = -0.4; t <= 0.4; t += 0.2) {
        const along = Math.abs(sz) > Math.abs(sx);
        const px = along ? x : x + t * sx;
        const pz = along ? z + t * sz : z;
        g.add(mesh(new THREE.BoxGeometry(0.14, 0.18, 0.14), products[k++ % products.length], px, y + 0.14, lz(pz)));
      }
    }
  };
  addShelf(-2.4, -0.95, 0.45, 1.1, 1.9);
  addShelf(-3.35, 1.25, 0.35, 1.6, 1.5);
  addShelf(-1.6, 2.0, 1.2, 0.6, 0.35);
  g.add(mesh(new THREE.BoxGeometry(0.6, 0.9, 0.5), trim, -3.1, 0.5, lz(-1.8)));

  const light = new THREE.PointLight(pal.light, open ? 8 : 0, 7, 2);
  light.position.set(-1.8, 2.5, 0);
  g.add(light);

  if (!open) {
    const shutter = new THREE.MeshStandardMaterial({ map: shutterTexture(), roughness: 0.7, metalness: 0.2 });
    g.add(mesh(new THREE.BoxGeometry(0.08, GLASS_TOP, W), shutter, 0.06, GLASS_TOP / 2, 0));
  }

  const center = STORE_FACADE_CENTER[store];
  g.position.set(center.x, CURB_HEIGHT, center.z);
  g.rotation.y = store === "shopee" ? 0 : -Math.PI / 2;
  g.updateMatrixWorld(true);
  const boardAnchor = new THREE.Vector3(0.3, H + 1.4, 0).applyMatrix4(g.matrixWorld);
  return { group: g, boardAnchor };
}
```

- [ ] **Step 7: `render/labels.ts` (bảng đếm)**

```ts
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { StoreId } from "../../../core/storeSceneContract.js";

/** Bang dem "🔗 N link hom nay" tren bien hieu - cho biet SO LINK (hang cho cho biet SO NGUOI). */
export function buildStoreBoard(store: StoreId, text: string, closed: boolean): CSS2DObject {
  const el = document.createElement("div");
  el.className = `scene-board scene-board-${store}${closed ? " is-closed" : ""}`;
  el.textContent = text;
  const obj = new CSS2DObject(el);
  obj.center.set(0.5, 1);
  return obj;
}
```

- [ ] **Step 8: `main.ts` (bản cảnh tĩnh)**

```ts
import type { StoreId, StoreSceneData } from "../../core/storeSceneContract.js";
import { STORE_IDS } from "../../core/storeSceneContract.js";
import { createStage, type Stage } from "./render/stage.js";
import { buildEnvironment } from "./render/environment.js";
import { buildStore } from "./render/stores.js";
import { buildStoreBoard } from "./render/labels.js";

/** Diem vao bundle canh 3D cua /admin/cua-hang. DOM do adminStoreHtml.ts render. */
const FAIL_TEXT = "Không hiển thị được cảnh 3D trên trình duyệt này.";

function boardText(data: StoreSceneData, store: StoreId): string {
  const open = store === "shopee" || data.tiktokOpen;
  if (!open) return "Tạm đóng cửa";
  return `🔗 ${data.storeLinks[store]} link ${data.isToday ? "hôm nay" : "hôm qua"}`;
}

async function start(): Promise<void> {
  const container = document.getElementById("store-scene");
  const status = document.getElementById("store-scene-status");
  const dataEl = document.getElementById("store-scene-data");
  if (!container || !dataEl) return;
  const data = JSON.parse(dataEl.textContent ?? "{}") as StoreSceneData;

  let stage: Stage;
  try {
    stage = createStage(container);
  } catch (err) {
    console.warn("[cua-hang] khong tao duoc WebGL", err);
    if (status) status.textContent = FAIL_TEXT;
    return;
  }
  await document.fonts?.ready.catch(() => undefined);

  stage.scene.add(buildEnvironment());
  for (const s of STORE_IDS) {
    const open = s === "shopee" || data.tiktokOpen;
    const built = buildStore(s, open);
    stage.scene.add(built.group);
    const board = buildStoreBoard(s, boardText(data, s), !open);
    board.position.copy(built.boardAnchor);
    stage.scene.add(board);
  }
  status?.remove();

  const frame = () => {
    stage.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

start().catch((err) => {
  console.error("[cua-hang]", err);
  const status = document.getElementById("store-scene-status");
  if (status) status.textContent = FAIL_TEXT;
});
```

- [ ] **Step 9: Server preview (KHÔNG commit)**

`preview-store.ts` (thư mục gốc repo, cùng kiểu `preview-server.ts`; không bật bot thật — xem memory "Preview trang admin không bật bot"):

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "./src/api/server.js";
import { AdminSessionStore } from "./src/core/adminAuth.js";
import { LedgerStore } from "./src/core/ledgerStore.js";
import { LogStore } from "./src/core/logStore.js";
import { LinkResolverService } from "./src/core/linkResolverService.js";
import { RateLimiter } from "./src/core/rateLimiter.js";
import { MockAffiliateProvider } from "./src/core/providers/mockProvider.js";
import { addDaysToVnIso, todayVnIso, vnDayStartUtcIso } from "./src/core/vietnamDate.js";

// Preview /admin/cua-hang tren DB tam voi 30 user gia. Chay: npx tsx preview-store.ts
// TikTok mo: TIKTOK_ENABLED=true npx tsx preview-store.ts (xem env.ts neu ten bien khac).
const dir = mkdtempSync(join(tmpdir(), "preview-store-"));
const logStore = new LogStore(join(dir, "requests.db"));
const ledgerStore = new LedgerStore(join(dir, "ledger.db"));
const resolver = new LinkResolverService(new MockAffiliateProvider(), logStore, new RateLimiter(1000, 60_000));
const NAMES = ["to dat", "bichngoc", "minhlee", "hieuvn", "trangmi", "anhtu", "linhchi", "khanhly", "Nguyễn Hoàng Trâm Anh", "baoan",
  "thuha", "quanghuy", "mylinh", "ducanh", "thanhthao", "kimngan", "vietanh", "phuongvy", "tuananh", "ngoclan",
  "hoangnam", "maianh", "giabao", "camtu", "huyenmy", "duykhanh", "lananh", "minhchau", "thienan", "yennhi"];
const PRODUCTS = ["Áo linen form chuẩn Hàn Quốc", "Kính cường lực iPhone 15", "Son kem lì", "Tai nghe bluetooth", null];
const today = todayVnIso();
const base = Date.parse(vnDayStartUtcIso(today));
NAMES.forEach((name, i) => {
  const userId = `uid-${100000 + i}`;
  ledgerStore.upsertUserProfile("zalo", userId, name);
  const links = i < 12 ? 3 : i < 15 ? 2 : i < 20 ? 1 : 0;
  for (let k = 0; k < links; k++) {
    const merchant = i < 12 ? "shopee" : i < 15 ? "tiktokshop" : k % 2 === 0 ? "shopee" : "tiktokshop";
    logStore.record({ platform: "zalo", merchant, userId, originalUrl: "https://shopee.vn/product/1/2", subId: `k-${userId}-${k}`, outcome: "success", errorCode: null, affiliateUrl: "https://bot.example/s/x", productName: PRODUCTS[(i + k) % PRODUCTS.length] ?? undefined, timestamp: new Date(base + (8 + i * 0.4 + k) * 3600_000).toISOString() });
  }
  if (links === 0) logStore.record({ platform: "zalo", merchant: "shopee", userId, originalUrl: "https://shopee.vn/product/1/2", subId: `k-${userId}-old`, outcome: "success", errorCode: null, affiliateUrl: "https://bot.example/s/x", timestamp: new Date(Date.parse(vnDayStartUtcIso(addDaysToVnIso(today, -3))) + 10 * 3600_000).toISOString() });
});
const orderConfig = { taxPercent: 10, platformFeePercent: 1, userSharePercent: 80, maxCommissionRatioPercent: 1000, holdConfig: { thresholdVnd: 0, holdDays: 0 } };
const app = createServer(resolver, logStore, ledgerStore, async () => {}, 50_000, new AdminSessionStore("preview"), orderConfig, join(dir, "proofs"), new RateLimiter(1000, 60_000), "http://localhost:3098", async () => {});
app.listen(3098, () => console.log("preview http://localhost:3098/admin/cua-hang  (mat khau: preview)"));
```

- [ ] **Step 10: Build + kiểm bằng mắt**

Run: `npm run typecheck && npm run build:css && npm run build:scene && npx tsx --test src/web/storeScene/__tests__/*.test.ts`
Expected: sạch + PASS.

Run (nền): `npx tsx preview-store.ts` rồi mở Chrome (công cụ `mcp__claude-in-chrome__*`, tab mới), đăng nhập `preview`, vào `http://localhost:3098/admin/cua-hang`, cửa sổ 1440×900. Chụp ảnh và so với ảnh tham chiếu của chủ bot (Shopee góc trên-trái, TikTok góc trên-phải, ngã tư ở giữa, 4 vạch sang đường, cây hai góc dưới). Kiểm: biển hiệu đọc được và không bị lật gương; mặt kính nhìn thấy kệ bên trong; bảng đếm nổi trên biển hiệu; console không có lỗi. Chỉnh `VIEW_WIDTH`/`CAMERA_TARGET` trong `stage.ts` nếu khung hình lệch. **Không đổi `VIEW_PITCH_DEG`** trừ khi chạy lại test layout.

- [ ] **Step 11: Commit**

```bash
git add src/web/storeScene/render src/web/storeScene/quality.ts src/web/storeScene/__tests__/quality.test.ts src/web/storeScene/main.ts
git commit -m "feat(cua-hang): dung canh tinh 3D (duong pho, 2 cua hang, bang dem tren bien hieu)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Nhân vật chibi + nhãn tên ×N + túi + nối với mô phỏng

**Files:**
- Create: `src/web/storeScene/variants.ts` + `src/web/storeScene/__tests__/variants.test.ts`
- Create: `src/web/storeScene/render/characters.ts`
- Modify: `src/web/storeScene/render/labels.ts` (thêm nhãn tên + thứ tự chiều sâu)
- Modify: `src/web/storeScene/main.ts`

**Interfaces:**
- Consumes: `Director`, `AgentView`, `SIM_STEP`, `MAX_DT` (Task 6); `Stage` (Task 7); `groundY` (layout); `SceneCharacter`.
- Produces:
  - `variants.ts`: `HAIR_STYLES`, `OUTFITS`, `ACCESSORIES` (tuple const), `interface Palette { skin; hair; top; bottom; shoes; accent: string }`, `interface Variant { hair; outfit; accessory; palette: Palette; scale: number }`, `VARIANTS: readonly Variant[]` (độ dài 50)
  - `characters.ts`: `interface CharacterRig { root; body; head; legL; legR; armL; armR: THREE.Group; bagL: Record<StoreId, THREE.Object3D>; bagR: Record<StoreId, THREE.Object3D> }`, `buildCharacter(variantIndex: number): CharacterRig`, `poseCharacter(rig: CharacterRig, view: AgentView, timeS: number): void`
  - `labels.ts`: `buildNameLabel(ch: SceneCharacter, level: number): CSS2DObject`, `applyDepthOrder(labels: readonly CSS2DObject[], toCamera: THREE.Vector3): void`

- [ ] **Step 1: Test hỏng cho bảng mẫu**

`src/web/storeScene/__tests__/variants.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { VARIANTS } from "../variants.js";
import { VARIANT_COUNT } from "../../../core/storeSceneContract.js";

test("dung 50 mau, moi cap khac nhau o >= 2 trong 3 chieu hinh dang", () => {
  assert.equal(VARIANTS.length, VARIANT_COUNT);
  for (let i = 0; i < VARIANTS.length; i++) {
    for (let j = i + 1; j < VARIANTS.length; j++) {
      const a = VARIANTS[i], b = VARIANTS[j];
      const diff = Number(a.hair !== b.hair) + Number(a.outfit !== b.outfit) + Number(a.accessory !== b.accessory);
      assert.ok(diff >= 2, `mau ${i} va ${j} chi khac ${diff} chieu`);
    }
  }
});

test("ti le co the trong [0.92, 1.08]", () => {
  for (const v of VARIANTS) assert.ok(v.scale >= 0.92 - 1e-9 && v.scale <= 1.08 + 1e-9);
});
```

Run: `npx tsx --test src/web/storeScene/__tests__/variants.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 2: `variants.ts`**

```ts
import { VARIANT_COUNT } from "../../core/storeSceneContract.js";

/**
 * 50 mau nhan vat CO DINH (khong ngau nhien). Phu kien = (toc + trang phuc) mod 8 voi 7 kieu toc x 8 trang
 * phuc: 2 mau bat ky luon khac nhau o >= 2 trong 3 chieu hinh dang (cung toc khac trang phuc -> phu kien
 * khac; cung trang phuc khac toc -> phu kien khac) - dong nhieu nguoi van phan biet duoc (spec 3.3).
 */
export const HAIR_STYLES = ["short", "spiky", "long", "ponytail", "bun", "twintails", "bob"] as const;
export const OUTFITS = ["tee-shorts", "tee-pants", "hoodie", "dress", "skirt", "jacket", "overall", "sweater-skirt"] as const;
export const ACCESSORIES = ["none", "backpack", "cap", "glasses", "crossbody", "beanie", "bow", "headphones"] as const;

export interface Palette { skin: string; hair: string; top: string; bottom: string; shoes: string; accent: string }
export interface Variant {
  hair: (typeof HAIR_STYLES)[number];
  outfit: (typeof OUTFITS)[number];
  accessory: (typeof ACCESSORIES)[number];
  palette: Palette;
  scale: number;
}

const PALETTES: Palette[] = [
  { skin: "#f6d3b8", hair: "#2b1d16", top: "#3b82f6", bottom: "#1e293b", shoes: "#f8fafc", accent: "#f59e0b" },
  { skin: "#eac09f", hair: "#5b3a29", top: "#f472b6", bottom: "#fef3c7", shoes: "#7c2d12", accent: "#a78bfa" },
  { skin: "#f8dcc6", hair: "#111111", top: "#22c55e", bottom: "#334155", shoes: "#0f172a", accent: "#ef4444" },
  { skin: "#d9a982", hair: "#3f2a1d", top: "#fde047", bottom: "#475569", shoes: "#f1f5f9", accent: "#0ea5e9" },
  { skin: "#f3c9a5", hair: "#7c4a2d", top: "#f97316", bottom: "#e2e8f0", shoes: "#1f2937", accent: "#14b8a6" },
  { skin: "#f6d3b8", hair: "#1c1917", top: "#a855f7", bottom: "#111827", shoes: "#fafaf9", accent: "#facc15" },
  { skin: "#e8b995", hair: "#4a2c1c", top: "#06b6d4", bottom: "#f5f5f4", shoes: "#78350f", accent: "#ec4899" },
  { skin: "#f9e0cc", hair: "#2d2420", top: "#ef4444", bottom: "#1e3a8a", shoes: "#f8fafc", accent: "#84cc16" },
  { skin: "#dfae8b", hair: "#0b0b0b", top: "#f1f5f9", bottom: "#be185d", shoes: "#111827", accent: "#3b82f6" },
  { skin: "#f2c6a6", hair: "#6b4226", top: "#10b981", bottom: "#fde68a", shoes: "#374151", accent: "#f43f5e" },
];

function build(): Variant[] {
  const out: Variant[] = [];
  for (let i = 0; i < VARIANT_COUNT; i++) {
    const h = i % HAIR_STYLES.length;
    const o = Math.floor(i / HAIR_STYLES.length);
    out.push({
      hair: HAIR_STYLES[h],
      outfit: OUTFITS[o],
      accessory: ACCESSORIES[(h + o) % ACCESSORIES.length],
      palette: PALETTES[(i * 3) % PALETTES.length],
      scale: 0.92 + ((i * 5) % 9) * 0.02,
    });
  }
  return out;
}

export const VARIANTS: readonly Variant[] = build();
```

Run test → Expected: PASS.

- [ ] **Step 3: `render/characters.ts`**

```ts
import * as THREE from "three";
import type { StoreId } from "../../../core/storeSceneContract.js";
import { groundY } from "../layout.js";
import type { AgentView } from "../sim/director.js";
import { VARIANTS, type Variant } from "../variants.js";
import { blobShadowTexture } from "./textures.js";

/**
 * Nhan vat chibi ghep tu khoi bo tron (spec muc 5): dau ~45% chieu cao, toc roi, than, tay chan xoay quanh
 * khop. Hinh khoi + vat lieu DUNG CHUNG giua 30 nhan vat (vat lieu cache theo mau). Chi than + dau do bong
 * that; con lai dung bong tron mo duoi chan cho nhe.
 */
const G = {
  head: new THREE.SphereGeometry(0.24, 24, 16),
  hairCap: new THREE.SphereGeometry(0.255, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
  hairCapLong: new THREE.SphereGeometry(0.262, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.62),
  eye: new THREE.SphereGeometry(0.03, 10, 8),
  blush: new THREE.SphereGeometry(0.035, 10, 8),
  torso: new THREE.CapsuleGeometry(0.14, 0.14, 6, 14),
  arm: new THREE.CapsuleGeometry(0.045, 0.16, 4, 8),
  hand: new THREE.SphereGeometry(0.05, 10, 8),
  leg: new THREE.CapsuleGeometry(0.055, 0.16, 4, 8),
  shoe: new THREE.SphereGeometry(0.07, 10, 8),
  ball: new THREE.SphereGeometry(0.1, 14, 10),
  cone: new THREE.ConeGeometry(0.05, 0.14, 8),
  dress: new THREE.CylinderGeometry(0.12, 0.23, 0.26, 18),
  skirt: new THREE.CylinderGeometry(0.13, 0.2, 0.16, 18),
  shorts: new THREE.CylinderGeometry(0.066, 0.066, 0.09, 10),
  hood: new THREE.TorusGeometry(0.13, 0.04, 8, 18),
  panel: new THREE.BoxGeometry(0.44, 0.42, 0.1),
  backpack: new THREE.BoxGeometry(0.22, 0.24, 0.1),
  brim: new THREE.CylinderGeometry(0.15, 0.15, 0.02, 18),
  lens: new THREE.TorusGeometry(0.045, 0.01, 6, 16),
  smallBox: new THREE.BoxGeometry(0.1, 0.08, 0.05),
  strap: new THREE.TorusGeometry(0.2, 0.012, 6, 24),
  band: new THREE.TorusGeometry(0.27, 0.02, 6, 24, Math.PI),
  earCup: new THREE.CylinderGeometry(0.06, 0.06, 0.05, 12),
  strip: new THREE.BoxGeometry(0.08, 0.3, 0.02),
  bib: new THREE.BoxGeometry(0.18, 0.16, 0.02),
  bag: new THREE.BoxGeometry(0.14, 0.16, 0.07),
  bagHandle: new THREE.TorusGeometry(0.04, 0.008, 6, 12, Math.PI),
  bagStripe: new THREE.BoxGeometry(0.145, 0.02, 0.072),
  shadow: new THREE.PlaneGeometry(0.75, 0.75),
};
const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, roughness = 0.65): THREE.MeshStandardMaterial {
  const key = `${color}|${roughness}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness });
    matCache.set(key, m);
  }
  return m;
}
let shadowMat: THREE.MeshBasicMaterial | null = null;

function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, cast = false) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = cast;
  parent.add(m);
  return m;
}

export interface CharacterRig {
  root: THREE.Group; body: THREE.Group; head: THREE.Group;
  legL: THREE.Group; legR: THREE.Group; armL: THREE.Group; armR: THREE.Group;
  bagL: Record<StoreId, THREE.Object3D>; bagR: Record<StoreId, THREE.Object3D>;
}

function buildBag(store: StoreId): THREE.Group {
  const g = new THREE.Group();
  add(g, G.bag, mat(store === "shopee" ? "#ee4d2d" : "#141414"), 0, -0.1, 0);
  add(g, G.bagHandle, mat(store === "shopee" ? "#ffffff" : "#25f4ee"), 0, -0.02, 0);
  if (store === "tiktokshop") add(g, G.bagStripe, mat("#fe2c55"), 0, -0.1, 0);
  g.visible = false;
  return g;
}

function addHair(head: THREE.Group, v: Variant) {
  const c = mat(v.palette.hair, 0.55);
  const cap = add(head, v.hair === "long" || v.hair === "bob" ? G.hairCapLong : G.hairCap, c, 0, 0.01, -0.01);
  cap.rotation.x = -0.3;
  if (v.hair === "bob") cap.scale.set(1.08, 1, 1.08);
  if (v.hair === "spiky") for (const [x, z] of [[0, 0], [0.1, -0.05], [-0.1, -0.05], [0.05, 0.08], [-0.05, 0.08]]) add(head, G.cone, c, x, 0.27, z);
  if (v.hair === "long") add(head, G.panel, c, 0, -0.15, -0.17);
  if (v.hair === "ponytail") { add(head, G.ball, c, 0, 0.02, -0.28); add(head, G.ball, c, 0, -0.12, -0.3).scale.setScalar(0.7); }
  if (v.hair === "bun") add(head, G.ball, c, 0, 0.26, -0.06);
  if (v.hair === "twintails") { add(head, G.ball, c, 0.27, -0.06, -0.05).scale.setScalar(0.9); add(head, G.ball, c, -0.27, -0.06, -0.05).scale.setScalar(0.9); }
}

function addAccessory(body: THREE.Group, head: THREE.Group, v: Variant) {
  const a = mat(v.palette.accent, 0.5);
  switch (v.accessory) {
    case "backpack": add(body, G.backpack, a, 0, 0.46, -0.17); break;
    case "cap": { add(head, G.hairCap, a, 0, 0.03, 0).rotation.x = -0.15; add(head, G.brim, a, 0, 0.13, 0.17).rotation.x = 0.25; break; }
    case "glasses": { add(head, G.lens, mat("#111827"), 0.08, 0, 0.235); add(head, G.lens, mat("#111827"), -0.08, 0, 0.235); break; }
    case "crossbody": { add(body, G.smallBox, a, 0.15, 0.32, 0.08); const s = add(body, G.strap, a, 0, 0.47, 0); s.rotation.set(0, Math.PI / 2, 0.6); break; }
    case "beanie": { const b = add(head, G.hairCap, a, 0, 0.04, 0); b.scale.set(1.05, 1.15, 1.05); add(head, G.ball, a, 0, 0.32, 0).scale.setScalar(0.5); break; }
    case "bow": { const l = add(head, G.cone, a, 0.12, 0.2, 0.05); l.rotation.z = Math.PI / 2; const r = add(head, G.cone, a, 0.24, 0.2, 0.05); r.rotation.z = -Math.PI / 2; break; }
    case "headphones": { add(head, G.band, mat("#1f2937"), 0, 0.02, 0); for (const x of [0.25, -0.25]) add(head, G.earCup, a, x, 0, 0).rotation.z = Math.PI / 2; break; }
    default: break;
  }
}

export function buildCharacter(variantIndex: number): CharacterRig {
  const v = VARIANTS[variantIndex % VARIANTS.length];
  const p = v.palette;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  shadowMat ??= new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false });
  const shadow = new THREE.Mesh(G.shadow, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  root.add(shadow);

  const skin = mat(p.skin, 0.7);
  const top = mat(v.outfit === "jacket" ? p.accent : p.top);
  const bottom = mat(p.bottom);
  const legsBare = v.outfit === "dress" || v.outfit === "skirt" || v.outfit === "sweater-skirt";

  const torso = add(body, G.torso, top, 0, 0.44, 0, true);
  if (v.outfit === "sweater-skirt") torso.scale.set(1.08, 1, 1.08);
  if (v.outfit === "hoodie") add(body, G.hood, top, 0, 0.62, -0.02).rotation.x = Math.PI / 2;
  if (v.outfit === "dress") add(body, G.dress, top, 0, 0.3, 0);
  if (v.outfit === "skirt" || v.outfit === "sweater-skirt") add(body, G.skirt, bottom, 0, 0.3, 0);
  if (v.outfit === "jacket") add(body, G.strip, mat(p.top), 0, 0.45, 0.14);
  if (v.outfit === "overall") add(body, G.bib, bottom, 0, 0.47, 0.135);

  const makeLeg = (x: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.3, 0);
    add(pivot, G.leg, legsBare || v.outfit === "tee-shorts" ? skin : bottom, 0, -0.13, 0);
    if (v.outfit === "tee-shorts") add(pivot, G.shorts, bottom, 0, -0.02, 0);
    add(pivot, G.shoe, mat(p.shoes), 0, -0.27, 0.02).scale.set(1, 0.7, 1.4);
    body.add(pivot);
    return pivot;
  };
  const legL = makeLeg(0.07);
  const legR = makeLeg(-0.07);

  const bagL = { shopee: buildBag("shopee"), tiktokshop: buildBag("tiktokshop") };
  const bagR = { shopee: buildBag("shopee"), tiktokshop: buildBag("tiktokshop") };
  const makeArm = (x: number, bags: Record<StoreId, THREE.Group>) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.56, 0);
    add(pivot, G.arm, top, 0, -0.12, 0);
    add(pivot, G.hand, skin, 0, -0.25, 0);
    for (const b of Object.values(bags)) { b.position.set(0, -0.28, 0); pivot.add(b); }
    body.add(pivot);
    return pivot;
  };
  const armL = makeArm(0.18, bagL);
  const armR = makeArm(-0.18, bagR);

  const head = new THREE.Group();
  head.position.set(0, 0.82, 0);
  add(head, G.head, skin, 0, 0, 0, true);
  add(head, G.eye, mat("#1f2937", 0.3), 0.08, 0, 0.215);
  add(head, G.eye, mat("#1f2937", 0.3), -0.08, 0, 0.215);
  add(head, G.blush, mat("#f9a8b4"), 0.13, -0.06, 0.19).scale.z = 0.3;
  add(head, G.blush, mat("#f9a8b4"), -0.13, -0.06, 0.19).scale.z = 0.3;
  addHair(head, v);
  body.add(head);
  addAccessory(body, head, v);

  root.scale.setScalar(v.scale);
  return { root, body, head, legL, legR, armL, armR, bagL, bagR };
}

/** Dat dang moi khung hinh tu trang thai mo phong. Khong tu giu trang thai nao ngoai rig. */
export function poseCharacter(rig: CharacterRig, view: AgentView, timeS: number): void {
  rig.root.visible = view.visible;
  if (!view.visible) return;
  rig.root.position.set(view.x, groundY(view.x, view.z), view.z);
  rig.root.rotation.y = view.heading;
  const s = Math.sin(view.walkPhase);
  rig.body.position.y = 0;
  rig.head.rotation.set(0, 0, 0);
  if (view.activity === "walk") {
    rig.legL.rotation.x = s * 0.6;
    rig.legR.rotation.x = -s * 0.6;
    rig.armL.rotation.x = -s * 0.5;
    rig.armR.rotation.x = s * 0.5;
    rig.body.position.y = Math.abs(Math.cos(view.walkPhase)) * 0.03;
    rig.head.rotation.z = s * 0.04;
  } else if (view.activity === "browse") {
    rig.legL.rotation.x = rig.legR.rotation.x = 0;
    rig.armR.rotation.x = -1.1 + Math.sin(timeS * 3) * 0.15;
    rig.armL.rotation.x = 0.1;
    rig.head.rotation.x = 0.12;
  } else if (view.activity === "sit") {
    rig.legL.rotation.x = rig.legR.rotation.x = -1.4;
    rig.armL.rotation.x = rig.armR.rotation.x = -0.3;
    rig.body.position.y = -0.12;
  } else {
    rig.legL.rotation.x = rig.legR.rotation.x = 0;
    const sway = Math.sin(timeS * 1.5) * 0.05;
    rig.armL.rotation.x = sway;
    rig.armR.rotation.x = -sway;
    rig.body.position.y = Math.sin(timeS * 2) * 0.006;
  }
  const last = view.bags[view.bags.length - 1];
  const prev = view.bags[view.bags.length - 2];
  for (const st of ["shopee", "tiktokshop"] as StoreId[]) {
    rig.bagR[st].visible = last === st;
    rig.bagL[st].visible = prev === st;
  }
}
```

- [ ] **Step 4: Nhãn tên + thứ tự chiều sâu** — thêm vào `render/labels.ts`:

```ts
import * as THREE from "three";
import type { SceneCharacter } from "../../../core/storeSceneContract.js";

/**
 * Nhan "[avatar] ten ×N" (spec 5.1). Moi chuoi gan bang textContent (khong innerHTML). avatarUrl da qua
 * safeAvatarUrl o server (chi https, khong co ' " ( ) \\ hay khoang trang) nen dat duoc vao url("").
 * ×N = tong link ngay dang xem, CO DINH suot phien; N = 0 -> khong hien chip.
 */
export function buildNameLabel(ch: SceneCharacter, level: number): CSS2DObject {
  const el = document.createElement("div");
  el.className = "scene-label";
  const avatar = document.createElement("span");
  avatar.className = "scene-label-avatar";
  if (ch.avatarUrl) avatar.style.backgroundImage = `url("${ch.avatarUrl}")`;
  else avatar.textContent = ch.initials;
  const name = document.createElement("span");
  name.className = "scene-label-name";
  name.textContent = ch.name;
  el.append(avatar, name);
  if (ch.visits.length > 0) {
    const count = document.createElement("span");
    count.className = "scene-label-count";
    count.textContent = `×${ch.visits.length}`;
    el.append(count);
  }
  const obj = new CSS2DObject(el);
  obj.center.set(0.5, 1);
  obj.position.set(0, 1.28 + level * 0.2, 0); // 3 muc cao xen ke de giam chong nhan
  return obj;
}

const tmp = new THREE.Vector3();
/**
 * Gan zIndex theo do sau (gan camera hon -> de len). Goi SAU labelRenderer.render() de de len thu tu mac
 * dinh cua thu vien - spec 5.1 chot tu lam, khong phu thuoc hanh vi mac dinh.
 */
export function applyDepthOrder(labels: readonly CSS2DObject[], toCamera: THREE.Vector3): void {
  for (const l of labels) {
    l.getWorldPosition(tmp);
    l.element.style.zIndex = String(10000 + Math.round(tmp.dot(toCamera) * 100));
  }
}
```

(Nhớ gộp import `CSS2DObject` với import sẵn có ở đầu file.)

- [ ] **Step 5: Nối mô phỏng vào `main.ts`**

Sửa `main.ts`: thêm import

```ts
import { Director, MAX_DT } from "./sim/director.js";
import { buildCharacter, poseCharacter, type CharacterRig } from "./render/characters.js";
import { applyDepthOrder, buildNameLabel } from "./render/labels.js";
import type { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
```

Thay đoạn từ `status?.remove();` tới hết vòng `frame` bằng:

```ts
  const rigs = new Map<string, CharacterRig>();
  const labels: CSS2DObject[] = [];
  const labelOf = new Map<string, CSS2DObject>();
  data.characters.forEach((ch, i) => {
    const rig = buildCharacter(ch.variant);
    const label = buildNameLabel(ch, i % 3);
    rig.root.add(label);
    stage.scene.add(rig.root);
    rigs.set(ch.key, rig);
    labels.push(label);
    labelOf.set(ch.key, label);
  });

  const director = new Director(
    data.characters.map((c) => ({ key: c.key, seed: c.seed, visits: c.visits })),
    { tiktokOpen: data.tiktokOpen, storeUsers: data.storeUsers }
  );
  director.warmUp();
  status?.remove();

  let last = performance.now();
  let rafId = 0;
  let running = true;
  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, MAX_DT);
    last = now;
    director.step(dt);
    for (const view of director.views()) {
      poseCharacter(rigs.get(view.key)!, view, now / 1000);
      // CSS2DRenderer chi xet object.visible cua CHINH nhan, khong xet cha -> phai an tay.
      labelOf.get(view.key)!.visible = view.visible;
    }
    stage.render();
    applyDepthOrder(labels, stage.toCamera);
    rafId = requestAnimationFrame(frame);
  };
  // An tab: dung han va DONG BANG dong ho mo phong; hien lai: dat lai moc, khung dau dt = 0 (spec muc 7).
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(rafId);
      running = false;
    } else if (!running) {
      running = true;
      last = performance.now();
      rafId = requestAnimationFrame(frame);
    }
  });
  rafId = requestAnimationFrame(frame);
```

- [ ] **Step 6: Build + kiểm bằng mắt**

Run: `npm run typecheck && npm run build:scene && npx tsx --test src/web/storeScene/__tests__/*.test.ts`
Expected: sạch + PASS.

Preview (`npx tsx preview-store.ts`, Chrome 1440×900, đăng nhập `preview`): mở `/admin/cua-hang`, quan sát ≥ 2 phút. Kiểm: nhân vật đi trên vỉa hè, qua đường đúng vạch; vào shop qua cửa, đứng trước kệ, ra cửa có túi (cam/đen); hàng chờ Shopee (12 user) dài hơn rõ TikTok (3 user), cách đều, không chắn vạch, không che kính; nhãn bám đầu, chip ×3/×2/×1 đúng, người đi dạo không có chip; nhãn gần camera đè nhãn xa. Ghi lại bằng GIF (`gif_creator`, tên `cua-hang-hoat-anh.gif`). Sửa toạ độ/kích thước nếu nhân vật xuyên vật thể (đổi `layout.ts` thì chạy lại test layout).

- [ ] **Step 7: Commit**

```bash
git add src/web/storeScene/variants.ts src/web/storeScene/__tests__/variants.test.ts src/web/storeScene/render/characters.ts src/web/storeScene/render/labels.ts src/web/storeScene/main.ts
git commit -m "feat(cua-hang): nhan vat chibi 50 mau + nhan ten xN + tui hang, noi voi mo phong

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Chất lượng tự hạ, đo hiệu năng, kiểm dự phòng

**Files:**
- Modify: `src/web/storeScene/main.ts`

**Interfaces:**
- Consumes: `QualityGovernor` (Task 7), `Stage.setQuality`.
- Produces: `window.__storeScenePerf` (chỉ khi URL có `?perf=1`): `{ frameMs: number[]; level: number; warmupMs: number; warmupSimS: number }`.

- [ ] **Step 1: Nối governor + số đo**

Trong `main.ts`, import `QualityGovernor` từ `"./quality.js"`. Thay `director.warmUp();` bằng:

```ts
  const perfOn = new URLSearchParams(location.search).has("perf");
  const perf = { frameMs: [] as number[], level: 2, warmupMs: 0, warmupSimS: 0 };
  if (perfOn) (window as unknown as { __storeScenePerf: typeof perf }).__storeScenePerf = perf;
  const warmStart = performance.now();
  perf.warmupSimS = director.warmUp();
  perf.warmupMs = performance.now() - warmStart;
  const governor = new QualityGovernor((level) => {
    perf.level = level;
    stage.setQuality(level);
  });
```

Trong `frame`, ngay sau `last = now;` thêm (đo khoảng giữa 2 khung thật, trước khi kẹp):

```ts
    const frameMs = now - prevFrame;
    prevFrame = now;
    if (frameMs > 0) {
      governor.record(frameMs);
      if (perfOn) perf.frameMs.push(frameMs);
    }
```

Khai báo `let prevFrame = performance.now();` cạnh `let last`, và trong nhánh `visibilitychange` hiện lại thêm `prevFrame = last;` (khoảng ẩn tab không được tính là khung giật).

- [ ] **Step 2: Đo hiệu năng theo cấu hình chuẩn (spec mục 8)**

Run: `npm run build:scene && ls -l public/store-scene.js && gzip -c public/store-scene.js | wc -c`
Ghi lại kích thước gốc + gzip.

Preview với `/admin/cua-hang?perf=1` (Chrome stable, 1440×900, 30 user giả, mức Cao). Chờ 60s rồi chạy qua `javascript_tool`:

```js
(() => { const p = window.__storeScenePerf; const f = p.frameMs.slice(-3600); const s = [...f].sort((a, b) => a - b);
  return { avgFps: (1000 / (f.reduce((a, b) => a + b, 0) / f.length)).toFixed(1), p95: s[Math.floor(s.length * 0.95)].toFixed(1),
    over50: ((f.filter((x) => x > 50).length / f.length) * 100).toFixed(2) + "%", level: p.level, warmupMs: p.warmupMs.toFixed(0), warmupSimS: p.warmupSimS.toFixed(1) }; })()
```

Mục tiêu: FPS TB ≥ 50, p95 ≤ 25ms, khung > 50ms ≤ 1%, `warmupMs` < 150. Bật CPU throttling 4× trong DevTools, chờ ~20s, kiểm `level` giảm (cơ chế tự hạ chạy).

**Nếu không đạt mục tiêu ở mức Cao**: (1) gộp các mesh tĩnh của mỗi cửa hàng/môi trường theo vật liệu bằng `mergeGeometries` (`three/addons/utils/BufferGeometryUtils.js`); (2) tắt `castShadow` của đầu nhân vật; (3) hạ segment hình cầu nhân vật (24→16). Đo lại sau mỗi bước, báo số thật cho chủ bot.

- [ ] **Step 3: Kiểm các ca dự phòng + đóng băng (spec 9.24–26)**

1. **Ẩn tab 30s rồi quay lại**: không nhân vật nào nhảy vị trí ở khung đầu (quan sát + GIF ngắn).
2. **Chặn bundle**: dùng request blocking của DevTools chặn `store-scene.js` → khung cảnh hiện "Không hiển thị được cảnh 3D trên trình duyệt này.", tóm tắt + bảng tin vẫn đủ.
3. **Không có WebGL**: chạy Chrome với `--disable-webgl` (hoặc trong console `HTMLCanvasElement.prototype.getContext = () => null` trước khi tải lại bằng snippet DevTools) → cùng thông báo.
4. **TikTok đóng + hôm qua có lượt TikTok**: chạy preview không bật TikTok, mở `?ngay=homqua` sau khi chỉnh `preview-store.ts` ghi vài link TikTok hôm qua → cửa cuốn, bảng "Tạm đóng cửa", nhân vật tới cửa đứng ~1.5s rồi quay đi, không cầm túi đen.

- [ ] **Step 4: Commit**

```bash
git add src/web/storeScene/main.ts
git commit -m "feat(cua-hang): chat luong tu ha theo p95 + so do hieu nang (?perf=1)

Do tren MacBook, Chrome 1440x900, 30 user: <dien so that: FPS TB, p95, khung >50ms, warmup ms>
Bundle: <goc> / <gzip>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Thay 2 dòng `<...>` bằng số đo thật trước khi commit.)

---

### Task 10: Tài liệu + kiểm tra cuối

**Files:**
- Create: `.claude/rules/cua-hang-hom-nay.md`
- Modify: `CLAUDE.md` (bản đồ code + bảng rule)
- Modify: `.claude/rules/admin-ui-nen-tang.md` (ngoại lệ bundle client)

- [ ] **Step 1: Viết rule**

`.claude/rules/cua-hang-hom-nay.md`:

```markdown
# /admin/cua-hang — "Cửa hàng hôm nay" (mô phỏng 3D lượt tạo link)

> Đọc khi sửa `src/core/storeTraffic.ts`, `src/core/storeSceneContract.ts`, `src/api/adminStoreHtml.ts`, route `/admin/cua-hang`, hoặc bất cứ gì trong `src/web/storeScene/`. Spec: `docs/superpowers/specs/2026-10-23-cua-hang-hom-nay-design.md`.

- **1 lần vào cửa hàng = 1 link tạo THÀNH CÔNG**, không phải đơn hàng. Chữ trên trang không được nói "mua"/"đặt"; chú thích dưới cảnh là bắt buộc.
- Chỉ user Zalo; active = ≥ 1 link trong 7 **ngày lịch** giờ VN; tối đa 30 nhân vật (xếp: số link ngày D → link gần nhất → userId).
- **JSON gửi xuống trình duyệt không có `userId` và không có giờ** — có test chặn. Giờ thật chỉ ở bảng tin render server.
- Hàng chờ ĐIỀU KHIỂN theo dữ liệu: `queueTarget = min(10, ceil(U/2), E−1)` (U = user unique toàn bộ, E = nhân vật trong cảnh). Cổng cửa dùng `>=` — đổi thành `>` là kẹt ở mục tiêu 10 (hàng chỉ có 10 ô). Không có khách giả.
- `layout.ts` là nguồn DUY NHẤT của toạ độ cho cả mô phỏng lẫn hiển thị. Test hình học (`__tests__/layout.test.ts`) chốt: không điểm ngoài trời nào bị nhà che, chỗ xem hàng nhìn thấy qua kính, qua đường chỉ ở vạch, hàng chờ không che kính. Đổi góc camera (`VIEW_PITCH_DEG`) phải chạy lại test này.
- TikTok = Shopee đổi x↔z; cửa hàng TikTok dựng cùng hàm với `side=-1` rồi xoay −90° (không lật gương chữ trên biển).
- `CSS2DRenderer` chỉ xét `visible` của chính nhãn, không xét cha — ẩn nhân vật phải ẩn nhãn tay.
- Trang thái mở/đóng TikTok lấy từ cấu hình hiện tại (`MERCHANTS`), không suy từ dữ liệu.
- Bundle `public/store-scene.js` sinh bởi `npm run build:scene` (esbuild), nằm trong `npm run build`. `src/web/` bị loại khỏi `tsconfig.json` chính; typecheck riêng bằng `tsconfig.web.json`.
- Đo hiệu năng: `/admin/cua-hang?perf=1` rồi đọc `window.__storeScenePerf`. Số đo lần đầu: <điền từ commit Task 9>.
- Test DOM/thuần không chứng minh được hình ảnh đẹp hay chuyển động mượt — luôn xem bằng mắt trên preview (`preview-store.ts`, không bật bot thật).
```

Thay `<điền từ commit Task 9>` bằng số đo thật.

- [ ] **Step 2: Cập nhật `CLAUDE.md`**

Trong khối "Bản đồ code", thêm các dòng:

```
  storeTraffic storeSceneContract                       -> cua-hang-hom-nay.md
```
(dưới nhóm `src/core/`), và

```
  adminStoreHtml                                        -> cua-hang-hom-nay.md
```
(dưới nhóm `src/api/`), và một nhóm mới:

```
src/web/storeScene/  bundle 3D trinh duyet (layout sim/ render/) -> cua-hang-hom-nay.md
```

Trong bảng "`.claude/rules/` — đọc file nào khi nào", thêm hàng:

```
| `cua-hang-hom-nay.md` | Sửa trang `/admin/cua-hang`, `storeTraffic.ts`, hoặc bất cứ gì trong `src/web/storeScene/` (mô phỏng 3D, layout, hàng chờ) |
```

- [ ] **Step 3: Cập nhật `.claude/rules/admin-ui-nen-tang.md`**

Thêm cuối mục "Trạng thái dựng lại theo design ref + thành phần dùng chung":

```markdown
**Ngoại lệ thứ hai về JS phía client (2026-10-23): bundle 3D của `/admin/cua-hang`** (`public/store-scene.js`, Three.js đóng gói bằng esbuild, KHÔNG qua CDN). Là đoạn JS client lớn nhất dự án; mọi thứ khác trên trang đó (tóm tắt, bảng tin) vẫn là HTML server không phụ thuộc JS. Style của nhãn/bảng đếm trong cảnh là class viết tay `.scene-*`/`.store-*` trong `admin.css`. Chi tiết: `.claude/rules/cua-hang-hom-nay.md`.
```

- [ ] **Step 4: Kiểm tra cuối**

Run: `npm test 2>&1 | tail -n 15`
Expected: toàn bộ PASS (đếm `# fail 0`).

Run: `npm run typecheck && npm run build`
Expected: sạch; `public/store-scene.js` và `dist/` được sinh.

Run: `git status --short`
Expected: chỉ còn `preview-store.ts` và `preview-withdrawals.ts` chưa theo dõi (KHÔNG commit hai file này).

- [ ] **Step 5: Commit**

```bash
git add .claude/rules/cua-hang-hom-nay.md CLAUDE.md .claude/rules/admin-ui-nen-tang.md
git commit -m "docs(cua-hang): rule trang Cua hang hom nay + ban do CLAUDE.md + ngoai le bundle client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Báo lại cho chủ bot: số đo hiệu năng + kích thước bundle, GIF hoạt ảnh, và nhắc **chưa push** (Railway auto-deploy từ `main` — phải hỏi trước).
