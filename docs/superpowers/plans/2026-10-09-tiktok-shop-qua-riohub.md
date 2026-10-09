# TikTok Shop qua RioHub — kế hoạch triển khai (đường tạo link)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User gửi link TikTok Shop vào bot → nhận link affiliate kèm số tiền hoàn lại ước tính, y hệt trải nghiệm Shopee đang có.

**Architecture:** Ba module mới trong `src/core/providers/` — `riohubClient` (vận chuyển: dự phòng 3 tên miền, map lỗi), `tiktokAffiliateProvider` (ngữ nghĩa affiliate), `compositeProvider` (định tuyến theo merchant). Registry merchant trở thành hàm dựng theo cờ cấu hình. Mọi thứ mặc định TẮT nên bước 1–5 không đổi hành vi instance nào.

**Tech Stack:** TypeScript · Node 22 · `node:test` chạy qua `tsx --test` · không thêm dependency nào.

**Spec:** `docs/superpowers/specs/2026-10-09-tiktok-shop-qua-riohub-design.md`

## Global Constraints

- **Test chạy qua glob trong `package.json`**: chỉ các thư mục `src/core/__tests__/`, `src/core/faq/__tests__/`, `src/api/__tests__/`, `src/adapters/shared/__tests__/`, `src/adapters/zalo/__tests__/`, `src/scripts/__tests__/` được quét. **Test của provider PHẢI đặt trong `src/core/__tests__/`**, không phải `src/core/providers/__tests__/` (thư mục đó không tồn tại và không được quét).
- **`src/core/**` KHÔNG được import `express`, `telegraf`, hay biết về platform cụ thể.**
- Chạy test: `npm test` · kiểm kiểu: `npm run typecheck`. Cả hai phải xanh trước mỗi commit.
- Mọi lỗi mới là subclass của `AppError` với `userMessage` tiếng Việt an toàn để hiện thẳng cho user.
- Import nội bộ luôn có đuôi `.js` (ESM + tsc).
- Biến môi trường mới phải khai báo mặc định trong `src/config/env.ts` và ghi vào `.env.example`.
- Base URL mặc định, đúng thứ tự: `https://riohub.vn/api/v1` → `https://riohub.riokupon.com/api/v1` → `https://riohub.riokupon.me/api/v1`.
- Đường dẫn endpoint: `/partner/tiktok/affiliate/product-links`.
- Header xác thực: `X-Riohub-Api-Key`.

---

### Task 1: `riohubClient` — tầng vận chuyển

**Files:**
- Create: `src/core/providers/riohubClient.ts`
- Test: `src/core/__tests__/riohubClient.test.ts`

**Interfaces:**
- Consumes: không có (task đầu tiên)
- Produces: `RiohubClient` (method `post<T>(path: string, body: unknown): Promise<T>`), `RiohubApiError { code: string; apiMessage: string; httpStatus: number }`, `RiohubUnreachableError { attempts: number }`, `RIOHUB_DEFAULT_BASE_URLS: readonly string[]`, `type RiohubFetchLike`, `isConnectionLevelError(err: unknown): boolean`

- [ ] **Step 1: Viết test thất bại**

Tạo `src/core/__tests__/riohubClient.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RiohubClient,
  RiohubApiError,
  RiohubUnreachableError,
  type RiohubFetchLike,
} from "../providers/riohubClient.js";

const BASES = ["https://a.test/api/v1", "https://b.test/api/v1", "https://c.test/api/v1"];

function connErr(code: string): Error {
  const e = new Error("connection failed");
  (e as unknown as { cause: { code: string } }).cause = { code };
  return e;
}

function okResponse(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload };
}

function errResponse(status: number, code: string, message: string) {
  return { ok: false, status, json: async () => ({ error: { code, message } }) };
}

test("loi DNS o mien dau -> thu mien ke tiep", async () => {
  const seen: string[] = [];
  const fetchImpl: RiohubFetchLike = async (url) => {
    seen.push(url);
    if (url.startsWith("https://a.test")) throw connErr("ENOTFOUND");
    return okResponse({ affiliate_link: "https://x" });
  };
  const client = new RiohubClient({ apiKey: "k", baseUrls: BASES, fetchImpl });
  const res = await client.post<{ affiliate_link: string }>("/p", {});
  assert.equal(res.affiliate_link, "https://x");
  assert.equal(seen.length, 2);
  assert.ok(seen[1].startsWith("https://b.test"));
});

test("loi TLS sai ten mien cung phai nhay mien - bai hoc su co 29/09/2026", async () => {
  const seen: string[] = [];
  const fetchImpl: RiohubFetchLike = async (url) => {
    seen.push(url);
    if (url.startsWith("https://a.test")) throw connErr("ERR_TLS_CERT_ALTNAME_INVALID");
    return okResponse({ ok: 1 });
  };
  const client = new RiohubClient({ apiKey: "k", baseUrls: BASES, fetchImpl });
  await client.post("/p", {});
  assert.equal(seen.length, 2, "phai thu mien thu hai");
});

test("HTTP 500 -> DUNG LAI, KHONG thu mien khac", async () => {
  const seen: string[] = [];
  const fetchImpl: RiohubFetchLike = async (url) => {
    seen.push(url);
    return errResponse(500, "server_error", "Internal server error");
  };
  const client = new RiohubClient({ apiKey: "k", baseUrls: BASES, fetchImpl });
  await assert.rejects(
    () => client.post("/p", {}),
    (err: unknown) => {
      assert.ok(err instanceof RiohubApiError);
      assert.equal(err.code, "server_error");
      assert.equal(err.httpStatus, 500);
      return true;
    }
  );
  assert.equal(seen.length, 1, "5xx la he thong DA nhan request - doi mien chi ton quota");
});

test("422 cung khong doi mien, giu nguyen error.code", async () => {
  const fetchImpl: RiohubFetchLike = async () =>
    errResponse(422, "product_not_promotable", "no commission");
  const client = new RiohubClient({ apiKey: "k", baseUrls: BASES, fetchImpl });
  await assert.rejects(
    () => client.post("/p", {}),
    (err: unknown) => err instanceof RiohubApiError && err.code === "product_not_promotable"
  );
});

test("ghim mien da chay duoc cho cac lan goi sau", async () => {
  const seen: string[] = [];
  const fetchImpl: RiohubFetchLike = async (url) => {
    seen.push(url);
    if (url.startsWith("https://a.test")) throw connErr("ETIMEDOUT");
    return okResponse({ ok: 1 });
  };
  const client = new RiohubClient({ apiKey: "k", baseUrls: BASES, fetchImpl });
  await client.post("/p", {});
  seen.length = 0;
  await client.post("/p", {});
  assert.equal(seen.length, 1, "khong duoc cho moi request lai cho timeout o mien dau");
  assert.ok(seen[0].startsWith("https://b.test"));
});

test("hong ca 3 mien -> RiohubUnreachableError", async () => {
  const fetchImpl: RiohubFetchLike = async () => {
    throw connErr("ECONNREFUSED");
  };
  const client = new RiohubClient({ apiKey: "k", baseUrls: BASES, fetchImpl });
  await assert.rejects(
    () => client.post("/p", {}),
    (err: unknown) => err instanceof RiohubUnreachableError && err.attempts === 3
  );
});

test("gui dung header xac thuc va body JSON", async () => {
  let captured: { headers?: Record<string, string>; body?: string } = {};
  const fetchImpl: RiohubFetchLike = async (_url, init) => {
    captured = init ?? {};
    return okResponse({ ok: 1 });
  };
  const client = new RiohubClient({ apiKey: "secret-key", baseUrls: BASES, fetchImpl });
  await client.post("/p", { sub_id: "m-1-2-3" });
  assert.equal(captured.headers?.["X-Riohub-Api-Key"], "secret-key");
  assert.equal(JSON.parse(captured.body ?? "{}").sub_id, "m-1-2-3");
});

test("body loi khong phai JSON van ra RiohubApiError co code mac dinh", async () => {
  const fetchImpl: RiohubFetchLike = async () => ({
    ok: false,
    status: 502,
    json: async () => {
      throw new Error("not json");
    },
  });
  const client = new RiohubClient({ apiKey: "k", baseUrls: BASES, fetchImpl });
  await assert.rejects(
    () => client.post("/p", {}),
    (err: unknown) => err instanceof RiohubApiError && err.code === "unknown_error"
  );
});
```

