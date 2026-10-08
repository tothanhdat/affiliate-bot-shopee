import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";
import { DebtNotCoveredError, InsufficientBalanceError, WithdrawalNotCancellableError } from "../errors.js";
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

// MO HINH NO (2026-10-08, DOI theo yeu cau truc tiep cua user): Kha dung = GROSS, no DUNG RIENG.
// No KHONG bi tru vao Kha dung luc phat sinh - chi bi tru LUC YEU CAU RUT DUOC DUYET.
// Dieu kien rut: Kha dung >= max(nguong, no) - Kha dung < no thi CHUA cho rut.
//   W > no  -> amount = W - no, CHO admin duyet; duyet xong moi tru no.
//   W == no -> so phai chuyen = 0 -> TU DONG xac nhan ngay, no ve 0.

test("Kha dung KHONG tru no - no dung rieng", () => {
  const s = store();
  recordConfirmed(s, "order-1", 10_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 40_000 });
  assert.equal(s.getAvailableBalance("zalo", "user-a"), 10_000, "Kha dung la gross, khong bi tru no");
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 40_000);
});

test("Kha dung < no: CHUA cho rut du Kha dung da qua nguong, loi noi so con thieu = no - Kha dung", () => {
  const s = store();
  recordConfirmed(s, "order-1", 25_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 100_000 });
  assert.throws(
    () => s.requestWithdrawal("zalo", "user-a", 20_000, BANK),
    (err: unknown) =>
      err instanceof DebtNotCoveredError &&
      /Tích luỹ thêm 75\.000đ nữa để đủ điều kiện rút tiền\./.test(err.userMessage) &&
      !/tối thiểu/.test(err.userMessage)
  );
  assert.equal(s.listPendingWithdrawals().length, 0);
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 100_000, "no khong bi dong toi");
});

test("no < nguong va Kha dung < nguong: van bao theo NGUONG nhu cu", () => {
  const s = store();
  recordConfirmed(s, "order-1", 10_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 15_000 });
  assert.throws(() => s.requestWithdrawal("zalo", "user-a", 20_000, BANK), InsufficientBalanceError);
});

test("duoi nguong (gross < nguong) van khong rut duoc", () => {
  const s = store();
  recordConfirmed(s, "order-1", 10_000);
  assert.throws(() => s.requestWithdrawal("zalo", "user-a", 20_000, BANK), InsufficientBalanceError);
});

test("case 1 (W >= no): amount = W - no, CHO admin duyet, no CHUA bi tru", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 40_000 });

  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);
  assert.equal(w.status, "requested", "con tien phai chuyen -> cho admin duyet");
  assert.equal(w.amount, 60_000, "so admin PHAI chuyen = 100k - 40k");
  assert.equal(w.debtApplied, 40_000);
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 40_000, "chua duyet thi no CHUA bi tru");
});

test("case 1: admin duyet -> tru het no, entries 'paid', paidTotal = so THAT da chuyen", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 40_000 });
  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);

  s.markWithdrawalPaid(w.id, null);
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 0);
  assert.ok(s.getDebtByOrder("shopee", "old-order")?.settledAt);
  assert.equal(s.getEntryByOrderId("shopee", "order-1")?.status, "paid");
  assert.equal(s.getAvailableBalance("zalo", "user-a"), 0);
  assert.equal(s.getUserSummary("zalo", "user-a").paidTotal, 60_000);
});

// W == no thi so phai chuyen = 0 - bat admin duyet 1 lenh chuyen khoan 0d kem QR 0d la vo nghia,
// nen gop vao nhom tu dong xac nhan.
test("W == no: tu dong xac nhan, no ve 0", () => {
  const s = store();
  recordConfirmed(s, "order-1", 40_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 40_000 });

  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);
  assert.equal(w.status, "paid");
  assert.equal(w.amount, 0);
  assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 0);
  assert.ok(s.getDebtByOrder("shopee", "old-order")?.settledAt);
});

