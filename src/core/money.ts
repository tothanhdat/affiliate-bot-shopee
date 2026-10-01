/**
 * Dinh dang so tien VND - ham DUY NHAT cho ca he thong (trang web, tin nhan bot, cau loi).
 *
 * Truoc 2026-10-01 co 4 ban sao roi rac (htmlHelpers.ts, replyText.ts, faqService.ts va
 * toLocaleString tho trong errors.ts), trong do ban cua htmlHelpers.ts QUEN lam tron - cung 1 don
 * nhung dashboard hien "146.457,765đ" con tin nhan bot hien "146.458đ".
 *
 * LUON ra so nguyen: Shopee tra hoa hong le toi phan nghin dong (vd 22.990,5d) nen so tien trong DB
 * la so thuc. Lam tron CHI o buoc hien thi - so trong DB giu nguyen do chinh xac, moi phep tinh van
 * chay tren so goc (xem commissionMath.ts).
 *
 * Nam trong src/core (khong phai src/api) de errors.ts va cac adapter dung chung duoc - core khong
 * duoc import nguoc tu src/api.
 */
export function formatVnd(amount: number): string {
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(amount)}đ`;
}