- [ ] **Step 2: Chạy test để xác nhận nó thất bại**

Run: `npx tsx --test src/core/__tests__/riohubClient.test.ts`
Expected: FAIL — `Cannot find module '../providers/riohubClient.js'`

- [ ] **Step 3: Viết implementation tối thiểu**

Tạo `src/core/providers/riohubClient.ts`:

```ts
/**
 * Tang van chuyen cho API RioHub - KHONG biet gi ve affiliate.
 *
 * Hai quy tac song con, doc ky truoc khi sua:
 *
 * 1. CHI doi ten mien khi loi o TANG KET NOI (DNS/timeout/TLS). `4xx`/`5xx` nghia la he thong DA
 *    nhan duoc request - doi mien cung loi y het va chi ton quota (quy tac cua chinh RioHub).
 * 2. PHAI bat ca loi TLS, khong chi DNS. Su co 29/09/2026: `riohub.vn` phan giai DNS binh thuong
 *    nhung tra chung chi cua `riohub.riokupon.com`, request chet TRUOC khi co HTTP status. Code
 *    chi failover khi "khong phan giai duoc DNS" se KHONG chay du phong trong ca do.
 */

export type RiohubFetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Thu lan luot theo dung thu tu nay (khuyen nghi cua RioHub). */
export const RIOHUB_DEFAULT_BASE_URLS: readonly string[] = [
  "https://riohub.vn/api/v1",
  "https://riohub.riokupon.com/api/v1",
  "https://riohub.riokupon.me/api/v1",
];

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Ma loi tang ket noi -> duoc phep doi ten mien. Nhom TLS BAT BUOC co mat (xem doc dau file);
 * tuy ban libcurl/undici ma loi sai ten mien hien ra duoi ten khac nhau nen liet ke rong.
 */
const CONNECTION_ERROR_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
]);

export function isConnectionLevelError(err: unknown): boolean {
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return true;
  }
  const direct = (err as { code?: unknown } | null)?.code;
  if (typeof direct === "string" && CONNECTION_ERROR_CODES.has(direct)) return true;
  const nested = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof nested === "string" && CONNECTION_ERROR_CODES.has(nested);
}

/** RioHub da nhan request va tu choi - KHONG duoc doi ten mien. */
export class RiohubApiError extends Error {
  constructor(
    readonly code: string,
    readonly apiMessage: string,
    readonly httpStatus: number
  ) {
    super(`RioHub ${httpStatus} ${code}: ${apiMessage}`);
    this.name = "RiohubApiError";
  }
}

/** Khong with toi duoc BAT KY ten mien nao. */
export class RiohubUnreachableError extends Error {
  constructor(readonly attempts: number, cause?: unknown) {
    super(`RioHub: khong voi toi duoc ${attempts} ten mien`);
    this.name = "RiohubUnreachableError";
    this.cause = cause;
  }
}

export interface RiohubClientConfig {
  apiKey: string;
  /** Rong/khong truyen -> dung RIOHUB_DEFAULT_BASE_URLS. */
  baseUrls?: readonly string[];
  timeoutMs?: number;
  /** Tiem vao de test khong goi mang that - giong AddlivetagCommissionLookup. */
  fetchImpl?: RiohubFetchLike;
}

export class RiohubClient {
  private readonly baseUrls: readonly string[];
  private readonly fetchImpl: RiohubFetchLike;
  /**
   * Ten mien da tra loi duoc gan nhat. Ghim lai de cac request sau khong phai cho timeout o mien
   * dau moi lan - khuyen nghi cua RioHub.
   */
  private pinnedBaseUrl: string | null = null;

  constructor(private readonly config: RiohubClientConfig) {
    this.baseUrls =
      config.baseUrls && config.baseUrls.length > 0 ? config.baseUrls : RIOHUB_DEFAULT_BASE_URLS;
    this.fetchImpl = config.fetchImpl ?? (globalThis.fetch as unknown as RiohubFetchLike);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const order = this.pinnedBaseUrl
      ? [this.pinnedBaseUrl, ...this.baseUrls.filter((b) => b !== this.pinnedBaseUrl)]
      : [...this.baseUrls];

    let lastConnectionError: unknown;

    for (const base of order) {
      let res: Awaited<ReturnType<RiohubFetchLike>>;
      try {
        res = await this.fetchImpl(base + path, {
          method: "POST",
          headers: {
            "X-Riohub-Api-Key": this.config.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
      } catch (err) {
        // Loi KHONG phai tang ket noi (vd bug trong chinh fetchImpl) thi nem thang ra - doi ten
        // mien khong giup gi va con che mat nguyen nhan that.
        if (!isConnectionLevelError(err)) throw err;
        lastConnectionError = err;
        continue;
      }

      // Ghim NGAY khi nhan duoc phan hoi HTTP, ke ca 5xx: tang ket noi toi mien nay da chay duoc,
      // ma ca 3 mien dung chung mot backend nen doi mien khong chua duoc loi ung dung.
      this.pinnedBaseUrl = base;

      const payload = await res.json().catch(() => null);
      if (!res.ok) throw toApiError(payload, res.status);
      return payload as T;
    }

    throw new RiohubUnreachableError(order.length, lastConnectionError);
  }
}

function toApiError(payload: unknown, httpStatus: number): RiohubApiError {
  const error = (payload as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  const code = typeof error?.code === "string" ? error.code : "unknown_error";
  const message = typeof error?.message === "string" ? error.message : "";
  return new RiohubApiError(code, message, httpStatus);
}
```

- [ ] **Step 4: Chạy test để xác nhận nó pass**

Run: `npx tsx --test src/core/__tests__/riohubClient.test.ts`
Expected: PASS, 8/8

- [ ] **Step 5: Kiểm kiểu rồi commit**

```bash
npm run typecheck
git add src/core/providers/riohubClient.ts src/core/__tests__/riohubClient.test.ts
git commit -m "feat(riohub): client co du phong 3 ten mien, chi doi mien khi loi tang ket noi"
```

---

### Task 2: Registry merchant theo cờ + tách vai trò `shortHosts`

**Files:**
- Modify: `src/core/merchants.ts`
- Modify: `src/core/linkValidator.ts:141`
- Test: `src/core/__tests__/merchants.test.ts` (bổ sung vào file đã có)

**Interfaces:**
- Consumes: không có
- Produces: `buildMerchantRegistry(options: { tiktokEnabled: boolean }): { active: readonly MerchantConfig[]; retired: readonly MerchantConfig[] }`; `MerchantConfig` có thêm field tuỳ chọn `resolveShortLinks?: boolean`

- [ ] **Step 1: Viết test thất bại**

