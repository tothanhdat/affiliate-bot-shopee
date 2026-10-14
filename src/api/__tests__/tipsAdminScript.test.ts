import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { TIPS_ADMIN_SCRIPT } from "../tipsAdminScript.js";

/**
 * Script keo-tha cua /admin/tips chay tren DOM gia (khong co CSS that, khong co drag that cua trinh duyet).
 * Test nay chot LOGIC: tinh cho chen, danh sach id theo thu tu DOM, hoan tac khi luu loi. Cam giac keo bang
 * chuot that phai kiem tra tay tren trinh duyet.
 */

interface FakeNode {
  parentNode: FakeList | null;
  getAttribute(name: string): string | null;
}

class FakeList {
  children: FakeNode[] = [];
  handlers: Record<string, (event: unknown) => void> = {};
  addEventListener(type: string, fn: (event: unknown) => void) {
    this.handlers[type] = fn;
  }
  querySelectorAll(): FakeNode[] {
    return this.children.filter((node) => node.getAttribute("data-tip-id") !== null);
  }
  insertBefore(node: FakeNode, ref: FakeNode | null): FakeNode {
    this.detach(node);
    const at = ref === null ? this.children.length : this.children.indexOf(ref);
    this.children.splice(at, 0, node);
    node.parentNode = this;
    return node;
  }
  appendChild(node: FakeNode): FakeNode {
    return this.insertBefore(node, null);
  }
  removeChild(node: FakeNode): void {
    this.detach(node);
    node.parentNode = null;
  }
  private detach(node: FakeNode) {
    const index = this.children.indexOf(node);
    if (index !== -1) this.children.splice(index, 1);
  }
}

interface FakeCard extends FakeNode {
  id: number;
  classes: Set<string>;
  classList: { add(name: string): void; remove(name: string): void };
  getBoundingClientRect(): { top: number; height: number };
  closest(selector: string): FakeCard | null;
}

function makeCard(id: number, top: number): { card: FakeCard; handle: { closest(selector: string): unknown } } {
  const classes = new Set<string>();
  const card: FakeCard = {
    id,
    classes,
    parentNode: null,
    getAttribute: (name) => (name === "data-tip-id" ? String(id) : null),
    getBoundingClientRect: () => ({ top, height: 100 }),
    classList: {
      add: (name) => void classes.add(name),
      remove: (name) => void classes.delete(name),
    },
    closest: (selector) => (selector === "[data-tip-id]" ? card : null),
  };
  const handle = {
    closest: (selector: string): unknown => (selector === ".tip-handle" ? handle : selector === "[data-tip-id]" ? card : null),
  };
  return { card, handle };
}

function makeLine(): FakeNode & { className: string; setAttribute(name: string, value: string): void } {
  return { parentNode: null, className: "", getAttribute: () => null, setAttribute: () => {} };
}

function dragEvent(target: unknown, clientY = 0) {
  return {
    target,
    clientY,
    dataTransfer: { effectAllowed: "", dropEffect: "", setData() {}, setDragImage() {} },
    preventDefault() {},
  };
}

interface Harness {
  list: FakeList;
  cards: FakeCard[];
  handles: Array<{ closest(selector: string): unknown }>;
  fetchCalls: Array<{ url: string; init: { body: string; method: string } }>;
  errorBox: { textContent: string; style: { display: string } };
  clickHandlers: Array<(event: unknown) => void>;
  ids(): number[];
}

function mount(fetchImpl: (url: string, init: { body: string; method: string }) => Promise<unknown>): Harness {
  const list = new FakeList();
  const made = [makeCard(1, 0), makeCard(2, 100), makeCard(3, 200)];
  for (const { card } of made) list.appendChild(card);
  const errorBox = { textContent: "", style: { display: "none" } };
  const fetchCalls: Harness["fetchCalls"] = [];
  const clickHandlers: Array<(event: unknown) => void> = [];
  const document = {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      if (type === "click") clickHandlers.push(fn);
    },
    getElementById: (id: string) => (id === "tips-list" ? list : id === "tips-order-error" ? errorBox : null),
    createElement: () => makeLine(),
  };
  runInNewContext(TIPS_ADMIN_SCRIPT, {
    document,
    setTimeout: (fn: () => void) => fn(),
    fetch: (url: string, init: { body: string; method: string }) => {
      fetchCalls.push({ url, init });
      return fetchImpl(url, init);
    },
  });
  const cards = made.map((entry) => entry.card);
  return {
    list,
    cards,
    handles: made.map((entry) => entry.handle),
    fetchCalls,
    errorBox,
    clickHandlers,
    ids: () => list.querySelectorAll().map((node) => Number(node.getAttribute("data-tip-id"))),
  };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function pure() {
  const context: Record<string, unknown> = {
    document: { addEventListener() {}, getElementById: () => null },
  };
  runInNewContext(TIPS_ADMIN_SCRIPT, context);
  return context as {
    computeDropIndex(midpoints: number[], clientY: number): number;
  };
}

test("computeDropIndex: dem so the co diem giua nam TREN con tro", () => {
  const { computeDropIndex } = pure();
  assert.equal(computeDropIndex([], 10), 0);
  assert.equal(computeDropIndex([50, 150, 250], 10), 0);
  assert.equal(computeDropIndex([50, 150, 250], 100), 1);
  assert.equal(computeDropIndex([50, 150, 250], 180), 2);
  assert.equal(computeDropIndex([50, 150, 250], 999), 3);
});

