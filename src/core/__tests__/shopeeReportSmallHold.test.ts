import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";
import { LogStore } from "../logStore.js";
import { importShopeeReport } from "../shopeeReportImport.js";
import { addDaysToVnIso, todayVnIso } from "../vietnamDate.js";

/**
 * Import bao cao Shopee khi don NHO phai cho them vai ngay o "Cho xac nhan" (2026-10-11) - xem
 * payoutHold.ts. Trong tam: don dang cho KHONG duoc coi la "confirmed", nen khong sinh tin "don ve"
 * va khong dem vao cot "Chuyen Kha dung" cua /admin/dashboard.
 */
const TODAY = todayVnIso();
const YESTERDAY = addDaysToVnIso(TODAY, -1);
const TOMORROW = addDaysToVnIso(TODAY, 1);

/** user nhan 100% de so hoa hong trong CSV chinh la user_share - de doi chieu voi nguong. */
const ORDER_CONFIG = {
  taxPercent: 0,
  platformFeePercent: 0,
  userSharePercent: 100,
  maxCommissionRatioPercent: 1000,
  holdConfig: { thresholdVnd: 100_000, holdDays: 7, smallHoldDays: 1 },
};

const HEADER = [
  "ID đơn hàng",
  "Tên Item",
  "Giá trị đơn hàng (₫)",
  "Tổng hoa hồng sản phẩm(₫)",
  "Trạng thái sản phẩm liên kết",
  "Thời gian hoàn thành",
  "Sub_id1",
];

function buildCsv(rows: Array<{ orderId: string; commissionAmount: number; status: string; completedAt: string }>) {
  const lines = [HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [r.orderId, '"San pham test"', "2000000", String(r.commissionAmount), r.status, `${r.completedAt} 10:00:00`, "k-user-a-abc-def"].join(
        ","
      )
    );
  }
  return lines.join("\n");
}

function seed(logStore: LogStore) {
  logStore.record({
    platform: "zalo",
    merchant: "shopee",
    userId: "user-a",
    originalUrl: "https://shopee.vn/product/1/2",
    subId: "k-user-a-abc-def",
    outcome: "success",
    errorCode: null,
    affiliateUrl: "https://bot.example.com/s/abc",
  });
}

function run(csv: string, ledgerStore: LedgerStore, logStore: LogStore) {
  return importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);
}

test("don nho 'Hoan thanh' hom nay -> entry pending, KHONG sinh tin 'don ve'", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seed(logStore);
    const result = run(
      buildCsv([{ orderId: "SP-NHO", commissionAmount: 50_000, status: "Hoàn thành", completedAt: TODAY }]),
      ledgerStore,
      logStore
    );

    const entry = ledgerStore.getEntryByOrderId("shopee", "SP-NHO");
    assert.equal(entry?.status, "pending");
    assert.equal(entry?.availableFrom, TOMORROW);

    assert.equal(result.confirmedNew, 0);
    assert.equal(result.smallHoldDeferred, 1);
    // Khong co tin nhan nao duoc gui: user chi thay "Cho xac nhan" tren dashboard.
    assert.deepEqual(result.confirmedByUser, []);
    // Khong phai chuyen trang thai that -> khong duoc dem vao cot "Chuyen Kha dung" cua dashboard.
    assert.deepEqual(result.statusTransitions, []);
    // Nhung VAN la don ghi moi: lich su import tren /admin/record-orders phai thay.
    assert.deepEqual(result.newOrderIds, ["SP-NHO"]);
    // "Dang bi giam" chi danh cho don TO - don nho dang cho khong mang nhan do.
    assert.equal(result.heldCount, 0);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

test("don nho giao HOM QUA -> da toi han, confirmed ngay va co tin 'don ve'", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seed(logStore);
    const result = run(
      buildCsv([{ orderId: "SP-CU", commissionAmount: 50_000, status: "Hoàn thành", completedAt: YESTERDAY }]),
      ledgerStore,
      logStore
    );

    assert.equal(ledgerStore.getEntryByOrderId("shopee", "SP-CU")?.status, "confirmed");
    assert.equal(result.confirmedNew, 1);
    assert.equal(result.smallHoldDeferred, 0);
    assert.equal(result.confirmedByUser.length, 1);
    assert.equal(ledgerStore.getAvailableBalance("zalo", "user-a"), 50_000);
    // available_from = HOM NAY (da toi han) KHONG phai "dang bi giam": phai so voi hom nay chu khong
    // chi kiem `!== null`, neu khong thi moi don nho vua mo khoa deu bi dem nhu don to bi giam.
    assert.equal(result.heldCount, 0);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

test("don TO -> confirmed ngay + dem vao heldCount (hanh vi cu, khong doi)", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seed(logStore);
    const result = run(
      buildCsv([{ orderId: "SP-TO", commissionAmount: 500_000, status: "Hoàn thành", completedAt: TODAY }]),
      ledgerStore,
      logStore
    );

    const entry = ledgerStore.getEntryByOrderId("shopee", "SP-TO");
    assert.equal(entry?.status, "confirmed");
    assert.equal(entry?.availableFrom, addDaysToVnIso(TODAY, 7));
    assert.equal(result.confirmedNew, 1);
    assert.equal(result.heldCount, 1);
    assert.equal(result.smallHoldDeferred, 0);
    assert.equal(result.confirmedByUser.length, 1);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

// Bao cao Shopee liet ke lai ca lich su moi lan import, nen don dang cho se xuat hien lai hom sau.
test("import lai khi don nho chua toi han -> van pending, khong gui tin, khong dem don moi", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seed(logStore);
    const csv = buildCsv([
      { orderId: "SP-NHO", commissionAmount: 50_000, status: "Hoàn thành", completedAt: TODAY },
    ]);
    run(csv, ledgerStore, logStore);
    const again = run(csv, ledgerStore, logStore);

    assert.equal(ledgerStore.getEntryByOrderId("shopee", "SP-NHO")?.status, "pending");
    assert.equal(again.confirmedNew, 0);
    assert.equal(again.smallHoldDeferred, 1);
    assert.deepEqual(again.confirmedByUser, []);
    assert.deepEqual(again.newOrderIds, []);
    assert.deepEqual(again.statusTransitions, []);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

// Lo hon hop: don to bao hom nay, don nho bao hom sau (2 tin o 2 ngay) - danh doi da duoc user chap
// nhan 2026-10-11, doi lai moi don di theo dung mot luat khong phu thuoc don dung canh.
test("lo co ca don to va don nho -> chi don to vao tin 'don ve' hom nay", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seed(logStore);
    const result = run(
      buildCsv([
        { orderId: "SP-TO", commissionAmount: 500_000, status: "Hoàn thành", completedAt: TODAY },
        { orderId: "SP-NHO", commissionAmount: 40_000, status: "Hoàn thành", completedAt: TODAY },
      ]),
      ledgerStore,
      logStore
    );

    assert.equal(result.confirmedNew, 1);
    assert.equal(result.smallHoldDeferred, 1);
    assert.equal(result.confirmedByUser.length, 1);
    assert.deepEqual(
      result.confirmedByUser[0].items.map((i) => i.orderId),
      ["SP-TO"]
    );
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});
