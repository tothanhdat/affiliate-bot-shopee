import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";
import { LogStore } from "../logStore.js";
import { importShopeeReport } from "../shopeeReportImport.js";
import { recordSingleOrder } from "../orderIngest.js";
import { todayVnIso } from "../vietnamDate.js";

/**
 * % hoa hong rieng tung user phai duoc ap NGAY LUC ghi nhan don, roi chot vao entry: day la cho duy
 * nhat tren duong tien quyet dinh ty le (xem resolveUserSharePercent trong ledgerStore).
 */

const ORDER_CONFIG = { taxPercent: 0, platformFeePercent: 0, userSharePercent: 80, maxCommissionRatioPercent: 1000 };

const HEADER = [
  "ID đơn hàng",
  "Tên Item",
  "Thời Gian Đặt Hàng",
  "Giá trị đơn hàng (₫)",
  "Tổng hoa hồng sản phẩm(₫)",
  "Trạng thái sản phẩm liên kết",
  "Sub_id1",
  "Sub_id2",
  "Sub_id3",
  "Sub_id4",
  "Sub_id5",
];

function buildCsv(rows: Array<{ orderId: string; orderDate: string; commissionAmount: number; status: string }>): string {
  const lines = [HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [r.orderId, "San pham test", r.orderDate, "1000000", String(r.commissionAmount), r.status, "k", "user-a", "abc", "def", ""].join(",")
    );
  }
  return lines.join("\n");
}

function seedRequestLog(logStore: LogStore, subId: string): void {
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

function setup() {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  seedRequestLog(logStore, "k-user-a-abc-def");
  return { logStore, ledgerStore };
}

test("import bao cao: don dat TRONG han uu dai -> chia theo % rieng, chot vao entry", () => {
  const { logStore, ledgerStore } = setup();
  try {
    ledgerStore.setUserCommissionOverride({
      platform: "zalo",
      userId: "user-a",
      userSharePercent: 95,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });

    const csv = buildCsv([
      { orderId: "SP-TRONG-HAN", orderDate: "2026-10-15 09:00", commissionAmount: 10_000, status: "Hoàn thành" },
    ]);
    const result = importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);

    assert.equal(result.errors.length, 0);
    const entry = ledgerStore.getEntryByOrderId("shopee", "SP-TRONG-HAN");
    assert.equal(entry?.userSharePercent, 95);
    assert.equal(entry?.userShareAmount, 9_500);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

test("import bao cao: don dat SAU ngay ket thuc -> % chung, du override van con trong DB", () => {
  const { logStore, ledgerStore } = setup();
  try {
    ledgerStore.setUserCommissionOverride({
      platform: "zalo",
      userId: "user-a",
      userSharePercent: 95,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });

    const csv = buildCsv([
      { orderId: "SP-HET-HAN", orderDate: "2026-11-02 09:00", commissionAmount: 10_000, status: "Hoàn thành" },
    ]);
    importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);

    const entry = ledgerStore.getEntryByOrderId("shopee", "SP-HET-HAN");
    assert.equal(entry?.userSharePercent, 80);
    assert.equal(entry?.userShareAmount, 8_000);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

test("import bao cao: don dat TRUOC ngay bat dau -> % chung (uu dai khong hoi to don ton dong)", () => {
  const { logStore, ledgerStore } = setup();
  try {
    ledgerStore.setUserCommissionOverride({
      platform: "zalo",
      userId: "user-a",
      userSharePercent: 95,
      startDate: "2026-10-01",
      endDate: null,
    });

    const csv = buildCsv([
      { orderId: "SP-TON-DONG", orderDate: "2026-09-20 09:00", commissionAmount: 10_000, status: "Hoàn thành" },
    ]);
    importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);

    assert.equal(ledgerStore.getEntryByOrderId("shopee", "SP-TON-DONG")?.userSharePercent, 80);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

test("don pending dat trong han: duyet SAU khi uu dai het han van giu % rieng (da chot luc ghi nhan)", () => {
  const { logStore, ledgerStore } = setup();
  try {
    ledgerStore.setUserCommissionOverride({
      platform: "zalo",
      userId: "user-a",
      userSharePercent: 95,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });

    // Lan import 1: don dat 15/10, Shopee con ghi "Dang cho xu ly".
    importShopeeReport(
      logStore,
      ledgerStore,
      { recordOrderConfig: ORDER_CONFIG },
      buildCsv([
        { orderId: "SP-PENDING", orderDate: "2026-10-15 09:00", commissionAmount: 10_000, status: "Đang chờ xử lý" },
      ])
    );
    assert.equal(ledgerStore.getEntryByOrderId("shopee", "SP-PENDING")?.userSharePercent, 95);

    // Uu dai bi xoa hoan toan, roi Shopee moi duyet don -> van phai la 95%.
    ledgerStore.deleteUserCommissionOverride("zalo", "user-a");
    importShopeeReport(
      logStore,
      ledgerStore,
      { recordOrderConfig: ORDER_CONFIG },
      buildCsv([
        { orderId: "SP-PENDING", orderDate: "2026-10-15 09:00", commissionAmount: 10_000, status: "Hoàn thành" },
      ])
    );

    const entry = ledgerStore.getEntryByOrderId("shopee", "SP-PENDING");
    assert.equal(entry?.status, "confirmed");
    assert.equal(entry?.userSharePercent, 95);
    assert.equal(entry?.userShareAmount, 9_500);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

test("ghi 1 don le (khong biet ngay dat): dung han tinh theo HOM NAY gio VN", () => {
  const { logStore, ledgerStore } = setup();
  try {
    ledgerStore.setUserCommissionOverride({
      platform: "zalo",
      userId: "user-a",
      userSharePercent: 95,
      // Han bao trum hom nay bat ke chay test ngay nao.
      startDate: "2000-01-01",
      endDate: null,
    });

    const entry = recordSingleOrder(logStore, ledgerStore, ORDER_CONFIG, {
      subId: "k-user-a-abc-def",
      orderId: "SP-TAY",
      orderAmount: 1_000_000,
      commissionAmount: 10_000,
    });

    assert.equal(entry.userSharePercent, 95);
    assert.equal(entry.userShareAmount, 9_500);
    assert.ok(todayVnIso() >= "2000-01-01");
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

test("ghi 1 don le: uu dai da het han truoc hom nay -> % chung", () => {
  const { logStore, ledgerStore } = setup();
  try {
    ledgerStore.setUserCommissionOverride({
      platform: "zalo",
      userId: "user-a",
      userSharePercent: 95,
      startDate: "2000-01-01",
      endDate: "2000-12-31",
    });

    const entry = recordSingleOrder(logStore, ledgerStore, ORDER_CONFIG, {
      subId: "k-user-a-abc-def",
      orderId: "SP-TAY-HET-HAN",
      orderAmount: 1_000_000,
      commissionAmount: 10_000,
    });

    assert.equal(entry.userSharePercent, 80);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});