`src/core/__tests__/merchants.test.ts` **đã có sẵn** `import { test }`, `import assert` và một khối
import từ `../merchants.js`. **Thêm `buildMerchantRegistry` vào khối import đã có** (đừng viết thêm
một dòng `import` thứ hai từ cùng module), rồi thêm các test sau vào cuối file:

```ts
test("co TAT -> tiktokshop nam trong danh sach da ngung", () => {
  const { active, retired } = buildMerchantRegistry({ tiktokEnabled: false });
  assert.equal(active.find((m) => m.id === "tiktokshop"), undefined);
  assert.ok(retired.find((m) => m.id === "tiktokshop"));
});

test("co BAT -> tiktokshop chuyen sang danh sach dang ho tro", () => {
  const { active, retired } = buildMerchantRegistry({ tiktokEnabled: true });
  assert.ok(active.find((m) => m.id === "tiktokshop"));
  assert.equal(retired.find((m) => m.id === "tiktokshop"), undefined);
});

test("lazada LUON o danh sach da ngung, khong phu thuoc co tiktok", () => {
  for (const tiktokEnabled of [true, false]) {
    const { retired } = buildMerchantRegistry({ tiktokEnabled });
    assert.ok(retired.find((m) => m.id === "lazada"));
  }
});

test("tiktokshop KHONG resolve short link, shopee thi CO", () => {
  const { active } = buildMerchantRegistry({ tiktokEnabled: true });
  const tiktok = active.find((m) => m.id === "tiktokshop");
  const shopee = active.find((m) => m.id === "shopee");
  // RioHub tu theo redirect, bot khong can goi mang them.
  assert.equal(tiktok?.resolveShortLinks, false);
  // Shopee van phai resolve: an_redir can URL that.
  assert.notEqual(shopee?.resolveShortLinks, false);
});

test("vt.tiktok.com VAN duoc nhan dien la tiktok du khong resolve", () => {
  const { active } = buildMerchantRegistry({ tiktokEnabled: true });
  const tiktok = active.find((m) => m.id === "tiktokshop");
  // Bo shortHosts di thi extractProductUrls khong nhat link ra -> bot IM LANG.
  assert.ok(tiktok?.shortHosts.has("vt.tiktok.com"));
});
```

- [ ] **Step 2: Chạy test để xác nhận nó fail**

Run: `npx tsx --test src/core/__tests__/merchants.test.ts`
Expected: FAIL — `buildMerchantRegistry is not exported`

- [ ] **Step 3: Sửa `merchants.ts`**

Thêm field vào interface:

```ts
export interface MerchantConfig {
  id: MerchantId;
  displayName: string;
  hostPattern: RegExp;
  /** Domain rut gon can theo redirect de lay URL that (vi du s.shopee.vn). */
  shortHosts: Set<string>;
  /**
   * Co theo redirect cua shortHosts khong (mac dinh TRUE).
   *
   * `shortHosts` ganh HAI vai tro: nhan dien merchant theo host, VA kich hoat resolve redirect.
   * TikTok can vai tro thu nhat (khong co thi extractProductUrls khong nhat link vt.tiktok.com ra,
   * bot IM LANG) nhung KHONG can vai tro thu hai (RioHub tu resolve, da verify 2026-10-09).
   * Xoa shortHosts di de tat resolve la sai - no tat luon kha nang nhan dien.
   */
  resolveShortLinks?: boolean;
}
```

Thay hai hằng số tĩnh bằng hàm dựng (giữ nguyên hai export cũ để mọi call site không phải sửa):

```ts
const SHOPEE: MerchantConfig = {
  id: "shopee",
  displayName: "Shopee",
  hostPattern: /(^|\.)shopee\.(vn|com|co\.id|com\.my|com\.ph|co\.th|sg)$/i,
  shortHosts: new Set(["s.shopee.vn", "shp.ee", "vn.shp.ee"]),
};

const LAZADA: MerchantConfig = {
  id: "lazada",
  displayName: "Lazada",
  hostPattern: /(^|\.)lazada\.(vn|com|co\.id|com\.my|com\.ph|co\.th|sg)$/i,
  shortHosts: new Set(),
};

const TIKTOK_SHOP: MerchantConfig = {
  id: "tiktokshop",
  displayName: "TikTok Shop",
  hostPattern: /(^|\.)tiktok\.com$/i,
  shortHosts: new Set(["vt.tiktok.com"]),
  resolveShortLinks: false,
};

export interface MerchantRegistryOptions {
  /** TIKTOK_ENABLED + du cau hinh RioHub. Xem src/config/env.ts. */
  tiktokEnabled: boolean;
}

/**
 * Registry THAT SU khac nhau giua cac instance: instance chua bat TikTok phai giu nguyen hanh vi
 * cu (link TikTok -> RetiredMerchantLinkError), nen tiktokshop nam o danh sach nao la tuy cau hinh.
 * Ham thuan de test doi duoc co ma khong phai mock env.
 */
export function buildMerchantRegistry(options: MerchantRegistryOptions): {
  active: readonly MerchantConfig[];
  retired: readonly MerchantConfig[];
} {
  return options.tiktokEnabled
    ? { active: [SHOPEE, TIKTOK_SHOP], retired: [LAZADA] }
    : { active: [SHOPEE], retired: [LAZADA, TIKTOK_SHOP] };
}
```

Rồi dựng hai hằng số mặc định từ env (thay cho hai mảng tĩnh cũ):

```ts
import { env } from "../config/env.js";

const defaultRegistry = buildMerchantRegistry({ tiktokEnabled: env.tiktok.enabled });

/** San DANG duoc ho tro - THEM MERCHANT MOI TAI buildMerchantRegistry(). */
export const MERCHANTS: readonly MerchantConfig[] = defaultRegistry.active;

/** San TUNG duoc ho tro. Giu lai de don cu trong ledger van render duoc ten san. */
export const RETIRED_MERCHANTS: readonly MerchantConfig[] = defaultRegistry.retired;
```

**Lưu ý:** `getMerchantConfig()` đã tra cả hai danh sách nên không phải sửa — `getMerchantConfig("tiktokshop")` vẫn trả được tên ở cả hai trạng thái cờ.

- [ ] **Step 4: Sửa `linkValidator.ts` dòng 141**

Đổi điều kiện resolve:

```ts
  if (merchant.resolveShortLinks !== false && merchant.shortHosts.has(url.hostname.toLowerCase())) {
```

Dùng `!== false` chứ không phải `=== true`: field là tuỳ chọn, merchant cũ không khai báo thì mặc định vẫn resolve như trước.

- [ ] **Step 5: Chạy toàn bộ test**

Run: `npm test`
Expected: PASS — đặc biệt `linkValidator.test.ts` phải xanh nguyên (Shopee không được hồi quy)

- [ ] **Step 6: Commit**

```bash
npm run typecheck
git add src/core/merchants.ts src/core/linkValidator.ts src/core/__tests__/merchants.test.ts
git commit -m "feat(merchants): registry theo co TIKTOK_ENABLED, tach vai tro shortHosts khoi resolve redirect"
```

---

### Task 3: Biến môi trường + 2 template tin nhắn

**Files:**
- Modify: `src/config/env.ts`
- Modify: `src/core/settingsKeys.ts`
- Modify: `src/config/settingsRegistry.ts`
- Modify: `src/core/ledgerStore.ts` (2 getter)
- Modify: `.env.example`
- Test: `src/core/__tests__/tiktokSettings.test.ts`

