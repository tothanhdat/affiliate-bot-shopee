import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";
import { LogStore } from "../logStore.js";
import { importShopeeReport } from "../shopeeReportImport.js";

/**
 * Hoa hong GIAN TIEP (2026-10-14, bug that tren bao cao 14/10): Shopee gan Sub_id cua lan click CUOI
 * cho ca don o SHOP KHAC (cookie 7 ngay) va danh dau bang cot "Loại thuộc tính" = "Đơn hàng từ các
 * Shop khác nhau". Don 261013GNH72VWU (kinh cuong luc, item 18057763362) la vi du goc.
 */

const ORDER_CONFIG = {
  taxPercent: 10,
  platformFeePercent: 1,
  userSharePercent: 80,
  maxCommissionRatioPercent: 1000,
  holdConfig: { thresholdVnd: 0, holdDays: 0 },
};

const DIRECT = "Đơn hàng từ cùng một Shop";
const INDIRECT = "Đơn hàng từ các Shop khác nhau";

const HEADER = [
  "ID đơn hàng",
  "Thời Gian Đặt Hàng",
  "Tên Item",
  "Giá trị đơn hàng (₫)",
  "Tổng hoa hồng sản phẩm(₫)",
  "Trạng thái sản phẩm liên kết",
  "Loại thuộc tính",
  "Sub_id1",
  "Sub_id2",
  "Sub_id3",
  "Sub_id4",
  "Sub_id5",
];

interface RowInput {
  orderId: string;
  orderAmount?: number;
  commissionAmount: number;
  status?: string;
  attribution?: string;
  subId?: string;
  productName?: string;
}

const SUB = "k-user-a-mv1ohh25-c38742";

function buildCsv(rows: RowInput[]): string {
  const lines = [HEADER.join(",")];
  for (const r of rows) {
    const parts = (r.subId ?? SUB).split("-");
    lines.push(
      [
        r.orderId,
        "2026-10-13 13:41:24",
        `"${r.productName ?? "Kinh cuong luc Oppo"}"`,
        String(r.orderAmount ?? 25_800),
        String(r.commissionAmount),
        r.status ?? "Đang chờ xử lý",
        r.attribution ?? INDIRECT,
        ...[0, 1, 2, 3, 4].map((i) => parts[i] ?? ""),
      ].join(",")
    );
  }
  return lines.join("\n");
}

function setup() {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  logStore.record({
    platform: "zalo",
    merchant: "shopee",
    userId: "user-a",
    originalUrl: "https://shopee.vn/product/1/2",
    subId: SUB,
    outcome: "success",
    errorCode: null,
    affiliateUrl: "https://bot.example.com/s/abc",
  });
  const run = (rows: RowInput[]) => importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, buildCsv(rows));
  return { logStore, ledgerStore, run, close: () => (logStore.close(), ledgerStore.close()) };
}

test("gian tiep: don MOI 'cac Shop khac nhau' KHONG ghi tien cho user, vao bang hoa hong gian tiep", () => {
  const { ledgerStore, run, close } = setup();
  try {
    const result = run([{ orderId: "261013GNH72VWU", commissionAmount: 1806 }]);

    assert.equal(ledgerStore.getEntryByOrderId("shopee", "261013GNH72VWU"), null);
    assert.equal(result.pendingNew, 0);
    assert.deepEqual(result.newOrderIds, []);
    assert.equal(result.indirectCount, 1);

    const row = ledgerStore.getIndirectCommission("shopee", "261013GNH72VWU");
    assert.ok(row);
    assert.equal(row.status, "pending");
    assert.equal(row.commissionAmount, 1806);
    assert.equal(row.platform, "zalo");
    assert.equal(row.userId, "user-a");
    assert.equal(row.subId, SUB);
    assert.equal(row.taxPercent, 10);
    assert.equal(row.taxAmount, 181); // round(1806 * 10%) - cung phep lam tron voi computeCommissionBreakdown
    assert.equal(row.orderDate, "2026-10-13");
  } finally {
    close();
  }
});

