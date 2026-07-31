export type ErrorCode =
  | "INVALID_LINK"
  | "NOT_SHOPEE_LINK"
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
    super("INVALID_LINK", `Link khong hop le: ${reason}`);
  }
}

export class NotShopeeLinkError extends AppError {
  constructor() {
    super("NOT_SHOPEE_LINK", "Link nay khong phai link Shopee.");
  }
}

export class AffiliateApiError extends AppError {
  constructor(detail: string, cause?: unknown) {
    super(
      "AFFILIATE_API_ERROR",
      "He thong affiliate dang gap su co, vui long thu lai sau it phut.",
      cause
    );
    this.message = `Affiliate API error: ${detail}`;
  }
}

export class AffiliateApiTimeoutError extends AppError {
  constructor() {
    super(
      "AFFILIATE_API_TIMEOUT",
      "He thong affiliate phan hoi qua cham, vui long thu lai."
    );
  }
}

export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds: number) {
    super(
      "RATE_LIMITED",
      `Ban gui yeu cau qua nhanh, vui long thu lai sau ${retryAfterSeconds} giay.`
    );
  }
}
