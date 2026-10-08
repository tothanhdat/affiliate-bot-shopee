import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";
import { LogStore } from "../logStore.js";
import { importShopeeReport, parseShopeeReportDay } from "../shopeeReportImport.js";

/**
 * Ngay dat don THAT lay tu cot "Thời Gian Đặt Hàng" cua bao cao Shopee (2026-10-01) - truoc do
 * dashboard chi co created_at (= luc admin import), nen import gop 3 ngay mot luc se ve ra 1 cot
 * dung dung va 2 ngay trong, doc nham thanh "dich vu tang vot roi chet".
 *
 * Luu y ten cot: Shopee viet hoa "G" va "H" giua cau ("Thời Gian Đặt Hàng") trong khi 2 cot ngay
 * ke ben lai viet thuong ("Thời gian hoàn thành", "Thời gian Click") - da doi chieu voi file that
 * AffiliateCommissionReport_202610010938.csv, KHONG duoc "sua lai cho dong nhat".
 */

const ORDER_CONFIG = {
  taxPercent: 0,
  platformFeePercent: 0,
  userSharePercent: 80,
  maxCommissionRatioPercent: 1000,
  holdConfig: { thresholdVnd: 0, holdDays: 0 },
};

const HEADER = [
  "ID đơn hàng",
  "Thời Gian Đặt Hàng",
  "Thời gian hoàn thành",
  "Tên Item",
  "Giá trị đơn hàng (₫)",
  "Tổng hoa hồng sản phẩm(₫)",
  "Trạng thái sản phẩm liên kết",
  "Sub_id1",
  "Sub_id2",
  "Sub_id3",
  "Sub_id4",
  "Sub_id5",
];

interface RowInput {
  orderId: string;
  orderTime: string;
  /** Cot "Thời gian hoàn thành" - de trong giong bao cao that cho dong pending/huy. */
  completedTime?: string;
  orderAmount: number;
  commissionAmount: number;
  status: string;
  subId: string;
}

function buildCsv(rows: RowInput[]): string {
  const lines = [HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.orderId,
        r.orderTime,
        r.completedTime ?? "",
        '"San pham test"',
        String(r.orderAmount),
        String(r.commissionAmount),
        r.status,
        r.subId,
        "",
        "",
        "",
        "",
      ].join(",")
    );
  }
  return lines.join("\n");
}

function seedRequestLog(logStore: LogStore, subId: string) {
  logStore.record({
    platform: "zalo",
    merchant: "shopee",
    userId: "user-a",
    originalUrl: "https://shopee.vn/product/1/2",
    subId,
    outcome: "success",
    errorCode: null,
    affiliateUrl: "https://bot.example.com/s/abc",
  });
}

// ---------------------------------------------------------------------------
// parseShopeeReportDay
// ---------------------------------------------------------------------------

test("parseShopeeReportDay: dinh dang that cua Shopee -> 'YYYY-MM-DD'", () => {
  assert.equal(parseShopeeReportDay("2026-09-30 13:07:34"), "2026-09-30");
  assert.equal(parseShopeeReportDay("2026-09-30 00:05:04"), "2026-09-30");
  assert.equal(parseShopeeReportDay("  2026-10-01 23:59:59  "), "2026-10-01");
});

test("parseShopeeReportDay: chi co ngay, khong co gio -> van doc duoc", () => {
  assert.equal(parseShopeeReportDay("2026-09-30"), "2026-09-30");
});

test("parseShopeeReportDay: gia tri thieu/la -> null, KHONG doan", () => {
  assert.equal(parseShopeeReportDay(""), null);
  assert.equal(parseShopeeReportDay(undefined), null);
  assert.equal(parseShopeeReportDay("   "), null);
  assert.equal(parseShopeeReportDay("30/09/2026"), null); // dinh dang khac -> khong doan dd/mm hay mm/dd
  assert.equal(parseShopeeReportDay("hom qua"), null);
  assert.equal(parseShopeeReportDay("2026-13-45 10:00:00"), null); // thang 13/ngay 45 khong ton tai
});

