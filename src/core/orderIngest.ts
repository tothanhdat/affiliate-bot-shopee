import { AppError, SubIdNotFoundError } from "./errors.js";
import type { LedgerStore } from "./ledgerStore.js";
import type { LogStore } from "./logStore.js";
import type { CommissionEntry, CommissionStatus, Platform } from "./types.js";

/**
 * Logic ghi nhan 1 don hang tu Accesstrade dung CHUNG boi ledgerAdmin.ts (CLI) va trang admin web
 * (/admin/record-orders) - tach ra day de 2 noi khong lap lai cung 1 logic (tra subId -> suy ra
 * platform/userId/merchant -> goi ledgerStore.recordConversion voi cac ty le tu config).
 */
export interface RecordOrderConfig {
  taxPercent: number;
  platformFeePercent: number;
  userSharePercent: number;
  maxCommissionRatioPercent: number;
}

/**
 * Trang thai admin duoc chon tay khi ghi nhan don qua form don le/CSV (2026-08-21, yeu cau truc
 * tiep cua user) - CHI 2 gia tri nay duoc phep chon (khong phai "paid"/"reversed", 2 trang thai do
 * chi dat duoc qua rut tien/huy don, khong phai luc ghi nhan). Mac dinh "confirmed" (Kha dung) neu
 * khong truyen - giu nguyen hanh vi truoc khi co tinh nang nay.
 */
export type RecordableOrderStatus = Extract<CommissionStatus, "pending" | "confirmed">;

export interface RecordOrderInput {
  subId: string;
  orderId: string;
  productName?: string;
  orderAmount: number;
  commissionAmount: number;
  note?: string;
  status?: RecordableOrderStatus;
}

export function recordOrderFromAccesstrade(
  logStore: LogStore,
  ledgerStore: LedgerStore,
  config: RecordOrderConfig,
  input: RecordOrderInput
): CommissionEntry {
  const requestEntry = logStore.findBySubId(input.subId);
  if (!requestEntry || !requestEntry.merchant) {
    throw new SubIdNotFoundError(input.subId);
  }

  return ledgerStore.recordConversion({
    subId: input.subId,
    platform: requestEntry.platform,
    userId: requestEntry.userId,
    merchant: requestEntry.merchant,
    orderId: input.orderId,
    productName: input.productName,
    orderAmount: input.orderAmount,
    commissionAmount: input.commissionAmount,
    taxPercent: config.taxPercent,
    platformFeePercent: config.platformFeePercent,
    userSharePercent: config.userSharePercent,
    maxCommissionRatioPercent: config.maxCommissionRatioPercent,
    note: input.note,
    status: input.status,
  });
}

export interface OrderRowResult {
  line: number;
  subId: string;
  orderId: string;
  ok: boolean;
  detail: string;
  /** Chi co gia tri khi ok=true - dung de gom nhom thong bao theo user (xem summarizeOrderResultsByUser). */
  platform?: Platform;
  userId?: string;
  userShareAmount?: number;
  productName?: string | null;
  status?: RecordableOrderStatus;
}

/**
 * Ghi nhan hang loat tu du lieu CSV da parse (mang object theo cot) - moi dong xu ly doc lap,
 * 1 dong loi khong lam hong ca batch (dung chung boi record-conversions-csv CLI va upload web).
 * Header bat buoc: subId,orderId,orderAmount,commissionAmount. productName,note,status tuy chon
 * (status: "pending" hoac "confirmed", mac dinh "confirmed" neu de trong - xem RecordableOrderStatus).
 */
export function recordOrdersFromCsv(
  logStore: LogStore,
  ledgerStore: LedgerStore,
  config: RecordOrderConfig,
  rows: Record<string, string>[]
): OrderRowResult[] {
  return rows.map((row, idx) => {
    const line = idx + 2; // +1 cho header, +1 cho index bat dau tu 0
    const subId = row.subId?.trim() ?? "";
    const orderId = row.orderId?.trim() ?? "";
    const orderAmount = Number(row.orderAmount);
    const commissionAmount = Number(row.commissionAmount);
    const productName = row.productName?.trim() || undefined;
    const note = row.note?.trim() || undefined;
    const statusRaw = row.status?.trim().toLowerCase() || "confirmed";

    if (!subId || !orderId || !Number.isFinite(orderAmount) || !Number.isFinite(commissionAmount)) {
      return {
        line,
        subId,
        orderId,
        ok: false,
        detail: "Thieu subId/orderId hoac orderAmount/commissionAmount khong phai so",
      };
    }
    if (statusRaw !== "pending" && statusRaw !== "confirmed") {
      return {
        line,
        subId,
        orderId,
        ok: false,
        detail: `Cot status "${row.status}" khong hop le - chi nhan "pending" hoac "confirmed"`,
      };
    }
    const status: RecordableOrderStatus = statusRaw;

    try {
      const entry = recordOrderFromAccesstrade(logStore, ledgerStore, config, {
        subId,
        orderId,
        productName,
        orderAmount,
        commissionAmount,
        note,
        status,
      });
      return {
        line,
        subId,
        orderId,
        ok: true,
        detail: `user_share=${entry.userShareAmount}d, status=${entry.status}`,
        platform: entry.platform,
        userId: entry.userId,
        userShareAmount: entry.userShareAmount,
        productName: entry.productName,
        status: entry.status as RecordableOrderStatus,
      };
    } catch (err) {
      const detail = err instanceof AppError ? err.userMessage : (err as Error).message;
      return { line, subId, orderId, ok: false, detail };
    }
  });
}

/** 1 don da xac nhan - dung boi formatOrdersConfirmedReply() de hien ten san pham + so tien nhan duoc. */
export interface ConfirmedOrderItem {
  orderId: string;
  productName: string | null;
  userShareAmount: number;
}

export interface UserOrderSummary {
  platform: Platform;
  userId: string;
  items: ConfirmedOrderItem[];
}

/**
 * Gom cac dong OK trong 1 lot record-conversions-csv theo (platform, userId) - dung de gui 1 tin
 * nhan thong bao gop cho moi user thay vi N tin cho N don (phan-hoi-cai-thien-trai-nghiem-nguoi-dung.md
 * muc 1, Option B). Bo qua cac dong loi (ok=false). Giu lai productName tung don (2026-08-20, yeu
 * cau truc tiep cua user) de formatOrdersConfirmedReply liet ke ro tung don thay vi chi tong so tien.
 *
 * CHI gom don da "confirmed" (2026-08-21, sau khi them lua chon status luc ghi nhan) - dong nhat
 * voi accesstradeSync.ts (entry "pending" KHONG kich hoat DM "don da duoc xac nhan", user se duoc
 * bao sau khi don thuc su chuyen sang confirmed). r.status undefined (dong CSV cu, truoc khi co
 * cot status) coi nhu "confirmed" - khop default cua recordOrdersFromCsv.
 */
export function summarizeOrderResultsByUser(results: OrderRowResult[]): UserOrderSummary[] {
  const map = new Map<string, UserOrderSummary>();
  for (const r of results) {
    if (!r.ok || !r.platform || !r.userId || r.userShareAmount === undefined) continue;
    if (r.status !== undefined && r.status !== "confirmed") continue;
    const key = `${r.platform}:${r.userId}`;
    const item: ConfirmedOrderItem = {
      orderId: r.orderId,
      productName: r.productName ?? null,
      userShareAmount: r.userShareAmount,
    };
    const existing = map.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      map.set(key, { platform: r.platform, userId: r.userId, items: [item] });
    }
  }
  return [...map.values()];
}
