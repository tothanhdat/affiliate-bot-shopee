# Bỏ TikTok Shop và Lazada khỏi scope — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dự án chỉ còn hỗ trợ Shopee — gỡ toàn bộ TikTok Shop, Lazada và đường Accesstrade khỏi code, tin nhắn và tài liệu, trong khi giữ nguyên dữ liệu ledger lịch sử và trả lời tử tế khi user gửi link của 2 sàn đã ngưng.

**Architecture:** Tách khái niệm "sàn đang hỗ trợ" (`MERCHANTS`, điều khiển nhận diện link và provider) khỏi "sàn từng hỗ trợ" (`RETIRED_MERCHANTS`, chỉ để hiển thị đơn cũ và từ chối link tử tế). `MerchantId` giữ nguyên 3 giá trị vì DB ledger đang chứa cả 3. Accesstrade bị gỡ theo thứ tự từ ngoài vào trong (provider → sync → bảng thanh toán → env) để mỗi bước đều xanh test, và registry merchant chỉ đổi sau khi không còn code Accesstrade nào phụ thuộc vào nó.

**Tech Stack:** TypeScript (ESM, NodeNext), Node 22+, `node:sqlite` built-in, `node:test` + `tsx --test`, Express, Telegraf, `zca-js`.

**Spec:** `docs/superpowers/specs/2026-09-29-bo-tiktokshop-lazada-khoi-scope-design.md`

## Global Constraints

- **Ngôn ngữ comment trong code**: tiếng Việt **không dấu** (theo toàn bộ codebase hiện tại). Text hiển thị cho user và file `.md` thì **có dấu**.
- **`MerchantId` giữ nguyên 3 giá trị** `"shopee" | "lazada" | "tiktokshop"`. Tuyệt đối không thu hẹp — `commission_entries.merchant` trong DB thật đang có cả 3, và `CommissionEntry.merchant` được cast thẳng từ row DB (`src/core/ledgerStore.ts:1230`).
- **KHÔNG chạy `DROP TABLE` nào** trên bất kỳ DB nào. Chỉ gỡ câu `CREATE TABLE` khỏi code.
- **KHÔNG sửa** `docs/superpowers/specs/**` và `docs/superpowers/plans/**` (trừ chính file plan này khi tick checkbox) — đó là biên bản quyết định theo ngày.
- **Chạy trọn bộ kiểm tra** ở cuối mỗi task, cả hai lệnh đều phải xanh trước khi commit:
  - `npm test`
  - `npm run typecheck`
- **Commit message** kết thúc bằng dòng: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Nhánh làm việc**: `bo-tiktokshop-lazada` (đã tạo, spec đã commit tại đó).
- **Không tự deploy / không push lên remote.** Người dùng đã yêu cầu luôn hỏi trước khi push vào `main` (Railway auto-deploy).

---

### Task 1: Gỡ AccesstradeProvider và CompositeProvider

Sau task này chỉ còn đúng một đường tạo link: Shopee qua `an_redir`.

**Files:**
- Delete: `src/core/providers/accesstradeProvider.ts`
- Delete: `src/core/providers/compositeProvider.ts`
- Delete: `src/core/__tests__/accesstradeProvider.test.ts`
- Delete: `src/core/__tests__/compositeProvider.test.ts`
- Modify: `src/core/providers/index.ts` (viết lại `createAffiliateProvider`, xoá `buildAccesstradeConfig`)
- Modify: `src/core/providers/mockProvider.ts:9-20` (bỏ dữ liệu mẫu Lazada/TikTok Shop)
- Modify: `src/config/env.ts:25-38` (`AffiliateProviderName`) và `:211-233` (`assertAffiliateProviderConfigured`)
- Modify: `src/index.ts:28` (câu cảnh báo nhắc `AFFILIATE_PROVIDER=accesstrade`)
- Modify: `src/core/affiliateProvider.ts` (doc comment nhắc TikTok Shop)

**Interfaces:**
- Consumes: `ShopeeAffiliateProvider` (`src/core/providers/shopeeAffiliateProvider.ts`) và `MockAffiliateProvider` — cả hai giữ nguyên, không sửa.
- Produces: `createAffiliateProvider(logStore: LogStore): AffiliateProvider` — chữ ký không đổi, chỉ đổi ruột. `AffiliateProviderName = "mock" | "shopee_direct"`.

- [ ] **Step 1: Xoá 4 file provider Accesstrade và test của chúng**

```bash
cd "$(git rev-parse --show-toplevel)"
git rm src/core/providers/accesstradeProvider.ts \
       src/core/providers/compositeProvider.ts \
       src/core/__tests__/accesstradeProvider.test.ts \
       src/core/__tests__/compositeProvider.test.ts
```

- [ ] **Step 2: Viết lại `src/core/providers/index.ts`**

Thay toàn bộ nội dung file bằng:

```ts
import { env, assertAffiliateProviderConfigured } from "../../config/env.js";
import type { AffiliateProvider } from "../affiliateProvider.js";
import type { LogStore } from "../logStore.js";
import { MockAffiliateProvider } from "./mockProvider.js";
import { ShopeeAffiliateProvider } from "./shopeeAffiliateProvider.js";

/**
 * logStore duoc truyen vao (thay vi ShopeeAffiliateProvider tu tao rieng 1 SQLite store) vi
 * short_links (T3.2) dung chung DB voi requests.db - tranh 2 ket noi/2 file rieng cho cung 1
 * du lieu khong phai tai chinh.
 *
 * Tu 2026-09-29 chi con 1 duong tao link that: Shopee qua co che an_redir. Accesstrade da bi
 * go han cung luc voi viec bo TikTok Shop/Lazada khoi scope - khong con merchant nao di qua no.
 */
export function createAffiliateProvider(logStore: LogStore): AffiliateProvider {
  assertAffiliateProviderConfigured();

  if (env.affiliateProvider === "shopee_direct") {
    return new ShopeeAffiliateProvider({
      affiliateId: env.shopeeDirect.affiliateId,
      createShortLink: (targetUrl) => logStore.createShortLink(targetUrl),
      // DASHBOARD_BASE_URL nguoi dung dien co the co dau "/" cuoi - bo di de khong tao URL
      // dang "https://bot.example.com//s/abc123".
      shortLinkBaseUrl: env.dashboard.baseUrl.replace(/\/$/, ""),
    });
  }

  return new MockAffiliateProvider();
}
```

- [ ] **Step 3: Thu hẹp `AffiliateProviderName` trong `src/config/env.ts`**

Thay khối ở dòng 25-38 bằng:

```ts
// "shopee_direct" (them 2026-08-19): Shopee dung ShopeeAffiliateProvider (co che an_redir truc
// tiep, khong can Open API). Tu 2026-09-29 day la nguon affiliate DUY NHAT - lua chon
// "accesstrade" da bi go cung luc voi viec bo TikTok Shop/Lazada khoi scope.
export type AffiliateProviderName = "mock" | "shopee_direct";

function resolveAffiliateProvider(): AffiliateProviderName {
  const raw = optional("AFFILIATE_PROVIDER", "mock").toLowerCase();
  if (raw !== "mock" && raw !== "shopee_direct") {
    throw new Error(
      `AFFILIATE_PROVIDER phai la "mock" hoac "shopee_direct", nhan duoc: "${raw}"`
    );
  }
  return raw;
}
```

- [ ] **Step 4: Bỏ ràng buộc `ACCESSTRADE_API_KEY` khỏi `assertAffiliateProviderConfigured`**

**Đây là bước quan trọng nhất của task.** Hàm hiện tại bắt buộc có `ACCESSTRADE_API_KEY` kể cả khi chạy `shopee_direct` (`src/config/env.ts:216`). Nếu không sửa ở đây, đến Task 4 khi gỡ biến env đó thì bot **chết ngay lúc khởi động** trên production.

Thay thân hàm `assertAffiliateProviderConfigured()` (dòng 211-233) bằng:

```ts
export function assertAffiliateProviderConfigured(): void {
  if (env.affiliateProvider === "mock") return;

  // Tu 2026-09-29 khong con phu thuoc ACCESSTRADE_API_KEY - Shopee di thang qua an_redir,
  // chi can affiliate_id co dinh cua tai khoan.
  if (env.shopeeDirect.affiliateId === "") {
    throw new Error(
      "AFFILIATE_PROVIDER=shopee_direct nhung thieu SHOPEE_AFFILIATE_ID. " +
        "Lay affiliate_id tai affiliate.shopee.vn/account_setting roi dien vao .env."
    );
  }
}
```

- [ ] **Step 5: Dọn dữ liệu mẫu trong `src/core/providers/mockProvider.ts`**

`MOCK_PROMOTIONS` đang là `Record<MerchantId, PromotionItem[]>`. Vì `MerchantId` vẫn giữ 3 giá trị (Global Constraints), bỏ 2 entry mà để nguyên `Record` sẽ **không typecheck**. Đổi sang `Partial<Record<...>>` — chỗ đọc đã có sẵn `?? []` nên không cần sửa gì thêm:

```ts
const MOCK_PROMOTIONS: Partial<Record<MerchantId, PromotionItem[]>> = {
  shopee: [
    { couponCode: "MOCKSHOPEE10", description: "Giam 10% toi da 50,000d cho don tu 200,000d (du lieu gia lap)" },
    { couponCode: "MOCKSHOPEE20", description: "Giam 20% toi da 100,000d cho don tu 500,000d (du lieu gia lap)" },
  ],
};
```

Sửa cả doc comment của class (dòng 22-26): bỏ chữ "Accesstrade", đổi thành `Provider gia lap, dung khi chua co SHOPEE_AFFILIATE_ID that.`

- [ ] **Step 6: Sửa câu cảnh báo trong `src/index.ts:28`**

Đổi chuỗi `"Hoan tat T0.1 va dat ACCESSTRADE_API_KEY + AFFILIATE_PROVIDER=accesstrade de dung that."` thành:

```ts
      "Dat SHOPEE_AFFILIATE_ID + AFFILIATE_PROVIDER=shopee_direct de dung that."
```

- [ ] **Step 7: Sửa doc comment trong `src/core/affiliateProvider.ts`**

Tìm chỗ nhắc TikTok Shop trong doc comment (`grep -n -i tiktok src/core/affiliateProvider.ts`) và viết lại cho đúng: `shopId`/`itemId` giờ chỉ còn là metadata optional của Shopee, không còn trường hợp bắt buộc nào.

- [ ] **Step 8: Chạy kiểm tra**

Run: `npm test && npm run typecheck`
Expected: PASS cả hai. Nếu `npm test` báo lỗi do glob không khớp file đã xoá thì bỏ qua — glob `src/core/__tests__/*.test.ts` tự co lại.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Gỡ AccesstradeProvider và CompositeProvider

Chỉ còn một đường tạo link affiliate: Shopee qua an_redir.
assertAffiliateProviderConfigured không còn đòi ACCESSTRADE_API_KEY —
bước bắt buộc trước khi gỡ biến env đó, nếu không bot sẽ chết lúc khởi động.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Gỡ đồng bộ đơn hàng tự động qua Accesstrade

**Files:**
- Delete: `src/core/accesstradeSync.ts`
- Delete: `src/core/__tests__/accesstradeSync.test.ts`
- Delete: `src/scripts/templates/weekly-conversions.example.csv`
- Modify: `src/index.ts:12` (import), `:180-232` (`runAccesstradeSync`, `msUntilNextHour`), `:241-255` (khối khởi động), `:263` (clear timer lúc shutdown)
- Modify: `src/scripts/ledgerAdmin.ts` — xoá `case "sync-accesstrade"` (dòng ~302) và `case "record-conversions-csv"` (dòng ~191), xoá import `syncAccesstradeTransactions` (dòng 45), sửa doc comment đầu file và chuỗi liệt kê subcommand (dòng ~125)
- Modify: `src/core/orderIngest.ts` (đổi tên hàm, xem Step 4)
- Modify: `src/api/server.ts:26` và `:624`, `:652` (theo tên hàm mới)

**Interfaces:**
- Consumes: `LedgerStore`, `LogStore` — không đổi.
- Produces: `recordSingleOrder(logStore, ledgerStore, config, input)` — **đổi tên từ `recordOrderFromAccesstrade`**, chữ ký giữ nguyên: `(logStore: LogStore, ledgerStore: LedgerStore, config: RecordOrderConfig, input: RecordOrderInput) => CommissionEntry`.

- [ ] **Step 1: Xoá module sync và test**

```bash
cd "$(git rev-parse --show-toplevel)"
git rm src/core/accesstradeSync.ts \
       src/core/__tests__/accesstradeSync.test.ts \
       src/scripts/templates/weekly-conversions.example.csv
```

- [ ] **Step 2: Gỡ scheduler khỏi `src/index.ts`**

Xoá các khối sau, đúng theo số dòng hiện tại (đọc file để xác nhận trước khi cắt):
- dòng 12: `import { syncAccesstradeTransactions } from "./core/accesstradeSync.js";`
- dòng 180-229: comment T2.1, biến `accesstradeSyncTimer`, cả hàm `runAccesstradeSync()`
- dòng 231-239: hàm `msUntilNextHour()` (chỉ dùng bởi scheduler này — xác nhận bằng `grep -n msUntilNextHour src/index.ts` trước khi xoá)
- dòng 241-255: khối `if (env.accesstradeSync.enabled) { ... }`
- dòng 263: `if (accesstradeSyncTimer) clearTimeout(accesstradeSyncTimer);`

