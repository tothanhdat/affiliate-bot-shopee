import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";
import {
  entryItemsKey,
  entryItemsReconcile,
  type CommissionEntryItem,
  type EntryItemInput,
} from "../entryItems.js";

function item(overrides: Partial<EntryItemInput> = {}): EntryItemInput {
  return {
    itemId: "100",
    modelId: "1",
    productName: "San pham A",
    quantity: 1,
    orderAmount: 100_000,
    commissionAmount: 2_500,
    rowStatus: "pending",
    ...overrides,
  };
}

function listOne(store: LedgerStore, merchant: "shopee" | "tiktokshop", orderId: string) {
  return store.listEntryItemsFor([{ merchant, orderId }]).get(entryItemsKey(merchant, orderId));
}

test("replaceEntryItems: doc lai dung thu tu bao cao va giu hoa hong le (khong lam tron)", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.replaceEntryItems("shopee", "O1", [
      item({ itemId: "1", commissionAmount: 4836.375 }),
      item({ itemId: "2", productName: "B" }),
    ]);
    const got = listOne(store, "shopee", "O1");
    assert.deepEqual(got?.map((i) => i.itemId), ["1", "2"]);
    assert.equal(got?.[0].commissionAmount, 4836.375);
    assert.equal(got?.[0].merchant, "shopee");
    assert.equal(got?.[0].orderId, "O1");
  } finally {
    store.close();
  }
});

test("replaceEntryItems: goi lai 2 lan KHONG nhan doi", () => {
  const store = new LedgerStore(":memory:");
  try {
    const items = [item({ itemId: "1" }), item({ itemId: "2" })];
    store.replaceEntryItems("shopee", "O1", items);
    store.replaceEntryItems("shopee", "O1", items);
    assert.equal(listOne(store, "shopee", "O1")?.length, 2);
  } finally {
    store.close();
  }
});

test("replaceEntryItems: dong Shopee da bo khoi bao cao bien mat (khong de lai mon ma)", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.replaceEntryItems("shopee", "O1", [item({ itemId: "1" }), item({ itemId: "2" }), item({ itemId: "3" })]);
    store.replaceEntryItems("shopee", "O1", [item({ itemId: "1" }), item({ itemId: "2" })]);
    assert.deepEqual(listOne(store, "shopee", "O1")?.map((i) => i.itemId), ["1", "2"]);
  } finally {
    store.close();
  }
});

test("replaceEntryItems: mang rong xoa sach chi tiet cua don", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.replaceEntryItems("shopee", "O1", [item()]);
    store.replaceEntryItems("shopee", "O1", []);
    assert.equal(listOne(store, "shopee", "O1"), undefined);
  } finally {
    store.close();
  }
});

test("replaceEntryItems: cung item_id KHAC model_id la 2 mon rieng (don that 2610109S28J4XY)", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.replaceEntryItems("shopee", "O1", [
      item({ itemId: "18193835545", modelId: "168152404387", commissionAmount: 4836.375 }),
      item({ itemId: "18193835545", modelId: "168152404388", commissionAmount: 4836.375 }),
    ]);
    assert.equal(listOne(store, "shopee", "O1")?.length, 2);
  } finally {
    store.close();
  }
});

test("replaceEntryItems: cung item_id + model_id trong 1 don duoc CONG DON, tong giu nguyen", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.replaceEntryItems("shopee", "O1", [
      item({ itemId: "9", modelId: "5", quantity: 1, orderAmount: 23_399, commissionAmount: 100.5 }),
      item({ itemId: "9", modelId: "5", quantity: 2, orderAmount: 25_999, commissionAmount: 200.25 }),
    ]);
    const got = listOne(store, "shopee", "O1");
    assert.equal(got?.length, 1);
    assert.equal(got?.[0].quantity, 3);
    assert.equal(got?.[0].orderAmount, 49_398);
    assert.equal(got?.[0].commissionAmount, 300.75);
  } finally {
    store.close();
  }
});

test("replaceEntryItems: gop mon cung khoa, trang thai KHONG huy thang trang thai huy", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.replaceEntryItems("shopee", "O1", [
      item({ itemId: "9", modelId: "5", rowStatus: "reversed", orderAmount: 0, commissionAmount: 0 }),
      item({ itemId: "9", modelId: "5", rowStatus: "pending" }),
    ]);
    assert.equal(listOne(store, "shopee", "O1")?.[0].rowStatus, "pending");
  } finally {
    store.close();
  }
});

test("listEntryItemsFor: chi tra don duoc hoi, tach theo merchant, don khong co item thi vang mat", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.replaceEntryItems("shopee", "O1", [item({ itemId: "1" })]);
    store.replaceEntryItems("shopee", "O2", [item({ itemId: "2" })]);
    store.replaceEntryItems("tiktokshop", "O1", [item({ itemId: "3" })]);

    const map = store.listEntryItemsFor([
      { merchant: "shopee", orderId: "O1" },
      { merchant: "shopee", orderId: "O-khong-co" },
    ]);
    assert.deepEqual([...map.keys()], [entryItemsKey("shopee", "O1")]);
    assert.deepEqual(map.get(entryItemsKey("shopee", "O1"))?.map((i) => i.itemId), ["1"]);
  } finally {
    store.close();
  }
});

test("listEntryItemsFor: danh sach rong -> Map rong, khong goi DB", () => {
  const store = new LedgerStore(":memory:");
  try {
    assert.equal(store.listEntryItemsFor([]).size, 0);
  } finally {
    store.close();
  }
});

function full(overrides: Partial<CommissionEntryItem> = {}): CommissionEntryItem {
  return { merchant: "shopee", orderId: "O1", ...item(), ...overrides };
}

test("entryItemsReconcile: khop khi cong cac mon dung bang so cua don", () => {
  const items = [
    full({ orderAmount: 193_455, commissionAmount: 4836.375 }),
    full({ itemId: "2", orderAmount: 101_000, commissionAmount: 2525 }),
  ];
  assert.equal(entryItemsReconcile({ orderAmount: 294_455, commissionAmount: 7361.375 }, items), true);
});

test("entryItemsReconcile: lech hoa hong hoac gia tri -> false", () => {
  const items = [full({ orderAmount: 100_000, commissionAmount: 5_000 })];
  assert.equal(entryItemsReconcile({ orderAmount: 100_000, commissionAmount: 5_001 }, items), false);
  assert.equal(entryItemsReconcile({ orderAmount: 100_001, commissionAmount: 5_000 }, items), false);
});

test("entryItemsReconcile: mon da huy khong duoc cong", () => {
  const items = [
    full({ orderAmount: 100_000, commissionAmount: 5_000 }),
    full({ itemId: "2", rowStatus: "reversed", orderAmount: 90_000, commissionAmount: 4_500 }),
  ];
  assert.equal(entryItemsReconcile({ orderAmount: 100_000, commissionAmount: 5_000 }, items), true);
});