test("gian tiep: 'cung mot Shop' van ghi cho user nhu cu (mon mua kem cung shop van tinh - loi hua /so-tay)", () => {
  const { ledgerStore, run, close } = setup();
  try {
    const result = run([{ orderId: "D1", commissionAmount: 10_000, attribution: DIRECT }]);
    assert.equal(result.pendingNew, 1);
    assert.equal(result.indirectCount, 0);
    assert.equal(ledgerStore.getEntryByOrderId("shopee", "D1")?.status, "pending");
    assert.equal(ledgerStore.getIndirectCommission("shopee", "D1"), null);
  } finally {
    close();
  }
});

test("gian tiep: o 'Loai thuoc tinh' rong (bao cao cu/khong co cot) -> coi la truc tiep nhu truoc", () => {
  const { ledgerStore, run, close } = setup();
  try {
    const result = run([{ orderId: "D2", commissionAmount: 10_000, attribution: "" }]);
    assert.equal(result.pendingNew, 1);
    assert.equal(ledgerStore.getIndirectCommission("shopee", "D2"), null);
  } finally {
    close();
  }
});

test("gian tiep: entry PENDING da co trong DB -> GIU NGUYEN cho user, di duong cu (chi chan don MOI)", () => {
  const { ledgerStore, run, close } = setup();
  try {
    run([{ orderId: "P1", commissionAmount: 1806, attribution: "" }]); // lan truoc: chua doc cot nay
    assert.equal(ledgerStore.getEntryByOrderId("shopee", "P1")?.status, "pending");

    const result = run([{ orderId: "P1", commissionAmount: 1806 }]);
    assert.equal(ledgerStore.getEntryByOrderId("shopee", "P1")?.status, "pending");
    assert.deepEqual(result.indirectKeptForUser, ["P1"]);
    assert.equal(result.pendingUpdated, 1);
    assert.deepEqual(result.statusTransitions, []);
    assert.equal(result.indirectCount, 0);
    assert.equal(ledgerStore.getIndirectCommission("shopee", "P1"), null);

    // Shopee duyet sau do -> van vao Kha dung cua user nhu binh thuong.
    run([{ orderId: "P1", commissionAmount: 1806, status: "Hoàn thành" }]);
    assert.equal(ledgerStore.getEntryByOrderId("shopee", "P1")?.status, "confirmed");
    assert.equal(ledgerStore.getIndirectCommission("shopee", "P1"), null);
  } finally {
    close();
  }
});

test("gian tiep: entry da HUY trong DB -> cung giu nguyen, khong ghi vao bang gian tiep", () => {
  const { ledgerStore, run, close } = setup();
  try {
    run([{ orderId: "H1", commissionAmount: 1000, attribution: "" }]);
    run([{ orderId: "H1", commissionAmount: 0, status: "Đã hủy", attribution: "" }]);
    assert.equal(ledgerStore.getEntryByOrderId("shopee", "H1")?.status, "reversed");

    const result = run([{ orderId: "H1", commissionAmount: 0, status: "Đã hủy" }]);
    assert.equal(ledgerStore.getEntryByOrderId("shopee", "H1")?.status, "reversed");
    assert.equal(ledgerStore.getIndirectCommission("shopee", "H1"), null);
    assert.deepEqual(result.indirectKeptForUser, [], "don da huy khong can liet ke");
  } finally {
    close();
  }
});

