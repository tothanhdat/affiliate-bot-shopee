import type { Platform } from "./types.js";

/**
 * % hoa hong RIENG cho 1 user, co han su dung (2026-10-01). Ai duoc muc nao do admin quyet dinh tay
 * tren /admin/users - he thong khong tu chon, khong tu gia han.
 *
 * MOC SO SANH la ngay user DAT don (order_date doc tu bao cao Shopee), KHONG phai ngay admin import:
 * Shopee bao cao tre vai ngay nen so voi ngay import se lam don mua sat han mat uu dai - chuyen xay
 * ra thuong xuyen chu khong phai edge case. Don khong biet ngay dat (ghi tay, bao cao cu thieu cot)
 * thi caller truyen ngay HOM NAY gio VN - thong tin gan dung nhat co duoc, khong doan nguoc.
 *
 * startDate = ngay admin bam Luu, KHONG phai tham so tren form: thieu no thi 1 uu dai tao hom nay
 * se vo tinh nang % cho ca don ton dong mua tu thang truoc o lan import ke tiep (don do co
 * order_date cu, nam "trong han" neu chi xet endDate).
 *
 * Ty le nay duoc dung LUC GHI NHAN don roi CHOT vao entry (xem ledgerStore.recordConversion) - doi
 * hay xoa override ve sau khong sua don da ghi.
 */
export interface UserCommissionOverride {
  platform: Platform;
  userId: string;
  /** % user nhan tren phan hoa hong da tru thue/phi san. Duoc phep THAP hon % chung - form canh bao. */
  userSharePercent: number;
  /** "YYYY-MM-DD" gio VN - ngay admin luu uu dai, khoang han bat dau tu day (tinh vao). */
  startDate: string;
  /** "YYYY-MM-DD" gio VN, tinh vao han. null = khong han. */
  endDate: string | null;
  updatedAt: string;
}

/**
 * Ngay `dateVn` ("YYYY-MM-DD") co nam trong han cua override khong - CA 2 DAU DEU TINH VAO.
 * So sanh chuoi "YYYY-MM-DD" truc tiep: dinh dang nay sap xep tu dien trung voi sap xep thoi gian,
 * nen khong can dung Date (tranh luon chuyen doi mui gio o cho khong can thiet).
 */
export function isOverrideActiveOn(override: UserCommissionOverride, dateVn: string): boolean {
  if (dateVn < override.startDate) return false;
  if (override.endDate !== null && dateVn > override.endDate) return false;
  return true;
}

/**
 * % user nhan cho 1 don dat vao ngay `dateVn`: % rieng neu con han, khong thi % chung hien hanh.
 * Luu y `userSharePercent === 0` la gia tri THAT (chu bot giu toan bo) - khong duoc dung `||` o day.
 */
export function resolveUserSharePercent(
  override: UserCommissionOverride | null,
  generalPercent: number,
  dateVn: string
): number {
  if (override && isOverrideActiveOn(override, dateVn)) {
    return override.userSharePercent;
  }
  return generalPercent;
}
