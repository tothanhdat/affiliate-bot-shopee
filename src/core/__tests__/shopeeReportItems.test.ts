import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";
import { LogStore } from "../logStore.js";
import { importShopeeReport } from "../shopeeReportImport.js";
import { entryItemsKey, entryItemsReconcile } from "../entryItems.js";

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

// Don that 2610109S28J4XY trong AffiliateCommissionReport_202610110849.csv: 7 dong, 2 dong cung item_id
// 18193835545 khac model_id. Cot "Tong hoa hong don hang" cua Shopee chi co o dong dau (31.621), nhung
// cot hoa hong SAN PHAM co o moi dong - day chinh la thu bi nham thanh "mon mua kem khong co hoa hong".
const REAL_ORDER_ID = "2610109S28J4XY";
function realOrderRows(): ItemRow[] {
  const base = { orderId: REAL_ORDER_ID, status: "Đang chờ xử lý" };
  return [
    { ...base, name: "Loi Vai Bo Aukobe", itemId: "18193835545", modelId: "168152404387", listPrice: 249_000, amount: 193_455, commission: 4_836.375 },
    { ...base, name: "Loi Vai Bo Aukobe", itemId: "18193835545", modelId: "168152404388", listPrice: 249_000, amount: 193_455, commission: 4_836.375 },
    { ...base, name: "Nac Nong Heo", itemId: "29526033790", modelId: "237366680880", listPrice: 338_000, amount: 262_601, commission: 6_565.025 },
    { ...base, name: "Mandu Bibigo", itemId: "5976750561", modelId: "55655847274", listPrice: 65_000, quantity: 2, amount: 101_000, commission: 2_525 },
    { ...base, name: "De Suon Bo My", itemId: "6586835646", modelId: "112622507365", listPrice: 265_000, amount: 205_886, commission: 5_147.15 },
    { ...base, name: "Dau hu ca pho mai", itemId: "8460423469", modelId: "65656100957", listPrice: 125_000, amount: 97_119, commission: 2_427.975 },
    { ...base, name: "Loi Vai Bo My", itemId: "8746499482", modelId: "65982781693", listPrice: 272_000, amount: 211_324, commission: 5_283.1 },
  ];
}

function itemsOf(ledgerStore: LedgerStore, orderId: string) {
  return ledgerStore.listEntryItemsFor([{ merchant: "shopee", orderId }]).get(entryItemsKey("shopee", orderId));
}

test("import: don that 7 mon -> du 7 mon, cong lai KHOP dung so cua don", () => {
  withStores((logStore, ledgerStore) => {
    runImport(logStore, ledgerStore, realOrderRows());
    const entry = ledgerStore.getEntryByOrderId("shopee", REAL_ORDER_ID)!;
    const items = itemsOf(ledgerStore, REAL_ORDER_ID)!;

    assert.equal(items.length, 7);
    assert.equal(items.filter((i) => i.itemId === "18193835545").length, 2, "2 model cung item_id phai ra 2 dong");
    assert.equal(items.reduce((s, i) => s + i.orderAmount, 0), entry.orderAmount);
    assert.ok(Math.abs(items.reduce((s, i) => s + i.commissionAmount, 0) - 31_621) < 1e-6);
    assert.ok(Math.abs(entry.commissionAmount - 31_621) < 1e-6);
    assert.equal(entryItemsReconcile(entry, items), true);
  });
});

test("import: qua tang gia 0 khong vao items, mon hoa hong 0d van vao", () => {
  withStores((logStore, ledgerStore) => {
    runImport(logStore, ledgerStore, [
      { name: "Mon chinh", itemId: "1", listPrice: 100_000, amount: 80_000, commission: 5_000 },
      { name: "Sua tuoi 0 phan tram", itemId: "2", listPrice: 316_224, amount: 278_277, commission: 0 },
      { name: "Qua tang", itemId: "3", listPrice: 0, amount: 0, commission: 0 },
    ]);
    assert.deepEqual(itemsOf(ledgerStore, "ORD1")?.map((i) => i.itemId), ["1", "2"]);
  });
});

test("import: chay 2 lan cung file -> van dung 7 mon, khong nhan doi", () => {
  withStores((logStore, ledgerStore) => {
    runImport(logStore, ledgerStore, realOrderRows());
    runImport(logStore, ledgerStore, realOrderRows());
    assert.equal(itemsOf(ledgerStore, REAL_ORDER_ID)?.length, 7);
  });
});

