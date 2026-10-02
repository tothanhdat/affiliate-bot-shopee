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
import {
  ADMIN_UI_COOKIE,
  adminUiSwitcherHtml,
  parseAdminUiVersion,
  resolveAdminUiVersion,
  safeAdminBackPath,
} from "../adminUiVersion.js";

const ADMIN_PASSWORD = "test-admin-password";
const ORDER_CONFIG = { taxPercent: 0, platformFeePercent: 0, userSharePercent: 80, maxCommissionRatioPercent: 1000 };

function setup() {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  const rateLimiter = new RateLimiter(1000, 60_000);
  const adminLoginRateLimiter = new RateLimiter(1000, 60_000);
  const resolver = new LinkResolverService(new MockAffiliateProvider(), logStore, rateLimiter);
  const adminSessionStore = new AdminSessionStore(ADMIN_PASSWORD);
  const withdrawalProofDir = mkdtempSync(join(tmpdir(), "withdrawal-proofs-"));

  const app = createServer(
    resolver,
    logStore,
    ledgerStore,
    async () => {},
    50_000,
    adminSessionStore,
    ORDER_CONFIG,
    withdrawalProofDir,
    adminLoginRateLimiter,
    "http://localhost:3002",
    async () => {},
    async () => {}
  );
  const httpServer = app.listen(0);
  const port = (httpServer.address() as AddressInfo).port;

  return {
    ledgerStore,
    baseUrl: `http://127.0.0.1:${port}`,
    cleanup() {
      httpServer.closeAllConnections();
      httpServer.close();
      rateLimiter.stop();
      adminLoginRateLimiter.stop();
      logStore.close();
      ledgerStore.close();
      rmSync(withdrawalProofDir, { recursive: true, force: true });
    },
  };
}

async function loginAndGetCookie(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `password=${encodeURIComponent(ADMIN_PASSWORD)}`,
    redirect: "manual",
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

// ---------------------------------------------------------------------------
// resolveAdminUiVersion: GIAO DIEN CU LA MAC DINH
// ---------------------------------------------------------------------------

test("resolveAdminUiVersion: khong co cookie -> v1 (giao dien cu la mac dinh)", () => {
  assert.equal(resolveAdminUiVersion({}), "v1");
});

test("resolveAdminUiVersion: cookie v2 -> v2", () => {
  assert.equal(resolveAdminUiVersion({ [ADMIN_UI_COOKIE]: "v2" }), "v2");
});

test("resolveAdminUiVersion: gia tri rac -> lui ve v1, khong throw", () => {
  assert.equal(resolveAdminUiVersion({ [ADMIN_UI_COOKIE]: "v99" }), "v1");
  assert.equal(resolveAdminUiVersion({ [ADMIN_UI_COOKIE]: "" }), "v1");
  assert.equal(resolveAdminUiVersion({ [ADMIN_UI_COOKIE]: "V2" }), "v1");
});

test("parseAdminUiVersion: chi nhan dung 2 gia tri, con lai null", () => {
  assert.equal(parseAdminUiVersion("v1"), "v1");
  assert.equal(parseAdminUiVersion("v2"), "v2");
  assert.equal(parseAdminUiVersion("v3"), null);
  assert.equal(parseAdminUiVersion(undefined), null);
  assert.equal(parseAdminUiVersion(2), null);
});

// ---------------------------------------------------------------------------
// safeAdminBackPath: chong open-redirect
// ---------------------------------------------------------------------------

test("safeAdminBackPath: giu nguyen path /admin KEM query (khong duoc mat bo loc)", () => {
  assert.equal(safeAdminBackPath("/admin/orders?status=pending&page=2"), "/admin/orders?status=pending&page=2");
  assert.equal(safeAdminBackPath("/admin"), "/admin");
});

test("safeAdminBackPath: tu choi URL tuyet doi ra ngoai site", () => {
  assert.equal(safeAdminBackPath("https://evil.com/x"), "/admin/dashboard");
  assert.equal(safeAdminBackPath("http://evil.com"), "/admin/dashboard");
});

test("safeAdminBackPath: tu choi protocol-relative //evil.com", () => {
  assert.equal(safeAdminBackPath("//evil.com/admin/orders"), "/admin/dashboard");
});

test("safeAdminBackPath: tu choi dau backslash (vai trinh duyet coi la dau /)", () => {
  assert.equal(safeAdminBackPath("/admin\\@evil.com"), "/admin/dashboard");
});

test("safeAdminBackPath: tu choi ky tu xuong dong (chong header injection)", () => {
  assert.equal(safeAdminBackPath("/admin/orders\nLocation: https://evil.com"), "/admin/dashboard");
  assert.equal(safeAdminBackPath("/admin/orders\r\nSet-Cookie: a=b"), "/admin/dashboard");
});

test("safeAdminBackPath: tu choi path khong thuoc khu /admin", () => {
  assert.equal(safeAdminBackPath("/so-tay"), "/admin/dashboard");
  assert.equal(safeAdminBackPath("/adminfoo"), "/admin/dashboard");
  assert.equal(safeAdminBackPath(""), "/admin/dashboard");
  assert.equal(safeAdminBackPath(undefined), "/admin/dashboard");
});

test("safeAdminBackPath: tu choi chinh route doi giao dien (tranh redirect vong)", () => {
  assert.equal(safeAdminBackPath("/admin/ui/v1"), "/admin/dashboard");
});

// ---------------------------------------------------------------------------
// Widget: escape va danh dau ban dang xem
// ---------------------------------------------------------------------------

test("adminUiSwitcherHtml: danh dau ban dang xem bang aria-current", () => {
  const v1 = adminUiSwitcherHtml("v1", "/admin/orders");
  assert.match(v1, /\/admin\/ui\/v2\?back=/);
  assert.match(v1, /aria-current="true"[^>]*>Cũ</);
  assert.doesNotMatch(v1, /aria-current="true"[^>]*>Mới</);

  const v2 = adminUiSwitcherHtml("v2", "/admin/orders");
  assert.match(v2, /aria-current="true"[^>]*>Mới</);
});

test("adminUiSwitcherHtml: back path duoc encode, khong vo duoc thuoc tinh href", () => {
  const html = adminUiSwitcherHtml("v1", '/admin/orders?q="><script>alert(1)</script>');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /back=%2Fadmin%2Forders/);
});

