import { randomBytes } from "node:crypto";
import type { AffiliateProvider, PromotionItem } from "./affiliateProvider.js";
import { AppError, RateLimitedError } from "./errors.js";
import { LogStore } from "./logStore.js";
import { parseProductLink } from "./linkValidator.js";
import type { MerchantId } from "./merchants.js";
import { RateLimiter } from "./rateLimiter.js";
import type { Platform, ResolveLinkRequest, ResolveLinkResult } from "./types.js";

function generateSubId(platform: Platform, userId: string): string {
  const rand = randomBytes(3).toString("hex");
  return `${platform}-${userId}-${Date.now().toString(36)}-${rand}`;
}

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  return new AppError(
    "AFFILIATE_API_ERROR",
    "Da co loi khong xac dinh xay ra, vui long thu lai sau.",
    err
  );
}

export class LinkResolverService {
  constructor(
    private readonly provider: AffiliateProvider,
    private readonly logStore: LogStore,
    private readonly rateLimiter: RateLimiter
  ) {}

  async resolve(request: ResolveLinkRequest): Promise<ResolveLinkResult> {
    const rateLimitKey = `${request.platform}:${request.userId}`;
    const rateCheck = this.rateLimiter.checkAndRecord(rateLimitKey);
    if (!rateCheck.allowed) {
      throw new RateLimitedError(rateCheck.retryAfterSeconds);
    }

    try {
      const parsed = await parseProductLink(request.url);
      const subId = generateSubId(request.platform, request.userId);
      const { affiliateUrl, commissionEstimate } = await this.provider.createAffiliateLink({
        merchant: parsed.merchant,
        productUrl: parsed.canonicalUrl,
        subId,
        itemId: parsed.itemId,
      });

      this.logStore.record({
        platform: request.platform,
        merchant: parsed.merchant,
        userId: request.userId,
        originalUrl: request.url,
        subId,
        outcome: "success",
        errorCode: null,
        affiliateUrl,
      });

      return {
        merchant: parsed.merchant,
        originalUrl: request.url,
        canonicalUrl: parsed.canonicalUrl,
        affiliateUrl,
        shopId: parsed.shopId,
        itemId: parsed.itemId,
        subId,
        commissionEstimate: commissionEstimate ?? null,
      };
    } catch (err) {
      const appError = toAppError(err);
      this.logStore.record({
        platform: request.platform,
        // Loi thuong xay ra truoc/trong luc xac dinh merchant (URL sai, khong ho tro...) nen chua biet merchant.
        merchant: null,
        userId: request.userId,
        originalUrl: request.url,
        subId: null,
        outcome: "error",
        errorCode: appError.code,
        affiliateUrl: null,
      });
      throw appError;
    }
  }

  /** Danh sach khuyen mai dang chay chung cua 1 merchant (khong gan voi 1 san pham cu the). */
  async getPromotions(merchant: MerchantId, limit: number): Promise<PromotionItem[]> {
    return this.provider.getPromotions(merchant, limit);
  }
}