// ---------------------------------------------------------------------------
// importShopeeReport ghi order_date
// ---------------------------------------------------------------------------

test("importShopeeReport: ghi order_date tu cot 'Thời Gian Đặt Hàng'", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  seedRequestLog(logStore, "k-user-a-1");

  const csv = buildCsv([
    {
      orderId: "ORD1",
      orderTime: "2026-09-29 13:07:34",
      orderAmount: 1_000_000,
      commissionAmount: 50_000,
      status: "Hoàn thành",
      subId: "k-user-a-1",
    },
  ]);

  const result = importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);
  assert.equal(result.confirmedNew, 1);

  const entry = ledgerStore.getEntryByOrderId("shopee", "ORD1");
  assert.equal(entry?.orderDate, "2026-09-29");

  logStore.close();
  ledgerStore.close();
});

test("importShopeeReport: cot ngay hong KHONG duoc lam fail ca don (day la bang tien)", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  seedRequestLog(logStore, "k-user-a-2");

  const csv = buildCsv([
    {
      orderId: "ORD2",
      orderTime: "ngay gi do",
      orderAmount: 1_000_000,
      commissionAmount: 50_000,
      status: "Hoàn thành",
      subId: "k-user-a-2",
    },
  ]);

  const result = importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);

  // Hoa hong VAN phai duoc ghi nhan - mot cot thong ke khong duoc quyen chan tien cua user.
  assert.equal(result.confirmedNew, 1);
  const entry = ledgerStore.getEntryByOrderId("shopee", "ORD2");
  assert.equal(entry?.userShareAmount, 40_000);
  assert.equal(entry?.orderDate, null);

  logStore.close();
  ledgerStore.close();
});

test("importShopeeReport: don gop nhieu dong lay ngay dat SOM NHAT", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  seedRequestLog(logStore, "k-user-a-3");

  const csv = buildCsv([
    {
      orderId: "ORD3",
      orderTime: "2026-09-30 10:00:00",
      orderAmount: 500_000,
      commissionAmount: 25_000,
      status: "Hoàn thành",
      subId: "k-user-a-3",
    },
    {
      orderId: "ORD3",
      orderTime: "2026-09-29 08:00:00",
      orderAmount: 500_000,
      commissionAmount: 25_000,
      status: "Hoàn thành",
      subId: "k-user-a-3",
    },
  ]);

  importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);

  const entry = ledgerStore.getEntryByOrderId("shopee", "ORD3");
  assert.equal(entry?.orderDate, "2026-09-29");

  logStore.close();
  ledgerStore.close();
});

test("importShopeeReport: entry pending ghi TRUOC khi co cot ngay duoc bu order_date o lan import sau", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  seedRequestLog(logStore, "k-user-a-4");

  // Lan 1: bao cao khong co cot ngay (mo phong du lieu cu) -> entry pending, order_date null.
  const csvNoDate =
    ["ID đơn hàng", "Tên Item", "Giá trị đơn hàng (₫)", "Tổng hoa hồng sản phẩm(₫)", "Trạng thái sản phẩm liên kết", "Sub_id1"].join(",") +
    "\n" +
    ["ORD4", '"San pham test"', "1000000", "50000", "Đang chờ xử lý", "k-user-a-4"].join(",");
  importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csvNoDate);
  assert.equal(ledgerStore.getEntryByOrderId("shopee", "ORD4")?.orderDate, null);

  // Lan 2: bao cao moi co cot ngay -> bu vao entry da co.
  const csvWithDate = buildCsv([
    {
      orderId: "ORD4",
      orderTime: "2026-09-28 09:00:00",
      orderAmount: 1_000_000,
      commissionAmount: 50_000,
      status: "Hoàn thành",
      subId: "k-user-a-4",
    },
  ]);
  importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csvWithDate);

  const entry = ledgerStore.getEntryByOrderId("shopee", "ORD4");
  assert.equal(entry?.status, "confirmed");
  assert.equal(entry?.orderDate, "2026-09-28");

  logStore.close();
  ledgerStore.close();
});

