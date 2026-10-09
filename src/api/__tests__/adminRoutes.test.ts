import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server.js";
import { AdminSessionStore } from "../../core/adminAuth.js";
import type { NotifyUser } from "../../core/notification.js";
import { LedgerStore } from "../../core/ledgerStore.js";
import {
  PAYOUT_DEBT_NOTICE_TEMPLATE_DEFAULT,
  WITHDRAWAL_CANCELLED_TEMPLATE_DEFAULT,
} from "../../adapters/shared/replyText.js";
import { LogStore } from "../../core/logStore.js";
import { LinkResolverService } from "../../core/linkResolverService.js";
import { RateLimiter } from "../../core/rateLimiter.js";
import { SETTINGS_REGISTRY } from "../../config/settingsRegistry.js";
import { MockAffiliateProvider } from "../../core/providers/mockProvider.js";
import { todayVnIso, yesterdayVnDdMm } from "../../core/vietnamDate.js";

const THRESHOLD_VND = 50_000;
const BANK_INFO = { bankName: "Vietcombank", bankAccountNumber: "0123456789", bankAccountHolder: "Nguyen Van A" };
const ADMIN_PASSWORD = "test-admin-password";
const ORDER_CONFIG = { taxPercent: 0, platformFeePercent: 0, userSharePercent: 80, maxCommissionRatioPercent: 1000, holdConfig: { thresholdVnd: 0, holdDays: 0 } };

// Mac dinh rong rai de cac test dang nhap nhieu lan (nhieu it() lien tiep) khong vo tinh dinh
// rate limit login - test rieng ve rate limit tu tao 1 RateLimiter gioi han thap cua rieng no.
function setup(
  adminLoginRateLimiter = new RateLimiter(1000, 60_000),
  // false de ep di qua nhanh TEXT DU PHONG (formatOrdersConfirmedReply) thay vi render anh that -
  // dung khi test can assert TRUC TIEP tren noi dung chu, khong chi "co anh hay khong".
  orderImageEnabled = true
) {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  const rateLimiter = new RateLimiter(1000, 60_000);
  const resolver = new LinkResolverService(new MockAffiliateProvider(), logStore, rateLimiter);
  const adminSessionStore = new AdminSessionStore(ADMIN_PASSWORD);
  const withdrawalProofDir = mkdtempSync(join(tmpdir(), "withdrawal-proofs-"));

  const notifyAdmin = async (): Promise<void> => {};
  const notifyUserCalls: Array<{ platform: string; userId: string; message: string; hasImage: boolean }> = [];
  const notifyUser: NotifyUser = async (platform, userId, notification): Promise<void> => {
    notifyUserCalls.push({
      platform,
      userId,
      message: notification.text,
      hasImage: notification.image !== undefined,
    });
  };

  const notifyZaloGroupCalls: Array<{ groupId: string; message: string }> = [];
  const notifyZaloGroup = async (groupId: string, message: string): Promise<void> => {
    notifyZaloGroupCalls.push({ groupId, message });
  };

  // Dong bo danh sach thanh vien cua 1 group vua duoc tick (2026-10-09) - xem syncGroupRoster.
  const syncZaloGroupMembersCalls: string[] = [];
  let syncZaloGroupMembersError: Error | null = null;
  const syncZaloGroupMembers = async (groupId: string): Promise<void> => {
    syncZaloGroupMembersCalls.push(groupId);
    if (syncZaloGroupMembersError !== null) throw syncZaloGroupMembersError;
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
    notifyUser,
    notifyZaloGroup,
    orderImageEnabled,
    syncZaloGroupMembers
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

  return {
    logStore,
    ledgerStore,
    baseUrl,
    withdrawalProofDir,
    notifyUserCalls,
    notifyZaloGroupCalls,
    syncZaloGroupMembersCalls,
    setSyncZaloGroupMembersError: (err: Error | null) => {
      syncZaloGroupMembersError = err;
    },
    cleanup,
  };
}

/** FormData multipart 1 anh "chuyen khoan" gia lap, dung chung cho cac test mark-paid. */
function fakeProofFormData(filename = "proof.png"): FormData {
  const formData = new FormData();
  formData.append("proofImage", new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }), filename);
  return formData;
}

/** Gia lap 1 request thanh cong da qua bot - can co truoc de recordSingleOrder tra duoc subId. */
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
    for (const path of [
      "/admin",
      "/admin/withdrawals",
      "/admin/users",
      "/admin/orders",
      "/admin/users/zalo/user-a/commission",
    ]) {
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

test("POST /admin/withdrawals/:id/mark-paid (kem anh) chuyen dung trang thai, luu duoc bang chung, bao user qua notifyUser", async () => {
  const { ledgerStore, baseUrl, notifyUserCalls, cleanup } = setup();
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
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
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

    assert.equal(notifyUserCalls.length, 1);
    assert.equal(notifyUserCalls[0].platform, "telegram");
    assert.equal(notifyUserCalls[0].userId, "user-a");
    assert.match(notifyUserCalls[0].message, /Tiền đã bay về bạn rồi đó/);
  } finally {
    cleanup();
  }
});

