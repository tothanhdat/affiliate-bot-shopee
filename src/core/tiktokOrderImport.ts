/**
 * Doi soat don TikTok Shop tu RioHub vao ledger (spec 2026-10-11-doi-soat-don-tiktok-design.md).
 *
 * THUAN: nhan MANG don da keo san, khong goi mang - y het importShopeeReport nhan csvText. Phan ap
 * trang thai vao ledger la orderStatusApply.ts (dung chung voi Shopee).
 *
 * QUYET DINH TIEN (doc spec 2.2/2.2b/5.3/5.4 truoc khi sua):
 *  - Don vao Kha dung LUC GIAO HANG (time_delivered_iso) hoac status=2, KHONG cho RioHub quyet toan
 *    (SETTLED nam sau cua so tra hang 15+ ngay). Tuong duong "Hoan thanh" cua Shopee.
 *  - Hoa hong goc = round(tong est_commission dong khong huy x TIKTOK_PIT_RETAINED_RATIO), cho CA
 *    pending lan confirmed. Mot cong thuc nen KHONG bao gio phai sua so sau khi da chot.
 *  - actual_commission/pit/shared_with_partner CHI de doi chieu & canh bao, KHONG tham gia tinh tien.
 *    (Neu ai dinh dung actual de tinh tien: lay THANG field, tuyet doi khong cong lai 6 thanh phan -
 *    tra thua ~10 lan.)
 *  - Phan loai doc `status` (1/2/3), KHONG doc `settlement_status` (passthrough TikTok, co the them
 *    gia tri la).
 */
import type { LedgerStore } from "./ledgerStore.js";
import type { LogStore } from "./logStore.js";
import { formatVnd } from "./money.js";
import {
  summarizeOrderResultsByUser,
  type OrderRowResult,
  type RecordOrderConfig,
  type UserOrderSummary,
} from "./orderIngest.js";
import { applyOrderStatusToLedger } from "./orderStatusApply.js";
import { estimateTiktokNetCommission, isActualBelowAssumed } from "./tiktokCommission.js";
import type { Platform, StatusTransition } from "./types.js";
import { formatVnDateIso, formatVnTimeHms, todayVnIso } from "./vietnamDate.js";

/** Mot DONG cua GET /orders (mot SKU). Tien/decimal ve dang STRING trong JSON de giu do chinh xac. */
export interface RiohubOrderRecord {
  order_id?: string | null;
  sku_id?: string | null;
  product_name?: string | null;
  /** Don khong co subId la CHUOI RONG, khong phai null (do that 2026-10-09). */
  sub_id?: string | null;
  /** 1 cho · 2 da quyet toan · 3 huy/hoan (da chuan hoa boi RioHub). */
  status?: number | string | null;
  settlement_status?: string | null;
  commission_gmv?: string | number | null;
  est_commission?: string | number | null;
  actual_commission?: string | number | null;
  shared_with_partner?: string | number | null;
  pit?: string | number | null;
  refunded_quantity?: number | string | null;
  returned_quantity?: number | string | null;
  fully_refunded?: number | boolean | string | null;
  time_created_iso?: string | null;
  time_delivered_iso?: string | null;
}

export interface TiktokOrderImportConfig {
  recordOrderConfig: RecordOrderConfig;
}

export interface TiktokAlert {
  /** Khoa gop AlertThrottle o tang gui tin. */
  key: "tiktok_mcn_cut" | "tiktok_actual_below_assumed";
  message: string;
}

export interface TiktokOrderImportResult {
  ordersScanned: number;
  confirmedNew: number;
  confirmedDuplicate: number;
  pendingNew: number;
  pendingUpdated: number;
  reversedCount: number;
  /** Don nhieu SKU (nhieu dong) da gop thanh 1. */
  mergedMultiSku: number;
  skippedNoSubId: number;
  skippedSubIdNotFound: number;
  /** sub_id khop request cua SAN KHAC (chot cach ly, spec 6.1). */
  skippedForeignMerchant: number;
  skippedUnknownStatus: number;
  /** Don con song nhung khong dong nao co est_commission - khong co gi de ghi. */
  skippedNoEstimate: number;
  smallHoldDeferred: number;
  heldCount: number;
  debtCreatedCount: number;
  debtsByUser: Array<{ platform: Platform; userId: string; orderId: string; amount: number }>;
  cancelledWithdrawals: Array<{
    platform: Platform;
    userId: string;
    withdrawalId: string;
    amount: number;
    orderId: string;
  }>;
  confirmedByUser: UserOrderSummary[];
  newOrderIds: string[];
  statusTransitions: StatusTransition[];
  /**
   * CHI de doi chieu/canh bao, KHONG tham gia tinh tien (spec 7.2). null o field nao nghia la chua
   * quan sat duoc gia tri nao - KHAC voi 0.
   */
  settledTotals: {
    orderCount: number;
    estTotal: number;
    actualTotal: number | null;
    pitTotal: number | null;
    sharedWithPartnerTotal: number | null;
    /** So don co actual thap hon so da dung de tra user (spec 7.1b). > 0 la phai xem ngay. */
    shortfallCount: number;
  };
  /** Canh bao can DAY CHO ADMIN qua notifyAdmin (da gop theo key). Tang gui tin tu loc qua AlertThrottle. */
  alerts: TiktokAlert[];
  errors: string[];
}