test("import: bao cao lan sau bot 1 dong -> mon do bien mat (khong de lai mon ma)", () => {
  withStores((logStore, ledgerStore) => {
    runImport(logStore, ledgerStore, realOrderRows());
    runImport(logStore, ledgerStore, realOrderRows().slice(0, 6));
    assert.equal(itemsOf(ledgerStore, REAL_ORDER_ID)?.length, 6);
  });
});

test("import: dong Sub_id rong khong vao items (hoa hong gian tiep cua chu bot)", () => {
  withStores((logStore, ledgerStore) => {
    runImport(logStore, ledgerStore, [
      { name: "Mon chinh", itemId: "1", listPrice: 100_000, amount: 80_000, commission: 5_000 },
      { name: "Mon khac shop", itemId: "2", listPrice: 90_000, amount: 70_000, commission: 4_000, subIdParts: [] },
    ]);
    assert.deepEqual(itemsOf(ledgerStore, "ORD1")?.map((i) => i.itemId), ["1"]);
  });
});

test("import: dong da huy VAN co mat (reversed) nhung KHONG cong vao tong cua don", () => {
  withStores((logStore, ledgerStore) => {
    runImport(logStore, ledgerStore, [
      { name: "Mon con", itemId: "1", listPrice: 100_000, amount: 100_000, commission: 5_000, status: "Hoàn thành" },
      { name: "Mon da tra", itemId: "2", listPrice: 90_000, quantity: 0, amount: 0, commission: 0, status: "Đã hủy" },
    ]);
    const entry = ledgerStore.getEntryByOrderId("shopee", "ORD1")!;
    const items = itemsOf(ledgerStore, "ORD1")!;
    assert.equal(entry.orderAmount, 100_000);
    assert.deepEqual(items.map((i) => [i.itemId, i.rowStatus]), [["1", "confirmed"], ["2", "reversed"]]);
    assert.equal(entryItemsReconcile(entry, items), true);
  });
});

test("import: don bi bo qua vi trang thai la -> khong co entry, khong co items", () => {
  withStores((logStore, ledgerStore) => {
    const result = runImport(logStore, ledgerStore, [
      { name: "Mon", itemId: "1", listPrice: 100_000, amount: 80_000, commission: 5_000, status: "Trạng thái lạ" },
    ]);
    assert.equal(result.skippedUnknownStatus, 1);
    assert.equal(itemsOf(ledgerStore, "ORD1"), undefined);
  });
});

test("import: dong khong co item_id (bao cao cu) -> khong luu items, tien van ghi binh thuong", () => {
  withStores((logStore, ledgerStore) => {
    const result = runImport(logStore, ledgerStore, [
      { name: "Mon", itemId: "", listPrice: 100_000, amount: 80_000, commission: 5_000 },
    ]);
    assert.equal(result.pendingNew, 1);
    assert.equal(itemsOf(ledgerStore, "ORD1"), undefined);
  });
});

test("import: luu chi tiet mon loi -> TIEN van ghi binh thuong, loi chi vao danh sach canh bao", () => {
  withStores((logStore, ledgerStore) => {
    (ledgerStore as unknown as { replaceEntryItems: () => void }).replaceEntryItems = () => {
      throw new Error("boom");
    };
    const result = runImport(logStore, ledgerStore, [
      { name: "Mon", itemId: "1", listPrice: 100_000, amount: 80_000, commission: 5_000 },
    ]);
    assert.equal(result.pendingNew, 1, "tien khong duoc phep bi chan boi du lieu hien thi");
    assert.ok(result.errors.some((e) => e.includes("chi tiet san pham") && e.includes("boom")));
    assert.ok(ledgerStore.getEntryByOrderId("shopee", "ORD1"));
  });
});

test("import: cong dong 2 dong cung item+model trong 1 don, tong van khop don", () => {
  withStores((logStore, ledgerStore) => {
    runImport(logStore, ledgerStore, [
      { name: "Mon A", itemId: "9", modelId: "5", listPrice: 23_399, amount: 20_000, commission: 500 },
      { name: "Mon A", itemId: "9", modelId: "5", listPrice: 25_999, amount: 22_000, commission: 550 },
    ]);
    const entry = ledgerStore.getEntryByOrderId("shopee", "ORD1")!;
    const items = itemsOf(ledgerStore, "ORD1")!;
    assert.equal(items.length, 1);
    assert.equal(entryItemsReconcile(entry, items), true);
  });
});
