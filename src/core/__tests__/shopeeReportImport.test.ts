import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";
import { LogStore } from "../logStore.js";
import { importShopeeReport } from "../shopeeReportImport.js";

const ORDER_CONFIG = { taxPercent: 0, platformFeePercent: 0, userSharePercent: 80, maxCommissionRatioPercent: 1000 };

const HEADER = [
  "ID đơn hàng",
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
  productName?: string;
  orderAmount: number;
  commissionAmount: number;
  status: string;
  subIdParts?: string[];
}

/** Dung dinh dang cot tieng Viet goc cua Shopee, giong file AffiliateCommissionReport_*.csv that. */
function buildCsv(rows: RowInput[], withBom = false): string {
  const lines = [HEADER.join(",")];
  for (const r of rows) {
    const parts = r.subIdParts ?? [];
    const sub = [0, 1, 2, 3, 4].map((i) => parts[i] ?? "");
    const cells = [
      r.orderId,
      `"${(r.productName ?? "San pham test").replace(/"/g, '""')}"`,
      String(r.orderAmount),
      String(r.commissionAmount),
      r.status,
      ...sub,
    ];
    lines.push(cells.join(","));
  }
  const text = lines.join("\n");
  return withBom ? "﻿" + text : text;
}

function seedRequestLog(
  logStore: LogStore,
  subId: string,
  overrides: Partial<{ platform: "telegram" | "zalo"; userId: string; merchant: "shopee" | "tiktokshop" }> = {}
) {
  logStore.record({
    platform: overrides.platform ?? "zalo",
    merchant: overrides.merchant ?? "shopee",
    userId: overrides.userId ?? "user-a",
    originalUrl: "https://shopee.vn/product/1/2",
    subId,
    outcome: "success",
    errorCode: null,
    affiliateUrl: "https://bot.example.com/s/abc",
  });
}

test("importShopeeReport: 'Hoan thanh' + chua ton tai -> ghi moi 'confirmed'", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");
    const csv = buildCsv([
      {
        orderId: "SP001",
        productName: "Ao thun",
        orderAmount: 100_000,
        commissionAmount: 10_000,
        status: "Hoàn thành",
        subIdParts: ["zalo", "user-a", "abc", "def"],
      },
    ]);

    const result = importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);

    assert.equal(result.ordersScanned, 1);
    assert.equal(result.confirmedNew, 1);
    assert.equal(result.confirmedByUser.length, 1);
    assert.equal(result.confirmedByUser[0].userId, "user-a");
    assert.equal(ledgerStore.getAvailableBalance("zalo", "user-a"), 8_000); // 80% cua 10_000
    assert.deepEqual(result.newOrderIds, ["SP001"]);
    assert.deepEqual(result.statusTransitions, []);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

test("importShopeeReport: 'Dang cho xu ly' + chua ton tai -> ghi moi 'pending', khong tinh vao so du, khong bao user", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");
    const csv = buildCsv([
      {
        orderId: "SP002",
        orderAmount: 100_000,
        commissionAmount: 10_000,
        status: "Đang chờ xử lý",
        subIdParts: ["zalo", "user-a", "abc", "def"],
      },
    ]);

    const result = importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);

    assert.equal(result.pendingNew, 1);
    assert.equal(result.confirmedNew, 0);
    assert.equal(result.confirmedByUser.length, 0);
    assert.equal(ledgerStore.getAvailableBalance("zalo", "user-a"), 0);
    assert.deepEqual(result.newOrderIds, ["SP002"]);
    assert.deepEqual(result.statusTransitions, []);

    const entries = ledgerStore.getUserSummary("zalo", "user-a").entries;
    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, "pending");
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

