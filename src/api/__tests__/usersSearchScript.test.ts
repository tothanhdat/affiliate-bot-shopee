import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { renderUsersPage } from "../adminHtml.js";

/**
 * Doan JS loc client-side cua /admin/users khong chay qua route nao nen cac test HTTP khong cham toi
 * duoc. O day ta boc <script> ra khoi trang da render roi chay no tren 1 DOM gia toi thieu - du de
 * kiem tra dung phan logic quyet dinh dong nao an/hien.
 */

interface FakeRow {
  dataset: { search: string; orders: string; paid: string; pending?: string; index: string };
  hidden: boolean;
}

/** Tao 1 dong gia; `index` la thu tu goc do server tra ve (dung lam tiebreak khi sap xep). */
function row(search: string, orders: number, paid: number, index: number, pending = 0): FakeRow {
  return {
    dataset: { search, orders: String(orders), paid: String(paid), pending: String(pending), index: String(index) },
    hidden: false,
  };
}

/** O nhap/o chon gia - "go" hay "chon" deu chay lai cac listener da dang ky. */
function makeControl() {
  return {
    value: "",
    listeners: [] as Array<() => void>,
    addEventListener(_event: string, fn: () => void) {
      this.listeners.push(fn);
    },
    type(value: string) {
      this.value = value;
      for (const fn of this.listeners) fn();
    },
  };
}

function buildFakeDom(rows: FakeRow[]) {
  const input = makeControl();
  const sortSelect = makeControl();
  const ordersFilter = makeControl();
  const counter = { textContent: "" };
  const emptyHint = { hidden: true };
  // appendChild() that se DI CHUYEN dong xuong cuoi tbody - mo phong dung the de doc duoc thu tu
  // cuoi cung ma script sap xep ra.
  const order: FakeRow[] = [];
  const tbody = {
    appendChild(node: FakeRow) {
      const at = order.indexOf(node);
      if (at !== -1) order.splice(at, 1);
      order.push(node);
    },
  };
  const document = {
    getElementById(id: string) {
      if (id === "user-search") return input;
      if (id === "user-sort") return sortSelect;
      if (id === "user-orders-filter") return ordersFilter;
      if (id === "users-tbody") return tbody;
      if (id === "users-count") return counter;
      if (id === "users-no-match") return emptyHint;
      return null;
    },
    querySelectorAll() {
      return rows;
    },
  };
  return { document, input, sortSelect, ordersFilter, counter, emptyHint, order };
}

/** Lay noi dung <script> trong trang /admin/users da render. */
function extractSearchScript(): string {
  const html = renderUsersPage([
    {
      platform: "zalo",
      userId: "u-001",
      displayName: "Trần Bảo",
      availableBalance: 0,
      pendingBalance: 0,
      pendingConfirmationBalance: 0,
      paidTotal: 0,
      debtRemaining: 0,
      heldBalance: 0,
      ordersCount: 1,
      commissionOverride: null,
    },
  ], 80, "2026-10-01");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script && script.trim() !== "", "trang /admin/users phai co script loc tim kiem");
  return script;
}

function runScript(rows: FakeRow[]) {
  const dom = buildFakeDom(rows);
  runInNewContext(extractSearchScript(), { document: dom.document, Array, String });
  return dom;
}

test("search /admin/users: an cac dong khong khop tu khoa", () => {
  const rows: FakeRow[] = [
    row("trần bảo u-001", 1, 0, 0),
    row("nguyễn an u-002", 1, 0, 1),
  ];
  const { input } = runScript(rows);

  input.type("bảo");
  assert.deepEqual(rows.map((r) => r.hidden), [false, true]);
});

test("search /admin/users: khop ca User ID chu khong chi Ten", () => {
  const rows: FakeRow[] = [
    row("trần bảo u-001", 1, 0, 0),
    row(" u-002", 1, 0, 1), // user chua co ten hien thi
  ];
  const { input } = runScript(rows);

  input.type("u-002");
  assert.deepEqual(rows.map((r) => r.hidden), [true, false]);
});

