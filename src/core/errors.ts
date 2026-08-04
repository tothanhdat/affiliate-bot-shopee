export type ErrorCode =
  | "INVALID_LINK"
  | "UNSUPPORTED_MERCHANT_LINK"
  | "MERCHANT_NOT_CONFIGURED"
  | "AFFILIATE_API_ERROR"
  | "AFFILIATE_API_TIMEOUT"
  | "RATE_LIMITED";

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
