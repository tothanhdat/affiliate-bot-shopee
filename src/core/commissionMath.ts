/**
 * Phep tinh chia hoa hong 1 don hang - tach ra day (thay vi de nguyen trong ledgerStore) vi CO HAI
 * noi can no: ledgerStore.recordConversion() ghi tien that vao DB, va trang So tay hoan tien
 * (/so-tay) hien vi du minh hoa cho user. Neu 2 noi tu tinh rieng thi So tay se hua 1 con so ma
 * dashboard tra 1 con so khac.
 *
 * Thu tu tru (tham khao theo cach 1 bot doi thu hien thi, chot 2026-08-17): thue tinh tren hoa hong
 * GOC -> phi san tinh tren phan DA TRU THUE (khong phai tren hoa hong goc) -> phan user nhan tinh
 * tren phan con lai sau ca thue va phi.
 */

export interface CommissionBreakdownInput {
  commissionAmount: number;
  taxPercent: number;
  platformFeePercent: number;
  userSharePercent: number;
}

export interface CommissionBreakdown {
  /** Tien thue tru tren hoa hong goc. */
  taxAmount: number;
  /** Con lai sau khi tru thue, TRUOC khi tru phi san - la co so de tinh phi san. */
  afterTaxOnly: number;
  platformFeeAmount: number;
  /** Con lai sau ca thue lan phi san - la co so de chia cho user va chu bot. */
  afterTaxAmount: number;
  userShareAmount: number;
  /** Phan chu bot giu lai. */
  botShareAmount: number;
}

export function computeCommissionBreakdown(input: CommissionBreakdownInput): CommissionBreakdown {
  const taxAmount = Math.round((input.commissionAmount * input.taxPercent) / 100);
  const afterTaxOnly = input.commissionAmount - taxAmount;
  const platformFeeAmount = Math.round((afterTaxOnly * input.platformFeePercent) / 100);
  const afterTaxAmount = afterTaxOnly - platformFeeAmount;
  const userShareAmount = Math.round((afterTaxAmount * input.userSharePercent) / 100);
  // Phan chu bot la PHAN CON LAI, khong lam tron rieng - lam tron ca 2 phia thi tong 2 phan co the
  // lech vai dong so voi afterTaxAmount.
  const botShareAmount = afterTaxAmount - userShareAmount;

  return { taxAmount, afterTaxOnly, platformFeeAmount, afterTaxAmount, userShareAmount, botShareAmount };
}