test("search /admin/users: xoa het tu khoa thi hien lai tat ca", () => {
  const rows: FakeRow[] = [
    row("trần bảo u-001", 1, 0, 0),
    row("nguyễn an u-002", 1, 0, 1),
  ];
  const { input } = runScript(rows);

  input.type("bảo");
  input.type("   ");
  assert.deepEqual(rows.map((r) => r.hidden), [false, false]);
});

test("search /admin/users: cap nhat so dem va hien dong 'khong tim thay' khi rong", () => {
  const rows: FakeRow[] = [
    row("trần bảo u-001", 1, 0, 0),
    row("nguyễn an u-002", 1, 0, 1),
  ];
  const { input, counter, emptyHint } = runScript(rows);

  input.type("bảo");
  assert.equal(counter.textContent, "1");
  assert.equal(emptyHint.hidden, true);

  input.type("khong-co-ai");
  assert.equal(counter.textContent, "0");
  assert.equal(emptyHint.hidden, false);
});

test("sap xep /admin/users: 'Số đơn nhiều nhất' xep giam dan theo so don", () => {
  const rows = [row("a u-001", 2, 500, 0), row("b u-002", 9, 0, 1), row("c u-003", 5, 100, 2)];
  const { sortSelect, order } = runScript(rows);

  sortSelect.type("orders");
  assert.deepEqual(order.map((r) => r.dataset.search), ["b u-002", "c u-003", "a u-001"]);
});

test("sap xep /admin/users: 'Hoa hồng đã nhận nhiều nhất' xep giam dan theo so tien", () => {
  const rows = [row("a u-001", 2, 500, 0), row("b u-002", 9, 0, 1), row("c u-003", 5, 100, 2)];
  const { sortSelect, order } = runScript(rows);

  sortSelect.type("paid");
  assert.deepEqual(order.map((r) => r.dataset.search), ["a u-001", "c u-003", "b u-002"]);
});

test("sap xep /admin/users: quay ve 'Mặc định' thi tra dung thu tu goc cua server", () => {
  const rows = [row("a u-001", 2, 500, 0), row("b u-002", 9, 0, 1), row("c u-003", 5, 100, 2)];
  const { sortSelect, order } = runScript(rows);

  sortSelect.type("orders");
  sortSelect.type("");
  assert.deepEqual(order.map((r) => r.dataset.search), ["a u-001", "b u-002", "c u-003"]);
});

/**
 * Phan lon user that co CUNG so don (1) va CUNG so tien da nhan (0d). Khong co tiebreak theo thu tu
 * goc thi moi lan doi tieu chi, cac dong bang nhau se giu thu tu cua lan sap xep truoc - danh sach
 * xao dan sau vai lan bam, va admin tuong du lieu doi.
 */
test("sap xep /admin/users: cac dong bang diem giu NGUYEN thu tu goc, doi qua doi lai khong xao", () => {
  const rows = [row("a u-001", 1, 0, 0), row("b u-002", 1, 0, 1), row("c u-003", 1, 0, 2)];
  const { sortSelect, order } = runScript(rows);

  sortSelect.type("orders");
  assert.deepEqual(order.map((r) => r.dataset.search), ["a u-001", "b u-002", "c u-003"]);

  sortSelect.type("paid");
  sortSelect.type("orders");
  assert.deepEqual(order.map((r) => r.dataset.search), ["a u-001", "b u-002", "c u-003"]);
});

test("sap xep /admin/users: khong dung toi trang thai an/hien cua o tim kiem", () => {
  const rows = [row("trần bảo u-001", 2, 0, 0), row("nguyễn an u-002", 9, 0, 1)];
  const { input, sortSelect, order } = runScript(rows);

  input.type("bảo");
  assert.deepEqual(rows.map((r) => r.hidden), [false, true]);

  sortSelect.type("orders");
  assert.deepEqual(order.map((r) => r.dataset.search), ["nguyễn an u-002", "trần bảo u-001"]);
  assert.deepEqual(rows.map((r) => r.hidden), [false, true], "sap xep khong duoc lam hien lai dong da bi loc");
});

// ---------------------------------------------------------------------------
// Cot "No hoan tra" + nut "Xoa no" (2026-10-08)
// ---------------------------------------------------------------------------

