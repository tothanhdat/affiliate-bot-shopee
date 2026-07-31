import { randomBytes } from "node:crypto";
import type { AffiliateProvider } from "./affiliateProvider.js";
import { AppError, RateLimitedError } from "./errors.js";
import { LogStore } from "./logStore.js";
import { parseShopeeLink } from "./linkValidator.js";
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
      const parsed = await parseShopeeLink(request.url);
      const subId = generateSubId(request.platform, request.userId);
      const { affiliateUrl } = await this.provider.createAffiliateLink({
        productUrl: parsed.canonicalUrl,
        subId,
      });

      this.logStore.record({
        platform: request.platform,
        userId: request.userId,
        originalUrl: request.url,
        subId,
        outcome: "success",
        errorCode: null,
        affiliateUrl,
      });

      return {
        originalUrl: request.url,
        canonicalUrl: parsed.canonicalUrl,
        affiliateUrl,
        shopId: parsed.shopId,
        itemId: parsed.itemId,
        subId,
      };
    } catch (err) {
      const appError = toAppError(err);
      this.logStore.record({
        platform: request.platform,
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
}