test("importShopeeReport: don 'pending' da co san, lan sau bao cao 'Hoan thanh' -> chuyen 'confirmed', khong tao trung", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");

    const firstResult = importShopeeReport(
      logStore,
      ledgerStore,
      { recordOrderConfig: ORDER_CONFIG },
      buildCsv([
        {
          orderId: "SP003",
          orderAmount: 100_000,
          commissionAmount: 10_000,
          status: "Đang chờ xử lý",
          subIdParts: ["zalo", "user-a", "abc", "def"],
        },
      ])
    );
    assert.equal(firstResult.pendingNew, 1);

    const secondResult = importShopeeReport(
      logStore,
      ledgerStore,
      { recordOrderConfig: ORDER_CONFIG },
      buildCsv([
        {
          orderId: "SP003",
          orderAmount: 100_000,
          commissionAmount: 10_000,
          status: "Hoàn thành",
          subIdParts: ["zalo", "user-a", "abc", "def"],
        },
      ])
    );

    assert.equal(secondResult.confirmedNew, 1);
    assert.equal(secondResult.pendingNew, 0);
    assert.equal(secondResult.confirmedByUser.length, 1);
    assert.equal(ledgerStore.getAvailableBalance("zalo", "user-a"), 8_000);
    assert.deepEqual(secondResult.newOrderIds, []); // khong phai don moi, la transition
    assert.deepEqual(secondResult.statusTransitions, [{ orderId: "SP003", from: "pending", to: "confirmed" }]);

    const entries = ledgerStore.getUserSummary("zalo", "user-a").entries;
    assert.equal(entries.length, 1); // khong tao entry moi, UPDATE tai cho
    assert.equal(entries[0].status, "confirmed");
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

test("importShopeeReport: don 'pending' da co san, lan sau bao cao 'Khong hop le' -> chuyen 'reversed'", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");

    importShopeeReport(
      logStore,
      ledgerStore,
      { recordOrderConfig: ORDER_CONFIG },
      buildCsv([
        {
          orderId: "SP004",
          orderAmount: 100_000,
          commissionAmount: 10_000,
          status: "Đang chờ xử lý",
          subIdParts: ["zalo", "user-a", "abc", "def"],
        },
      ])
    );

    const result = importShopeeReport(
      logStore,
      ledgerStore,
      { recordOrderConfig: ORDER_CONFIG },
      buildCsv([
        {
          orderId: "SP004",
          orderAmount: 100_000,
          commissionAmount: 10_000,
          status: "Không hợp lệ",
          subIdParts: ["zalo", "user-a", "abc", "def"],
        },
      ])
    );

    assert.equal(result.reversedCount, 1);
    assert.deepEqual(result.newOrderIds, []);
    assert.deepEqual(result.statusTransitions, [{ orderId: "SP004", from: "pending", to: "reversed" }]);
    const entries = ledgerStore.getUserSummary("zalo", "user-a").entries;
    assert.equal(entries[0].status, "reversed");
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

test("importShopeeReport: don da 'confirmed' truoc do, bao cao lai 'Khong hop le' -> KHONG tu huy, ghi canh bao", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");

    importShopeeReport(
      logStore,
      ledgerStore,
      { recordOrderConfig: ORDER_CONFIG },
      buildCsv([
        {
          orderId: "SP005",
          orderAmount: 100_000,
          commissionAmount: 10_000,
          status: "Hoàn thành",
          subIdParts: ["zalo", "user-a", "abc", "def"],
        },
      ])
    );
    assert.equal(ledgerStore.getAvailableBalance("zalo", "user-a"), 8_000);

    const result = importShopeeReport(
      logStore,
      ledgerStore,
      { recordOrderConfig: ORDER_CONFIG },
      buildCsv([
        {
          orderId: "SP005",
          orderAmount: 100_000,
          commissionAmount: 10_000,
          status: "Không hợp lệ",
          subIdParts: ["zalo", "user-a", "abc", "def"],
        },
      ])
    );

    assert.equal(result.reversedCount, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /confirmed/);
    assert.equal(ledgerStore.getAvailableBalance("zalo", "user-a"), 8_000); // khong doi

    const entries = ledgerStore.getUserSummary("zalo", "user-a").entries;
    assert.equal(entries[0].status, "confirmed");
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

test("importShopeeReport: co BOM dau file van doc dung ten cot", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");
    const csv = buildCsv(
      [
        {
          orderId: "SP006",
          orderAmount: 100_000,
          commissionAmount: 10_000,
          status: "Hoàn thành",
          subIdParts: ["zalo", "user-a", "abc", "def"],
        },
      ],
      true
    );

    const result = importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);

    assert.equal(result.confirmedNew, 1);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

test("importShopeeReport: subId khong khop request nao -> skippedSubIdNotFound", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    const csv = buildCsv([
      {
        orderId: "SP007",
        orderAmount: 100_000,
        commissionAmount: 10_000,
        status: "Hoàn thành",
        subIdParts: ["zalo", "khong-ton-tai", "xyz", "999"],
      },
    ]);

    const result = importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);

    assert.equal(result.confirmedNew, 0);
    assert.equal(result.skippedSubIdNotFound, 1);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

// 2026-08-23 (phat hien tu bao cao thuc te): don "an theo" trong cung phien click nhung khong qua
// link nao cua bot se co Sub_id1-5 RONG HOAN TOAN - quyet dinh chot voi user la bo qua, KHONG doan
// gan cho user nao (tien thuoc ve chu bot).
test("importShopeeReport: Sub_id1-5 rong hoan toan (don an theo, khong qua link nao) -> skippedNoSubId", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    const csv = buildCsv([
      {
        orderId: "SP008",
        orderAmount: 45_175,
        commissionAmount: 7_680,
        status: "Đang chờ xử lý",
        subIdParts: [],
      },
    ]);

    const result = importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);

    assert.equal(result.skippedNoSubId, 1);
    assert.equal(result.pendingNew, 0);
    assert.equal(result.confirmedNew, 0);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

test("importShopeeReport: gia tri cot trang thai la vao (khong khop 3 gia tri da biet) -> skippedUnknownStatus", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");
    const csv = buildCsv([
      {
        orderId: "SP009",
        orderAmount: 100_000,
        commissionAmount: 10_000,
        status: "Đã hoàn trả",
        subIdParts: ["zalo", "user-a", "abc", "def"],
      },
    ]);

    const result = importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);

    assert.equal(result.skippedUnknownStatus, 1);
    assert.equal(result.errors.length, 1);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

// 2026-08-23: xac nhan qua test that cua user - Shopee tach checkout nhieu shop thanh nhieu ID don
// hang RIENG BIET (khong phai 1 don nhieu dong) - truong hop nay chi la lop an toan du phong, khong
// ky vong xay ra voi du lieu that, nhung van phai xu ly an toan neu gap (vd loi xuat file cua Shopee).
test("importShopeeReport: 2 dong cung 1 ID don hang (chua ho tro gop) -> skippedMultiItem, khong ghi gi", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");
    const csv = buildCsv([
      {
        orderId: "SP010",
        productName: "San pham 1",
        orderAmount: 50_000,
        commissionAmount: 5_000,
        status: "Hoàn thành",
        subIdParts: ["zalo", "user-a", "abc", "def"],
      },
      {
        orderId: "SP010",
        productName: "San pham 2",
        orderAmount: 60_000,
        commissionAmount: 6_000,
        status: "Hoàn thành",
        subIdParts: ["zalo", "user-a", "abc", "def"],
      },
    ]);

    const result = importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);

    assert.equal(result.skippedMultiItem, 1);
    assert.equal(result.confirmedNew, 0);
    assert.equal(ledgerStore.getAvailableBalance("zalo", "user-a"), 0);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

test("importShopeeReport: chay lai file giong het lan truoc (da 'confirmed') -> confirmedDuplicate, khong cong trung", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");
    const csv = buildCsv([
      {
        orderId: "SP011",
        orderAmount: 100_000,
        commissionAmount: 10_000,
        status: "Hoàn thành",
        subIdParts: ["zalo", "user-a", "abc", "def"],
      },
    ]);

    const first = importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);
    assert.equal(first.confirmedNew, 1);

    const second = importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);
    assert.equal(second.confirmedNew, 0);
    assert.equal(second.confirmedDuplicate, 1);
    assert.equal(ledgerStore.getAvailableBalance("zalo", "user-a"), 8_000); // khong bi cong 2 lan
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});
