import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LedgerStore } from "../ledgerStore.js";

/**
 * Backfill 3 cot ty le cho entry ghi TRUOC 2026-10-01 (2026-10-09, yeu cau truc tiep cua user).
 * Ty le that thoi do la 10/90 (thue 10%, phi san 1%, user 90%) - user xac nhan, va so tien da luu
 * trong DB tu xac minh dieu do. CHI ghi khi tinh lai ra DUNG TUNG DONG da luu (lua chon cua user):
 * don nao khong khop thi de nguyen "—" chu khong gan nhan mot ty le co the sai len don tien that.
 */

/** DB tren dia (khong phai :memory:) de dong/mo lai duoc - migration chi chay luc khoi tao store. */
function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "ledger-backfill-"));
  return { path: join(dir, "ledger.db"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function recordEntry(
  store: LedgerStore,
  input: { orderId: string; commissionAmount: number; userSharePercent: number; status?: "confirmed" | "pending" }
) {
  return store.recordConversion({
    subId: `k-user-a-${input.orderId}`,
    platform: "zalo",
    userId: "user-a",
    merchant: "shopee",
    orderId: input.orderId,
    orderAmount: 500_000,
    commissionAmount: input.commissionAmount,
    taxPercent: 10,
    platformFeePercent: 1,
    userSharePercent: input.userSharePercent,
    maxCommissionRatioPercent: 1000,
    holdConfig: { thresholdVnd: 0, holdDays: 0 },
    status: input.status,
  });
}

/** Xoa 3 cot % de tai hien dung hinh dang cua entry ghi truoc 2026-10-01. */
function clearPercents(dbPath: string, orderId: string): void {
  const db = new DatabaseSync(dbPath);
  db.prepare(
    `UPDATE commission_entries SET tax_percent = NULL, platform_fee_percent = NULL, user_share_percent = NULL
     WHERE order_id = ?`
  ).run(orderId);
  db.close();
}

function readPercents(dbPath: string, orderId: string) {
  const db = new DatabaseSync(dbPath);
  const row = db
    .prepare(
      `SELECT tax_percent, platform_fee_percent, user_share_percent FROM commission_entries WHERE order_id = ?`
    )
    .get(orderId) as { tax_percent: number | null; platform_fee_percent: number | null; user_share_percent: number | null };
  db.close();
  // node:sqlite tra object null-prototype - assert.deepEqual (strict) so ca prototype nen phai
  // trai sang object thuong, neu khong test that bai du gia tri giong het nhau.
  return { ...row };
}

test("backfill %: don cu khop 10/1/90 duoc ghi lai du 3 cot", () => {
  const { path, cleanup } = tempDb();
  try {
    let store = new LedgerStore(path);
    recordEntry(store, { orderId: "order-cu", commissionAmount: 13_260, userSharePercent: 90 });
    store.close();
    clearPercents(path, "order-cu");

    store = new LedgerStore(path);
    store.close();

    assert.deepEqual(readPercents(path, "order-cu"), {
      tax_percent: 10,
      platform_fee_percent: 1,
      user_share_percent: 90,
    });
  } finally {
    cleanup();
  }
});

test("backfill %: KHONG dung so tien da luu (chi ghi nhan, khong tinh lai tien)", () => {
  const { path, cleanup } = tempDb();
  try {
    let store = new LedgerStore(path);
    const before = recordEntry(store, { orderId: "order-cu", commissionAmount: 13_260, userSharePercent: 90 });
    store.close();
    clearPercents(path, "order-cu");

    store = new LedgerStore(path);
    const after = store.getEntryByOrderId("shopee", "order-cu");
    store.close();

    assert.equal(after?.userShareAmount, before.userShareAmount);
    assert.equal(after?.taxAmount, before.taxAmount);
    assert.equal(after?.platformFeeAmount, before.platformFeeAmount);
  } finally {
    cleanup();
  }
});

/**
 * Don thoi 20/80 (truoc 19/08) neu con sot lai: so tien noi 80% chu khong phai 90%. Gan nhan 90%
 * len don do la noi sai ngay tren trang admin dung de doi soat - de nguyen "—".
 */
test("backfill %: don co so tien KHONG khop 90% thi de nguyen NULL", () => {
  const { path, cleanup } = tempDb();
  try {
    let store = new LedgerStore(path);
    recordEntry(store, { orderId: "order-80", commissionAmount: 13_260, userSharePercent: 80 });
    store.close();
    clearPercents(path, "order-80");

    store = new LedgerStore(path);
    store.close();

    assert.deepEqual(readPercents(path, "order-80"), {
      tax_percent: null,
      platform_fee_percent: null,
      user_share_percent: null,
    });
  } finally {
    cleanup();
  }
});

test("backfill %: KHONG ghi de ty le da chot cua don moi", () => {
  const { path, cleanup } = tempDb();
  try {
    let store = new LedgerStore(path);
    recordEntry(store, { orderId: "order-moi", commissionAmount: 13_260, userSharePercent: 80 });
    store.close();

    store = new LedgerStore(path);
    store.close();

    assert.equal(readPercents(path, "order-moi").user_share_percent, 80, "ty le da chot la bat kha xam pham");
  } finally {
    cleanup();
  }
});

test("backfill %: chay lai nhieu lan khong doi gi them (idempotent)", () => {
  const { path, cleanup } = tempDb();
  try {
    let store = new LedgerStore(path);
    recordEntry(store, { orderId: "order-cu", commissionAmount: 13_260, userSharePercent: 90 });
    recordEntry(store, { orderId: "order-80", commissionAmount: 13_260, userSharePercent: 80 });
    store.close();
    clearPercents(path, "order-cu");
    clearPercents(path, "order-80");

    for (let i = 0; i < 3; i++) new LedgerStore(path).close();

    assert.equal(readPercents(path, "order-cu").user_share_percent, 90);
    assert.equal(readPercents(path, "order-80").user_share_percent, null);
  } finally {
    cleanup();
  }
});

/** Don pending cung duoc chot: lan xac nhan sau se tinh tien bang chinh 3 so nay. */
test("backfill %: don pending cung duoc ghi ty le", () => {
  const { path, cleanup } = tempDb();
  try {
    let store = new LedgerStore(path);
    recordEntry(store, { orderId: "order-cho", commissionAmount: 9_724, userSharePercent: 90, status: "pending" });
    store.close();
    clearPercents(path, "order-cho");

    store = new LedgerStore(path);
    store.close();

    assert.equal(readPercents(path, "order-cho").user_share_percent, 90);
  } finally {
    cleanup();
  }
});