test("POST /admin/withdrawals/:id/mark-paid KHONG kem anh -> van chuyen sang paid, bao user, khong luu bang chung", async () => {
  const { ledgerStore, baseUrl, notifyUserCalls, cleanup } = setup();
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
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
    });
    const withdrawal = ledgerStore.requestWithdrawal("telegram", "user-a", THRESHOLD_VND, BANK_INFO);

    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/withdrawals/${withdrawal.id}/mark-paid`, {
      method: "POST",
      headers: { cookie: cookie! },
      body: new FormData(),
      redirect: "manual",
    });
    assert.equal(res.status, 303);
    assert.equal(ledgerStore.getPendingWithdrawal("telegram", "user-a"), null);

    const paid = ledgerStore.listPaidWithdrawals()[0];
    assert.equal(paid.status, "paid");
    assert.equal(paid.proofImagePath, null);
    assert.equal(notifyUserCalls.length, 1);

    // Bang lich su khong duoc render link "Xem ảnh" tro vao file khong ton tai.
    const cookie2 = await loginAndGetCookie(baseUrl);
    const html = await (await fetch(`${baseUrl}/admin/withdrawals`, { headers: { cookie: cookie2! } })).text();
    assert.doesNotMatch(html, /Xem ảnh/);
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
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
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
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
    });
    ledgerStore.upsertUserProfile("telegram", "user-a", "Nguyễn Văn A");

    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/users`, { headers: { cookie: cookie! } });
    const html = await res.text();
    // Khop theo NOI DUNG, khong khop ca the: kenh gio la chip co class va ten viet hoa, userId nam
    // trong khoi co avatar + nut copy. Ghim nguyen van "<td>telegram</td>" se vo moi lan chinh
    // giao dien du du lieu van dung.
    assert.match(html, />Telegram</);
    assert.match(html, /user-a/);
    assert.match(html, /Nguyễn Văn A/);
    assert.match(html, /80\.000đ/); // tong available = 40_000 + 40_000
  } finally {
    cleanup();
  }
});

/**
 * Ty le duoc chot theo TUNG don (2026-10-01) nen 2 don cua 2 user co the khac %. Cot "% chốt" cho
 * admin doi chieu truc tiep tren /admin/orders thay vi suy nguoc tu 2 cot tien.
 */
test("/admin/orders hien cot % chot cua tung don", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    ledgerStore.recordConversion({
      subId: "telegram-user-a-1",
      platform: "telegram",
      userId: "user-a",
      merchant: "shopee",
      orderId: "order-co-ty-le",
      orderAmount: 500_000,
      commissionAmount: 50_000,
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 65,
      maxCommissionRatioPercent: 1000,
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
    });

    const cookie = await loginAndGetCookie(baseUrl);
    const html = await (await fetch(`${baseUrl}/admin/orders`, { headers: { cookie: cookie! } })).text();

    // Khop theo NOI DUNG o, khong khop ca the: the <th>/<td> cua trang nay mang class dinh dang
    // (can le phai, co chu, tabular-nums) nen ghim nguyen van "<th>% chốt</th>" se vo moi lan
    // chinh giao dien, du cot van hien dung.
    assert.match(html, />% chốt</);
    assert.match(html, />65%</);
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
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
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
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
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
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
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
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
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

test("GET /admin/record-orders hien du 2 form (ghi 1 don le + import bao cao Shopee)", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const cookie = await loginAndGetCookie(baseUrl);
    const html = await (await fetch(`${baseUrl}/admin/record-orders`, { headers: { cookie: cookie! } })).text();
    assert.match(html, /Ghi 1 đơn lẻ/);
    assert.match(html, /Import báo cáo Shopee Affiliate/);
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

    // phan-hoi-cai-thien-trai-nghiem-nguoi-dung.md muc 1: ghi 1 don le -> bao ngay cho dung user.
    // Tu 2026-10-05 noi dung di bang ANH (ten don + so tien nam tren anh), nen tin nhan chi con
    // caption chi duong vao dashboard - xem src/core/orderImage/.
    assert.equal(notifyUserCalls.length, 1);
    assert.equal(notifyUserCalls[0].platform, "telegram");
    assert.equal(notifyUserCalls[0].userId, "user-a");
    assert.equal(notifyUserCalls[0].hasImage, true);
    assert.match(notifyUserCalls[0].message, /dashboard/i);
    assert.match(notifyUserCalls[0].message, /\/d\//);

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
    assert.match(html, /name="group_join_welcome_template"/);
  } finally {
    cleanup();
  }
});

/**
 * Form /admin/settings luon submit TAT CA field (route tu choi 422 neu thieu bat ky field nao), nen
 * body test phai du field. Dung mac dinh tu SETTINGS_REGISTRY roi ghi de dung field can kiem tra -
 * them setting moi sau nay khong lam gay cac test nay nua.
 */
function settingsFormBody(overrides: Record<string, string> = {}): string {
  const body: Record<string, string> = {};
  for (const field of SETTINGS_REGISTRY) body[field.key] = field.default;
  return new URLSearchParams({ ...body, ...overrides }).toString();
}

test("POST /admin/settings luu thanh cong -> GET sau do phan anh dung gia tri moi", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/settings`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie ?? "" },
      body: settingsFormBody({
        commission_user_share_percent: "70",
        withdrawal_threshold_vnd: "99000",
        usage_text: "usage moi",
      }),
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
    assert.match(html, /border-rose-200 bg-rose-50/);
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

// Xem comment trong ledgerStore.test.ts ("getSetting normalize CRLF") de biet bug goc: trinh duyet
// nop <textarea> len bang CRLF, Zalo desktop hien thi thanh dong trong gap doi.
test("POST /admin/settings: xuong dong CRLF cua textarea duoc normalize ve LF truoc khi luu", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/settings`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie ?? "" },
      body: settingsFormBody({
        success_reply_template: "Link đây ạ: {{link}}\r\n\r\n{{commissionLine}}\r\n\r\nCuoi cung",
      }),
      redirect: "manual",
    });
    assert.equal(res.status, 303);
    const saved = ledgerStore.getSetting("success_reply_template", "");
    assert.equal(saved.includes("\r"), false);
    assert.equal(saved, "Link đây ạ: {{link}}\n\n{{commissionLine}}\n\nCuoi cung");
  } finally {
    cleanup();
  }
});

