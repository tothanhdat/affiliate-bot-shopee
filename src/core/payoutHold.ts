/**
 * Giu lai tien cua don truoc khi cho rut (2026-10-08, mo rong 2026-10-11).
 *
 * Van de: Shopee bat trang thai "Hoan thanh" cho don affiliate NGAY LUC GIAO HANG, khong phai sau
 * khi het thoi gian duoc tra hang - do tren bao cao that, khoang "Thoi Gian Dat Hang" -> "Thoi gian
 * hoan thanh" chi la median 2,5 ngay (min 0,9 - max 8,0). Trong khi do chinh sach Shopee (dieu 3.2,
 * hieu luc 11/03/2026) cho nguoi mua gui yeu cau tra hang trong 15 NGAY ke tu luc giao hang thanh
 * cong. Nghia la tu luc he thong mo "Kha dung", cua so rui ro con lai gan nhu tron 15 ngay.
 *
 * HAI MUC, KHAC NHAU CA VE THOI GIAN LAN VE CACH NOI VOI USER:
 *
 * 1. Don TO (user_share >= thresholdVnd): vao `confirmed` ngay nhung `available_from` o tuong lai ->
 *    dashboard hien "Dang tam giu" kem ngay mo khoa, tin "don ve" co dong "Trong do X mo khoa tu
 *    dd/mm". Noi ro la dung: day la so tien lon, user can biet vi sao chua rut duoc.
 *
 * 2. Don NHO (duoi nguong, 2026-10-11 - yeu cau truc tiep cua user): giu nguyen `pending` them
 *    `smallHoldDays` ngay roi moi cho vao `confirmed`. KHONG dung duong "Dang tam giu" o day: voi
 *    mot don 40.000d bi giam dung 1 ngay thi the "Dang tam giu" + ngay mo khoa lam user thay tien
 *    cua minh bi khoa vi mot ly do kho hieu, trong khi "Cho xac nhan" la dieu ho von da hieu san
 *    ("san chua cap nhat kip, mai la xong"). Toan bo phan hien thi va thong bao di theo trang thai
 *    `pending` co san - khong co cho nao phai noi doi, va khong he nhac den ngay mo khoa.
 *
 * Vi sao chi giam don TO lau (7 ngay) chu khong giam tat: tien tap trung vao vai don. Tren bao cao
 * 01/10/2026, 2 trong 46 dong chiem 35,8% hoa hong ca thang - mot don to bi tra hang xoa sach loi
 * nhuan thang do, con hang chuc don nho thi thiet hai khong dang ke.
 */
import { addDaysToVnIso } from "./vietnamDate.js";

/**
 * Quy tac giu tien. Ca 3 so admin sua duoc ngay tai /admin/settings (xem SETTINGS_REGISTRY), .env
 * chi la gia tri khoi tao/fallback.
 */
export interface PayoutHoldConfig {
  /** user_share_amount tu muc nay tro len thi la don TO. <= 0 = TAT han tinh nang (ca 2 muc). */
  thresholdVnd: number;
  /** So ngay giam don TO, dem tu ngay Shopee ghi don "Hoan thanh" (= ngay giao hang). */
  holdDays: number;
  /**
   * So ngay don NHO nam lai o "Cho xac nhan" truoc khi vao Kha dung (2026-10-11). Dem tu cung moc
   * `completed_at` nhu don to. 0 hoac thieu han = khong cho (dung hanh vi truoc 2026-10-11).
   *
   * CO Y de TUY CHON: 74 cho dung config nay trong test dang mo ta hanh vi cu, va mac dinh "khong
   * cho" la phia an toan - mot call site moi quen truyen so nay thi user mat tinh nang, chu khong
   * phai mat tien khoi so du Kha dung. Moi cho doc settings that PHAI truyen tuong minh.
   */
  smallHoldDays?: number;
}

/** Trang thai + ngay vao Kha dung cua 1 don vua duoc bao cao Shopee ghi la "Hoan thanh". */
export interface ConfirmPlan {
  /** "pending" = don nho dang cho them vai ngay (user thay "Cho xac nhan"). */
  status: "confirmed" | "pending";
  /** "YYYY-MM-DD" gio VN, hoac null = kha dung ngay. */
  availableFrom: string | null;
}

/**
 * Quyet dinh DUY NHAT tren duong tien ve chuyen "don nay vao Kha dung luc nao".
 *
 * Ket qua duoc GHI VAO cot available_from va KHONG BAO GIO tinh lai: lan sau ham nay duoc goi lai
 * cho cung don do (bao cao Shopee liet ke lai ca lich su moi lan import), `plannedAvailableFrom`
 * mang chinh gia tri da chot va duoc tra ve nguyen xi - admin nang so ngay giam hom nay khong duoc
 * keo dai thoi gian cho cua don user DA MUA tu hom truoc (cung ly do 3 cot *_percent phai chot theo
 * tung don, xem CLAUDE.md). He qua doi xung cung duoc chap nhan: ha so ngay xuong khong rut ngan
 * don da chot.
 *
 * Vi sao dem tu completedAtVn chu khong tu ngay import: do la DUNG moc Shopee dem 15 ngay duoc tra
 * hang, nen cau giai thich cho user kiem chung duoc, va thoi gian cho khong bi dai them chi vi admin
 * import tre may ngay (don giao tu lau se co availableFrom <= hom nay -> vao Kha dung ngay).
 */
export function resolveConfirmPlan(params: {
  userShareAmount: number;
  /** Tu cot "Thời gian hoàn thành" cua bao cao Shopee. null khi bao cao thieu / ghi don le bang tay. */
  completedAtVn: string | null;
  /** Lui ve moc nay khi khong biet ngay giao hang - caller truyen todayVnIso(). */
  fallbackDayVn: string;
  /** Hom nay gio VN - caller truyen todayVnIso(), KHONG dung date('now') cua SQLite (do la UTC). */
  todayVn: string;
  /** Ngay da chot tu lan goi truoc (cot available_from cua entry). null = chua chot lan nao. */
  plannedAvailableFrom: string | null;
  config: PayoutHoldConfig;
}): ConfirmPlan {
  const { userShareAmount, completedAtVn, fallbackDayVn, todayVn, plannedAvailableFrom, config } = params;

  // Da chot roi thi chi con MOT cau hoi: toi han chua? Tuyet doi khong tinh lai theo config hien hanh.
  if (plannedAvailableFrom !== null) {
    return {
      status: plannedAvailableFrom > todayVn ? "pending" : "confirmed",
      availableFrom: plannedAvailableFrom,
    };
  }

  if (config.thresholdVnd <= 0) return { status: "confirmed", availableFrom: null };
  // Khong co dong nao cua user trong don nay (chu bot giu toan bo hoa hong) -> khong co gi de cho.
  // So sanh TRUC TIEP voi 0 chu khong qua `||`/truthiness: userShareAmount === 0 la gia tri THAT.
  if (userShareAmount <= 0) return { status: "confirmed", availableFrom: null };

  const baseDay = completedAtVn ?? fallbackDayVn;

  // So sanh la ">=" chu khong ">": dung bang nguong thi la don TO (co test chan).
  if (userShareAmount >= config.thresholdVnd) {
    return { status: "confirmed", availableFrom: addDaysToVnIso(baseDay, config.holdDays) };
  }

  const smallHoldDays = config.smallHoldDays ?? 0;
  if (smallHoldDays <= 0) return { status: "confirmed", availableFrom: null };

  const availableFrom = addDaysToVnIso(baseDay, smallHoldDays);
  return {
    status: availableFrom > todayVn ? "pending" : "confirmed",
    availableFrom,
  };
}
