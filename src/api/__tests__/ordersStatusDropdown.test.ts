import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { renderOrdersPage, type OrdersFilters } from "../adminHtml.js";
import type { CommissionStatus } from "../../core/types.js";

const PAGINATION = { page: 1, totalPages: 1, totalEntries: 0 };

function render(statuses?: CommissionStatus[]): string {
  const filters: OrdersFilters = statuses ? { statuses } : {};
  return renderOrdersPage([], filters, new Map(), PAGINATION);
}

/** Nhan hien tren nut dropdown (phan nguoi dung thay khi dropdown dang dong). */
function summaryLabel(html: string): string {
  return html.match(/<span id="status-summary">([^<]*)<\/span>/)?.[1] ?? "";
}

/** Danh sach value dang duoc tick san trong dropdown. */
function checkedValues(html: string): string[] {
  const panel = html.match(/<div class="dropdown-panel">[\s\S]*?<\/div>/)?.[0] ?? "";
  return [...panel.matchAll(/value="([^"]+)"[^>]*checked/g)].map((m) => m[1]);
}

test("dropdown trang thai: mac dinh (chua loc) tick SAN tat ca, nhan la 'Tất cả'", () => {
  const html = render();
  assert.match(html, /<details class="dropdown-check" id="status-dropdown">/);
  assert.deepEqual(checkedValues(html), ["pending", "confirmed", "paid", "reversed"]);
  assert.equal(summaryLabel(html), "Tất cả");
});

test("dropdown trang thai: khong con do cac o checkbox ra ngoai form nua", () => {
  const html = render();
  // Cac checkbox phai nam TRONG panel cua dropdown, khong phai hang .status-choices cu.
  assert.doesNotMatch(html, /class="status-choices"/);
});

test("dropdown trang thai: dang loc 1 trang thai thi nhan la ten trang thai do", () => {
  const html = render(["pending"]);
  assert.deepEqual(checkedValues(html), ["pending"]);
  assert.equal(summaryLabel(html), "Chờ xác nhận");
});

test("dropdown trang thai: dang loc nhieu trang thai thi nhan dem so luong", () => {
  const html = render(["pending", "reversed"]);
  assert.deepEqual(checkedValues(html), ["pending", "reversed"]);
  assert.equal(summaryLabel(html), "2 trạng thái");
});

test("dropdown trang thai: tick het 4 o cung la 'Tất cả'", () => {
  const html = render(["pending", "confirmed", "paid", "reversed"]);
  assert.equal(summaryLabel(html), "Tất cả");
});

// --- Phan JS: doi nhan khi tick va dong dropdown khi bam ra ngoai ---

interface FakeBox {
  checked: boolean;
  dataset: { label: string };
  listeners: Array<() => void>;
  addEventListener(event: string, fn: () => void): void;
  toggle(): void;
}

function makeBox(label: string, checked: boolean): FakeBox {
  return {
    checked,
    dataset: { label },
    listeners: [],
    addEventListener(_event, fn) {
      this.listeners.push(fn);
    },
    toggle() {
      this.checked = !this.checked;
      for (const fn of this.listeners) fn();
    },
  };
}

function runDropdownScript(boxes: FakeBox[]) {
  const html = render();
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .find((s) => s.includes("status-dropdown"));
  assert.ok(script, "trang /admin/orders phai co script cho dropdown trang thai");

  const summary = { textContent: "" };
  const inside = { name: "inside" };
  const dropdown = {
    open: true,
    querySelectorAll: () => boxes,
    contains: (node: unknown) => node === inside,
  };
  const documentListeners: Array<(e: { target: unknown }) => void> = [];
  const document = {
    getElementById(id: string) {
      if (id === "status-dropdown") return dropdown;
      if (id === "status-summary") return summary;
      return null;
    },
    addEventListener(_event: string, fn: (e: { target: unknown }) => void) {
      documentListeners.push(fn);
    },
  };
  runInNewContext(script, { document, Array, String });
  const clickOn = (target: unknown) => documentListeners.forEach((fn) => fn({ target }));
  return { summary, dropdown, clickOn, inside };
}

test("dropdown trang thai (JS): bo tick 1 o thi nhan doi thanh so luong con lai", () => {
  const boxes = [
    makeBox("Chờ xác nhận", true),
    makeBox("Khả dụng / đang chờ rút", true),
    makeBox("Đã rút", true),
    makeBox("Đã huỷ", true),
  ];
  const { summary } = runDropdownScript(boxes);
  assert.equal(summary.textContent, "Tất cả");

  boxes[2].toggle();
  assert.equal(summary.textContent, "3 trạng thái");

  boxes[3].toggle();
  boxes[1].toggle();
  assert.equal(summary.textContent, "Chờ xác nhận");
});

test("dropdown trang thai (JS): bo tick het quay ve 'Tất cả' (khong loc gi)", () => {
  const boxes = [makeBox("Chờ xác nhận", true), makeBox("Đã huỷ", true)];
  const { summary } = runDropdownScript(boxes);
  boxes[0].toggle();
  boxes[1].toggle();
  assert.equal(summary.textContent, "Tất cả");
});

test("dropdown trang thai (JS): bam ra ngoai thi dong, bam ben trong thi khong dong", () => {
  const boxes = [makeBox("Chờ xác nhận", true)];
  const { dropdown, clickOn, inside } = runDropdownScript(boxes);

  clickOn(inside);
  assert.equal(dropdown.open, true, "bam vao trong dropdown khong duoc dong");

  clickOn({ name: "elsewhere" });
  assert.equal(dropdown.open, false, "bam ra ngoai phai dong dropdown");
});
