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

/**
 * Trang /admin/links - danh sach moi luot tao link (2026-10-08).
 *
 * Doc truc tiep tu bang requests cua logStore, nhung ten hien thi cua user nam o DB KHAC
 * (user_profiles trong ledger.db) nen route phai gop 2 nguon trong JS - khong JOIN duoc.
 */

const ADMIN_PASSWORD = "test-admin-password";
const ORDER_CONFIG = { taxPercent: 0, platformFeePercent: 0, userSharePercent: 80, maxCommissionRatioPercent: 1000, holdConfig: { thresholdVnd: 0, holdDays: 0 } };

function setup() {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  const rateLimiter = new RateLimiter(1000, 60_000);
  const adminLoginRateLimiter = new RateLimiter(1000, 60_000);
  const resolver = new LinkResolverService(new MockAffiliateProvider(), logStore, rateLimiter);
  const adminSessionStore = new AdminSessionStore(ADMIN_PASSWORD);
  const withdrawalProofDir = mkdtempSync(join(tmpdir(), "withdrawal-proofs-links-"));

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
    async () => {}
  );
  const httpServer = app.listen(0);
  const port = (httpServer.address() as AddressInfo).port;

  return {
    logStore,
    ledgerStore,
    baseUrl: `http://127.0.0.1:${port}`,
    cleanup() {
      httpServer.close();
      rateLimiter.stop();
      adminLoginRateLimiter.stop();
      logStore.close();
      ledgerStore.close();
      rmSync(withdrawalProofDir, { recursive: true, force: true });
    },
  };
}

async function loginCookie(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `password=${encodeURIComponent(ADMIN_PASSWORD)}`,
    redirect: "manual",
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function getLinksPage(baseUrl: string, query = ""): Promise<{ status: number; html: string }> {
  const cookie = await loginCookie(baseUrl);
  const res = await fetch(`${baseUrl}/admin/links${query}`, { headers: { cookie } });
  return { status: res.status, html: await res.text() };
}

test("/admin/links doi dang nhap - chua co cookie thi redirect ve trang login", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const res = await fetch(`${baseUrl}/admin/links`, { redirect: "manual" });
    // 303 (khong phai 302) - giong het cac route /admin khac, xem requireAdminAuth.
    assert.equal(res.status, 303);
    assert.match(res.headers.get("location") ?? "", /\/admin\/login/);
  } finally {
    cleanup();
  }
});

test("hien day du 7 thong tin cua 1 luot tao link thanh cong", async () => {
  const { baseUrl, logStore, ledgerStore, cleanup } = setup();
  try {
    ledgerStore.upsertUserProfile("zalo", "user-9", "Nguyễn Thảo");
    logStore.record({
      platform: "zalo",
      merchant: "shopee",
      userId: "user-9",
      originalUrl: "https://shopee.vn/product/555/777",
      subId: "k-user-9-abc",
      outcome: "success",
      errorCode: null,
      affiliateUrl: "https://bot.example/s/Xy7Zabc",
      productName: "Máy ảnh Canon EOS R50",
      commissionEstimate: 40000,
      sourceContext: "group",
      timestamp: "2026-10-05T07:04:05.000Z",
    });

    const { status, html } = await getLinksPage(baseUrl);
    assert.equal(status, 200);
    assert.match(html, /Nguyễn Thảo/);
    assert.match(html, /user-9/);
    assert.match(html, /shopee\.vn\/product\/555\/777/);
    assert.match(html, /bot\.example\/s\/Xy7Zabc/);
    assert.match(html, /Máy ảnh Canon EOS R50/);
    assert.match(html, /40\.000/);
    // Thoi gian phai co GIAY (yeu cau truc tiep cua user) - 07:04:05 UTC = 14:04:05 gio VN.
    assert.match(html, /14:04:05/);
  } finally {
    cleanup();
  }
});

