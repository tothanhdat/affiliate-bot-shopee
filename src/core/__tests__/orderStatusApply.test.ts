import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";
import type { MerchantId } from "../merchants.js";
import { applyOrderStatusToLedger, type OrderStatusApplyInput, type OrderStatusOutcome } from "../orderStatusApply.js";
import { addDaysToVnIso, todayVnIso } from "../vietnamDate.js";

/**
 * Test TRUC TIEP lop ap ledger dung chung. Chay moi ca voi CA HAI merchant: lop nay khong duoc biet
 * san nao (neu co nhanh nao rieng cho "shopee" thi test o day phai vo). Xem spec muc 4.
 */
const TODAY = todayVnIso();
const YESTERDAY = addDaysToVnIso(TODAY, -1);
const BANK = { bankName: "Vietcombank", bankAccountNumber: "0123456789", bankAccountHolder: "Nguyen Van A" };

/** user nhan 100% de hoa hong trong input chinh la user_share - de doi chieu voi nguong 100.000. */
const CONFIG = {
  taxPercent: 0,
  platformFeePercent: 0,
  userSharePercent: 100,
  maxCommissionRatioPercent: 1000,
  holdConfig: { thresholdVnd: 100_000, holdDays: 7, smallHoldDays: 1 },
};

function input(merchant: MerchantId, over: Partial<OrderStatusApplyInput> = {}): OrderStatusApplyInput {
  return {
    orderId: "O-1",
    targetStatus: "confirmed",
    subId: "k-user-a-abc-def",
    requestEntry: { platform: "zalo", userId: "user-a", merchant },
    orderAmount: 2_000_000,
    commissionAmount: 50_000,
    productName: "San pham test",
    orderDate: null,
    orderTime: null,
    completedAt: YESTERDAY,
    reverseReason: "ly do test",
    notes: { confirmed: "ghi chu confirmed", pending: "ghi chu pending" },
    sourceLabel: "Nguon test",
    confirmedClaim: 'Nguon test ghi "Hoan thanh"',
    ...over,
  };
}

const apply = (s: LedgerStore, i: OrderStatusApplyInput): OrderStatusOutcome[] =>
  applyOrderStatusToLedger(s, i, CONFIG, TODAY);
const kinds = (o: OrderStatusOutcome[]): string[] => o.map((x) => x.kind);

