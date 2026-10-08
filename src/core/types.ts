import type { CommissionEstimate } from "./affiliateProvider.js";
import type { MerchantId } from "./merchants.js";

export type Platform = "telegram" | "zalo" | "http";

export interface ParsedProductLink {
  merchant: MerchantId;
  /** URL san pham sau khi da resolve short domain (neu co) */
  canonicalUrl: string;
  shopId: string | null;
  itemId: string | null;
}

export interface ResolveLinkRequest {
  url: string;
  platform: Platform;
  /** id nguoi dung tren platform goc, dung de rate-limit va log, khong bat buoc voi platform=http */
  userId: string;
  /**
   * Khoa rate-limit tuy chon (2026-09-13). Neu co, dung thay cho "{platform}:{userId}". Can cho
   * platform=http: userId o do do CLIENT tu gui nen gia mao/xoay vong duoc de vuot rate-limit
   * (da chung minh: 40 request voi userId khac nhau deu qua, du gioi han la 10). Adapter HTTP
   * truyen khoa theo IP that (req.ip) vao day; Telegram/Zalo bo trong vi userId cua ho dang tin
   * cay (do platform cap, khong gia mao qua noi dung tin nhan).
   */
  rateLimitKey?: string;
  /**
   * Noi user gui link (group/DM/api) - adapter la cho DUY NHAT biet thong tin nay, core khong suy
   * ra duoc tu platform. Chi dung de ghi log cho /admin/links, khong anh huong logic tao link.
   */
  sourceContext?: LinkSourceContext;
}

export interface ResolveLinkResult {
  merchant: MerchantId;
  originalUrl: string;
  canonicalUrl: string;
  affiliateUrl: string;
  shopId: string | null;
  itemId: string | null;
  subId: string;
  /** uoc tinh hoa hong tu du lieu chinh thuc cua provider - null neu khong ho tro/lay that bai */
  commissionEstimate: CommissionEstimate | null;
  /** true = da xac minh san pham khong co hoa hong (khac voi commissionEstimate rong vi khong tra duoc). */
  noCommission: boolean;
}

export type RequestOutcome = "success" | "error";

/**
 * Noi user gui link toi bot (2026-10-08, cho cot "Noi gui" tren /admin/links).
 * group/dm: Zalo va Telegram deu phan biet duoc ngay tai cho goi resolve().
 * api: request vao qua POST /api/v1/resolve - khong co khai niem group/DM.
 */
export type LinkSourceContext = "group" | "dm" | "api";

export interface RequestLogEntry {
  id: string;
  timestamp: string;
  platform: Platform;
  /** null khi loi xay ra truoc khi xac dinh duoc merchant (vi du URL khong hop le) */
  merchant: MerchantId | null;
  userId: string;
  originalUrl: string;
  subId: string | null;
  outcome: RequestOutcome;
  errorCode: string | null;
  affiliateUrl: string | null;
  /**
   * Ten san pham doc tu nguon tra hoa hong (xem commissionLookup.ts) - nguon DUY NHAT biet ten,
   * nen null khi COMMISSION_LOOKUP_ENABLED=false, khi link khong tach duoc item_id, hoac khi
   * luot do la luot loi. KHONG backfill cho row ghi truoc 2026-10-08.
   */
  productName: string | null;
  /**
   * Hoa hong GOC uoc tinh (VND, truoc thue/phi san/chia % cho user) tai THOI DIEM tao link.
   * `0` la gia tri THAT ("san pham chua bat hoa hong", da xac minh tu nguon) va khac han `null`
   * la "khong tra duoc" - dung gop hai cai nay lai, xem commissionLookup.ts.
   */
  commissionEstimate: number | null;
  /** null cho row ghi truoc 2026-10-08 (khong suy nguoc duoc tu platform). */
  sourceContext: LinkSourceContext | null;
}

/**
 * pending: da ghi nhan nhung chua xac nhan (hien chua dung, moi entry ghi tay qua ledgerAdmin deu confirmed ngay)
 * confirmed: da xac nhan, tinh vao so du kha dung neu chua bi giu boi 1 withdrawal
 * paid: da nam trong 1 withdrawal da markWithdrawalPaid
 * reversed: bi huy (hoan hang/huy don), khong tinh vao so du
 */
export type CommissionStatus = "pending" | "confirmed" | "paid" | "reversed";

