import type { LedgerStore } from "./ledgerStore.js";
import type { LogStore } from "./logStore.js";
import type { CommissionStatus, Platform } from "./types.js";

/**
 * So lieu tong quan cho trang /admin/dashboard (2026-10-01).
 *
 * Nam trong src/core (khong biet gi ve Express/HTML) de test duoc thang bang DB :memory: - trang
 * admin chi nhan ket qua roi ve ra, khong tu tinh toan gi them.
 *
 * NGUYEN TAC "ky xem KHONG duoc lam doi so du that": cac con so cat theo ky (hoa hong, don moi,
 * luot tao link) nam trong `money`/`orders`/`activity`; con tien dang NO user va yeu cau rut dang
 * cho duyet la so TOAN THOI GIAN, bam 7 ngay hay 1 thang deu ra y nhau. Lan dau nhin se thay la,
 * nhung nguoc lai moi nguy hiem: "ky 7 ngay" ma hien no 2 trieu trong khi thuc te no 20 trieu se
 * khien chu bot tuong minh du tien tra.
 */

const VN_TIME_ZONE = "Asia/Ho_Chi_Minh";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const TOP_USERS_LIMIT = 10;

export type DashboardRange = "today" | "7d" | "month" | "lastMonth";

const RANGE_LABELS: Record<DashboardRange, string> = {
  today: "Hôm nay",
  "7d": "7 ngày qua",
  month: "Tháng này",
  lastMonth: "Tháng trước",
};

export const DASHBOARD_RANGES: Array<{ value: DashboardRange; label: string }> = (
  ["today", "7d", "month", "lastMonth"] as const
).map((value) => ({ value, label: RANGE_LABELS[value] }));

export interface DashboardDateRange {
  range: DashboardRange;
  label: string;
  /** Ngay dau ky, "YYYY-MM-DD" gio VN, BAO GOM. */
  fromKey: string;
  /** Ngay cuoi ky, "YYYY-MM-DD" gio VN, BAO GOM. */
  toKey: string;
  /** Moi ngay trong ky, tang dan - la truc X co dinh cua cac chart theo ngay. */
  dayKeys: string[];
}

export interface DashboardStats {
  range: DashboardDateRange;
  money: {
    /** Hoa hong goc tu Shopee trong ky (truoc thue/phi), bo qua don da huy. */
    commission: number;
    /** Phan chu bot thuc giu = (hoa hong - thue - phi san) - phan chia cho user. */
    ownerProfit: number;
    /** Phan chia cho user trong ky. */
    userShare: number;
    /** TOAN THOI GIAN: tien user da duoc xac nhan, chua rut - khoan phai chuan bi de tra. */
    owedToUsers: number;
  };
  orders: {
    newCount: number;
    pendingCount: number;
    /** Phan user se nhan cua cac don pending trong ky - tien CHUA chac chan. */
    pendingAmount: number;
  };
  activity: {
    linkCount: number;
    successCount: number;
    activeUsers: number;
    /** User lan dau JOIN 1 nhom Zalo bot co mat (gop moi nhom), xem LedgerStore.countFirstGroupJoins. */
    newUsers: number;
  };
  withdrawals: {
    /** TOAN THOI GIAN: so yeu cau rut dang cho admin duyet. */
    pendingCount: number;
    pendingAmount: number;
  };
  charts: {
    /**
     * Lich su import ve thanh chart: 3 so DOC LAP moi ngay import, KHONG cong don duoc (don hoa toc
     * nam o ca "newOrders" lan "confirmed", don moi huy ngay nam o ca "newOrders" lan "reversed").
     */
    ordersByDay: { days: string[]; newOrders: number[]; confirmed: number[]; reversed: number[] };
    commissionByDay: { days: string[]; commission: number[]; ownerProfit: number[] };
    statusBreakdown: Array<{ status: CommissionStatus; count: number }>;
    linksByDay: { days: string[]; success: number[]; failed: number[] };
    topUsers: Array<{
      platform: Platform;
      userId: string;
      /** Ten hien thi tu user_profiles; null khi user chua tung nhan tin voi bot -> hien userId. */
      displayName: string | null;
      commission: number;
      orderCount: number;
    }>;
  };
}