Sau khi xoá, kiểm tra các import còn lại ở đầu file có cái nào thành mồ côi không (ví dụ `formatOrdersConfirmedReply` nếu chỉ scheduler dùng): `npm run typecheck` sẽ báo. Nếu `noUnusedLocals` không bật thì tự `grep` lại từng import vừa nghi ngờ.

- [ ] **Step 3: Gỡ 2 subcommand khỏi `src/scripts/ledgerAdmin.ts`**

- Xoá import dòng 45 `syncAccesstradeTransactions`.
- Xoá trọn `case "record-conversions-csv": { ... }` (bắt đầu dòng ~191) và `case "sync-accesstrade": { ... }` (bắt đầu dòng ~302, chạy tới hết case).
- Kiểm tra import `parseCsv` (dòng 41) và `recordOrdersFromCsv` (dòng 49): sau khi xoá 2 case này, `grep -n 'parseCsv\|recordOrdersFromCsv' src/scripts/ledgerAdmin.ts` — nếu không còn chỗ dùng thì xoá import.
  **Cảnh báo**: `parseCsv` đến từ `src/core/csv.ts`, file đó **vẫn được `shopeeReportImport.ts` dùng** — chỉ xoá *import* trong `ledgerAdmin.ts`, **không xoá file `src/core/csv.ts`**.
- Sửa chuỗi liệt kê subcommand ở dòng ~125 thành:

```ts
      "Thieu subcommand. Cac subcommand ho tro: record-conversion, record-shopee-report, mark-withdrawal-paid, reverse-entry, list-pending-withdrawals"
```

  (2 lệnh `record-accesstrade-payment` và `reconciliation-summary` sẽ bị gỡ ở Task 3 — chuỗi này đã bỏ sẵn cả hai, đúng như trạng thái cuối cùng.)
- Sửa doc comment đầu file (dòng 1-40): bỏ mọi nhắc tới TikTok Shop/Lazada/Accesstrade, nêu rõ Shopee là merchant duy nhất và `record-shopee-report` là công cụ đối soát chính.

- [ ] **Step 4: Đổi tên `recordOrderFromAccesstrade` → `recordSingleOrder`**

Tên cũ gây hiểu nhầm là code Accesstrade, trong khi form web "Ghi 1 đơn lẻ" vẫn dùng. Đổi tên tại `src/core/orderIngest.ts:36`, sửa doc comment dòng 6-10 (bỏ chữ "tu Accesstrade"), rồi sửa mọi call site:

```bash
grep -rn 'recordOrderFromAccesstrade' src/ --include='*.ts'
```

Call site đã biết: `src/core/orderIngest.ts:122` (trong `recordOrdersFromCsv`), `src/api/server.ts:26` (import), `src/api/server.ts:624`, `src/api/server.ts:652` (comment), `src/scripts/ledgerAdmin.ts:167`.

- [ ] **Step 5: Quyết định số phận `recordOrdersFromCsv`**

```bash
grep -rn 'recordOrdersFromCsv' src/ --include='*.ts'
```

- Nếu **không còn call site nào** ngoài chính định nghĩa: xoá hàm `recordOrdersFromCsv` khỏi `src/core/orderIngest.ts` (dòng 79-148).
- Nếu **vẫn còn call site**: giữ nguyên hàm, chỉ sửa doc comment dòng 81 bỏ chữ "record-conversions-csv CLI".
- Dù đi nhánh nào, **giữ lại** `summarizeOrderResultsByUser()` và `OrderRowResult` — route web `/admin/record-orders/*` đang dùng.

- [ ] **Step 6: Chạy kiểm tra**

Run: `npm test && npm run typecheck`
Expected: PASS cả hai.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Gỡ đồng bộ đơn hàng tự động qua Accesstrade

Xoá accesstradeSync.ts, scheduler trong index.ts và 2 subcommand CLI
sync-accesstrade/record-conversions-csv. Đổi tên recordOrderFromAccesstrade
thành recordSingleOrder — hàm này phục vụ form web "Ghi 1 đơn lẻ" của Shopee,
tên cũ dễ khiến người sau xoá nhầm.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Gỡ bảng đối chiếu `accesstrade_payments`

Chủ bot chưa bao giờ nhận tiền từ Accesstrade (xác nhận 2026-09-29), nên đây là code chết chứ không phải sổ tiền có giá trị.

**Files:**
- Modify: `src/core/ledgerStore.ts:172` (`CREATE TABLE accesstrade_payments`), `:1042-1080` (3 method), `:1276` (`rowToAccesstradePayment`), `:21` và `:29` (import type)
- Modify: `src/core/types.ts` (xoá `AccesstradePayment`, `ReconciliationSummary`)
- Modify: `src/api/server.ts:6` (import), `:473-520` (2 route)
- Modify: `src/api/adminHtml.ts:5`, `:10` (import type), `:36` (mục sidebar), `:412-470` (`renderAccesstradePaymentsPage`)
- Modify: `src/scripts/ledgerAdmin.ts` (xoá `case "record-accesstrade-payment"` và `case "reconciliation-summary"`, dòng ~283-300)
- Modify: `src/core/__tests__/ledgerStore.test.ts`, `src/api/__tests__/adminRoutes.test.ts` (xoá test liên quan nếu có)

**Interfaces:**
- Consumes: không có gì mới.
- Produces: `LedgerStore` không còn `recordAccesstradePayment()`, `listAccesstradePayments()`, `getReconciliationSummary()`. `adminHtml` không còn export `renderAccesstradePaymentsPage`.

- [ ] **Step 1: Gỡ khỏi `src/core/ledgerStore.ts`**

- Xoá câu `CREATE TABLE IF NOT EXISTS accesstrade_payments (...)` khỏi schema (quanh dòng 172).
  **KHÔNG thêm `DROP TABLE`.** Bảng còn sót trong DB cũ là vô hại; `DROP` là thao tác phá huỷ trên DB tiền.
- Xoá 3 method: `recordAccesstradePayment` (dòng ~1046), `listAccesstradePayments` (~1061), `getReconciliationSummary` (~1071), cùng doc comment của chúng.
- Xoá hàm `rowToAccesstradePayment` (~1276).
- Xoá 2 import type `AccesstradePayment` (dòng 21) và `ReconciliationSummary` (dòng 29).

- [ ] **Step 2: Gỡ 2 type khỏi `src/core/types.ts`**

```bash
grep -n -A10 'AccesstradePayment\|ReconciliationSummary' src/core/types.ts
```

Xoá 2 interface đó. Nếu `grep -rn 'AccesstradePayment\|ReconciliationSummary' src/ --include='*.ts'` còn kết quả nào ngoài các file trong task này thì xử lý nốt trước khi đi tiếp.

- [ ] **Step 3: Gỡ route và trang admin**