test("gian tiep: entry da KHA DUNG -> giu nguyen cho user, khong ghi vao bang gian tiep, bao admin bang 1 danh sach", () => {
  const { ledgerStore, run, close } = setup();
  try {
    run([{ orderId: "C1", commissionAmount: 10_000, status: "Hoàn thành", attribution: "" }]);
    assert.equal(ledgerStore.getEntryByOrderId("shopee", "C1")?.status, "confirmed");

    const result = run([{ orderId: "C1", commissionAmount: 10_000, status: "Hoàn thành" }]);
    assert.equal(ledgerStore.getEntryByOrderId("shopee", "C1")?.status, "confirmed");
    assert.deepEqual(result.indirectKeptForUser, ["C1"]);
    assert.equal(result.confirmedDuplicate, 1);
    assert.equal(ledgerStore.getIndirectCommission("shopee", "C1"), null);

    // Van di duong cu: Shopee bao huy sau do thi tien user van bi thu hoi binh thuong.
    run([{ orderId: "C1", commissionAmount: 0, status: "Đã hủy" }]);
    assert.equal(ledgerStore.getEntryByOrderId("shopee", "C1")?.status, "reversed");
  } finally {
    close();
  }
});

test("gian tiep: chay lai cung file -> khong nhan doi, cap nhat so lieu, giu nguyen thue da chot", () => {
  const { ledgerStore, run, close } = setup();
  try {
    run([{ orderId: "R1", commissionAmount: 1000 }]);
    const again = run([{ orderId: "R1", commissionAmount: 2000, status: "Hoàn thành" }]);
    assert.equal(again.indirectCount, 1);
    const rows = ledgerStore.listIndirectCommissions({});
    assert.equal(rows.length, 1);
    assert.equal(rows[0].commissionAmount, 2000);
    assert.equal(rows[0].taxAmount, 200);
    assert.equal(rows[0].status, "confirmed");
  } finally {
    close();
  }
});

test("gian tiep: don MOI ma da huy ngay tu dau -> bo qua im lang (giong don truc tiep chua tung ghi)", () => {
  const { ledgerStore, run, close } = setup();
  try {
    const result = run([{ orderId: "X1", commissionAmount: 0, status: "Đã hủy" }]);
    assert.equal(result.indirectCount, 0);
    assert.equal(ledgerStore.getIndirectCommission("shopee", "X1"), null);
  } finally {
    close();
  }
});

test("gian tiep: don gian tiep da co trong bang, bao cao sau ghi 'Da huy' -> cap nhat thanh reversed", () => {
  const { ledgerStore, run, close } = setup();
  try {
    run([{ orderId: "X2", commissionAmount: 500 }]);
    run([{ orderId: "X2", commissionAmount: 0, status: "Đã hủy" }]);
    assert.equal(ledgerStore.getIndirectCommission("shopee", "X2")?.status, "reversed");
  } finally {
    close();
  }
});

test("gian tiep: subId khong khop request nao -> van ghi gian tiep, khong biet nguoi click", () => {
  const { ledgerStore, run, close } = setup();
  try {
    const result = run([{ orderId: "N1", commissionAmount: 700, subId: "k-ai-do-xyz-123" }]);
    assert.equal(result.indirectCount, 1);
    assert.equal(result.skippedSubIdNotFound, 0);
    const row = ledgerStore.getIndirectCommission("shopee", "N1");
    assert.equal(row?.platform, null);
    assert.equal(row?.userId, null);
  } finally {
    close();
  }
});

test("gian tiep: gia tri 'Loai thuoc tinh' la -> bo qua CA don + canh bao, khong doan", () => {
  const { ledgerStore, run, close } = setup();
  try {
    const result = run([{ orderId: "U1", commissionAmount: 700, attribution: "Đơn hàng kiểu mới" }]);
    assert.equal(result.skippedUnknownAttribution, 1);
    assert.equal(ledgerStore.getEntryByOrderId("shopee", "U1"), null);
    assert.equal(ledgerStore.getIndirectCommission("shopee", "U1"), null);
    assert.ok(result.errors.some((e) => e.includes("U1") && e.includes("Đơn hàng kiểu mới")));
  } finally {
    close();
  }
});