**Interfaces:**
- Consumes: không có
- Produces: `env.tiktok: { enabled: boolean; apiKey: string; creatorUsername: string; baseUrls: string[]; timeoutMs: number; linkChannel: string }`; `SETTINGS_KEYS.tiktokProviderDownTemplate`, `SETTINGS_KEYS.tiktokNoCommissionTemplate`; `LedgerStore.getTiktokProviderDownTemplate(default: string): string`, `LedgerStore.getTiktokNoCommissionTemplate(default: string): string`; hằng số `TIKTOK_PROVIDER_DOWN_TEMPLATE_DEFAULT`, `TIKTOK_NO_COMMISSION_TEMPLATE_DEFAULT` trong `src/adapters/shared/replyText.ts`

- [ ] **Step 1: Viết test thất bại**

Tạo `src/core/__tests__/tiktokSettings.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TIKTOK_PROVIDER_DOWN_TEMPLATE_DEFAULT,
  TIKTOK_NO_COMMISSION_TEMPLATE_DEFAULT,
} from "../../adapters/shared/replyText.js";
import { SETTINGS_KEYS } from "../settingsKeys.js";
import { SETTINGS_REGISTRY } from "../../config/settingsRegistry.js";

test("cau bao tri dung NGUYEN VAN chu bot da chot - khong tu bien tau", () => {
  assert.equal(
    TIKTOK_PROVIDER_DOWN_TEMPLATE_DEFAULT,
    "Hệ thống Affiliate của Tiktok đang bảo trì, hãy thử lại sau 30 phút nữa"
  );
});

test("cau 'chua bat hoa hong' KHONG duoc hua thu lai sau", () => {
  // 30 phut nua san pham do VAN khong co hoa hong - hua thu lai la noi sai.
  const text = TIKTOK_NO_COMMISSION_TEMPLATE_DEFAULT.toLowerCase();
  assert.ok(!text.includes("thử lại"), "khong duoc chua 'thu lai'");
  assert.ok(!text.includes("bảo trì"), "khong duoc chua 'bao tri'");
});

test("2 setting moi co mat trong SETTINGS_REGISTRY de admin sua duoc", () => {
  const keys = SETTINGS_REGISTRY.map((f) => f.key);
  assert.ok(keys.includes(SETTINGS_KEYS.tiktokProviderDownTemplate));
  assert.ok(keys.includes(SETTINGS_KEYS.tiktokNoCommissionTemplate));
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npx tsx --test src/core/__tests__/tiktokSettings.test.ts`
Expected: FAIL — các export chưa tồn tại

- [ ] **Step 3: Thêm 2 hằng số template vào `src/adapters/shared/replyText.ts`**

```ts
/**
 * RioHub (nguon affiliate TikTok) khong goi duoc - quyet dinh cua chu bot 2026-10-09: bao bao tri,
 * KHONG tra link goc thay the. Nguyen van cau chu do chu bot dat, co test chan viec sua tuy tien.
 */
export const TIKTOK_PROVIDER_DOWN_TEMPLATE_DEFAULT =
  "Hệ thống Affiliate của Tiktok đang bảo trì, hãy thử lại sau 30 phút nữa";

/**
 * San pham co that nhung shop chua bat hoa hong (`422 product_not_promotable`). TUYET DOI khong
 * gop vao cau bao tri: 30 phut nua san pham do van khong co hoa hong, hua thu lai la noi sai.
 */
export const TIKTOK_NO_COMMISSION_TEMPLATE_DEFAULT =
  "Sản phẩm này shop chưa bật hoàn tiền nên em không tạo được link nha 😅 Bạn thử sản phẩm khác giúp em.";
```

- [ ] **Step 4: Thêm 2 key vào `src/core/settingsKeys.ts`**

```ts
  /** Tin bao khi RioHub khong goi duoc (2026-10-09). */
  tiktokProviderDownTemplate: "tiktok_provider_down_template",
  /** Tin bao khi san pham TikTok chua bat hoa hong (422 product_not_promotable). */
  tiktokNoCommissionTemplate: "tiktok_no_commission_template",
```

- [ ] **Step 5: Thêm 2 entry vào `SETTINGS_REGISTRY`**

Theo đúng hình dạng các entry template đang có trong `src/config/settingsRegistry.ts` (label / type `textarea` / default lấy từ 2 hằng số ở Step 3 / helpText ghi "Không có placeholder động"), đặt cùng nhóm với các template tin nhắn bot khác để `settingsTabOf()` xếp vào tab "Mẫu tin nhắn bot".

- [ ] **Step 6: Thêm 2 getter vào `LedgerStore`**

Đặt cạnh `getSuccessReplyTemplate`:

```ts
  getTiktokProviderDownTemplate(defaultValue: string): string {
    return this.getSetting(SETTINGS_KEYS.tiktokProviderDownTemplate, defaultValue);
  }

  getTiktokNoCommissionTemplate(defaultValue: string): string {
    return this.getSetting(SETTINGS_KEYS.tiktokNoCommissionTemplate, defaultValue);
  }
```

- [ ] **Step 7: Thêm cấu hình vào `src/config/env.ts`**

```ts
  /**
   * TikTok Shop qua RioHub (2026-10-09). Mac dinh TAT - giong FAQ_PROVIDER=off va
   * COMMISSION_LOOKUP_ENABLED=false: deploy code moi ma chua cau hinh thi hanh vi bot KHONG DOI
   * (link TikTok van nhan RetiredMerchantLinkError nhu truoc).
   */
  tiktok: {
    enabled: optionalBool("TIKTOK_ENABLED", false),
    apiKey: optional("RIOHUB_API_KEY", ""),
    creatorUsername: optional("RIOHUB_CREATOR_USERNAME", ""),
    /** Ngan cach dau phay, dung thu tu thu. Rong -> RIOHUB_DEFAULT_BASE_URLS. */
    baseUrls: optional("RIOHUB_BASE_URLS", "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== ""),
    timeoutMs: optionalNumber("RIOHUB_TIMEOUT_MS", 10_000),
    /** Nhan `channel` de tach link bot tao khoi link chu bot tu tao tren app RioHub. */
    linkChannel: optional("RIOHUB_LINK_CHANNEL", "bot"),
  },
```

**Lưu ý:** `env.tiktok.enabled` ở đây là cờ THÔ. Việc tự tắt khi thiếu key nằm ở Task 5 (`providers/index.ts`) để `merchants.ts` không phải biết về API key.

- [ ] **Step 8: Ghi 6 biến vào `.env.example`** kèm chú thích mặc định và nơi lấy key (`riohub.vn/tiktok-shop-developer`)

- [ ] **Step 9: Chạy test + commit**

```bash
npm test && npm run typecheck
git add src/config/env.ts src/core/settingsKeys.ts src/config/settingsRegistry.ts src/core/ledgerStore.ts src/adapters/shared/replyText.ts .env.example src/core/__tests__/tiktokSettings.test.ts
git commit -m "feat(tiktok): cau hinh RioHub + 2 template tin nhan, mac dinh tat"
```

---

### Task 4: `tiktokAffiliateProvider`

**Files:**
- Create: `src/core/providers/tiktokAffiliateProvider.ts`
- Modify: `src/core/errors.ts`
- Test: `src/core/__tests__/tiktokAffiliateProvider.test.ts`

**Interfaces:**
- Consumes: `RiohubClient`, `RiohubApiError`, `RiohubUnreachableError` (Task 1)
- Produces: `TiktokAffiliateProvider implements AffiliateProvider`; `mapRiohubError(err: unknown): AppError`; `ProviderUnavailableError extends AppError` (code `"PROVIDER_UNAVAILABLE"`, có field `providerErrorCode: string`)

