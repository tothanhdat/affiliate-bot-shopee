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
    assert.doesNotMatch(page, /Đồng bộ đơn TikTok/);
    assert.doesNotMatch(page, /tab=tiktok/, "khong co thanh tab khi TikTok tat - trang y het truoc day");
    // ?tab=tiktok khi TikTok tat: roi ve tab Shopee, khong the TikTok
    const forced = await (await fetch(`${t.baseUrl}/admin/record-orders?tab=tiktok`, { headers: { cookie } })).text();
    assert.match(forced, /Import báo cáo Shopee/);
    assert.doesNotMatch(forced, /Đồng bộ ngay/);
    const res = await fetch(`${t.baseUrl}/admin/record-orders/tiktok-sync`, { method: "POST", headers: { cookie } });
    assert.equal(res.status, 404);
  } finally {
    t.cleanup();
  }
});

test("co fetcher -> 2 tab Shopee/TikTok, moi tab chi hien noi dung cua san minh", async () => {
  const t = setup(async () => []);
  try {
    const cookie = await login(t.baseUrl);
    const get = async (q = "") => (await fetch(`${t.baseUrl}/admin/record-orders${q}`, { headers: { cookie } })).text();

    const shopee = await get();
    assert.match(shopee, /href="\/admin\/record-orders\?tab=tiktok"/, "co link sang tab TikTok");
    assert.match(shopee, /Import báo cáo Shopee/);
    assert.match(shopee, /Ghi 1 đơn lẻ/);
    assert.doesNotMatch(shopee, /Đồng bộ ngay/, "tab Shopee khong lan the TikTok");

    const tiktok = await get("?tab=tiktok");
    assert.match(tiktok, /action="\/admin\/record-orders\/tiktok-sync"/);
    assert.match(tiktok, /Đồng bộ ngay/);
    assert.doesNotMatch(tiktok, /Import báo cáo Shopee/, "tab TikTok khong lan form Shopee");
    assert.doesNotMatch(tiktok, /Ghi 1 đơn lẻ/);
    assert.doesNotMatch(tiktok, /Hỗ trợ CSV Shopee/);
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
    assert.match(html, /Đồng bộ ngay/, "loi hien tren TAB TikTok de admin bam lai duoc");
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
    // Trang loi cua Shopee render TAB SHOPEE (khong the TikTok) nhung van co thanh tab de sang TikTok.
    const html = await res.text();
    assert.match(html, /Import báo cáo Shopee/);
    assert.match(html, /tab=tiktok/);
    assert.doesNotMatch(html, /Đồng bộ ngay/);
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

test("lich su ghi nhan chia theo san: moi tab chi thay dong cua minh", async () => {
  const t = setup(async () => [order()]);
  try {
    const cookie = await login(t.baseUrl);
    t.ledgerStore.recordImportHistory({ actionType: "csv", newOrderIds: ["SHOPEE-CSV-1"], statusTransitions: [] });
    t.ledgerStore.recordImportHistory({ actionType: "single", newOrderIds: ["SHOPEE-LE-1"], statusTransitions: [] });
    await fetch(`${t.baseUrl}/admin/record-orders/tiktok-sync`, { method: "POST", headers: { cookie } });

    const shopee = await (await fetch(`${t.baseUrl}/admin/record-orders`, { headers: { cookie } })).text();
    assert.match(shopee, /SHOPEE-CSV-1/);
    assert.match(shopee, /SHOPEE-LE-1/);
    assert.doesNotMatch(shopee, /TT-1/, "don TikTok khong nam trong lich su tab Shopee");

    const tiktok = await (await fetch(`${t.baseUrl}/admin/record-orders?tab=tiktok`, { headers: { cookie } })).text();
    assert.match(tiktok, /TT-1/);
    assert.doesNotMatch(tiktok, /SHOPEE-CSV-1|SHOPEE-LE-1/, "don Shopee khong nam trong lich su tab TikTok");
  } finally {
    t.cleanup();
  }
});

test("NHAN ADMIN: bang admin ghi 'TikTok', khong ghi 'TikTok Shop' (ten day du danh cho user)", async () => {
  const t = setup(undefined);
  try {
    const cookie = await login(t.baseUrl);
    t.ledgerStore.recordConversion({
      subId: BOT_SUB,
      platform: "zalo",
      userId: "user-a",
      merchant: "tiktokshop",
      orderId: "TT-NHAN",
      orderAmount: 100_000,
      commissionAmount: 3000,
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
    });
    const orders = await (await fetch(`${t.baseUrl}/admin/orders`, { headers: { cookie } })).text();
    assert.match(orders, />TikTok</, "chip san o /admin/orders");
    assert.doesNotMatch(orders, />TikTok Shop</);

    const links = await (await fetch(`${t.baseUrl}/admin/links`, { headers: { cookie } })).text();
    assert.match(links, />TikTok</, "chip san o /admin/links");
    assert.doesNotMatch(links, />TikTok Shop</);
  } finally {
    t.cleanup();
  }
});

test("don TikTok DA TRA TIEN roi bi huy -> DM no hoan tra goi dung 'TikTok Shop', KHONG noi 'Shopee'", async () => {
  let orders: RiohubOrderRecord[] = [order()];
  const t = setup(async () => orders);
  try {
    const cookie = await login(t.baseUrl);
    const sync = () => fetch(`${t.baseUrl}/admin/record-orders/tiktok-sync`, { method: "POST", headers: { cookie } });
    await sync(); // don da giao -> Kha dung
    assert.equal(t.ledgerStore.getEntryByOrderId("tiktokshop", "TT-1")?.status, "confirmed");

    // user rut va admin DA tra tien -> entry 'paid'
    const w = t.ledgerStore.requestWithdrawal("zalo", "user-a", 1_000, {
      bankName: "Vietcombank",
      bankAccountNumber: "0123456789",
      bankAccountHolder: "Nguyen Van A",
    });
    t.ledgerStore.markWithdrawalPaid(w.id, null);
    assert.equal(t.ledgerStore.getEntryByOrderId("tiktokshop", "TT-1")?.status, "paid");

    // TikTok bao don bi huy/hoan SAU khi da tra tien
    orders = [order({ status: 3 })];
    await sync();
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(t.ledgerStore.getOutstandingDebtTotal("zalo", "user-a"), 2160);
    const debtDm = t.userMessages.find((m) => /thu lại/.test(m));
    assert.ok(debtDm, "user phai nhan DM no hoan tra");
    assert.match(debtDm!, /nên TikTok Shop thu lại 2\.160đ/);
    assert.doesNotMatch(debtDm!, /Shopee/);
  } finally {
    t.cleanup();
  }
});

