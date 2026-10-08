import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server.js";
import { AdminSessionStore } from "../../core/adminAuth.js";
import type { NotifyUser } from "../../core/notification.js";
import { LedgerStore } from "../../core/ledgerStore.js";
import { LogStore } from "../../core/logStore.js";
import { LinkResolverService } from "../../core/linkResolverService.js";
import { RateLimiter } from "../../core/rateLimiter.js";
import { MockAffiliateProvider } from "../../core/providers/mockProvider.js";

const THRESHOLD_VND = 50_000;
const BANK_INFO = { bankName: "Vietcombank", bankAccountNumber: "0123456789", bankAccountHolder: "Nguyen Van A" };

function setup() {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  const rateLimiter = new RateLimiter(1000, 60_000);
  const resolver = new LinkResolverService(new MockAffiliateProvider(), logStore, rateLimiter);
  const adminSessionStore = new AdminSessionStore("test-admin-password");

  const notifyCalls: string[] = [];
  const notifyAdmin = async (message: string): Promise<void> => {
    notifyCalls.push(message);
  };
  const notifyUserCalls: Array<{ platform: string; userId: string; message: string; hasImage: boolean }> = [];
  const notifyUser: NotifyUser = async (platform, userId, notification): Promise<void> => {
    notifyUserCalls.push({
      platform,
      userId,
      message: notification.text,
      hasImage: notification.image !== undefined,
    });
  };

  const withdrawalProofDir = mkdtempSync(join(tmpdir(), "withdrawal-proofs-"));
  const adminLoginRateLimiter = new RateLimiter(1000, 60_000);
  const app = createServer(
    resolver,
    logStore,
    ledgerStore,
    notifyAdmin,
    THRESHOLD_VND,
    adminSessionStore,
    {
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
    },
    withdrawalProofDir,
    adminLoginRateLimiter,
    "http://localhost:3002",
    notifyUser
  );
  const httpServer = app.listen(0);
  const port = (httpServer.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  function cleanup() {
    httpServer.close();
    rateLimiter.stop();
    adminLoginRateLimiter.stop();
    logStore.close();
    ledgerStore.close();
    rmSync(withdrawalProofDir, { recursive: true, force: true });
  }

  return { ledgerStore, logStore, baseUrl, notifyCalls, notifyUserCalls, withdrawalProofDir, cleanup };
}

test("GET /d/:token voi token khong ton tai -> 404", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const res = await fetch(`${baseUrl}/d/khong-ton-tai`);
    assert.equal(res.status, 404);
    const html = await res.text();
    assert.match(html, /không hợp lệ/i);
  } finally {
    cleanup();
  }
});

test("GET /d/:token hien ty le DA CHOT cua don, khong suy nguoc tu so tien", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    const { token } = ledgerStore.findOrCreateDashboardToken("telegram", "user-a");
    // Hoa hong nho: suy nguoc tu so tien da lam tron se ra sai (thue 10% cua 7d = 1d -> suy nguoc
    // thanh 14%; phi san 1% -> 0d -> suy nguoc thanh 0%; user nhan 80% cua 6d = 5d -> suy nguoc 83%).
    ledgerStore.recordConversion({
      subId: "telegram-user-a-abc-123",
      platform: "telegram",
      userId: "user-a",
      merchant: "shopee",
      orderId: "order-le",
      orderAmount: 1_000,
      commissionAmount: 7,
      taxPercent: 10,
      platformFeePercent: 1,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
    });

    const res = await fetch(`${baseUrl}/d/${token}`);
    const html = await res.text();
    assert.match(html, /Thuế 10%/);
    assert.match(html, /Phí sàn 1%/);
    assert.doesNotMatch(html, /Thuế 14%/);
    assert.doesNotMatch(html, /83%/);
    assert.match(html, /<div class="value">80%<\/div>/);
  } finally {
    cleanup();
  }
});

