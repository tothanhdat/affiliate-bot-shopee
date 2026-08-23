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

const THRESHOLD_VND = 50_000;
const BANK_INFO = { bankName: "Vietcombank", bankAccountNumber: "0123456789", bankAccountHolder: "Nguyen Van A" };
const ADMIN_PASSWORD = "test-admin-password";
const ORDER_CONFIG = { taxPercent: 0, platformFeePercent: 0, userSharePercent: 80, maxCommissionRatioPercent: 1000 };

// Mac dinh rong rai de cac test dang nhap nhieu lan (nhieu it() lien tiep) khong vo tinh dinh
// rate limit login - test rieng ve rate limit tu tao 1 RateLimiter gioi han thap cua rieng no.
function setup(adminLoginRateLimiter = new RateLimiter(1000, 60_000)) {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  const rateLimiter = new RateLimiter(1000, 60_000);
  const resolver = new LinkResolverService(new MockAffiliateProvider(), logStore, rateLimiter);
  const adminSessionStore = new AdminSessionStore(ADMIN_PASSWORD);
  const withdrawalProofDir = mkdtempSync(join(tmpdir(), "withdrawal-proofs-"));

  const notifyAdmin = async (): Promise<void> => {};
  const notifyUserCalls: Array<{ platform: string; userId: string; message: string }> = [];
  const notifyUser = async (platform: string, userId: string, message: string): Promise<void> => {
    notifyUserCalls.push({ platform, userId, message });
  };

  const app = createServer(
    resolver,
    logStore,
    ledgerStore,
    notifyAdmin,
    THRESHOLD_VND,
    adminSessionStore,
    ORDER_CONFIG,
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

  return { logStore, ledgerStore, baseUrl, withdrawalProofDir, notifyUserCalls, cleanup };
}

/** FormData multipart 1 anh "chuyen khoan" gia lap, dung chung cho cac test mark-paid. */
function fakeProofFormData(filename = "proof.png"): FormData {
  const formData = new FormData();
  formData.append("proofImage", new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }), filename);
  return formData;
}

/** Gia lap 1 request thanh cong da qua bot - can co truoc de recordOrderFromAccesstrade tra duoc subId. */
function seedRequestLog(logStore: LogStore, subId: string, overrides: Partial<{ platform: "telegram" | "zalo"; userId: string }> = {}) {
  logStore.record({
    platform: overrides.platform ?? "telegram",
    merchant: "shopee",
    userId: overrides.userId ?? "user-a",
    originalUrl: "https://shopee.vn/san-pham-i.123.456",
    subId,
    outcome: "success",
    errorCode: null,
    affiliateUrl: "https://s.shopee.vn/abc",
  });
}

/** Login qua HTTP that (khong goi thang AdminSessionStore.login) de test dung ca cookie set boi route. */
async function loginAndGetCookie(baseUrl: string, password = ADMIN_PASSWORD): Promise<string | null> {
  const res = await fetch(`${baseUrl}/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `password=${encodeURIComponent(password)}`,
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return null;
  return setCookie.split(";")[0];
}

test("chua login -> moi route /admin/* (tru /admin/login) redirect ve /admin/login", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    for (const path of ["/admin", "/admin/withdrawals", "/admin/users", "/admin/orders"]) {
      const res = await fetch(`${baseUrl}${path}`, { redirect: "manual" });
      assert.equal(res.status, 303, `path=${path}`);
      assert.equal(res.headers.get("location"), "/admin/login", `path=${path}`);
    }
  } finally {
    cleanup();
  }
});

test("login sai mat khau -> 401 kem loi, khong tao duoc session hop le", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const res = await fetch(`${baseUrl}/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=sai-mat-khau",
      redirect: "manual",
    });
    assert.equal(res.status, 401);
    const html = await res.text();
    assert.match(html, /Sai mật khẩu/);

    const cookie = await loginAndGetCookie(baseUrl, "sai-mat-khau");
    assert.equal(cookie, null);
  } finally {
    cleanup();
  }
});

