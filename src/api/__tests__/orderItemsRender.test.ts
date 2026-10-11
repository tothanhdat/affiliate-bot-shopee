import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDashboardPage } from "../dashboardHtml.js";
import { renderOrdersPage } from "../adminHtml.js";
import type { CommissionEntry } from "../../core/types.js";
import { entryItemsKey, type CommissionEntryItem } from "../../core/entryItems.js";

function entry(overrides: Partial<CommissionEntry> = {}): CommissionEntry {
  return {
    id: "e1",
    createdAt: "2026-10-10T03:00:00.000Z",
    orderDate: "2026-10-10",
    orderTime: null,
    completedAt: null,
    availableFrom: null,
    platform: "zalo",
    userId: "u1",
    merchant: "shopee",
    subId: "k-u1-abc-xyz",
    orderId: "2610109S28J4XY",
    productName: "Loi Vai Bo Aukobe (+1 sản phẩm khác)",
    orderAmount: 300_000,
    commissionAmount: 10_000,
    taxAmount: 1_000,
    platformFeeAmount: 90,
    afterTaxAmount: 8_910,
    userShareAmount: 7_128,
    taxPercent: 10,
    platformFeePercent: 1,
    userSharePercent: 80,
    commissionOverriddenAt: null,
    status: "pending",
    withdrawalId: null,
    note: null,
    proofImagePath: null,
    ...overrides,
  };
}

function item(overrides: Partial<CommissionEntryItem> = {}): CommissionEntryItem {
  return {
    merchant: "shopee",
    orderId: "2610109S28J4XY",
    itemId: "1",
    modelId: "1",
    productName: "Mon A",
    quantity: 1,
    orderAmount: 200_000,
    commissionAmount: 6_000,
    rowStatus: "pending",
    ...overrides,
  };
}

function renderDashboard(e: CommissionEntry, items?: CommissionEntryItem[]): string {
  const entryItems = items ? new Map([[entryItemsKey(e.merchant, e.orderId), items]]) : undefined;
  return renderDashboardPage({
    entries: [e],
    entryItems,
    availableBalance: 0,
    heldBalance: 0,
    heldEntries: [],
    debtRemaining: 0,
    debts: [],
    pendingBalance: 0,
    paidTotal: 0,
    pendingWithdrawal: null,
    thresholdVnd: 20_000,
    token: "tok",
    platform: "zalo",
    userId: "u1",
    displayName: "Yến Nhi",
  });
}

const TWO_ITEMS = [
  item({ itemId: "1", productName: "Mon A", orderAmount: 200_000, commissionAmount: 6_000 }),
  item({ itemId: "2", productName: "Mon B", orderAmount: 100_000, commissionAmount: 4_000 }),
];

test("dashboard: don >= 2 mon va cong lai khop -> hien khoi chi tiet kem dong tong", () => {
  const html = renderDashboard(entry(), TWO_ITEMS);
  assert.match(html, /<details class="order-items">/);
  assert.match(html, /2 sản phẩm trong đơn/);
  assert.ok(html.includes("Mon A") && html.includes("Mon B"));
  const block = html.match(/<details class="order-items">[\s\S]*?<\/details>/)![0];
  assert.ok(block.includes("300.000đ"), "tong gia tri phai bang o Gia tri don tren the");
  assert.ok(block.includes("10.000đ"), "tong hoa hong phai bang o Hoa hong tren the");
});

test("dashboard: don 1 mon hoac khong co chi tiet -> KHONG co khoi chi tiet", () => {
  const one = [item({ orderAmount: 300_000, commissionAmount: 10_000 })];
  assert.doesNotMatch(renderDashboard(entry(), one), /<details class="order-items">/);
  assert.doesNotMatch(renderDashboard(entry(), undefined), /<details class="order-items">/);
});

test("dashboard: cong lai KHONG khop the (vd admin da sua tay hoa hong) -> AN, khong hien so lech", () => {
  const html = renderDashboard(entry({ commissionAmount: 12_345 }), TWO_ITEMS);
  assert.doesNotMatch(html, /<details class="order-items">/);
});

test("dashboard: ten mon la chuoi nguoi la -> bi escape", () => {
  const html = renderDashboard(entry(), [
    item({ itemId: "1", productName: `<script>alert(1)</script>`, orderAmount: 200_000, commissionAmount: 6_000 }),
    item({ itemId: "2", orderAmount: 100_000, commissionAmount: 4_000 }),
  ]);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
});

