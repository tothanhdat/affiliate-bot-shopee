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
    // Bo loc "Kenh" da bi go (2026-10-10): ?platform= cu bi bo qua, khong con lan vao link phan trang.
    assert.doesNotMatch(html, /\/admin\/links\?[^"]*platform=/);
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

test("2 o ngay gio GIU LAI gia tri dang loc sau khi bam Loc (link cu chi co ngay -> 00:00 / 23:59)", async () => {
  // Bam Loc xong ma o trong lai thi admin khong biet minh dang xem khoang nao.
  const { baseUrl, cleanup } = setup();
  try {
    const { html } = await getLinksPage(baseUrl, "?from=2026-10-01&to=2026-10-03");
    assert.match(html, /name="from"[^>]*value="2026-10-01T00:00"/);
    assert.match(html, /name="to"[^>]*value="2026-10-03T23:59"/);
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

// Cot Sub_id (2026-10-10): dung de doi chieu voi Sub_id1-5 cua bao cao Shopee.
const SAMPLE_SUB_ID = "k-2233805738531852881-mv17ndbz-18d664";

test("cot Sub_id: hien sub_id day du (title + nut copy), cat gon bang CSS chu khong cat chuoi", async () => {
  const { baseUrl, logStore, cleanup } = setup();
  try {
    logStore.record({
      platform: "zalo",
      merchant: "shopee",
      userId: "u-1",
      originalUrl: "https://shopee.vn/product/1/2",
      subId: SAMPLE_SUB_ID,
      outcome: "success",
      errorCode: null,
      affiliateUrl: "https://bot.example/s/aaa",
    });

    const { html } = await getLinksPage(baseUrl);
    assert.match(html, /<th[^>]*>Sub_id<\/th>/);
    // Chuoi day du nam trong title va trong ham copy -> admin lay duoc nguyen ven du o bi cat.
    assert.match(html, new RegExp(`title="${SAMPLE_SUB_ID}"`));
    assert.match(html, new RegExp(`writeText\\('${SAMPLE_SUB_ID}'\\)`));
    assert.match(html, /Sao chép Sub_id/);
    // Cat bang class `truncate`, KHONG cat chuoi o server (se mat doan cuoi dung de doi chieu).
    assert.match(html, new RegExp(`class="[^"]*truncate[^"]*"[^>]*title="${SAMPLE_SUB_ID}"`));
  } finally {
    cleanup();
  }
});

test("cot Sub_id: dong khong co sub_id hien '—', khong hien 'null'", async () => {
  const { baseUrl, logStore, cleanup } = setup();
  try {
    logStore.record({
      platform: "zalo",
      merchant: "shopee",
      userId: "u-cu",
      originalUrl: "https://shopee.vn/product/1/2",
      subId: null,
      outcome: "error",
      errorCode: "INVALID_LINK",
      affiliateUrl: null,
    });
    const { html } = await getLinksPage(baseUrl);
    assert.doesNotMatch(html, /Sao chép Sub_id/);
    assert.doesNotMatch(html, />null</);
  } finally {
    cleanup();
  }
});

test("cot Sub_id: ky tu dac biet trong sub_id bi escape", async () => {
  const { baseUrl, logStore, cleanup } = setup();
  try {
    logStore.record({
      platform: "zalo",
      merchant: "shopee",
      userId: "u-1",
      originalUrl: "https://shopee.vn/product/1/2",
      subId: `k-"><script>alert(1)</script>`,
      outcome: "success",
      errorCode: null,
      affiliateUrl: "https://bot.example/s/aaa",
    });
    const { html } = await getLinksPage(baseUrl);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  } finally {
    cleanup();
  }
});

// O "Noi gui" (2026-10-10, yeu cau user): chi kinh doanh tren Zalo nen bo chip kenh "Zalo" - chi con
// chip noi gui (Group/DM/API) + chip san. Bo loc "Kenh" o thanh tren van giu nguyen.
test("o Noi gui KHONG con chip kenh Zalo, van con chip noi gui + chip san", async () => {
  const { baseUrl, logStore, cleanup } = setup();
  try {
    logStore.record({
      platform: "zalo",
      merchant: "shopee",
      userId: "u-1",
      originalUrl: "https://shopee.vn/product/1/2",
      subId: SAMPLE_SUB_ID,
      outcome: "success",
      errorCode: null,
      affiliateUrl: "https://bot.example/s/aaa",
      sourceContext: "group",
    });
    const { html } = await getLinksPage(baseUrl);
    const tbody = html.match(/<tbody[\s\S]*?<\/tbody>/)?.[0] ?? "";
    assert.notEqual(tbody, "");
    assert.doesNotMatch(tbody, /Zalo/);
    assert.match(tbody, /Group/);
    assert.match(tbody, /Shopee/);
  } finally {
    cleanup();
  }
});


// Bo loc "Kenh" da bi go + bo loc ngay doi thanh ngay GIO (2026-10-10, yeu cau truc tiep cua user).
test("form loc KHONG con o chon Kenh; 2 o thoi gian la datetime-local", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const { html } = await getLinksPage(baseUrl);
    assert.doesNotMatch(html, /name="platform"/);
    assert.doesNotMatch(html, /for="links-platform"/);
    assert.match(html, /<input type="datetime-local"[^>]*name="from"/);
    assert.match(html, /<input type="datetime-local"[^>]*name="to"/);
  } finally {
    cleanup();
  }
});

test("loc theo gio phut GIO VN: 23:00 -> 23:59 ngay 9/10 giu dung luot trong khoang, ke ca giay :30 cua phut 23:59", async () => {
  const { baseUrl, logStore, cleanup } = setup();
  try {
    // Gio VN = UTC + 7: 22:59:59 VN = 15:59:59Z, 23:00:00 VN = 16:00:00Z, 23:59:30 VN = 16:59:30Z.
    seedAt(logStore, "truoc-23h", "2026-10-09T15:59:59.000Z");
    seedAt(logStore, "dung-23h", "2026-10-09T16:00:00.000Z");
    seedAt(logStore, "giua", "2026-10-09T16:30:00.000Z");
    seedAt(logStore, "cuoi-phut", "2026-10-09T16:59:30.000Z");
    seedAt(logStore, "qua-nua-dem", "2026-10-09T17:00:00.000Z");

    const { html } = await getLinksPage(baseUrl, "?from=2026-10-09T23:00&to=2026-10-09T23:59");
    assert.match(html, /San pham dung-23h/);
    assert.match(html, /San pham giua/);
    assert.match(html, /San pham cuoi-phut/);
    assert.doesNotMatch(html, /San pham truoc-23h/);
    assert.doesNotMatch(html, /San pham qua-nua-dem/);
  } finally {
    cleanup();
  }
});

test("o thoi gian giu lai gio phut, link phan trang giu nguyen khoang gio", async () => {
  const { baseUrl, logStore, cleanup } = setup();
  try {
    for (let i = 0; i < 60; i++) seedAt(logStore, `u${i}`, "2026-10-09T16:30:00.000Z");
    const { html } = await getLinksPage(baseUrl, "?from=2026-10-09T23:00&to=2026-10-09T23:59");
    assert.match(html, /name="from"[^>]*value="2026-10-09T23:00"/);
    assert.match(html, /name="to"[^>]*value="2026-10-09T23:59"/);
    assert.match(html, /\/admin\/links\?[^"]*from=2026-10-09T23%3A00[^"]*page=2/);
  } finally {
    cleanup();
  }
});

test("gio sai (25:00, 23:61) hoac ngay khong co that bi BO QUA, khong lam vo trang", async () => {
  const { baseUrl, logStore, cleanup } = setup();
  try {
    seedAt(logStore, "co-that", "2026-10-02T05:00:00.000Z");
    for (const q of ["?from=2026-10-09T25:00", "?to=2026-10-09T23:61", "?from=2026-02-31T10:00", "?from=2026-10-09T10"]) {
      const { status, html } = await getLinksPage(baseUrl, q);
      assert.equal(status, 200, q);
      assert.match(html, /San pham co-that/, q);
    }
  } finally {
    cleanup();
  }
});

test("o tim kiem tim duoc theo Sub_id, placeholder noi ro", async () => {
  const { baseUrl, logStore, cleanup } = setup();
  try {
    logStore.record({
      platform: "zalo",
      merchant: "shopee",
      userId: "u-1",
      originalUrl: "https://shopee.vn/product/1/2",
      subId: SAMPLE_SUB_ID,
      outcome: "success",
      errorCode: null,
      affiliateUrl: "https://bot.example/s/aaa",
      productName: "Co sub id",
    });
    logStore.record({
      platform: "zalo",
      merchant: "shopee",
      userId: "u-2",
      originalUrl: "https://shopee.vn/product/3/4",
      subId: "k-khac-hoan-toan",
      outcome: "success",
      errorCode: null,
      affiliateUrl: "https://bot.example/s/bbb",
      productName: "Khong khop",
    });

    const { html } = await getLinksPage(baseUrl, `?q=${encodeURIComponent(SAMPLE_SUB_ID)}`);
    assert.match(html, /Co sub id/);
    assert.doesNotMatch(html, /Khong khop/);
    assert.match(html, /placeholder="[^"]*Sub_id[^"]*"/);
  } finally {
    cleanup();
  }
});

// The KPI "Hoa hong uoc tinh" da bi go (2026-10-10, yeu cau user): user tao link khong dong nghia
// voi mua hang nen tong hoa hong uoc tinh de doc nham thanh doanh thu. COT cung ten trong bang van giu.
test("trang Link da tao KHONG con the KPI 'Hoa hong uoc tinh' (cot trong bang van con), con 3 the", async () => {
  const { baseUrl, logStore, cleanup } = setup();
  try {
    logStore.record({
      platform: "zalo",
      merchant: "shopee",
      userId: "u-1",
      originalUrl: "https://shopee.vn/product/1/2",
      subId: SAMPLE_SUB_ID,
      outcome: "success",
      errorCode: null,
      affiliateUrl: "https://bot.example/s/aaa",
      commissionEstimate: 40_000,
    });
    const { html } = await getLinksPage(baseUrl);
    const kpiRegion = html.slice(0, html.indexOf('id="links-q"')).replace(/<style>[\s\S]*?<\/style>/g, "");
    assert.doesNotMatch(kpiRegion, /Hoa hồng ước tính/);
    assert.doesNotMatch(kpiRegion, /chỉ lượt tra được giá/);
    for (const label of ["Tổng lượt tạo link", "Tạo thành công", "Lượt lỗi"]) {
      assert.match(kpiRegion, new RegExp(label));
    }
    assert.match(html, /<th[^>]*>Hoa hồng ước tính<\/th>/, "cot trong bang van giu");
  } finally {
    cleanup();
  }
});