- `src/api/server.ts`: xoá import `renderAccesstradePaymentsPage` (dòng 6) và trọn 2 route `app.get("/admin/accesstrade-payments", ...)` + `app.post("/admin/accesstrade-payments", ...)` cùng comment T4 phía trên (dòng 473-520).
- `src/api/adminHtml.ts`: xoá 2 import type (dòng 5, 10), xoá mục sidebar dòng 36 `{ key: "accesstrade-payments", ... }`, xoá trọn hàm `renderAccesstradePaymentsPage` (dòng 412 tới hết hàm).
- Kiểm tra CSS chỉ dùng bởi trang này (ví dụ class `.payment-form`): `grep -n 'payment-form' src/api/adminHtml.ts` — nếu không còn chỗ dùng thì xoá luôn khối style đó.

- [ ] **Step 4: Gỡ 2 subcommand CLI**

Trong `src/scripts/ledgerAdmin.ts` xoá `case "record-accesstrade-payment": { ... }` và `case "reconciliation-summary": { ... }` (dòng ~283-300), cùng 2 dòng mô tả tương ứng trong doc comment đầu file (dòng 29-30). Chuỗi liệt kê subcommand đã được cập nhật ở Task 2 nên không cần sửa lại.

- [ ] **Step 5: Dọn test liên quan**

```bash
grep -rn -i 'accesstrade\|reconcil' src/core/__tests__/ledgerStore.test.ts src/api/__tests__/adminRoutes.test.ts
```

Xoá các `test(...)` nào kiểm tra `recordAccesstradePayment` / `getReconciliationSummary` / route `/admin/accesstrade-payments`. Nếu có test kiểm tra danh sách mục sidebar, cập nhật con số/nhãn cho khớp.

- [ ] **Step 6: Chạy kiểm tra**

Run: `npm test && npm run typecheck`
Expected: PASS cả hai.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Gỡ bảng đối chiếu accesstrade_payments và trang admin của nó

Chủ bot chưa từng nhận tiền từ Accesstrade nên đây là code chết.
Chỉ gỡ CREATE TABLE khỏi code, không DROP TABLE trên DB.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Dọn biến môi trường Accesstrade

**Files:**
- Modify: `src/config/env.ts:40-66` (`DEFAULT_PROMOTIONS_MERCHANT`, `resolveAccesstradeMerchants`), `:72-80` (`env.accesstrade`), `:82-110` (`env.accesstradeSync`), và import `MERCHANTS` ở đầu file nếu thành mồ côi
- Modify: `.env.example`
- Modify: `.env` (file local, đã gitignore — chỉ xoá dòng, không commit)

**Interfaces:**
- Consumes: không có gì mới.
- Produces: `env` không còn 2 nhánh `accesstrade` và `accesstradeSync`.

- [ ] **Step 1: Xác nhận không còn ai đọc `env.accesstrade`**

```bash
grep -rn 'env\.accesstrade' src/ --include='*.ts'
```

Expected: **không có kết quả**. Nếu còn, nghĩa là Task 1-3 sót chỗ nào đó — quay lại xử lý trước, đừng gỡ env.

- [ ] **Step 2: Gỡ khỏi `src/config/env.ts`**

- Xoá `DEFAULT_PROMOTIONS_MERCHANT` (dòng 40-51) và `resolveAccesstradeMerchants()` (dòng 53-66).
- Xoá nhánh `accesstrade: { ... }` (dòng 72-80) và nhánh `accesstradeSync: { ... }` cùng doc comment dài phía trên (dòng 82-110).
- Kiểm tra import `MERCHANTS` / `MerchantId` ở đầu file: `grep -n 'MERCHANTS\|MerchantId' src/config/env.ts` — nếu không còn chỗ dùng thì xoá import.

- [ ] **Step 3: Dọn `.env.example`**

Xoá các dòng và khối comment của: `ACCESSTRADE_API_KEY`, `ACCESSTRADE_API_BASE`, `ACCESSTRADE_ENDPOINT_PATH`, `ACCESSTRADE_TIMEOUT_MS`, `ACCESSTRADE_PROMOTIONS_CACHE_TTL_MS`, `ACCESSTRADE_CAMPAIGN_ID_*`, `ACCESSTRADE_PROMOTIONS_MERCHANT_*`, `ACCESSTRADE_SYNC_*`.

Sửa khối mô tả `AFFILIATE_PROVIDER` thành đúng 2 lựa chọn còn lại:

```
# "mock"          -> khong goi API that, sinh short link gia de dev/test khi chua co credentials
# "shopee_direct" -> Shopee di thang qua co che an_redir (SHOPEE_AFFILIATE_ID ben duoi, khong can
#                    Open API). Day la nguon affiliate DUY NHAT tu 2026-09-29.
AFFILIATE_PROVIDER=mock
```

- [ ] **Step 4: Dọn `.env` local**

Xoá đúng những dòng `ACCESSTRADE_*` như trên. File này đã gitignore nên không xuất hiện trong commit — kiểm tra lại bằng `git status --short` để chắc chắn.

- [ ] **Step 5: Chạy kiểm tra**

Run: `npm test && npm run typecheck`
Expected: PASS cả hai.

Thêm một kiểm tra khởi động thật, vì đây là task dễ gây crash lúc boot:

Run: `AFFILIATE_PROVIDER=mock npx tsx -e "import('./src/config/env.ts').then(m => console.log('env OK', m.env.affiliateProvider))"`
Expected: in ra `env OK mock`, không throw.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Dọn biến môi trường Accesstrade khỏi env.ts và .env.example

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Registry merchant — tách "đang hỗ trợ" khỏi "từng hỗ trợ"

Task trung tâm. Sau task này link TikTok/Lazada bị từ chối tử tế, đơn cũ vẫn hiển thị đúng tên sàn.

**Files:**
- Modify: `src/core/merchants.ts` (viết lại)
- Modify: `src/core/errors.ts:1-20` (thêm `ErrorCode`), thêm class `RetiredMerchantLinkError`
- Modify: `src/core/linkValidator.ts:1-2` (import), `:8-18` (`extractProductUrls`), `:54-91` (`extractIds`), `:109-123` (`buildParsedLink`), `:128-139` (`parseProductLink`)
- Create: `src/core/__tests__/merchants.test.ts`
- Modify: `src/core/__tests__/linkValidator.test.ts` (dòng 49, 66, 73, 82)

**Interfaces:**
- Produces:
  - `MERCHANTS: readonly MerchantConfig[]` — chỉ còn Shopee.
  - `RETIRED_MERCHANTS: readonly MerchantConfig[]` — Lazada, TikTok Shop.
  - `detectMerchantByHost(hostname: string): MerchantConfig | null` — chỉ tra `MERCHANTS`.
  - `detectRetiredMerchantByHost(hostname: string): MerchantConfig | null` — chỉ tra `RETIRED_MERCHANTS`.
  - `getMerchantConfig(id: MerchantId): MerchantConfig` — tra **cả hai**.
  - `RetiredMerchantLinkError` (code `"RETIRED_MERCHANT_LINK"`).

