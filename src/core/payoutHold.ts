/**
 * Giam co dieu kien tien cua don TO truoc khi cho rut (2026-10-08).
 *
 * Van de: Shopee bat trang thai "Hoan thanh" cho don affiliate NGAY LUC GIAO HANG, khong phai sau
 * khi het thoi gian duoc tra hang - do tren bao cao that, khoang "Thoi Gian Dat Hang" -> "Thoi gian
 * hoan thanh" chi la median 2,5 ngay (min 0,9 - max 8,0). Trong khi do chinh sach Shopee (dieu 3.2,
 * hieu luc 11/03/2026) cho nguoi mua gui yeu cau tra hang trong 15 NGAY ke tu luc giao hang thanh
 * cong. Nghia la tu luc he thong mo "Kha dung", cua so rui ro con lai gan nhu tron 15 ngay.
 *
 * Vi sao chi giam don TO (khong giam tat): tien tap trung vao vai don. Tren bao cao 01/10/2026,
 * 2 trong 46 dong chiem 35,8% hoa hong ca thang - mot don to bi tra hang xoa sach loi nhuan thang
 * do, con hang chuc don nho thi thiet hai khong dang ke. Giam tat chi lam MOI user phai doi trong
 * khi so nguoi tra hang rat it.
 */
import { addDaysToVnIso } from "./vietnamDate.js";

/**
 * Quy tac giam. Hai so nay admin sua duoc ngay tai /admin/settings (xem SETTINGS_REGISTRY), .env
 * chi la gia tri khoi tao/fallback.
 */
export interface PayoutHoldConfig {
  /** user_share_amount tu muc nay tro len thi bi giam. <= 0 = TAT han tinh nang. */
  thresholdVnd: number;
  /** So ngay giam, dem tu ngay Shopee ghi don "Hoan thanh" (= ngay giao hang). */
  holdDays: number;
}

/**
 * Tra ngay mo khoa ("YYYY-MM-DD" gio VN) cho 1 entry VUA chuyen sang confirmed, hoac null = kha
 * dung ngay.
 *
 * Vi sao dem tu completedAtVn chu khong tu ngay import: do la DUNG moc Shopee dem 15 ngay duoc tra
 * hang, nen cau giai thich cho user kiem chung duoc, va hold khong bi dai them chi vi admin import
 * tre may ngay.
 *
 * Ket qua cua ham nay duoc GHI VAO cot available_from va KHONG BAO GIO tinh lai - admin nang hold
 * tu 7 len 15 ngay hom nay khong duoc keo dai thoi gian giam cua don user DA MUA tu tuan truoc
 * (cung ly do 3 cot *_percent phai chot theo tung don, xem CLAUDE.md).
 */
export function resolveAvailableFrom(params: {
  userShareAmount: number;
  /** Tu cot "Thời gian hoàn thành" cua bao cao Shopee. null khi bao cao thieu / ghi don le bang tay. */
  completedAtVn: string | null;
  /** Lui ve moc nay khi khong biet ngay giao hang - caller truyen todayVnIso(). */
  fallbackDayVn: string;
  config: PayoutHoldConfig;
}): string | null {
  const { userShareAmount, completedAtVn, fallbackDayVn, config } = params;
  if (config.thresholdVnd <= 0) return null;
  // So sanh la ">=" chu khong ">": dung bang nguong thi BI giam (co test chan). Va dung so sanh
  // truc tiep chu khong qua `||`/truthiness - userShareAmount === 0 la gia tri THAT (chu bot giu
  // toan bo hoa hong), giong bay da gap voi userSharePercent === 0.
  if (userShareAmount < config.thresholdVnd) return null;
  return addDaysToVnIso(completedAtVn ?? fallbackDayVn, config.holdDays);
}