// 2026-09-11 (yeu cau truc tiep cua user): sau moi lan import bao cao Shopee tren web, bot nhan vao
// group Zalo da duoc admin tick tren /admin/settings de ca group biet du lieu vua duoc cap nhat.
test("POST /admin/record-orders/shopee-report nhan vao group da tick, bo qua group chua tick", async () => {
  const { logStore, ledgerStore, baseUrl, notifyZaloGroupCalls, cleanup } = setup();
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def", { platform: "zalo", userId: "user-a" });
    ledgerStore.upsertZaloGroup("group-hoan-tien", "Group Hoàn Tiền");
    ledgerStore.upsertZaloGroup("group-gia-dinh", "Gia đình");
    ledgerStore.setZaloGroupNotifySelection(["group-hoan-tien"]);

    const csvContent = [
      SHOPEE_REPORT_HEADER,
      shopeeReportRow("SHOPEE-GROUP-1", "Hoàn thành", ["zalo", "user-a", "abc", "def"]),
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

    assert.equal(notifyZaloGroupCalls.length, 1, "chi group da tick duoc nhan tin");
    assert.equal(notifyZaloGroupCalls[0].groupId, "group-hoan-tien");
    // Ngay hom qua theo gio VN, dinh dang dd/mm (khong kem nam).
    const expectedDate = yesterdayVnDdMm();
    assert.ok(
      notifyZaloGroupCalls[0].message.includes(expectedDate),
      `tin nhan phai chua ngay hom qua ${expectedDate}: ${notifyZaloGroupCalls[0].message}`
    );
    assert.ok(!notifyZaloGroupCalls[0].message.includes("{{"), "khong duoc con placeholder chua thay the");
  } finally {
    cleanup();
  }
});

test("POST /admin/record-orders/shopee-report van nhan vao group khi 0 don moi", async () => {
  const { ledgerStore, baseUrl, notifyZaloGroupCalls, cleanup } = setup();
  try {
    ledgerStore.upsertZaloGroup("group-hoan-tien", "Group Hoàn Tiền");
    ledgerStore.setZaloGroupNotifySelection(["group-hoan-tien"]);

    // File chi co header -> khong ghi nhan don nao ca. Quyet dinh cua user: van thong bao, de user
    // quen nhip "moi ngay admin deu cap nhat".
    const formData = new FormData();
    formData.append("file", new Blob([SHOPEE_REPORT_HEADER], { type: "text/csv" }), "report.csv");

    const cookie = await loginAndGetCookie(baseUrl);
    await fetch(`${baseUrl}/admin/record-orders/shopee-report`, {
      method: "POST",
      headers: { cookie: cookie! },
      body: formData,
    });

    assert.equal(notifyZaloGroupCalls.length, 1);
  } finally {
    cleanup();
  }
});

test("POST /admin/record-orders/shopee-report khong nhan group nao khi admin chua tick group nao", async () => {
  const { ledgerStore, baseUrl, notifyZaloGroupCalls, cleanup } = setup();
  try {
    ledgerStore.upsertZaloGroup("group-gia-dinh", "Gia đình");

    const formData = new FormData();
    formData.append("file", new Blob([SHOPEE_REPORT_HEADER], { type: "text/csv" }), "report.csv");
    const cookie = await loginAndGetCookie(baseUrl);
    await fetch(`${baseUrl}/admin/record-orders/shopee-report`, {
      method: "POST",
      headers: { cookie: cookie! },
      body: formData,
    });

    assert.deepEqual(notifyZaloGroupCalls, []);
  } finally {
    cleanup();
  }
});

test("GET /admin/settings hien danh sach group Zalo kem checkbox da tick", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    ledgerStore.upsertZaloGroup("group-hoan-tien", "Group Hoàn Tiền");
    ledgerStore.upsertZaloGroup("group-gia-dinh", "Gia đình");
    ledgerStore.setZaloGroupNotifySelection(["group-hoan-tien"]);

    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/settings`, { headers: { cookie: cookie! } });
    const html = await res.text();

    assert.match(html, /Group Hoàn Tiền/);
    assert.match(html, /Gia đình/);
    // Group da tick phai duoc check san, group chua tick thi khong.
    assert.match(html, /value="group-hoan-tien"[^>]*checked/);
    assert.doesNotMatch(html, /value="group-gia-dinh"[^>]*checked/);
  } finally {
    cleanup();
  }
});

test("POST /admin/settings/zalo-groups luu dung lua chon group", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    ledgerStore.upsertZaloGroup("group-1", "A");
    ledgerStore.upsertZaloGroup("group-2", "B");
    ledgerStore.setZaloGroupNotifySelection(["group-1"]);

    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/settings/zalo-groups`, {
      method: "POST",
      headers: { cookie: cookie!, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams([["groupIds", "group-2"]]).toString(),
      redirect: "manual",
    });
    assert.equal(res.status, 303);

    assert.deepEqual(
      ledgerStore.listNotifyEnabledZaloGroups().map((g) => g.groupId),
      ["group-2"]
    );
  } finally {
    cleanup();
  }
});

