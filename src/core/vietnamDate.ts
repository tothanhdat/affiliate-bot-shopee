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

/**
 * "YYYY-MM-DD" cua 1 thoi diem theo gio VN. Dung lam moc so sanh ngay (han uu dai % hoa hong rieng,
 * xem userCommissionOverride.ts) chu khong de hien thi - dinh dang nay sap xep tu dien trung voi
 * sap xep thoi gian nen so sanh duoc bang toan tu chuoi.
 */
export function formatVnDateIso(date: Date): string {
  // en-CA tra ve dung "YYYY-MM-DD" va khong phu thuoc locale cua may chay.
  return date.toLocaleDateString("en-CA", { timeZone: VN_TIME_ZONE });
}

/** "YYYY-MM-DD" cua HOM NAY theo gio VN. */
export function todayVnIso(now: Date = new Date()): string {
  return formatVnDateIso(now);
}

/** "dd/mm" cua ngay HOM QUA theo gio VN - dung cho thong bao "don hang ngay {{date}} da cap nhat". */
export function yesterdayVnDdMm(now: Date = new Date()): string {
  return formatVnDateDdMm(new Date(now.getTime() - ONE_DAY_MS));
}

/**
 * Cong `days` ngay vao 1 ngay lich "YYYY-MM-DD" (gio VN), tra ve cung dinh dang.
 *
 * Dung Date.UTC co chu dich: input DA la ngay lich VN roi, khong can doi mui gio lan nua - neu dung
 * `new Date("2026-10-01")` roi setDate() thi ket qua phu thuoc mui gio cua MAY CHAY (Railway chay
 * UTC, may dev chay +07), tuc cung 1 input ra 2 ket qua khac nhau.
 */
export function addDaysToVnIso(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const base = Date.UTC(year, month - 1, day);
  return new Date(base + days * ONE_DAY_MS).toISOString().slice(0, 10);
}
