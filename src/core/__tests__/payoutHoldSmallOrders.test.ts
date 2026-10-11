import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";
import { addDaysToVnIso, todayVnIso } from "../vietnamDate.js";

/**
 * Don NHO cho them vai ngay o trang thai "pending" truoc khi vao Kha dung (2026-10-11, yeu cau truc
 * tiep cua user) - xem doc comment dau payoutHold.ts ve ly do khong dung duong "Dang tam giu".
 *
 * Ngay trong test tinh theo HOM NAY chu khong hardcode: cau hoi "don nay toi han chua" so
 * available_from voi todayVnIso() that, nen mot ngay co dinh se tu doi y nghia khi thoi gian troi.
 */
const TODAY = todayVnIso();
const YESTERDAY = addDaysToVnIso(TODAY, -1);
const TOMORROW = addDaysToVnIso(TODAY, 1);

/** Don to giam 7 ngay, don nho cho 1 ngay. */
const HOLD = { thresholdVnd: 100_000, holdDays: 7, smallHoldDays: 1 };
const PERCENTS = { taxPercent: 0, platformFeePercent: 0, userSharePercent: 100 };

function store() {
  return new LedgerStore(":memory:");
}

function record(
  s: LedgerStore,
  overrides: Partial<{
    orderId: string;
    commissionAmount: number;
    completedAt: string | null;
    holdConfig: { thresholdVnd: number; holdDays: number; smallHoldDays?: number };
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
    commissionAmount: overrides.commissionAmount ?? 50_000,
    ...PERCENTS,
    maxCommissionRatioPercent: 50,
    completedAt: overrides.completedAt === undefined ? TODAY : overrides.completedAt,
    holdConfig: overrides.holdConfig ?? HOLD,
    status: overrides.status,
  });
}

function confirm(
  s: LedgerStore,
  entryId: string,
  overrides: Partial<{
    commissionAmount: number;
    completedAt: string | null;
    holdConfig: { thresholdVnd: number; holdDays: number; smallHoldDays?: number };
  }> = {}
) {
  return s.confirmPendingEntry(entryId, {
    orderAmount: 2_000_000,
    commissionAmount: overrides.commissionAmount ?? 50_000,
    fallbackPercents: PERCENTS,
    maxCommissionRatioPercent: 50,
    completedAt: overrides.completedAt === undefined ? TODAY : overrides.completedAt,
    holdConfig: overrides.holdConfig ?? HOLD,
  });
}

test("recordConversion: don nho vua 'Hoan thanh' -> giu pending + chot ngay vao Kha dung", () => {
  const s = store();
  const entry = record(s);
  assert.equal(entry.status, "pending");
  assert.equal(entry.availableFrom, TOMORROW);
});

// Day la ly do ton tai cua ca tinh nang: user KHONG duoc thay the "Dang tam giu" cho don nho.
test("don nho dang cho: tien khong nam o Kha dung VA khong nam o Dang tam giu", () => {
  const s = store();
  record(s);
  assert.equal(s.getAvailableBalance("zalo", "user-a"), 0);
  assert.equal(s.getHeldBalance("zalo", "user-a"), 0);
  assert.deepEqual(s.getHeldEntries("zalo", "user-a"), []);
});

test("don nho giao hom qua, cho 1 ngay -> toi han ngay, vao Kha dung luon", () => {
  const s = store();
  const entry = record(s, { completedAt: YESTERDAY });
  assert.equal(entry.status, "confirmed");
  assert.equal(entry.availableFrom, TODAY);
  assert.equal(s.getAvailableBalance("zalo", "user-a"), 50_000);
  // Don da toi han thi KHONG duoc dem vao "Dang tam giu" du available_from khac null.
  assert.equal(s.getHeldBalance("zalo", "user-a"), 0);
});

test("don to: van confirmed ngay + hien 'Dang tam giu' nhu truoc", () => {
  const s = store();
  const entry = record(s, { commissionAmount: 500_000 });
  assert.equal(entry.status, "confirmed");
  assert.equal(entry.availableFrom, addDaysToVnIso(TODAY, 7));
  assert.equal(s.getHeldBalance("zalo", "user-a"), 500_000);
});

