import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";
import { LogStore } from "../logStore.js";
import {
  computeDashboardStats,
  parseDashboardRange,
  resolveDashboardRange,
} from "../dashboardStats.js";

const ORDER_CONFIG = {
  taxPercent: 0,
  platformFeePercent: 0,
  userSharePercent: 80,
  maxCommissionRatioPercent: 1000,
  holdConfig: { thresholdVnd: 0, holdDays: 0 },
};

// ---------------------------------------------------------------------------
// parseDashboardRange: query ?range= do nguoi dung go tay, moi gia tri la ve mac dinh "7d".
// ---------------------------------------------------------------------------

test("parseDashboardRange: nhan dung 4 gia tri hop le", () => {
  assert.equal(parseDashboardRange("today"), "today");
  assert.equal(parseDashboardRange("7d"), "7d");
  assert.equal(parseDashboardRange("month"), "month");
  assert.equal(parseDashboardRange("lastMonth"), "lastMonth");
});

test("parseDashboardRange: gia tri la/thieu -> mac dinh 7d", () => {
  assert.equal(parseDashboardRange(undefined), "7d");
  assert.equal(parseDashboardRange(""), "7d");
  assert.equal(parseDashboardRange("30d"), "7d");
  assert.equal(parseDashboardRange(["today"]), "7d");
  assert.equal(parseDashboardRange("'; DROP TABLE commission_entries; --"), "7d");
});

// ---------------------------------------------------------------------------
// resolveDashboardRange: bien ngay theo gio VN (UTC+7), KHONG phai gio UTC.
// ---------------------------------------------------------------------------

test("resolveDashboardRange today: 00:30 gio VN van la ngay MOI (du UTC con hom truoc)", () => {
  // 2026-09-30T17:30:00Z = 2026-10-01 00:30 gio VN -> phai ra ngay 01/10, khong phai 30/09.
  const range = resolveDashboardRange("today", new Date("2026-09-30T17:30:00Z"));
  assert.equal(range.fromKey, "2026-10-01");
  assert.equal(range.toKey, "2026-10-01");
  assert.deepEqual(range.dayKeys, ["2026-10-01"]);
});

test("resolveDashboardRange today: 23:30 gio VN van la ngay DO (UTC da sang hom sau chua toi)", () => {
  // 2026-09-30T16:30:00Z = 2026-09-30 23:30 gio VN.
  const range = resolveDashboardRange("today", new Date("2026-09-30T16:30:00Z"));
  assert.equal(range.fromKey, "2026-09-30");
  assert.equal(range.toKey, "2026-09-30");
});

test("resolveDashboardRange 7d: gom dung 7 ngay, ke ca hom nay", () => {
  const range = resolveDashboardRange("7d", new Date("2026-10-01T05:00:00Z"));
  assert.equal(range.fromKey, "2026-09-25");
  assert.equal(range.toKey, "2026-10-01");
  assert.equal(range.dayKeys.length, 7);
  assert.equal(range.dayKeys[0], "2026-09-25");
  assert.equal(range.dayKeys[6], "2026-10-01");
});

test("resolveDashboardRange 7d: bac qua ranh gioi thang", () => {
  const range = resolveDashboardRange("7d", new Date("2026-03-02T05:00:00Z"));
  assert.equal(range.fromKey, "2026-02-24");
  assert.equal(range.toKey, "2026-03-02");
  assert.equal(range.dayKeys.length, 7);
});

test("resolveDashboardRange month: tu ngay 1 cua thang hien tai (gio VN) toi hom nay", () => {
  const range = resolveDashboardRange("month", new Date("2026-10-15T05:00:00Z"));
  assert.equal(range.fromKey, "2026-10-01");
  assert.equal(range.toKey, "2026-10-15");
  assert.equal(range.dayKeys.length, 15);
});

test("resolveDashboardRange month: ngay 1 cua thang -> dung 1 ngay, khong rong", () => {
  const range = resolveDashboardRange("month", new Date("2026-10-01T05:00:00Z"));
  assert.equal(range.fromKey, "2026-10-01");
  assert.equal(range.toKey, "2026-10-01");
  assert.deepEqual(range.dayKeys, ["2026-10-01"]);
});