- [ ] **Step 1: Viết test trước — tạo `src/core/__tests__/merchants.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MERCHANTS,
  RETIRED_MERCHANTS,
  detectMerchantByHost,
  detectRetiredMerchantByHost,
  getMerchantConfig,
} from "../merchants.js";

test("MERCHANTS: chi con Shopee", () => {
  assert.deepEqual(
    MERCHANTS.map((m) => m.id),
    ["shopee"]
  );
});

test("detectMerchantByHost: nhan Shopee, KHONG nhan san da ngung", () => {
  assert.equal(detectMerchantByHost("shopee.vn")?.id, "shopee");
  assert.equal(detectMerchantByHost("s.shopee.vn")?.id, "shopee");
  assert.equal(detectMerchantByHost("www.tiktok.com"), null);
  assert.equal(detectMerchantByHost("lazada.vn"), null);
});

test("detectRetiredMerchantByHost: nhan ca domain chinh lan short link cua san da ngung", () => {
  assert.equal(detectRetiredMerchantByHost("www.tiktok.com")?.id, "tiktokshop");
  assert.equal(detectRetiredMerchantByHost("vt.tiktok.com")?.id, "tiktokshop");
  assert.equal(detectRetiredMerchantByHost("shop.tiktok.com")?.id, "tiktokshop");
  assert.equal(detectRetiredMerchantByHost("lazada.vn")?.id, "lazada");
  assert.equal(detectRetiredMerchantByHost("shopee.vn"), null);
});

// Chan hoi quy: ledger that dang co entry merchant='tiktokshop'/'lazada'. Neu getMerchantConfig
// chi tra MERCHANTS thi no se throw luc render don cu -> CRASH trang /admin/orders.
test("getMerchantConfig: van tra duoc ten hien thi cua san da ngung", () => {
  assert.equal(getMerchantConfig("shopee").displayName, "Shopee");
  assert.equal(getMerchantConfig("tiktokshop").displayName, "TikTok Shop");
  assert.equal(getMerchantConfig("lazada").displayName, "Lazada");
});

test("RETIRED_MERCHANTS: dung 2 san da ngung", () => {
  assert.deepEqual(
    [...RETIRED_MERCHANTS].map((m) => m.id).sort(),
    ["lazada", "tiktokshop"]
  );
});
```

- [ ] **Step 2: Chạy test để xác nhận nó fail**

Run: `npx tsx --test src/core/__tests__/merchants.test.ts`
Expected: FAIL — `RETIRED_MERCHANTS`/`detectRetiredMerchantByHost` chưa tồn tại (lỗi import hoặc `undefined`).

- [ ] **Step 3: Viết lại `src/core/merchants.ts`**

Thay toàn bộ nội dung file bằng:

```ts
export type MerchantId = "shopee" | "lazada" | "tiktokshop";

export interface MerchantConfig {
  id: MerchantId;
  displayName: string;
  hostPattern: RegExp;
  /** Domain rut gon can theo redirect de lay URL that (vi du s.shopee.vn). */
  shortHosts: Set<string>;
}

/** San DANG duoc ho tro - THEM MERCHANT MOI TAI DAY. */
export const MERCHANTS: readonly MerchantConfig[] = [
  {
    id: "shopee",
    displayName: "Shopee",
    hostPattern: /(^|\.)shopee\.(vn|com|co\.id|com\.my|com\.ph|co\.th|sg)$/i,
    shortHosts: new Set(["s.shopee.vn", "shp.ee", "vn.shp.ee"]),
  },
];

/**
 * San TUNG duoc ho tro, da ngung tu 2026-09-29 (Accesstrade/TikTok cap nhat trang thai don
 * qua cham). KHONG tao link duoc nua. Danh sach nay ton tai vi HAI ly do, ca hai deu bat buoc:
 *
 *  1. Ledger that con entry merchant='tiktokshop'/'lazada' - getMerchantConfig() phai tra duoc
 *     displayName cho chung, neu khong trang /admin/orders se CRASH khi render don cu.
 *  2. Link cua 2 san nay phai bi tu choi TU TE (RetiredMerchantLinkError trong linkValidator.ts)
 *     thay vi bi bo qua am tham. extractProductUrls() loc URL theo registry, nen neu chi xoa
 *     merchant di thi link TikTok se khong duoc nhat ra khoi tin nhan -> bot IM LANG trong
 *     Zalo DM, user tuong bot hong.
 */
export const RETIRED_MERCHANTS: readonly MerchantConfig[] = [
  {
    id: "lazada",
    displayName: "Lazada",
    hostPattern: /(^|\.)lazada\.(vn|com|co\.id|com\.my|com\.ph|co\.th|sg)$/i,
    shortHosts: new Set(),
  },
  {
    id: "tiktokshop",
    displayName: "TikTok Shop",
    hostPattern: /(^|\.)tiktok\.com$/i,
    shortHosts: new Set(["vt.tiktok.com"]),
  },
];

function matchesHost(merchant: MerchantConfig, host: string): boolean {
  return merchant.hostPattern.test(host) || merchant.shortHosts.has(host);
}

/** Merchant DANG ho tro - quyet dinh co xu ly link hay khong. */
export function detectMerchantByHost(hostname: string): MerchantConfig | null {
  const host = hostname.toLowerCase();
  return MERCHANTS.find((m) => matchesHost(m, host)) ?? null;
}

/** Merchant DA NGUNG - chi de tra loi user cho tu te, khong bao gio tao link. */
export function detectRetiredMerchantByHost(hostname: string): MerchantConfig | null {
  const host = hostname.toLowerCase();
  return RETIRED_MERCHANTS.find((m) => matchesHost(m, host)) ?? null;
}

/** Tra CA hai danh sach - don cu trong ledger van phai hien dung ten san. */
export function getMerchantConfig(id: MerchantId): MerchantConfig {
  const merchant = [...MERCHANTS, ...RETIRED_MERCHANTS].find((m) => m.id === id);
  if (!merchant) {
    throw new Error(`Unknown merchant id: ${id}`);
  }
  return merchant;
}
```

- [ ] **Step 4: Chạy lại test merchants để xác nhận nó pass**

Run: `npx tsx --test src/core/__tests__/merchants.test.ts`
Expected: PASS toàn bộ 5 test.

- [ ] **Step 5: Thêm `RetiredMerchantLinkError` vào `src/core/errors.ts`**

Thêm `| "RETIRED_MERCHANT_LINK"` vào union `ErrorCode` (sau `"UNSUPPORTED_MERCHANT_LINK"`, dòng 3), rồi thêm class ngay dưới `UnsupportedMerchantLinkError` (sau dòng 49):