export interface CommissionEntry {
  id: string;
  createdAt: string;
  /**
   * Ngay user DAT don that ("YYYY-MM-DD", gio VN) - lay tu cot "Thời Gian Đặt Hàng" cua bao cao
   * Shopee (2026-10-01). KHAC createdAt (= luc admin import bao cao vao he thong): import tre hay
   * gop nhieu ngay mot luc khong lam lech thong ke theo ngay. null cho don ghi tay hoac don da ghi
   * truoc khi co cot nay - moi thong ke tu lui ve createdAt, xem dashboardStats.ts.
   */
  orderDate: string | null;
  /**
   * Ngay Shopee ghi don "Hoan thanh" = ngay giao hang ("YYYY-MM-DD" gio VN, 2026-10-08), doc tu cot
   * "Thời gian hoàn thành" cua bao cao. null khi bao cao khong co gia tri (don ghi tay, bao cao cu).
   * Day la moc Shopee dem 15 ngay duoc tra hang - xem payoutHold.ts.
   */
  completedAt: string | null;
  /**
   * Ngay tien cua don nay duoc phep rut ("YYYY-MM-DD" gio VN). null = kha dung ngay (don duoi nguong,
   * don con pending, hoac entry ghi truoc 2026-10-08 nen khong giam hoi to). Tinh 1 lan luc entry
   * chuyen confirmed roi CHOT - doi setting khong tinh lai, xem resolveAvailableFrom().
   */
  availableFrom: string | null;
  platform: Platform;
  userId: string;
  merchant: MerchantId;
  subId: string;
  /** ma don hang tu nguon affiliate, dung de chong ghi trung 1 don (unique cung merchant) */
  orderId: string;
  /** ten san pham - tuy chon, admin tu dien luc ghi nhan don, null neu khong dien */
  productName: string | null;
  /** VND, gia tri don hang - chi de hien thi, khong dung de tinh toan */
  orderAmount: number;
  /** VND, hoa hong goc (100%) tu affiliate network, TRUOC khi tru thue/phi */
  commissionAmount: number;
  /** VND, thue tren hoa hong goc (vd 10%) */
  taxAmount: number;
  /** VND, phi san tinh tren phan hoa hong DA TRU THUE (vd 1%) */
  platformFeeAmount: number;
  /** VND, = commissionAmount - taxAmount - platformFeeAmount, la so tien dung de chia % voi user */
  afterTaxAmount: number;
  /** VND, phan user duoc nhan (% cua afterTaxAmount) - chot tai thoi diem ghi nhan, doi ty le sau khong anh huong nguoc */
  userShareAmount: number;
  /**
   * 3 ty le DA CHOT luc don duoc ghi nhan lan dau (2026-10-01). Moi lan tinh lai tien cho don nay
   * (updatePendingEntry/confirmPendingEntry o cac lan import sau) deu dung 3 so NAY, khong dung ty le
   * hien hanh trong /admin/settings - don "pending" la don user DA MUA, ha % hom nay khong duoc ha
   * tien cua don mua tu tuan truoc.
   *
   * null cho entry ghi TRUOC khi co 3 cot nay: KHONG backfill duoc (suy nguoc tu so tien thi sai khi
   * hoa hong nho - vd thue 10% cua 7d ra 1d, suy nguoc thanh 14%), nen de null va luc tinh lai se lui
   * ve ty le hien hanh = dung hanh vi cu, khong co cu nhay so bat ngo sau deploy.
   */
  taxPercent: number | null;
  platformFeePercent: number | null;
  userSharePercent: number | null;
  status: CommissionStatus;
  /** gan khi entry bi "giu" boi 1 yeu cau rut tien, null neu con kha dung */
  withdrawalId: string | null;
  /** ghi chu noi bo cua admin, khong hien thi cho user tren dashboard */
  note: string | null;
  /**
   * Ten file anh chup bang chung da chuyen khoan (tu withdrawal_requests.proof_image_path qua
   * withdrawalId) - chi co gia tri khi query co JOIN sang withdrawal_requests (vd getUserSummary()),
   * cac noi khac (getEntryById, listCommissionEntries...) tra ve null du entry da "paid".
   */
  proofImagePath: string | null;
}

export type WithdrawalStatus = "requested" | "paid";