test("keo the 1 xuong giua the 2 va 3: DOM doi thu tu, gui dung [2,1,3], khong con duong ke", async () => {
  const h = mount(async () => ({ ok: true, json: async () => ({ ok: true }) }));
  h.list.handlers.dragstart(dragEvent(h.handles[0]));
  h.list.handlers.dragover(dragEvent(h.cards[1], 180)); // giua the 2 (mid 150) va the 3 (mid 250)
  h.list.handlers.drop(dragEvent(h.cards[1], 180));
  h.list.handlers.dragend(dragEvent(h.handles[0]));
  await settle();

  assert.deepEqual(h.ids(), [2, 1, 3]);
  assert.equal(h.fetchCalls.length, 1);
  assert.equal(h.fetchCalls[0].url, "/admin/tips/reorder");
  assert.equal(h.fetchCalls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(h.fetchCalls[0].init.body), { ids: [2, 1, 3] });
  assert.equal(h.list.children.length, 3); // duong ke chi cho da bi go
  assert.equal(h.errorBox.style.display, "none");
  assert.equal(h.cards[0].classes.has("is-dragging"), false);
});

test("tha lai dung cho cu: KHONG goi luu", async () => {
  const h = mount(async () => ({ ok: true, json: async () => ({ ok: true }) }));
  h.list.handlers.dragstart(dragEvent(h.handles[1]));
  h.list.handlers.dragover(dragEvent(h.cards[0], 120)); // van trong vung cua chinh the 2
  h.list.handlers.drop(dragEvent(h.cards[0], 120));
  await settle();
  assert.deepEqual(h.ids(), [1, 2, 3]);
  assert.equal(h.fetchCalls.length, 0);
});

test("luu LOI (server tra 422): hoan tac DOM ve thu tu cu va hien thong bao", async () => {
  const h = mount(async () => ({
    ok: false,
    json: async () => ({ ok: false, message: "Danh sách Tips đã thay đổi, hãy tải lại trang." }),
  }));
  h.list.handlers.dragstart(dragEvent(h.handles[0]));
  h.list.handlers.dragover(dragEvent(h.cards[2], 999)); // xuong cuoi
  h.list.handlers.drop(dragEvent(h.cards[2], 999));
  assert.deepEqual(h.ids(), [2, 3, 1]); // DOM da doi ngay
  await settle();

  assert.deepEqual(h.ids(), [1, 2, 3]); // da hoan tac
  assert.match(h.errorBox.textContent, /đã thay đổi/);
  assert.equal(h.errorBox.style.display, "block");
});

test("luu LOI do mang (fetch reject): hoan tac + thong bao chung", async () => {
  const h = mount(async () => {
    throw new Error("Failed to fetch");
  });
  h.list.handlers.dragstart(dragEvent(h.handles[0]));
  h.list.handlers.dragover(dragEvent(h.cards[2], 999));
  h.list.handlers.drop(dragEvent(h.cards[2], 999));
  await settle();
  assert.deepEqual(h.ids(), [1, 2, 3]);
  assert.match(h.errorBox.textContent, /Không lưu được thứ tự/);
});

test("luu thanh cong sau mot lan loi: thong bao loi cu duoc an", async () => {
  let fail = true;
  const h = mount(async () =>
    fail ? { ok: false, json: async () => ({ ok: false, message: "loi" }) } : { ok: true, json: async () => ({ ok: true }) }
  );
  h.list.handlers.dragstart(dragEvent(h.handles[0]));
  h.list.handlers.dragover(dragEvent(h.cards[2], 999));
  h.list.handlers.drop(dragEvent(h.cards[2], 999));
  await settle();
  assert.equal(h.errorBox.style.display, "block");

  fail = false;
  h.list.handlers.dragstart(dragEvent(h.handles[0]));
  h.list.handlers.dragover(dragEvent(h.cards[2], 999));
  h.list.handlers.drop(dragEvent(h.cards[2], 999));
  await settle();
  assert.equal(h.errorBox.style.display, "none");
});

test("chi tay nam moi keo duoc: dragstart tu cho khac (vd anh, chu) bi bo qua", async () => {
  const h = mount(async () => ({ ok: true, json: async () => ({ ok: true }) }));
  h.list.handlers.dragstart(dragEvent({ closest: () => null })); // khong phai .tip-handle
  h.list.handlers.dragover(dragEvent(h.cards[2], 999));
  h.list.handlers.drop(dragEvent(h.cards[2], 999));
  await settle();
  assert.deepEqual(h.ids(), [1, 2, 3]);
  assert.equal(h.fetchCalls.length, 0);
});

test("nut [data-close-details] dong <details> cha cua no", () => {
  const h = mount(async () => ({ ok: true, json: async () => ({ ok: true }) }));
  const removed: string[] = [];
  const details = { removeAttribute: (name: string) => removed.push(name) };
  const button = { closest: (selector: string) => (selector === "details" ? details : null) };
  const target = { closest: (selector: string) => (selector === "[data-close-details]" ? button : null) };
  h.clickHandlers[0]({ target });
  assert.deepEqual(removed, ["open"]);

  h.clickHandlers[0]({ target: { closest: () => null } }); // click linh tinh khong lam gi
  assert.deepEqual(removed, ["open"]);
});
