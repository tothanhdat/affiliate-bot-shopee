import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";
import { EntryNotPendingError, ImplausibleCommissionAmountError } from "../errors.js";

/**
 * Admin sua tay hoa hong goc cua don "pending" (2026-10-10): tien khach/chu bot tinh lai theo ty le
 * DA CHOT cua don, va so da sua bi KHOA - import bao cao Shopee sau do khong duoc ghi de.
 */

const RATES_AT_RECORD = { taxPercent: 10, platformFeePercent: 1, userSharePercent: 80 };
/** Ty le admin doi sang sau do - khong duoc anh huong don da ghi, ke ca khi sua tay. */
const RATES_AFTER_CHANGE = { taxPercent: 50, platformFeePercent: 20, userSharePercent: 10 };

function record(store: LedgerStore, status: "pending" | "confirmed" = "pending", orderId = "order-1") {
  return store.recordConversion({
    subId: "k-user-a-abc123-def",
    platform: "zalo",
    userId: "user-a",
    merchant: "shopee",
    orderId,
    orderAmount: 1_000_000,
    commissionAmount: 100_000,
    ...RATES_AT_RECORD,
    maxCommissionRatioPercent: 1000,
    holdConfig: { thresholdVnd: 0, holdDays: 0 },
    status,
  });
}

const overrideInput = (commissionAmount: number) => ({
  commissionAmount,
  fallbackPercents: RATES_AFTER_CHANGE,
  maxCommissionRatioPercent: 1000,
});

test("don moi ghi chua bi khoa", () => {
  const store = new LedgerStore(":memory:");
  try {
    assert.equal(record(store).commissionOverriddenAt, null);
  } finally {
    store.close();
  }
});

test("overrideCommissionAmount tinh lai tien khach + chu bot theo ty le DA CHOT", () => {
  const store = new LedgerStore(":memory:");
  try {
    const pending = record(store);
    const updated = store.overrideCommissionAmount(pending.id, overrideInput(200_000));

    // 10/1/80: thue 20.000 -> 180.000 -> phi 1.800 -> 178.200 -> khach 142.560 -> chu bot 35.640.
    assert.equal(updated.commissionAmount, 200_000);
    assert.equal(updated.taxAmount, 20_000);
    assert.equal(updated.platformFeeAmount, 1_800);
    assert.equal(updated.afterTaxAmount, 178_200);
    assert.equal(updated.userShareAmount, 142_560);
    assert.equal(updated.afterTaxAmount - updated.userShareAmount, 35_640);
    assert.equal(updated.userSharePercent, 80);
    assert.equal(updated.status, "pending");
    assert.notEqual(updated.commissionOverriddenAt, null);

    // Doc lai tu DB, khong chi tin gia tri tra ve.
    const stored = store.getEntryById(pending.id)!;
    assert.equal(stored.commissionAmount, 200_000);
    assert.equal(stored.userShareAmount, 142_560);
    assert.notEqual(stored.commissionOverriddenAt, null);
  } finally {
    store.close();
  }
});

test("overrideCommissionAmount cho phep 0 (gia tri that)", () => {
  const store = new LedgerStore(":memory:");
  try {
    const pending = record(store);
    const updated = store.overrideCommissionAmount(pending.id, overrideInput(0));
    assert.equal(updated.commissionAmount, 0);
    assert.equal(updated.userShareAmount, 0);
  } finally {
    store.close();
  }
});

test("overrideCommissionAmount tu choi don khong con pending", () => {
  const store = new LedgerStore(":memory:");
  try {
    const confirmed = record(store, "confirmed");
    assert.throws(() => store.overrideCommissionAmount(confirmed.id, overrideInput(5)), EntryNotPendingError);

    const toReverse = record(store, "pending", "order-2");
    store.reverseCommissionEntry(toReverse.id, "test");
    assert.throws(() => store.overrideCommissionAmount(toReverse.id, overrideInput(5)), EntryNotPendingError);
  } finally {
    store.close();
  }
});

