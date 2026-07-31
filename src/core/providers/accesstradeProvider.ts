import { AffiliateApiError, AffiliateApiTimeoutError } from "../errors.js";
import type {
  AffiliateProvider,
  CreateAffiliateLinkInput,
  CreateAffiliateLinkOutput,
  PromotionItem,
} from "../affiliateProvider.js";

export interface AccesstradeProviderConfig {
  apiKey: string;
  campaignId: string;
  apiBase: string;
  endpointPath: string;
  timeoutMs: number;
  /** ten merchant dung cho API khuyen mai (xac minh that: "shopee") */
  promotionsMerchant: string;
  /** thoi gian cache danh sach khuyen mai trong bo nho, tranh goi API lai moi tin nhan */
  promotionsCacheTtlMs: number;
}

/**
 * Da xac minh voi API that (2026-07-31): endpoint can them field "campaign_id"
 * trong body, neu khong Accesstrade tra ve 400 {"message": {"campaign_id":
 * ["Missing data for required field."]}}. campaign_id la id chien dich Shopee
 * da duoc duyet trong dashboard Accesstrade (muc Campaign), khac voi API key.
 *
 * Ham parse response co chu y nhieu ten field co the co (short_link / aff_link /
 * shortLink) de giam rui ro vo hieu neu ten field thuc te khac mot chut, nhung
 * neu response hoan toan khac cau truc du kien se nem AffiliateApiError ro rang
 * thay vi crash (dung theo T1.1/T1.5).
 */
export class AccesstradeProvider implements AffiliateProvider {
  private promotionsCache: { fetchedAt: number; items: PromotionItem[] } | null = null;

  constructor(private readonly config: AccesstradeProviderConfig) {}

  async createAffiliateLink(
    input: CreateAffiliateLinkInput
  ): Promise<CreateAffiliateLinkOutput> {
    const endpoint = new URL(this.config.endpointPath, this.config.apiBase);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          url: input.productUrl,
          campaign_id: this.config.campaignId,
          utm_source: "bot-shopee",
          utm_content: input.subId,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new AffiliateApiTimeoutError();
      }
      throw new AffiliateApiError(`network error: ${(err as Error).message}`, err);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new AffiliateApiError(`HTTP ${response.status}: ${bodyText.slice(0, 300)}`);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      throw new AffiliateApiError("response khong phai JSON hop le", err);
    }

    const affiliateUrl = extractAffiliateUrl(json);
    if (!affiliateUrl) {
      throw new AffiliateApiError(
        `khong tim thay short link trong response: ${JSON.stringify(json).slice(0, 300)}`
      );
    }

    return { affiliateUrl };
  }

  /**
   * Xac minh that (2026-07-31) qua GET /v1/offers_informations?merchant=shopee -
   * hoat dong doc lap, KHONG can campaign_id/campaign duoc duyet. Response khong
   * co field "so luot con lai" - Accesstrade khong cung cap du lieu nay, nen
   * PromotionItem chi co couponCode + description (da chua % giam san trong text).
   */
  async getPromotions(limit: number): Promise<PromotionItem[]> {
    const now = Date.now();
    if (
      this.promotionsCache &&
      now - this.promotionsCache.fetchedAt < this.config.promotionsCacheTtlMs
    ) {
      return this.promotionsCache.items.slice(0, limit);
    }

    const endpoint = new URL("/v1/offers_informations", this.config.apiBase);
    endpoint.searchParams.set("merchant", this.config.promotionsMerchant);
    endpoint.searchParams.set("status", "1");
    // Luu y: param "coupon=1" (theo tai lieu) tra ve rong khi xac minh that (2026-07-31),
    // du item van co field coupons. Khong dung param nay - loc coupons rong o extractPromotionItems.
    endpoint.searchParams.set("limit", String(Math.max(limit * 3, 15)));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        headers: { Authorization: `Token ${this.config.apiKey}` },
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new AffiliateApiTimeoutError();
      }
      throw new AffiliateApiError(`network error: ${(err as Error).message}`, err);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new AffiliateApiError(`HTTP ${response.status}: ${bodyText.slice(0, 300)}`);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      throw new AffiliateApiError("response khong phai JSON hop le", err);
    }

    const items = extractPromotionItems(json);
    this.promotionsCache = { fetchedAt: now, items };
    return items.slice(0, limit);
  }
}

function extractPromotionItems(json: unknown): PromotionItem[] {
  if (typeof json !== "object" || json === null) return [];
  const root = json as Record<string, unknown>;
  const data = Array.isArray(root.data) ? root.data : [];

  const items: PromotionItem[] = [];
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) continue;
    const coupons = (entry as Record<string, unknown>).coupons;
    if (!Array.isArray(coupons)) continue;
    for (const coupon of coupons) {
      if (typeof coupon !== "object" || coupon === null) continue;
      const code = (coupon as Record<string, unknown>).coupon_code;
      const desc = (coupon as Record<string, unknown>).coupon_desc;
      if (typeof code === "string" && code.length > 0) {
        items.push({
          couponCode: code,
          description: typeof desc === "string" && desc.length > 0 ? desc : "Khong co mo ta",
        });
      }
    }
  }
  return items;
}

function extractAffiliateUrl(json: unknown): string | null {
  if (typeof json !== "object" || json === null) return null;
  const root = json as Record<string, unknown>;
  const data =
    typeof root.data === "object" && root.data !== null
      ? (root.data as Record<string, unknown>)
      : root;

  const candidateFields = ["short_link", "shortLink", "aff_link", "affLink", "url"];
  for (const field of candidateFields) {
    const value = data[field];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}