test("POST /admin/login bi chan sau qua so lan thu cho phep (rui ro so 1 - brute-force)", async () => {
  // Gioi han thap (2 lan) rieng cho test nay, khong dung limiter mac dinh 1000 cua setup().
  const { baseUrl, cleanup } = setup(new RateLimiter(2, 60_000));
  try {
    for (let i = 0; i < 2; i++) {
      const res = await fetch(`${baseUrl}/admin/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "password=sai-mat-khau",
        redirect: "manual",
      });
      assert.equal(res.status, 401, `lan thu ${i + 1} phai la 401 (sai mat khau, chua bi chan)`);
    }

    // Lan thu thu 3 (vuot qua gioi han 2) - bi chan du go DUNG mat khau.
    const blockedRes = await fetch(`${baseUrl}/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `password=${encodeURIComponent(ADMIN_PASSWORD)}`,
      redirect: "manual",
    });
    assert.equal(blockedRes.status, 429);
    const html = await blockedRes.text();
    assert.match(html, /Thử sai quá nhiều lần/);
    assert.equal(blockedRes.headers.get("set-cookie"), null, "khong duoc tao session du go dung mat khau luc bi chan");
  } finally {
    cleanup();
  }
});

test("login dung -> vao duoc /admin/withdrawals; dang xuat -> quay lai yeu cau login", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const cookie = await loginAndGetCookie(baseUrl);
    assert.ok(cookie);

    const withdrawalsRes = await fetch(`${baseUrl}/admin/withdrawals`, { headers: { cookie: cookie! } });
    assert.equal(withdrawalsRes.status, 200);
    const html = await withdrawalsRes.text();
    assert.match(html, /Yêu cầu rút tiền/);

    const logoutRes = await fetch(`${baseUrl}/admin/logout`, {
      method: "POST",
      headers: { cookie: cookie! },
      redirect: "manual",
    });
    assert.equal(logoutRes.status, 303);
    assert.equal(logoutRes.headers.get("location"), "/admin/login");

    const afterLogout = await fetch(`${baseUrl}/admin/withdrawals`, {
      headers: { cookie: cookie! },
      redirect: "manual",
    });
    assert.equal(afterLogout.status, 303);
  } finally {
    cleanup();
  }
});

test("POST /admin/withdrawals/:id/mark-paid (kem anh) chuyen dung trang thai, luu duoc bang chung", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
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

    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/withdrawals/${withdrawal.id}/mark-paid`, {
      method: "POST",
      headers: { cookie: cookie! },
      body: fakeProofFormData(),
      redirect: "manual",
    });
    assert.equal(res.status, 303);

    const pending = ledgerStore.getPendingWithdrawal("telegram", "user-a");
    assert.equal(pending, null);
    const [paid] = ledgerStore.listPaidWithdrawals();
    assert.ok(paid.proofImagePath, "phai luu duoc ten file anh bang chung");

    const proofRes = await fetch(
      `${baseUrl}/admin/withdrawal-proofs/${encodeURIComponent(paid.proofImagePath!)}`,
      { headers: { cookie: cookie! } }
    );
    assert.equal(proofRes.status, 200);
  } finally {
    cleanup();
  }
});

test("POST /admin/withdrawals/:id/mark-paid khong dinh kem anh -> 422, khong chuyen trang thai", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
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

    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/withdrawals/${withdrawal.id}/mark-paid`, {
      method: "POST",
      headers: { cookie: cookie! },
      body: new FormData(),
      redirect: "manual",
    });
    assert.equal(res.status, 422);
    const html = await res.text();
    assert.match(html, /Cần đính kèm ảnh/);

    const pending = ledgerStore.getPendingWithdrawal("telegram", "user-a");
    assert.equal(pending?.status, "requested");
  } finally {
    cleanup();
  }
});

