import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { TIPS_ADMIN_SCRIPT } from "../tipsAdminScript.js";
import { normalizeTipSearch } from "../adminTipsHtml.js";

/**
 * Script cua /admin/tips (keo-tha + tim kiem) chay tren DOM gia (khong co CSS that, khong co drag that cua
 * trinh duyet). Test nay chot LOGIC: tinh cho chen, danh sach id theo thu tu DOM, hoan tac khi luu loi, loc theo
 * tu khoa. Cam giac keo bang chuot that phai kiem tra tay tren trinh duyet.
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
  style: { display: string };
  classList: { add(name: string): void; remove(name: string): void };
  getBoundingClientRect(): { top: number; height: number };
  closest(selector: string): FakeCard | null;
}

function makeCard(id: number, top: number, search: string): { card: FakeCard; handle: { closest(selector: string): unknown } } {
  const classes = new Set<string>();
  const card: FakeCard = {
    id,
    classes,
    style: { display: "" },
    parentNode: null,
    getAttribute: (name) => (name === "data-tip-id" ? String(id) : name === "data-search" ? search : null),
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
  const event = {
    target,
    clientY,
    prevented: false,
    dataTransfer: { effectAllowed: "", dropEffect: "", setData() {}, setDragImage() {} },
    preventDefault() {
      event.prevented = true;
    },
  };
  return event;
}

interface Harness {
  list: FakeList;
  cards: FakeCard[];
  handles: Array<{ closest(selector: string): unknown }>;
  fetchCalls: Array<{ url: string; init: { body: string; method: string } }>;
  errorBox: { textContent: string; style: { display: string } };
  noMatch: { style: { display: string } };
  search: { value: string; type(text: string): void };
  ids(): number[];
}

function mount(fetchImpl: (url: string, init: { body: string; method: string }) => Promise<unknown>): Harness {
  const list = new FakeList();
  const made = [makeCard(1, 0, "meo mot"), makeCard(2, 100, "gui link hoan tien"), makeCard(3, 200, "don hang")];
  for (const { card } of made) list.appendChild(card);
  const errorBox = { textContent: "", style: { display: "none" } };
  const noMatch = { style: { display: "none" } };
  const searchHandlers: Array<() => void> = [];
  const search = {
    value: "",
    addEventListener: (_type: string, fn: () => void) => void searchHandlers.push(fn),
    type(text: string) {
      this.value = text;
      for (const fn of searchHandlers) fn();
    },
  };
  const fetchCalls: Harness["fetchCalls"] = [];
  const document = {
    addEventListener: () => {},
    getElementById: (id: string) =>
      id === "tips-list"
        ? list
        : id === "tips-order-error"
          ? errorBox
          : id === "tips-search"
            ? search
            : id === "tips-no-match"
              ? noMatch
              : null,
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
    noMatch,
    search,
    ids: () => list.querySelectorAll().map((node) => Number(node.getAttribute("data-tip-id"))),
  };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const OK = async () => ({ ok: true, json: async () => ({ ok: true }) });

function pure() {
  const context: Record<string, unknown> = {
    document: { addEventListener() {}, getElementById: () => null },
  };
  runInNewContext(TIPS_ADMIN_SCRIPT, context);
  return context as {
    computeDropIndex(midpoints: number[], clientY: number): number;
    normalizeSearch(text: string): string;
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
  const h = mount(OK);
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
  const h = mount(OK);
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
  const h = mount(OK);
  h.list.handlers.dragstart(dragEvent({ closest: () => null })); // khong phai .tip-handle
  h.list.handlers.dragover(dragEvent(h.cards[2], 999));
  h.list.handlers.drop(dragEvent(h.cards[2], 999));
  await settle();
  assert.deepEqual(h.ids(), [1, 2, 3]);
  assert.equal(h.fetchCalls.length, 0);
});

// ---- Tim kiem ----

const hiddenOf = (h: Harness) => h.cards.map((card) => card.style.display === "none");

test("tim kiem: an cac Tip khong khop, khong phan biet dau va hoa/thuong", () => {
  const h = mount(OK);
  h.search.type("GỬI");
  assert.deepEqual(hiddenOf(h), [true, false, true]);
  h.search.type("hoàn tiền");
  assert.deepEqual(hiddenOf(h), [true, false, true]);
  h.search.type("don");
  assert.deepEqual(hiddenOf(h), [true, true, false]);
});

test("tim kiem: xoa tu khoa thi hien lai tat ca va an thong bao 'khong khop'", () => {
  const h = mount(OK);
  h.search.type("khong co gi khop");
  assert.deepEqual(hiddenOf(h), [true, true, true]);
  assert.equal(h.noMatch.style.display, "block");

  h.search.type("   ");
  assert.deepEqual(hiddenOf(h), [false, false, false]);
  assert.equal(h.noMatch.style.display, "none");
});

test("dang tim kiem: KHONG cho keo (the bi an co toa do 0 se tinh sai cho chen) va chan dragstart", async () => {
  const h = mount(OK);
  h.search.type("gui");
  const event = dragEvent(h.handles[1]);
  h.list.handlers.dragstart(event);
  assert.equal(event.prevented, true);
  h.list.handlers.dragover(dragEvent(h.cards[2], 999));
  h.list.handlers.drop(dragEvent(h.cards[2], 999));
  await settle();
  assert.deepEqual(h.ids(), [1, 2, 3]);
  assert.equal(h.fetchCalls.length, 0);

  h.search.type(""); // het tim kiem -> keo duoc tro lai
  h.list.handlers.dragstart(dragEvent(h.handles[0]));
  h.list.handlers.dragover(dragEvent(h.cards[2], 999));
  h.list.handlers.drop(dragEvent(h.cards[2], 999));
  await settle();
  assert.deepEqual(h.ids(), [2, 3, 1]);
});

test("normalizeSearch (client) cho CUNG ket qua voi normalizeTipSearch (server): data-search va tu khoa phai khop nhau", () => {
  const { normalizeSearch } = pure();
  for (const sample of ["Đặng Dũng Ơ Ư", "Kính cường lực", "  Mẹo mua đơn  ", "ABC xyz", "", "Tiếng Việt: ăâêôơư"]) {
    assert.equal(normalizeSearch(sample), normalizeTipSearch(sample), JSON.stringify(sample));
  }
});