- [ ] **Step 1: Viết test thất bại**

Tạo `src/core/__tests__/tiktokAffiliateProvider.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { TiktokAffiliateProvider } from "../providers/tiktokAffiliateProvider.js";
import { RiohubClient, type RiohubFetchLike } from "../providers/riohubClient.js";
import { ProviderUnavailableError, ProductNotAffiliateEligibleError, NotAProductLinkError } from "../errors.js";

const BASES = ["https://a.test/api/v1"];

function providerWith(responder: RiohubFetchLike) {
  return new TiktokAffiliateProvider({
    client: new RiohubClient({ apiKey: "k", baseUrls: BASES, fetchImpl: responder }),
    creatorUsername: "creator1",
    channel: "bot",
  });
}

function jsonOk(payload: unknown): RiohubFetchLike {
  return async () => ({ ok: true, status: 200, json: async () => payload });
}

function jsonErr(status: number, code: string, message: string): RiohubFetchLike {
  return async () => ({ ok: false, status, json: async () => ({ error: { code, message } }) });
}

const BASE_INPUT = {
  merchant: "tiktokshop" as const,
  productUrl: "https://shop.tiktok.com/vn/pdp/1733204173655213684",
  subId: "m-7349128374-l9k2x1-ab3d",
};

test("tra ve link RioHub, KHONG rut gon lai qua /s/", async () => {
  const p = providerWith(jsonOk({ affiliate_link: "https://www.tiktok.com/t/ZSbtQs6NG/", product: null }));
  const out = await p.createAffiliateLink(BASE_INPUT);
  assert.equal(out.affiliateUrl, "https://www.tiktok.com/t/ZSbtQs6NG/");
});

test("gui dung sub_id 4 doan va channel", async () => {
  let body: Record<string, unknown> = {};
  const p = providerWith(async (_url, init) => {
    body = JSON.parse(init?.body ?? "{}");
    return { ok: true, status: 200, json: async () => ({ affiliate_link: "https://x" }) };
  });
  await p.createAffiliateLink(BASE_INPUT);
  assert.equal(body.sub_id, "m-7349128374-l9k2x1-ab3d");
  assert.equal(body.channel, "bot");
  assert.equal(body.creator_username, "creator1");
  assert.equal(body.product_url, BASE_INPUT.productUrl);
});

test("uu tien observed_commission hon commission.rate", async () => {
  const p = providerWith(
    jsonOk({
      affiliate_link: "https://x",
      product: {
        title: "Khan lau kinh",
        commission: { amount: "250.00 - 735.00", rate: 500 },
        observed_commission: { commission_rate: 600 },
        sales_price: { minimum_amount: "5000", maximum_amount: "14700" },
      },
    })
  );
  const out = await p.createAffiliateLink(BASE_INPUT);
  // 6,00% (observed) cua 5.000d (dau thap) = 300d, khong phai 5% = 250d
  assert.equal(out.commissionEstimate?.ratePercent, 6);
  assert.equal(out.commissionEstimate?.estimatedAmount, 300);
  assert.equal(out.productName, "Khan lau kinh");
});

test("khong co observed_commission -> lui ve commission.rate", async () => {
  const p = providerWith(
    jsonOk({
      affiliate_link: "https://x",
      product: {
        commission: { rate: 1200 },
        sales_price: { minimum_amount: "100000", maximum_amount: "300000" },
      },
    })
  );
  const out = await p.createAffiliateLink(BASE_INPUT);
  assert.equal(out.commissionEstimate?.ratePercent, 12);
  assert.equal(out.commissionEstimate?.estimatedAmount, 12000);
});

test("gia dang KHOANG -> lay dau THAP (hua it hon tra)", async () => {
  const p = providerWith(
    jsonOk({
      affiliate_link: "https://x",
      product: { commission: { rate: 1000 }, sales_price: { minimum_amount: "5000", maximum_amount: "99000" } },
    })
  );
  const out = await p.createAffiliateLink(BASE_INPUT);
  assert.equal(out.commissionEstimate?.estimatedAmount, 500);
});

test("product_error co mat -> VAN tra link, chi bo phan uoc tinh", async () => {
  const p = providerWith(
    jsonOk({ affiliate_link: "https://www.tiktok.com/t/ABC/", product: null, product_error: "timeout" })
  );
  const out = await p.createAffiliateLink(BASE_INPUT);
  assert.equal(out.affiliateUrl, "https://www.tiktok.com/t/ABC/");
  assert.equal(out.commissionEstimate, null);
  assert.equal(out.productName, null);
});

test("422 product_not_promotable -> ProductNotAffiliateEligibleError, KHONG phai cau bao tri", async () => {
  const p = providerWith(jsonErr(422, "product_not_promotable", "no commission"));
  await assert.rejects(
    () => p.createAffiliateLink(BASE_INPUT),
    (err: unknown) => {
      assert.ok(err instanceof ProductNotAffiliateEligibleError);
      assert.ok(!(err instanceof ProviderUnavailableError), "khong duoc gop vao nhanh bao tri");
      return true;
    }
  );
});

test("422 khong parse duoc URL -> NotAProductLinkError", async () => {
  const p = providerWith(
    jsonErr(422, "validation_error", "Cannot extract product_id: Unrecognized TikTok product URL format.")
  );
  await assert.rejects(
    () => p.createAffiliateLink(BASE_INPUT),
    (err: unknown) => err instanceof NotAProductLinkError
  );
});

test("500 server_error -> ProviderUnavailableError giu nguyen ma loi de bao admin", async () => {
  const p = providerWith(jsonErr(500, "server_error", "Internal server error"));
  await assert.rejects(
    () => p.createAffiliateLink(BASE_INPUT),
    (err: unknown) =>
      err instanceof ProviderUnavailableError && err.providerErrorCode === "server_error"
  );
});

test("ma loi LA van ra ProviderUnavailableError (nhanh mac dinh)", async () => {
  // Bang ma loi cua RioHub KHONG day du - mcn_membership_required va server_error deu khong co
  // trong tai lieu. Thieu nhanh mac dinh thi mot ma moi lam bot chet cam.
  const p = providerWith(jsonErr(403, "mot_ma_chua_tung_gap", "???"));
  await assert.rejects(
    () => p.createAffiliateLink(BASE_INPUT),
    (err: unknown) =>
      err instanceof ProviderUnavailableError && err.providerErrorCode === "mot_ma_chua_tung_gap"
  );
});

test("merchant khac tiktokshop -> tu choi", async () => {
  const p = providerWith(jsonOk({ affiliate_link: "https://x" }));
  await assert.rejects(() => p.createAffiliateLink({ ...BASE_INPUT, merchant: "shopee" }));
});

test("getPromotions tra rong", async () => {
  const p = providerWith(jsonOk({}));
  assert.deepEqual(await p.getPromotions("tiktokshop", 5), []);
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npx tsx --test src/core/__tests__/tiktokAffiliateProvider.test.ts`
Expected: FAIL — module chưa tồn tại

- [ ] **Step 3: Thêm `ProviderUnavailableError` vào `src/core/errors.ts`**

Thêm `"PROVIDER_UNAVAILABLE"` vào union `ErrorCode`, rồi:

```ts
/**
 * Nguon affiliate khong goi duoc (RioHub sap, het han muc, key sai, khong voi toi duoc ten mien
 * nao). KHAC HAN ProductNotAffiliateEligibleError: ca do thu lai bao nhieu lan cung the, con ca
 * nay thu lai sau co the chay.
 *
 * MOI loi loai nay deu phai BAO ADMIN - day la ly do no la mot lop rieng thay vi dung chung
 * AffiliateApiError: adapter nhin `instanceof` la biet co phai canh bao hay khong.
 *
 * userMessage o day chi la DU PHONG - adapter se thay bang template
 * `tiktokProviderDownTemplate` admin sua duoc tren /admin/settings.
 */
export class ProviderUnavailableError extends AppError {
  constructor(
    readonly providerErrorCode: string,
    detail: string
  ) {
    super("PROVIDER_UNAVAILABLE", "Hệ thống affiliate đang bảo trì, bạn thử lại sau ít phút nhé.");
    this.message = `Provider unavailable (${providerErrorCode}): ${detail}`;
  }
}
```

- [ ] **Step 4: Viết `src/core/providers/tiktokAffiliateProvider.ts`**

```ts
import {
  MerchantNotConfiguredError,
  NotAProductLinkError,
  ProductNotAffiliateEligibleError,
  ProviderUnavailableError,
  type AppError,
} from "../errors.js";
import { getMerchantConfig, type MerchantId } from "../merchants.js";
import type {
  AffiliateProvider,
  CommissionEstimate,
  CreateAffiliateLinkInput,
  CreateAffiliateLinkOutput,
  PromotionItem,
} from "../affiliateProvider.js";
import { RiohubApiError, RiohubUnreachableError, type RiohubClient } from "./riohubClient.js";

const PRODUCT_LINKS_PATH = "/partner/tiktok/affiliate/product-links";

interface RiohubProduct {
  title?: string;
  commission?: { amount?: string; rate?: number };
  observed_commission?: { commission_rate?: number } | null;
  sales_price?: { minimum_amount?: string; maximum_amount?: string } | null;
}

interface ProductLinkResponse {
  affiliate_link?: string;
  product?: RiohubProduct | null;
  product_error?: string | null;
}

export interface TiktokAffiliateProviderConfig {
  client: RiohubClient;
  creatorUsername: string;
  /** Nhan nguon traffic, tach link bot tao khoi link chu bot tu tao tren app RioHub. */
  channel: string;
}

/**
 * Tao link affiliate TikTok Shop qua RioHub - lop API tren link affiliate CHINH CHU cua tai khoan
 * creator, nen TikTok tra hoa hong thang cho chu bot, RioHub thu 0d.
 *
 * Dung `/product-links` thay vi `/links`: cung MOT request tra ve ca link LAN thong tin san pham
 * (gia + rate hoa hong), nen bao duoc so uoc tinh cho user ma khong ton them luot goi nao.
 *
 * KHONG rut gon lai qua /s/:code nhu Shopee - RioHub da tra link ngan san, them mot chang redirect
 * chi tang rui ro hong deep-link mo app TikTok.
 */
export class TiktokAffiliateProvider implements AffiliateProvider {
  constructor(private readonly config: TiktokAffiliateProviderConfig) {}

  async createAffiliateLink(input: CreateAffiliateLinkInput): Promise<CreateAffiliateLinkOutput> {
    if (input.merchant !== "tiktokshop") {
      throw new MerchantNotConfiguredError(getMerchantConfig(input.merchant).displayName);
    }

    let res: ProductLinkResponse;
    try {
      res = await this.config.client.post<ProductLinkResponse>(PRODUCT_LINKS_PATH, {
        creator_username: this.config.creatorUsername,
        // Gui THANG URL goc: RioHub tu parse, ke ca link rut gon vt.tiktok.com (verify 2026-10-09).
        product_url: input.productUrl,
        sub_id: input.subId,
        channel: this.config.channel,
      });
    } catch (err) {
      throw mapRiohubError(err);
    }

    if (!res.affiliate_link) {
      throw new ProviderUnavailableError("missing_affiliate_link", "RioHub tra 200 nhung thieu affiliate_link");
    }

    return {
      affiliateUrl: res.affiliate_link,
      // product_error / product null -> van tra link, chi bo uoc tinh (tai lieu RioHub: "khong lay
      // duoc thi product = null, link van tra binh thuong").
      commissionEstimate: estimateFrom(res.product),
      productName: res.product?.title ?? null,
    };
  }

  /** TikTok khong co nguon coupon chung theo merchant, giong Shopee. */
  async getPromotions(_merchant: MerchantId, _limit: number): Promise<PromotionItem[]> {
    return [];
  }
}

/**
 * Dau THAP cua mot chuoi co the la khoang ("250.00 - 735.00") hoac mot so ("5000").
 * Lay dau thap o moi cho co the: cong voi viec `commission.rate` von thap hon thuc te ~17%,
 * moi sai so deu don ve phia HUA IT HON TRA.
 */
export function lowEndAmount(value: string | undefined | null): number | null {
  if (!value) return null;
  const first = value.split("-")[0]?.trim() ?? "";
  const parsed = Number(first);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function estimateFrom(product: RiohubProduct | null | undefined): CommissionEstimate | null {
  if (!product) return null;

  // observed_commission la rate THUC TE do tu don da phat sinh (da gom hoa hong thuong);
  // commission.rate chi la rate chuan shop niem yet, do duoc thap hon thuc te (500 vs 600).
  const rateRaw = product.observed_commission?.commission_rate ?? product.commission?.rate;
  if (typeof rateRaw !== "number" || rateRaw <= 0) return null;
  const ratePercent = rateRaw / 100;

  const price =
    lowEndAmount(product.sales_price?.minimum_amount) ?? lowEndAmount(product.commission?.amount);
  if (price === null) return null;

  // TikTok KHONG co tran hoa hong nhu Shopee (40k) nen nhan tay la hop le - khac han quy tac cung
  // cua Shopee la phai lay thang field `commission`.
  return {
    ratePercent,
    estimatedAmount: Math.round((price * ratePercent) / 100),
    currency: "VND",
  };
}

/**
 * Chia nhanh theo `error.code`, KHONG theo HTTP status.
 *
 * Nhanh mac dinh (ProviderUnavailableError) la BAT BUOC: bang ma loi cua RioHub khong day du -
 * `mcn_membership_required` va `server_error` deu khong co trong tai lieu. Thieu no thi mot ma moi
 * cua ho se lam bot chet cam.
 */
export function mapRiohubError(err: unknown): AppError {
  if (err instanceof RiohubUnreachableError) {
    return new ProviderUnavailableError("unreachable", `khong voi toi ${err.attempts} ten mien`);
  }
  if (err instanceof RiohubApiError) {
    if (err.code === "product_not_promotable") {
      return new ProductNotAffiliateEligibleError(err.apiMessage);
    }
    if (err.code === "validation_error" && /cannot extract product_id/i.test(err.apiMessage)) {
      return new NotAProductLinkError("TikTok Shop");
    }
    return new ProviderUnavailableError(err.code, err.apiMessage);
  }
  return new ProviderUnavailableError("unknown", err instanceof Error ? err.message : String(err));
}
```

- [ ] **Step 5: Chạy test**

Run: `npx tsx --test src/core/__tests__/tiktokAffiliateProvider.test.ts`
Expected: PASS, 12/12

- [ ] **Step 6: Commit**

```bash
npm run typecheck
git add src/core/providers/tiktokAffiliateProvider.ts src/core/errors.ts src/core/__tests__/tiktokAffiliateProvider.test.ts
git commit -m "feat(tiktok): provider tao link qua RioHub /product-links kem uoc tinh hoa hong"
```

---

### Task 5: `compositeProvider` + nối vào factory

