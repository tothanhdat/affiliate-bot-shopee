import { formatVnd } from "./money.js";
export type ErrorCode =
  | "INVALID_LINK"
  | "UNSUPPORTED_MERCHANT_LINK"
  | "RETIRED_MERCHANT_LINK"
  | "MERCHANT_NOT_CONFIGURED"
  | "AFFILIATE_API_ERROR"
  | "AFFILIATE_API_TIMEOUT"
  | "RATE_LIMITED"
  | "INSUFFICIENT_BALANCE"
  | "INVALID_DASHBOARD_TOKEN"
  | "WITHDRAWAL_ALREADY_PENDING"
  | "DUPLICATE_CONVERSION"
  | "SUB_ID_NOT_FOUND"
  | "NOT_A_PRODUCT_LINK"
  | "PRODUCT_NOT_AFFILIATE_ELIGIBLE"
  | "ENTRY_ALREADY_WITHDRAWN"
  | "IMPLAUSIBLE_COMMISSION_AMOUNT"
  | "MISSING_WITHDRAWAL_PROOF"
  | "MISSING_BANK_INFO"
  | "ENTRY_NOT_PENDING"
  | "WITHDRAWAL_NOT_CANCELLABLE";

export class AppError extends Error {
  readonly code: ErrorCode;
  /** thong bao than thien, an toan de hien thi truc tiep cho user cuoi */
  readonly userMessage: string;

  constructor(code: ErrorCode, userMessage: string, cause?: unknown) {
    super(userMessage);
    this.name = "AppError";
    this.code = code;
    this.userMessage = userMessage;
    if (cause !== undefined) this.cause = cause;
  }
}

export class InvalidLinkError extends AppError {
  constructor(reason: string) {
    super("INVALID_LINK", `Link không hợp lệ: ${reason}`);
  }
}

export class UnsupportedMerchantLinkError extends AppError {
  constructor() {
    super(
      "UNSUPPORTED_MERCHANT_LINK",
      "Sàn này em chưa hỗ trợ được á, để em báo admin cập nhật thêm nha 🙏"
    );
  }
}

/**
 * Link cua san TUNG duoc ho tro nhung da ngung (TikTok Shop, Lazada - 2026-09-29).
 * KHONG dung lai UnsupportedMerchantLinkError: message cua no hua "de em bao admin cap nhat
 * them", ma 2 san nay se khong bao gio duoc them lai - hua sai con te hon khong noi gi.
 */
export class RetiredMerchantLinkError extends AppError {
  constructor() {
    super(
      "RETIRED_MERCHANT_LINK",
      "Hiện em chỉ hỗ trợ Shopee thôi ạ 🛒 Bạn gửi link Shopee giúp em nha!"
    );
  }
}

export class MerchantNotConfiguredError extends AppError {
  constructor(merchantDisplayName: string) {
    super(
      "MERCHANT_NOT_CONFIGURED",
      `Hệ thống chưa được cấu hình để tạo link affiliate cho ${merchantDisplayName}, vui lòng thử lại sau.`
    );
  }
}

export class AffiliateApiError extends AppError {
  constructor(detail: string, cause?: unknown) {
    super(
      "AFFILIATE_API_ERROR",
      "Hệ thống affiliate đang gặp sự cố, vui lòng thử lại sau ít phút.",
      cause
    );
    this.message = `Affiliate API error: ${detail}`;
  }
}

export class AffiliateApiTimeoutError extends AppError {
  constructor() {
    super(
      "AFFILIATE_API_TIMEOUT",
      "Hệ thống affiliate phản hồi quá chậm, vui lòng thử lại."
    );
  }
}

export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds: number) {
    super(
      "RATE_LIMITED",
      `Bạn gửi yêu cầu quá nhanh, vui lòng thử lại sau ${retryAfterSeconds} giây.`
    );
  }
}

export class InsufficientBalanceError extends AppError {
  constructor(currentBalanceVnd: number, thresholdVnd: number) {
    super(
      "INSUFFICIENT_BALANCE",
      `Số dư khả dụng của bạn (${formatVnd(currentBalanceVnd)}) chưa đạt mức tối thiểu để rút (${formatVnd(thresholdVnd)}).`
    );
  }
}

export class InvalidDashboardTokenError extends AppError {
  constructor() {
    super("INVALID_DASHBOARD_TOKEN", "Đường dẫn không hợp lệ hoặc đã hết hạn.");
  }
}