test("resolveDashboardRange lastMonth: tron ven thang truoc, KHONG keo toi hom nay", () => {
  const range = resolveDashboardRange("lastMonth", new Date("2026-10-15T05:00:00Z"));
  assert.equal(range.fromKey, "2026-09-01");
  assert.equal(range.toKey, "2026-09-30");
  assert.equal(range.dayKeys.length, 30);
});

test("resolveDashboardRange lastMonth: thang 1 -> thang 12 NAM TRUOC", () => {
  const range = resolveDashboardRange("lastMonth", new Date("2026-01-10T05:00:00Z"));
  assert.equal(range.fromKey, "2025-12-01");
  assert.equal(range.toKey, "2025-12-31");
  assert.equal(range.dayKeys.length, 31);
});

test("resolveDashboardRange lastMonth: thang 2 nam thuong va nam nhuan", () => {
  const thuong = resolveDashboardRange("lastMonth", new Date("2026-03-10T05:00:00Z"));
  assert.equal(thuong.toKey, "2026-02-28");
  assert.equal(thuong.dayKeys.length, 28);

  const nhuan = resolveDashboardRange("lastMonth", new Date("2028-03-10T05:00:00Z"));
  assert.equal(nhuan.toKey, "2028-02-29");
  assert.equal(nhuan.dayKeys.length, 29);
});

test("resolveDashboardRange lastMonth: nua dem gio VN ngay 01 -> van la thang truoc dung", () => {
  // 2026-09-30T17:30:00Z = 2026-10-01 00:30 gio VN -> thang truoc phai la 09/2026, khong phai 08.
  const range = resolveDashboardRange("lastMonth", new Date("2026-09-30T17:30:00Z"));
  assert.equal(range.fromKey, "2026-09-01");
  assert.equal(range.toKey, "2026-09-30");
});

test("computeDashboardStats lastMonth: chi lay don cua thang truoc", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");

  seedEntry(ledgerStore, { orderId: "M1", orderDate: "2026-09-15", commissionAmount: 50_000 });
  seedEntry(ledgerStore, { orderId: "M2", orderDate: "2026-09-30", commissionAmount: 30_000 });
  seedEntry(ledgerStore, { orderId: "M3", orderDate: "2026-10-01", commissionAmount: 99_000 });
  seedEntry(ledgerStore, { orderId: "M4", orderDate: "2026-08-31", commissionAmount: 77_000 });

  // "Don moi" dem theo don lan dau thay luc import (khong theo order_date).
  ledgerStore.recordSeenOrder("shopee", "M1", "confirmed", "2026-09-16");
  ledgerStore.recordSeenOrder("shopee", "M2", "confirmed", "2026-09-30");
  ledgerStore.recordSeenOrder("shopee", "M3", "confirmed", "2026-10-01");

  const stats = computeDashboardStats(ledgerStore, logStore, "lastMonth", new Date("2026-10-05T05:00:00Z"));

  assert.equal(stats.orders.newCount, 2);
  assert.equal(stats.money.commission, 80_000);

  logStore.close();
  ledgerStore.close();
});

test("resolveDashboardRange month: thang 1 khong lui ve nam truoc", () => {
  const range = resolveDashboardRange("month", new Date("2026-01-10T05:00:00Z"));
  assert.equal(range.fromKey, "2026-01-01");
  assert.equal(range.toKey, "2026-01-10");
});

// ---------------------------------------------------------------------------
// computeDashboardStats: tong hop that tren DB :memory:
// ---------------------------------------------------------------------------

function seedRequest(
  logStore: LogStore,
  subId: string,
  opts: { userId?: string; timestamp?: string; outcome?: "success" | "error" } = {}
) {
  logStore.record({
    platform: "zalo",
    merchant: "shopee",
    userId: opts.userId ?? "user-a",
    originalUrl: "https://shopee.vn/product/1/2",
    subId,
    outcome: opts.outcome ?? "success",
    errorCode: opts.outcome === "error" ? "INVALID_LINK" : null,
    affiliateUrl: "https://bot.example.com/s/abc",
    timestamp: opts.timestamp,
  });
}