test("/admin/users tinh dung tong theo user", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    ledgerStore.recordConversion({
      subId: "telegram-user-a-1",
      platform: "telegram",
      userId: "user-a",
      merchant: "shopee",
      orderId: "order-1",
      orderAmount: 500_000,
      commissionAmount: 50_000, // userShare = 40_000
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
    });
    ledgerStore.recordConversion({
      subId: "telegram-user-a-2",
      platform: "telegram",
      userId: "user-a",
      merchant: "shopee",
      orderId: "order-2",
      orderAmount: 500_000,
      commissionAmount: 50_000, // userShare = 40_000
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
    });
    ledgerStore.upsertUserProfile("telegram", "user-a", "Nguyễn Văn A");

    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/users`, { headers: { cookie: cookie! } });
    const html = await res.text();
    assert.match(html, /<td>telegram<\/td>/);
    assert.match(html, /<td>user-a<\/td>/);
    assert.match(html, /Nguyễn Văn A/);
    assert.match(html, /80\.000đ/); // tong available = 40_000 + 40_000
  } finally {
    cleanup();
  }
});

test("/admin/orders loc dung theo status va merchant", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    ledgerStore.recordConversion({
      subId: "telegram-user-a-1",
      platform: "telegram",
      userId: "user-a",
      merchant: "shopee",
      orderId: "shopee-order",
      orderAmount: 500_000,
      commissionAmount: 50_000,
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
    });
    ledgerStore.recordConversion({
      subId: "telegram-user-b-1",
      platform: "telegram",
      userId: "user-b",
      merchant: "lazada",
      orderId: "lazada-order",
      orderAmount: 500_000,
      commissionAmount: 50_000,
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
    });

    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/orders?merchant=shopee`, { headers: { cookie: cookie! } });
    const html = await res.text();
    assert.match(html, /shopee-order/);
    assert.doesNotMatch(html, /lazada-order/);
  } finally {
    cleanup();
  }
});

test("huy don (reverse) thanh cong voi don dang 'pending' (Cho xac nhan)", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    const entry = ledgerStore.recordConversion({
      subId: "telegram-user-a-1",
      platform: "telegram",
      userId: "user-a",
      merchant: "shopee",
      orderId: "order-1",
      orderAmount: 500_000,
      commissionAmount: 50_000,
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
      status: "pending",
    });

    const cookie = await loginAndGetCookie(baseUrl);
    const ordersHtml = await (await fetch(`${baseUrl}/admin/orders`, { headers: { cookie: cookie! } })).text();
    assert.match(ordersHtml, /Huỷ đơn/);

    const res = await fetch(`${baseUrl}/admin/orders/${entry.id}/reverse`, {
      method: "POST",
      headers: { cookie: cookie!, "content-type": "application/x-www-form-urlencoded" },
      body: "reason=don+bi+hoan+hang",
      redirect: "manual",
    });
    assert.equal(res.status, 303);
    assert.equal(ledgerStore.getEntryById(entry.id)?.status, "reversed");
  } finally {
    cleanup();
  }
});

// 2026-08-20 (quyet dinh chot lai voi user): "Kha dung" (confirmed) la trang thai CUOI CUNG, khong
// con huy duoc nua - khac gi co gan vao yeu cau rut tien hay chua.
test("khong the huy don da 'confirmed' (Kha dung) - an link, chan ca GET confirm va POST, du chua gan withdrawal", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    const entry = ledgerStore.recordConversion({
      subId: "telegram-user-a-1",
      platform: "telegram",
      userId: "user-a",
      merchant: "shopee",
      orderId: "order-1",
      orderAmount: 500_000,
      commissionAmount: 100_000, // userShare = 80_000, du nguong rut
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
    });
    ledgerStore.requestWithdrawal("telegram", "user-a", THRESHOLD_VND, BANK_INFO);

    const cookie = await loginAndGetCookie(baseUrl);

    const ordersHtml = await (await fetch(`${baseUrl}/admin/orders`, { headers: { cookie: cookie! } })).text();
    assert.doesNotMatch(ordersHtml, /Huỷ đơn/);

    const confirmRes = await fetch(`${baseUrl}/admin/orders/${entry.id}/reverse`, { headers: { cookie: cookie! } });
    const confirmHtml = await confirmRes.text();
    assert.match(confirmHtml, /Chỉ huỷ được đơn đang ở trạng thái/);
    assert.doesNotMatch(confirmHtml, /<textarea/);

    const postRes = await fetch(`${baseUrl}/admin/orders/${entry.id}/reverse`, {
      method: "POST",
      headers: { cookie: cookie!, "content-type": "application/x-www-form-urlencoded" },
      body: "reason=co+tinh+bo+qua+UI",
      redirect: "manual",
    });
    assert.equal(postRes.status, 422);
    assert.equal(ledgerStore.getAvailableBalance("telegram", "user-a"), 0); // van bi giu boi withdrawal, khong doi
  } finally {
    cleanup();
  }
});

