import { AppError, SubIdNotFoundError } from "./errors.js";
import type { LedgerStore } from "./ledgerStore.js";
import type { LogStore } from "./logStore.js";
import type { CommissionEntry } from "./types.js";

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

export interface RecordOrderInput {
  subId: string;
  orderId: string;
  productName?: string;
  orderAmount: number;
  commissionAmount: number;
  note?: string;
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
  });
}

export interface OrderRowResult {
  line: number;
  subId: string;
  orderId: string;
  ok: boolean;
  detail: string;
}

/**
 * Ghi nhan hang loat tu du lieu CSV da parse (mang object theo cot) - moi dong xu ly doc lap,
 * 1 dong loi khong lam hong ca batch (dung chung boi record-conversions-csv CLI va upload web).
 * Header bat buoc: subId,orderId,orderAmount,commissionAmount. productName,note tuy chon.
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

    if (!subId || !orderId || !Number.isFinite(orderAmount) || !Number.isFinite(commissionAmount)) {
      return {
        line,
        subId,
        orderId,
        ok: false,
        detail: "Thieu subId/orderId hoac orderAmount/commissionAmount khong phai so",
      };
    }

    try {
      const entry = recordOrderFromAccesstrade(logStore, ledgerStore, config, {
        subId,
        orderId,
        productName,
        orderAmount,
        commissionAmount,
        note,
      });
      return { line, subId, orderId, ok: true, detail: `user_share=${entry.userShareAmount}d` };
    } catch (err) {
      const detail = err instanceof AppError ? err.userMessage : (err as Error).message;
      return { line, subId, orderId, ok: false, detail };
    }
  });
}
