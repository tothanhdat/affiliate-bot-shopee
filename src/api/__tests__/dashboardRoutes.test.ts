import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server.js";
import { AdminSessionStore } from "../../core/adminAuth.js";
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
    },
    withdrawalProofDir,
    adminLoginRateLimiter,
    "http://localhost:3002",
    async (): Promise<void> => {}
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

  return { ledgerStore, logStore, baseUrl, notifyCalls, withdrawalProofDir, cleanup };
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
    });

    const res = await fetch(`${baseUrl}/d/${token}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.doesNotMatch(html, /Yêu cầu rút/);
  } finally {
    cleanup();
  }
});

test("GET /d/:token du nguong -> co form rut tien; POST thanh cong goi notifyAdmin dung 1 lan; POST lan 2 khi dang cho -> hien loi", async () => {
  const { ledgerStore, baseUrl, notifyCalls, cleanup } = setup();
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

    const secondPost = await fetch(`${baseUrl}/d/${token}/withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: bankInfoBody,
    });
    assert.equal(secondPost.status, 422);
    const html = await secondPost.text();
    assert.match(html, /đang chờ xử lý/);
    assert.equal(notifyCalls.length, 1); // khong goi them lan 2
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