test("card doi chieu tren /admin/accesstrade-payments hien dung so du + lich su, POST cong don", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    const cookie = await loginAndGetCookie(baseUrl);

    const before = await (
      await fetch(`${baseUrl}/admin/accesstrade-payments`, { headers: { cookie: cookie! } })
    ).text();
    assert.match(before, /Số dư chủ bot/);
    assert.match(before, /Chưa ghi nhận lần chuyển khoản nào/);
    assert.doesNotMatch(before, /Yêu cầu rút tiền đang chờ/); // danh sach rut tien van o /admin/withdrawals, khong lap lai o day

    const postRes = await fetch(`${baseUrl}/admin/accesstrade-payments`, {
      method: "POST",
      headers: { cookie: cookie!, "content-type": "application/x-www-form-urlencoded" },
      body: "amount=2000000&note=ky+thang+8&receivedAt=2026-08-01",
      redirect: "manual",
    });
    assert.equal(postRes.status, 303);
    assert.equal(ledgerStore.getReconciliationSummary().totalReceivedVnd, 2_000_000);

    const [payment] = ledgerStore.listAccesstradePayments();
    assert.equal(payment.receivedAt, "2026-08-01T00:00:00.000Z");
    assert.equal(payment.note, "ky thang 8");

    const after = await (
      await fetch(`${baseUrl}/admin/accesstrade-payments`, { headers: { cookie: cookie! } })
    ).text();
    assert.match(after, /2\.000\.000đ/);
    assert.match(after, /ky thang 8/);
  } finally {
    cleanup();
  }
});

test("/admin/withdrawals khong con hien card doi chieu (da chuyen qua /admin/accesstrade-payments)", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const cookie = await loginAndGetCookie(baseUrl);
    const html = await (await fetch(`${baseUrl}/admin/withdrawals`, { headers: { cookie: cookie! } })).text();
    assert.doesNotMatch(html, /Số dư chủ bot/);
  } finally {
    cleanup();
  }
});

test("POST /admin/accesstrade-payments voi so tien khong hop le -> 422 kem loi, khong ghi nhan", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    const cookie = await loginAndGetCookie(baseUrl);

    const res = await fetch(`${baseUrl}/admin/accesstrade-payments`, {
      method: "POST",
      headers: { cookie: cookie!, "content-type": "application/x-www-form-urlencoded" },
      body: "amount=abc",
      redirect: "manual",
    });
    assert.equal(res.status, 422);
    const html = await res.text();
    assert.match(html, /không hợp lệ/);
    assert.equal(ledgerStore.getReconciliationSummary().totalReceivedVnd, 0);
  } finally {
    cleanup();
  }
});

test("card doi chieu canh bao khi so du chu bot am", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    ledgerStore.recordConversion({
      subId: "telegram-user-a-1",
      platform: "telegram",
      userId: "user-a",
      merchant: "shopee",
      orderId: "order-1",
      orderAmount: 500_000,
      commissionAmount: 100_000,
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
    });
    const withdrawal = ledgerStore.requestWithdrawal("telegram", "user-a", THRESHOLD_VND, BANK_INFO);
    ledgerStore.markWithdrawalPaid(withdrawal.id, "proof-1.png"); // da tra 80_000, chua ghi nhan da nhan gi tu Accesstrade -> am

    const cookie = await loginAndGetCookie(baseUrl);
    const html = await (
      await fetch(`${baseUrl}/admin/accesstrade-payments`, { headers: { cookie: cookie! } })
    ).text();
    assert.match(html, /Đang trả cho user vượt quá số tiền đã nhận thật/);
  } finally {
    cleanup();
  }
});

test("GET /admin/record-orders hien du 2 form (ghi 1 don le + import bao cao Shopee)", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const cookie = await loginAndGetCookie(baseUrl);
    const html = await (await fetch(`${baseUrl}/admin/record-orders`, { headers: { cookie: cookie! } })).text();
    assert.match(html, /Ghi 1 đơn lẻ/);
    assert.match(html, /Import báo cáo gốc Shopee Affiliate/);
  } finally {
    cleanup();
  }
});

