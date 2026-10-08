import { SubIdNotFoundError } from "./errors.js";
import type { LedgerStore } from "./ledgerStore.js";
import type { LogStore } from "./logStore.js";
import type { PayoutHoldConfig } from "./payoutHold.js";
import type { CommissionEntry, CommissionStatus, Platform } from "./types.js";
import { todayVnIso } from "./vietnamDate.js";

/**
 * Logic ghi nhan 1 don hang dung CHUNG boi ledgerAdmin.ts (CLI) va trang admin web
 * (/admin/record-orders) - tach ra day de 2 noi khong lap lai cung 1 logic (tra subId -> suy ra
 * platform/userId/merchant -> goi ledgerStore.recordConversion voi cac ty le tu config).
 */
export interface RecordOrderConfig {
  taxPercent: number;
  platformFeePercent: number;
  userSharePercent: number;
  maxCommissionRatioPercent: number;
  /**
   * Quy tac giam tien don to (2026-10-08, xem payoutHold.ts). Caller doc tu LedgerStore chu khong tu
   * env truc tiep - admin doi o /admin/settings phai co hieu luc ngay khong can restart.
   */
  holdConfig: PayoutHoldConfig;
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

export function recordSingleOrder(
  logStore: LogStore,
  ledgerStore: LedgerStore,
  config: RecordOrderConfig,
  input: RecordOrderInput
): CommissionEntry {
  const requestEntry = logStore.findBySubId(input.subId);
  if (!requestEntry || !requestEntry.merchant) {
    throw new SubIdNotFoundError(input.subId);
  }

  // Form "Ghi 1 don le" khong co truong ngay dat don, nen han uu dai % rieng tinh theo HOM NAY gio VN
  // - thong tin gan dung nhat co duoc, khong doan nguoc (xem userCommissionOverride.ts).
  const userSharePercent = ledgerStore.resolveUserSharePercent(
    requestEntry.platform,
    requestEntry.userId,
    todayVnIso(),
    config.userSharePercent
  );

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
    userSharePercent,
    maxCommissionRatioPercent: config.maxCommissionRatioPercent,
    // Form "Ghi 1 don le" khong co truong ngay giao hang -> completedAt null, moc giam lui ve HOM NAY
    // (thong tin gan dung nhat co duoc, khong doan nguoc - giong cach xu li han uu dai % o tren).
    completedAt: null,
    holdConfig: config.holdConfig,
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
 * voi shopeeReportImport.ts (entry "pending" KHONG kich hoat DM "don da duoc xac nhan", user se
 * duoc bao sau khi don thuc su chuyen sang confirmed). r.status undefined coi nhu "confirmed".
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
