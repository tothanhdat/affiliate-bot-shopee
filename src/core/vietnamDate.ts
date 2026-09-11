/**
 * Ngay thang theo gio Viet Nam (Asia/Ho_Chi_Minh) dung cho NOI DUNG TIN NHAN gui cho user - khac
 * htmlHelpers.ts (cung co logic gio VN nhung la cho trang HTML admin/dashboard, nam trong src/api
 * nen core khong import duoc).
 *
 * Tach file rieng (thay vi tinh thang trong server.ts) de test duoc cac moc de sai: nua dem gio VN
 * khong phai nua dem UTC (lech +07), doi thang, doi nam. Moi ham nhan `now` de test chot duoc thoi
 * diem, khong phu thuoc dong ho may chay test.
 *
 * Viet Nam khong co DST (luon UTC+07 co dinh), nen "tru 24 tieng roi format lai theo gio VN" luon
 * ra dung ngay hom truoc - khong can thu vien timezone.
 */

const VN_TIME_ZONE = "Asia/Ho_Chi_Minh";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** "dd/mm" (co padding 0) cua 1 thoi diem, tinh theo gio VN. Khong kem nam - theo yeu cau hien thi. */
export function formatVnDateDdMm(date: Date): string {
  // en-CA cho dinh dang "YYYY-MM-DD" on dinh (khong phu thuoc locale may chay), de tach lay dd/mm.
  const [, month, day] = date.toLocaleDateString("en-CA", { timeZone: VN_TIME_ZONE }).split("-");
  return `${day}/${month}`;
}

/** "dd/mm" cua ngay HOM QUA theo gio VN - dung cho thong bao "don hang ngay {{date}} da cap nhat". */
export function yesterdayVnDdMm(now: Date = new Date()): string {
  return formatVnDateDdMm(new Date(now.getTime() - ONE_DAY_MS));
}
