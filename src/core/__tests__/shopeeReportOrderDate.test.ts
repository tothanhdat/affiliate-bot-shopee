import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";
import { LogStore } from "../logStore.js";
import { importShopeeReport, parseShopeeOrderDate } from "../shopeeReportImport.js";

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
// parseShopeeOrderDate
// ---------------------------------------------------------------------------

test("parseShopeeOrderDate: dinh dang that cua Shopee -> 'YYYY-MM-DD'", () => {
  assert.equal(parseShopeeOrderDate("2026-09-30 13:07:34"), "2026-09-30");
  assert.equal(parseShopeeOrderDate("2026-09-30 00:05:04"), "2026-09-30");
  assert.equal(parseShopeeOrderDate("  2026-10-01 23:59:59  "), "2026-10-01");
});

test("parseShopeeOrderDate: chi co ngay, khong co gio -> van doc duoc", () => {
  assert.equal(parseShopeeOrderDate("2026-09-30"), "2026-09-30");
});

test("parseShopeeOrderDate: gia tri thieu/la -> null, KHONG doan", () => {
  assert.equal(parseShopeeOrderDate(""), null);
  assert.equal(parseShopeeOrderDate(undefined), null);
  assert.equal(parseShopeeOrderDate("   "), null);
  assert.equal(parseShopeeOrderDate("30/09/2026"), null); // dinh dang khac -> khong doan dd/mm hay mm/dd
  assert.equal(parseShopeeOrderDate("hom qua"), null);
  assert.equal(parseShopeeOrderDate("2026-13-45 10:00:00"), null); // thang 13/ngay 45 khong ton tai
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
