import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { renderOrdersPage, type OrdersFilters } from "../adminHtml.js";
import type { CommissionEntry, CommissionStatus } from "../../core/types.js";
import { addDaysToVnIso, formatVnDateDdMm, todayVnIso } from "../../core/vietnamDate.js";

const PAGINATION = { page: 1, totalPages: 1, totalEntries: 0 };
const TOTALS = { totalEntries: 0, pendingEntries: 0, userShareTotal: 0, ownerShareTotal: 0, ownerShareBeforeTaxTotal: 0 };

function render(statuses?: CommissionStatus[]): string {
  const filters: OrdersFilters = statuses ? { statuses } : {};
  return renderOrdersPage([], filters, new Map(), PAGINATION, TOTALS);
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

// ---------------------------------------------------------------------------
// Dau hieu "dang bi giam" / "da tra hang" duoi pill trang thai (2026-10-08)
//
// CO Y khong them cot thu 10: bang da 9 cot va padding px-4 la muc VUA DU de cot "Thao tac" khong bi
// day ra ngoai man ~1700px (xem CLAUDE.md). Ngay mo khoa cung la chi tiet cua trang thai.
// ---------------------------------------------------------------------------

function orderEntry(over: Partial<CommissionEntry> = {}): CommissionEntry {
  return {
    id: "e1",
    createdAt: "2026-10-07T01:00:00.000Z",
    orderDate: "2026-10-07",
    completedAt: null,
    availableFrom: null,
    platform: "zalo",
    userId: "u1",
    merchant: "shopee",
    subId: "k-u1-a-b",
    orderId: "ORD1",
    productName: "San pham",
    orderAmount: 100_000,
    commissionAmount: 10_000,
    taxAmount: 0,
    platformFeeAmount: 0,
    afterTaxAmount: 10_000,
    userShareAmount: 8_000,
    taxPercent: 0,
    platformFeePercent: 0,
    userSharePercent: 80,
    status: "confirmed",
    withdrawalId: null,
    note: null,
    proofImagePath: null,
    ...over,
  } as CommissionEntry;
}

const EMPTY_TOTALS = {
  totalEntries: 1,
  pendingEntries: 0,
  userShareTotal: 8_000,
  ownerShareTotal: 2_000,
  ownerShareBeforeTaxTotal: 2_500,
} as Parameters<typeof renderOrdersPage>[4];

function renderOne(e: CommissionEntry, debtOrderIds = new Set<string>()): string {
  return renderOrdersPage(
    [e],
    {},
    new Map(),
    { page: 1, totalPages: 1, totalEntries: 1 },
    EMPTY_TOTALS,
    0,
    debtOrderIds
  );
}

test("/admin/orders: don binh thuong -> khong co dau hieu giam / tra hang", () => {
  const html = renderOne(orderEntry());
  assert.doesNotMatch(html, /mở khoá/);
  assert.doesNotMatch(html, /đã trả hàng/);
});

test("/admin/orders: don dang bi giam -> hien ngay mo khoa duoi pill trang thai (dang dd/mm)", () => {
  const future = addDaysToVnIso(todayVnIso(), 7);
  const html = renderOne(orderEntry({ availableFrom: future }));
  assert.match(html, /mở khoá/);
  assert.match(html, new RegExp(formatVnDateDdMm(new Date(`${future}T12:00:00Z`)).replace("/", "\\/")));
  assert.doesNotMatch(html, new RegExp(future), "phai hien dd/mm, khong phai chuoi ISO tho");
});

// BUG THAT (phat hien khi xem trang that, test cu khong bat): don DA qua ngay mo khoa van giu nguyen
// gia tri trong cot available_from, nen neu chi kiem "!== null" thi sau vai tuan MOI don to deu deo
// nhan "dang bi giam" vinh vien.
test("/admin/orders: don DA qua ngay mo khoa -> KHONG con nhan giam", () => {
  const html = renderOne(orderEntry({ availableFrom: "2020-01-08" }));
  assert.doesNotMatch(html, /mở khoá/);
});

/**
 * Don NHO vua duoc Shopee ghi "Hoan thanh" nhung con cho vai ngay o "Cho xac nhan" (2026-10-11, xem
 * payoutHold.ts): khong noi ro thi admin doi soat se thay bao cao Shopee ghi Hoan thanh ma trang
 * minh ghi "Cho xac nhan" va khong hieu vi sao. User KHONG thay dong nay (dashboard rieng).
 */
test("/admin/orders: don nho dang cho -> hien 'sàn đã duyệt' + ngay vao Kha dung", () => {
  const future = addDaysToVnIso(todayVnIso(), 1);
  const html = renderOne(orderEntry({ status: "pending", availableFrom: future }));
  assert.match(html, /sàn đã duyệt/);
  assert.match(html, new RegExp(`Khả dụng ${formatVnDateDdMm(new Date(`${future}T12:00:00Z`)).replace("/", "\\/")}`));
  // Khong duoc dung chu "mo khoa"/"tam giu" o day - do la ngon tu cua don TO bi giam.
  assert.doesNotMatch(html, /mở khoá/);
});

test("/admin/orders: don pending binh thuong (chua Hoan thanh) -> khong co dong 'sàn đã duyệt'", () => {
  const html = renderOne(orderEntry({ status: "pending" }));
  assert.doesNotMatch(html, /sàn đã duyệt/);
});

// Cung cai bay voi nhan "mo khoa": don da toi han van giu nguyen gia tri trong cot available_from.
test("/admin/orders: don nho DA toi han nhung chua import lai -> khong con dong 'sàn đã duyệt'", () => {
  const html = renderOne(orderEntry({ status: "pending", availableFrom: "2020-01-08" }));
  assert.doesNotMatch(html, /sàn đã duyệt/);
});

test("/admin/orders: don dang nam trong yeu cau rut -> khong deo nhan giam", () => {
  const html = renderOne(
    orderEntry({ availableFrom: addDaysToVnIso(todayVnIso(), 7), withdrawalId: "w1" })
  );
  assert.doesNotMatch(html, /mở khoá/, "don da duoc gom vao yeu cau rut thi nhan giam vo nghia");
});

test("/admin/orders: don da tra tien roi bi tra hang -> badge canh bao", () => {
  const html = renderOne(orderEntry({ status: "paid" }), new Set(["ORD1"]));
  assert.match(html, /đã trả hàng/);
});

// Entry 'paid' bi tra hang GIU NGUYEN status 'paid' (tien ra khoi tay that, user co sao ke), nen
// khong co badge thi hang do nhin y het mot don binh thuong.
test("/admin/orders: don bi tra hang VAN hien trang thai 'Da rut', khong doi thanh 'Da huy'", () => {
  const html = renderOne(orderEntry({ status: "paid" }), new Set(["ORD1"]));
  // Chi soi phan BANG (sau <tbody>) - "Đã huỷ" con xuat hien o dropdown loc trang thai phia tren.
  const tbody = html.slice(html.indexOf("<tbody"));
  assert.match(tbody, /Đã rút/);
  assert.doesNotMatch(tbody, /Đã huỷ/, "entry paid bi tra hang GIU NGUYEN status paid - tien ra khoi tay that");
  assert.match(tbody, /đã trả hàng/, "nhung phai co dau hieu rieng, khong thi nhin y het don binh thuong");
});

test("/admin/orders: don dang bi giam deo nhan 'Đang tạm giữ', KHONG phai 'Khả dụng'", () => {
  const tbody = (h: string) => h.slice(h.indexOf("<tbody"));
  const held = tbody(renderOne(orderEntry({ availableFrom: addDaysToVnIso(todayVnIso(), 7) })));
  assert.match(held, /Đang tạm giữ/);
  assert.doesNotMatch(held, /Khả dụng/, "2 chu 'Khả dụng' nghia la RUT DUOC NGAY - don nay chua");

  const free = tbody(renderOne(orderEntry()));
  assert.match(free, /Khả dụng/);
  assert.doesNotMatch(free, /Đang tạm giữ/);
});


// The KPI "Loi nhuan chu bot" hien them so TRUOC THUE nho ben canh (2026-10-10); COT "Chu bot nhan" trong
// bang van tinh theo cong thuc cu (after_tax - user_share, da tru phi) - user chi yeu cau doi the.
test("/admin/orders: the 'Loi nhuan chu bot' co so phu 'truoc thue' (nho hon, ben canh so chinh)", () => {
  const html = renderOne(orderEntry());
  const card = html.match(/<div class="[^"]*">\s*<div class="min-w-0">\s*<div class="[^"]*">Lợi nhuận chủ bot<\/div>[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? "";
  assert.notEqual(card, "", "phai tim thay the Loi nhuan chu bot");
  assert.match(card, /text-2xl[^>]*>2\.000đ</);
  assert.match(card, /text-xs[^>]*>[^<]*trước thuế 2\.500đ/);
  assert.doesNotMatch(card.match(/text-2xl[^>]*>[^<]*</)?.[0] ?? "", /2\.500/, "so truoc thue KHONG nam trong so chinh");
});

test("/admin/orders: cac the KPI khac KHONG co so phu 'truoc thue'", () => {
  const html = renderOne(orderEntry());
  assert.equal((html.match(/trước thuế/g) ?? []).length, 1);
});

test("/admin/orders: cot 'Chu bot nhan' trong bang VAN theo cong thuc cu (after_tax - user_share)", () => {
  const html = renderOne(orderEntry({ afterTaxAmount: 8_910, userShareAmount: 7_128, commissionAmount: 10_000, taxAmount: 1_000, platformFeeAmount: 90 }));
  const tbody = html.match(/<tbody[\s\S]*?<\/tbody>/)?.[0] ?? "";
  // 8.910 - 7.128 = 1.782 (da tru phi 90); neu doi sang cong thuc moi se la 10.000 - 1.000 - 7.128 = 1.872.
  assert.match(tbody, /1\.782đ/);
  assert.doesNotMatch(tbody, /1\.872đ/);
});