function seedEntry(
  ledgerStore: LedgerStore,
  opts: {
    orderId: string;
    userId?: string;
    commissionAmount?: number;
    orderAmount?: number;
    status?: "pending" | "confirmed";
    orderDate?: string | null;
  }
) {
  return ledgerStore.recordConversion({
    subId: `sub-${opts.orderId}`,
    platform: "zalo",
    userId: opts.userId ?? "user-a",
    merchant: "shopee",
    orderId: opts.orderId,
    orderAmount: opts.orderAmount ?? 1_000_000,
    commissionAmount: opts.commissionAmount ?? 100_000,
    orderDate: opts.orderDate ?? null,
    status: opts.status ?? "confirmed",
    ...ORDER_CONFIG,
  });
}

test("computeDashboardStats: ky rong -> tra ve toan so 0, khong crash", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");

  const stats = computeDashboardStats(ledgerStore, logStore, "7d", new Date("2026-10-01T05:00:00Z"));

  assert.equal(stats.money.commission, 0);
  assert.equal(stats.money.ownerProfit, 0);
  assert.equal(stats.money.owedToUsers, 0);
  assert.equal(stats.orders.newCount, 0);
  assert.equal(stats.activity.linkCount, 0);
  assert.equal(stats.activity.newUsers, 0);
  assert.equal(stats.charts.ordersByDay.days.length, 7);
  assert.deepEqual(stats.charts.ordersByDay.newOrders, [0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(stats.charts.ordersByDay.confirmed, [0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(stats.charts.ordersByDay.reversed, [0, 0, 0, 0, 0, 0, 0]);
  assert.equal(stats.charts.topUsers.length, 0);

  logStore.close();
  ledgerStore.close();
});

test("computeDashboardStats: chart don hang = lich su import (don moi / chuyen Kha dung / da huy) theo NGAY IMPORT", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");

  // order_date khac xa ngay import - chart khong duoc nhin vao no.
  seedEntry(ledgerStore, { orderId: "A1", orderDate: "2026-09-01" });
  // 30/09: 2 don moi (A1 cho xac nhan, A2 hoa toc - lan dau da Kha dung).
  ledgerStore.recordSeenOrder("shopee", "A1", "pending", "2026-09-30");
  ledgerStore.recordSeenOrder("shopee", "A2", "confirmed", "2026-09-30");
  ledgerStore.recordOrderStatusEvent("shopee", "A2", "confirmed", "2026-09-30");
  // 01/10: A1 chuyen Kha dung; A3 la don moi huy ngay.
  ledgerStore.recordOrderStatusEvent("shopee", "A1", "confirmed", "2026-10-01");
  ledgerStore.recordSeenOrder("shopee", "A3", "reversed", "2026-10-01");
  ledgerStore.recordOrderStatusEvent("shopee", "A3", "reversed", "2026-10-01");

  const stats = computeDashboardStats(ledgerStore, logStore, "7d", new Date("2026-10-01T05:00:00Z"));
  const { days, newOrders, confirmed, reversed } = stats.charts.ordersByDay;
  const at = (arr: number[], day: string) => arr[days.indexOf(day)];

  assert.equal(at(newOrders, "2026-09-30"), 2);
  assert.equal(at(confirmed, "2026-09-30"), 1); // don hoa toc nam o CA 2 cot
  assert.equal(at(newOrders, "2026-10-01"), 1);
  assert.equal(at(confirmed, "2026-10-01"), 1); // A1 cho -> Kha dung
  assert.equal(at(reversed, "2026-10-01"), 1);
  // Ngay khong import -> rong.
  assert.equal(at(newOrders, "2026-09-29"), 0);
  // The KPI "Don moi" cung nguon voi cot "Don moi".
  assert.equal(stats.orders.newCount, 3);

  logStore.close();
  ledgerStore.close();
});

test("recordOrderStatusEvent: don huy chi tinh cho NGAY DAU ghi nhan huy, import de hom sau khong tinh lai", () => {
  const ledgerStore = new LedgerStore(":memory:");

  assert.equal(ledgerStore.recordOrderStatusEvent("shopee", "H1", "reversed", "2026-10-01"), true);
  assert.equal(ledgerStore.recordOrderStatusEvent("shopee", "H1", "reversed", "2026-10-02"), false);

  assert.deepEqual(ledgerStore.countOrderStatusEventsByDay("2026-10-01", "2026-10-05"), [
    { day: "2026-10-01", toStatus: "reversed", count: 1 },
  ]);

  ledgerStore.close();
});

test("recordSeenOrder: chi lan DAU thang - lan import sau khong dem lai, khong doi ngay/trang thai", () => {
  const ledgerStore = new LedgerStore(":memory:");

  assert.equal(ledgerStore.recordSeenOrder("shopee", "X1", "pending", "2026-10-01"), true);
  assert.equal(ledgerStore.recordSeenOrder("shopee", "X1", "confirmed", "2026-10-03"), false);

  const rows = ledgerStore.countSeenOrdersByDayAndStatus("2026-10-01", "2026-10-05");
  assert.deepEqual(rows, [{ day: "2026-10-01", status: "pending", count: 1 }]);

  ledgerStore.close();
});

test("computeDashboardStats: tach don pending va tien treo", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");

  seedEntry(ledgerStore, { orderId: "P1", status: "pending", commissionAmount: 50_000, orderDate: "2026-10-01" });
  seedEntry(ledgerStore, { orderId: "C1", status: "confirmed", commissionAmount: 100_000, orderDate: "2026-10-01" });

  const stats = computeDashboardStats(ledgerStore, logStore, "today", new Date("2026-10-01T05:00:00Z"));

  assert.equal(stats.orders.pendingCount, 1);
  assert.equal(stats.orders.pendingAmount, 40_000); // 80% cua 50.000
  // Tien dang NO user chi tinh don da confirmed va chua bi giu boi yeu cau rut.
  assert.equal(stats.money.owedToUsers, 80_000);
  // Loi nhuan chu bot = 20% phan con lai cua CA 2 don (thue/phi = 0 trong test config).
  assert.equal(stats.money.commission, 150_000);
  assert.equal(stats.money.ownerProfit, 30_000);

  logStore.close();
  ledgerStore.close();
});

test("computeDashboardStats: luot tao link + user hoat dong tu requests.db", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");

  const today = new Date("2026-10-01T05:00:00Z").toISOString();
  seedRequest(logStore, "s1", { timestamp: today, outcome: "success" });
  seedRequest(logStore, "s2", { timestamp: today, outcome: "success" });
  seedRequest(logStore, "s3", { timestamp: today, outcome: "success" });
  seedRequest(logStore, "s4", { timestamp: today, outcome: "error", userId: "user-b" });

  const stats = computeDashboardStats(ledgerStore, logStore, "today", new Date("2026-10-01T05:00:00Z"));

  assert.equal(stats.activity.linkCount, 4);
  assert.equal(stats.activity.successCount, 3);
  assert.equal(stats.activity.activeUsers, 2);

  logStore.close();
  ledgerStore.close();
});