function userRow(over: Partial<Parameters<typeof renderUsersPage>[0][0]> = {}) {
  return {
    platform: "zalo" as const,
    userId: "u-001",
    displayName: "Trần Bảo",
    availableBalance: 6_000,
    pendingBalance: 0,
    pendingConfirmationBalance: 0,
    paidTotal: 0,
    debtRemaining: 0,
    heldBalance: 0,
    ordersCount: 1,
    commissionOverride: null,
    ...over,
  };
}

test("/admin/users: co cot 'No hoan tra'", () => {
  const html = renderUsersPage([userRow()], 80, "2026-10-08");
  assert.match(html, /Nợ hoàn trả/);
});

// Rang buoc da co cua moneyCell(): so 0 LUON lam mo - bang nhieu cot tien ma to dam ca loat thi mat
// phai doc tung so moi biet cho nao co tien that.
test("/admin/users: user khong no -> khong co nut Xoa no", () => {
  const html = renderUsersPage([userRow()], 80, "2026-10-08");
  assert.doesNotMatch(html, /Xoá nợ/);
});

test("/admin/users: user co no -> hien so tien + nut Xoa no tro dung route", () => {
  const html = renderUsersPage(
    [userRow({ debtRemaining: 4_000 })],
    80,
    "2026-10-08",
    undefined,
    new Map([["zalo:u-001", [{ id: "debt-1", orderId: "X1", amount: 4_000 }]]])
  );
  assert.match(html, /4\.000/);
  assert.match(html, /Xoá nợ/);
  assert.match(html, /action="\/admin\/users\/zalo\/u-001\/debts\/debt-1\/write-off"/);
  assert.match(html, /onsubmit="return confirm\(/, "hanh dong tien BAT BUOC co buoc xac nhan");
});

// SQL sap theo so GROSS; availableBalance tra ve la so da tru no. Thu tu hien thi phai theo so DA TRU.
test("/admin/users: cot Kha dung hien so DA TRU no", () => {
  const html = renderUsersPage([userRow({ availableBalance: 6_000, debtRemaining: 4_000 })], 80, "2026-10-08");
  assert.match(html, /6\.000/);
});

// Menu "⋯" (2026-10-08, yeu cau truc tiep cua user): chi "Xem don" nam ngoai, "Cau hinh %" va moi
// khoan "Xoa no" nam TRONG panel cua menu.
test("/admin/users: Cau hinh % va Xoa no nam trong menu '⋯', Xem don nam ngoai", () => {
  const html = renderUsersPage(
    [userRow({ debtRemaining: 70_000 })],
    80,
    "2026-10-08",
    undefined,
    new Map([
      [
        "zalo:u-001",
        [
          { id: "debt-1", orderId: "X1", amount: 40_000 },
          { id: "debt-2", orderId: "X2", amount: 30_000 },
        ],
      ],
    ])
  );
  const panel = html.match(/<div class="row-menu-panel"[^>]*>([\s\S]*?)<\/details>/)?.[1] ?? "";
  assert.match(panel, /Cấu hình % hoa hồng/);
  assert.match(panel, /debts\/debt-1\/write-off/);
  assert.match(panel, /debts\/debt-2\/write-off/);
  assert.match(panel, /Đơn X1 · 40\.000đ/, "moi khoan no ghi ro don nao, bao nhieu");
  assert.doesNotMatch(panel, /Xem đơn/);
  assert.match(html, /<summary class="row-menu-trigger"/);
  assert.match(html, /Xem đơn<\/a>/);
});

test("/admin/users: user khong no -> menu chi co Cau hinh, khong co Xoa no", () => {
  const html = renderUsersPage([userRow()], 80, "2026-10-08");
  assert.match(html, /Cấu hình % hoa hồng/);
  assert.doesNotMatch(html, /Xoá nợ/);
});

// Bo loc "da/chua co don" (2026-10-09): /admin/users gio gom ca thanh vien group chua mua lan nao,
// nen phai tach duoc 2 nhom - va bo loc do phai chay CHUNG voi o tim kiem, khong ghi de nhau.
test("loc /admin/users: 'Chưa có đơn' chi hien dong co 0 don", () => {
  const rows = [row("a u-001", 2, 500, 0), row("b u-002", 0, 0, 1), row("c u-003", 0, 0, 2)];
  const { ordersFilter } = runScript(rows);

  ordersFilter.type("no-orders");
  assert.deepEqual(rows.map((r) => r.hidden), [true, false, false]);
});

test("loc /admin/users: 'Đã có đơn' an dong 0 don", () => {
  const rows = [row("a u-001", 2, 500, 0), row("b u-002", 0, 0, 1)];
  const { ordersFilter } = runScript(rows);

  ordersFilter.type("with-orders");
  assert.deepEqual(rows.map((r) => r.hidden), [false, true]);
});

test("loc /admin/users: bo loc va o tim kiem ap dung DONG THOI", () => {
  const rows = [row("trần bảo u-001", 0, 0, 0), row("nguyễn an u-002", 0, 0, 1), row("trần bảo u-003", 3, 0, 2)];
  const { ordersFilter, input, counter } = runScript(rows);

  ordersFilter.type("no-orders");
  input.type("bảo");

  assert.deepEqual(rows.map((r) => r.hidden), [false, true, true]);
  assert.equal(counter.textContent, "1");
});

test("loc /admin/users: ve 'Tất cả' thi hien lai het", () => {
  const rows = [row("a u-001", 2, 500, 0), row("b u-002", 0, 0, 1)];
  const { ordersFilter } = runScript(rows);

  ordersFilter.type("no-orders");
  ordersFilter.type("");
  assert.deepEqual(rows.map((r) => r.hidden), [false, false]);
});

// Cot + tuy chon sap xep "Cho xac nhan" (2026-10-10).
test("/admin/users: co cot 'Cho xac nhan' hien so tien cua user, 0 thi lam mo", () => {
  const html = renderUsersPage(
    [userRow({ pendingConfirmationBalance: 12_345 }), userRow({ userId: "u-002", pendingConfirmationBalance: 0 })],
    80,
    "2026-10-10"
  );
  assert.match(html, /<th[^>]*>Chờ xác nhận<\/th>/);
  assert.match(html, /12\.345/);
  // KHONG them the KPI nao (yeu cau user): phan truoc o loc chi co 4 the cu.
  const kpiRegion = html.slice(0, html.indexOf('id="user-search"'));
  assert.doesNotMatch(kpiRegion.replace(/<style>[\s\S]*?<\/style>/g, ""), /Chờ xác nhận/);
  for (const label of ["Tổng người dùng", "Đang chờ rút", "Khả dụng \\(ví user\\)", "Đã chi trả thành công"]) {
    assert.match(kpiRegion, new RegExp(label));
  }
});

test("/admin/users: moi dong mang data-pending de sap xep", () => {
  const html = renderUsersPage([userRow({ pendingConfirmationBalance: 7_000 })], 80, "2026-10-10");
  assert.match(html, /data-pending="7000"/);
});

test("/admin/users: option sap xep 'Cho xac nhan cao nhat', mac dinh VAN la Kha dung cao nhat", () => {
  const html = renderUsersPage([userRow()], 80, "2026-10-10");
  const select = html.match(/<select id="user-sort"[\s\S]*?<\/select>/)?.[0] ?? "";
  const values = [...select.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(values, ["", "orders", "paid", "pending"], "thu tu cu khong doi, option moi o cuoi");
  assert.match(select, /<option value="">Mặc định \(khả dụng cao nhất\)<\/option>/);
  assert.match(select, /<option value="pending">Chờ xác nhận cao nhất<\/option>/);
});

test("sap xep /admin/users: 'Chờ xác nhận cao nhất' giam dan, bang nhau giu thu tu goc", () => {
  const rows = [row("a", 1, 0, 0, 0), row("b", 1, 0, 1, 9_000), row("c", 1, 0, 2, 0), row("d", 1, 0, 3, 3_000)];
  const { sortSelect, order } = runScript(rows);

  sortSelect.type("pending");
  assert.deepEqual(order.map((r) => r.dataset.search), ["b", "d", "a", "c"]);

  // Doi qua doi lai khong lam xao tron: ve mac dinh thi tra dung thu tu server.
  sortSelect.type("orders");
  sortSelect.type("pending");
  assert.deepEqual(order.map((r) => r.dataset.search), ["b", "d", "a", "c"]);
  sortSelect.type("");
  assert.deepEqual(order.map((r) => r.dataset.search), ["a", "b", "c", "d"]);
});