```ts
/**
 * Link cua san TUNG duoc ho tro nhung da ngung (TikTok Shop, Lazada - 2026-09-29).
 * KHONG dung lai UnsupportedMerchantLinkError: message cua no hua "de em bao admin cap nhat
 * them", ma 2 san nay se khong bao gio duoc them lai - hua sai con te hon khong noi gi.
 */
export class RetiredMerchantLinkError extends AppError {
  constructor() {
    super(
      "RETIRED_MERCHANT_LINK",
      "Hiện em chỉ hỗ trợ Shopee thôi ạ 🛒 Bạn gửi link Shopee giúp em nha!"
    );
  }
}
```

- [ ] **Step 6: Cập nhật test `linkValidator.test.ts` cho hành vi mới (test trước, code sau)**

Sửa 4 test hiện có:

- Dòng 49 (`parseProductLink: nhan dien merchant Lazada...`) → thay bằng:

```ts
test("parseProductLink: nem RetiredMerchantLinkError voi link Lazada (san da ngung)", async () => {
  await assert.rejects(
    () => parseProductLink("https://www.lazada.vn/products/abc-i123456789.html"),
    RetiredMerchantLinkError
  );
});
```

- Dòng 66 và 73 (2 test tách `product_id` của TikTok Shop) → gộp thành một test duy nhất:

```ts
test("parseProductLink: nem RetiredMerchantLinkError voi moi link TikTok Shop (san da ngung)", async () => {
  await assert.rejects(
    () => parseProductLink("https://www.tiktok.com/view/product/1729387456123456789"),
    RetiredMerchantLinkError
  );
  await assert.rejects(
    () => parseProductLink("https://shop.tiktok.com/vn/pdp/1729387456123456789"),
    RetiredMerchantLinkError
  );
});
```

- Dòng 82 (`nem NotAProductLinkError voi link tiktok.com khong phai san pham`) → đổi thành:

```ts
test("parseProductLink: link video TikTok thuong cung bao la san da ngung, khong doi ra loi khac", async () => {
  await assert.rejects(
    () => parseProductLink("https://www.tiktok.com/@someone/video/7123456789012345678"),
    RetiredMerchantLinkError
  );
});
```

Thêm 2 test mới (đây là test chặn đúng cái bug "bot im lặng"):

```ts
// Neu extractProductUrls KHONG nhat link cua san da ngung ra khoi tin nhan thi adapter se coi
// nhu tin nhan khong co link -> Zalo DM im lang tuyet doi -> user tuong bot hong.
test("extractProductUrls: VAN nhat link cua san da ngung de con tra loi duoc", () => {
  assert.deepEqual(extractProductUrls("mua cai nay https://vt.tiktok.com/ZSABC123/ nhe"), [
    "https://vt.tiktok.com/ZSABC123/",
  ]);
  assert.deepEqual(extractProductUrls("https://www.lazada.vn/products/x-i1.html"), [
    "https://www.lazada.vn/products/x-i1.html",
  ]);
});

test("parseProductLink: short link cua san da ngung bi tu choi NGAY, khong goi mang", async () => {
  await assert.rejects(() => parseProductLink("https://vt.tiktok.com/ZSABC123/"), RetiredMerchantLinkError);
});
```

Nhớ thêm `RetiredMerchantLinkError` vào dòng import ở đầu file test.

- [ ] **Step 7: Chạy test để xác nhận fail**

Run: `npx tsx --test src/core/__tests__/linkValidator.test.ts`
Expected: FAIL — `RetiredMerchantLinkError` chưa được ném ra từ `parseProductLink`.

- [ ] **Step 8: Sửa `src/core/linkValidator.ts`**

1. Dòng 1-2, đổi import:

```ts
import { InvalidLinkError, NotAProductLinkError, RetiredMerchantLinkError, UnsupportedMerchantLinkError } from "./errors.js";
import { detectMerchantByHost, detectRetiredMerchantByHost, type MerchantConfig } from "./merchants.js";
```

2. `extractProductUrls` (dòng 8-18) — nhặt cả host đã ngưng:

```ts
/**
 * Tim tat ca URL bot can PHAN HOI trong 1 doan text: ca merchant dang ho tro lan san da ngung.
 * San da ngung van phai duoc nhat ra, neu khong adapter se coi nhu tin nhan khong co link va
 * IM LANG (xem RETIRED_MERCHANTS trong merchants.ts).
 */
export function extractProductUrls(text: string): string[] {
  const matches = text.match(URL_IN_TEXT_PATTERN) ?? [];
  return matches.filter((raw) => {
    try {
      const host = new URL(raw).hostname;
      return detectMerchantByHost(host) !== null || detectRetiredMerchantByHost(host) !== null;
    } catch {
      return false;
    }
  });
}
```

3. `parseProductLink` — chèn ngay sau khối `try { url = new URL(rawUrl); } catch { ... }` (sau dòng 134), **trước** `detectMerchantByHost`:

```ts
  // Chan truoc khi resolve redirect: short link cua san da ngung (vd vt.tiktok.com) khong can
  // goi mang lam gi, ket qua da biet truoc.
  if (detectRetiredMerchantByHost(url.hostname)) {
    throw new RetiredMerchantLinkError();
  }
```

4. `extractIds` (dòng 54-91): xoá trọn nhánh `if (merchant.id === "tiktokshop") { ... }` (dòng 77-91) và sửa doc comment dòng 54-61 thành:

```ts
/**
 * Tach shop_id/item_id tu URL - hien chi xac minh pattern cho Shopee. Khong tach duoc id KHONG
 * phai loi: metadata nay la optional (xem ResolveLinkResult), khong doan mo regex cho merchant
 * chua co pattern duoc kiem chung.
 */
```

5. `buildParsedLink` (dòng 109-123): xoá 3 dòng kiểm tra `tiktokshop` (dòng 119-121) và sửa doc comment dòng 109-113 cho khớp (chỉ còn trường hợp Shopee Video).

- [ ] **Step 9: Chạy kiểm tra toàn bộ**

Run: `npm test && npm run typecheck`
Expected: PASS cả hai. Nếu có test ở file khác gãy vì dùng merchant `lazada`/`tiktokshop` làm dữ liệu mẫu (ví dụ `src/core/__tests__/logStore.test.ts:45`), **giữ nguyên dữ liệu mẫu đó** — logStore lưu merchant lịch sử là hợp lệ; chỉ sửa nếu test đó gọi `detectMerchantByHost`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Tách RETIRED_MERCHANTS và từ chối link TikTok Shop/Lazada tử tế

MERCHANTS chỉ còn Shopee. RETIRED_MERCHANTS giữ lại TikTok Shop/Lazada cho
hai việc bắt buộc: hiển thị đúng tên sàn cho đơn cũ trong ledger, và để
extractProductUrls vẫn nhặt được link — không có nó thì bot im lặng khi
user gửi link TikTok, tưởng bot hỏng.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Dọn mọi nội dung hướng tới người dùng