test("computeDashboardStats: top user xep theo hoa hong giam dan", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");

  seedEntry(ledgerStore, { orderId: "T1", userId: "u-nho", commissionAmount: 10_000, orderDate: "2026-10-01" });
  seedEntry(ledgerStore, { orderId: "T2", userId: "u-to", commissionAmount: 90_000, orderDate: "2026-10-01" });
  seedEntry(ledgerStore, { orderId: "T3", userId: "u-to", commissionAmount: 10_000, orderDate: "2026-10-01" });

  const stats = computeDashboardStats(ledgerStore, logStore, "today", new Date("2026-10-01T05:00:00Z"));
  const top = stats.charts.topUsers;

  assert.equal(top.length, 2);
  assert.equal(top[0].userId, "u-to");
  assert.equal(top[0].commission, 100_000);
  assert.equal(top[1].userId, "u-nho");
  // Chua co ho so -> displayName null, cho goi tu lui ve userId (KHONG duoc bien mat khoi top).
  assert.equal(top[0].displayName, null);

  logStore.close();
  ledgerStore.close();
});

test("computeDashboardStats: don NGOAI ky khong duoc tinh vao so lieu cua ky", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");

  seedEntry(ledgerStore, { orderId: "IN", orderDate: "2026-10-01", commissionAmount: 100_000 });
  seedEntry(ledgerStore, { orderId: "OUT", orderDate: "2026-08-15", commissionAmount: 999_000 });

  ledgerStore.recordSeenOrder("shopee", "IN", "confirmed", "2026-10-01");
  ledgerStore.recordSeenOrder("shopee", "OUT", "confirmed", "2026-08-15");

  const stats = computeDashboardStats(ledgerStore, logStore, "today", new Date("2026-10-01T05:00:00Z"));

  assert.equal(stats.orders.newCount, 1);
  assert.equal(stats.money.commission, 100_000);
  // ...nhung tien dang NO user la so TOAN THOI GIAN (so du that), khong cat theo ky.
  assert.equal(stats.money.owedToUsers, 80_000 + 799_200);

  logStore.close();
  ledgerStore.close();
});