test("user chua co ten hien thi -> khong hien chuoi 'null'/'undefined'", async () => {
  const { baseUrl, logStore, cleanup } = setup();
  try {
    logStore.record({
      platform: "zalo",
      merchant: "shopee",
      userId: "user-khong-ten",
      originalUrl: "https://shopee.vn/product/1/2",
      subId: "k-x",
      outcome: "success",
      errorCode: null,
      affiliateUrl: "https://bot.example/s/aaa",
    });

    const { html } = await getLinksPage(baseUrl);
    assert.match(html, /user-khong-ten/);
    assert.doesNotMatch(html, />null</);
    assert.doesNotMatch(html, />undefined</);
  } finally {
    cleanup();
  }
});

test("noi gui: 'group' hien 'Group', 'dm' hien 'DM'", async () => {
  const { baseUrl, logStore, cleanup } = setup();
  try {
    logStore.record({
      platform: "zalo",
      merchant: "shopee",
      userId: "u-group",
      originalUrl: "https://shopee.vn/product/1/2",
      subId: "s1",
      outcome: "success",
      errorCode: null,
      affiliateUrl: "https://bot.example/s/aaa",
      sourceContext: "group",
    });
    logStore.record({
      platform: "telegram",
      merchant: "shopee",
      userId: "u-dm",
      originalUrl: "https://shopee.vn/product/3/4",
      subId: "s2",
      outcome: "success",
      errorCode: null,
      affiliateUrl: "https://bot.example/s/bbb",
      sourceContext: "dm",
    });

    const { html } = await getLinksPage(baseUrl);
    assert.match(html, />Group</);
    assert.match(html, />DM</);
  } finally {
    cleanup();
  }
});

test("hoa hong = 0 (da xac minh chua bat) hien SO 0 kem giai thich, KHONG hien '—'", async () => {
  // Ranh gioi song con (xem commissionLookup.ts): "—" nghia la khong tra duoc, con 0 la cau tra
  // loi that. Hien lan nhau thi admin ket luan sai ve san pham do.
  const { baseUrl, logStore, cleanup } = setup();
  try {
    logStore.record({
      platform: "zalo",
      merchant: "shopee",
      userId: "u-zero",
      originalUrl: "https://shopee.vn/product/1/2",
      subId: "s-zero",
      outcome: "success",
      errorCode: null,
      affiliateUrl: "https://bot.example/s/aaa",
      productName: "Gối massage",
      commissionEstimate: 0,
    });

    const { html } = await getLinksPage(baseUrl);
    assert.match(html, /chưa bật hoa hồng/i);
  } finally {
    cleanup();
  }
});

test("row ghi truoc khi co 3 cot moi -> hien '—', khong bia so 0", async () => {
  const { baseUrl, logStore, cleanup } = setup();
  try {
    logStore.record({
      platform: "zalo",
      merchant: "shopee",
      userId: "u-cu",
      originalUrl: "https://shopee.vn/product/1/2",
      subId: "s-cu",
      outcome: "success",
      errorCode: null,
      affiliateUrl: "https://bot.example/s/aaa",
    });

    const { html } = await getLinksPage(baseUrl);
    assert.match(html, /—/);
    assert.doesNotMatch(html, /chưa bật hoa hồng/i);
  } finally {
    cleanup();
  }
});

test("luot LOI hien ma loi va KHONG hien link affiliate nao", async () => {
  const { baseUrl, logStore, cleanup } = setup();
  try {
    logStore.record({
      platform: "zalo",
      merchant: null,
      userId: "u-loi",
      originalUrl: "https://sv.shopee.vn/share-video/abc",
      subId: null,
      outcome: "error",
      errorCode: "NOT_A_PRODUCT_LINK",
      affiliateUrl: null,
      sourceContext: "group",
    });

    const { html } = await getLinksPage(baseUrl);
    assert.match(html, /NOT_A_PRODUCT_LINK/);
    assert.match(html, /share-video/);
  } finally {
    cleanup();
  }
});

