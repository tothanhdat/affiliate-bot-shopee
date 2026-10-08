import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";

function store() {
  return new LedgerStore(":memory:");
}

const DEBT = {
  platform: "zalo" as const,
  userId: "user-a",
  merchant: "shopee" as const,
  orderId: "order-1",
  amount: 40_000,
  note: "tra hang",
};

test("recordPayoutDebt: ghi 1 dong no, remaining = amount", () => {
  const s = store();
  const debt = s.recordPayoutDebt(DEBT);
  assert.ok(debt);
  assert.equal(debt.amount, 40_000);
  assert.equal(debt.remaining, 40_000);
  assert.equal(debt.settledAt, null);
  assert.equal(debt.writtenOffAt, null);
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 40_000);
});

// Chot song con: bao cao Shopee liet ke LAI ca lich su moi lan import, nen don huy hom qua se lai
// hien "Da huy" hom nay. Khong co UNIQUE la no nhan doi moi ngay.
test("recordPayoutDebt: import lai cung don KHONG nhan doi no", () => {
  const s = store();
  assert.ok(s.recordPayoutDebt(DEBT));
  assert.equal(s.recordPayoutDebt(DEBT), null, "lan 2 tra null");
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 40_000);
  assert.equal(s.listOutstandingDebts("zalo", "user-a").length, 1);
});

test("writeOffDebt: no da xoa khong tinh vao tong nua nhung dong van con de doi soat", () => {
  const s = store();
  const debt = s.recordPayoutDebt(DEBT);
  s.writeOffDebt(debt!.id);
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 0);
  assert.equal(s.listOutstandingDebts("zalo", "user-a").length, 0);
  assert.ok(s.getDebtByOrder("shopee", "order-1")?.writtenOffAt, "dong van con, co moc xoa");
});

test("deleteDebtByOrder: xoa han dong no (dung khi admin huy yeu cau rut)", () => {
  const s = store();
  s.recordPayoutDebt(DEBT);
  s.deleteDebtByOrder("shopee", "order-1");
  assert.equal(s.getDebtByOrder("shopee", "order-1"), null);
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 0);
});

test("no cua user khac khong lan sang nhau", () => {
  const s = store();
  s.recordPayoutDebt(DEBT);
  s.recordPayoutDebt({ ...DEBT, userId: "user-b", orderId: "order-2", amount: 10_000 });
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 40_000);
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-b"), 10_000);
});

test("listOutstandingDebts sap theo no CU truoc (thu tu tru no)", () => {
  const s = store();
  s.recordPayoutDebt({ ...DEBT, orderId: "debt-old" });
  s.recordPayoutDebt({ ...DEBT, orderId: "debt-new" });
  assert.deepEqual(
    s.listOutstandingDebts("zalo", "user-a").map((d) => d.orderId),
    ["debt-old", "debt-new"]
  );
});
