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