**Files:**
- Modify: `src/adapters/shared/replyText.ts:5-7` (`USAGE_TEXT`)
- Modify: `src/core/faq/faqTopics.ts:128-148` (chủ đề `san_ho_tro`, xoá chủ đề `lich_cap_nhat_trang_thai`)
- Modify: `src/core/faq/__tests__/faqTopics.test.ts:6` (số chủ đề 9 → 8)
- Modify: `src/api/handbookHtml.ts` (dòng 120, 124, 146, 154, 168, 176, 185, 187, 599, 623, 635)
- Modify: `src/api/__tests__/handbookHtml.test.ts` (dòng 74-77, 92, 96), `src/adapters/shared/__tests__/replyText.test.ts`, `src/adapters/zalo/__tests__/zaloBot.test.ts:384-447`

**Interfaces:**
- Produces: `FAQ_TOPICS` còn **8** chủ đề, không còn id `lich_cap_nhat_trang_thai`.

- [ ] **Step 1: Sửa `USAGE_TEXT` trong `src/adapters/shared/replyText.ts`**

```ts
export const USAGE_TEXT =
  "👋 Gửi cho mình link sản phẩm Shopee (ví dụ: https://vn.shp.ee/xxxxxxx), " +
  "mình sẽ trả về link áp mã cho bạn.";
```

- [ ] **Step 2: Sửa FAQ trong `src/core/faq/faqTopics.ts`**

Chủ đề `san_ho_tro` (dòng 128-137) — thay `description` và `defaultAnswer`:

```ts
  {
    id: "san_ho_tro",
    label: "Sàn được hỗ trợ",
    description:
      "User hoi san nao duoc ho tro, co TikTok Shop/Lazada/Tiki/Dien May Xanh khong, mua o dau thi duoc tinh tien",
    defaultAnswer:
      `Hiện em chỉ hỗ trợ **Shopee** thôi ạ 🛒\n\n` +
      `Các sàn khác em chưa hỗ trợ, bạn gửi link vào em sẽ báo lại ngay nha.\n\n` +
      `Có thêm sàn mới em sẽ báo trong group liền!`,
  },
```

Xoá trọn chủ đề `lich_cap_nhat_trang_thai` (dòng 138-148). Lý do: nội dung của nó chỉ là lịch cập nhật TikTok Shop so với Shopee — không còn nghĩa khi chỉ còn một sàn.

Setting `faq_answer_lich_cap_nhat_trang_thai` còn lại trong bảng `settings` là bản ghi mồ côi, vô hại, **không cần migration**.

- [ ] **Step 3: Sửa test đếm chủ đề**

Trong `src/core/faq/__tests__/faqTopics.test.ts` dòng 5-6:

```ts
test("FAQ_TOPICS: du 8 chu de, id khong trung", () => {
  assert.equal(FAQ_TOPICS.length, 8);
```

- [ ] **Step 4: Sửa Sổ tay hoàn tiền `src/api/handbookHtml.ts`**

Sửa từng chỗ, giữ nguyên cấu trúc HTML và quy tắc `searchAttr`/`data-search` (xem doc trong `CLAUDE.md`):

- dòng 120: `searchAttr("Bước 1 Sao chép link sản phẩm Shopee chia sẻ")`
- dòng 124: `<p>Mở app Shopee, tìm sản phẩm bạn muốn mua, bấm "Chia sẻ" và sao chép link sản phẩm.</p>`
- dòng 146: bỏ cụm `TikTok thứ Ba` khỏi chuỗi `searchAttr`
- dòng 154: rút gọn còn `Shopee cập nhật <strong>mỗi ngày</strong>`, bỏ mệnh đề về TikTok Shop
- dòng 168: `body: \`<p>Shopee.</p>\``
- dòng 176: xoá trọn `<li>` về TikTok Shop
- dòng 185: xoá dòng `${kvRow("TikTok Shop", "Mỗi thứ Ba hằng tuần")}`
- dòng 187: xoá trọn `<p>` giải thích lịch thứ Ba
- dòng 599: comment CSS nhắc `"Shopee · TikTok Shop"` — sửa lại cho khớp nội dung mới, và kiểm tra lại quy tắc layout mà comment đó mô tả có còn đúng không khi chip ngắn đi
- dòng 623: `...khi mua hàng qua Shopee.`
- dòng 635: `<div class="chip-value">Shopee</div>`

- [ ] **Step 5: Cập nhật test của Sổ tay**

Trong `src/api/__tests__/handbookHtml.test.ts`:
- dòng 74-77: mở rộng test `khong nhac den Lazada` thành chặn cả TikTok:

```ts
test("handbook: khong nhac den san da ngung (Lazada, TikTok Shop)", () => {
  const html = renderHandbookPage(/* giu nguyen tham so dang co trong test hien tai */);
  assert.ok(!/lazada/i.test(html), "Lazada da duoc go khoi So tay (quyet dinh 2026-09-28)");
  assert.ok(!/tiktok/i.test(html), "TikTok Shop da duoc go khoi So tay (quyet dinh 2026-09-29)");
});
```

  (Đọc test hiện tại để copy đúng tham số truyền vào `renderHandbookPage` — không đoán.)
- dòng 92: test `phai con lich cap nhat TikTok Shop` (`assert.match(html, /thứ Ba/i)`) → **xoá test này**.
- dòng 96: `assert.match(html, /TikTok Shop/)` → đổi thành `assert.match(html, /Shopee/)`, hoặc xoá nếu test đó chỉ tồn tại để kiểm tra chip 2 sàn.

- [ ] **Step 6: Cập nhật dữ liệu mẫu trong test Zalo**

`src/adapters/zalo/__tests__/zaloBot.test.ts` dòng 384, 389, 441, 447 dùng chuỗi `"Shopee và TikTok Shop nha"` làm **câu trả lời FAQ giả lập**. Đây chỉ là dữ liệu mẫu, không phải khẳng định về scope — đổi thành `"Shopee nha"` ở cả 4 chỗ cho khỏi gây hiểu nhầm cho người đọc sau.

- [ ] **Step 7: Xác minh không còn dấu vết trong code**

Run:
```bash
grep -rn -i 'tiktok\|lazada' src/ --include='*.ts' | grep -v 'RETIRED_MERCHANTS\|retired\|merchants.ts\|merchants.test.ts\|linkValidator'
```
Expected: chỉ còn các kết quả hợp lệ — dữ liệu mẫu merchant lịch sử trong `logStore.test.ts` / `shopeeReportImport.test.ts` / `ledgerStore.test.ts`, và danh sách kênh trong `subId.test.ts`. Không còn chỗ nào **hứa với user** là có hỗ trợ 2 sàn đó.

- [ ] **Step 8: Chạy kiểm tra**

Run: `npm test && npm run typecheck`
Expected: PASS cả hai.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Dọn TikTok Shop khỏi mọi nội dung hướng tới người dùng