**Files:**
- Create: `src/core/providers/compositeProvider.ts`
- Modify: `src/core/providers/index.ts`
- Test: `src/core/__tests__/compositeProvider.test.ts`

**Interfaces:**
- Consumes: `AffiliateProvider` (có sẵn), `TiktokAffiliateProvider` (Task 4), `RiohubClient` (Task 1), `env.tiktok` (Task 3)
- Produces: `CompositeAffiliateProvider implements AffiliateProvider` — constructor nhận `Map<MerchantId, AffiliateProvider>`

- [ ] **Step 1: Viết test thất bại**

Tạo `src/core/__tests__/compositeProvider.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { CompositeAffiliateProvider } from "../providers/compositeProvider.js";
import { MerchantNotConfiguredError } from "../errors.js";
import type { AffiliateProvider } from "../affiliateProvider.js";
import type { MerchantId } from "../merchants.js";

// Chu thich kieu la BAT BUOC: `new Map([["shopee", ...]])` duoc TS suy thanh Map<string, ...>,
// khong khop ReadonlyMap<MerchantId, ...> cua constructor -> loi bien dich.
type ProviderMap = Map<MerchantId, AffiliateProvider>;

function fakeProvider(tag: string): AffiliateProvider {
  return {
    createAffiliateLink: async () => ({ affiliateUrl: `https://${tag}` }),
    getPromotions: async () => [{ couponCode: tag, description: tag }],
  };
}

const INPUT = { productUrl: "https://x", subId: "m-1-2-3" };

test("dinh tuyen dung provider theo merchant", async () => {
  const map: ProviderMap = new Map([
    ["shopee", fakeProvider("shopee")],
    ["tiktokshop", fakeProvider("tiktok")],
  ]);
  const c = new CompositeAffiliateProvider(map);
  assert.equal((await c.createAffiliateLink({ ...INPUT, merchant: "shopee" })).affiliateUrl, "https://shopee");
  assert.equal((await c.createAffiliateLink({ ...INPUT, merchant: "tiktokshop" })).affiliateUrl, "https://tiktok");
});

test("merchant khong co provider -> MerchantNotConfiguredError", async () => {
  const map: ProviderMap = new Map([["shopee", fakeProvider("shopee")]]);
  const c = new CompositeAffiliateProvider(map);
  await assert.rejects(
    () => c.createAffiliateLink({ ...INPUT, merchant: "tiktokshop" }),
    (err: unknown) => err instanceof MerchantNotConfiguredError
  );
});

