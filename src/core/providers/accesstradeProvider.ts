import { AffiliateApiError, AffiliateApiTimeoutError, MerchantNotConfiguredError } from "../errors.js";
import { getMerchantConfig, type MerchantId } from "../merchants.js";
import type {
  AffiliateProvider,
  CreateAffiliateLinkInput,
  CreateAffiliateLinkOutput,
  PromotionItem,
} from "../affiliateProvider.js";

export interface AccesstradeMerchantConfig {
  /** campaign_id da duoc duyet trong dashboard Accesstrade cho merchant nay */
  campaignId: string;
  /** ten merchant dung cho API khuyen mai (vi du "shopee", "lazada_kol") */
  promotionsMerchant: string;
}

export interface AccesstradeProviderConfig {
  apiKey: string;
  apiBase: string;
  endpointPath: string;
  timeoutMs: number;
  /** thoi gian cache danh sach khuyen mai trong bo nho, tranh goi API lai moi tin nhan */
  promotionsCacheTtlMs: number;
  /** config rieng tung merchant - merchant khong co trong map se bi tu choi voi loi ro rang */
  merchants: Partial<Record<MerchantId, AccesstradeMerchantConfig>>;
}

/**
 * Da xac minh voi API that (2026-07-31): endpoint can them field "campaign_id"
 * trong body, neu khong Accesstrade tra ve 400 {"message": {"campaign_id":
 * ["Missing data for required field."]}}. campaign_id la id chien dich da duoc
 * duyet trong dashboard Accesstrade (muc Campaign), khac voi API key, va rieng
 * cho tung merchant (Shopee, Lazada... moi merchant 1 campaign khac nhau).
 *
 * Ham parse response co chu y nhieu ten field co the co (short_link / aff_link /
 * shortLink / aff_short_url / aff_url) de giam rui ro vo hieu neu ten field thuc te
 * khac mot chut, nhung neu response hoan toan khac cau truc du kien se nem
 * AffiliateApiError ro rang thay vi crash (dung theo T1.1/T1.5).
 *
 * TikTok Shop (them 2026-08-18) dung endpoint HOAN TOAN KHAC Shopee/Lazada trong cung
 * method createAffiliateLink (branch theo input.merchant) - xem comment trong ham do.
 */
export class AccesstradeProvider implements AffiliateProvider {
  private readonly promotionsCache = new Map<MerchantId, { fetchedAt: number; items: PromotionItem[] }>();

  constructor(private readonly config: AccesstradeProviderConfig) {}

  private requireMerchantConfig(merchant: MerchantId): AccesstradeMerchantConfig {
    const merchantConfig = this.config.merchants[merchant];
    if (!merchantConfig || merchantConfig.campaignId === "") {
      throw new MerchantNotConfiguredError(getMerchantConfig(merchant).displayName);
    }
    return merchantConfig;
  }

  async createAffiliateLink(
    input: CreateAffiliateLinkInput
  ): Promise<CreateAffiliateLinkOutput> {
    let endpoint: URL;
    let body: Record<string, unknown>;

    if (input.merchant === "tiktokshop") {
      // Da xac minh voi API that (2026-08-18): endpoint RIENG cho TikTok Shop, KHAC hoan toan
      // Shopee/Lazada - KHONG can campaign_id, nhung BAT BUOC phai co product_id (tach tu URL
      // trong linkValidator.ts, xem NotAProductLinkError). Response tra ve field "aff_short_url"/
      // "aff_url" (khac "short_link"/"aff_link" cua endpoint Shopee/Lazada) - xem extractAffiliateUrl.
      if (!input.itemId) {
        throw new AffiliateApiError("thieu product_id de tao link TikTok Shop (loi logic, phai chan tu linkValidator.ts)");
      }
      endpoint = new URL("/v1/tiktokshop_product_feeds/create_link", this.config.apiBase);
      // sub1: BAT BUOC phai gui subId o day (theo docs: sub1-sub4), neu khong don hang tra ve
      // sau nay se KHONG the tra nguoc lai duoc la cua user nao - day la loi da tung xay ra
      // (thieu dong nay), phat hien 2026-08-18 khi ban ve bai toan tra hoa hong cho dung user.
      body = { product_url: input.productUrl, product_id: input.itemId, sub1: input.subId };
    } else {
      const merchantConfig = this.requireMerchantConfig(input.merchant);
      endpoint = new URL(this.config.endpointPath, this.config.apiBase);
      body = {
        url: input.productUrl,
        campaign_id: merchantConfig.campaignId,
        utm_source: "bot-shopee",
        utm_content: input.subId,
      };
    }

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
        body: JSON.stringify(body),
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

    if (input.merchant === "tiktokshop") {
      const commissionEstimate = await this.fetchTikTokShopCommissionEstimate(input.itemId as string);
      return { affiliateUrl, commissionEstimate };
    }

    return { affiliateUrl };
  }