test("GET /d/:token duoi nguong -> khong co form rut tien", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    const { token } = ledgerStore.findOrCreateDashboardToken("telegram", "user-a");
    ledgerStore.recordConversion({
      subId: "telegram-user-a-abc-123",
      platform: "telegram",
      userId: "user-a",
      merchant: "shopee",
      orderId: "order-1",
      orderAmount: 100_000,
      commissionAmount: 10_000, // userShare = 8_000, duoi nguong 50_000
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
    });

    const res = await fetch(`${baseUrl}/d/${token}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.doesNotMatch(html, /Yêu cầu rút/);
  } finally {
    cleanup();
  }
});

test("GET /d/:token du nguong -> co form rut tien; POST thanh cong goi notifyAdmin va notifyUser dung 1 lan; POST lan 2 khi dang cho -> hien loi", async () => {
  const { ledgerStore, baseUrl, notifyCalls, notifyUserCalls, cleanup } = setup();
  try {
    const { token } = ledgerStore.findOrCreateDashboardToken("telegram", "user-a");
    ledgerStore.recordConversion({
      subId: "telegram-user-a-abc-123",
      platform: "telegram",
      userId: "user-a",
      merchant: "shopee",
      orderId: "order-1",
      orderAmount: 1_000_000,
      commissionAmount: 100_000, // userShare = 80_000, du nguong 50_000
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
    });

    const dashboardHtml = await (await fetch(`${baseUrl}/d/${token}`)).text();
    assert.match(dashboardHtml, /Yêu cầu rút/);

    const bankInfoBody = new URLSearchParams({
      bankName: "Vietcombank",
      bankAccountNumber: "0123456789",
      bankAccountHolder: "Nguyen Van A",
    });
    const firstPost = await fetch(`${baseUrl}/d/${token}/withdraw`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: bankInfoBody,
    });
    assert.equal(firstPost.status, 303);
    assert.equal(notifyCalls.length, 1);
    assert.match(notifyCalls[0], /telegram\/user-a/);
    assert.equal(notifyUserCalls.length, 1);
    assert.equal(notifyUserCalls[0].platform, "telegram");
    assert.equal(notifyUserCalls[0].userId, "user-a");
    assert.match(notifyUserCalls[0].message, /Đã ghi nhận yêu cầu rút/);

    const secondPost = await fetch(`${baseUrl}/d/${token}/withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: bankInfoBody,
    });
    assert.equal(secondPost.status, 422);
    const html = await secondPost.text();
    assert.match(html, /đang chờ xử lý/);
    assert.equal(notifyCalls.length, 1); // khong goi them lan 2
    assert.equal(notifyUserCalls.length, 1); // khong goi them lan 2
  } finally {
    cleanup();
  }
});

test("don da rut hien link xem anh bang chung; user khac khong xem duoc anh cua nguoi khac", async () => {
  const { ledgerStore, baseUrl, withdrawalProofDir, cleanup } = setup();
  try {
    const { token: tokenA } = ledgerStore.findOrCreateDashboardToken("telegram", "user-a");
    ledgerStore.recordConversion({
      subId: "telegram-user-a-abc-123",
      platform: "telegram",
      userId: "user-a",
      merchant: "shopee",
      orderId: "order-1",
      orderAmount: 1_000_000,
      commissionAmount: 100_000,
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
    });
    const withdrawal = ledgerStore.requestWithdrawal("telegram", "user-a", THRESHOLD_VND, BANK_INFO);
    writeFileSync(`${withdrawalProofDir}/proof-a.png`, "fake-image-bytes");
    ledgerStore.markWithdrawalPaid(withdrawal.id, "proof-a.png");

    const dashboardHtml = await (await fetch(`${baseUrl}/d/${tokenA}`)).text();
    assert.match(dashboardHtml, /Xem ảnh/);
    assert.match(dashboardHtml, new RegExp(`/d/${tokenA}/withdrawal-proofs/proof-a\\.png`));

    const proofRes = await fetch(`${baseUrl}/d/${tokenA}/withdrawal-proofs/proof-a.png`);
    assert.equal(proofRes.status, 200);

    // User khac (token khac) khong the xem anh cua user-a du biet dung ten file.
    const { token: tokenB } = ledgerStore.findOrCreateDashboardToken("telegram", "user-b");
    const crossUserRes = await fetch(`${baseUrl}/d/${tokenB}/withdrawal-proofs/proof-a.png`);
    assert.equal(crossUserRes.status, 404);
  } finally {
    cleanup();
  }
});

test("GET /s/:code redirect 302 THAT sang target_url (khong proxy noi dung) - T3.2", async () => {
  const { logStore, baseUrl, cleanup } = setup();
  try {
    const targetUrl =
      "https://s.shopee.vn/an_redir?origin_link=https%3A%2F%2Fshopee.vn%2Fproduct%2F123%2F456&affiliate_id=99900011122&sub_id=abc";
    const code = logStore.createShortLink(targetUrl);

    const res = await fetch(`${baseUrl}/s/${code}`, { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), targetUrl);
  } finally {
    cleanup();
  }
});

test("GET /s/:code voi code khong ton tai -> 404", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const res = await fetch(`${baseUrl}/s/khong-ton-tai`, { redirect: "manual" });
    assert.equal(res.status, 404);
  } finally {
    cleanup();
  }
});

