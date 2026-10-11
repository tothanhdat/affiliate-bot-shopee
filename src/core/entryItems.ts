import type { MerchantId } from "./merchants.js";

/**
 * Chi tiet TUNG SAN PHAM cua 1 don nhieu mon (2026-10-11) - CHI de HIEN THI, khong tham gia tinh
 * tien: tien cua don van la 1 entry trong commission_entries (da cong dung tu 2026-09-10 qua
 * mergeOrderRows). Bang nay chi giu lai phan chi tiet ma truoc do bi vut di sau khi gop.
 *
 * Qua tang (gia niem yet = 0) KHONG bao gio vao day - loc o shopeeReportImport.mergeOrderRows.
 */
export type EntryItemStatus = "confirmed" | "pending" | "reversed";

export interface EntryItemInput {
  itemId: string;
  /** "" khi bao cao thieu cot "ID Model". Nam trong khoa chinh: cung item_id khac model la 2 mon. */
  modelId: string;
  productName: string;
  quantity: number;
  /** VND, cot "Gia tri don hang (d)" cua CHINH dong do (KHONG phai cot "Gia" niem yet). */
  orderAmount: number;
  /** VND, cot "Tong hoa hong san pham(d)" cua chinh dong do. KHONG lam tron: Shopee tra le toi phan nghin. */
  commissionAmount: number;
  rowStatus: EntryItemStatus;
}

export interface CommissionEntryItem extends EntryItemInput {
  merchant: MerchantId;
  orderId: string;
}

export function entryItemsKey(merchant: string, orderId: string): string {
  return `${merchant}:${orderId}`;
}

/** Sai so so thuc khi cong cac mon - so goc deu la tong cua CHINH cac dong do nen thuc te la ~1e-9. */
const RECONCILE_TOLERANCE = 0.01;

/**
 * Cac mon (khong tinh mon da huy) cong lai co DUNG BANG "Gia tri don" va "Hoa hong" cua don khong.
 * Day la dieu kien de hien danh sach cho user: loi hua cua khoi chi tiet la "cong lai ra dung so
 * tren the", mot danh sach khong khop thi gay hieu nham hon la khong hien.
 * Khong khop khi: admin da khoa/sua tay hoa hong, hoac don co dong khong doc duoc (thieu item_id).
 */
export function entryItemsReconcile(
  entry: { orderAmount: number; commissionAmount: number },
  items: readonly CommissionEntryItem[]
): boolean {
  let amount = 0;
  let commission = 0;
  for (const i of items) {
    if (i.rowStatus === "reversed") continue;
    amount += i.orderAmount;
    commission += i.commissionAmount;
  }
  return (
    Math.abs(amount - entry.orderAmount) < RECONCILE_TOLERANCE &&
    Math.abs(commission - entry.commissionAmount) < RECONCILE_TOLERANCE
  );
}
