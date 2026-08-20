export type ErrorCode =
  | "INVALID_LINK"
  | "UNSUPPORTED_MERCHANT_LINK"
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
  | "ENTRY_ALREADY_WITHDRAWN"
  | "IMPLAUSIBLE_COMMISSION_AMOUNT"
  | "INVALID_PAYMENT_AMOUNT"
  | "MISSING_WITHDRAWAL_PROOF"
  | "MISSING_BANK_INFO";

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
      "Link này không thuộc sàn (Shopee, Lazada) mà bot đang hỗ trợ."
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
      `Số dư khả dụng của bạn (${currentBalanceVnd.toLocaleString("vi-VN")}đ) chưa đạt mức tối thiểu để rút (${thresholdVnd.toLocaleString("vi-VN")}đ).`
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
  constructor(merchantDisplayName: string) {
    super(
      "NOT_A_PRODUCT_LINK",
      `Link này không phải link sản phẩm ${merchantDisplayName}, mình chỉ xử lý được link sản phẩm cụ thể.`
    );
  }
}

export class EntryAlreadyWithdrawnError extends AppError {
  constructor() {
    super(
      "ENTRY_ALREADY_WITHDRAWN",
      "Đơn hàng này đã nằm trong 1 yêu cầu rút tiền (đang chờ hoặc đã trả), không thể huỷ trực tiếp qua đây."
    );
  }
}

export class InvalidPaymentAmountError extends AppError {
  constructor() {
    super("INVALID_PAYMENT_AMOUNT", "Số tiền phải lớn hơn 0.");
  }
}

export class MissingWithdrawalProofError extends AppError {
  constructor() {
    super(
      "MISSING_WITHDRAWAL_PROOF",
      "Cần đính kèm ảnh chụp màn hình đã chuyển khoản thành công trước khi đánh dấu đã trả."
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
      `Hoa hồng ${commissionAmount.toLocaleString("vi-VN")}đ vượt quá ${maxRatioPercent}% giá trị đơn ` +
        `(${orderAmount.toLocaleString("vi-VN")}đ), có thể gõ nhầm. Kiểm tra lại hoặc tăng ` +
        `COMMISSION_MAX_RATIO_PERCENT nếu đúng.`
    );
  }
}