test("overrideCommissionAmount tu choi so vo ly (am, NaN, vuot tran ty le)", () => {
  const store = new LedgerStore(":memory:");
  try {
    const pending = record(store);
    assert.throws(() => store.overrideCommissionAmount(pending.id, overrideInput(-1)));
    assert.throws(() => store.overrideCommissionAmount(pending.id, overrideInput(Number.NaN)));
    assert.throws(
      () => store.overrideCommissionAmount(pending.id, { ...overrideInput(20_000_000), maxCommissionRatioPercent: 50 }),
      ImplausibleCommissionAmountError
    );
    // Loi thi khong duoc de lai khoa / doi so.
    const stored = store.getEntryById(pending.id)!;
    assert.equal(stored.commissionAmount, 100_000);
    assert.equal(stored.commissionOverriddenAt, null);
  } finally {
    store.close();
  }
});

test("updatePendingEntry KHONG ghi de hoa hong da khoa nhung van cap nhat so lieu khac", () => {
  const store = new LedgerStore(":memory:");
  try {
    const pending = record(store);
    store.overrideCommissionAmount(pending.id, overrideInput(200_000));

    const updated = store.updatePendingEntry(pending.id, {
      orderAmount: 2_000_000,
      commissionAmount: 100_000, // Shopee bao so khac so da khoa
      productName: "San pham moi",
      fallbackPercents: RATES_AFTER_CHANGE,
      maxCommissionRatioPercent: 1000,
    });

    assert.equal(updated.commissionAmount, 200_000);
    assert.equal(updated.userShareAmount, 142_560);
    assert.equal(updated.orderAmount, 2_000_000);
    assert.equal(updated.productName, "San pham moi");
    assert.notEqual(updated.commissionOverriddenAt, null);
    assert.equal(store.getEntryById(pending.id)!.commissionAmount, 200_000);
  } finally {
    store.close();
  }
});

test("confirmPendingEntry KHONG ghi de hoa hong da khoa, van chuyen sang confirmed", () => {
  const store = new LedgerStore(":memory:");
  try {
    const pending = record(store);
    store.overrideCommissionAmount(pending.id, overrideInput(200_000));

    const confirmed = store.confirmPendingEntry(pending.id, {
      orderAmount: 1_000_000,
      commissionAmount: 100_000,
      fallbackPercents: RATES_AFTER_CHANGE,
      maxCommissionRatioPercent: 1000,
      completedAt: "2026-10-10",
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
    });

    assert.equal(confirmed.status, "confirmed");
    assert.equal(confirmed.commissionAmount, 200_000);
    assert.equal(confirmed.userShareAmount, 142_560);
    assert.equal(confirmed.completedAt, "2026-10-10");
  } finally {
    store.close();
  }
});

test("clearCommissionOverride mo khoa: lan cap nhat sau lai theo so cua Shopee", () => {
  const store = new LedgerStore(":memory:");
  try {
    const pending = record(store);
    store.overrideCommissionAmount(pending.id, overrideInput(200_000));
    const cleared = store.clearCommissionOverride(pending.id);
    assert.equal(cleared.commissionOverriddenAt, null);
    // Chi mo khoa, khong tu doi so tien.
    assert.equal(cleared.commissionAmount, 200_000);

    const updated = store.updatePendingEntry(pending.id, {
      orderAmount: 1_000_000,
      commissionAmount: 100_000,
      fallbackPercents: RATES_AFTER_CHANGE,
      maxCommissionRatioPercent: 1000,
    });
    assert.equal(updated.commissionAmount, 100_000);
    assert.equal(updated.userShareAmount, 71_280);
  } finally {
    store.close();
  }
});

test("clearCommissionOverride chi cho don pending", () => {
  const store = new LedgerStore(":memory:");
  try {
    const confirmed = record(store, "confirmed");
    assert.throws(() => store.clearCommissionOverride(confirmed.id), EntryNotPendingError);
  } finally {
    store.close();
  }
});