test("POST /admin/settings/zalo-groups bo tick het (khong gui groupIds) -> khong con group nao", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    ledgerStore.upsertZaloGroup("group-1", "A");
    ledgerStore.setZaloGroupNotifySelection(["group-1"]);

    const cookie = await loginAndGetCookie(baseUrl);
    await fetch(`${baseUrl}/admin/settings/zalo-groups`, {
      method: "POST",
      headers: { cookie: cookie!, "content-type": "application/x-www-form-urlencoded" },
      body: "",
      redirect: "manual",
    });

    assert.deepEqual(ledgerStore.listNotifyEnabledZaloGroups(), []);
  } finally {
    cleanup();
  }
});

test("POST /admin/settings/zalo-groups yeu cau dang nhap admin", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    ledgerStore.upsertZaloGroup("group-1", "A");
    const res = await fetch(`${baseUrl}/admin/settings/zalo-groups`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams([["groupIds", "group-1"]]).toString(),
      redirect: "manual",
    });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/admin/login");
    assert.deepEqual(ledgerStore.listNotifyEnabledZaloGroups(), [], "khong duoc luu gi khi chua dang nhap");
  } finally {
    cleanup();
  }
});

// --- Search trang Nguoi dung + phan trang/loc nhieu trang thai trang Don hang (2026-09-22) ---

/** Ghi n don "bulk-1".."bulk-n" cho cac test phan trang. */
function seedOrders(ledgerStore: LedgerStore, n: number, overrides: Partial<{ merchant: "shopee" | "lazada"; status: "pending" | "confirmed" }> = {}) {
  for (let i = 1; i <= n; i++) {
    ledgerStore.recordConversion({
      subId: `telegram-user-a-bulk-${i}`,
      platform: "telegram",
      userId: "user-a",
      merchant: overrides.merchant ?? "shopee",
      orderId: `bulk-${i}`,
      orderAmount: 500_000,
      commissionAmount: 50_000,
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
      status: overrides.status,
    });
  }
}

/** Dem so dong don hang hien tren 1 trang HTML (moi don hien ma don dung 1 lan trong o "Ma don"). */
function countOrderRows(html: string): number {
  return (html.match(/>bulk-\d+</g) ?? []).length;
}

test("/admin/users co o search va moi dong mang san du lieu tim theo ca Ten lan User ID", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    seedOrders(ledgerStore, 1);
    ledgerStore.upsertUserProfile("telegram", "user-a", "Nguyễn Văn A");

    const cookie = await loginAndGetCookie(baseUrl);
    const html = await (await fetch(`${baseUrl}/admin/users`, { headers: { cookie: cookie! } })).text();

    assert.match(html, /id="user-search"/);
    // Chuoi tim kiem viet thuong san trong data-search de JS client chi can so khop chuoi con.
    assert.match(html, /data-search="[^"]*nguyễn văn a[^"]*"/);
    assert.match(html, /data-search="[^"]*user-a[^"]*"/);
  } finally {
    cleanup();
  }
});

test("/admin/orders loc duoc NHIEU trang thai cung luc qua checkbox (status=pending&status=reversed)", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    seedOrders(ledgerStore, 1); // bulk-1: confirmed
    seedOrders(ledgerStore, 0);
    ledgerStore.recordConversion({
      subId: "telegram-user-a-p",
      platform: "telegram",
      userId: "user-a",
      merchant: "shopee",
      orderId: "don-pending",
      orderAmount: 500_000,
      commissionAmount: 50_000,
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
      status: "pending",
    });
    ledgerStore.recordConversion({
      subId: "telegram-user-a-r",
      platform: "telegram",
      userId: "user-a",
      merchant: "shopee",
      orderId: "don-reversed",
      orderAmount: 500_000,
      commissionAmount: 50_000,
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
      status: "pending",
    });
    ledgerStore.reverseCommissionEntry(ledgerStore.getEntryByOrderId("shopee", "don-reversed")!.id, "test");

    const cookie = await loginAndGetCookie(baseUrl);
    const html = await (
      await fetch(`${baseUrl}/admin/orders?status=pending&status=reversed`, { headers: { cookie: cookie! } })
    ).text();

    assert.match(html, /don-pending/);
    assert.match(html, /don-reversed/);
    assert.doesNotMatch(html, />bulk-1</);
  } finally {
    cleanup();
  }
});

test("/admin/orders phan trang 50 don/trang, trang cuoi chi con phan du", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    seedOrders(ledgerStore, 55);

    const cookie = await loginAndGetCookie(baseUrl);
    const page1 = await (await fetch(`${baseUrl}/admin/orders`, { headers: { cookie: cookie! } })).text();
    const page2 = await (await fetch(`${baseUrl}/admin/orders?page=2`, { headers: { cookie: cookie! } })).text();

    assert.equal(countOrderRows(page1), 50);
    assert.equal(countOrderRows(page2), 5);
    assert.match(page1, /href="[^"]*page=2[^"]*"/);
    // Don moi nhat nam trang 1, don cu nhat nam trang cuoi - khong trung nhau.
    assert.match(page1, />bulk-55</);
    assert.doesNotMatch(page1, />bulk-1</);
    assert.match(page2, />bulk-1</);
  } finally {
    cleanup();
  }
});

