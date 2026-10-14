import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
const ORDER_CONFIG = {
  taxPercent: 0,
  platformFeePercent: 0,
  userSharePercent: 80,
  maxCommissionRatioPercent: 1000,
  holdConfig: { thresholdVnd: 0, holdDays: 0 },
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);

function setup() {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  const rateLimiter = new RateLimiter(1000, 60_000);
  const adminLoginRateLimiter = new RateLimiter(1000, 60_000);
  const resolver = new LinkResolverService(new MockAffiliateProvider(), logStore, rateLimiter);
  const adminSessionStore = new AdminSessionStore(ADMIN_PASSWORD);
  const proofDir = mkdtempSync(join(tmpdir(), "withdrawal-proofs-"));
  const tipsImageDir = mkdtempSync(join(tmpdir(), "tips-images-"));

  const app = createServer(
    resolver,
    logStore,
    ledgerStore,
    async () => {},
    50_000,
    adminSessionStore,
    ORDER_CONFIG,
    proofDir,
    adminLoginRateLimiter,
    "http://localhost:3002",
    async () => {},
    undefined, // notifyZaloGroup
    true, // orderImageEnabled
    undefined, // syncZaloGroupMembers
    undefined, // syncTiktokOrders
    tipsImageDir
  );
  const httpServer = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

  function cleanup() {
    httpServer.close();
    rateLimiter.stop();
    adminLoginRateLimiter.stop();
    logStore.close();
    ledgerStore.close();
    rmSync(proofDir, { recursive: true, force: true });
    rmSync(tipsImageDir, { recursive: true, force: true });
  }
  return { ledgerStore, baseUrl, tipsImageDir, cleanup };
}

async function login(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `password=${encodeURIComponent(ADMIN_PASSWORD)}`,
    redirect: "manual",
  });
  const cookie = res.headers.get("set-cookie");
  assert.ok(cookie, "dang nhap phai tra cookie");
  return cookie.split(";")[0];
}

function tipForm(
  fields: Record<string, string>,
  image?: { bytes: Uint8Array; type: string; name: string }
): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.append(key, value);
  if (image) formData.append("image", new Blob([image.bytes], { type: image.type }), image.name);
  return formData;
}

function post(baseUrl: string, path: string, cookie: string | null, body: FormData | URLSearchParams) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: cookie ? { cookie } : {},
    body,
    redirect: "manual",
  });
}

test("chua dang nhap: moi route /admin/tips* redirect ve /admin/login", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const get = await fetch(`${baseUrl}/admin/tips`, { redirect: "manual" });
    assert.equal(get.status, 303);
    assert.equal(get.headers.get("location"), "/admin/login");
    for (const path of ["/admin/tips", "/admin/tips/1", "/admin/tips/1/active", "/admin/tips/1/delete"]) {
      const res = await post(baseUrl, path, null, new URLSearchParams());
      assert.equal(res.status, 303, path);
      assert.equal(res.headers.get("location"), "/admin/login", path);
    }
  } finally {
    cleanup();
  }
});

test("GET /admin/tips: 200, co muc Tips trong menu va trang thai rong", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    const res = await fetch(`${baseUrl}/admin/tips`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /href="\/admin\/tips"/);
    assert.match(html, /Chưa có Tip nào/);
  } finally {
    cleanup();
  }
});

test("tao Tip co anh PNG: 303, ghi DB, file nam trong TIPS_IMAGE_DIR voi duoi .png", async () => {
  const { baseUrl, ledgerStore, tipsImageDir, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    const res = await post(
      baseUrl,
      "/admin/tips",
      cookie,
      tipForm({ title: "Meo 1", description: "Noi dung" }, { bytes: PNG, type: "image/png", name: "x.png" })
    );
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/admin/tips");
    const [created] = ledgerStore.listTips();
    assert.equal(created.title, "Meo 1");
    assert.match(created.imagePath ?? "", /\.png$/);
    assert.equal(existsSync(join(tipsImageDir, created.imagePath as string)), true);
  } finally {
    cleanup();
  }
});