// ---------------------------------------------------------------------------
// importShopeeReport ghi completed_at tu cot "Thời gian hoàn thành" (2026-10-08)
// ---------------------------------------------------------------------------

test("importShopeeReport: ghi completed_at tu cot 'Thời gian hoàn thành'", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  seedRequestLog(logStore, "k-user-a-aaa-111");

  importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, buildCsv([
      {
        orderId: "DONE1",
        orderTime: "2026-09-30 10:00:00",
        completedTime: "2026-10-02 18:30:00",
        orderAmount: 500_000,
        commissionAmount: 50_000,
        status: "Hoàn thành",
        subId: "k-user-a-aaa-111",
      },
    ]));

  const entry = ledgerStore.listCommissionEntries({ userId: "user-a" })[0];
  assert.equal(entry.completedAt, "2026-10-02");
  assert.equal(entry.orderDate, "2026-09-30", "order_date van doc dung cot cua no");
});

test("importShopeeReport: don pending de trong cot hoan thanh -> completed_at null", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  seedRequestLog(logStore, "k-user-a-aaa-111");

  importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, buildCsv([
      {
        orderId: "PEND1",
        orderTime: "2026-09-30 10:00:00",
        orderAmount: 500_000,
        commissionAmount: 50_000,
        status: "Đang chờ xử lý",
        subId: "k-user-a-aaa-111",
      },
    ]));

  const entry = ledgerStore.listCommissionEntries({ userId: "user-a" })[0];
  assert.equal(entry.completedAt, null);
});

// Nguoc voi orderDate (lay SOM nhat): cua so tra hang cua ca don chi dong khi mon giao CUOI CUNG da
// het han tra.
test("importShopeeReport: don gop nhieu dong -> completed_at lay ngay MUON NHAT", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  seedRequestLog(logStore, "k-user-a-aaa-111");

  importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, buildCsv([
      {
        orderId: "MULTI1",
        orderTime: "2026-09-30 10:00:00",
        completedTime: "2026-10-02 18:30:00",
        orderAmount: 300_000,
        commissionAmount: 30_000,
        status: "Hoàn thành",
        subId: "k-user-a-aaa-111",
      },
      {
        orderId: "MULTI1",
        orderTime: "2026-09-30 10:00:00",
        completedTime: "2026-10-05 09:00:00",
        orderAmount: 200_000,
        commissionAmount: 20_000,
        status: "Hoàn thành",
        subId: "k-user-a-aaa-111",
      },
    ]));

  const entry = ledgerStore.listCommissionEntries({ userId: "user-a" })[0];
  assert.equal(entry.completedAt, "2026-10-05");
});

// Cot thong ke khong duoc quyen chan viec ghi nhan TIEN.
test("importShopeeReport: cot hoan thanh sai dinh dang -> completed_at null nhung don VAN duoc ghi", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  seedRequestLog(logStore, "k-user-a-aaa-111");

  const result = importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, buildCsv([
      {
        orderId: "BADDATE1",
        orderTime: "2026-09-30 10:00:00",
        completedTime: "05/10/2026 09:00",
        orderAmount: 500_000,
        commissionAmount: 50_000,
        status: "Hoàn thành",
        subId: "k-user-a-aaa-111",
      },
    ]));

  assert.equal(result.confirmedNew, 1, "don van duoc ghi nhan");
  const entry = ledgerStore.listCommissionEntries({ userId: "user-a" })[0];
  assert.equal(entry.completedAt, null);
});

// ---------------------------------------------------------------------------
// Bang quyet dinh nhanh "Da huy" (2026-10-08, Task 11)
//
// Truoc day CHI ca 'pending' duoc xu li; 4 ca con lai roi het vao 1 dong warning, nen entry confirmed
// CHUA rut cung khong bi reverse - tien LAY LAI DUOC ma van mat.
// ---------------------------------------------------------------------------

const BANK = { bankName: "Vietcombank", bankAccountNumber: "0123456789", bankAccountHolder: "Nguyen Van A" };
const HOLD_ON_CONFIG = { ...ORDER_CONFIG, holdConfig: { thresholdVnd: 100_000, holdDays: 7 } };