test("/admin/orders link sang trang khac GIU NGUYEN bo loc dang ap dung", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    seedOrders(ledgerStore, 55, { status: "pending" });

    const cookie = await loginAndGetCookie(baseUrl);
    const html = await (
      await fetch(`${baseUrl}/admin/orders?merchant=shopee&status=pending&userId=user-a`, {
        headers: { cookie: cookie! },
      })
    ).text();

    const nextLink = html.match(/href="(\/admin\/orders\?[^"]*page=2[^"]*)"/)?.[1];
    assert.ok(nextLink, "phai co link sang trang 2");
    const decoded = nextLink.replace(/&amp;/g, "&");
    assert.match(decoded, /merchant=shopee/);
    assert.match(decoded, /status=pending/);
    assert.match(decoded, /userId=user-a/);
  } finally {
    cleanup();
  }
});

test("/admin/orders tham so page rac/vuot gioi han khong lam vo trang", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    seedOrders(ledgerStore, 3);
    const cookie = await loginAndGetCookie(baseUrl);

    for (const query of ["page=abc", "page=0", "page=-5", "page=999", "page=1.5"]) {
      const res = await fetch(`${baseUrl}/admin/orders?${query}`, { headers: { cookie: cookie! } });
      assert.equal(res.status, 200, `query=${query}`);
      const html = await res.text();
      assert.equal(countOrderRows(html), 3, `query=${query} phai ve trang hop le gan nhat`);
    }
  } finally {
    cleanup();
  }
});

/**
 * % hoa hong rieng tung user (2026-10-01): admin cau hinh tay tren /admin/users. Han tinh theo ngay
 * user DAT don, xem src/core/userCommissionOverride.ts.
 */
const COMMISSION_PATH = "/admin/users/zalo/user-a/commission";

function seedUserWithOrder(ledgerStore: LedgerStore, userId = "user-a"): void {
  ledgerStore.recordConversion({
    subId: `k-${userId}-1`,
    platform: "zalo",
    userId,
    merchant: "shopee",
    orderId: `order-${userId}`,
    orderAmount: 500_000,
    commissionAmount: 50_000,
    taxPercent: 0,
    platformFeePercent: 0,
    userSharePercent: 80,
    maxCommissionRatioPercent: 1000,
    holdConfig: { thresholdVnd: 0, holdDays: 0 },
  });
}

test("GET form cau hinh % rieng: hien % chung hien hanh + gia tri dang luu", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    seedUserWithOrder(ledgerStore);
    ledgerStore.setUserCommissionOverride({
      platform: "zalo",
      userId: "user-a",
      userSharePercent: 95,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });

    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}${COMMISSION_PATH}`, { headers: { cookie: cookie! } });
    assert.equal(res.status, 200);
    const html = await res.text();

    assert.match(html, /value="95"/);
    assert.match(html, /value="2026-10-31"/);
    // Phai noi ro % chung de admin biet dat cao/thap hon cai gi.
    assert.match(html, /80%/);
  } finally {
    cleanup();
  }
});

test("POST luu % rieng hop le -> 303, luu kem ngay bat dau la HOM NAY gio VN", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    seedUserWithOrder(ledgerStore);
    const cookie = await loginAndGetCookie(baseUrl);

    const res = await fetch(`${baseUrl}${COMMISSION_PATH}`, {
      method: "POST",
      headers: { cookie: cookie!, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ userSharePercent: "95", endDate: "2099-12-31" }),
      redirect: "manual",
    });
    assert.equal(res.status, 303);

    const saved = ledgerStore.getUserCommissionOverride("zalo", "user-a");
    assert.equal(saved?.userSharePercent, 95);
    assert.equal(saved?.endDate, "2099-12-31");
    assert.equal(saved?.startDate, todayVnIso());
  } finally {
    cleanup();
  }
});

test("POST ngay ket thuc de TRONG -> luu khong han", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    seedUserWithOrder(ledgerStore);
    const cookie = await loginAndGetCookie(baseUrl);

    await fetch(`${baseUrl}${COMMISSION_PATH}`, {
      method: "POST",
      headers: { cookie: cookie!, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ userSharePercent: "95", endDate: "" }),
      redirect: "manual",
    });

    assert.equal(ledgerStore.getUserCommissionOverride("zalo", "user-a")?.endDate, null);
  } finally {
    cleanup();
  }
});

test("POST % ngoai 0-100 -> 422, khong luu gi", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    seedUserWithOrder(ledgerStore);
    const cookie = await loginAndGetCookie(baseUrl);

    for (const bad of ["101", "-5", "abc", ""]) {
      const res = await fetch(`${baseUrl}${COMMISSION_PATH}`, {
        method: "POST",
        headers: { cookie: cookie!, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ userSharePercent: bad, endDate: "" }),
        redirect: "manual",
      });
      assert.equal(res.status, 422, `% = "${bad}"`);
      assert.equal(ledgerStore.getUserCommissionOverride("zalo", "user-a"), null, `% = "${bad}"`);
    }
  } finally {
    cleanup();
  }
});

test("POST ngay ket thuc o QUA KHU -> 422 (luu uu dai het han san thi khong lam gi ca)", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    seedUserWithOrder(ledgerStore);
    const cookie = await loginAndGetCookie(baseUrl);

    const res = await fetch(`${baseUrl}${COMMISSION_PATH}`, {
      method: "POST",
      headers: { cookie: cookie!, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ userSharePercent: "95", endDate: "2020-01-01" }),
      redirect: "manual",
    });
    assert.equal(res.status, 422);
    const html = await res.text();
    assert.match(html, /quá khứ|đã qua/i);
    assert.equal(ledgerStore.getUserCommissionOverride("zalo", "user-a"), null);
  } finally {
    cleanup();
  }
});

test("POST xoa uu dai -> tra user ve % chung", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    seedUserWithOrder(ledgerStore);
    ledgerStore.setUserCommissionOverride({
      platform: "zalo",
      userId: "user-a",
      userSharePercent: 95,
      startDate: todayVnIso(),
      endDate: null,
    });
    const cookie = await loginAndGetCookie(baseUrl);

    const res = await fetch(`${baseUrl}${COMMISSION_PATH}/delete`, {
      method: "POST",
      headers: { cookie: cookie! },
      redirect: "manual",
    });
    assert.equal(res.status, 303);
    assert.equal(ledgerStore.getUserCommissionOverride("zalo", "user-a"), null);
  } finally {
    cleanup();
  }
});

test("nen tang la trong danh sach hop le -> 404, khong tao ban ghi rac", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/users/facebook/user-a/commission`, {
      method: "POST",
      headers: { cookie: cookie!, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ userSharePercent: "95", endDate: "" }),
      redirect: "manual",
    });
    assert.equal(res.status, 404);
    assert.equal(ledgerStore.listUserCommissionOverrides().length, 0);
  } finally {
    cleanup();
  }
});

