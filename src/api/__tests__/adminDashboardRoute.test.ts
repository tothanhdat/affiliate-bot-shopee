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

const ADMIN_PASSWORD = "test-admin-password";
const ORDER_CONFIG = { taxPercent: 0, platformFeePercent: 0, userSharePercent: 80, maxCommissionRatioPercent: 1000 };

function setup() {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  const rateLimiter = new RateLimiter(1000, 60_000);
  const adminLoginRateLimiter = new RateLimiter(1000, 60_000);
  const resolver = new LinkResolverService(new MockAffiliateProvider(), logStore, rateLimiter);
  const adminSessionStore = new AdminSessionStore(ADMIN_PASSWORD);
  const withdrawalProofDir = mkdtempSync(join(tmpdir(), "withdrawal-proofs-"));

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
    async () => {},
    async () => {}
  );
  const httpServer = app.listen(0);
  const port = (httpServer.address() as AddressInfo).port;

  return {
    logStore,
    ledgerStore,
    baseUrl: `http://127.0.0.1:${port}`,
    cleanup() {
      // closeAllConnections() BAT BUOC: fetch() cua Node giu socket keep-alive, httpServer.close()
      // mot minh se cho vo thoi han va treo ca lan chay test.
      httpServer.closeAllConnections();
      httpServer.close();
      rateLimiter.stop();
      adminLoginRateLimiter.stop();
      logStore.close();
      ledgerStore.close();
      rmSync(withdrawalProofDir, { recursive: true, force: true });
    },
  };
}

async function loginAndGetCookie(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `password=${encodeURIComponent(ADMIN_PASSWORD)}`,
    redirect: "manual",
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

const todayVn = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });

test("GET /admin/dashboard: chua dang nhap -> khong lo so lieu", async () => {
  const { baseUrl, cleanup } = setup();
  const res = await fetch(`${baseUrl}/admin/dashboard`, { redirect: "manual" });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/admin/login");
  cleanup();
});

test("GET /admin: redirect ve dashboard (trang mac dinh cua khu admin)", async () => {
  const { baseUrl, cleanup } = setup();
  const cookie = await loginAndGetCookie(baseUrl);
  const res = await fetch(`${baseUrl}/admin`, { headers: { cookie }, redirect: "manual" });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/admin/dashboard");
  cleanup();
});

test("GET /admin/dashboard: DB rong van render duoc (khong 500)", async () => {
  const { baseUrl, cleanup } = setup();
  const cookie = await loginAndGetCookie(baseUrl);
  const res = await fetch(`${baseUrl}/admin/dashboard`, { headers: { cookie } });
  const html = await res.text();

  assert.equal(res.status, 200);
  assert.match(html, /Đơn hàng mới mỗi ngày/);
  assert.match(html, /Chưa có đơn nào trong kỳ này/);
  // Khong duoc in ra "NaN" o bat ky the nao khi chia 0/0 (vd ti le loi khi chua co luot nao).
  assert.doesNotMatch(html, /NaN/);
  cleanup();
});

test("GET /admin/dashboard: hien so lieu that len the KPI", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  ledgerStore.recordConversion({
    subId: "k-u1-1",
    platform: "zalo",
    userId: "u1",
    merchant: "shopee",
    orderId: "ORD-A",
    orderAmount: 1_000_000,
    commissionAmount: 100_000,
    orderDate: todayVn(),
    ...ORDER_CONFIG,
  });

  const cookie = await loginAndGetCookie(baseUrl);
  const res = await fetch(`${baseUrl}/admin/dashboard?range=today`, { headers: { cookie } });
  const html = await res.text();

  assert.match(html, /100\.000đ/); // hoa hong goc
  assert.match(html, /80\.000đ/); // dang no user (80%)
  assert.match(html, /20\.000đ/); // loi nhuan chu bot (20%)
  cleanup();
});

test("GET /admin/dashboard: hoa hong le cua Shopee duoc lam tron khi hien thi", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  // Shopee tra hoa hong le toi phan nghin dong (vd 22.990,5d) - de nguyen thi tong nhieu don hien
  // "146.457,765đ" tren the KPI, trong nhu loi he thong.
  ledgerStore.recordConversion({
    subId: "k-le-1",
    platform: "zalo",
    userId: "u-le",
    merchant: "shopee",
    orderId: "ORD-LE",
    orderAmount: 306_540,
    commissionAmount: 22_990.5,
    orderDate: todayVn(),
    ...ORDER_CONFIG,
  });

  const cookie = await loginAndGetCookie(baseUrl);
  const html = await fetch(`${baseUrl}/admin/dashboard?range=today`, { headers: { cookie } }).then((r) =>
    r.text()
  );

  assert.match(html, /22\.991đ/);
  // Khong duoc con dau vet cua phan le tren the KPI.
  assert.doesNotMatch(html, /kpi-value">[^<]*,\d/);
  cleanup();
});

