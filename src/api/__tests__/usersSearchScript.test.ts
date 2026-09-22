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
  dataset: { search: string };
  hidden: boolean;
}

function buildFakeDom(rows: FakeRow[]) {
  const input = {
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
  const counter = { textContent: "" };
  const emptyHint = { hidden: true };
  const document = {
    getElementById(id: string) {
      if (id === "user-search") return input;
      if (id === "users-count") return counter;
      if (id === "users-no-match") return emptyHint;
      return null;
    },
    querySelectorAll() {
      return rows;
    },
  };
  return { document, input, counter, emptyHint };
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
    },
  ]);
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
    { dataset: { search: "trần bảo u-001" }, hidden: false },
    { dataset: { search: "nguyễn an u-002" }, hidden: false },
  ];
  const { input } = runScript(rows);

  input.type("bảo");
  assert.deepEqual(rows.map((r) => r.hidden), [false, true]);
});

test("search /admin/users: khop ca User ID chu khong chi Ten", () => {
  const rows: FakeRow[] = [
    { dataset: { search: "trần bảo u-001" }, hidden: false },
    { dataset: { search: " u-002" }, hidden: false }, // user chua co ten hien thi
  ];
  const { input } = runScript(rows);

  input.type("u-002");
  assert.deepEqual(rows.map((r) => r.hidden), [true, false]);
});

test("search /admin/users: xoa het tu khoa thi hien lai tat ca", () => {
  const rows: FakeRow[] = [
    { dataset: { search: "trần bảo u-001" }, hidden: false },
    { dataset: { search: "nguyễn an u-002" }, hidden: false },
  ];
  const { input } = runScript(rows);

  input.type("bảo");
  input.type("   ");
  assert.deepEqual(rows.map((r) => r.hidden), [false, false]);
});

test("search /admin/users: cap nhat so dem va hien dong 'khong tim thay' khi rong", () => {
  const rows: FakeRow[] = [
    { dataset: { search: "trần bảo u-001" }, hidden: false },
    { dataset: { search: "nguyễn an u-002" }, hidden: false },
  ];
  const { input, counter, emptyHint } = runScript(rows);

  input.type("bảo");
  assert.equal(counter.textContent, "1");
  assert.equal(emptyHint.hidden, true);

  input.type("khong-co-ai");
  assert.equal(counter.textContent, "0");
  assert.equal(emptyHint.hidden, false);
});