/** Chuoi rong/null -> null, KHAC so 0 (0 la gia tri that). */
export function parseRiohubMoney(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseStatus(v: unknown): 1 | 2 | 3 | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return n === 1 || n === 2 || n === 3 ? n : null;
}

function parseIso(v: unknown): Date | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function truthyFlag(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

interface Row {
  raw: RiohubOrderRecord;
  status: 1 | 2 | 3;
  est: number | null;
  actual: number | null;
  shared: number | null;
  pit: number | null;
  gmv: number;
  created: Date | null;
  delivered: Date | null;
}

const MAX_ALERT_LINES = 5;

function buildAlert(key: TiktokAlert["key"], headline: string, lines: string[]): TiktokAlert {
  const shown = lines.slice(0, MAX_ALERT_LINES).join("\n");
  const more = lines.length > MAX_ALERT_LINES ? `\n(+${lines.length - MAX_ALERT_LINES} đơn khác)` : "";
  return { key, message: `${headline}\n${shown}${more}` };
}

export function importTiktokOrders(
  logStore: LogStore,
  ledgerStore: LedgerStore,
  config: TiktokOrderImportConfig,
  orders: RiohubOrderRecord[]
): TiktokOrderImportResult {
  const { recordOrderConfig } = config;

  const grouped = new Map<string, RiohubOrderRecord[]>();
  let missingOrderId = 0;
  for (const o of orders) {
    const id = typeof o.order_id === "string" ? o.order_id.trim() : "";
    if (id === "") {
      missingOrderId += 1;
      continue;
    }
    const list = grouped.get(id);
    if (list) list.push(o);
    else grouped.set(id, [o]);
  }

  const result: TiktokOrderImportResult = {
    ordersScanned: grouped.size,
    confirmedNew: 0,
    confirmedDuplicate: 0,
    pendingNew: 0,
    pendingUpdated: 0,
    reversedCount: 0,
    mergedMultiSku: 0,
    skippedNoSubId: 0,
    skippedSubIdNotFound: 0,
    skippedForeignMerchant: 0,
    skippedUnknownStatus: 0,
    skippedNoEstimate: 0,
    smallHoldDeferred: 0,
    heldCount: 0,
    debtCreatedCount: 0,
    debtsByUser: [],
    cancelledWithdrawals: [],
    confirmedByUser: [],
    newOrderIds: [],
    statusTransitions: [],
    settledTotals: {
      orderCount: 0,
      estTotal: 0,
      actualTotal: null,
      pitTotal: null,
      sharedWithPartnerTotal: null,
      shortfallCount: 0,
    },
    alerts: [],
    errors: [],
  };
  if (missingOrderId > 0) {
    result.errors.push(`${missingOrderId} dong tu RioHub thieu order_id - bo qua cac dong do.`);
  }

  const confirmedRows: OrderRowResult[] = [];
  const mcnLines: string[] = [];
  const shortfallLines: string[] = [];
  const addNullable = (current: number | null, add: number | null): number | null =>
    add === null ? current : (current ?? 0) + add;

  for (const [orderId, rawRows] of grouped) {
    const statuses = rawRows.map((r) => parseStatus(r.status));
    if (statuses.some((s) => s === null)) {
      result.skippedUnknownStatus += 1;
      result.errors.push(
        `[${orderId}] status la ${JSON.stringify(rawRows.map((r) => r.status ?? null))} - khong khop 1/2/3 da biet, bo qua ca don de tranh doan sai.`
      );
      continue;
    }

    const rows: Row[] = rawRows.map((raw, i) => ({
      raw,
      status: statuses[i] as 1 | 2 | 3,
      est: parseRiohubMoney(raw.est_commission),
      actual: parseRiohubMoney(raw.actual_commission),
      shared: parseRiohubMoney(raw.shared_with_partner),
      pit: parseRiohubMoney(raw.pit),
      gmv: parseRiohubMoney(raw.commission_gmv) ?? 0,
      created: parseIso(raw.time_created_iso),
      delivered: parseIso(raw.time_delivered_iso),
    }));

    // ---- Doi chieu quyet toan (muc 7): tinh cho MOI don, ke ca don khong quy duoc ve user - MCN giu
    // tien la su that cua ca tai khoan creator, khong phai chuyen rieng cua bot.
    const settled = rows.filter((r) => r.status === 2);
    if (settled.length > 0) {
      const t = result.settledTotals;
      t.orderCount += 1;
      for (const r of settled) {
        t.estTotal += r.est ?? 0;
        t.actualTotal = addNullable(t.actualTotal, r.actual);
        t.pitTotal = addNullable(t.pitTotal, r.pit);
        t.sharedWithPartnerTotal = addNullable(t.sharedWithPartnerTotal, r.shared);
      }
      const mcn = settled.reduce((s, r) => s + (r.shared ?? 0), 0);
      if (mcn !== 0) mcnLines.push(`${orderId}: MCN giữ ${formatVnd(Math.abs(mcn))}`);

      const comparable = settled.filter((r) => r.actual !== null && r.est !== null);
      if (comparable.length > 0) {
        const estSum = comparable.reduce((s, r) => s + (r.est as number), 0);
        const actualSum = comparable.reduce((s, r) => s + (r.actual as number), 0);
        if (isActualBelowAssumed(estSum, actualSum)) {
          t.shortfallCount += 1;
          shortfallLines.push(
            `${orderId}: ước tính ${formatVnd(estSum)} → đã trả user theo ${formatVnd(estimateTiktokNetCommission(estSum))}, thực nhận ${formatVnd(actualSum)}`
          );
        }
      }
    }

    // ---- Quy ve user (giong thu tu cua Shopee: khong co subId → khong khop → (them) sai san)
    const subIds = [
      ...new Set(
        rows
          .map((r) => (typeof r.raw.sub_id === "string" ? r.raw.sub_id.trim() : ""))
          .filter((s) => s !== "")
      ),
    ];
    if (subIds.length === 0) {
      result.skippedNoSubId += 1;
      continue;
    }
    if (subIds.length > 1) {
      result.errors.push(`[${orderId}] cac dong cua don co ${subIds.length} sub_id khac nhau - dung sub_id dau tien (${subIds[0]}).`);
    }
    const subId = subIds[0];

    const requestEntry = logStore.findBySubId(subId);
    if (!requestEntry || !requestEntry.merchant) {
      result.skippedSubIdNotFound += 1;
      continue;
    }
    // CHOT CACH LY (spec 6.1): CHI phia TikTok. subId khong ma hoa san nen co the khop request Shopee.
    if (requestEntry.merchant !== "tiktokshop") {
      result.skippedForeignMerchant += 1;
      result.errors.push(
        `[${orderId}] sub_id khop voi mot request cua san "${requestEntry.merchant}" chu khong phai TikTok Shop - bo qua, khong ghi ledger.`
      );
      continue;
    }

    if (rows.length > 1) result.mergedMultiSku += 1;

    // ---- Canh bao hoan mot phan (den bao re, spec 5.8): thiet ke khong doc cac field nay.
    for (const r of rows) {
      const refunded = parseRiohubMoney(r.raw.refunded_quantity) ?? 0;
      const returned = parseRiohubMoney(r.raw.returned_quantity) ?? 0;
      if (r.status !== 3 && (refunded > 0 || returned > 0 || truthyFlag(r.raw.fully_refunded))) {
        result.errors.push(
          `[${orderId}] sku ${r.raw.sku_id ?? "?"} co refunded_quantity=${refunded} returned_quantity=${returned} ` +
            `fully_refunded=${String(r.raw.fully_refunded ?? null)} nhung status=${r.status} - hoan MOT PHAN trong cung SKU chua co thiet ke xu ly, kiem tra tay.`
        );
      }
    }

    // ---- Phan loai ca don (thu tu LA MOT PHAN CUA LUAT, spec 5.3)
    const live = rows.filter((r) => r.status !== 3);
    let targetStatus: "confirmed" | "pending" | "reversed";
    if (live.length === 0) targetStatus = "reversed";
    else if (live.some((r) => r.status === 1 && r.delivered === null)) targetStatus = "pending";
    else targetStatus = "confirmed";

    // ---- Tien
    let commissionAmount = 0;
    if (targetStatus !== "reversed") {
      const ests = live.map((r) => r.est).filter((e): e is number => e !== null);
      if (ests.length === 0) {
        result.skippedNoEstimate += 1;
        result.errors.push(`[${orderId}] don con song nhung khong dong nao co est_commission - bo qua, khong co gi de ghi.`);
        continue;
      }
      if (ests.length < live.length) {
        result.errors.push(`[${orderId}] ${live.length - ests.length} dong thieu est_commission - tong hoa hong co the THAP hon thuc te.`);
      }
      commissionAmount = estimateTiktokNetCommission(ests.reduce((s, e) => s + e, 0));
    }
    const orderAmount = live.reduce((s, r) => s + r.gmv, 0);

    // ---- Ten san pham: dong hoa hong cao nhat + hau to (+N san pham khac)
    const nameRows = live.length > 0 ? live : rows;
    const best = nameRows.reduce((a, b) => ((b.est ?? 0) > (a.est ?? 0) ? b : a));
    const baseName = (best.raw.product_name ?? "").trim();
    const productName =
      baseName === "" ? null : nameRows.length > 1 ? `${baseName} (+${nameRows.length - 1} san pham khac)` : baseName;

    // ---- Ngay: dat don = dong SOM nhat (moi dong), giao hang = MUON nhat trong dong khong huy
    const createdTimes = rows.map((r) => r.created).filter((d): d is Date => d !== null);
    const earliest = createdTimes.length > 0 ? new Date(Math.min(...createdTimes.map((d) => d.getTime()))) : null;
    const deliveredTimes = live.map((r) => r.delivered).filter((d): d is Date => d !== null);
    const latestDelivered =
      deliveredTimes.length > 0 ? new Date(Math.max(...deliveredTimes.map((d) => d.getTime()))) : null;

    const importDay = todayVnIso();
    const outcomes = applyOrderStatusToLedger(
      ledgerStore,
      {
        orderId,
        targetStatus,
        subId,
        requestEntry: { platform: requestEntry.platform, userId: requestEntry.userId, merchant: requestEntry.merchant },
        orderAmount,
        commissionAmount,
        productName,
        orderDate: earliest ? formatVnDateIso(earliest) : null,
        orderTime: earliest ? formatVnTimeHms(earliest) : null,
        completedAt: latestDelivered ? formatVnDateIso(latestDelivered) : null,
        reverseReason: "RioHub ghi tat ca san pham cua don o trang thai huy/hoan (status 3)",
        notes: {
          confirmed: "Nhap tu RioHub TikTok (dong bo don) - da giao",
          pending: "Nhap tu RioHub TikTok (dong bo don) - chua giao hang",
        },
        sourceLabel: "RioHub",
        confirmedClaim: "RioHub ghi don da giao",
      },
      recordOrderConfig,
      importDay
    );

    for (const o of outcomes) {
      switch (o.kind) {
        case "confirmed-duplicate":
          result.confirmedDuplicate += 1;
          break;
        case "warning":
        case "error":
          result.errors.push(o.message);
          break;
        case "small-hold-deferred":
          if (o.newOrder) result.newOrderIds.push(orderId);
          result.smallHoldDeferred += 1;
          break;
        case "confirmed-new":
          if (o.newOrder) result.newOrderIds.push(orderId);
          if (o.wasPending) result.statusTransitions.push({ orderId, from: "pending", to: "confirmed" });
          result.confirmedNew += 1;
          if (o.held) result.heldCount += 1;
          confirmedRows.push({
            line: 0,
            subId,
            orderId,
            ok: true,
            detail: "tiktok-order-import",
            platform: o.entry.platform,
            userId: o.entry.userId,
            userShareAmount: o.entry.userShareAmount,
            productName: o.entry.productName,
          });
          break;
        case "pending-new":
          result.pendingNew += 1;
          result.newOrderIds.push(orderId);
          break;
        case "pending-updated":
          result.pendingUpdated += 1;
          break;
        case "reversed":
          result.reversedCount += 1;
          result.statusTransitions.push({ orderId, from: o.from, to: "reversed" });
          break;
        case "reversed-unseen":
          break;
        case "debt-created":
          result.debtCreatedCount += 1;
          result.debtsByUser.push({ platform: o.platform, userId: o.userId, orderId: o.orderId, amount: o.amount });
          break;
        case "withdrawal-cancelled":
          result.cancelledWithdrawals.push({
            platform: o.platform,
            userId: o.userId,
            withdrawalId: o.withdrawalId,
            amount: o.amount,
            orderId: o.orderId,
          });
          break;
      }
    }
  }

  if (mcnLines.length > 0) {
    const alert = buildAlert(
      "tiktok_mcn_cut",
      "⚠️ TikTok: MCN đang giữ một phần hoa hồng (shared_with_partner ≠ 0). Thoả thuận 0% không còn đúng, và số ước tính bot đã báo/trả cho user đang CAO hơn thực nhận.",
      mcnLines
    );
    result.alerts.push(alert);
    result.errors.push(alert.message);
  }
  if (shortfallLines.length > 0) {
    const alert = buildAlert(
      "tiktok_actual_below_assumed",
      "⚠️ TikTok: hoa hồng thực nhận (actual_commission) THẤP hơn số đã dùng để trả user. Kiểm tra pit thật / TIKTOK_PIT_RETAINED_RATIO (tiktokCommission.ts). Tiền đã trả user không lấy lại được.",
      shortfallLines
    );
    result.alerts.push(alert);
    result.errors.push(alert.message);
  }

  result.confirmedByUser = summarizeOrderResultsByUser(confirmedRows);
  return result;
}