test("dashboard: mon mua that hoa hong 0d hien 'chua co hoa hong', khong bi an", () => {
  const html = renderDashboard(entry({ orderAmount: 478_277, commissionAmount: 6_000 }), [
    item({ itemId: "1", orderAmount: 200_000, commissionAmount: 6_000 }),
    item({ itemId: "2", productName: "Sua tuoi", orderAmount: 278_277, commissionAmount: 0 }),
  ]);
  assert.ok(html.includes("Sua tuoi"));
  assert.match(html, /chưa có hoa hồng/);
});

test("dashboard: mon da huy gach ngang va KHONG cong vao dong tong", () => {
  const html = renderDashboard(entry({ orderAmount: 200_000, commissionAmount: 6_000 }), [
    item({ itemId: "1", orderAmount: 200_000, commissionAmount: 6_000 }),
    item({ itemId: "2", productName: "Mon da tra", orderAmount: 0, commissionAmount: 0, rowStatus: "reversed" }),
  ]);
  assert.match(html, /order-item order-item-void/);
});

test("dashboard: mon co so luong > 1 hien xN", () => {
  const html = renderDashboard(entry(), [
    item({ itemId: "1", orderAmount: 200_000, commissionAmount: 6_000 }),
    item({ itemId: "2", quantity: 2, orderAmount: 100_000, commissionAmount: 4_000 }),
  ]);
  assert.match(html, /<span class="item-qty">x2<\/span>/);
});

const PAGINATION = { page: 1, totalPages: 1, totalEntries: 1 };
const TOTALS = {
  totalEntries: 1,
  pendingEntries: 1,
  userShareTotal: 7_128,
  ownerShareTotal: 1_782,
  ownerShareBeforeTaxTotal: 2_000,
} as Parameters<typeof renderOrdersPage>[4];

function renderAdmin(e: CommissionEntry, items?: CommissionEntryItem[]): string {
  const map = items ? new Map([[entryItemsKey(e.merchant, e.orderId), items]]) : new Map();
  return renderOrdersPage([e], {}, new Map(), PAGINATION, TOTALS, 0, new Set(), map);
}

test("admin: don >= 2 mon -> co <details> ngay trong o San pham, mo ra thay tung mon", () => {
  const html = renderAdmin(entry(), TWO_ITEMS);
  assert.match(html, /<details class="details-plain/);
  assert.match(html, /2 sản phẩm/);
  assert.ok(html.includes("Mon A") && html.includes("Mon B"));
});

test("admin: don 1 mon hoac khong co chi tiet -> khong co khoi chi tiet, hang y nhu cu", () => {
  const one = [item({ orderAmount: 300_000, commissionAmount: 10_000 })];
  assert.doesNotMatch(renderAdmin(entry(), one), />\d+ sản phẩm<\/summary>/);
  assert.doesNotMatch(renderAdmin(entry(), undefined), />\d+ sản phẩm<\/summary>/);
});

test("admin: don admin da KHOA hoa hong tay -> co ghi chu 'sua tay, so Shopee bao'", () => {
  const html = renderAdmin(entry({ commissionOverriddenAt: "2026-10-10T05:00:00.000Z", commissionAmount: 12_345 }), TWO_ITEMS);
  assert.match(html, /Hoa hồng đã được sửa tay/);
  assert.match(html, /số Shopee báo/);
});

test("admin: tong cac mon khac so tren hang (khong phai do khoa tay) -> ghi chu lech", () => {
  const html = renderAdmin(entry({ commissionAmount: 12_345 }), TWO_ITEMS);
  assert.match(html, /Tổng các món bên dưới khác số trên hàng này/);
  assert.doesNotMatch(html, /Hoa hồng đã được sửa tay/);
});

test("admin: cong lai khop va khong khoa -> KHONG co ghi chu nao", () => {
  const html = renderAdmin(entry(), TWO_ITEMS);
  assert.doesNotMatch(html, /Hoa hồng đã được sửa tay|Tổng các món bên dưới khác/);
});

test("admin: ten mon la chuoi nguoi la -> bi escape; mon da huy gach ngang", () => {
  const html = renderAdmin(entry(), [
    item({ itemId: "1", productName: `<img src=x onerror=alert(1)>`, orderAmount: 200_000, commissionAmount: 6_000 }),
    item({ itemId: "2", productName: "Mon da tra", orderAmount: 100_000, commissionAmount: 4_000, rowStatus: "reversed" }),
  ]);
  assert.ok(!html.includes("<img src=x onerror=alert(1)>"));
  assert.match(html, /text-slate-400 line-through/);
});
