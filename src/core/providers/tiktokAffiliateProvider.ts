import {
  MerchantNotConfiguredError,
  NotAProductLinkError,
  ProductNotAffiliateEligibleError,
  ProviderUnavailableError,
  type AppError,
} from "../errors.js";
import { getMerchantConfig, type MerchantId } from "../merchants.js";
import type {
  AffiliateProvider,
  CommissionEstimate,
  CreateAffiliateLinkInput,
  CreateAffiliateLinkOutput,
  PromotionItem,
} from "../affiliateProvider.js";
import { RiohubApiError, RiohubUnreachableError, type RiohubClient } from "./riohubClient.js";

const PRODUCT_LINKS_PATH = "/partner/tiktok/affiliate/product-links";

interface RiohubProduct {
  title?: string;
  commission?: { amount?: string; rate?: number };
  observed_commission?: { commission_rate?: number } | null;
  sales_price?: { minimum_amount?: string; maximum_amount?: string } | null;
}

interface ProductLinkResponse {
  affiliate_link?: string;
  product?: RiohubProduct | null;
  product_error?: string | null;
}

export interface TiktokAffiliateProviderConfig {
  client: RiohubClient;
  creatorUsername: string;
  /** Nhan nguon traffic, tach link bot tao khoi link chu bot tu tao tren app RioHub. */
  channel: string;
}

/**
 * Tao link affiliate TikTok Shop qua RioHub - lop API tren link affiliate CHINH CHU cua tai khoan
 * creator, nen TikTok tra hoa hong thang cho chu bot, RioHub thu 0d.
 *
 * Dung `/product-links` thay vi `/links`: cung MOT request tra ve ca link LAN thong tin san pham
 * (gia + rate hoa hong), nen bao duoc so uoc tinh cho user ma khong ton them luot goi nao.
 *
 * KHONG rut gon lai qua /s/:code nhu Shopee - RioHub da tra link ngan san, them mot chang redirect
 * chi tang rui ro hong deep-link mo app TikTok.
 */
export class TiktokAffiliateProvider implements AffiliateProvider {
  constructor(private readonly config: TiktokAffiliateProviderConfig) {}

  async createAffiliateLink(input: CreateAffiliateLinkInput): Promise<CreateAffiliateLinkOutput> {
    if (input.merchant !== "tiktokshop") {
      throw new MerchantNotConfiguredError(getMerchantConfig(input.merchant).displayName);
    }

    let res: ProductLinkResponse;
    try {
      res = await this.config.client.post<ProductLinkResponse>(PRODUCT_LINKS_PATH, {
        creator_username: this.config.creatorUsername,
        // Gui THANG URL goc: RioHub tu parse, ke ca link rut gon vt.tiktok.com (verify 2026-10-09).
        product_url: input.productUrl,
        sub_id: input.subId,
        channel: this.config.channel,
      });
    } catch (err) {
      throw mapRiohubError(err);
    }

    if (!res.affiliate_link) {
      throw new ProviderUnavailableError("missing_affiliate_link", "RioHub tra 200 nhung thieu affiliate_link");
    }

    return {
      affiliateUrl: res.affiliate_link,
      // product_error / product null -> van tra link, chi bo uoc tinh (tai lieu RioHub: "khong lay
      // duoc thi product = null, link van tra binh thuong").
      commissionEstimate: estimateFrom(res.product),
      productName: res.product?.title ?? null,
    };
  }

  /** TikTok khong co nguon coupon chung theo merchant, giong Shopee. */
  async getPromotions(_merchant: MerchantId, _limit: number): Promise<PromotionItem[]> {
    return [];
  }
}

/**
 * Dau THAP cua mot chuoi co the la khoang ("250.00 - 735.00") hoac mot so ("5000").
 * Lay dau thap o moi cho co the: cong voi viec `commission.rate` von thap hon thuc te ~17%,
 * moi sai so deu don ve phia HUA IT HON TRA.
 */
export function lowEndAmount(value: string | undefined | null): number | null {
  if (!value) return null;
  const first = value.split("-")[0]?.trim() ?? "";
  const parsed = Number(first);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function estimateFrom(product: RiohubProduct | null | undefined): CommissionEstimate | null {
  if (!product) return null;

  // observed_commission la rate THUC TE do tu don da phat sinh (da gom hoa hong thuong);
  // commission.rate chi la rate chuan shop niem yet, do duoc thap hon thuc te (500 vs 600).
  const rateRaw = product.observed_commission?.commission_rate ?? product.commission?.rate;
  if (typeof rateRaw !== "number" || rateRaw <= 0) return null;
  const ratePercent = rateRaw / 100;

  const price =
    lowEndAmount(product.sales_price?.minimum_amount) ?? lowEndAmount(product.commission?.amount);
  if (price === null) return null;

  // TikTok KHONG co tran hoa hong nhu Shopee (40k) nen nhan tay la hop le - khac han quy tac cung
  // cua Shopee la phai lay thang field `commission`.
  return {
    ratePercent,
    estimatedAmount: Math.round((price * ratePercent) / 100),
    currency: "VND",
  };
}

/**
 * Chia nhanh theo `error.code`, KHONG theo HTTP status.
 *
 * Nhanh mac dinh (ProviderUnavailableError) la BAT BUOC: bang ma loi cua RioHub khong day du -
 * `mcn_membership_required` va `server_error` deu khong co trong tai lieu. Thieu no thi mot ma moi
 * cua ho se lam bot chet cam.
 */
export function mapRiohubError(err: unknown): AppError {
  if (err instanceof RiohubUnreachableError) {
    return new ProviderUnavailableError("unreachable", `khong voi toi ${err.attempts} ten mien`);
  }
  if (err instanceof RiohubApiError) {
    if (err.code === "product_not_promotable") {
      return new ProductNotAffiliateEligibleError(err.apiMessage);
    }
    if (err.code === "validation_error" && /cannot extract product_id/i.test(err.apiMessage)) {
      return new NotAProductLinkError("TikTok Shop");
    }
    return new ProviderUnavailableError(err.code, err.apiMessage);
  }
  return new ProviderUnavailableError("unknown", err instanceof Error ? err.message : String(err));
}