test("loc theo outcome=error chi hien luot loi", async () => {
  const { baseUrl, logStore, cleanup } = setup();
  try {
    logStore.record({
      platform: "zalo",
      merchant: "shopee",
      userId: "u-ok",
      originalUrl: "https://shopee.vn/product/1/2",
      subId: "s-ok",
      outcome: "success",
      errorCode: null,
      affiliateUrl: "https://bot.example/s/aaa",
      productName: "San pham thanh cong",
    });
    logStore.record({
      platform: "zalo",
      merchant: null,
      userId: "u-fail",
      originalUrl: "https://khong-ho-tro.example/x",
      subId: null,
      outcome: "error",
      errorCode: "UNSUPPORTED_MERCHANT",
      affiliateUrl: null,
    });

    const { html } = await getLinksPage(baseUrl, "?outcome=error");
    assert.match(html, /u-fail/);
    assert.doesNotMatch(html, /San pham thanh cong/);
  } finally {
    cleanup();
  }
});

test("o tim kiem khop ten san pham", async () => {
  const { baseUrl, logStore, cleanup } = setup();
  try {
    logStore.record({
      platform: "zalo",
      merchant: "shopee",
      userId: "u-a",
      originalUrl: "https://shopee.vn/product/1/2",
      subId: "s-a",
      outcome: "success",
      errorCode: null,
      affiliateUrl: "https://bot.example/s/aaa",
      productName: "Gối massage cổ vai gáy",
    });
    logStore.record({
      platform: "zalo",
      merchant: "shopee",
      userId: "u-b",
      originalUrl: "https://shopee.vn/product/3/4",
      subId: "s-b",
      outcome: "success",
      errorCode: null,
      affiliateUrl: "https://bot.example/s/bbb",
      productName: "Máy ảnh Canon",
    });

    const { html } = await getLinksPage(baseUrl, "?q=massage");
    assert.match(html, /Gối massage/);
    assert.doesNotMatch(html, /Máy ảnh Canon/);
  } finally {
    cleanup();
  }
});

test("ten san pham va userId duoc ESCAPE - ca hai la chuoi do nguoi/ben thu ba cung cap", async () => {
  // productName den tu API ben thu ba, userId den tu Zalo: khong duoc phep tin cai nao trong so do.
  const { baseUrl, logStore, cleanup } = setup();
  try {
    logStore.record({
      platform: "zalo",
      merchant: "shopee",
      userId: `u"><script>alert(1)</script>`,
      originalUrl: "https://shopee.vn/product/1/2",
      subId: "s-xss",
      outcome: "success",
      errorCode: null,
      affiliateUrl: "https://bot.example/s/aaa",
      productName: `<img src=x onerror="alert(2)">`,
    });

    const { html } = await getLinksPage(baseUrl);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.doesNotMatch(html, /<img src=x onerror/);
    assert.match(html, /&lt;img src=x/);
  } finally {
    cleanup();
  }
});

test("link phan trang GIU NGUYEN bo loc dang ap dung", async () => {
  // Bam sang trang 2 ma mat bo loc la bug de gap nhat o cac trang co phan trang.
  const { baseUrl, logStore, cleanup } = setup();
  try {
    for (let i = 0; i < 60; i++) {
      logStore.record({
        platform: "zalo",
        merchant: "shopee",
        userId: `u${i}`,
        originalUrl: "https://shopee.vn/product/1/2",
        subId: `s${i}`,
        outcome: "success",
        errorCode: null,
        affiliateUrl: "https://bot.example/s/aaa",
        productName: "Gối massage",
      });
    }

    const { html } = await getLinksPage(baseUrl, "?q=massage&platform=zalo");
    assert.match(html, /\/admin\/links\?[^"]*q=massage[^"]*page=2/);
    assert.match(html, /\/admin\/links\?[^"]*platform=zalo/);
  } finally {
    cleanup();
  }
});

test("chua co luot nao -> hien trang thai rong, khong no", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const { status, html } = await getLinksPage(baseUrl);
    assert.equal(status, 200);
    assert.match(html, /Chưa có/);
  } finally {
    cleanup();
  }
});

