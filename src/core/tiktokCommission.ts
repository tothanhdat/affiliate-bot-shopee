/**
 * Hang so + phep tinh hoa hong TikTok dung CHUNG o hai noi (spec 5.4b):
 *  1. tiktokOrderImport.ts  - hoa hong goc ghi vao ledger.
 *  2. tiktokAffiliateProvider.ts (estimateFrom) - cau uoc tinh bot gui LUC TRA LINK.
 * Lech nhau = bot noi sai. Co test chan.
 */

/**
 * Phan hoa hong con lai SAU khi TikTok khau tru thue TNCN tai nguon (field `pit`).
 *
 * 0,9 doc tu tai lieu RioHub ("10% phan HH chuan, ap cho ca creator thuong") - CHUA DO duoc tren don
 * that nao vi chua don nao quyet toan. Doi so nay khi thay `pit` that: canh bao
 * `tiktok_actual_below_assumed` (spec 7.1b) la thu bat duoc dung luc do.
 *
 * Vi sao phai co: `est_commission` va gia tri `estimateFrom()` deu la so THO (GMV x rate), chua tru
 * thue. Dua so tho vao duong tien la hua cao hon thuc nhan tren MOI don.
 */
export const TIKTOK_PIT_RETAINED_RATIO = 0.9;

/** Bien bo qua khi so actual voi so da tra user: hap thu lam tron va phi reward nho (spec 7.1b). */
export const TIKTOK_ACTUAL_SHORTFALL_SLACK = 0.02;

/** Hoa hong goc TikTok dua vao ledger / cau uoc tinh, tu hoa hong THO. Lam tron DUNG MOT LAN. */
export function estimateTiktokNetCommission(grossVnd: number): number {
  return Math.round(grossVnd * TIKTOK_PIT_RETAINED_RATIO);
}

/**
 * actual_commission (sau khi quyet toan) co THAP HON so da dung de tra user khong? So thang voi
 * `assumed` tru bien - KHONG dung bieu thuc thu hai cho cung mot nguong (de lech khi sua).
 * Thuc nhan CAO hon so da tra thi KHONG phai van de (tra it hon nhan).
 */
export function isActualBelowAssumed(estVnd: number, actualVnd: number): boolean {
  const assumed = estimateTiktokNetCommission(estVnd);
  const slack = Math.round(estVnd * TIKTOK_ACTUAL_SHORTFALL_SLACK);
  return actualVnd < assumed - slack;
}