test("tao Tip khong anh: duoc", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    const res = await post(baseUrl, "/admin/tips", cookie, tipForm({ title: "Chi co chu", description: "" }));
    assert.equal(res.status, 303);
    assert.equal(ledgerStore.listTips()[0].imagePath, null);
  } finally {
    cleanup();
  }
});

test("tao Tip: file GIA MAO (mimetype image/png nhung noi dung la chu) -> 422, khong ghi DB, khong ghi file", async () => {
  const { baseUrl, ledgerStore, tipsImageDir, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    const fake = new TextEncoder().encode("day khong phai anh");
    const res = await post(
      baseUrl,
      "/admin/tips",
      cookie,
      tipForm({ title: "Gia mao", description: "mo ta giu lai" }, { bytes: fake, type: "image/png", name: "fake.png" })
    );
    assert.equal(res.status, 422);
    const html = await res.text();
    assert.match(html, /Ảnh phải là JPG, PNG hoặc WebP/);
    assert.match(html, /value="Gia mao"/); // giu nguyen chu da go
    assert.match(html, />mo ta giu lai<\/textarea>/);
    assert.equal(ledgerStore.listTips().length, 0);
    assert.deepEqual(existsSync(tipsImageDir) ? readdirSync(tipsImageDir) : [], []);
  } finally {
    cleanup();
  }
});

test("tao Tip: SVG bi tu choi", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const res = await post(
      baseUrl,
      "/admin/tips",
      cookie,
      tipForm({ title: "SVG", description: "" }, { bytes: svg, type: "image/svg+xml", name: "a.svg" })
    );
    assert.equal(res.status, 422);
    assert.equal(ledgerStore.listTips().length, 0);
  } finally {
    cleanup();
  }
});

test("tao Tip: anh > 5MB -> 422 voi thong bao ro, khong ghi gi", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG);
    const res = await post(
      baseUrl,
      "/admin/tips",
      cookie,
      tipForm({ title: "Anh to", description: "" }, { bytes: big, type: "image/png", name: "big.png" })
    );
    assert.equal(res.status, 422);
    assert.match(await res.text(), /Ảnh quá lớn, tối đa 5MB/);
    assert.equal(ledgerStore.listTips().length, 0);
  } finally {
    cleanup();
  }
});

test("tao Tip: tieu de rong -> 422 va giu nguyen mo ta da go", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    const res = await post(baseUrl, "/admin/tips", cookie, tipForm({ title: "  ", description: "mo ta dai" }));
    assert.equal(res.status, 422);
    const html = await res.text();
    assert.match(html, /Tiêu đề không được để trống/);
    assert.match(html, />mo ta dai<\/textarea>/);
    assert.equal(ledgerStore.listTips().length, 0);
  } finally {
    cleanup();
  }
});

test("sua Tip: doi chu va GIU anh khi khong chon gi", async () => {
  const { baseUrl, ledgerStore, tipsImageDir, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    await post(
      baseUrl,
      "/admin/tips",
      cookie,
      tipForm({ title: "Cu", description: "" }, { bytes: PNG, type: "image/png", name: "a.png" })
    );
    const created = ledgerStore.listTips()[0];
    const res = await post(
      baseUrl,
      `/admin/tips/${created.id}`,
      cookie,
      tipForm({ title: "Moi", description: "mo ta moi", imageAction: "keep" })
    );
    assert.equal(res.status, 303);
    const after = ledgerStore.getTipById(created.id);
    assert.equal(after?.title, "Moi");
    assert.equal(after?.imagePath, created.imagePath);
    assert.equal(existsSync(join(tipsImageDir, created.imagePath as string)), true);
  } finally {
    cleanup();
  }
});

test("sua Tip: thay anh -> file cu bi xoa, file moi ton tai", async () => {
  const { baseUrl, ledgerStore, tipsImageDir, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    await post(
      baseUrl,
      "/admin/tips",
      cookie,
      tipForm({ title: "T", description: "" }, { bytes: PNG, type: "image/png", name: "a.png" })
    );
    const created = ledgerStore.listTips()[0];
    const oldFile = created.imagePath as string;
    const res = await post(
      baseUrl,
      `/admin/tips/${created.id}`,
      cookie,
      tipForm({ title: "T", description: "", imageAction: "replace" }, { bytes: JPEG, type: "image/jpeg", name: "b.jpg" })
    );
    assert.equal(res.status, 303);
    const after = ledgerStore.getTipById(created.id);
    assert.match(after?.imagePath ?? "", /\.jpg$/);
    assert.equal(existsSync(join(tipsImageDir, oldFile)), false);
    assert.equal(existsSync(join(tipsImageDir, after?.imagePath as string)), true);
  } finally {
    cleanup();
  }
});