export interface WithdrawalRequest {
  id: string;
  createdAt: string;
  paidAt: string | null;
  platform: Platform;
  userId: string;
  amount: number;
  status: WithdrawalStatus;
  /** Ten file anh chup man hinh chuyen khoan thanh cong, luu trong WITHDRAWAL_PROOF_DIR - null cho tới khi markWithdrawalPaid(). */
  proofImagePath: string | null;
  /**
   * Thong tin ngan hang user tu dien luc gui yeu cau rut (bat buoc, xem
   * phan-hoi-cai-thien-trai-nghiem-nguoi-dung.md muc 9) - admin tu doi chieu/xac nhan lai qua tin
   * nhan rieng truoc khi chuyen khoan, KHONG tu dong xac thuc so tai khoan co hop le hay khong.
   */
  bankName: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
}

/**
 * 1 khoan tien da tra cho user roi Shopee thu lai vi khach tra hang (2026-10-08). Tru DAN vao Kha
 * dung tuong lai, KHONG bao gio ep user chuyen tien ra.
 *
 * Chi sinh khi tien DA ra khoi tay (entry 'paid', hoac entry dang nam trong 1 yeu cau rut cho duyet
 * - luc do admin co the da chuyen khoan ma chua bam "da tra"). Don bi huy ma tien con trong tay thi
 * duoc reverse thang, khong sinh no - xem bang quyet dinh trong shopeeReportImport.ts.
 *
 * `remaining` CHI giam o markWithdrawalPaid() - nho vay cancelWithdrawal() khong phai hoan no lai.
 */
export interface PayoutDebt {
  id: string;
  createdAt: string;
  platform: Platform;
  userId: string;
  merchant: MerchantId;
  orderId: string;
  /** So tien user da nhan cua don bi huy (= user_share_amount cua entry). */
  amount: number;
  /** Con phai tru. Ve 0 thi settledAt duoc dien. */
  remaining: number;
  note: string | null;
  settledAt: string | null;
  /**
   * Admin xoa no (user bo di, no treo vinh vien lam meo moi con so tong). Dong van duoc GIU LAI de
   * con doi soat - khac deleteDebtByOrder() la xoa han vi hoa ra khong he mat tien.
   */
  writtenOffAt: string | null;
}

export interface DashboardToken {
  token: string;
  platform: Platform;
  userId: string;
  createdAt: string;
}

/**
 * Lich su cac lan "ghi nhan don hang" tren web /admin/record-orders (2026-08-23) - "csv" la import
 * bao cao goc Shopee (co the nhieu don/lan), "single" la form "Ghi 1 don le" (luon dung 1 don moi,
 * khong bao gio co statusTransitions vi recordSingleOrder chi INSERT, khong UPDATE entry
 * co san). Xem LedgerStore.recordImportHistory()/listImportHistory().
 */
export type ImportActionType = "csv" | "single";

/** 1 don doi trang thai trong 1 lan import (vd pending -> confirmed) - CHI ghi khi trang thai THAT SU doi, khong ghi khi chi cap nhat lai so lieu (updatePendingEntry, van giu nguyen "pending"). */
export interface StatusTransition {
  orderId: string;
  from: CommissionStatus;
  to: CommissionStatus;
}

export interface ImportHistoryEntry {
  id: string;
  createdAt: string;
  actionType: ImportActionType;
  /** Ma don duoc ghi MOI trong lan nay (dung chung ca "Kha dung" lan "Cho xac nhan"). */
  newOrderIds: string[];
  statusTransitions: StatusTransition[];
}

/**
 * 1 group Zalo bot dang la thanh vien (2026-09-11) - bot tu ghi nhan (xem LedgerStore.upsertZaloGroup),
 * admin tick `notifyEnabled` tren /admin/settings de chon group nao nhan thong bao "da cap nhat don
 * hang" sau moi lan import bao cao Shopee. Mac dinh TAT vi tai khoan Zalo chay bot la tai khoan ca
 * nhan, thuong dang o ca group khong lien quan.
 */
export interface ZaloGroup {
  groupId: string;
  name: string;
  notifyEnabled: boolean;
  createdAt: string;
  lastSeenAt: string;
}

/**
 * Ly do 1 thread bi khoa FAQ (2026-09-13) - chi de chan doan khi doc DB, khong anh huong logic.
 * "admin_typed": chu bot vua go tay tra loi user trong thread do (phat hien qua selfListen).
 * "admin_command": chu bot go lenh "/im".
 * CO CHU DICH khong co gia tri nao cho "bot khong nhan ra cau hoi" (da bo 2026-09-13, xem
 * faqService.escalateToAdmin) - khoa thread CHI duoc phep xay ra khi admin THAT SU can thiep, neu
 * khong cau FAQ hop le hoi ngay sau 1 cau la se bi im oan.
 */
export type FaqMuteReason = "admin_typed" | "admin_command";