export const COMMISSION_STATUSES: CommissionStatus[] = ["pending", "confirmed", "paid", "reversed"];

/** Query ?range= do nguoi dung go tay - moi gia tri khong nam trong danh sach deu ve mac dinh. */
export function parseDashboardRange(raw: unknown): DashboardRange {
  if (raw === "today" || raw === "7d" || raw === "month" || raw === "lastMonth") return raw;
  return "7d";
}

/** "YYYY-MM-DD" cua 1 thoi diem theo gio VN. en-CA cho dinh dang nay on dinh moi locale. */
export function vnDateKey(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: VN_TIME_ZONE });
}

/**
 * Bien ngay tinh theo gio VN chu khong phai gio may chay (Railway chay UTC): 00:30 ngay 01/10 gio
 * VN la 17:30 ngay 30/09 UTC - lay ngay theo UTC se bao cao nham sang hom truoc suot 7 tieng moi
 * sang, dung vao khung gio doi soat 9h30 cua chu bot.
 */
export function resolveDashboardRange(range: DashboardRange, now: Date = new Date()): DashboardDateRange {
  const todayKey = vnDateKey(now);
  let fromKey: string;
  let toKey: string;

  if (range === "today") {
    fromKey = todayKey;
    toKey = todayKey;
  } else if (range === "7d") {
    fromKey = vnDateKey(new Date(now.getTime() - 6 * ONE_DAY_MS));
    toKey = todayKey;
  } else if (range === "month") {
    // Ngay 1 cua thang hien tai THEO GIO VN - cat tu chinh todayKey thay vi doc getMonth() cua Date
    // (do la thang theo gio may, co the lech 1 thang vao dem cuoi/dau thang).
    fromKey = `${todayKey.slice(0, 7)}-01`;
    toKey = todayKey;
  } else {
    // "Tháng trước": day la ky DUY NHAT ket thuc trong qua khu (toKey KHONG phai hom nay) - moi
    // thu khac tu dong dung theo vi deu doc tu fromKey/toKey.
    const [year, month] = todayKey.split("-").map(Number);
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    // Date.UTC(y, prevMonth, 0) = ngay 0 cua thang KE SAU prevMonth = ngay cuoi cung cua prevMonth.
    // Tinh duoc ca thang 2 nam nhuan, khong can bang do dai thang.
    const lastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
    fromKey = `${prevYear}-${pad2(prevMonth)}-01`;
    toKey = `${prevYear}-${pad2(prevMonth)}-${pad2(lastDay)}`;
  }

  return { range, label: RANGE_LABELS[range], fromKey, toKey, dayKeys: enumerateDays(fromKey, toKey) };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Moi ngay tu fromKey den toKey (bao gom 2 dau). Cong theo moc TRUA UTC de khong bi lech ngay. */
function enumerateDays(fromKey: string, toKey: string): string[] {
  const days: string[] = [];
  let cursor = new Date(`${fromKey}T12:00:00Z`);
  const end = new Date(`${toKey}T12:00:00Z`);
  // Chan vong lap vo han neu fromKey > toKey (khong xay ra voi 3 range hien co, nhung day la vong
  // lap tren du lieu tu query string nen khong dua vao gia dinh).
  let guard = 0;
  while (cursor.getTime() <= end.getTime() && guard < 400) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + ONE_DAY_MS);
    guard += 1;
  }
  return days;
}

/** Trai 1 danh sach {day, value} len dung truc dayKeys, ngay khong co du lieu la 0 (khong bo trong). */
function spreadByDay<T>(dayKeys: string[], rows: T[], keyOf: (row: T) => string, valueOf: (row: T) => number): number[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(keyOf(row), (map.get(keyOf(row)) ?? 0) + valueOf(row));
  }
  return dayKeys.map((day) => map.get(day) ?? 0);
}