test("sua Tip: chon file nhung radio van de 'keep' -> van coi la thay anh (khong bo qua im lang)", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    await post(baseUrl, "/admin/tips", cookie, tipForm({ title: "T", description: "" }));
    const created = ledgerStore.listTips()[0];
    const res = await post(
      baseUrl,
      `/admin/tips/${created.id}`,
      cookie,
      tipForm({ title: "T", description: "", imageAction: "keep" }, { bytes: PNG, type: "image/png", name: "a.png" })
    );
    assert.equal(res.status, 303);
    assert.match(ledgerStore.getTipById(created.id)?.imagePath ?? "", /\.png$/);
  } finally {
    cleanup();
  }
});

test("sua Tip: bo anh -> imagePath null va file bi xoa", async () => {
  const { baseUrl, ledgerStore, tipsImageDir, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    await post(
      baseUrl,
      "/admin/tips",
      cookie,
      tipForm({ title: "T", description: "" }, { bytes: PNG, type: "image/png", name: "a.png" })
    );
    const created = ledgerStore.listTips()[0];
    const res = await post(
      baseUrl,
      `/admin/tips/${created.id}`,
      cookie,
      tipForm({ title: "T", description: "", imageAction: "remove" })
    );
    assert.equal(res.status, 303);
    assert.equal(ledgerStore.getTipById(created.id)?.imagePath, null);
    assert.equal(existsSync(join(tipsImageDir, created.imagePath as string)), false);
  } finally {
    cleanup();
  }
});

test("sua Tip: 'replace' ma khong co file -> 422, giu nguyen anh cu", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    await post(
      baseUrl,
      "/admin/tips",
      cookie,
      tipForm({ title: "T", description: "" }, { bytes: PNG, type: "image/png", name: "a.png" })
    );
    const created = ledgerStore.listTips()[0];
    const res = await post(
      baseUrl,
      `/admin/tips/${created.id}`,
      cookie,
      tipForm({ title: "T", description: "", imageAction: "replace" })
    );
    assert.equal(res.status, 422);
    assert.equal(ledgerStore.getTipById(created.id)?.imagePath, created.imagePath);
  } finally {
    cleanup();
  }
});

test("sua Tip: tieu de rong -> 422, file anh moi vua upload KHONG bi bo mo coi", async () => {
  const { baseUrl, ledgerStore, tipsImageDir, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    await post(baseUrl, "/admin/tips", cookie, tipForm({ title: "T", description: "" }));
    const created = ledgerStore.listTips()[0];
    const res = await post(
      baseUrl,
      `/admin/tips/${created.id}`,
      cookie,
      tipForm({ title: " ", description: "" }, { bytes: PNG, type: "image/png", name: "a.png" })
    );
    assert.equal(res.status, 422);
    assert.deepEqual(existsSync(tipsImageDir) ? readdirSync(tipsImageDir) : [], []);
  } finally {
    cleanup();
  }
});

test("sua Tip khong ton tai -> 404", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    const res = await post(baseUrl, "/admin/tips/9999", cookie, tipForm({ title: "T", description: "" }));
    assert.equal(res.status, 404);
  } finally {
    cleanup();
  }
});

test("tat / bat Tip qua POST /admin/tips/:id/active", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    await post(baseUrl, "/admin/tips", cookie, tipForm({ title: "T", description: "" }));
    const id = ledgerStore.listTips()[0].id;

    const off = await post(baseUrl, `/admin/tips/${id}/active`, cookie, new URLSearchParams({ active: "0" }));
    assert.equal(off.status, 303);
    assert.equal(ledgerStore.getTipById(id)?.isActive, false);

    const on = await post(baseUrl, `/admin/tips/${id}/active`, cookie, new URLSearchParams({ active: "1" }));
    assert.equal(on.status, 303);
    assert.equal(ledgerStore.getTipById(id)?.isActive, true);

    const missing = await post(baseUrl, "/admin/tips/9999/active", cookie, new URLSearchParams({ active: "0" }));
    assert.equal(missing.status, 404);
  } finally {
    cleanup();
  }
});