test("POST /admin/record-orders/single ghi dung don khi subId hop le", async () => {
  const { logStore, ledgerStore, baseUrl, notifyUserCalls, cleanup } = setup();
  try {
    seedRequestLog(logStore, "telegram-user-a-abc123-def");

    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/record-orders/single`, {
      method: "POST",
      headers: { cookie: cookie!, "content-type": "application/x-www-form-urlencoded" },
      body: "subId=telegram-user-a-abc123-def&orderId=WEB-ORDER-001&orderAmount=200000&commissionAmount=20000",
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Đã ghi nhận đơn/);
    assert.match(html, /WEB-ORDER-001/);
    assert.equal(ledgerStore.getAvailableBalance("telegram", "user-a"), 16_000); // 80% cua 20_000

    // phan-hoi-cai-thien-trai-nghiem-nguoi-dung.md muc 1: ghi 1 don le -> bao ngay cho dung user,
    // kem ten don (fallback "Đơn <orderId>" vi test khong dien productName) + so tien nhan duoc.
    assert.equal(notifyUserCalls.length, 1);
    assert.equal(notifyUserCalls[0].platform, "telegram");
    assert.equal(notifyUserCalls[0].userId, "user-a");
    assert.match(notifyUserCalls[0].message, /Đơn WEB-ORDER-001/);
    assert.match(notifyUserCalls[0].message, /16.000đ/);

    // 2026-08-23: ghi 1 don le cung phai len lich su, phan loai action = "single" (form), khong bao
    // gio co statusTransitions vi day luon la INSERT moi (khong UPDATE entry co san).
    assert.match(html, /Ghi 1 đơn lẻ \(form\)/);
    const history = ledgerStore.listImportHistory(10);
    assert.equal(history.length, 1);
    assert.equal(history[0].actionType, "single");
    assert.deepEqual(history[0].newOrderIds, ["WEB-ORDER-001"]);
    assert.deepEqual(history[0].statusTransitions, []);
  } finally {
    cleanup();
  }
});

test("POST /admin/record-orders/single bao loi ro khi subId khong ton tai", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/record-orders/single`, {
      method: "POST",
      headers: { cookie: cookie!, "content-type": "application/x-www-form-urlencoded" },
      body: "subId=khong-ton-tai&orderId=WEB-ORDER-002&orderAmount=200000&commissionAmount=20000",
    });
    assert.equal(res.status, 422);
    const html = await res.text();
    assert.match(html, /Không tìm thấy request nào ứng với subId/);
  } finally {
    cleanup();
  }
});

test("POST /admin/record-orders/single voi status=pending -> ghi entry pending, KHONG tinh vao so du kha dung, KHONG gui thong bao", async () => {
  const { logStore, ledgerStore, baseUrl, notifyUserCalls, cleanup } = setup();
  try {
    seedRequestLog(logStore, "telegram-user-a-abc123-def");

    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/record-orders/single`, {
      method: "POST",
      headers: { cookie: cookie!, "content-type": "application/x-www-form-urlencoded" },
      body: "subId=telegram-user-a-abc123-def&orderId=WEB-ORDER-PENDING&orderAmount=200000&commissionAmount=20000&status=pending",
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Chờ xác nhận/);
    assert.match(html, /dự kiến user nhận/);

    const entry = ledgerStore.listCommissionEntries({}).find((e) => e.orderId === "WEB-ORDER-PENDING");
    assert.equal(entry?.status, "pending");
    assert.equal(ledgerStore.getAvailableBalance("telegram", "user-a"), 0);
    assert.equal(notifyUserCalls.length, 0);
  } finally {
    cleanup();
  }
});

test("POST /admin/record-orders/single dung userSharePercent MOI NHAT tu ledgerStore.setUserSharePercent thay vi gia tri tinh luc khoi tao", async () => {
  const { ledgerStore, logStore, baseUrl, cleanup } = setup();
  try {
    seedRequestLog(logStore, "sub-dynamic-percent");
    ledgerStore.setSetting("commission_user_share_percent", "50");
    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/record-orders/single`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie ?? "" },
      body: new URLSearchParams({
        subId: "sub-dynamic-percent",
        orderId: "order-dynamic-percent",
        orderAmount: "1000000",
        commissionAmount: "100000",
      }).toString(),
    });
    assert.equal(res.status, 200);
    const entries = ledgerStore.listCommissionEntries({});
    const entry = entries.find((e) => e.orderId === "order-dynamic-percent");
    assert.ok(entry);
    // ORDER_CONFIG mac dinh trong setup() la userSharePercent=80 - neu con dung gia tri tinh nay
    // thi userShareAmount se la 80% cua 100_000 (=80_000) thay vi 50% (=50_000) nhu setting moi.
    assert.equal(entry!.userShareAmount, 50_000);
  } finally {
    cleanup();
  }
});

