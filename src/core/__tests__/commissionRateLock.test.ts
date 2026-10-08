import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LedgerStore } from "../ledgerStore.js";

/**
 * Ty le CHOT tai thoi diem ghi nhan don (2026-10-01, dao nguoc hanh vi truoc do): doi % hoa hong
 * tren /admin/settings KHONG duoc tinh lai tien cho don da ghi, ke ca don con "pending" - don pending
 * la don user DA MUA, chi cho Shopee duyet. Truoc day updatePendingEntry/confirmPendingEntry tinh lai
 * theo % hien hanh o MOI lan import bao cao, nen ha % hom nay se ha tien cua don mua tu tuan truoc.
 */

/** Ty le luc don duoc ghi nhan lan dau. */
const RATES_AT_RECORD = { taxPercent: 10, platformFeePercent: 1, userSharePercent: 80 };
/** Ty le admin doi sang SAU DO - khong duoc anh huong don da ghi. */
const RATES_AFTER_CHANGE = { taxPercent: 50, platformFeePercent: 20, userSharePercent: 10 };

/**
 * Tao file DB theo schema CU (truoc 2026-10-01): co du cot so tien nhung KHONG co 3 cot % nao,
 * kem 1 entry "pending" da ghi san - dung de kiem tra migration + nhanh lui ve ty le hien hanh.
 */
function createLegacyDb(dir: string): string {
  const dbPath = join(dir, "ledger.db");
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE commission_entries (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      order_date TEXT,
      platform TEXT NOT NULL,
      user_id TEXT NOT NULL,
      merchant TEXT NOT NULL,
      sub_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      product_name TEXT,
      order_amount INTEGER NOT NULL,
      commission_amount INTEGER NOT NULL,
      tax_amount INTEGER NOT NULL,
      platform_fee_amount INTEGER NOT NULL,
      after_tax_amount INTEGER NOT NULL,
      user_share_amount INTEGER NOT NULL,
      status TEXT NOT NULL,
      withdrawal_id TEXT,
      note TEXT
    );
  `);
  legacy
    .prepare(
      `INSERT INTO commission_entries
        (id, created_at, order_date, platform, user_id, merchant, sub_id, order_id, product_name,
         order_amount, commission_amount, tax_amount, platform_fee_amount, after_tax_amount,
         user_share_amount, status, withdrawal_id, note)
       VALUES ('legacy-1', '2026-09-20T10:00:00.000Z', NULL, 'zalo', 'user-a', 'shopee',
               'k-user-a-old-xyz', 'order-old', NULL, 1000000, 100000, 10000, 900, 89100, 71280,
               'pending', NULL, NULL)`
    )
    .run();
  legacy.close();
  return dbPath;
}

function recordPendingOrder(store: LedgerStore, orderId = "order-1") {
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
    status: "pending",
  });
}

test("recordConversion chot ca 3 ty le vao entry", () => {
  const store = new LedgerStore(":memory:");
  try {
    const entry = recordPendingOrder(store);
    assert.equal(entry.taxPercent, 10);
    assert.equal(entry.platformFeePercent, 1);
    assert.equal(entry.userSharePercent, 80);
  } finally {
    store.close();
  }
});

test("updatePendingEntry tinh lai tien theo ty le DA CHOT, bo qua ty le hien hanh", () => {
  const store = new LedgerStore(":memory:");
  try {
    const pending = recordPendingOrder(store);

    // Lan import sau: Shopee sua hoa hong len 200.000d, va admin da doi % trong thoi gian do.
    const updated = store.updatePendingEntry(pending.id, {
      orderAmount: 2_000_000,
      commissionAmount: 200_000,
      fallbackPercents: RATES_AFTER_CHANGE,
      maxCommissionRatioPercent: 1000,
    });

    // Tinh theo ty le chot (10/1/80): thue 20.000 -> con 180.000 -> phi san 1.800 -> con 178.200.
    assert.equal(updated.taxAmount, 20_000);
    assert.equal(updated.platformFeeAmount, 1_800);
    assert.equal(updated.afterTaxAmount, 178_200);
    assert.equal(updated.userShareAmount, 142_560);
    // Ty le chot khong bi ghi de boi ty le hien hanh.
    assert.equal(updated.userSharePercent, 80);
    assert.equal(updated.status, "pending");
  } finally {
    store.close();
  }
});

test("confirmPendingEntry tinh lai tien theo ty le DA CHOT, bo qua ty le hien hanh", () => {
  const store = new LedgerStore(":memory:");
  try {
    const pending = recordPendingOrder(store);

    const confirmed = store.confirmPendingEntry(pending.id, {
      orderAmount: 2_000_000,
      commissionAmount: 200_000,
      fallbackPercents: RATES_AFTER_CHANGE,
      maxCommissionRatioPercent: 1000,
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
    });

    assert.equal(confirmed.status, "confirmed");
    assert.equal(confirmed.userShareAmount, 142_560);
    assert.equal(confirmed.userSharePercent, 80);
  } finally {
    store.close();
  }
});

test("entry ghi TRUOC khi co cot ty le: migration them cot, tien tinh theo ty le hien hanh truyen vao", () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-rate-lock-"));
  try {
    const store = new LedgerStore(createLegacyDb(dir));
    try {
      const existing = store.getEntryByOrderId("shopee", "order-old");
      assert.ok(existing);
      // Khong doan ty le cho entry cu - de null.
      assert.equal(existing.userSharePercent, null);
      assert.equal(existing.taxPercent, null);
      assert.equal(existing.platformFeePercent, null);

      const updated = store.updatePendingEntry(existing.id, {
        orderAmount: 1_000_000,
        commissionAmount: 100_000,
        fallbackPercents: RATES_AFTER_CHANGE,
        maxCommissionRatioPercent: 1000,
      });

      // Khong co ty le chot -> dung ty le hien hanh (50/20/10), giu nguyen hanh vi truoc day.
      assert.equal(updated.taxAmount, 50_000);
      assert.equal(updated.platformFeeAmount, 10_000);
      assert.equal(updated.afterTaxAmount, 40_000);
      assert.equal(updated.userShareAmount, 4_000);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("entry cu duoc CHOT ty le ngay lan tinh lai dau tien, lan sau doi % khong con anh huong", () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-rate-lock-"));
  try {
    const store = new LedgerStore(createLegacyDb(dir));
    try {
      const existing = store.getEntryByOrderId("shopee", "order-old");
      assert.ok(existing);

      // Lan import dau tien sau deploy: entry cu lui ve ty le hien hanh (10/1/80) VA chot lai luon.
      const firstTouch = store.updatePendingEntry(existing.id, {
        orderAmount: 1_000_000,
        commissionAmount: 100_000,
        fallbackPercents: RATES_AT_RECORD,
        maxCommissionRatioPercent: 1000,
      });
      assert.equal(firstTouch.userSharePercent, 80);
      assert.equal(store.getEntryByOrderId("shopee", "order-old")?.userSharePercent, 80);

      // Admin doi % roi import tiep -> entry nay da co ty le chot, khong bi tinh lai theo % moi.
      const secondTouch = store.updatePendingEntry(existing.id, {
        orderAmount: 1_000_000,
        commissionAmount: 100_000,
        fallbackPercents: RATES_AFTER_CHANGE,
        maxCommissionRatioPercent: 1000,
      });
      assert.equal(secondTouch.taxAmount, 10_000);
      assert.equal(secondTouch.platformFeeAmount, 900);
      assert.equal(secondTouch.userShareAmount, 71_280);
      assert.equal(secondTouch.userSharePercent, 80);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