function setupImport() {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  seedRequestLog(logStore, "k-user-a-aaa-111");
  return { logStore, ledgerStore };
}

function importDone(logStore: LogStore, ledgerStore: LedgerStore, config = ORDER_CONFIG, commission = 50_000) {
  return importShopeeReport(
    logStore,
    ledgerStore,
    { recordOrderConfig: config },
    buildCsv([
      {
        orderId: "X1",
        orderTime: "2026-09-30 10:00:00",
        completedTime: "2026-10-02 18:30:00",
        orderAmount: commission * 10,
        commissionAmount: commission,
        status: "Hoàn thành",
        subId: "k-user-a-aaa-111",
      },
    ])
  );
}

function importCancelled(logStore: LogStore, ledgerStore: LedgerStore, config = ORDER_CONFIG) {
  return importShopeeReport(
    logStore,
    ledgerStore,
    { recordOrderConfig: config },
    buildCsv([
      {
        orderId: "X1",
        orderTime: "2026-09-30 10:00:00",
        orderAmount: 0,
        commissionAmount: 0,
        status: "Đã hủy",
        subId: "k-user-a-aaa-111",
      },
    ])
  );
}

test("'Da huy' + entry confirmed CHUA rut -> reverse, KHONG sinh no (thu hoi tron)", () => {
  const { logStore, ledgerStore } = setupImport();
  importDone(logStore, ledgerStore);
  const result = importCancelled(logStore, ledgerStore);

  assert.equal(ledgerStore.getEntryByOrderId("shopee", "X1")?.status, "reversed");
  assert.equal(result.reversedCount, 1);
  assert.equal(result.debtCreatedCount, 0, "tien con trong tay thi KHONG phai no");
  assert.equal(ledgerStore.getOutstandingDebtTotal("zalo", "user-a"), 0);
  assert.deepEqual(result.statusTransitions, [{ orderId: "X1", from: "confirmed", to: "reversed" }]);
});

test("'Da huy' + entry confirmed DANG BI GIAM -> van reverse, khong no", () => {
  const { logStore, ledgerStore } = setupImport();
  // commission 300k, nguong 100k -> bi giam
  importDone(logStore, ledgerStore, HOLD_ON_CONFIG, 300_000);
  const held = ledgerStore.getEntryByOrderId("shopee", "X1");
  assert.ok(held?.availableFrom, "dung la don dang bi giam");

  const result = importCancelled(logStore, ledgerStore, HOLD_ON_CONFIG);
  assert.equal(ledgerStore.getEntryByOrderId("shopee", "X1")?.status, "reversed");
  assert.equal(result.debtCreatedCount, 0);
});

test("'Da huy' + entry da 'paid' -> sinh no, status VAN la 'paid'", () => {
  const { logStore, ledgerStore } = setupImport();
  importDone(logStore, ledgerStore);
  const w = ledgerStore.requestWithdrawal("zalo", "user-a", 20_000, BANK);
  ledgerStore.markWithdrawalPaid(w.id, null);

  const result = importCancelled(logStore, ledgerStore);

  const entry = ledgerStore.getEntryByOrderId("shopee", "X1");
  assert.equal(entry?.status, "paid", "KHONG doi status: tien da ra khoi tay that, user co sao ke");
  assert.equal(result.debtCreatedCount, 1);
  assert.equal(ledgerStore.getOutstandingDebtTotal("zalo", "user-a"), entry!.userShareAmount);
  assert.deepEqual(result.debtsByUser, [
    { platform: "zalo", userId: "user-a", orderId: "X1", amount: entry!.userShareAmount },
  ]);
});