test("/admin/users hien cot % hoa hong rieng + nut cau hinh", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    seedUserWithOrder(ledgerStore, "user-a");
    seedUserWithOrder(ledgerStore, "user-b");
    ledgerStore.setUserCommissionOverride({
      platform: "zalo",
      userId: "user-a",
      userSharePercent: 95,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });

    const cookie = await loginAndGetCookie(baseUrl);
    const html = await (await fetch(`${baseUrl}/admin/users`, { headers: { cookie: cookie! } })).text();

    // Khop theo noi dung o, khong khop ca the - <th> mang class dinh dang (can giua, co chu).
    assert.match(html, />% hoa h\u1ed3ng</);
    assert.match(html, /95%/);
    assert.match(html, /31\/10\/2026/);
    assert.match(html, new RegExp(COMMISSION_PATH));
  } finally {
    cleanup();
  }
});

test("GET /admin/settings hien 4 setting cua giam don to + no hoan tra", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/settings`, { headers: { cookie: cookie! } });
    const html = await res.text();

    assert.match(html, /payout_hold_threshold_vnd/);
    assert.match(html, /payout_hold_days/);
    assert.match(html, /payout_debt_notice_template/);
    assert.match(html, /withdrawal_cancelled_template/);
  } finally {
    cleanup();
  }
});

// Chip "bam de chen bien" tu sinh bang cach quet {{...}} trong helpText (xem extractPlaceholders) -
// viet sai cu phap "Placeholder hop le: ..." la mat chip ma khong co loi nao bao.
test("GET /admin/settings sinh chip placeholder cho 2 template moi", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/settings`, { headers: { cookie: cookie! } });
    const html = await res.text();

    for (const ph of ["{{orderId}}", "{{amount}}", "{{reason}}", "{{dashboardUrl}}"]) {
      assert.ok(html.includes(ph), `thieu chip ${ph}`);
    }
  } finally {
    cleanup();
  }
});

// Cau nay la rang buoc ve NIEM TIN, khong phai van phong: nhan tin "ban dang no 40.000d" ma khong noi
// ro thi user tuong phai chuyen tien lai ra ngoai.
test("template no hoan tra PHAI co cau 'khong phai chuyen tien lai'", () => {
  assert.match(PAYOUT_DEBT_NOTICE_TEMPLATE_DEFAULT, /không phải chuyển tiền lại/);
});

// cancelWithdrawal tha entry ve 'confirmed' nen tien that su con nguyen - khong noi ra thi user doc
// "yeu cau bi huy" thanh "mat tien".
test("template huy yeu cau rut PHAI noi tien van con trong so du", () => {
  assert.match(WITHDRAWAL_CANCELLED_TEMPLATE_DEFAULT, /vẫn nằm nguyên trong số dư/);
});

// ---------------------------------------------------------------------------
// Huy yeu cau rut + xoa no (2026-10-08)
// ---------------------------------------------------------------------------

function seedConfirmedOrder(ledgerStore: LedgerStore, orderId: string, commissionAmount: number) {
  return ledgerStore.recordConversion({
    subId: `telegram-user-a-${orderId}-x`,
    platform: "telegram",
    userId: "user-a",
    merchant: "shopee",
    orderId,
    orderAmount: commissionAmount * 10,
    commissionAmount,
    taxPercent: 0,
    platformFeePercent: 0,
    userSharePercent: 100,
    maxCommissionRatioPercent: 1000,
    holdConfig: { thresholdVnd: 0, holdDays: 0 },
  });
}