test("getPromotions cung dinh tuyen theo merchant", async () => {
  const map: ProviderMap = new Map([["tiktokshop", fakeProvider("tiktok")]]);
  const c = new CompositeAffiliateProvider(map);
  assert.equal((await c.getPromotions("tiktokshop", 3))[0]?.couponCode, "tiktok");
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npx tsx --test src/core/__tests__/compositeProvider.test.ts`
Expected: FAIL — module chưa tồn tại

- [ ] **Step 3: Viết `src/core/providers/compositeProvider.ts`**

```ts
import { MerchantNotConfiguredError } from "../errors.js";
import { getMerchantConfig, type MerchantId } from "../merchants.js";
import type {
  AffiliateProvider,
  CreateAffiliateLinkInput,
  CreateAffiliateLinkOutput,
  PromotionItem,
} from "../affiliateProvider.js";

/**
 * Dinh tuyen theo merchant. Truoc 2026-10-09 he thong chi co DUNG MOT provider that nen factory
 * tra thang no; tu khi co TikTok thi can lop nay.
 *
 * Factory CHI boc lop nay khi co tu 2 provider tro len - mot provider thi tra thang, do mot lop
 * gian tiep cho truong hop pho bien nhat (instance chi chay Shopee).
 */
export class CompositeAffiliateProvider implements AffiliateProvider {
  constructor(private readonly byMerchant: ReadonlyMap<MerchantId, AffiliateProvider>) {}

  async createAffiliateLink(input: CreateAffiliateLinkInput): Promise<CreateAffiliateLinkOutput> {
    return this.require(input.merchant).createAffiliateLink(input);
  }

  async getPromotions(merchant: MerchantId, limit: number): Promise<PromotionItem[]> {
    return this.require(merchant).getPromotions(merchant, limit);
  }

  private require(merchant: MerchantId): AffiliateProvider {
    const provider = this.byMerchant.get(merchant);
    if (!provider) {
      throw new MerchantNotConfiguredError(getMerchantConfig(merchant).displayName);
    }
    return provider;
  }
}
```

- [ ] **Step 4: Sửa `src/core/providers/index.ts`**

Thêm hàm dựng TikTok provider (tự tắt kèm cảnh báo khi thiếu key, giống `createCommissionLookup`):

```ts
/**
 * Provider TikTok, hoac `null` neu chua bat/thieu cau hinh.
 *
 * Thieu key thi ROT VE tat kem canh bao chu KHONG throw - giong createCommissionLookup(). Ly do:
 * TikTok la tinh nang them, khong duoc phep lam bot khong khoi dong duoc; thieu no thi link TikTok
 * quay ve hanh vi cu (RetiredMerchantLinkError).
 */
function createTiktokProvider(): AffiliateProvider | null {
  if (!env.tiktok.enabled) return null;

  const missing: string[] = [];
  if (env.tiktok.apiKey === "") missing.push("RIOHUB_API_KEY");
  if (env.tiktok.creatorUsername === "") missing.push("RIOHUB_CREATOR_USERNAME");
  if (missing.length > 0) {
    console.warn(
      `[tiktok] TIKTOK_ENABLED=true nhung thieu ${missing.join(", ")} - tat TikTok. ` +
        "Lay API key tai riohub.vn/tiktok-shop-developer."
    );
    return null;
  }

  return new TiktokAffiliateProvider({
    client: new RiohubClient({
      apiKey: env.tiktok.apiKey,
      baseUrls: env.tiktok.baseUrls,
      timeoutMs: env.tiktok.timeoutMs,
    }),
    creatorUsername: env.tiktok.creatorUsername,
    channel: env.tiktok.linkChannel,
  });
}
```

Sửa `createAffiliateProvider()` để gom provider rồi quyết định có bọc composite không:

```ts
export function createAffiliateProvider(logStore: LogStore): AffiliateProvider {
  assertAffiliateProviderConfigured();

  if (env.affiliateProvider !== "shopee_direct") {
    return new MockAffiliateProvider();
  }

  const byMerchant = new Map<MerchantId, AffiliateProvider>();
  byMerchant.set(
    "shopee",
    new ShopeeAffiliateProvider({
      affiliateId: env.shopeeDirect.affiliateId,
      createShortLink: (targetUrl) => logStore.createShortLink(targetUrl),
      shortLinkBaseUrl: env.dashboard.baseUrl.replace(/\/$/, ""),
      commissionLookup: createCommissionLookup(),
    })
  );

  const tiktok = createTiktokProvider();
  if (tiktok) byMerchant.set("tiktokshop", tiktok);

  // Mot provider thi tra thang - do mot lop gian tiep cho truong hop pho bien nhat.
  const only = byMerchant.size === 1 ? [...byMerchant.values()][0] : null;
  return only ?? new CompositeAffiliateProvider(byMerchant);
}
```

- [ ] **Step 5: Chạy toàn bộ test**

Run: `npm test && npm run typecheck`
Expected: PASS toàn bộ — chưa bật cờ nên không instance nào đổi hành vi

- [ ] **Step 6: Commit**

```bash
git add src/core/providers/compositeProvider.ts src/core/providers/index.ts src/core/__tests__/compositeProvider.test.ts
git commit -m "feat(providers): dinh tuyen theo merchant, tu tat TikTok khi thieu cau hinh"
```

---

### Task 6: Bản đồ lỗi trong adapter + chống spam cảnh báo admin

**Files:**
- Create: `src/core/alertThrottle.ts`
- Modify: `src/adapters/zalo/bot.ts` (khối `catch` trong `processProductLinks`)
- Modify: `src/adapters/telegram/bot.ts` (khối `catch` tương ứng)
- Test: `src/core/__tests__/alertThrottle.test.ts`

**Interfaces:**
- Consumes: `ProviderUnavailableError` (Task 4), `LedgerStore.getTiktokProviderDownTemplate` (Task 3)
- Produces: `AlertThrottle` — `shouldSend(key: string, nowMs?: number): boolean`

- [ ] **Step 1: Viết test thất bại**

Tạo `src/core/__tests__/alertThrottle.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { AlertThrottle } from "../alertThrottle.js";

test("tin dau tien LUON duoc gui ngay", () => {
  const t = new AlertThrottle(15 * 60_000);
  assert.equal(t.shouldSend("server_error", 1_000), true);
});

test("trong cua so thi gop - su co 7 phut khong duoc sinh 20 tin giong nhau", () => {
  const t = new AlertThrottle(15 * 60_000);
  t.shouldSend("server_error", 0);
  assert.equal(t.shouldSend("server_error", 60_000), false);
  assert.equal(t.shouldSend("server_error", 14 * 60_000), false);
});

test("het cua so thi gui lai", () => {
  const t = new AlertThrottle(15 * 60_000);
  t.shouldSend("server_error", 0);
  assert.equal(t.shouldSend("server_error", 15 * 60_000), true);
});

test("ma loi KHAC nhau khong chan nhau", () => {
  const t = new AlertThrottle(15 * 60_000);
  t.shouldSend("server_error", 0);
  // Key sai la viec khac han backend sap - admin phai biet ngay.
  assert.equal(t.shouldSend("unauthorized", 1_000), true);
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npx tsx --test src/core/__tests__/alertThrottle.test.ts`
Expected: FAIL — module chưa tồn tại

- [ ] **Step 3: Viết `src/core/alertThrottle.ts`**

```ts
/**
 * Gop canh bao admin trong mot cua so thoi gian, theo tung key.
 *
 * Ly do ton tai: su co RioHub 09/10/2026 keo dai ~7 phut. Khong co lop nay thi 20 user gui link
 * trong luc do = 20 tin canh bao giong het nhau. Tin DAU TIEN luon gui ngay - gop khong duoc lam
 * cham thoi diem admin biet co su co.
 *
 * Trong bo nho, mat khi restart - chap nhan duoc: restart xong canh bao lai la dung, vi luc do
 * admin can biet su co van con.
 */
export class AlertThrottle {
  private readonly lastSentAt = new Map<string, number>();

  constructor(private readonly windowMs: number) {}

  shouldSend(key: string, nowMs: number = Date.now()): boolean {
    const last = this.lastSentAt.get(key);
    if (last !== undefined && nowMs - last < this.windowMs) return false;
    this.lastSentAt.set(key, nowMs);
    return true;
  }
}
```

- [ ] **Step 4: Nối vào adapter Zalo**

Trong `src/adapters/zalo/bot.ts`, khối `catch` của `processProductLinks` hiện log rồi dùng `err.userMessage`. Thêm **trước** bước lấy `userMessage`:

```ts
        // ProviderUnavailableError = phia nguon affiliate hong -> dung template admin sua duoc,
        // va BAO ADMIN (gop theo ma loi de khong spam). Cac loi khac (san pham chua bat hoa hong,
        // link khong phai trang san pham) la cau tra loi THAT ve san pham - khong bao admin.
        let userMessage =
          err instanceof AppError ? err.userMessage : "Đã có lỗi không xác định, vui lòng thử lại sau.";

        if (err instanceof ProviderUnavailableError) {
          userMessage = this.options.ledgerStore.getTiktokProviderDownTemplate(
            TIKTOK_PROVIDER_DOWN_TEMPLATE_DEFAULT
          );
          if (this.options.providerAlertThrottle.shouldSend(err.providerErrorCode)) {
            this.options.notifyAdmin?.(
              `⚠️ Nguồn affiliate TikTok lỗi (${err.providerErrorCode}): ${err.message}`
            ).catch(() => {});
          }
        }
```

Thêm `providerAlertThrottle: AlertThrottle` và `notifyAdmin?: (text: string) => Promise<void>` vào options của bot; `src/index.ts` truyền vào `new AlertThrottle(15 * 60_000)` và `notifyAdmin` đã có sẵn.

- [ ] **Step 5: Lặp lại y hệt cho `src/adapters/telegram/bot.ts`**

Cùng logic, cùng thứ tự: log chi tiết trước, rồi quyết định `userMessage`, rồi cảnh báo admin có throttle.

- [ ] **Step 6: Chạy test + commit**

```bash
npm test && npm run typecheck
git add src/core/alertThrottle.ts src/core/__tests__/alertThrottle.test.ts src/adapters/zalo/bot.ts src/adapters/telegram/bot.ts src/index.ts
git commit -m "feat(tiktok): bao bao tri qua template + canh bao admin gop theo ma loi"
```

---

### Task 7: Màu chip TikTok Shop trong `/admin/*`

**Files:**
- Modify: `src/api/adminHtml.ts` (hàm `merchantChipClass`)
- Test: `src/api/__tests__/merchantChip.test.ts` (tạo mới — `merchantChipClass` đã được export sẵn tại `src/api/adminHtml.ts:1764` nên import thẳng được)

**Interfaces:**
- Consumes: không có
- Produces: không có export mới

- [ ] **Step 1: Viết test thất bại**

```ts
test("chip TikTok Shop co mau rieng, khong roi ve trung tinh", () => {
  const cls = merchantChipClass("tiktokshop");
  assert.notEqual(cls, merchantChipClass("lazada"), "khong duoc dung chung mau voi san da ngung");
});

test("chip van goc vuong de khong lan voi pill trang thai bo tron", () => {
  assert.ok(!merchantChipClass("tiktokshop").includes("rounded-full"));
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npm test`
Expected: FAIL ở test mới

- [ ] **Step 3: Thêm nhánh màu**

Trong `merchantChipClass()`, thêm case `"tiktokshop"`. Chọn cặp màu **không trùng** 3 màu đã mang nghĩa trong khu `/admin`: cam (chờ xác nhận / lợi nhuận chủ bot), xanh lá (khả dụng), xanh dương (kênh Zalo). Dùng tông slate đậm/hồng đậm của TikTok, giữ `rounded` (góc vuông) chứ không `rounded-full`.

- [ ] **Step 4: Chạy test**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/adminHtml.ts src/api/__tests__/
git commit -m "feat(admin): mau chip TikTok Shop"
```

---

## Sau khi xong 7 task

Bật thật trên một instance: đặt `TIKTOK_ENABLED=true` + `RIOHUB_API_KEY` + `RIOHUB_CREATOR_USERNAME`, gửi một link TikTok vào bot, rồi **đặt một đơn thật qua chính link đó**. Việc này gỡ nốt rủi ro 7 (subId 4 đoạn chưa đi qua đơn thật) và sinh ra dữ liệu cho đường đối soát — xem mục 10 của spec.

**Deploy cần xin phép chủ bot trước** (kể cả `git push` vào `main`, vì Railway tự deploy).
