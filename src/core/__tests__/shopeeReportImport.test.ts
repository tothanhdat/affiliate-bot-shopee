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

test("importShopeeReport: don da rut tien xong ('paid'), bao cao lai 'Hoan thanh' -> confirmedDuplicate, KHONG canh bao (bao cao liet ke lai lich su)", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");
    const csv = buildCsv([
      {
        orderId: "SP012",
        orderAmount: 100_000,
        commissionAmount: 10_000,
        status: "Hoàn thành",
        subIdParts: ["zalo", "user-a", "abc", "def"],
      },
    ]);

    importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);
    assert.equal(ledgerStore.getAvailableBalance("zalo", "user-a"), 8_000);

    const withdrawal = ledgerStore.requestWithdrawal("zalo", "user-a", 8_000, {
      bankName: "Test Bank",
      bankAccountNumber: "123456",
      bankAccountHolder: "Nguyen Van A",
    });
    ledgerStore.markWithdrawalPaid(withdrawal.id, "/tmp/proof.jpg");

    const result = importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);

    assert.equal(result.confirmedNew, 0);
    assert.equal(result.confirmedDuplicate, 1);
    assert.equal(result.errors.length, 0); // khong con bi gan nhan "can admin kiem tra tay" nua

    const entries = ledgerStore.getUserSummary("zalo", "user-a").entries;
    assert.equal(entries[0].status, "paid");
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

// ---------------------------------------------------------------------------
// 2026-09-10: don nhieu san pham (nhieu dong cung 1 "ID don hang") + trang thai "Da huy"
// ---------------------------------------------------------------------------

// So lieu lay tu don THAT 260909K72F4DAY trong bao cao Shopee: 2 dong qua tang 0d + 1 dong san pham
// chinh 306.540d/22.990,5d. Tong ca nhom dung bang cot "Tong hoa hong don hang" cua Shopee.
test("importShopeeReport: don nhieu san pham (2 dong qua tang 0d + 1 dong chinh) -> gop thanh 1 entry, cong dung tong", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");
    const subIdParts = ["zalo", "user-a", "abc", "def"];
    const csv = buildCsv([
      { orderId: "SP020", productName: "Dau duong toc (qua tang)", orderAmount: 0, commissionAmount: 0, status: "Đang chờ xử lý", subIdParts },
      { orderId: "SP020", productName: "Bo doi dau goi", orderAmount: 306_540, commissionAmount: 22_990.5, status: "Đang chờ xử lý", subIdParts },
      { orderId: "SP020", productName: "Dau xa (qua tang)", orderAmount: 0, commissionAmount: 0, status: "Đang chờ xử lý", subIdParts },
    ]);

    const result = importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);

    assert.equal(result.ordersScanned, 1);
    assert.equal(result.mergedMultiItem, 1);
    assert.equal(result.pendingNew, 1);
    assert.deepEqual(result.errors, []);

    const entries = ledgerStore.getUserSummary("zalo", "user-a").entries;
    assert.equal(entries.length, 1);
    assert.equal(entries[0].orderAmount, 306_540);
    assert.equal(entries[0].commissionAmount, 22_990.5);
    assert.equal(entries[0].productName, "Bo doi dau goi (+2 sản phẩm khác)");
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

test("importShopeeReport: don co 2 san pham DEU sinh hoa hong -> cong dong ca hai dong", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");
    const subIdParts = ["zalo", "user-a", "abc", "def"];
    const csv = buildCsv([
      { orderId: "SP021", productName: "San pham re", orderAmount: 50_000, commissionAmount: 5_000, status: "Hoàn thành", subIdParts },
      { orderId: "SP021", productName: "San pham dat", orderAmount: 60_000, commissionAmount: 6_000, status: "Hoàn thành", subIdParts },
    ]);

    const result = importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);

    assert.equal(result.confirmedNew, 1);
    assert.equal(result.mergedMultiItem, 1);
    assert.equal(ledgerStore.getAvailableBalance("zalo", "user-a"), 8_800); // 80% cua 11.000d

    const entries = ledgerStore.getUserSummary("zalo", "user-a").entries;
    assert.equal(entries.length, 1);
    assert.equal(entries[0].orderAmount, 110_000);
    assert.equal(entries[0].commissionAmount, 11_000);
    assert.equal(entries[0].productName, "San pham dat (+1 sản phẩm khác)"); // ten dong hoa hong cao nhat
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