test("GET /admin/dashboard: ?range la -> ve mac dinh 7 ngay, khong 500", async () => {
  const { baseUrl, cleanup } = setup();
  const cookie = await loginAndGetCookie(baseUrl);
  const res = await fetch(`${baseUrl}/admin/dashboard?range=../../etc/passwd`, { headers: { cookie } });

  assert.equal(res.status, 200);
  assert.match(await res.text(), /7 ngày qua/);
  cleanup();
});

test("GET /admin/dashboard: userId KHONG duoc noi thang vao ma JS (chan XSS)", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  // userId do nguoi la quyet dinh (uid Zalo/Telegram) - neu co ngay bi nhet chuoi nay vao thi no
  // phai nam trong JSON da escape, khong duoc thoat ra thanh ma chay duoc.
  const evilUserId = '</script><img src=x onerror=alert(1)>';
  ledgerStore.recordConversion({
    subId: "k-evil-1",
    platform: "zalo",
    userId: evilUserId,
    merchant: "shopee",
    orderId: "ORD-EVIL",
    orderAmount: 1_000_000,
    commissionAmount: 50_000,
    orderDate: todayVn(),
    ...ORDER_CONFIG,
  });

  const cookie = await loginAndGetCookie(baseUrl);
  const html = await fetch(`${baseUrl}/admin/dashboard?range=today`, { headers: { cookie } }).then((r) =>
    r.text()
  );

  // Thuoc tinh can bao dam KHONG phai la "chuoi do bien mat" - no van phai nam trong du lieu de
  // ve chart. Thuoc tinh can bao dam la no khong THOAT ra duoc: moi dau "<" do user nhap phai
  // thanh \u003c, nen trinh duyet khong dong som the <script> va khong co the HTML nao moc ra.
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /\\u003c\/script>\\u003cimg src=x/);

  // Va chuoi do khong duoc lot vao dung dang HTML o bat ky the nao khac tren trang.
  assert.doesNotMatch(html, /<\/script><img/);
  cleanup();
});

test("GET /admin/dashboard: chart chinh LUON kem bang so lieu (CDN hong van doc duoc)", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  ledgerStore.recordConversion({
    subId: "k-u2-1",
    platform: "zalo",
    userId: "u2",
    merchant: "shopee",
    orderId: "ORD-B",
    orderAmount: 500_000,
    commissionAmount: 30_000,
    orderDate: todayVn(),
    ...ORDER_CONFIG,
  });

  const cookie = await loginAndGetCookie(baseUrl);
  const html = await fetch(`${baseUrl}/admin/dashboard?range=today`, { headers: { cookie } }).then((r) =>
    r.text()
  );

  assert.match(html, /Xem số liệu dạng bảng/);
  // Bang nay la kenh doc so lieu thu hai (CVD + CDN hong) - phai co dong du lieu that, khong rong.
  assert.match(html, /<td>\d{2}\/\d{2}<\/td>/);
  cleanup();
});

test("GET /admin/dashboard: the 'Chờ duyệt rút' noi bat + co link xu ly khi dang co yeu cau", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  ledgerStore.recordConversion({
    subId: "k-rut-1",
    platform: "zalo",
    userId: "u-rut",
    merchant: "shopee",
    orderId: "ORD-RUT",
    orderAmount: 1_000_000,
    commissionAmount: 100_000,
    orderDate: todayVn(),
    ...ORDER_CONFIG,
  });
  ledgerStore.requestWithdrawal("zalo", "u-rut", 80_000, {
    bankName: "Vietcombank",
    bankAccountNumber: "001",
    bankAccountHolder: "NGUYEN VAN A",
  });

  const cookie = await loginAndGetCookie(baseUrl);
  const html = await fetch(`${baseUrl}/admin/dashboard?range=today`, { headers: { cookie } }).then((r) =>
    r.text()
  );

  assert.match(html, /class="kpi-card kpi-alert"/);
  // Mau KHONG duoc la kenh duy nhat - phai co ca chu.
  assert.match(html, /Cần xử lý/);
  assert.match(html, /href="\/admin\/withdrawals"[^>]*>Xử lý ngay/);
  cleanup();
});