test("muc nav 'Link đã tạo' xuat hien tren MOI trang admin, khong chi trang nay", async () => {
  // adminShell la vo trang dung chung - them route ma quen them nav thi khong ai tim thay trang.
  const { baseUrl, cleanup } = setup();
  try {
    const cookie = await loginCookie(baseUrl);
    const res = await fetch(`${baseUrl}/admin/orders`, { headers: { cookie } });
    const html = await res.text();
    assert.match(html, /href="\/admin\/links"/);
  } finally {
    cleanup();
  }
});

/** Ghi 1 luot tao link thanh cong vao 1 thoi diem cu the - dung cho nhom test loc khoang ngay. */
function seedAt(logStore: LogStore, userId: string, timestamp: string) {
  logStore.record({
    platform: "zalo",
    merchant: "shopee",
    userId,
    originalUrl: "https://shopee.vn/product/1/2",
    subId: `s-${userId}`,
    outcome: "success",
    errorCode: null,
    affiliateUrl: "https://bot.example/s/aaa",
    productName: `San pham ${userId}`,
    timestamp,
  });
}

test("loc ?from=&to= chi hien luot trong khoang (ca 2 dau tinh vao)", async () => {
  const { baseUrl, logStore, cleanup } = setup();
  try {
    seedAt(logStore, "truoc", "2026-09-30T05:00:00.000Z");
    seedAt(logStore, "dau", "2026-10-01T05:00:00.000Z");
    seedAt(logStore, "cuoi", "2026-10-03T05:00:00.000Z");
    seedAt(logStore, "sau", "2026-10-04T05:00:00.000Z");

    const { html } = await getLinksPage(baseUrl, "?from=2026-10-01&to=2026-10-03");
    assert.match(html, /San pham dau/);
    assert.match(html, /San pham cuoi/);
    assert.doesNotMatch(html, /San pham truoc/);
    assert.doesNotMatch(html, /San pham sau/);
  } finally {
    cleanup();
  }
});

test("2 o ngay GIU LAI gia tri dang loc sau khi bam Loc", async () => {
  // Bam Loc xong ma o ngay trong lai thi admin khong biet minh dang xem khoang nao.
  const { baseUrl, cleanup } = setup();
  try {
    const { html } = await getLinksPage(baseUrl, "?from=2026-10-01&to=2026-10-03");
    assert.match(html, /name="from"[^>]*value="2026-10-01"/);
    assert.match(html, /name="to"[^>]*value="2026-10-03"/);
  } finally {
    cleanup();
  }
});

test("ngay sai dinh dang bi BO QUA, khong lam vo trang hay loc rong oan", async () => {
  // ?from= la query string admin go tay duoc (hoac link cu bi hong).
  const { baseUrl, logStore, cleanup } = setup();
  try {
    seedAt(logStore, "co-that", "2026-10-02T05:00:00.000Z");

    const { status, html } = await getLinksPage(baseUrl, "?from=hom-qua&to=2026-13-99");
    assert.equal(status, 200);
    assert.match(html, /San pham co-that/);
  } finally {
    cleanup();
  }
});

test("link phan trang GIU NGUYEN khoang ngay", async () => {
  const { baseUrl, logStore, cleanup } = setup();
  try {
    for (let i = 0; i < 60; i++) seedAt(logStore, `u${i}`, "2026-10-02T05:00:00.000Z");

    const { html } = await getLinksPage(baseUrl, "?from=2026-10-01&to=2026-10-03");
    assert.match(html, /\/admin\/links\?[^"]*from=2026-10-01[^"]*/);
    assert.match(html, /\/admin\/links\?[^"]*to=2026-10-03[^"]*page=2/);
  } finally {
    cleanup();
  }
});
