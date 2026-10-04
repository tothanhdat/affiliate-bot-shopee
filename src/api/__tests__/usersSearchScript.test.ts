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
  dataset: { search: string; orders: string; paid: string; index: string };
  hidden: boolean;
}

/** Tao 1 dong gia; `index` la thu tu goc do server tra ve (dung lam tiebreak khi sap xep). */
function row(search: string, orders: number, paid: number, index: number): FakeRow {
  return {
    dataset: { search, orders: String(orders), paid: String(paid), index: String(index) },
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
      if (id === "users-tbody") return tbody;
      if (id === "users-count") return counter;
      if (id === "users-no-match") return emptyHint;
      return null;
    },
    querySelectorAll() {
      return rows;
    },
  };
  return { document, input, sortSelect, counter, emptyHint, order };
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
      paidTotal: 0,
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
