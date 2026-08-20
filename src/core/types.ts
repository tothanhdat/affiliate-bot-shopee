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
}

export type RequestOutcome = "success" | "error";

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

export interface DashboardToken {
  token: string;
  platform: Platform;
  userId: string;
  createdAt: string;
}

/** 1 lan Accesstrade CHUYEN KHOAN THAT cho chu bot - nhap tay boi admin, doi chieu voi tien da tra user. */
export interface AccesstradePayment {
  id: string;
  receivedAt: string;
  amountVnd: number;
  note: string | null;
}

/** Doi chieu dong tien: da nhan that tu Accesstrade vs da tra that cho user - phat hien som neu tra vuot thu. */
export interface ReconciliationSummary {
  totalReceivedVnd: number;
  totalPaidToUsersVnd: number;
  remainingVnd: number;
}