test("tru no uu tien no CU nhat truoc", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "debt-old", amount: 30_000 });
  s.recordPayoutDebt({ ...DEBT, orderId: "debt-new", amount: 50_000 });

  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);
  assert.equal(w.amount, 20_000, "100k - 80k");
  s.markWithdrawalPaid(w.id, null);
  assert.ok(s.getDebtByOrder("shopee", "debt-old")?.settledAt);
  assert.ok(s.getDebtByOrder("shopee", "debt-new")?.settledAt);
});

test("no da bi admin XOA khong bi tru vao lan rut", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  const debt = s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 40_000 });
  s.writeOffDebt(debt!.id);
  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);
  assert.equal(w.amount, 100_000);
  assert.equal(w.debtApplied, 0);
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
// Tien cua withdrawal doc tu withdrawal_requests (Task 8, sua theo mo hinh no 2026-10-08)
// ---------------------------------------------------------------------------

// Phia USER: "Dang cho rut" = so user YEU CAU rut (W = amount + debt_applied). No van hien rieng
// cho toi luc duyet - neu the nay hien W - no thi cung luc user thay "dang no D" ma tien cho rut
// lai DA tru D, doc ra nhu bi tru 2 lan.
test("pendingBalance = so user YEU CAU rut (W), khong phai so admin chuyen", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 40_000 });
  s.requestWithdrawal("zalo", "user-a", 20_000, BANK);

  const summary = s.getUserSummary("zalo", "user-a");
  assert.equal(summary.pendingBalance, 100_000);
  assert.equal(summary.debtRemaining, 40_000, "no van con nguyen cho toi luc duyet");
});

test("paidTotal = so tien THAT da chuyen (W - no), khop sao ke ngan hang", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 40_000 });
  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);
  s.markWithdrawalPaid(w.id, null);
  assert.equal(s.getUserSummary("zalo", "user-a").paidTotal, 60_000);
});

test("lan rut tu dong tru no (W == no) KHONG cong vao paidTotal - khong co dong nao vao tai khoan", () => {
  const s = store();
  recordConfirmed(s, "order-1", 50_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 50_000 });
  s.requestWithdrawal("zalo", "user-a", 20_000, BANK);
  assert.equal(s.getUserSummary("zalo", "user-a").paidTotal, 0);
});

test("getUserSummary: availableBalance = gross, debtRemaining/debts rieng, heldBalance", () => {
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
  assert.equal(summary.availableBalance, 10_000, "KHONG tru no");
  assert.equal(summary.debtRemaining, 4_000);
  assert.deepEqual(summary.debts.map((d) => d.orderId), ["old-order"]);
  assert.equal(summary.heldBalance, 300_000);
  assert.equal(summary.heldEntries[0].availableFrom, addDaysToVnIso(todayVnIso(), 7));
});

test("listUsers: Kha dung = gross, no rieng, pending = W, paid = so that chuyen", () => {
  const s = store();
  recordConfirmed(s, "order-1", 100_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "old-order", amount: 40_000 });

  let row = s.listUsers().find((u) => u.userId === "user-a");
  assert.equal(row?.availableBalance, 100_000);
  assert.equal(row?.debtRemaining, 40_000);

  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);
  row = s.listUsers().find((u) => u.userId === "user-a");
  assert.equal(row?.pendingBalance, 100_000);

  s.markWithdrawalPaid(w.id, null);
  row = s.listUsers().find((u) => u.userId === "user-a");
  assert.equal(row?.paidTotal, 60_000);
  assert.equal(row?.pendingBalance, 0);
  assert.equal(row?.debtRemaining, 0);
});

test("listUsers sap theo Kha dung giam dan", () => {
  const s = store();
  recordConfirmed(s, "order-a", 100_000);
  s.recordPayoutDebt({ ...DEBT, orderId: "debt-a", amount: 90_000 });
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
  assert.deepEqual(s.listUsers().map((u) => u.userId), ["user-a", "user-b"], "100k > 50k, no khong tinh vao");
});