test("GET /admin/dashboard: khong co yeu cau rut -> KHONG bao dong gia", async () => {
  const { baseUrl, cleanup } = setup();
  const cookie = await loginAndGetCookie(baseUrl);
  const html = await fetch(`${baseUrl}/admin/dashboard`, { headers: { cookie } }).then((r) => r.text());

  // Luu y: chuoi "kpi-alert" CO xuat hien trong <style> cua moi trang (dinh nghia CSS), nen
  // phai khop dung class cua the chu khong phai chuoi tu do.
  assert.doesNotMatch(html, /class="kpi-card kpi-alert"/);
  assert.doesNotMatch(html, /Cần xử lý/);
  cleanup();
});

test("GET /admin/dashboard: chart top user hien TEN user thay vi userId", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  ledgerStore.upsertUserProfile("zalo", "8431002910", "Ngọc Ánh");
  ledgerStore.recordConversion({
    subId: "k-ten-1",
    platform: "zalo",
    userId: "8431002910",
    merchant: "shopee",
    orderId: "ORD-TEN",
    orderAmount: 1_000_000,
    commissionAmount: 60_000,
    orderDate: todayVn(),
    ...ORDER_CONFIG,
  });

  const cookie = await loginAndGetCookie(baseUrl);
  const html = await fetch(`${baseUrl}/admin/dashboard?range=today`, { headers: { cookie } }).then((r) =>
    r.text()
  );

  const json = /id="dashboard-data">(.*?)<\/script>/s.exec(html)?.[1] ?? "";
  const data = JSON.parse(json);
  assert.deepEqual(data.topUsers.labels, ["Ngọc Ánh"]);
  // userId van phai con trong tooltip - 2 user co the trung ten.
  assert.match(data.topUsers.tooltips[0], /8431002910/);
  cleanup();
});

test("GET /admin/dashboard: chieu cao chart top user co theo so user", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  for (let i = 0; i < 3; i++) {
    ledgerStore.recordConversion({
      subId: `k-h-${i}`,
      platform: "zalo",
      userId: `u-h-${i}`,
      merchant: "shopee",
      orderId: `ORD-H-${i}`,
      orderAmount: 1_000_000,
      commissionAmount: 10_000 * (i + 1),
      orderDate: todayVn(),
      ...ORDER_CONFIG,
    });
  }

  const cookie = await loginAndGetCookie(baseUrl);
  const html = await fetch(`${baseUrl}/admin/dashboard?range=today`, { headers: { cookie } }).then((r) =>
    r.text()
  );

  // 3 user -> 3*34 + 60 = 162px (khong phai chieu cao chet 330px cua cac chart khac).
  assert.match(html, /style="height: 162px"/);
  cleanup();
});

test("GET /admin/dashboard: co du 4 lua chon ky xem, ke ca 'Tháng trước'", async () => {
  const { baseUrl, cleanup } = setup();
  const cookie = await loginAndGetCookie(baseUrl);
  const html = await fetch(`${baseUrl}/admin/dashboard`, { headers: { cookie } }).then((r) => r.text());

  for (const r of ["today", "7d", "month", "lastMonth"]) {
    assert.match(html, new RegExp(`href="/admin/dashboard\\?range=${r}"`));
  }
  assert.match(html, /Tháng trước/);
  cleanup();
});

test("GET /admin/dashboard: ?range=lastMonth duoc nhan, khong roi ve mac dinh", async () => {
  const { baseUrl, cleanup } = setup();
  const cookie = await loginAndGetCookie(baseUrl);
  const html = await fetch(`${baseUrl}/admin/dashboard?range=lastMonth`, { headers: { cookie } }).then(
    (r) => r.text()
  );

  assert.match(html, /class="range-link active"[^>]*>Tháng trước/);
  cleanup();
});

test("GET /admin/dashboard: moi the co chip nhom cua rieng no, nam TRONG the", async () => {
  const { baseUrl, cleanup } = setup();
  const cookie = await loginAndGetCookie(baseUrl);
  const html = await fetch(`${baseUrl}/admin/dashboard`, { headers: { cookie } }).then((r) => r.text());

  // 12 the -> 12 chip (khong con hang tieu de rieng cho nhom: tren man hep moi chip an tron 1 hang).
  assert.equal(html.match(/class="kpi-chip"/g)?.length, 12);
  // Chip phai nam TRONG the: hang dau cua the gom nhan + chip.
  assert.match(html, /class="kpi-top">\s*<span class="kpi-label">/);
  // 4 nhom, moi nhom 3 the.
  assert.equal(html.match(/>Hoạt động bot</g)?.length, 3);
  cleanup();
});
