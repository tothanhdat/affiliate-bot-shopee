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

test("GET /admin/record-orders hien du 2 form (ghi 1 don le + import CSV)", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const cookie = await loginAndGetCookie(baseUrl);
    const html = await (await fetch(`${baseUrl}/admin/record-orders`, { headers: { cookie: cookie! } })).text();
    assert.match(html, /Ghi 1 đơn lẻ/);
    assert.match(html, /Import file CSV/);
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

test("POST /admin/record-orders/csv import file that (multipart), 1 dong OK + 1 dong LOI", async () => {
  const { logStore, ledgerStore, baseUrl, notifyUserCalls, cleanup } = setup();
  try {
    seedRequestLog(logStore, "telegram-user-a-abc123-def");

    const csvContent =
      "subId,orderId,orderAmount,commissionAmount\n" +
      "telegram-user-a-abc123-def,CSV-ORDER-001,200000,20000\n" +
      "subid-khong-ton-tai,CSV-ORDER-002,100000,10000\n";
    const formData = new FormData();
    formData.append("file", new Blob([csvContent], { type: "text/csv" }), "weekly.csv");

    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/record-orders/csv`, {
      method: "POST",
      headers: { cookie: cookie! },
      body: formData,
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Tổng: 2 dòng, 1 thành công, 1 lỗi/);
    assert.match(html, /CSV-ORDER-001/);
    assert.match(html, /CSV-ORDER-002/);
    assert.equal(ledgerStore.getAvailableBalance("telegram", "user-a"), 16_000);

    // phan-hoi-cai-thien-trai-nghiem-nguoi-dung.md muc 1 (Option B): 1 tin gop cho user-a (dong loi
    // khong thuoc ve user nao nen khong tao ra thong bao rieng).
    assert.equal(notifyUserCalls.length, 1);
    assert.equal(notifyUserCalls[0].platform, "telegram");
    assert.equal(notifyUserCalls[0].userId, "user-a");
    assert.match(notifyUserCalls[0].message, /Đơn CSV-ORDER-001/);
  } finally {
    cleanup();
  }
});

test("POST /admin/record-orders/csv khong co file -> 422 kem loi ro rang", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const cookie = await loginAndGetCookie(baseUrl);
    const formData = new FormData();
    const res = await fetch(`${baseUrl}/admin/record-orders/csv`, {
      method: "POST",
      headers: { cookie: cookie! },
      body: formData,
    });
    assert.equal(res.status, 422);
    const html = await res.text();
    assert.match(html, /Chưa chọn file CSV nào/);
  } finally {
    cleanup();
  }
});
