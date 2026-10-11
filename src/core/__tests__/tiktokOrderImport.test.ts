import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCommissionBreakdown } from "../commissionMath.js";
import { LedgerStore } from "../ledgerStore.js";
import { LogStore } from "../logStore.js";
import { estimateTiktokNetCommission } from "../tiktokCommission.js";
import { importTiktokOrders, parseRiohubMoney, type RiohubOrderRecord } from "../tiktokOrderImport.js";
import { addDaysToVnIso, todayVnIso } from "../vietnamDate.js";

const TODAY = todayVnIso();
const iso = (daysAgo: number): string => new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString();

/** user nhan 100% de hoa hong trong fixture chinh la user_share - de doi chieu voi nguong 100.000. */
const CONFIG = {
  recordOrderConfig: {
    taxPercent: 0,
    platformFeePercent: 0,
    userSharePercent: 100,
    maxCommissionRatioPercent: 1000,
    holdConfig: { thresholdVnd: 100_000, holdDays: 7, smallHoldDays: 1 },
  },
};

const BOT_SUB = "k-9053348487804998642-mv16nixs-f85f8a";

function seed(logStore: LogStore, subId = BOT_SUB, merchant: "tiktokshop" | "shopee" = "tiktokshop") {
  logStore.record({
    platform: "zalo",
    merchant,
    userId: "user-a",
    originalUrl: "https://shop.tiktok.com/vn/pdp/1",
    subId,
    outcome: "success",
    errorCode: null,
    affiliateUrl: "https://www.tiktok.com/t/x/",
  });
}

/** Dong don co ban. Moi truong co the ghi de. status 1 = cho, chua giao. */
function row(over: Partial<RiohubOrderRecord> = {}): RiohubOrderRecord {
  return {
    order_id: "O1",
    sku_id: "S1",
    product_name: "San pham test",
    sub_id: BOT_SUB,
    status: 1,
    commission_gmv: "100000.00",
    est_commission: "3000.00",
    actual_commission: null,
    shared_with_partner: null,
    pit: null,
    time_created_iso: "2026-10-08T06:52:18Z",
    time_delivered_iso: null,
    ...over,
  };
}

function run(orders: RiohubOrderRecord[], seedLog = true) {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  if (seedLog) seed(logStore);
  const result = importTiktokOrders(logStore, ledgerStore, CONFIG, orders);
  return {
    result,
    ledgerStore,
    logStore,
    entry: (id = "O1") => ledgerStore.getEntryByOrderId("tiktokshop", id),
    done: () => {
      logStore.close();
      ledgerStore.close();
    },
  };
}

// ---------------------------------------------------------------- parse tien

test("parseRiohubMoney: chuoi rong va null la null, KHAC so 0 (0 la gia tri that)", () => {
  assert.equal(parseRiohubMoney(""), null);
  assert.equal(parseRiohubMoney("  "), null);
  assert.equal(parseRiohubMoney(null), null);
  assert.equal(parseRiohubMoney(undefined), null);
  assert.equal(parseRiohubMoney("0"), 0);
  assert.equal(parseRiohubMoney("0.00"), 0);
  assert.equal(parseRiohubMoney("2136.00"), 2136);
  assert.equal(parseRiohubMoney(-500), -500);
  assert.equal(parseRiohubMoney("abc"), null);
});

// ------------------------------------------------- 4 don THAT (output CLI 2026-10-11)
// Fixture dung lai tu output `npm run riohub:orders`: order_id, sub_id, est_commission, moc thoi gian
// la SO THAT; commission_gmv va ten san pham la uoc luong (CLI khong in) - khong anh huong ket qua.

const REAL = {
  botLatest: row({
    order_id: "586514613873640731",
    sub_id: "k-9053348487804998642-mv19z39z-acc5c0",
    est_commission: "3190.00",
    time_created_iso: "2026-10-10T08:47:28Z",
  }),
  botFirst: row({
    order_id: "586502233699747518",
    sub_id: BOT_SUB,
    est_commission: "2136.00",
    time_created_iso: "2026-10-09T16:34:52Z",
  }),
  external: row({
    order_id: "586494603346282174",
    sub_id: "u35008-m1791535058",
    est_commission: "500.00",
    time_created_iso: "2026-10-09T08:38:20Z",
  }),
  externalDelivered: row({
    order_id: "586474851567371966",
    sub_id: "",
    est_commission: "480.00",
    time_created_iso: "2026-10-08T06:52:18Z",
    time_delivered_iso: "2026-10-10T07:49:05Z",
  }),
};