USAGE_TEXT, 2 chủ đề FAQ (xoá hẳn chủ đề lịch cập nhật vì chỉ còn một sàn),
và Sổ tay hoàn tiền.

Lưu ý vận hành: instance đã từng bấm Lưu ở /admin/settings thì giá trị trong
DB đè lên default trong code — phải sửa tay sau khi deploy.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Cập nhật tài liệu và skill

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `SRS.md`, `danh-sach-tinh-nang.md`, `huong-dan-nguoi-dung.md`, `huong-dan-van-hanh-admin.md`, `huong-dan-van-hanh-cho-doi-tac.md`, `huong-dan-deploy-instance-moi.md`, `rui-ro-can-giai-quyet.md`, `product-backlog.md`
- Modify: `.claude/skills/tich-hop-affiliate-provider/SKILL.md`
- Delete: `.claude/skills/doi-soat-hoa-hong/` (cả thư mục)
- Delete: `CLAUDE.md.bak-doctor`

- [ ] **Step 1: Xoá skill đối soát và file rác**

```bash
cd "$(git rev-parse --show-toplevel)"
git rm -r .claude/skills/doi-soat-hoa-hong
rm -f CLAUDE.md.bak-doctor
```

Skill `doi-soat-hoa-hong` mô tả cơ chế `accesstradeSync.ts` — module đã bị xoá ở Task 2. Quy tắc trạng thái của báo cáo Shopee đã nằm sẵn trong `CLAUDE.md` và `src/core/shopeeReportImport.ts`, không mất thông tin nào.

- [ ] **Step 2: Cập nhật `CLAUDE.md`**

Đây là file dài nhất và quan trọng nhất (nguồn duy nhất cho kiến trúc). Sửa:
- Đoạn mở đầu "Project": bỏ Lazada khỏi câu mô tả, nêu rõ chỉ còn Shopee kèm ngày quyết định 2026-09-29 và lý do (Accesstrade/TikTok cập nhật đơn quá chậm).
- Mục "Architecture": xoá các dòng mô tả `accesstradeProvider.ts`, `compositeProvider.ts`, `accesstradeSync.ts`; cập nhật dòng `merchants.ts` để nói về `MERCHANTS` + `RETIRED_MERCHANTS`; cập nhật `linkValidator.ts` (bỏ TikTok Shop `product_id` bắt buộc, thêm `RetiredMerchantLinkError`); cập nhật `ledgerStore.ts` (bỏ `accesstrade_payments`); cập nhật `ledgerAdmin.ts` (bỏ 4 subcommand); cập nhật `providers/index.ts`.
- Mục "Nguyên tắc khi sửa code": phần "Thêm merchant mới" — bỏ ví dụ TikTok Shop, thay bằng lưu ý rằng hiện chỉ còn một provider.
- **Thêm một dòng cảnh báo mới** vào mục nguyên tắc, cùng kiểu với cảnh báo về `{{handbookUrl}}` đã có sẵn: default template/FAQ đổi trong code **không** lan tới instance đã bấm Lưu ở `/admin/settings`.
- Mục "Chi tiết đã tách ra khỏi file này": xoá dòng trỏ tới skill `doi-soat-hoa-hong`.

- [ ] **Step 3: Cập nhật 9 file tài liệu còn lại**

Với mỗi file, chạy `grep -n -i 'tiktok\|lazada\|accesstrade' <file>` rồi sửa từng chỗ. Nguyên tắc:
- Câu mô tả scope → chỉ còn Shopee.
- Quy trình vận hành nhắc `sync-accesstrade` / `record-conversions-csv` / trang "Đối chiếu Accesstrade" → xoá, vì các thứ đó không còn tồn tại.
- Mục rủi ro liên quan riêng tới Accesstrade trong `rui-ro-can-giai-quyet.md` → đánh dấu là **không còn áp dụng từ 2026-09-29** thay vì xoá trắng (đây là sổ theo dõi rủi ro, giữ vết quyết định có ích).
- `huong-dan-van-hanh-cho-doi-tac.md` và `huong-dan-deploy-instance-moi.md`: gỡ mọi hướng dẫn về việc xin API key Accesstrade / đăng ký campaign.

- [ ] **Step 4: Cập nhật skill `tich-hop-affiliate-provider`**

Gỡ toàn bộ phần TikTok Shop (endpoint `tiktokshop_product_feeds/create_link`, pattern `/view/product/`, `/pdp/`) và Lazada. Giữ lại: cơ chế `an_redir` của Shopee, rút gọn link T3.2, các bug đã gặp và cách chẩn đoán. Cập nhật phần `description` trong frontmatter cho khớp nội dung mới.

- [ ] **Step 5: Kiểm tra lần cuối toàn repo**

```bash
grep -rn -i 'tiktok\|lazada\|accesstrade' --include='*.md' . \
  | grep -v node_modules | grep -v 'docs/superpowers/' | grep -v CHANGELOG
```
Expected: chỉ còn các nhắc tới **có chủ đích** — ghi chú lịch sử dạng "đã ngưng từ 2026-09-29" trong `CLAUDE.md` và `rui-ro-can-giai-quyet.md`. `docs/superpowers/**` bị loại khỏi kết quả vì không được sửa (Global Constraints).

- [ ] **Step 6: Chạy kiểm tra lần cuối**

Run: `npm test && npm run typecheck`
Expected: PASS cả hai.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Cập nhật tài liệu và skill theo scope chỉ còn Shopee

Xoá skill doi-soat-hoa-hong (mô tả accesstradeSync đã bị gỡ). Giữ lại mục
rủi ro Accesstrade trong rui-ro-can-giai-quyet.md dưới dạng "không còn áp
dụng" thay vì xoá trắng.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Sau khi hoàn tất 7 task

Phần này **không phải task code** — là việc người vận hành phải làm, chép từ mục 5 của spec. Báo lại cho user thay vì tự làm:

1. **Huỷ đơn TikTok `pending`** qua `/admin/orders` → link "Huỷ đơn", làm trên **cả 2 service Railway**.
2. **Vào `/admin/settings` sửa tay** mọi giá trị còn chữ "TikTok"/"Lazada": `usageText`, các `faq_answer_*`, mọi template tin nhắn. Giá trị trong DB đè lên default trong code — deploy code sạch xong bot vẫn nói "TikTok Shop" nếu instance đã từng bấm Lưu.
3. **Gỡ biến môi trường `ACCESSTRADE_*`** trên cả 2 service.
4. **Kiểm tra thật**: gửi link TikTok → phải nhận được câu "chỉ hỗ trợ Shopee"; gửi link Shopee → vẫn ra link rút gọn.

Việc merge nhánh `bo-tiktokshop-lazada` vào `main` và deploy **phải hỏi user trước** — `main` auto-deploy lên Railway.