  /**
   * Uoc tinh hoa hong TikTok Shop tu du lieu CHINH THUC cua Accesstrade (da xac minh that
   * 2026-08-18) - GET /v2/tiktokshop_product_feeds?product_ids={id}, KHONG can title_keywords
   * (da test truc tiep: van tra ve dung ket qua du docs ghi la required). commission.rate la
   * PHAN SO THAP PHAN (0.03888 = 3.888%), khac cach tinh "hang tram phan tram" ghi trong docs
   * ban v1 - chi tin theo response that quan sat duoc, khong theo mo ta docs.
   * Loi o day KHONG lam fail ca lan tao link (chi la thong tin bo sung) - tra ve null va log
   * canh bao thay vi throw.
   */
  private async fetchTikTokShopCommissionEstimate(
    productId: string
  ): Promise<{ ratePercent: number; estimatedAmount: number; currency: string } | null> {
    try {
      const endpoint = new URL("/v2/tiktokshop_product_feeds", this.config.apiBase);
      endpoint.searchParams.set("sort_field", "RECOMMENDED");
      endpoint.searchParams.set("limit", "1");
      endpoint.searchParams.set("product_ids", productId);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
      let response: Response;
      try {
        response = await fetch(endpoint, {
          headers: { Authorization: `Token ${this.config.apiKey}` },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) return null;
      const json = (await response.json()) as unknown;
      return extractTikTokCommissionEstimate(json);
    } catch (err) {
      console.warn("[accesstrade] khong lay duoc uoc tinh hoa hong TikTok Shop:", (err as Error).message);
      return null;
    }
  }

  /**
   * Xac minh that (2026-07-31) qua GET /v1/offers_informations?merchant=shopee -
   * hoat dong doc lap, KHONG can campaign_id/campaign duoc duyet. Response khong
   * co field "so luot con lai" - Accesstrade khong cung cap du lieu nay, nen
   * PromotionItem chi co couponCode + description (da chua % giam san trong text).
   */
  async getPromotions(merchant: MerchantId, limit: number): Promise<PromotionItem[]> {
    const merchantConfig = this.requireMerchantConfig(merchant);

    const now = Date.now();
    const cached = this.promotionsCache.get(merchant);
    if (cached && now - cached.fetchedAt < this.config.promotionsCacheTtlMs) {
      return cached.items.slice(0, limit);
    }

    const endpoint = new URL("/v1/offers_informations", this.config.apiBase);
    endpoint.searchParams.set("merchant", merchantConfig.promotionsMerchant);
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
    this.promotionsCache.set(merchant, { fetchedAt: now, items });
    return items.slice(0, limit);
  }
}

/**
 * Parse response GET /v2/tiktokshop_product_feeds - lay san pham dau tien trong "products"
 * (da loc theo product_ids=1 id nen chi co toi da 1 ket qua). rate la chuoi phan so thap phan
 * (vd "0.03888"), nhan 100 de ra %.
 */
function extractTikTokCommissionEstimate(
  json: unknown
): { ratePercent: number; estimatedAmount: number; currency: string } | null {
  if (typeof json !== "object" || json === null) return null;
  const root = json as Record<string, unknown>;
  const data = typeof root.data === "object" && root.data !== null ? (root.data as Record<string, unknown>) : null;
  const products = data && Array.isArray(data.products) ? data.products : [];
  const first = products[0];
  if (typeof first !== "object" || first === null) return null;

  const commission = (first as Record<string, unknown>).commission;
  if (typeof commission !== "object" || commission === null) return null;
  const c = commission as Record<string, unknown>;

  const rate = Number(c.rate);
  const amount = Number(c.amount);
  const currency = typeof c.currency === "string" ? c.currency : "VND";
  if (!Number.isFinite(rate) || !Number.isFinite(amount)) return null;

  return { ratePercent: rate * 100, estimatedAmount: amount, currency };
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

  // aff_short_url/aff_url: field rieng cua response TikTok Shop (da xac minh 2026-08-18),
  // uu tien short truoc giong quy uoc voi cac field short_link/shortLink hien co.
  const candidateFields = [
    "short_link",
    "shortLink",
    "aff_short_url",
    "aff_link",
    "affLink",
    "aff_url",
    "url",
  ];
  for (const field of candidateFields) {
    const value = data[field];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}