test("POST /admin/withdrawals/:id/cancel da bi go -> 404", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/withdrawals/abc/cancel`, {
      method: "POST",
      headers: { cookie: cookie! },
      redirect: "manual",
    });
    assert.equal(res.status, 404);
  } finally {
    cleanup();
  }
});

test("POST write-off: xoa no, Kha dung KHONG doi (no dung rieng)", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    seedConfirmedOrder(ledgerStore, "WO1", 10_000);
    const debt = ledgerStore.recordPayoutDebt({
      platform: "telegram",
      userId: "user-a",
      merchant: "shopee",
      orderId: "OLD-ORDER",
      amount: 4_000,
    });
    assert.equal(ledgerStore.getAvailableBalance("telegram", "user-a"), 10_000);
    assert.equal(ledgerStore.getOutstandingDebtTotal("telegram", "user-a"), 4_000);

    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/users/telegram/user-a/debts/${debt!.id}/write-off`, {
      method: "POST",
      headers: { cookie: cookie! },
      redirect: "manual",
    });

    assert.equal(res.status, 303);
    assert.equal(ledgerStore.getAvailableBalance("telegram", "user-a"), 10_000);
    assert.equal(ledgerStore.getOutstandingDebtTotal("telegram", "user-a"), 0);
    assert.ok(ledgerStore.getDebtByOrder("shopee", "OLD-ORDER")?.writtenOffAt, "dong van con de doi soat");
  } finally {
    cleanup();
  }
});

test("POST write-off voi platform khong hop le -> 404", async () => {
  const { ledgerStore, baseUrl, cleanup } = setup();
  try {
    const debt = ledgerStore.recordPayoutDebt({
      platform: "telegram",
      userId: "user-a",
      merchant: "shopee",
      orderId: "OLD-ORDER",
      amount: 4_000,
    });
    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/users/facebook/user-a/debts/${debt!.id}/write-off`, {
      method: "POST",
      headers: { cookie: cookie! },
      redirect: "manual",
    });
    assert.equal(res.status, 404);
    assert.equal(ledgerStore.getDebtByOrder("shopee", "OLD-ORDER")?.writtenOffAt, null);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Tin nhan "don ve" phai nhac NO DA CO TU TRUOC (2026-10-08, yeu cau truc tiep
// cua user) - Kha dung KHONG tru no (mo hinh no 2026-10-08), nen phai bao truoc
// lan rut toi se bi tru, khong doi user rut roi moi biet.
// ---------------------------------------------------------------------------

test("import don moi khi user DANG CO NO tu truoc -> tin nhan nhac no, Kha dung KHONG tru no", async () => {
  const { logStore, ledgerStore, baseUrl, notifyUserCalls, cleanup } = setup(undefined, false);
  try {
    seedRequestLog(logStore, "telegram-user-a-abc123-def");

    // No 120.000d da ton tai TU TRUOC - khong lien quan gi den don sap ghi ben duoi (mo phong mot
    // lan import KHAC, truoc do, da bao mot don cua user nay bi tra hang sau khi da tra tien).
    ledgerStore.recordPayoutDebt({
      platform: "telegram",
      userId: "user-a",
      merchant: "shopee",
      orderId: "OLD-RETURNED-ORDER",
      amount: 120_000,
    });

    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/record-orders/single`, {
      method: "POST",
      headers: { cookie: cookie!, "content-type": "application/x-www-form-urlencoded" },
      body: "subId=telegram-user-a-abc123-def&orderId=NEW-ORDER-001&orderAmount=500000&commissionAmount=50000",
    });
    assert.equal(res.status, 200);

    // 80% cua 50_000 = 40_000. No 120_000 dung RIENG, chi tru luc yeu cau rut duoc duyet.
    assert.equal(ledgerStore.getAvailableBalance("telegram", "user-a"), 40_000);
    assert.equal(ledgerStore.getOutstandingDebtTotal("telegram", "user-a"), 120_000);

    assert.equal(notifyUserCalls.length, 1);
    assert.match(
      notifyUserCalls[0].message,
      /Bạn đang nợ 120\.000đ hoàn trả, Admin sẽ trừ khi bạn rút tiền/,
      `tin nhan phai giai thich NGAY trong lan import nay, nhan duoc: ${notifyUserCalls[0].message}`
    );
  } finally {
    cleanup();
  }
});