test("xoa Tip: xoa ban ghi VA file anh; id khong co -> 404", async () => {
  const { baseUrl, ledgerStore, tipsImageDir, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    await post(
      baseUrl,
      "/admin/tips",
      cookie,
      tipForm({ title: "T", description: "" }, { bytes: PNG, type: "image/png", name: "a.png" })
    );
    const created = ledgerStore.listTips()[0];
    const res = await post(baseUrl, `/admin/tips/${created.id}/delete`, cookie, new URLSearchParams());
    assert.equal(res.status, 303);
    assert.equal(ledgerStore.listTips().length, 0);
    assert.equal(existsSync(join(tipsImageDir, created.imagePath as string)), false);

    const again = await post(baseUrl, `/admin/tips/${created.id}/delete`, cookie, new URLSearchParams());
    assert.equal(again.status, 404);
  } finally {
    cleanup();
  }
});

async function reorder(baseUrl: string, cookie: string | null, body: unknown) {
  const res = await fetch(`${baseUrl}/admin/tips/reorder`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  return { status: res.status, json: (await res.json()) as { ok: boolean; message?: string } };
}

function seedThree(store: LedgerStore): number[] {
  return ["A", "B", "C"].map((title) => store.createTip({ title, description: "", imagePath: null }).id);
}

test("reorder chua dang nhap -> JSON 401 (KHONG redirect ve trang login)", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const { status, json } = await reorder(baseUrl, null, { ids: [] });
    assert.equal(status, 401);
    assert.equal(json.ok, false);
  } finally {
    cleanup();
  }
});

test("reorder: hoan vi dung -> 200 va thu tu moi duoc luu", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    const [a, b, c] = seedThree(ledgerStore);
    const { status, json } = await reorder(baseUrl, cookie, { ids: [c, a, b] });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.deepEqual(ledgerStore.listTips().map((tip) => tip.title), ["C", "A", "B"]);
  } finally {
    cleanup();
  }
});

test("reorder: thieu / thua / trung / sai kieu -> 422 va DB khong doi", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    const [a, b, c] = seedThree(ledgerStore);
    for (const ids of [[a, b], [a, b, c, 9999], [a, a, b], ["x", "y", "z"], "khong phai mang"]) {
      const { status, json } = await reorder(baseUrl, cookie, { ids });
      assert.equal(status, 422, JSON.stringify(ids));
      assert.equal(json.ok, false);
    }
    assert.deepEqual(ledgerStore.listTips().map((tip) => tip.title), ["A", "B", "C"]);
  } finally {
    cleanup();
  }
});

test("reorder: khong bi hieu nham la mot :id cua POST /admin/tips/:id (thu tu khai bao route)", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const cookie = await login(baseUrl);
    const [a, b, c] = seedThree(ledgerStore);
    const { status } = await reorder(baseUrl, cookie, { ids: [b, c, a] });
    assert.equal(status, 200); // neu bi /:id nuot thi se ra 404 voi trang HTML (json() se nem loi)
  } finally {
    cleanup();
  }
});


function userToken(store: LedgerStore): string {
  return store.findOrCreateDashboardToken("zalo", "tips-user").token;
}

test("GET /d/:token/tips: token sai -> 404 trang khong hop le", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const res = await fetch(`${baseUrl}/d/khong-co-token/tips`);
    assert.equal(res.status, 404);
    assert.match(await res.text(), /Đường dẫn không hợp lệ/);
  } finally {
    cleanup();
  }
});