export function computeDashboardStats(
  ledgerStore: LedgerStore,
  logStore: LogStore,
  range: DashboardRange,
  now: Date = new Date()
): DashboardStats {
  const resolved = resolveDashboardRange(range, now);
  const { fromKey, toKey, dayKeys } = resolved;

  const money = ledgerStore.getDashboardMoneyTotals(fromKey, toKey);
  const outstanding = ledgerStore.getOutstandingTotals();
  const pending = ledgerStore.getPendingOrdersInRange(fromKey, toKey);
  const statusRows = ledgerStore.countEntriesByStatus(fromKey, toKey);
  const newOrderRows = ledgerStore.countSeenOrdersByDayAndStatus(fromKey, toKey);
  const statusEventRows = ledgerStore.countOrderStatusEventsByDay(fromKey, toKey);
  const commissionRows = ledgerStore.sumCommissionByDay(fromKey, toKey);
  const topUsers = ledgerStore.topUsersByCommission(fromKey, toKey, TOP_USERS_LIMIT);

  const requestTotals = logStore.getRequestTotals(fromKey, toKey);
  const requestRows = logStore.countRequestsByDayAndOutcome(fromKey, toKey);
  const newUsers = ledgerStore.countFirstGroupJoins(fromKey, toKey);

  const statusCount = (status: CommissionStatus) =>
    statusRows.find((r) => r.status === status)?.count ?? 0;

  // Chart "Don hang moi": theo NGAY IMPORT. Ngay khong import thi cot rong, chu y chap nhan.
  const ordersByDay = {
    days: dayKeys,
    newOrders: spreadByDay(dayKeys, newOrderRows, (r) => r.day, (r) => r.count),
    confirmed: spreadByDay(
      dayKeys,
      statusEventRows.filter((r) => r.toStatus === "confirmed"),
      (r) => r.day,
      (r) => r.count
    ),
    reversed: spreadByDay(
      dayKeys,
      statusEventRows.filter((r) => r.toStatus === "reversed"),
      (r) => r.day,
      (r) => r.count
    ),
  };

  return {
    range: resolved,
    money: {
      commission: money.commission,
      ownerProfit: money.ownerProfit,
      userShare: money.userShare,
      owedToUsers: outstanding.owedToUsers,
    },
    orders: {
      // Cung nguon voi chart "Don hang moi" (don lan dau thay trong bao cao import) de 2 so luon khop.
      newCount: newOrderRows.reduce((sum, r) => sum + r.count, 0),
      pendingCount: pending.count,
      pendingAmount: pending.userShareAmount,
    },
    activity: {
      linkCount: requestTotals.total,
      successCount: requestTotals.success,
      activeUsers: requestTotals.activeUsers,
      newUsers,
    },
    withdrawals: {
      pendingCount: outstanding.pendingWithdrawalCount,
      pendingAmount: outstanding.pendingWithdrawalAmount,
    },
    charts: {
      ordersByDay,
      commissionByDay: {
        days: dayKeys,
        commission: spreadByDay(dayKeys, commissionRows, (r) => r.day, (r) => r.commission),
        ownerProfit: spreadByDay(dayKeys, commissionRows, (r) => r.day, (r) => r.ownerProfit),
      },
      statusBreakdown: COMMISSION_STATUSES.map((status) => ({ status, count: statusCount(status) })).filter(
        (s) => s.count > 0
      ),
      linksByDay: {
        days: dayKeys,
        success: spreadByDay(
          dayKeys,
          requestRows.filter((r) => r.outcome === "success"),
          (r) => r.day,
          (r) => r.count
        ),
        failed: spreadByDay(
          dayKeys,
          requestRows.filter((r) => r.outcome !== "success"),
          (r) => r.day,
          (r) => r.count
        ),
      },
      topUsers,
    },
  };
}