test("admin ghi tay don 'pending' -> khong chot ngay nao (chua biet ngay giao hang)", () => {
  const s = store();
  const entry = record(s, { status: "pending", completedAt: null });
  assert.equal(entry.status, "pending");
  assert.equal(entry.availableFrom, null);
});

test("confirmPendingEntry: don nho vua 'Hoan thanh' -> van pending + chot ngay", () => {
  const s = store();
  const pending = record(s, { status: "pending", completedAt: null });
  const entry = confirm(s, pending.id);
  assert.equal(entry.status, "pending");
  assert.equal(entry.availableFrom, TOMORROW);
  assert.equal(s.getAvailableBalance("zalo", "user-a"), 0);
});

// Rang buoc user yeu cau truc tiep: doi setting KHONG duoc dich ngay cua don da chot.
test("admin nang so ngay cho len 30 -> don da chot hom truoc GIU nguyen ngay cu", () => {
  const s = store();
  const pending = record(s, { status: "pending", completedAt: null });
  confirm(s, pending.id);
  const again = confirm(s, pending.id, {
    holdConfig: { thresholdVnd: 100_000, holdDays: 7, smallHoldDays: 30 },
  });
  assert.equal(again.status, "pending");
  assert.equal(again.availableFrom, TOMORROW);
});

test("confirmPendingEntry: don nho giao hom qua -> confirmed, tien vao Kha dung", () => {
  const s = store();
  const pending = record(s, { status: "pending", completedAt: null });
  const entry = confirm(s, pending.id, { completedAt: YESTERDAY });
  assert.equal(entry.status, "confirmed");
  assert.equal(s.getAvailableBalance("zalo", "user-a"), 50_000);
});

test("confirmPendingEntry: don to -> confirmed + giam 7 ngay (hanh vi cu)", () => {
  const s = store();
  const pending = record(s, { status: "pending", completedAt: null });
  const entry = confirm(s, pending.id, { commissionAmount: 500_000 });
  assert.equal(entry.status, "confirmed");
  assert.equal(entry.availableFrom, addDaysToVnIso(TODAY, 7));
});

test("smallHoldDays = 0 -> don nho confirmed ngay (hanh vi truoc 2026-10-11)", () => {
  const s = store();
  const entry = record(s, { holdConfig: { thresholdVnd: 100_000, holdDays: 7, smallHoldDays: 0 } });
  assert.equal(entry.status, "confirmed");
  assert.equal(entry.availableFrom, null);
  assert.equal(s.getAvailableBalance("zalo", "user-a"), 50_000);
});

// Ngay da chot tinh tren SO TIEN luc do - admin sua hoa hong len tren nguong thi ke hoach cu khong
// con dung (don to phai giam 7 ngay, khong phai 1 ngay), nen phai xoa de lan import sau chot lai.
test("admin sua tay hoa hong -> xoa ngay da chot de tinh lai theo so moi", () => {
  const s = store();
  const pending = record(s);
  assert.equal(pending.availableFrom, TOMORROW);
  const edited = s.overrideCommissionAmount(pending.id, {
    commissionAmount: 500_000,
    fallbackPercents: PERCENTS,
    maxCommissionRatioPercent: 50,
  });
  assert.equal(edited.availableFrom, null);
  const confirmed = confirm(s, pending.id, { commissionAmount: 500_000 });
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.availableFrom, addDaysToVnIso(TODAY, 7));
});

test("rut tien: don nho dang cho khong bi gan vao yeu cau rut", () => {
  const s = store();
  record(s, { orderId: "order-cho", commissionAmount: 50_000 });
  record(s, { orderId: "order-kha-dung", commissionAmount: 60_000, completedAt: YESTERDAY });
  const req = s.requestWithdrawal("zalo", "user-a", 20_000, {
    bankName: "Vietcombank",
    bankAccountNumber: "0123456789",
    bankAccountHolder: "Nguyen Van A",
  });
  assert.equal(req.amount, 60_000);
  const entries = s.listEntriesByWithdrawal(req.id);
  assert.deepEqual(
    entries.map((e) => e.orderId),
    ["order-kha-dung"]
  );
});