test("GET /d/:token/tips: chi hien Tip DANG BAT, dung thu tu, kem anh", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const token = userToken(ledgerStore);
    const a = ledgerStore.createTip({ title: "Dau tien", description: "", imagePath: "a.png" });
    const b = ledgerStore.createTip({ title: "Da tat", description: "", imagePath: null });
    ledgerStore.createTip({ title: "Thu ba", description: "", imagePath: null });
    ledgerStore.setTipActive(b.id, false);
    ledgerStore.reorderTips([ledgerStore.listTips()[2].id, a.id, b.id]);

    const res = await fetch(`${baseUrl}/d/${token}/tips`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.indexOf("Thu ba") < html.indexOf("Dau tien"), "thu tu theo sort_order");
    assert.doesNotMatch(html, /Da tat/);
    assert.match(html, /src="\/tips\/images\/a\.png"/);
  } finally {
    cleanup();
  }
});

test("GET /d/:token/tips: tat het Tip -> 200 voi cau 'chua co meo' (khong 404)", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const token = userToken(ledgerStore);
    const tip = ledgerStore.createTip({ title: "T", description: "", imagePath: null });
    ledgerStore.setTipActive(tip.id, false);
    const res = await fetch(`${baseUrl}/d/${token}/tips`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Chưa có mẹo nào/);
  } finally {
    cleanup();
  }
});

test("GET /tips/images/:filename: tra anh + header cache dai; KHONG can dang nhap", async () => {
  const { baseUrl, tipsImageDir, cleanup } = setup();
  try {
    mkdirSync(tipsImageDir, { recursive: true });
    writeFileSync(join(tipsImageDir, "ok.png"), PNG);
    const res = await fetch(`${baseUrl}/tips/images/ok.png`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), PNG);
  } finally {
    cleanup();
  }
});

test("GET /tips/images/:filename: khong ton tai -> 404 va KHONG kem header cache immutable", async () => {
  const { baseUrl, cleanup } = setup();
  try {
    const res = await fetch(`${baseUrl}/tips/images/khong-co.png`);
    assert.equal(res.status, 404);
    assert.doesNotMatch(res.headers.get("cache-control") ?? "", /immutable/);
  } finally {
    cleanup();
  }
});

test("GET /tips/images/:filename: path traversal khong doc duoc file ngoai thu muc; duoi la bi tu choi", async () => {
  const { baseUrl, tipsImageDir, cleanup } = setup();
  try {
    mkdirSync(tipsImageDir, { recursive: true });
    writeFileSync(join(tipsImageDir, "..", "secret.png"), PNG); // nam NGOAI thu muc anh
    writeFileSync(join(tipsImageDir, "notes.txt"), "khong phai anh");

    const traversal = await fetch(`${baseUrl}/tips/images/..%2Fsecret.png`);
    assert.equal(traversal.status, 404);

    const wrongExt = await fetch(`${baseUrl}/tips/images/notes.txt`);
    assert.equal(wrongExt.status, 404);
  } finally {
    rmSync(join(tipsImageDir, "..", "secret.png"), { force: true });
    cleanup();
  }
});

test("dashboard /d/:token: co Tip dang bat -> co nut Tips; tat het -> mat nut", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const token = userToken(ledgerStore);
    const before = await (await fetch(`${baseUrl}/d/${token}`)).text();
    assert.doesNotMatch(before, /class="tips-pill"/);

    const tip = ledgerStore.createTip({ title: "T", description: "", imagePath: null });
    const withTip = await (await fetch(`${baseUrl}/d/${token}`)).text();
    assert.match(withTip, new RegExp(`href="/d/${token}/tips"`));

    ledgerStore.setTipActive(tip.id, false);
    const after = await (await fetch(`${baseUrl}/d/${token}`)).text();
    assert.doesNotMatch(after, /class="tips-pill"/);
  } finally {
    cleanup();
  }
});

test("trang loi rut tien (POST /d/:token/withdraw 422) cung giu nut Tips", async () => {
  const { baseUrl, ledgerStore, cleanup } = setup();
  try {
    const token = userToken(ledgerStore);
    ledgerStore.createTip({ title: "T", description: "", imagePath: null });
    const res = await fetch(`${baseUrl}/d/${token}/withdraw`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ bankName: "", bankAccountNumber: "", bankAccountHolder: "" }),
      redirect: "manual",
    });
    assert.equal(res.status, 422);
    assert.match(await res.text(), /class="tips-pill"/);
  } finally {
    cleanup();
  }
});