export class WithdrawalAlreadyPendingError extends AppError {
  constructor() {
    super(
      "WITHDRAWAL_ALREADY_PENDING",
      "Bạn đã có 1 yêu cầu rút tiền đang chờ xử lý, vui lòng đợi admin xử lý xong."
    );
  }
}

export class DuplicateConversionError extends AppError {
  constructor(orderId: string) {
    super("DUPLICATE_CONVERSION", `Đơn hàng "${orderId}" đã được ghi nhận trước đó.`);
  }
}

export class SubIdNotFoundError extends AppError {
  constructor(subId: string) {
    super("SUB_ID_NOT_FOUND", `Không tìm thấy request nào ứng với subId "${subId}".`);
  }
}

export class NotAProductLinkError extends AppError {
  constructor(_merchantDisplayName: string) {
    super(
      "NOT_A_PRODUCT_LINK",
      "Cái này là video chứ không phải link sản phẩm nha 😅 Gửi đúng link mua hàng thì em mới ra mã được."
    );
  }
}

/**
 * San pham co that va link hop le, nhung nguoi ban CHUA bat tiep thi lien ket cho no (hoa hong 0%,
 * khong co trong Affiliate Center) - nguon affiliate tu choi tao link. Tach rieng khoi
 * AffiliateApiError vi day KHONG phai su co he thong: thu lai bao nhieu lan cung cho ket qua y het,
 * nen tuyet doi khong duoc noi voi user "vui long thu lai sau" (phat hien 2026-09-02).
 */
export class ProductNotAffiliateEligibleError extends AppError {
  constructor(detail: string) {
    super(
      "PRODUCT_NOT_AFFILIATE_ELIGIBLE",
      "Sản phẩm này shop chưa bật hoàn tiền nên em không tạo được link nha 😅 Bạn thử sản phẩm khác giúp em."
    );
    this.message = `Product not affiliate eligible: ${detail}`;
  }
}

/**
 * Admin bam "Huy yeu cau" tren 1 yeu cau khong con o trang thai 'requested' (da tra, hoac da huy roi)
 * - 2026-10-08. Huy mot yeu cau DA TRA se tha entry ve "confirmed" trong khi tien that da ra khoi
 * ngan hang, tuc tao ra tien khong co that.
 */
export class WithdrawalNotCancellableError extends AppError {
  constructor() {
    super(
      "WITHDRAWAL_NOT_CANCELLABLE",
      "Chỉ huỷ được yêu cầu rút đang chờ thanh toán."
    );
  }
}

export class EntryNotPendingError extends AppError {
  constructor() {
    super(
      "ENTRY_NOT_PENDING",
      "Chỉ huỷ được đơn đang ở trạng thái \"Chờ xác nhận\" - đơn đã \"Khả dụng\" được xem là đã hoàn tất, không thể huỷ qua đây nữa."
    );
  }
}

/**
 * Rieng cho reverseCommissionEntry() khi goi voi allowNonPending=true (chi CLI reverse-entry dung -
 * loi thoat duy nhat cho Shopee ghi tay, vi duong nay khong co giai doan "pending") - van
 * chan neu entry da gan vao 1 yeu cau rut tien, vi tien co the da chuyen that.
 */
export class EntryAlreadyWithdrawnError extends AppError {
  constructor() {
    super(
      "ENTRY_ALREADY_WITHDRAWN",
      "Đơn hàng này đã nằm trong 1 yêu cầu rút tiền (đang chờ hoặc đã trả), không thể huỷ trực tiếp qua đây."
    );
  }
}

export class MissingBankInfoError extends AppError {
  constructor() {
    super("MISSING_BANK_INFO", "Vui lòng điền đầy đủ số tài khoản, tên chủ tài khoản và ngân hàng.");
  }
}

export class ImplausibleCommissionAmountError extends AppError {
  constructor(commissionAmount: number, orderAmount: number, maxRatioPercent: number) {
    super(
      "IMPLAUSIBLE_COMMISSION_AMOUNT",
      `Hoa hồng ${formatVnd(commissionAmount)} vượt quá ${maxRatioPercent}% giá trị đơn ` +
        `(${formatVnd(orderAmount)}), có thể gõ nhầm. Kiểm tra lại hoặc tăng ` +
        `COMMISSION_MAX_RATIO_PERCENT nếu đúng.`
    );
  }
}