const SHOPEE_REPORT_HEADER =
  "ID đơn hàng,Tên Item,Giá trị đơn hàng (₫),Tổng hoa hồng sản phẩm(₫),Trạng thái sản phẩm liên kết,Sub_id1,Sub_id2,Sub_id3,Sub_id4,Sub_id5";

function shopeeReportRow(orderId: string, status: string, subIdParts: string[]): string {
  const sub = [0, 1, 2, 3, 4].map((i) => subIdParts[i] ?? "");
  return [orderId, "San pham test", "100000", "10000", status, ...sub].join(",");
}

test("POST /admin/record-orders/shopee-report ghi lich su action=csv kem newOrderIds", async () => {
  const { logStore, ledgerStore, baseUrl, notifyUserCalls, cleanup } = setup();
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def", { platform: "zalo", userId: "user-a" });

    const csvContent = [
      SHOPEE_REPORT_HEADER,
      shopeeReportRow("SHOPEE-001", "Hoàn thành", ["zalo", "user-a", "abc", "def"]),
    ].join("\n");
    const formData = new FormData();
    formData.append("file", new Blob([csvContent], { type: "text/csv" }), "report.csv");

    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/record-orders/shopee-report`, {
      method: "POST",
      headers: { cookie: cookie! },
      body: formData,
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Import CSV \(báo cáo Shopee\)/);
    assert.match(html, /SHOPEE-001/);
    // 2026-08-23: toast thanh cong hien voi so luong dung (1 don moi, 0 doi trang thai).
    assert.match(html, /class="toast"[^>]*>Import thành công: 1 đơn mới, 0 đơn cập nhật trạng thái\./);
    assert.equal(ledgerStore.getAvailableBalance("zalo", "user-a"), 8_000); // 80% cua 10_000

    assert.equal(notifyUserCalls.length, 1);
    assert.equal(notifyUserCalls[0].userId, "user-a");

    const history = ledgerStore.listImportHistory(10);
    assert.equal(history.length, 1);
    assert.equal(history[0].actionType, "csv");
    assert.deepEqual(history[0].newOrderIds, ["SHOPEE-001"]);
    assert.deepEqual(history[0].statusTransitions, []);
  } finally {
    cleanup();
  }
});

test("POST /admin/record-orders/shopee-report don pending co san chuyen 'Hoan thanh' -> lich su ghi statusTransitions, khong ghi newOrderIds", async () => {
  const { logStore, ledgerStore, baseUrl, cleanup } = setup();
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def", { platform: "zalo", userId: "user-a" });
    const cookie = await loginAndGetCookie(baseUrl);

    await fetch(`${baseUrl}/admin/record-orders/shopee-report`, {
      method: "POST",
      headers: { cookie: cookie! },
      body: (() => {
        const fd = new FormData();
        fd.append(
          "file",
          new Blob(
            [[SHOPEE_REPORT_HEADER, shopeeReportRow("SHOPEE-002", "Đang chờ xử lý", ["zalo", "user-a", "abc", "def"])].join("\n")],
            { type: "text/csv" }
          ),
          "report1.csv"
        );
        return fd;
      })(),
    });

    const res2 = await fetch(`${baseUrl}/admin/record-orders/shopee-report`, {
      method: "POST",
      headers: { cookie: cookie! },
      body: (() => {
        const fd = new FormData();
        fd.append(
          "file",
          new Blob(
            [[SHOPEE_REPORT_HEADER, shopeeReportRow("SHOPEE-002", "Hoàn thành", ["zalo", "user-a", "abc", "def"])].join("\n")],
            { type: "text/csv" }
          ),
          "report2.csv"
        );
        return fd;
      })(),
    });
    assert.equal(res2.status, 200);

    const history = ledgerStore.listImportHistory(10);
    assert.equal(history.length, 2); // 1 dong cho moi lan upload
    assert.equal(history[0].actionType, "csv"); // moi nhat truoc
    assert.deepEqual(history[0].newOrderIds, []);
    assert.deepEqual(history[0].statusTransitions, [{ orderId: "SHOPEE-002", from: "pending", to: "confirmed" }]);
    assert.deepEqual(history[1].newOrderIds, ["SHOPEE-002"]);
  } finally {
    cleanup();
  }
});

test("GET /admin/settings tra ve form voi gia tri mac dinh khi chua tung luu setting nao", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/settings`, { headers: { cookie: cookie ?? "" } });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /name="commission_user_share_percent"/);
    assert.match(html, /name="withdrawal_threshold_vnd"/);
    assert.match(html, /name="usage_text"/);
    assert.match(html, /name="welcome_message_template"/);
    assert.match(html, /name="success_reply_template"/);
  } finally {
    cleanup();
  }
});

