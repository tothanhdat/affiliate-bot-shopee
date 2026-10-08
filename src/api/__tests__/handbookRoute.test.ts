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
import { SETTINGS_KEYS } from "../../core/settingsKeys.js";

/**
 * Route /so-tay - trang So tay hoan tien cong khai (thay ban Google Docs cu, 2026-09-28).
 * Hai dieu duoc chot o day: trang KHONG doi dang nhap (bot gui link tran vao group, user chua tung
 * dang nhap cai gi), va cac con so tren trang doc LIVE tu settings chu khong phai tu .env luc khoi
 * dong - admin doi % o /admin/settings la trang doi ngay, khong can restart.
 */

const ENV_THRESHOLD_VND = 50_000;
const ENV_USER_SHARE_PERCENT = 80;

function setup() {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  const rateLimiter = new RateLimiter(1000, 60_000);
  const resolver = new LinkResolverService(new MockAffiliateProvider(), logStore, rateLimiter);
  const adminSessionStore = new AdminSessionStore("test-admin-password");
  const withdrawalProofDir = mkdtempSync(join(tmpdir(), "withdrawal-proofs-"));
  const adminLoginRateLimiter = new RateLimiter(1000, 60_000);

  const app = createServer(
    resolver,
    logStore,
    ledgerStore,
    async () => {},
    ENV_THRESHOLD_VND,
    adminSessionStore,
    {
      taxPercent: 10,
      platformFeePercent: 1,
      userSharePercent: ENV_USER_SHARE_PERCENT,
      maxCommissionRatioPercent: 1000,
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
    },
    withdrawalProofDir,
    adminLoginRateLimiter,
    "http://localhost:3002",
    async () => {}
  );
  const httpServer = app.listen(0);
  const port = (httpServer.address() as AddressInfo).port;

  function cleanup() {
    httpServer.close();
    rateLimiter.stop();
    adminLoginRateLimiter.stop();
    logStore.close();
    ledgerStore.close();
    rmSync(withdrawalProofDir, { recursive: true, force: true });
  }

  return { ledgerStore, baseUrl: `http://127.0.0.1:${port}`, cleanup };
}

test("GET /so-tay: xem duoc ma KHONG can dang nhap", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const res = await fetch(`${baseUrl}/so-tay`);

    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    const html = await res.text();
    assert.match(html, /Sổ tay hoàn tiền/);
  } finally {
    cleanup();
  }
});

test("GET /so-tay: chua co override thi dung gia tri tu env", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const html = await (await fetch(`${baseUrl}/so-tay`)).text();

    assert.match(html, new RegExp(`${ENV_USER_SHARE_PERCENT}%`));
    assert.ok(html.includes("50.000đ"), "phai dung nguong rut lay tu env");
  } finally {
    cleanup();
  }
});

test("GET /so-tay: % hoa hong doi o /admin/settings thi trang doi theo ngay, khong can restart", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    ledgerStore.setSetting(SETTINGS_KEYS.userSharePercent, "65");

    const html = await (await fetch(`${baseUrl}/so-tay`)).text();

    assert.match(html, /65%/, "phai lay % tu settings");
    assert.match(html, /35%/, "phan chu bot phai tinh lai theo");
    assert.ok(!html.includes(`${ENV_USER_SHARE_PERCENT}%`), "khong duoc con dung gia tri cu cua env");
  } finally {
    cleanup();
  }
});

test("GET /so-tay: nguong rut tien doi o /admin/settings thi trang doi theo", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    ledgerStore.setSetting(SETTINGS_KEYS.withdrawalThresholdVnd, "120000");

    const html = await (await fetch(`${baseUrl}/so-tay`)).text();

    assert.ok(html.includes("120.000đ"), "phai lay nguong rut tu settings");
    assert.ok(!html.includes("50.000đ"), "khong duoc con dung nguong cu cua env");
  } finally {
    cleanup();
  }
});