test("computeDashboardStats: top user kem ten hien thi khi da co ho so", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");

  ledgerStore.upsertUserProfile("zalo", "u-co-ten", "Ngọc Ánh");
  seedEntry(ledgerStore, { orderId: "N1", userId: "u-co-ten", commissionAmount: 90_000, orderDate: "2026-10-01" });
  seedEntry(ledgerStore, { orderId: "N2", userId: "u-khong-ten", commissionAmount: 10_000, orderDate: "2026-10-01" });

  const top = computeDashboardStats(ledgerStore, logStore, "today", new Date("2026-10-01T05:00:00Z")).charts
    .topUsers;

  assert.equal(top[0].displayName, "Ngọc Ánh");
  // LEFT JOIN chu khong phai JOIN: user chua co ho so VAN phai nam trong danh sach.
  assert.equal(top[1].userId, "u-khong-ten");
  assert.equal(top[1].displayName, null);

  logStore.close();
  ledgerStore.close();
});

test("LedgerStore khoi dong: don cu bi dem nham la 'don moi' (ngay import > ngay ghi entry) duoc keo ve ngay ghi entry", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "ledger-"));
  const path = join(dir, "ledger.db");
  try {
    const first = new LedgerStore(path);
    const entry = seedEntry(first, { orderId: "OLD" });
    (first as unknown as { db: { prepare(sql: string): { run(...a: unknown[]): void } } }).db
      .prepare("UPDATE commission_entries SET created_at = ? WHERE id = ?")
      .run("2026-09-01T03:00:00.000Z", entry.id);
    // Ban code 2026-10-06 ghi nham ngay import hom nay cho don da co tu truoc.
    first.recordSeenOrder("shopee", "OLD", "confirmed", "2026-10-06");
    first.close();

    const reopened = new LedgerStore(path);
    assert.deepEqual(reopened.countSeenOrdersByDayAndStatus("2000-01-01", "2999-12-31"), [
      { day: "2026-09-01", status: "confirmed", count: 1 },
    ]);
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("computeDashboardStats: 'User moi' = user LAN DAU join nhom Zalo (gop moi nhom), khong phai user co don", () => {
  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");

  // User co don/gui link nhung KHONG join nhom -> khong tinh.
  seedEntry(ledgerStore, { orderId: "N1", userId: "buyer" });
  // 2 user join; user-a join them nhom thu 2 (claim lan 2 tra false) -> van tinh 1.
  ledgerStore.tryClaimGroupJoinMessage("zalo", "user-a");
  ledgerStore.tryClaimGroupJoinMessage("zalo", "user-b");
  ledgerStore.tryClaimGroupJoinMessage("zalo", "user-a");

  const stats = computeDashboardStats(ledgerStore, logStore, "today", new Date());
  assert.equal(stats.activity.newUsers, 2);

  logStore.close();
  ledgerStore.close();
});