// Yeu cau truc tiep cua user 2026-09-10: user huy don -> bao cao Shopee ghi "Da huy" (KHAC "Khong hop
// le"), truoc do roi vao nhanh "trang thai la" nen entry pending bi ket mai o "Cho xac nhan".
test("importShopeeReport: don 'pending' da co san, lan sau bao cao 'Da huy' -> chuyen 'reversed'", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");
    const subIdParts = ["zalo", "user-a", "abc", "def"];

    importShopeeReport(
      logStore,
      ledgerStore,
      { recordOrderConfig: ORDER_CONFIG },
      buildCsv([{ orderId: "SP022", orderAmount: 478_800, commissionAmount: 12_000, status: "Đang chờ xử lý", subIdParts }])
    );

    const result = importShopeeReport(
      logStore,
      ledgerStore,
      { recordOrderConfig: ORDER_CONFIG },
      buildCsv([{ orderId: "SP022", orderAmount: 478_800, commissionAmount: 0, status: "Đã hủy", subIdParts }])
    );

    assert.equal(result.reversedCount, 1);
    assert.equal(result.skippedUnknownStatus, 0);
    assert.deepEqual(result.statusTransitions, [{ orderId: "SP022", from: "pending", to: "reversed" }]);

    const entries = ledgerStore.getUserSummary("zalo", "user-a").entries;
    assert.equal(entries[0].status, "reversed");
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

// Tieng Viet co 2 cach dat dau cho tu "huy" - Shopee dang xuat "hủy", nhung khong dam bao mai mai.
test("importShopeeReport: cach viet 'Da huy' kieu khac ('hu' + dau hoi roi) van duoc nhan dien", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");
    const subIdParts = ["zalo", "user-a", "abc", "def"];

    importShopeeReport(
      logStore,
      ledgerStore,
      { recordOrderConfig: ORDER_CONFIG },
      buildCsv([{ orderId: "SP023", orderAmount: 100_000, commissionAmount: 10_000, status: "Đang chờ xử lý", subIdParts }])
    );

    const result = importShopeeReport(
      logStore,
      ledgerStore,
      { recordOrderConfig: ORDER_CONFIG },
      buildCsv([{ orderId: "SP023", orderAmount: 100_000, commissionAmount: 0, status: "Đã huỷ", subIdParts }])
    );

    assert.equal(result.reversedCount, 1);
    assert.equal(result.skippedUnknownStatus, 0);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

// Bao cao liet ke lai ca lich su -> don huy tu truoc khi bot ghi nhan se xuat hien o moi lan import.
test("importShopeeReport: don 'Da huy' chua tung duoc ghi nhan -> bo qua im lang, khong bao loi", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");
    const csv = buildCsv([
      {
        orderId: "SP024",
        orderAmount: 478_800,
        commissionAmount: 0,
        status: "Đã hủy",
        subIdParts: ["zalo", "user-a", "abc", "def"],
      },
    ]);

    const result = importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);

    assert.equal(result.reversedCount, 0);
    assert.equal(result.skippedUnknownStatus, 0);
    assert.deepEqual(result.errors, []);
    assert.equal(ledgerStore.getUserSummary("zalo", "user-a").entries.length, 0);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

test("importShopeeReport: don da 'confirmed' truoc do, bao cao lai 'Da huy' -> KHONG tu huy, ghi canh bao", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");
    const subIdParts = ["zalo", "user-a", "abc", "def"];

    importShopeeReport(
      logStore,
      ledgerStore,
      { recordOrderConfig: ORDER_CONFIG },
      buildCsv([{ orderId: "SP025", orderAmount: 100_000, commissionAmount: 10_000, status: "Hoàn thành", subIdParts }])
    );

    const result = importShopeeReport(
      logStore,
      ledgerStore,
      { recordOrderConfig: ORDER_CONFIG },
      buildCsv([{ orderId: "SP025", orderAmount: 100_000, commissionAmount: 0, status: "Đã hủy", subIdParts }])
    );

    assert.equal(result.reversedCount, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /confirmed/);
    assert.equal(ledgerStore.getAvailableBalance("zalo", "user-a"), 8_000); // khong doi
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

// Tra hang 1 phan: dong bi huy khong duoc tinh vao tong, phan con lai van ghi nhan binh thuong.
test("importShopeeReport: don co 1 dong 'Hoan thanh' + 1 dong 'Da huy' -> loai dong huy khoi tong", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");
    const subIdParts = ["zalo", "user-a", "abc", "def"];
    const csv = buildCsv([
      { orderId: "SP026", productName: "San pham giu lai", orderAmount: 100_000, commissionAmount: 10_000, status: "Hoàn thành", subIdParts },
      { orderId: "SP026", productName: "San pham tra lai", orderAmount: 80_000, commissionAmount: 8_000, status: "Đã hủy", subIdParts },
    ]);

    const result = importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);

    assert.equal(result.confirmedNew, 1);
    assert.equal(result.reversedCount, 0);
    assert.equal(ledgerStore.getAvailableBalance("zalo", "user-a"), 8_000); // 80% cua 10.000d, KHONG gom dong huy

    const entries = ledgerStore.getUserSummary("zalo", "user-a").entries;
    assert.equal(entries[0].orderAmount, 100_000);
    assert.equal(entries[0].productName, "San pham giu lai"); // chi con 1 dong duoc tinh -> khong co hau to
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

// Nguyen tac "chua chac chan het thi van pending" - giong groupTransactionsByOrderId cua accesstradeSync.
test("importShopeeReport: don co dong 'Hoan thanh' lan dong 'Dang cho xu ly' -> ca don la 'pending'", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");
    const subIdParts = ["zalo", "user-a", "abc", "def"];
    const csv = buildCsv([
      { orderId: "SP027", orderAmount: 100_000, commissionAmount: 10_000, status: "Hoàn thành", subIdParts },
      { orderId: "SP027", orderAmount: 50_000, commissionAmount: 5_000, status: "Đang chờ xử lý", subIdParts },
    ]);

    const result = importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);

    assert.equal(result.pendingNew, 1);
    assert.equal(result.confirmedNew, 0);
    assert.equal(ledgerStore.getAvailableBalance("zalo", "user-a"), 0);

    const entries = ledgerStore.getUserSummary("zalo", "user-a").entries;
    assert.equal(entries[0].status, "pending");
    assert.equal(entries[0].commissionAmount, 15_000); // van cong dong ca 2 dong
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

// Giu dung quyet dinh 2026-08-23: hoa hong cua dong khong di qua link nao cua bot khong duoc gan cho user.
test("importShopeeReport: dong co Sub_id rong lan trong nhom -> khong cong vao tong, ghi canh bao", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");
    const csv = buildCsv([
      {
        orderId: "SP028",
        orderAmount: 100_000,
        commissionAmount: 10_000,
        status: "Hoàn thành",
        subIdParts: ["zalo", "user-a", "abc", "def"],
      },
      { orderId: "SP028", orderAmount: 70_000, commissionAmount: 7_000, status: "Hoàn thành", subIdParts: [] },
    ]);

    const result = importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);

    assert.equal(result.confirmedNew, 1);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /Sub_id/i);
    assert.equal(ledgerStore.getAvailableBalance("zalo", "user-a"), 8_000); // chi tinh dong co subId

    const entries = ledgerStore.getUserSummary("zalo", "user-a").entries;
    assert.equal(entries[0].orderAmount, 100_000);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

test("importShopeeReport: 1 dong trong nhom co trang thai la -> bo qua CA DON, khong ghi mot phan", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");
    const subIdParts = ["zalo", "user-a", "abc", "def"];
    const csv = buildCsv([
      { orderId: "SP029", orderAmount: 100_000, commissionAmount: 10_000, status: "Hoàn thành", subIdParts },
      { orderId: "SP029", orderAmount: 50_000, commissionAmount: 5_000, status: "Đã hoàn trả", subIdParts },
    ]);

    const result = importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);

    assert.equal(result.skippedUnknownStatus, 1);
    assert.equal(result.confirmedNew, 0);
    assert.equal(result.errors.length, 1);
    assert.equal(ledgerStore.getUserSummary("zalo", "user-a").entries.length, 0);
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

// 2026-09-10: quet 14 bao cao that thay gia tri "Chưa thanh toán" - don COD, user dat nhung chua tra
// tien. Ve ban chat giong "Dang cho xu ly": don co that, chua chac chan, chua duoc tinh hoa hong.
test("importShopeeReport: 'Chua thanh toan' (don COD chua tra tien) -> ghi moi 'pending'", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");
    const csv = buildCsv([
      {
        orderId: "SP030",
        orderAmount: 478_800,
        commissionAmount: 12_000,
        status: "Chưa thanh toán",
        subIdParts: ["zalo", "user-a", "abc", "def"],
      },
    ]);

    const result = importShopeeReport(logStore, ledgerStore, { recordOrderConfig: ORDER_CONFIG }, csv);

    assert.equal(result.pendingNew, 1);
    assert.equal(result.skippedUnknownStatus, 0);
    assert.deepEqual(result.errors, []);
    assert.equal(ledgerStore.getAvailableBalance("zalo", "user-a"), 0);

    const entries = ledgerStore.getUserSummary("zalo", "user-a").entries;
    assert.equal(entries[0].status, "pending");
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});

// Vong doi that cua don 260908GH4GRXP4 trong bao cao Shopee: 09/09 "Chua thanh toan" -> 10/09 "Da huy".
test("importShopeeReport: vong doi 'Chua thanh toan' -> 'Da huy' -> entry chuyen 'reversed'", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  try {
    seedRequestLog(logStore, "zalo-user-a-abc-def");
    const subIdParts = ["zalo", "user-a", "abc", "def"];

    importShopeeReport(
      logStore,
      ledgerStore,
      { recordOrderConfig: ORDER_CONFIG },
      buildCsv([{ orderId: "SP031", orderAmount: 478_800, commissionAmount: 12_000, status: "Chưa thanh toán", subIdParts }])
    );

    const result = importShopeeReport(
      logStore,
      ledgerStore,
      { recordOrderConfig: ORDER_CONFIG },
      buildCsv([{ orderId: "SP031", orderAmount: 0, commissionAmount: 0, status: "Đã hủy", subIdParts }])
    );

    assert.equal(result.reversedCount, 1);
    assert.deepEqual(result.statusTransitions, [{ orderId: "SP031", from: "pending", to: "reversed" }]);

    const entries = ledgerStore.getUserSummary("zalo", "user-a").entries;
    assert.equal(entries[0].status, "reversed");
  } finally {
    logStore.close();
    ledgerStore.close();
  }
});