for (const merchant of ["shopee", "tiktokshop"] as const) {
  test(`[${merchant}] don nho da giao tu hom qua -> confirmed-new, khong bi giam`, () => {
    const s = new LedgerStore(":memory:");
    try {
      const out = apply(s, input(merchant));
      assert.deepEqual(kinds(out), ["confirmed-new"]);
      const o = out[0] as Extract<OrderStatusOutcome, { kind: "confirmed-new" }>;
      assert.equal(o.newOrder, true);
      assert.equal(o.wasPending, false);
      assert.equal(o.held, false);
      assert.equal(s.getEntryByOrderId(merchant, "O-1")?.status, "confirmed");
    } finally {
      s.close();
    }
  });

  test(`[${merchant}] don TO -> confirmed-new va held = true (available_from o tuong lai)`, () => {
    const s = new LedgerStore(":memory:");
    try {
      const out = apply(s, input(merchant, { commissionAmount: 150_000, completedAt: TODAY }));
      const o = out[0] as Extract<OrderStatusOutcome, { kind: "confirmed-new" }>;
      assert.equal(o.kind, "confirmed-new");
      assert.equal(o.held, true);
      assert.equal(s.getEntryByOrderId(merchant, "O-1")?.availableFrom, addDaysToVnIso(TODAY, 7));
    } finally {
      s.close();
    }
  });

  test(`[${merchant}] don nho giao HOM NAY -> small-hold-deferred, entry van pending`, () => {
    const s = new LedgerStore(":memory:");
    try {
      const out = apply(s, input(merchant, { completedAt: TODAY }));
      assert.deepEqual(out, [{ kind: "small-hold-deferred", newOrder: true }]);
      assert.equal(s.getEntryByOrderId(merchant, "O-1")?.status, "pending");
    } finally {
      s.close();
    }
  });

  test(`[${merchant}] ap cung mot don confirmed 2 lan -> lan 2 la confirmed-duplicate`, () => {
    const s = new LedgerStore(":memory:");
    try {
      apply(s, input(merchant));
      assert.deepEqual(kinds(apply(s, input(merchant))), ["confirmed-duplicate"]);
    } finally {
      s.close();
    }
  });

  test(`[${merchant}] pending-new roi pending-updated`, () => {
    const s = new LedgerStore(":memory:");
    try {
      assert.deepEqual(kinds(apply(s, input(merchant, { targetStatus: "pending", completedAt: null }))), ["pending-new"]);
      assert.deepEqual(
        kinds(apply(s, input(merchant, { targetStatus: "pending", completedAt: null, commissionAmount: 60_000 }))),
        ["pending-updated"]
      );
      assert.equal(s.getEntryByOrderId(merchant, "O-1")?.commissionAmount, 60_000);
    } finally {
      s.close();
    }
  });

  test(`[${merchant}] pending -> confirmed: wasPending = true, khong phai don moi`, () => {
    const s = new LedgerStore(":memory:");
    try {
      apply(s, input(merchant, { targetStatus: "pending", completedAt: null }));
      const out = apply(s, input(merchant));
      const o = out[0] as Extract<OrderStatusOutcome, { kind: "confirmed-new" }>;
      assert.equal(o.kind, "confirmed-new");
      assert.equal(o.wasPending, true);
      assert.equal(o.newOrder, false);
    } finally {
      s.close();
    }
  });

  test(`[${merchant}] huy don CHUA TUNG THAY -> reversed-unseen, KHONG tao entry`, () => {
    const s = new LedgerStore(":memory:");
    try {
      assert.deepEqual(kinds(apply(s, input(merchant, { targetStatus: "reversed" }))), ["reversed-unseen"]);
      assert.equal(s.getEntryByOrderId(merchant, "O-1"), null);
    } finally {
      s.close();
    }
  });

  test(`[${merchant}] pending bi huy -> reversed tu pending; huy lan nua khong lam gi`, () => {
    const s = new LedgerStore(":memory:");
    try {
      apply(s, input(merchant, { targetStatus: "pending", completedAt: null }));
      assert.deepEqual(apply(s, input(merchant, { targetStatus: "reversed" })), [{ kind: "reversed", from: "pending" }]);
      assert.equal(s.getEntryByOrderId(merchant, "O-1")?.status, "reversed");
      assert.deepEqual(apply(s, input(merchant, { targetStatus: "reversed" })), []);
    } finally {
      s.close();
    }
  });

  test(`[${merchant}] confirmed chua rut bi huy -> thu hoi TRON, khong no`, () => {
    const s = new LedgerStore(":memory:");
    try {
      apply(s, input(merchant));
      assert.deepEqual(apply(s, input(merchant, { targetStatus: "reversed" })), [{ kind: "reversed", from: "confirmed" }]);
      assert.equal(s.getEntryByOrderId(merchant, "O-1")?.status, "reversed");
      assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 0);
    } finally {
      s.close();
    }
  });

  test(`[${merchant}] confirmed dang nam trong yeu cau rut bi huy -> tu huy yeu cau roi thu hoi`, () => {
    const s = new LedgerStore(":memory:");
    try {
      apply(s, input(merchant));
      const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);
      const out = apply(s, input(merchant, { targetStatus: "reversed" }));
      assert.deepEqual(kinds(out), ["withdrawal-cancelled", "reversed"]);
      const c = out[0] as Extract<OrderStatusOutcome, { kind: "withdrawal-cancelled" }>;
      assert.equal(c.withdrawalId, w.id);
      assert.equal(c.amount, 50_000);
      assert.equal(s.getEntryByOrderId(merchant, "O-1")?.status, "reversed");
    } finally {
      s.close();
    }
  });

  test(`[${merchant}] paid bi huy -> ghi NO, entry van la paid`, () => {
    const s = new LedgerStore(":memory:");
    try {
      apply(s, input(merchant));
      const w = s.requestWithdrawal("zalo", "user-a", 20_000, BANK);
      s.markWithdrawalPaid(w.id, null);
      const out = apply(s, input(merchant, { targetStatus: "reversed" }));
      assert.deepEqual(out, [
        { kind: "debt-created", platform: "zalo", userId: "user-a", orderId: "O-1", amount: 50_000 },
      ]);
      assert.equal(s.getEntryByOrderId(merchant, "O-1")?.status, "paid");
      assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 50_000);
      // Nguon liet ke LAI don huy o moi lan dong bo: lan 2 KHONG duoc nhan doi no.
      assert.deepEqual(apply(s, input(merchant, { targetStatus: "reversed" })), []);
      assert.equal(s.getOutstandingDebtTotal("zalo", "user-a"), 50_000);
    } finally {
      s.close();
    }
  });

  test(`[${merchant}] nguon bao confirmed nhung entry da reversed -> warning, KHONG ghi de`, () => {
    const s = new LedgerStore(":memory:");
    try {
      apply(s, input(merchant, { targetStatus: "pending", completedAt: null }));
      apply(s, input(merchant, { targetStatus: "reversed" }));
      const out = apply(s, input(merchant));
      assert.equal(out.length, 1);
      assert.equal(out[0].kind, "warning");
      assert.match((out[0] as { message: string }).message, /Nguon test ghi "Hoan thanh"/);
      assert.equal(s.getEntryByOrderId(merchant, "O-1")?.status, "reversed");
    } finally {
      s.close();
    }
  });

  test(`[${merchant}] pending bi admin khoa hoa hong + nguon bao so khac -> warning co sourceLabel, giu so da khoa`, () => {
    const s = new LedgerStore(":memory:");
    try {
      apply(s, input(merchant, { targetStatus: "pending", completedAt: null }));
      const e = s.getEntryByOrderId(merchant, "O-1")!;
      s.overrideCommissionAmount(e.id, {
        commissionAmount: 70_000,
        fallbackPercents: { taxPercent: 0, platformFeePercent: 0, userSharePercent: 100 },
        maxCommissionRatioPercent: 1000,
      });
      const out = apply(s, input(merchant, { targetStatus: "pending", completedAt: null, commissionAmount: 55_000 }));
      assert.ok(out.some((o) => o.kind === "warning" && /Nguon test bao hoa hong/.test(o.message)));
      assert.equal(s.getEntryByOrderId(merchant, "O-1")?.commissionAmount, 70_000);
    } finally {
      s.close();
    }
  });
}