// 2026-10-08 (yeu cau truc tiep cua user, DAO NGUOC quyet dinh brainstorm ban dau "canh bao admin,
// admin tu quyet"): don trong 1 yeu cau rut dang 'requested' (chua 'paid') bao "Da huy" thi TU DONG
// huy ca yeu cau rut, thu hoi TRON don do (khong no), va bao cho qua result.cancelledWithdrawals de
// route web DM user ngay.
test("'Da huy' + entry trong yeu cau rut 'requested' -> TU DONG huy yeu cau, thu hoi tron, KHONG no", () => {
  const { logStore, ledgerStore } = setupImport();
  importDone(logStore, ledgerStore);
  const w = ledgerStore.requestWithdrawal("zalo", "user-a", 20_000, BANK);

  const result = importCancelled(logStore, ledgerStore);

  assert.equal(result.debtCreatedCount, 0, "tien chua di (yeu cau moi 'requested') nen KHONG phai no");
  assert.equal(ledgerStore.getEntryByOrderId("shopee", "X1")?.status, "reversed", "thu hoi TRON don nay");
  assert.equal(
    ledgerStore.listCancelledWithdrawals()[0]?.id,
    w.id,
    "yeu cau rut phai duoc chuyen sang trang thai 'cancelled'"
  );
  assert.equal(ledgerStore.getPendingWithdrawal("zalo", "user-a"), null, "khong con yeu cau nao dang cho");

  assert.deepEqual(result.cancelledWithdrawals, [
    { platform: "zalo", userId: "user-a", withdrawalId: w.id, amount: w.amount, orderId: "X1" },
  ]);
});

// Yeu cau rut co NHIEU don, chi 1 don bi tra hang: ca yeu cau van bi huy TRON (khong the "huy mot
// nua yeu cau rut"), nhung CHI don bi tra hang moi bi reverse - don con lai tha ve Kha dung nguyen
// ven, KHONG mat gi.
test("yeu cau rut co 2 don, 1 don bi tra hang -> huy ca yeu cau, don CON LAI tha ve Kha dung nguyen ven", () => {
  const { logStore, ledgerStore } = setupImport();
  importDone(logStore, ledgerStore); // X1, commission mac dinh 50_000
  // Them 1 don thu 2 cho CUNG user (ghi truc tiep qua recordConversion, khong qua CSV - don nay se
  // KHONG duoc nhac den trong bao cao huy ben duoi, dung de kiem no "khong bi dung cham").
  const otherEntry = ledgerStore.recordConversion({
    subId: "k-user-a-aaa-222",
    platform: "zalo",
    userId: "user-a",
    merchant: "shopee",
    orderId: "X2-KEEP",
    orderAmount: 300_000,
    commissionAmount: 30_000,
    taxPercent: ORDER_CONFIG.taxPercent,
    platformFeePercent: ORDER_CONFIG.platformFeePercent,
    userSharePercent: ORDER_CONFIG.userSharePercent,
    maxCommissionRatioPercent: ORDER_CONFIG.maxCommissionRatioPercent,
    holdConfig: ORDER_CONFIG.holdConfig,
  });
  const w = ledgerStore.requestWithdrawal("zalo", "user-a", 20_000, BANK);
  const grossBefore = w.amount;

  importCancelled(logStore, ledgerStore); // bao X1 "Da huy"

  assert.equal(ledgerStore.getEntryByOrderId("shopee", "X1")?.status, "reversed");
  const otherAfter = ledgerStore.getEntryByOrderId("shopee", "X2-KEEP");
  assert.equal(otherAfter?.status, "confirmed", "don con lai KHONG bi dung cham");
  assert.equal(otherAfter?.withdrawalId, null, "duoc tha ve Kha dung, khong con khoa trong yeu cau da huy");
  assert.equal(
    ledgerStore.getAvailableBalance("zalo", "user-a"),
    otherEntry.userShareAmount,
    "Kha dung = dung so tien cua don con lai, khong mat gi"
  );
  assert.ok(grossBefore > otherEntry.userShareAmount, "chot: yeu cau cu DUNG la gop ca 2 don");
});