test("4 don that: 2 don bot -> pending, tien = est x 0,9; don ngoai bi bo qua dung ly do", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seed(logStore, "k-9053348487804998642-mv19z39z-acc5c0");
    seed(logStore, BOT_SUB);
    const r = importTiktokOrders(logStore, ledgerStore, CONFIG, Object.values(REAL));

    assert.equal(r.ordersScanned, 4);
    assert.equal(r.pendingNew, 2);
    assert.equal(r.confirmedNew, 0);
    assert.equal(r.skippedSubIdNotFound, 1, "sub_id kieu app RioHub (2 doan) khong co trong log bot");
    assert.equal(r.skippedNoSubId, 1, "sub_id la chuoi RONG, khong phai null");
    assert.deepEqual(r.newOrderIds.sort(), ["586502233699747518", "586514613873640731"]);

    const a = ledgerStore.getEntryByOrderId("tiktokshop", "586502233699747518");
    assert.equal(a?.commissionAmount, estimateTiktokNetCommission(2136)); // 1.922
    assert.equal(a?.commissionAmount, 1922);
    assert.equal(ledgerStore.getEntryByOrderId("tiktokshop", "586514613873640731")?.commissionAmount, 2871);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

test("don that 2.136d voi cau hinh chot 10/1/80: user nhan dung bang computeCommissionBreakdown(1.922)", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seed(logStore);
    const cfg = { recordOrderConfig: { ...CONFIG.recordOrderConfig, taxPercent: 10, platformFeePercent: 1, userSharePercent: 80 } };
    importTiktokOrders(logStore, ledgerStore, cfg, [REAL.botFirst]);
    const expected = computeCommissionBreakdown({
      commissionAmount: 1922,
      taxPercent: 10,
      platformFeePercent: 1,
      userSharePercent: 80,
    }).userShareAmount;
    assert.equal(ledgerStore.getEntryByOrderId("tiktokshop", REAL.botFirst.order_id!)?.userShareAmount, expected);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

// ------------------------------------------------ moc confirmed = GIAO HANG (spec 5.3)

test("DA GIAO nhung chua quyet toan (status 1) -> CONFIRMED ngay, khong cho actual_commission", () => {
  // Test chan quan trong nhat cua spec 5.3: viet sai la user phai doi ~15 ngay.
  const t = run([row({ est_commission: "3000.00", time_delivered_iso: iso(2) })]);
  try {
    assert.equal(t.entry()?.status, "confirmed");
    assert.equal(t.result.confirmedNew, 1);
    assert.equal(t.result.confirmedByUser.length, 1);
  } finally {
    t.done();
  }
});

test("don NHO giao HOM NAY -> nam lai pending (giam 1 ngay), khong sinh tin 'don ve'", () => {
  const t = run([row({ time_delivered_iso: new Date().toISOString() })]);
  try {
    assert.equal(t.entry()?.status, "pending");
    assert.equal(t.result.smallHoldDeferred, 1);
    assert.equal(t.result.confirmedNew, 0);
    assert.deepEqual(t.result.confirmedByUser, []);
    assert.deepEqual(t.result.newOrderIds, ["O1"]);
  } finally {
    t.done();
  }
});

test("don TO giao hom nay -> confirmed nhung bi giam 7 ngay (available_from), dem vao heldCount", () => {
  const t = run([row({ est_commission: "150000.00", commission_gmv: "3000000.00", time_delivered_iso: new Date().toISOString() })]);
  try {
    assert.equal(t.entry()?.commissionAmount, 135_000);
    assert.equal(t.entry()?.status, "confirmed");
    assert.equal(t.entry()?.availableFrom, addDaysToVnIso(TODAY, 7));
    assert.equal(t.result.heldCount, 1);
  } finally {
    t.done();
  }
});

test("status 2 (da quyet toan) KHONG co time_delivered -> van di nhanh confirmed, completedAt null", () => {
  // Dung don TO: don nho khong biet ngay giao lui ve HOM NAY roi bi giu 1 ngay o pending (dung
  // resolveConfirmPlan), nen khong thay duoc "confirmed" - khong phai loi.
  const t = run([row({ status: 2, est_commission: "150000.00", commission_gmv: "3000000.00", actual_commission: "135000.00" })]);
  try {
    assert.equal(t.entry()?.status, "confirmed");
    assert.equal(t.entry()?.completedAt, null);
    assert.equal(t.entry()?.availableFrom, addDaysToVnIso(TODAY, 7), "lui ve hom nay + 7 ngay giam don to");
  } finally {
    t.done();
  }
});

test("hoa hong ghi vao ledger KHONG doi khi don chuyen pending -> confirmed -> quyet toan (1 cong thuc)", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seed(logStore);
    importTiktokOrders(logStore, ledgerStore, CONFIG, [row()]);
    const before = ledgerStore.getEntryByOrderId("tiktokshop", "O1")!.commissionAmount;
    importTiktokOrders(logStore, ledgerStore, CONFIG, [row({ time_delivered_iso: iso(2) })]);
    importTiktokOrders(logStore, ledgerStore, CONFIG, [
      row({ status: 2, time_delivered_iso: iso(2), actual_commission: "1000.00" }),
    ]);
    // actual THAP hon nhieu nhung KHONG duoc phep sua so da chot - chi canh bao.
    assert.equal(ledgerStore.getEntryByOrderId("tiktokshop", "O1")!.commissionAmount, before);
    assert.equal(before, 2700);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

// ------------------------------------------------------------- gop dong / SKU

test("don nhieu SKU: dong da huy (status 3) bi LOAI khoi tong tien; mergedMultiSku dem 1", () => {
  const t = run([
    row({ sku_id: "S1", status: 2, est_commission: "1000.00", commission_gmv: "10000.00", time_delivered_iso: iso(2) }),
    row({ sku_id: "S2", status: 3, est_commission: "5000.00", commission_gmv: "50000.00" }),
  ]);
  try {
    assert.equal(t.result.mergedMultiSku, 1);
    assert.equal(t.entry()?.commissionAmount, 900); // 1000 x 0,9 - khong tinh dong da huy
    assert.equal(t.entry()?.orderAmount, 10_000);
    assert.equal(t.entry()?.status, "confirmed");
  } finally {
    t.done();
  }
});

test("don nhieu SKU: con 1 dong chua giao & chua quyet toan -> ca don van PENDING", () => {
  const t = run([
    row({ sku_id: "S1", status: 2 }),
    row({ sku_id: "S2", status: 1, time_delivered_iso: null }),
  ]);
  try {
    assert.equal(t.entry()?.status, "pending");
  } finally {
    t.done();
  }
});

test("ten san pham: dong hoa hong cao nhat + hau to (+N san pham khac)", () => {
  const t = run([
    row({ sku_id: "S1", product_name: "Re", est_commission: "100.00" }),
    row({ sku_id: "S2", product_name: "Dat", est_commission: "900.00" }),
    row({ sku_id: "S3", product_name: "Giua", est_commission: "500.00" }),
  ]);
  try {
    assert.equal(t.entry()?.productName, "Dat (+2 san pham khac)");
  } finally {
    t.done();
  }
});

// -------------------------------------------------------------- huy / hoan

test("TOAN dong status 3 -> reversed, KE CA khi est_commission rong o moi dong (khong bi chot 'no estimate' chan)", () => {
  // Bay da gap khi soat spec: dieu kien "khong dong nao co est" dung mot cach RONG TUECH voi don
  // toan dong da huy, va se bo qua MOI don huy => tien khong bao gio duoc thu hoi.
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seed(logStore);
    importTiktokOrders(logStore, ledgerStore, CONFIG, [row()]); // pending
    const r = importTiktokOrders(logStore, ledgerStore, CONFIG, [row({ status: 3, est_commission: null })]);
    assert.equal(r.skippedNoEstimate, 0);
    assert.equal(r.reversedCount, 1);
    assert.equal(ledgerStore.getEntryByOrderId("tiktokshop", "O1")?.status, "reversed");
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

test("don huy chua tung thay -> khong tao entry, khong dem reversedCount", () => {
  const t = run([row({ status: 3 })]);
  try {
    assert.equal(t.entry(), null);
    assert.equal(t.result.reversedCount, 0);
  } finally {
    t.done();
  }
});

test("status la (khong phai 1/2/3) -> bo qua CA DON, khong ghi", () => {
  const t = run([row({ status: 9 })]);
  try {
    assert.equal(t.result.skippedUnknownStatus, 1);
    assert.equal(t.entry(), null);
    const t2 = run([row({ status: null })]);
    assert.equal(t2.result.skippedUnknownStatus, 1);
    t2.done();
  } finally {
    t.done();
  }
});

test("don con song ma KHONG dong nao co est_commission -> bo qua + dem skippedNoEstimate", () => {
  const t = run([row({ est_commission: null })]);
  try {
    assert.equal(t.result.skippedNoEstimate, 1);
    assert.equal(t.entry(), null);
  } finally {
    t.done();
  }
});

test("dong co refunded_quantity > 0 nhung status khac 3 -> den bao re trong errors (khoang ho spec 5.8)", () => {
  const t = run([row({ refunded_quantity: 1 })]);
  try {
    assert.ok(t.result.errors.some((e) => /refunded_quantity/.test(e) && /O1/.test(e)));
    assert.equal(t.entry()?.status, "pending", "van ghi don, chi bao");
  } finally {
    t.done();
  }
});

// ---------------------------------------------------------------- quy ve user

test("sub_id null va sub_id rong deu la skippedNoSubId", () => {
  const t = run([row({ order_id: "A", sub_id: null }), row({ order_id: "B", sub_id: "" })]);
  try {
    assert.equal(t.result.skippedNoSubId, 2);
  } finally {
    t.done();
  }
});

test("sub_id khong co trong log bot -> skippedSubIdNotFound", () => {
  const t = run([row({ sub_id: "k-khong-ton-tai-0-0" })]);
  try {
    assert.equal(t.result.skippedSubIdNotFound, 1);
  } finally {
    t.done();
  }
});

// ---------------------------------------------------------------------- ngay

test("ngay/gio dat don doi tu UTC sang gio VN: 06:52:18Z -> 13:52:18, cung ngay", () => {
  const t = run([row({ time_created_iso: "2026-10-08T06:52:18Z" })]);
  try {
    assert.equal(t.entry()?.orderDate, "2026-10-08");
    assert.equal(t.entry()?.orderTime, "13:52:18");
  } finally {
    t.done();
  }
});

test("17:30Z da sang NGAY SAU o VN: orderDate +1 ngay, gio 00:30:00", () => {
  const t = run([row({ time_created_iso: "2026-10-09T17:30:00Z" })]);
  try {
    assert.equal(t.entry()?.orderDate, "2026-10-10");
    assert.equal(t.entry()?.orderTime, "00:30:00");
  } finally {
    t.done();
  }
});

test("don nhieu dong: ngay dat lay dong SOM nhat, completedAt lay dong giao MUON nhat", () => {
  const t = run([
    row({ sku_id: "S1", status: 2, time_created_iso: "2026-10-08T06:00:00Z", time_delivered_iso: "2026-10-09T05:00:00Z" }),
    row({ sku_id: "S2", status: 2, time_created_iso: "2026-10-07T06:00:00Z", time_delivered_iso: "2026-10-12T05:00:00Z" }),
  ]);
  try {
    assert.equal(t.entry()?.orderDate, "2026-10-07");
    assert.equal(t.entry()?.completedAt, "2026-10-12");
  } finally {
    t.done();
  }
});

// -------------------------------------------- doi chieu / canh bao (spec muc 7)

test("settledTotals: chua don nao quyet toan -> orderCount 0 va cac tong la null (khong phai 0)", () => {
  const t = run([row()]);
  try {
    assert.deepEqual(t.result.settledTotals, {
      orderCount: 0,
      estTotal: 0,
      actualTotal: null,
      pitTotal: null,
      sharedWithPartnerTotal: null,
      shortfallCount: 0,
    });
    assert.deepEqual(t.result.alerts, []);
  } finally {
    t.done();
  }
});

test("pit khac 0 KHONG sinh canh bao (ky vong khac 0 vinh vien) nhung HIEN trong settledTotals", () => {
  const t = run([row({ status: 2, est_commission: "10000.00", actual_commission: "9000.00", pit: "-1000.00", shared_with_partner: "0.00" })]);
  try {
    assert.equal(t.result.settledTotals.orderCount, 1);
    assert.equal(t.result.settledTotals.pitTotal, -1000);
    assert.equal(t.result.settledTotals.actualTotal, 9000);
    assert.equal(t.result.settledTotals.sharedWithPartnerTotal, 0);
    assert.deepEqual(t.result.alerts, []);
  } finally {
    t.done();
  }
});

test("shared_with_partner khac 0 -> canh bao tiktok_mcn_cut, ghi ro ma don va he qua", () => {
  const t = run([row({ status: 2, est_commission: "10000.00", actual_commission: "4000.00", shared_with_partner: "-5000.00" })]);
  try {
    const mcn = t.result.alerts.filter((a) => a.key === "tiktok_mcn_cut");
    assert.equal(mcn.length, 1);
    assert.match(mcn[0].message, /O1/);
    assert.match(mcn[0].message, /CAO hơn thực nhận/);
    assert.ok(t.result.errors.some((e) => /tiktok_mcn_cut|MCN/.test(e)), "cung hien tren trang ket qua");
  } finally {
    t.done();
  }
});

test("actual THAP hon so da tra (tru bien) -> canh bao tiktok_actual_below_assumed, dem shortfallCount", () => {
  // est 10.000 -> assumed 9.000, bien 200 -> nguong 8.800
  const low = run([row({ status: 2, est_commission: "10000.00", actual_commission: "8000.00" })]);
  const ok = run([row({ status: 2, est_commission: "10000.00", actual_commission: "8900.00" })]);
  try {
    assert.equal(low.result.settledTotals.shortfallCount, 1);
    assert.equal(low.result.alerts.filter((a) => a.key === "tiktok_actual_below_assumed").length, 1);
    assert.equal(ok.result.settledTotals.shortfallCount, 0);
    assert.deepEqual(ok.result.alerts, []);
  } finally {
    low.done();
    ok.done();
  }
});

test("canh bao gop theo key: nhieu don -> MOT alert moi key, liet ke don", () => {
  const t = run([
    row({ order_id: "A", status: 2, est_commission: "10000.00", actual_commission: "1000.00" }),
    row({ order_id: "B", status: 2, est_commission: "10000.00", actual_commission: "2000.00" }),
  ]);
  try {
    const a = t.result.alerts.filter((x) => x.key === "tiktok_actual_below_assumed");
    assert.equal(a.length, 1);
    assert.match(a[0].message, /A/);
    assert.match(a[0].message, /B/);
  } finally {
    t.done();
  }
});

test("canh bao tinh ca don KHONG quy duoc ve user (la tai khoan creator, khong phai chuyen cua bot)", () => {
  const t = run([row({ sub_id: "", status: 2, est_commission: "10000.00", actual_commission: "1000.00" })]);
  try {
    assert.equal(t.result.skippedNoSubId, 1);
    assert.equal(t.result.alerts.filter((a) => a.key === "tiktok_actual_below_assumed").length, 1);
  } finally {
    t.done();
  }
});

// ------------------------------------------------ dong bo lai nhieu lan (idempotent)

test("dong bo lai CUNG du lieu 2 lan khong sinh don/no moi", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seed(logStore);
    const orders = [row({ time_delivered_iso: iso(2) })];
    importTiktokOrders(logStore, ledgerStore, CONFIG, orders);
    const second = importTiktokOrders(logStore, ledgerStore, CONFIG, orders);
    assert.equal(second.confirmedNew, 0);
    assert.equal(second.confirmedDuplicate, 1);
    assert.deepEqual(second.newOrderIds, []);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});
