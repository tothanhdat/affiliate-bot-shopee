import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";
import { InsufficientBalanceError, WithdrawalNotCancellableError } from "../errors.js";
import { addDaysToVnIso, todayVnIso } from "../vietnamDate.js";

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

// ---------------------------------------------------------------------------
// Tru no vao Kha dung (Task 6)
// ---------------------------------------------------------------------------

const BANK = { bankName: "Vietcombank", bankAccountNumber: "0123456789", bankAccountHolder: "Nguyen Van A" };
const HOLD_OFF = { thresholdVnd: 0, holdDays: 0 };

function recordConfirmed(s: LedgerStore, orderId: string, commissionAmount: number) {
  return s.recordConversion({
    subId: "k-user-a-abc-def",
    platform: "zalo",
    userId: "user-a",
    merchant: "shopee",
    orderId,
    orderAmount: commissionAmount * 10,
    commissionAmount,
    taxPercent: 0,
    platformFeePercent: 0,
    userSharePercent: 100,
    maxCommissionRatioPercent: 50,
    holdConfig: HOLD_OFF,
  });
}

test("getAvailableBalance tru no, co floor 0 - KHONG BAO GIO am", () => {
  const s = store();
  recordConfirmed(s, "order-1", 10_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 40_000 });
  assert.equal(s.getAvailableBalance("zalo", "user-a"), 0, "10k - 40k phai la 0, khong phai -30k");
  assert.equal(s.getGrossAvailableBalance("zalo", "user-a"), 10_000);
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 40_000, "no van con nguyen 40k");
});

test("requestWithdrawal: amount = net, ghi debt_applied, CHUA tru no", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 40_000 });

  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);
  assert.equal(w.amount, 60_000, "100k - 40k");
  assert.equal(w.debtApplied, 40_000);
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 40_000, "no CHUA bi tru o buoc nay");
});

test("markWithdrawalPaid: tru no, dien settled_at khi remaining ve 0", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 40_000 });
  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);

  s.markWithdrawalPaid(w.id, null);
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 0);
  assert.ok(s.getDebtByOrder("shopee", "old-order")?.settledAt);
});

test("no lon hon tien -> khong rut duoc (net duoi nguong)", () => {
  const s = store();
  recordConfirmed(s, "order-1", 10_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 40_000 });
  assert.throws(() => s.requestWithdrawal("zalo", "user-a", 10_000, BANK), InsufficientBalanceError);
});

test("tru no uu tien no CU nhat truoc", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "debt-old", amount: 30_000 });
  s.recordPayoutDebt({ ...DEBT, orderId: "debt-new", amount: 50_000 });

  const w = s.requestWithdrawal("zalo", "user-a", 10_000, BANK);
  assert.equal(w.amount, 20_000, "100k - 80k");
  s.markWithdrawalPaid(w.id, null);

  assert.ok(s.getDebtByOrder("shopee", "debt-old")?.settledAt, "no cu settled");
  assert.ok(s.getDebtByOrder("shopee", "debt-new")?.settledAt, "no moi cung settled");
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 0);
});

/**
 * BAT BIEN cua he: moi yeu cau rut THANH CONG deu tra HET no.
 *
 * Chung minh: yeu cau chi duoc tao khi net = gross - no >= nguong > 0, tuc gross > no, tuc
 * debtApplied = min(gross, no) = no. Nen khong co duong nao de mot yeu cau rut hop le chi tra duoc
 * mot phan no. Day la ly do test "tru no mot phan" phai ha nguong ve 0 moi cham toi duoc vong lap do.
 */
test("nguong > 0: moi yeu cau rut thanh cong deu tra HET no (bat bien)", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "debt-old", amount: 30_000 });
  s.recordPayoutDebt({ ...DEBT, orderId: "debt-new", amount: 40_000 });

  const w = s.requestWithdrawal("zalo", "user-a", 10_000, BANK);
  assert.equal(w.debtApplied, 70_000, "tru TRON ven ca 2 khoan no");
  s.markWithdrawalPaid(w.id, null);
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 0);
});

