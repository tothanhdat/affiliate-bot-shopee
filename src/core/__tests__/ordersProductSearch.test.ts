import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";

/**
 * O tim cua /admin/orders khop them TEN SAN PHAM (2026-10-14). Ten san pham la chu tieng Viet co dau, admin
 * go khong dau la chuyen thuong xuyen - LIKE cua SQLite chi bo qua hoa/thuong voi ASCII nen phai so khop
 * o JS (cung kieu findUserKeysByDisplayName). List/count/KPI phai loc y het nhau.
 */

function seed(ledger: LedgerStore, orderId: string, productName: string | undefined, userId = "user-a") {
  ledger.recordConversion({
    subId: `k-${userId}-${orderId}`,
    platform: "zalo",
    userId,
    merchant: "shopee",
    orderId,
    orderAmount: 100_000,
    commissionAmount: 10_000,
    productName,
    taxPercent: 0,
    platformFeePercent: 0,
    userSharePercent: 80,
    maxCommissionRatioPercent: 1000,
    holdConfig: { thresholdVnd: 0, holdDays: 0 },
  });
}

test("search: khop ten san pham KHONG DAU va khong phan biet hoa/thuong", () => {
  const ledger = new LedgerStore(":memory:");
  try {
    seed(ledger, "A1", "Kính cường lực Oppo A98");
    seed(ledger, "A2", "Đồ chơi Lật Đật");
    seed(ledger, "A3", "Sữa tắm Lifebuoy");

    const ids = (q: string) => ledger.listCommissionEntries({ search: q }).map((e) => e.orderId).sort();
    assert.deepEqual(ids("kinh cuong luc"), ["A1"]);
    assert.deepEqual(ids("KÍNH CƯỜNG"), ["A1"]);
    assert.deepEqual(ids("do choi"), ["A2"], "d khong dau khop Đ");
    assert.deepEqual(ids("sua tam"), ["A3"]);
    assert.deepEqual(ids("khong co san pham nay"), []);
  } finally {
    ledger.close();
  }
});

test("search: van khop ma don va userId nhu cu, hop voi ten san pham (OR)", () => {
  const ledger = new LedgerStore(":memory:");
  try {
    seed(ledger, "ORDER-XYZ", "Ao thun", "user-b");
    seed(ledger, "B2", "Quan jean", "user-c");

    const ids = (q: string) => ledger.listCommissionEntries({ search: q }).map((e) => e.orderId);
    assert.deepEqual(ids("xyz"), ["ORDER-XYZ"]);
    assert.deepEqual(ids("user-c"), ["B2"]);
    assert.deepEqual(ids("quan jean"), ["B2"]);
  } finally {
    ledger.close();
  }
});

test("search: don khong co ten san pham (NULL) khong lam hong tim kiem", () => {
  const ledger = new LedgerStore(":memory:");
  try {
    seed(ledger, "N1", undefined);
    seed(ledger, "N2", "Kinh cuong luc");
    assert.deepEqual(ledger.listCommissionEntries({ search: "kinh" }).map((e) => e.orderId), ["N2"]);
    assert.deepEqual(ledger.listCommissionEntries({ search: "n1" }).map((e) => e.orderId), ["N1"]);
  } finally {
    ledger.close();
  }
});

test("search: ky tu dac biet (% _ \\ ') la ky tu thuong, khong phai wildcard / khong vo SQL", () => {
  const ledger = new LedgerStore(":memory:");
  try {
    seed(ledger, "S1", "Giam 50% hom nay");
    seed(ledger, "S2", "Giam 5000 hom nay");
    seed(ledger, "S3", "Ao L'Oreal");
    const ids = (q: string) => ledger.listCommissionEntries({ search: q }).map((e) => e.orderId);
    assert.deepEqual(ids("50%"), ["S1"]);
    assert.deepEqual(ids("5_00"), []);
    assert.deepEqual(ids("l'oreal"), ["S3"]);
  } finally {
    ledger.close();
  }
});

test("search: list, count va the KPI loc y het nhau khi tim theo ten san pham", () => {
  const ledger = new LedgerStore(":memory:");
  try {
    seed(ledger, "K1", "Kính cường lực");
    seed(ledger, "K2", "Kính mát Rieti");
    seed(ledger, "K3", "Sữa tươi");

    const filters = { search: "kinh" };
    const listed = ledger.listCommissionEntries(filters);
    assert.equal(listed.length, 2);
    assert.equal(ledger.countCommissionEntries(filters), 2);
    assert.equal(ledger.getOrdersFilterTotals(filters).totalEntries, 2);
    assert.equal(ledger.getOrdersFilterTotals(filters).userShareTotal, 16_000);
    assert.equal(ledger.listCommissionEntries(filters, { limit: 1, offset: 1 }).length, 1);
  } finally {
    ledger.close();
  }
});

test("search: tab hoa hong gian tiep cung khop ten san pham khong dau", () => {
  const ledger = new LedgerStore(":memory:");
  try {
    ledger.upsertIndirectCommission({
      merchant: "shopee",
      orderId: "I1",
      subId: "k-u-1",
      platform: null,
      userId: null,
      productName: "Kính cường lực Oppo",
      orderAmount: 25_800,
      commissionAmount: 1_806,
      status: "pending",
      orderDate: null,
      orderTime: null,
      completedAt: null,
      taxPercent: 10,
    });
    assert.deepEqual(ledger.listIndirectCommissions({ search: "kinh cuong" }).map((r) => r.orderId), ["I1"]);
    assert.equal(ledger.getIndirectCommissionTotals({ search: "kinh cuong" }).totalEntries, 1);
    assert.equal(ledger.getIndirectCommissionTotals({ search: "sua" }).totalEntries, 0);
  } finally {
    ledger.close();
  }
});