// ---------------------------------------------------------------------------
// Route /admin/ui/:version
// ---------------------------------------------------------------------------

test("GET /admin/ui/v2: set cookie roi quay lai dung trang cu kem bo loc", async () => {
  const { baseUrl, cleanup } = setup();
  const cookie = await loginAndGetCookie(baseUrl);

  const res = await fetch(`${baseUrl}/admin/ui/v2?back=${encodeURIComponent("/admin/orders?status=pending")}`, {
    headers: { cookie },
    redirect: "manual",
  });

  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/admin/orders?status=pending");
  assert.match(res.headers.get("set-cookie") ?? "", new RegExp(`${ADMIN_UI_COOKIE}=v2`));
  cleanup();
});

test("GET /admin/ui/<rac>: 404, khong set cookie", async () => {
  const { baseUrl, cleanup } = setup();
  const cookie = await loginAndGetCookie(baseUrl);

  const res = await fetch(`${baseUrl}/admin/ui/v99`, { headers: { cookie }, redirect: "manual" });

  assert.equal(res.status, 404);
  assert.equal(res.headers.get("set-cookie"), null);
  cleanup();
});

test("GET /admin/ui/v2: chua dang nhap -> ve trang login", async () => {
  const { baseUrl, cleanup } = setup();
  const res = await fetch(`${baseUrl}/admin/ui/v2`, { redirect: "manual" });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/admin/login");
  cleanup();
});

test("GET /admin/ui/v2?back=<ngoai site>: van redirect NOI BO, khong ra ngoai", async () => {
  const { baseUrl, cleanup } = setup();
  const cookie = await loginAndGetCookie(baseUrl);

  const res = await fetch(`${baseUrl}/admin/ui/v2?back=${encodeURIComponent("https://evil.com")}`, {
    headers: { cookie },
    redirect: "manual",
  });

  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/admin/dashboard");
  cleanup();
});

// ---------------------------------------------------------------------------
// Widget duoc chen vao moi trang /admin
// ---------------------------------------------------------------------------

test("Trang /admin co nut chuyen giao dien, va no tro ve DUNG trang dang xem", async () => {
  const { baseUrl, cleanup } = setup();
  const cookie = await loginAndGetCookie(baseUrl);

  const res = await fetch(`${baseUrl}/admin/orders?status=pending`, { headers: { cookie } });
  const html = await res.text();

  assert.equal(res.status, 200);
  assert.match(html, /admin-ui-switch/);
  assert.match(html, new RegExp(`/admin/ui/v2\\?back=${encodeURIComponent("/admin/orders?status=pending").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  cleanup();
});

// Middleware chen widget chay cho MOI response duoi /admin. Response khong phai trang HTML phai
// di qua nguyen ven - chen vao giua mot file JSON/text la lam hong no.
test("Widget khong chen vao response duoi /admin ma KHONG phai trang HTML", async () => {
  const { baseUrl, cleanup } = setup();
  const cookie = await loginAndGetCookie(baseUrl);

  const res = await fetch(`${baseUrl}/admin/ui/v99`, { headers: { cookie }, redirect: "manual" });
  const body = await res.text();

  assert.equal(res.status, 404);
  assert.equal(body, "Khong co giao dien nay.");
  assert.doesNotMatch(body, /admin-ui-switch/);
  cleanup();
});

// ---------------------------------------------------------------------------
// Bat v2 khong duoc lam vo trang nao (ban dau v2 = v1)
// ---------------------------------------------------------------------------

const ADMIN_PAGES = [
  "/admin/dashboard",
  "/admin/withdrawals",
  "/admin/users",
  "/admin/orders",
  "/admin/record-orders",
  "/admin/settings",
];

for (const path of ADMIN_PAGES) {
  test(`GET ${path}: render duoc o CA HAI giao dien`, async () => {
    const { baseUrl, cleanup } = setup();
    const authCookie = await loginAndGetCookie(baseUrl);

    const v1 = await fetch(`${baseUrl}${path}`, { headers: { cookie: authCookie } });
    assert.equal(v1.status, 200, `${path} v1`);

    const v2 = await fetch(`${baseUrl}${path}`, {
      headers: { cookie: `${authCookie}; ${ADMIN_UI_COOKIE}=v2` },
    });
    assert.equal(v2.status, 200, `${path} v2`);

    cleanup();
  });
}