test("POST /admin/settings luu thanh cong -> GET sau do phan anh dung gia tri moi", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/settings`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie ?? "" },
      body: new URLSearchParams({
        commission_user_share_percent: "70",
        withdrawal_threshold_vnd: "99000",
        usage_text: "usage moi",
        welcome_message_template: "welcome moi {{userSharePercent}}",
        success_reply_template: "success moi {{link}}",
      }).toString(),
      redirect: "manual",
    });
    assert.equal(res.status, 303);
    assert.equal(ledgerStore.getSetting("commission_user_share_percent", ""), "70");
    assert.equal(ledgerStore.getSetting("withdrawal_threshold_vnd", ""), "99000");
    assert.equal(ledgerStore.getSetting("usage_text", ""), "usage moi");

    // Kiem tra GET thuc su tra ve HTML phan anh gia tri VUA LUU (khong chi doc thang tu DB) -
    // xac nhan renderSettingsPage doc dung tu ledgerStore.getSetting(...) thay vi luon fallback ve
    // default cua SETTINGS_REGISTRY.
    const getRes = await fetch(`${baseUrl}/admin/settings`, {
      headers: { cookie: cookie ?? "" },
    });
    assert.equal(getRes.status, 200);
    const html = await getRes.text();
    assert.match(html, /value="70"/);
    assert.match(html, /value="99000"/);
    assert.match(html, /usage moi/);
  } finally {
    cleanup();
  }
});

test("POST /admin/settings voi % ngoai khoang 0-100 -> 422, khong luu gi ca", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/settings`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie ?? "" },
      body: new URLSearchParams({
        commission_user_share_percent: "150",
        withdrawal_threshold_vnd: "99000",
        usage_text: "usage moi",
        welcome_message_template: "welcome moi",
        success_reply_template: "success moi",
      }).toString(),
    });
    assert.equal(res.status, 422);
    const html = await res.text();
    assert.match(html, /class="error"/);
    // Khong co gia tri nao duoc luu - kiem tra field khong lien quan (usage_text) cung KHONG duoc
    // luu, xac nhan hanh vi "tat ca hoac khong gi" (atomic) thay vi luu rieng le tung field hop le.
    assert.equal(ledgerStore.getSetting("usage_text", "__default__"), "__default__");
  } finally {
    cleanup();
  }
});

test("POST /admin/settings voi text rong -> 422", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/settings`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie ?? "" },
      body: new URLSearchParams({
        commission_user_share_percent: "80",
        withdrawal_threshold_vnd: "20000",
        usage_text: "   ",
        welcome_message_template: "welcome moi",
        success_reply_template: "success moi",
      }).toString(),
    });
    assert.equal(res.status, 422);
  } finally {
    cleanup();
  }
});