test("gian tiep: 1 don lan ca 'cung mot Shop' va 'cac Shop khac nhau' -> bo qua CA don + canh bao", () => {
  const { ledgerStore, run, close } = setup();
  try {
    const result = run([
      { orderId: "M1", commissionAmount: 700, attribution: DIRECT },
      { orderId: "M1", commissionAmount: 300, attribution: INDIRECT },
    ]);
    assert.equal(result.skippedUnknownAttribution, 1);
    assert.equal(ledgerStore.getEntryByOrderId("shopee", "M1"), null);
    assert.equal(ledgerStore.getIndirectCommission("shopee", "M1"), null);
  } finally {
    close();
  }
});

test("gian tiep: don co Sub_id rong VAN la skippedNoSubId nhu cu (khong lien quan link bot)", () => {
  const { ledgerStore, run, close } = setup();
  try {
    const csv = buildCsv([{ orderId: "E1", commissionAmount: 3000 }]).replace(SUB.split("-").join(","), ",,,,");
    const result = importShopeeReport(new LogStore(":memory:"), ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);
    assert.equal(result.skippedNoSubId, 1);
    assert.equal(result.indirectCount, 0);
  } finally {
    close();
  }
});

test("gian tiep: /admin/dashboard cong hoa hong gian tiep vao Hoa hong goc + Loi nhuan chu bot, the = tong chart", () => {
  const { ledgerStore, run, close } = setup();
  try {
    run([
      { orderId: "G1", commissionAmount: 10_000, attribution: DIRECT },
      { orderId: "G2", commissionAmount: 2_000 },
    ]);
    run([{ orderId: "G3", commissionAmount: 5_000 }]);
    run([{ orderId: "G3", commissionAmount: 0, status: "Đã hủy" }]); // gian tiep da huy: khong tinh

    const direct = ledgerStore.getEntryByOrderId("shopee", "G1")!;
    const money = ledgerStore.getDashboardMoneyTotals("2026-10-01", "2026-10-31");
    assert.equal(money.commission, 12_000);
    // gian tiep: 2000 - thue 200 (khong co phan chia user)
    assert.equal(money.ownerProfit, direct.commissionAmount - direct.taxAmount - direct.userShareAmount + 1_800);
    assert.equal(money.ownerProfitBeforeTax, direct.commissionAmount - direct.userShareAmount + 2_000);
    assert.equal(money.orderCount, 1, "orderCount van chi la don cua user");

    const byDay = ledgerStore.sumCommissionByDay("2026-10-01", "2026-10-31");
    assert.equal(byDay.reduce((s, d) => s + d.commission, 0), money.commission);
    assert.equal(byDay.reduce((s, d) => s + d.ownerProfit, 0), money.ownerProfit);
  } finally {
    close();
  }
});

test("gian tiep: tong hop cho tab /admin/orders loc theo trang thai + tim kiem", () => {
  const { ledgerStore, run, close } = setup();
  try {
    run([
      { orderId: "T1", commissionAmount: 1_000 },
      { orderId: "T2", commissionAmount: 3_000, status: "Hoàn thành", productName: "Ao thun" },
    ]);
    run([{ orderId: "T1", commissionAmount: 1_000 }, { orderId: "T3", commissionAmount: 9_000 }]);
    run([{ orderId: "T3", commissionAmount: 0, status: "Đã hủy" }]);

    const all = ledgerStore.getIndirectCommissionTotals({});
    assert.equal(all.totalEntries, 3);
    assert.equal(all.pendingEntries, 1);
    assert.equal(all.commissionTotal, 4_000, "khong tinh don da huy");
    assert.equal(all.ownerProfitTotal, 3_600);

    assert.equal(ledgerStore.getIndirectCommissionTotals({ statuses: ["confirmed"] }).totalEntries, 1);
    assert.deepEqual(
      ledgerStore.listIndirectCommissions({ search: "ao thun" }).map((r) => r.orderId),
      ["T2"]
    );
    assert.equal(ledgerStore.listIndirectCommissions({}, { limit: 2, offset: 0 }).length, 2);
  } finally {
    close();
  }
});
