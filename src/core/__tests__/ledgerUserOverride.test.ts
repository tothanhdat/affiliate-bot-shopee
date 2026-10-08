import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";

/** CRUD + tra cuu % hoa hong rieng tung user (bang user_commission_overrides, 2026-10-01). */

const GENERAL = 80;

test("setUserCommissionOverride: luu va doc lai duoc, 1 override tren 1 user", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.setUserCommissionOverride({
      platform: "zalo",
      userId: "user-a",
      userSharePercent: 95,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });

    const saved = store.getUserCommissionOverride("zalo", "user-a");
    assert.equal(saved?.userSharePercent, 95);
    assert.equal(saved?.startDate, "2026-10-01");
    assert.equal(saved?.endDate, "2026-10-31");
    assert.ok(saved?.updatedAt);

    // Luu lan 2 la GHI DE, khong tao ban ghi thu 2.
    store.setUserCommissionOverride({
      platform: "zalo",
      userId: "user-a",
      userSharePercent: 70,
      startDate: "2026-11-01",
      endDate: null,
    });
    assert.equal(store.getUserCommissionOverride("zalo", "user-a")?.userSharePercent, 70);
    assert.equal(store.getUserCommissionOverride("zalo", "user-a")?.endDate, null);
    assert.equal(store.listUserCommissionOverrides().length, 1);
  } finally {
    store.close();
  }
});

test("getUserCommissionOverride: user chua cau hinh -> null, khong lan sang user khac", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.setUserCommissionOverride({
      platform: "zalo",
      userId: "user-a",
      userSharePercent: 95,
      startDate: "2026-10-01",
      endDate: null,
    });

    assert.equal(store.getUserCommissionOverride("zalo", "user-b"), null);
    // Cung userId nhung khac nen tang la 2 nguoi KHAC NHAU (khoa la ca cap platform+userId).
    assert.equal(store.getUserCommissionOverride("telegram", "user-a"), null);
  } finally {
    store.close();
  }
});

test("deleteUserCommissionOverride: tra user ve % chung", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.setUserCommissionOverride({
      platform: "zalo",
      userId: "user-a",
      userSharePercent: 95,
      startDate: "2026-10-01",
      endDate: null,
    });
    store.deleteUserCommissionOverride("zalo", "user-a");

    assert.equal(store.getUserCommissionOverride("zalo", "user-a"), null);
    assert.equal(store.resolveUserSharePercent("zalo", "user-a", "2026-10-15", GENERAL), GENERAL);
  } finally {
    store.close();
  }
});

test("resolveUserSharePercent: doc override tu DB roi ap quy tac han", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.setUserCommissionOverride({
      platform: "zalo",
      userId: "user-a",
      userSharePercent: 95,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });

    assert.equal(store.resolveUserSharePercent("zalo", "user-a", "2026-10-15", GENERAL), 95);
    assert.equal(store.resolveUserSharePercent("zalo", "user-a", "2026-11-01", GENERAL), GENERAL);
    assert.equal(store.resolveUserSharePercent("zalo", "user-khac", "2026-10-15", GENERAL), GENERAL);
  } finally {
    store.close();
  }
});

test("listUsers: kem override cua tung user de trang /admin/users hien duoc cot % rieng", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.recordConversion({
      subId: "k-user-a-1",
      platform: "zalo",
      userId: "user-a",
      merchant: "shopee",
      orderId: "order-a",
      orderAmount: 500_000,
      commissionAmount: 50_000,
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
    });
    store.recordConversion({
      subId: "k-user-b-1",
      platform: "zalo",
      userId: "user-b",
      merchant: "shopee",
      orderId: "order-b",
      orderAmount: 500_000,
      commissionAmount: 50_000,
      taxPercent: 0,
      platformFeePercent: 0,
      userSharePercent: 80,
      maxCommissionRatioPercent: 1000,
      holdConfig: { thresholdVnd: 0, holdDays: 0 },
    });
    store.setUserCommissionOverride({
      platform: "zalo",
      userId: "user-a",
      userSharePercent: 95,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });

    const users = store.listUsers();
    const a = users.find((u) => u.userId === "user-a");
    const b = users.find((u) => u.userId === "user-b");
    assert.equal(a?.commissionOverride?.userSharePercent, 95);
    assert.equal(a?.commissionOverride?.endDate, "2026-10-31");
    assert.equal(b?.commissionOverride, null);
  } finally {
    store.close();
  }
});
