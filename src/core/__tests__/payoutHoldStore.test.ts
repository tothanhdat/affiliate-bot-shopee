import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";
import { addDaysToVnIso, todayVnIso } from "../vietnamDate.js";

// Ngay trong test phai TINH THEO HOM NAY, khong hardcode: cau hoi "don nay da mo khoa chua" so
// available_from voi todayVnIso() that, nen mot ngay co dinh se tu doi y nghia khi thoi gian troi
// (vd "2026-10-01" + 7 ngay roi dung bang hom nay thi don het bi giam, test xanh/do theo ngay chay).
const TODAY = todayVnIso();
/** Giao hang HOM NAY -> mo khoa sau 7 ngay -> chac chan con bi giam. */
const COMPLETED_TODAY = TODAY;
/** Giao hang tu rat lau -> ngay mo khoa da qua -> chac chan da kha dung. */
const COMPLETED_LONG_AGO = "2020-01-01";

const HOLD_ON = { thresholdVnd: 100_000, holdDays: 7 };
const HOLD_OFF = { thresholdVnd: 0, holdDays: 0 };
const BANK = { bankName: "Vietcombank", bankAccountNumber: "0123456789", bankAccountHolder: "Nguyen Van A" };

function store() {
  return new LedgerStore(":memory:");
}

function record(
  s: LedgerStore,
  overrides: Partial<{
    orderId: string;
    commissionAmount: number;
    completedAt: string | null;
    holdConfig: { thresholdVnd: number; holdDays: number };
    status: "pending" | "confirmed";
  }> = {}
) {
  return s.recordConversion({
    subId: "k-user-a-abc-def",
    platform: "zalo",
    userId: "user-a",
    merchant: "shopee",
    orderId: overrides.orderId ?? "order-1",
    orderAmount: 2_000_000,
    commissionAmount: overrides.commissionAmount ?? 200_000,
    taxPercent: 0,
    platformFeePercent: 0,
    userSharePercent: 100,
    maxCommissionRatioPercent: 50,
    completedAt: overrides.completedAt === undefined ? COMPLETED_TODAY : overrides.completedAt,
    holdConfig: overrides.holdConfig ?? HOLD_ON,
    status: overrides.status,
  });
}

test("recordConversion: don to -> available_from = completedAt + holdDays", () => {
  const s = store();
  const entry = record(s);
  assert.equal(entry.completedAt, COMPLETED_TODAY);
  assert.equal(entry.availableFrom, addDaysToVnIso(COMPLETED_TODAY, 7));
});

test("recordConversion: don nho -> available_from null", () => {
  const s = store();
  const entry = record(s, { commissionAmount: 50_000 });
  assert.equal(entry.availableFrom, null);
});

test("recordConversion: don pending chua co available_from (chua co tien kha dung)", () => {
  const s = store();
  const entry = record(s, { status: "pending" });
  assert.equal(entry.availableFrom, null);
  // completedAt van duoc luu de con dung luc duyet
  assert.equal(entry.completedAt, COMPLETED_TODAY);
});

test("entry dang bi giam KHONG vao getAvailableBalance, co trong getHeldBalance", () => {
  const s = store();
  record(s);
  assert.equal(s.getAvailableBalance("zalo", "user-a"), 0);
  assert.equal(s.getHeldBalance("zalo", "user-a"), 200_000);
});

test("entry da qua ngay mo khoa thi vao getAvailableBalance", () => {
  const s = store();
  record(s, { completedAt: COMPLETED_LONG_AGO });
  assert.equal(s.getAvailableBalance("zalo", "user-a"), 200_000);
  assert.equal(s.getHeldBalance("zalo", "user-a"), 0);
});

test("entry cu (available_from NULL) kha dung ngay - KHONG giam hoi to", () => {
  const s = store();
  record(s, { holdConfig: HOLD_OFF });
  assert.equal(s.getAvailableBalance("zalo", "user-a"), 200_000);
  assert.equal(s.getHeldBalance("zalo", "user-a"), 0);
});

test("getHeldEntries tra ngay mo khoa cua TUNG don, sap theo ngay mo som nhat", () => {
  const s = store();
  const early = TODAY;
  const late = addDaysToVnIso(TODAY, 4);
  record(s, { orderId: "late", completedAt: late });
  record(s, { orderId: "early", completedAt: early });
  const held = s.getHeldEntries("zalo", "user-a");
  assert.deepEqual(
    held.map((e) => [e.orderId, e.availableFrom]),
    [
      ["early", addDaysToVnIso(early, 7)],
      ["late", addDaysToVnIso(late, 7)],
    ]
  );
});

test("confirmPendingEntry: chot available_from luc duyet, lay completedAt luc duyet", () => {
  const s = store();
  const pending = record(s, { status: "pending", completedAt: null });
  assert.equal(pending.availableFrom, null, "pending chua co ngay mo khoa");

  const confirmed = s.confirmPendingEntry(pending.id, {
    orderAmount: 2_000_000,
    commissionAmount: 200_000,
    fallbackPercents: { taxPercent: 0, platformFeePercent: 0, userSharePercent: 100 },
    maxCommissionRatioPercent: 50,
    completedAt: COMPLETED_TODAY,
    holdConfig: HOLD_ON,
  });
  assert.equal(confirmed.completedAt, COMPLETED_TODAY);
  assert.equal(confirmed.availableFrom, addDaysToVnIso(COMPLETED_TODAY, 7));

  // Doc lai tu DB (khong tin object tra ve) - cot phai duoc ghi that.
  assert.equal(s.getEntryById(pending.id)?.availableFrom, addDaysToVnIso(COMPLETED_TODAY, 7));
});

// updatePendingEntry chi refresh so lieu, entry VAN la pending nen khong co tien kha dung -> khong
// duoc ghi available_from. Ghi o day se lam don pending "hua" mot ngay mo khoa roi den luc duyet lai
// tinh mot ngay khac.
test("updatePendingEntry KHONG ghi available_from", () => {
  const s = store();
  const pending = record(s, { status: "pending", completedAt: null });
  s.updatePendingEntry(pending.id, {
    orderAmount: 3_000_000,
    commissionAmount: 300_000,
    fallbackPercents: { taxPercent: 0, platformFeePercent: 0, userSharePercent: 100 },
    maxCommissionRatioPercent: 50,
  });
  assert.equal(s.getEntryById(pending.id)?.availableFrom, null);
});

test("requestWithdrawal KHONG hut don dang bi giam vao yeu cau rut", () => {
  const s = store();
  record(s, { orderId: "small", commissionAmount: 50_000 });
  record(s, { orderId: "big", commissionAmount: 300_000 });

  const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);

  assert.equal(w.amount, 50_000, "chi rut duoc don da mo khoa");
  assert.equal(s.getHeldBalance("zalo", "user-a"), 300_000, "don to con nguyen trong vung giam");

  const big = s.listCommissionEntries({ userId: "user-a" }).find((e) => e.orderId === "big");
  assert.equal(big?.withdrawalId, null, "don bi giam khong duoc gan withdrawal_id");
});