// Vong lap tru no trong markWithdrawalPaid chi cham toi duoc qua nguong rut = 0 (admin dat duoc o
// /admin/settings). Giu vong lap chu khong don gian hoa thanh "tra het": nguong la setting runtime,
// khong phai hang so, nen bat bien o tren co the bien mat ma khong ai sua lai cho nay.
test("nguong = 0: tru no MOT PHAN - no cu tra het, no moi con lai dung so du", () => {
  const s = store();
  recordConfirmed(s, "order-1", 50_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "debt-old", amount: 30_000 });
  s.recordPayoutDebt({ ...DEBT, orderId: "debt-new", amount: 40_000 });

  const w = s.requestWithdrawal("zalo", "user-a", 0, BANK);
  assert.equal(w.amount, 0, "50k - 70k -> floor 0");
  assert.equal(w.debtApplied, 50_000, "chi tru duoc toi da so tien co");

  s.markWithdrawalPaid(w.id, null);
  assert.equal(s.getDebtByOrder("shopee", "debt-old")?.remaining, 0, "no cu tra het");
  assert.ok(s.getDebtByOrder("shopee", "debt-old")?.settledAt);
  assert.equal(s.getDebtByOrder("shopee", "debt-new")?.remaining, 20_000, "no moi con 40k - 20k");
  assert.equal(s.getDebtByOrder("shopee", "debt-new")?.settledAt, null, "chua tra het thi chua settled");
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 20_000);
});

test("no da bi admin XOA khong tru vao Kha dung nua", () => {
  const s = store();
  recordConfirmed(s, "order-1", 10_000);
  const debt = s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 40_000 });
  assert.equal(s.getAvailableBalance("zalo", "user-a"), 0);
  s.writeOffDebt(debt!.id);
  assert.equal(s.getAvailableBalance("zalo", "user-a"), 10_000);
});

// ---------------------------------------------------------------------------
// Huy yeu cau rut (Task 7)
// ---------------------------------------------------------------------------

test("cancelWithdrawal: tha entry ve confirmed/chua rut, KHONG cong vao tien da chi tra", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);

  const cancelled = s.cancelWithdrawal(w.id, "don bi tra hang");
  assert.equal(cancelled.status, "cancelled");
  assert.ok(cancelled.cancelledAt);
  assert.equal(cancelled.cancelReason, "don bi tra hang", "li do phai duoc LUU, admin xem tab Da huy can biet");
  // Doc lai tu DB chu khong tin object tra ve
  assert.equal(s.listCancelledWithdrawals()[0].cancelReason, "don bi tra hang");

  assert.equal(s.getAvailableBalance("zalo", "user-a"), 100_000, "tien ve lai Kha dung");
  assert.equal(s.getPendingWithdrawal("zalo", "user-a"), null, "khong con yeu cau dang cho");
  assert.equal(s.listPaidWithdrawals().length, 0, "yeu cau da huy KHONG phai yeu cau da tra");

  const entry = s.listCommissionEntries({ userId: "user-a" })[0];
  assert.equal(entry.status, "confirmed");
  assert.equal(entry.withdrawalId, null);
});

test("cancelWithdrawal: KHONG hoan no vi chua tung bi tru", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 40_000 });
  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);

  s.cancelWithdrawal(w.id, "test");
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 40_000, "no van dung 40k, khong nhan doi");
});

test("cancelWithdrawal: khong huy duoc yeu cau da tra", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);
  s.markWithdrawalPaid(w.id, null);
  assert.throws(() => s.cancelWithdrawal(w.id, "test"), WithdrawalNotCancellableError);
});

test("cancelWithdrawal: huy 2 lan -> lan 2 bi tu choi", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);
  s.cancelWithdrawal(w.id, "test");
  assert.throws(() => s.cancelWithdrawal(w.id, "test"), WithdrawalNotCancellableError);
});

test("sau khi huy, user gui lai yeu cau rut duoc", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  const first = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);
  s.cancelWithdrawal(first.id, "test");
  const second = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);
  assert.equal(second.amount, 100_000);
});

test("listEntriesByWithdrawal: chup duoc danh sach entry TRUOC khi huy", () => {
  const s = store();
  recordConfirmed(s, "order-1", 60_000);
  recordConfirmed(s, "order-2", 40_000);
  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);

  const before = s.listEntriesByWithdrawal(w.id);
  assert.deepEqual(before.map((e) => e.orderId).sort(), ["order-1", "order-2"]);

  // Sau khi huy thi withdrawal_id da bi xoa -> khong con tra ve gi. Day la ly do route cancel PHAI
  // chup danh sach truoc khi goi cancelWithdrawal().
  s.cancelWithdrawal(w.id, "test");
  assert.equal(s.listEntriesByWithdrawal(w.id).length, 0);
});

test("listCancelledWithdrawals tra yeu cau da huy, moi nhat truoc", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);
  s.cancelWithdrawal(w.id, "test");
  const list = s.listCancelledWithdrawals();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, w.id);
  assert.equal(list[0].status, "cancelled");
});