test("GET /d/:token hien dung nguong rut tien MOI NHAT tu setting, khong phai gia tri tinh luc khoi tao server", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    ledgerStore.setSetting("withdrawal_threshold_vnd", "123456");
    const { token } = ledgerStore.findOrCreateDashboardToken("telegram", "user-threshold-test");
    const res = await fetch(`${baseUrl}/d/${token}`);
    const html = await res.text();
    assert.match(html, /123\.456/);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Mo hinh no 2026-10-08 (yeu cau truc tiep cua user): no chi bi tru LUC yeu cau
// rut duoc duyet. W > no -> cho admin duyet, chuyen W - no. W <= no -> tu dong
// xac nhan, khong co dong nao chuyen.
// ---------------------------------------------------------------------------

function seedOrderAndDebt(ledgerStore: LedgerStore, userShareVnd: number, debtVnd: number) {
  ledgerStore.recordConversion({
    subId: "telegram-user-a-abc-123",
    platform: "telegram",
    userId: "user-a",
    merchant: "shopee",
    orderId: "order-moi",
    orderAmount: 1_000_000,
    commissionAmount: userShareVnd,
    taxPercent: 0,
    platformFeePercent: 0,
    userSharePercent: 100,
    maxCommissionRatioPercent: 1000,
    holdConfig: { thresholdVnd: 0, holdDays: 0 },
  });
  ledgerStore.recordPayoutDebt({
    platform: "telegram",
    userId: "user-a",
    merchant: "shopee",
    orderId: "C2-PAID",
    amount: debtVnd,
  });
}

const BANK_BODY = () =>
  new URLSearchParams({ bankName: "Vietcombank", bankAccountNumber: "0123456789", bankAccountHolder: "Nguyen Van A" });

test("rut khi W > no: bao admin du 3 so, DM user noi so chuyen khoan that", async () => {
  const { ledgerStore, baseUrl, notifyCalls, notifyUserCalls, cleanup } = setup();
  try {
    const { token } = ledgerStore.findOrCreateDashboardToken("telegram", "user-a");
    seedOrderAndDebt(ledgerStore, 100_000, 40_000);

    const res = await fetch(`${baseUrl}/d/${token}/withdraw`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: BANK_BODY(),
    });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), `/d/${token}`);
    assert.equal(notifyCalls.length, 1);
    assert.match(notifyCalls[0], /rút 100\.000đ, trừ nợ 40\.000đ, cần chuyển 60\.000đ/);
    assert.match(notifyUserCalls[0].message, /yêu cầu rút 100\.000đ/);
    assert.match(notifyUserCalls[0].message, /trừ 40\.000đ nợ hoàn trả, số tiền chuyển khoản cho bạn là 60\.000đ/);
    // No CHUA bi tru cho toi luc admin duyet.
    assert.equal(ledgerStore.getOutstandingDebtTotal("telegram", "user-a"), 40_000);
  } finally {
    cleanup();
  }
});

test("rut khi Kha dung < no: tu choi 422, khong tao yeu cau, khong bao ai, no giu nguyen", async () => {
  const { ledgerStore, baseUrl, notifyCalls, notifyUserCalls, cleanup } = setup();
  try {
    const { token } = ledgerStore.findOrCreateDashboardToken("telegram", "user-a");
    seedOrderAndDebt(ledgerStore, 60_000, 85_536);

    const res = await fetch(`${baseUrl}/d/${token}/withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: BANK_BODY(),
    });
    assert.equal(res.status, 422);
    const html = (await res.text()).replace(/<[^>]+>/g, "");
    assert.match(html, /Tích luỹ thêm 25\.536đ nữa để đủ điều kiện rút tiền\./);
    assert.equal(notifyCalls.length, 0);
    assert.equal(notifyUserCalls.length, 0);
    assert.equal(ledgerStore.listPendingWithdrawals().length, 0);
    assert.equal(ledgerStore.getOutstandingDebtTotal("telegram", "user-a"), 85_536);
  } finally {
    cleanup();
  }
});

test("rut khi Kha dung DUNG BANG no: tu dong xac nhan, KHONG bao admin, DM noi khong co tien chuyen", async () => {
  const { ledgerStore, baseUrl, notifyCalls, notifyUserCalls, cleanup } = setup();
  try {
    const { token } = ledgerStore.findOrCreateDashboardToken("telegram", "user-a");
    seedOrderAndDebt(ledgerStore, 60_000, 60_000);

    const res = await fetch(`${baseUrl}/d/${token}/withdraw`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: BANK_BODY(),
    });
    assert.equal(res.status, 303);
    const location = res.headers.get("location")!;
    assert.match(location, new RegExp(`^/d/${token}\\?tru-no=`));
    assert.equal(notifyCalls.length, 0, "khong co viec gi cho admin lam");
    assert.equal(ledgerStore.listPendingWithdrawals().length, 0);
    assert.equal(ledgerStore.getOutstandingDebtTotal("telegram", "user-a"), 0);
    assert.match(notifyUserCalls[0].message, /trừ nợ hoàn trả, nên lần này không có tiền chuyển khoản/);
    assert.match(notifyUserCalls[0].message, /trả hết nợ/);

    const html = (await (await fetch(`${baseUrl}${location}`)).text()).replace(/<[^>]+>/g, "");
    assert.match(html, /Đã dùng 60\.000đ số dư khả dụng để trừ nợ hoàn trả/);
    assert.match(html, /Bạn đã trả hết nợ/);
  } finally {
    cleanup();
  }
});

test("?tru-no=<id> cua user KHAC khong hien thong bao tren dashboard cua minh", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    seedOrderAndDebt(ledgerStore, 60_000, 60_000);
    const w = ledgerStore.requestWithdrawal("telegram", "user-a", THRESHOLD_VND, BANK_INFO);
    assert.equal(w.status, "paid");
    const { token: tokenB } = ledgerStore.findOrCreateDashboardToken("telegram", "user-b");
    const html = await (await fetch(`${baseUrl}/d/${tokenB}?tru-no=${w.id}`)).text();
    assert.doesNotMatch(html, /Đã dùng/);
  } finally {
    cleanup();
  }
});
