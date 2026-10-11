import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";
import { LogStore } from "../logStore.js";
import { importShopeeReport } from "../shopeeReportImport.js";

const ORDER_CONFIG = {
  taxPercent: 0,
  platformFeePercent: 0,
  userSharePercent: 80,
  maxCommissionRatioPercent: 1000,
  holdConfig: { thresholdVnd: 0, holdDays: 0 },
};

const SUB_PARTS = ["zalo", "user-a", "abc", "def"];
const SUB_ID = SUB_PARTS.join("-");

// Du 4 cot ma bao cao Shopee THAT co va file test cu (shopeeReportImport.test.ts) khong co:
// "Item id", "ID Model", "Giá(₫)" (gia niem yet), "Số lượng".
const HEADER = [
  "ID đơn hàng",
  "Tên Item",
  "Item id",
  "ID Model",
  "Giá(₫)",
  "Số lượng",
  "Giá trị đơn hàng (₫)",
  "Tổng hoa hồng sản phẩm(₫)",
  "Trạng thái sản phẩm liên kết",
  "Sub_id1",
  "Sub_id2",
  "Sub_id3",
  "Sub_id4",
  "Sub_id5",
];

interface ItemRow {
  orderId?: string;
  name: string;
  itemId: string;
  modelId?: string;
  /** Cot "Gia(d)" niem yet - 0 nghia la qua tang. */
  listPrice: number;
  quantity?: number;
  /** Cot "Gia tri don hang (d)" cua dong. */
  amount: number;
  commission: number;
  status?: string;
  subIdParts?: string[];
}

function csv(rows: ItemRow[]): string {
  const lines = [HEADER.join(",")];
  for (const r of rows) {
    const parts = r.subIdParts ?? SUB_PARTS;
    const sub = [0, 1, 2, 3, 4].map((i) => parts[i] ?? "");
    lines.push(
      [
        r.orderId ?? "ORD1",
        `"${r.name.replace(/"/g, '""')}"`,
        r.itemId,
        r.modelId ?? "1",
        String(r.listPrice),
        String(r.quantity ?? 1),
        String(r.amount),
        String(r.commission),
        r.status ?? "Đang chờ xử lý",
        ...sub,
      ].join(",")
    );
  }
  return lines.join("\n");
}

function seedRequestLog(logStore: LogStore, subId = SUB_ID) {
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

function withStores<T>(fn: (logStore: LogStore, ledgerStore: LedgerStore) => T): T {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seedRequestLog(logStore);
    return fn(logStore, ledgerStore);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
}

function runImport(logStore: LogStore, ledgerStore: LedgerStore, rows: ItemRow[]) {
  return importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv(rows));
}

function firstEntry(ledgerStore: LedgerStore) {
  return ledgerStore.getUserSummary("zalo", "user-a").entries[0];
}

test("nhan (+N san pham khac): qua tang gia niem yet = 0 KHONG duoc dem", () => {
  withStores((logStore, ledgerStore) => {
    runImport(logStore, ledgerStore, [
      { name: "Mon that", itemId: "1", listPrice: 249_000, amount: 193_455, commission: 4_836.375 },
      { name: "Qua tang A", itemId: "2", listPrice: 0, amount: 0, commission: 0 },
      { name: "Qua tang B", itemId: "3", listPrice: 0, amount: 0, commission: 0 },
    ]);
    assert.equal(firstEntry(ledgerStore).productName, "Mon that");
  });
});

test("nhan (+N san pham khac): 2 mon that + 1 qua tang -> (+1), khong phai (+2)", () => {
  withStores((logStore, ledgerStore) => {
    runImport(logStore, ledgerStore, [
      { name: "Mon re", itemId: "1", listPrice: 50_000, amount: 40_000, commission: 1_000 },
      { name: "Mon dat", itemId: "2", listPrice: 90_000, amount: 80_000, commission: 2_000 },
      { name: "Qua tang", itemId: "3", listPrice: 0, amount: 0, commission: 0 },
    ]);
    assert.equal(firstEntry(ledgerStore).productName, "Mon dat (+1 sản phẩm khác)");
  });
});

test("nhan (+N san pham khac): mon MUA THAT hoa hong 0d van duoc dem (khong bi coi la qua tang)", () => {
  withStores((logStore, ledgerStore) => {
    runImport(logStore, ledgerStore, [
      { name: "Mon chinh", itemId: "1", listPrice: 100_000, amount: 80_000, commission: 5_000 },
      // Sua tuoi Vinamilk that: gia 316.224d, nganh hang 0% -> hoa hong 0 nhung la hang user mua that.
      { name: "Sua tuoi", itemId: "2", listPrice: 316_224, amount: 278_277, commission: 0 },
    ]);
    assert.equal(firstEntry(ledgerStore).productName, "Mon chinh (+1 sản phẩm khác)");
  });
});
