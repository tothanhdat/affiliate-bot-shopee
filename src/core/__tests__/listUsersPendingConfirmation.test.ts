import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";

/**
 * Cot "Cho xac nhan" cua /admin/users (2026-10-10): tong phan user se nhan cua cac don dang pending.
 * KHAC "Dang cho rut" (pendingBalance) - cai do la tien user DA bam rut va dang cho admin chuyen khoan.
 */

const HOLD_OFF = { thresholdVnd: 0, holdDays: 0 };

function record(
  s: LedgerStore,
  orderId: string,
  userId: string,
  commissionAmount: number,
  status: "pending" | "confirmed"
) {
  return s.recordConversion({
    subId: `k-${userId}-abc-def`,
    platform: "zalo",
    userId,
    merchant: "shopee",
    orderId,
    orderAmount: commissionAmount * 10,
    commissionAmount,
    taxPercent: 0,
    platformFeePercent: 0,
    userSharePercent: 80,
    maxCommissionRatioPercent: 50,
    holdConfig: HOLD_OFF,
    status,
  });
}

const find = (s: LedgerStore, userId: string) => s.listUsers().find((u) => u.userId === userId)!;

test("listUsers: pendingConfirmationBalance cong user_share cua cac don pending cua DUNG user", () => {
  const s = new LedgerStore(":memory:");
  try {
    record(s, "p1", "user-a", 10_000, "pending"); // 8.000
    record(s, "p2", "user-a", 5_000, "pending"); // 4.000
    record(s, "p3", "user-b", 20_000, "pending"); // 16.000
    assert.equal(find(s, "user-a").pendingConfirmationBalance, 12_000);
    assert.equal(find(s, "user-b").pendingConfirmationBalance, 16_000);
  } finally {
    s.close();
  }
});

test("listUsers: don Kha dung va don da huy KHONG tinh vao Cho xac nhan", () => {
  const s = new LedgerStore(":memory:");
  try {
    record(s, "c1", "user-a", 10_000, "confirmed");
    const toReverse = record(s, "r1", "user-a", 50_000, "pending");
    s.reverseCommissionEntry(toReverse.id, "test");
    record(s, "p1", "user-a", 5_000, "pending"); // 4.000
    const u = find(s, "user-a");
    assert.equal(u.pendingConfirmationBalance, 4_000);
    assert.equal(u.availableBalance, 8_000, "don confirmed van la Kha dung, khong bi lan");
  } finally {
    s.close();
  }
});

test("listUsers: user khong co don pending -> 0, khong phai null/NaN", () => {
  const s = new LedgerStore(":memory:");
  try {
    record(s, "c1", "user-a", 10_000, "confirmed");
    assert.equal(find(s, "user-a").pendingConfirmationBalance, 0);
  } finally {
    s.close();
  }
});

test("listUsers: Cho xac nhan dung so SAU khi admin sua tay hoa hong goc", () => {
  const s = new LedgerStore(":memory:");
  try {
    const e = record(s, "p1", "user-a", 10_000, "pending");
    s.overrideCommissionAmount(e.id, {
      commissionAmount: 20_000,
      fallbackPercents: { taxPercent: 0, platformFeePercent: 0, userSharePercent: 80 },
      maxCommissionRatioPercent: 50,
    });
    assert.equal(find(s, "user-a").pendingConfirmationBalance, 16_000);
  } finally {
    s.close();
  }
});

test("listUsers: Cho xac nhan KHAC Dang cho rut (pendingBalance)", () => {
  const s = new LedgerStore(":memory:");
  try {
    record(s, "c1", "user-a", 100_000, "confirmed"); // 80.000 kha dung
    record(s, "p1", "user-a", 10_000, "pending"); // 8.000 cho xac nhan
    s.requestWithdrawal("zalo", "user-a", 20_000, {
      bankName: "Vietcombank",
      bankAccountNumber: "0123456789",
      bankAccountHolder: "Nguyen Van A",
    });
    const u = find(s, "user-a");
    assert.equal(u.pendingBalance, 80_000, "tien da bam rut");
    assert.equal(u.pendingConfirmationBalance, 8_000, "tien cho Shopee duyet, khong bi dong vao yeu cau rut");
  } finally {
    s.close();
  }
});