// Import LAI cung bao cao huy 2 lan: lan 1 da huy xong (X1 'reversed', yeu cau 'cancelled'), lan 2
// phai la NO-OP hoan toan - khong duoc goi cancelWithdrawal lan nua (se nem WithdrawalNotCancellableError
// roi bi nuot vao result.errors mot cach vo ich).
test("import lai cung bao cao huy 2 lan -> lan 2 khong lam gi them, khong co loi moi", () => {
  const { logStore, ledgerStore } = setupImport();
  importDone(logStore, ledgerStore);
  ledgerStore.requestWithdrawal("zalo", "user-a", 20_000, BANK);
  importCancelled(logStore, ledgerStore);

  const second = importCancelled(logStore, ledgerStore);
  assert.deepEqual(second.cancelledWithdrawals, []);
  assert.deepEqual(second.errors, []);
  assert.equal(second.reversedCount, 0);
});

test("import LAI cung bao cao huy 2 lan -> no KHONG nhan doi", () => {
  const { logStore, ledgerStore } = setupImport();
  importDone(logStore, ledgerStore);
  const w = ledgerStore.requestWithdrawal("zalo", "user-a", 20_000, BANK);
  ledgerStore.markWithdrawalPaid(w.id, null);

  importCancelled(logStore, ledgerStore);
  const total = ledgerStore.getOutstandingDebtTotal("zalo", "user-a");
  const second = importCancelled(logStore, ledgerStore);

  assert.equal(second.debtCreatedCount, 0, "lan 2 khong ghi no moi");
  assert.equal(ledgerStore.getOutstandingDebtTotal("zalo", "user-a"), total);
});

test("'Da huy' + entry da 'reversed' -> bo qua im lang, khong canh bao", () => {
  const { logStore, ledgerStore } = setupImport();
  importDone(logStore, ledgerStore);
  importCancelled(logStore, ledgerStore);
  const second = importCancelled(logStore, ledgerStore);

  assert.equal(second.reversedCount, 0);
  assert.equal(second.debtCreatedCount, 0);
  assert.deepEqual(second.errors, [], "don da huy roi thi khong con gi de canh bao");
});

test("heldCount dem so don MOI bi giam", () => {
  const { logStore, ledgerStore } = setupImport();
  const result = importShopeeReport(
    logStore,
    ledgerStore,
    { recordOrderConfig: HOLD_ON_CONFIG },
    buildCsv([
      {
        orderId: "BIG1",
        orderTime: "2026-09-30 10:00:00",
        completedTime: "2026-10-02 18:30:00",
        orderAmount: 3_000_000,
        commissionAmount: 300_000,
        status: "Hoàn thành",
        subId: "k-user-a-aaa-111",
      },
      {
        orderId: "SMALL1",
        orderTime: "2026-09-30 10:00:00",
        completedTime: "2026-10-02 18:30:00",
        orderAmount: 100_000,
        commissionAmount: 10_000,
        status: "Hoàn thành",
        subId: "k-user-a-aaa-111",
      },
    ])
  );

  assert.equal(result.confirmedNew, 2);
  assert.equal(result.heldCount, 1, "chi don to bi giam");
});

// Chot "available_from DA CHOT": doi setting roi import lai bao cao KHONG duoc dich ngay mo khoa cua
// don da confirmed - don do di vao nhanh confirmedDuplicate, khong goi lai confirmPendingEntry.
test("import lai sau khi doi setting hold KHONG dich ngay mo khoa da chot", () => {
  const { logStore, ledgerStore } = setupImport();
  importDone(logStore, ledgerStore, HOLD_ON_CONFIG, 300_000);
  const before = ledgerStore.getEntryByOrderId("shopee", "X1")!.availableFrom;
  assert.ok(before);

  // Admin nang hold tu 7 len 30 ngay roi import lai dung bao cao do
  importDone(logStore, ledgerStore, { ...ORDER_CONFIG, holdConfig: { thresholdVnd: 100_000, holdDays: 30 } }, 300_000);

  assert.equal(
    ledgerStore.getEntryByOrderId("shopee", "X1")!.availableFrom,
    before,
    "ngay mo khoa phai GIU NGUYEN - khong keo dai thoi gian giam cua don user da mua"
  );
});