test("import don moi khi user KHONG co no -> tin nhan KHONG co cau thua ve no", async () => {
  const { logStore, baseUrl, notifyUserCalls, cleanup } = setup(undefined, false);
  try {
    seedRequestLog(logStore, "telegram-user-a-abc123-def");
    const cookie = await loginAndGetCookie(baseUrl);
    await fetch(`${baseUrl}/admin/record-orders/single`, {
      method: "POST",
      headers: { cookie: cookie!, "content-type": "application/x-www-form-urlencoded" },
      body: "subId=telegram-user-a-abc123-def&orderId=NEW-ORDER-002&orderAmount=500000&commissionAmount=50000",
    });
    assert.doesNotMatch(notifyUserCalls[0].message, /đang nợ/);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Yeu cau rut TU DONG bi huy khi mot don trong do bao "Da huy" luc import
// (2026-10-08, yeu cau truc tiep cua user - DAO NGUOC quyet dinh brainstorm ban
// dau "canh bao admin, admin tu quyet").
// ---------------------------------------------------------------------------

test("import bao 'Da huy' cho don dang trong 1 yeu cau rut -> TU DONG huy yeu cau + DM user + Kha dung ve dung", async () => {
  const { logStore, ledgerStore, baseUrl, notifyUserCalls, cleanup } = setup(undefined, false);
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def", { platform: "zalo", userId: "user-a" });

    const firstCsv = [SHOPEE_REPORT_HEADER, shopeeReportRow("BAOLONG-001", "Hoàn thành", ["zalo", "user-a", "abc", "def"])].join("\n");
    const firstForm = new FormData();
    firstForm.append("file", new Blob([firstCsv], { type: "text/csv" }), "report1.csv");
    const cookie = await loginAndGetCookie(baseUrl);
    await fetch(`${baseUrl}/admin/record-orders/shopee-report`, { method: "POST", headers: { cookie: cookie! }, body: firstForm });

    assert.equal(ledgerStore.getAvailableBalance("zalo", "user-a"), 8_000); // 80% cua 10_000
    const w = ledgerStore.requestWithdrawal("zalo", "user-a", 1, BANK_INFO);
    assert.equal(ledgerStore.getAvailableBalance("zalo", "user-a"), 0, "da bi gom vao yeu cau rut");

    notifyUserCalls.length = 0; // bo qua DM cua lan import dau, chi quan tam lan 2

    const secondCsv = [SHOPEE_REPORT_HEADER, shopeeReportRow("BAOLONG-001", "Đã hủy", ["zalo", "user-a", "abc", "def"])].join("\n");
    const secondForm = new FormData();
    secondForm.append("file", new Blob([secondCsv], { type: "text/csv" }), "report2.csv");
    await fetch(`${baseUrl}/admin/record-orders/shopee-report`, { method: "POST", headers: { cookie: cookie! }, body: secondForm });

    // Yeu cau rut phai chuyen ngay sang 'cancelled', don bi tra hang phai 'reversed' (thu hoi tron,
    // khong phai ghi no - tien chua he ra khoi tay).
    assert.equal(ledgerStore.getPendingWithdrawal("zalo", "user-a"), null);
    assert.equal(ledgerStore.listCancelledWithdrawals()[0]?.id, w.id);
    assert.equal(ledgerStore.getEntryByOrderId("shopee", "BAOLONG-001")?.status, "reversed");
    assert.equal(ledgerStore.getOutstandingDebtTotal("zalo", "user-a"), 0, "khong phai no, da thu hoi tron");

    // Kha dung phai duoc TINH LAI dung: don duy nhat cua user nay da bi huy -> ve 0.
    assert.equal(ledgerStore.getAvailableBalance("zalo", "user-a"), 0);

    assert.equal(notifyUserCalls.length, 1);
    assert.equal(notifyUserCalls[0].userId, "user-a");
    assert.match(notifyUserCalls[0].message, /đã được huỷ/);
    assert.match(
      notifyUserCalls[0].message,
      /đơn hàng bị trả lại/,
      `tin nhan phai noi ro ly do, nhan duoc: ${notifyUserCalls[0].message}`
    );
  } finally {
    cleanup();
  }
});

/**
 * Tick 1 group = "day la group khach hang" -> phai lay danh sach thanh vien NGAY (2026-10-09).
 * Thieu duong nay thi admin tick xong phai cho restart bot moi thay nguoi tren /admin/users.
 */
test("POST /admin/settings/zalo-groups dong bo thanh vien cua group VUA duoc tick", async () => {
  const { ledgerStore, baseUrl, syncZaloGroupMembersCalls, cleanup } = setup();
  try {
    ledgerStore.upsertZaloGroup("group-1", "A");
    ledgerStore.upsertZaloGroup("group-2", "B");
    ledgerStore.setZaloGroupNotifySelection(["group-1"]);

    const cookie = await loginAndGetCookie(baseUrl);
    await fetch(`${baseUrl}/admin/settings/zalo-groups`, {
      method: "POST",
      headers: { cookie: cookie!, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams([
        ["groupIds", "group-1"],
        ["groupIds", "group-2"],
      ]).toString(),
      redirect: "manual",
    });

    assert.deepEqual(syncZaloGroupMembersCalls, ["group-2"], "group-1 da tick san thi khong dong bo lai");
  } finally {
    cleanup();
  }
});

test("POST /admin/settings/zalo-groups bo tick thi khong dong bo thanh vien", async () => {
  const { ledgerStore, baseUrl, syncZaloGroupMembersCalls, cleanup } = setup();
  try {
    ledgerStore.upsertZaloGroup("group-1", "A");
    ledgerStore.setZaloGroupNotifySelection(["group-1"]);

    const cookie = await loginAndGetCookie(baseUrl);
    await fetch(`${baseUrl}/admin/settings/zalo-groups`, {
      method: "POST",
      headers: { cookie: cookie!, "content-type": "application/x-www-form-urlencoded" },
      body: "",
      redirect: "manual",
    });

    assert.deepEqual(syncZaloGroupMembersCalls, []);
  } finally {
    cleanup();
  }
});

/** Bot chua dang nhap / Zalo loi khong duoc lam that bai viec LUU lua chon cua admin. */
test("POST /admin/settings/zalo-groups van luu duoc khi dong bo thanh vien loi", async () => {
  const { ledgerStore, baseUrl, setSyncZaloGroupMembersError, cleanup } = setup();
  try {
    ledgerStore.upsertZaloGroup("group-1", "A");
    setSyncZaloGroupMembersError(new Error("Zalo chua dang nhap"));

    const cookie = await loginAndGetCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/settings/zalo-groups`, {
      method: "POST",
      headers: { cookie: cookie!, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams([["groupIds", "group-1"]]).toString(),
      redirect: "manual",
    });

    assert.equal(res.status, 303);
    assert.deepEqual(
      ledgerStore.listNotifyEnabledZaloGroups().map((g) => g.groupId),
      ["group-1"]
    );
  } finally {
    cleanup();
  }
});