test("yeu cau da huy KHONG tinh vao getOutstandingTotals", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);
  s.cancelWithdrawal(w.id, "test");
  const totals = s.getOutstandingTotals();
  assert.equal(totals.pendingWithdrawalCount, 0);
  assert.equal(totals.pendingWithdrawalAmount, 0);
});

// ---------------------------------------------------------------------------
// Tien cua withdrawal doc tu withdrawal_requests, khong cong theo entry (Task 8)
// ---------------------------------------------------------------------------

test("pendingBalance doc tu withdrawal_requests.amount (net), khong cong entry (gross)", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 40_000 });
  s.requestWithdrawal("zalo", "user-a", 20_000, BANK);

  const summary = s.getUserSummary("zalo", "user-a");
  assert.equal(summary.pendingBalance, 60_000, "so THAT se duoc chuyen, khong phai 100k");
});

test("paidTotal doc tu withdrawal_requests.amount (net) - khop so vao tai khoan user", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 40_000 });
  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);
  s.markWithdrawalPaid(w.id, null);

  const summary = s.getUserSummary("zalo", "user-a");
  assert.equal(summary.paidTotal, 60_000, "so THAT da vao tai khoan user");
});

test("getUserSummary tra them heldBalance/heldEntries/debtRemaining/grossAvailableBalance", () => {
  const s = store();
  recordConfirmed(s, "small", 10_000);
  s.recordConversion({
    subId: "k-user-a-abc-def",
    platform: "zalo",
    userId: "user-a",
    merchant: "shopee",
    orderId: "big",
    orderAmount: 3_000_000,
    commissionAmount: 300_000,
    taxPercent: 0,
    platformFeePercent: 0,
    userSharePercent: 100,
    maxCommissionRatioPercent: 50,
    completedAt: todayVnIso(),
    holdConfig: { thresholdVnd: 100_000, holdDays: 7 },
  });
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 4_000 });

  const summary = s.getUserSummary("zalo", "user-a");
  assert.equal(summary.heldBalance, 300_000);
  assert.equal(summary.heldEntries.length, 1);
  assert.equal(summary.heldEntries[0].availableFrom, addDaysToVnIso(todayVnIso(), 7));
  assert.equal(summary.debtRemaining, 4_000);
  assert.equal(summary.grossAvailableBalance, 10_000);
  assert.equal(summary.availableBalance, 6_000);
});

test("listUsers tra debtRemaining/heldBalance va loai don bi giam khoi availableBalance", () => {
  const s = store();
  recordConfirmed(s, "order-1", 10_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 4_000 });
  const row = s.listUsers().find((u) => u.userId === "user-a");
  assert.equal(row?.debtRemaining, 4_000);
  assert.equal(row?.heldBalance, 0);
  assert.equal(row?.availableBalance, 6_000, "da tru no");
});

test("listUsers: pendingBalance/paidTotal cung doc tu withdrawal_requests (khop getUserSummary)", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 40_000 });
  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);

  let row = s.listUsers().find((u) => u.userId === "user-a");
  assert.equal(row?.pendingBalance, 60_000);

  s.markWithdrawalPaid(w.id, null);
  row = s.listUsers().find((u) => u.userId === "user-a");
  assert.equal(row?.paidTotal, 60_000);
  assert.equal(row?.pendingBalance, 0);
});

// ORDER BY cua SQL chi biet so GROSS; availableBalance tra ve la so da tru no, ma /admin/users hien
// "kha dung giam dan" - khong sap lai o JS thi user co no dung sai vi tri.
test("listUsers sap theo availableBalance DA TRU NO, khong theo so gross", () => {
  const s = store();
  // user-a: gross 100k, no 90k -> net 10k
  recordConfirmed(s, "order-a", 100_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "debt-a", amount: 90_000 });
  // user-b: gross 50k, khong no -> net 50k
  s.recordConversion({
    subId: "k-user-b-abc-def",
    platform: "zalo",
    userId: "user-b",
    merchant: "shopee",
    orderId: "order-b",
    orderAmount: 500_000,
    commissionAmount: 50_000,
    taxPercent: 0,
    platformFeePercent: 0,
    userSharePercent: 100,
    maxCommissionRatioPercent: 50,
    holdConfig: HOLD_OFF,
  });

  assert.deepEqual(
    s.listUsers().map((u) => u.userId),
    ["user-b", "user-a"],
    "user-b (50k net) phai dung TREN user-a (10k net) du gross cua a lon hon"
  );
});
