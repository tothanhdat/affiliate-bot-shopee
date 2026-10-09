import { MerchantNotConfiguredError } from "../errors.js";
import { getMerchantConfig, type MerchantId } from "../merchants.js";
import type {
  AffiliateProvider,
  CreateAffiliateLinkInput,
  CreateAffiliateLinkOutput,
  PromotionItem,
} from "../affiliateProvider.js";

/**
 * Dinh tuyen theo merchant. Truoc 2026-10-09 he thong chi co DUNG MOT provider that nen factory
 * tra thang no; tu khi co TikTok thi can lop nay.
 *
 * Factory CHI boc lop nay khi co tu 2 provider tro len - mot provider thi tra thang, do mot lop
 * gian tiep cho truong hop pho bien nhat (instance chi chay Shopee).
 */
export class CompositeAffiliateProvider implements AffiliateProvider {
  constructor(private readonly byMerchant: ReadonlyMap<MerchantId, AffiliateProvider>) {}

  async createAffiliateLink(input: CreateAffiliateLinkInput): Promise<CreateAffiliateLinkOutput> {
    return this.require(input.merchant).createAffiliateLink(input);
  }

  async getPromotions(merchant: MerchantId, limit: number): Promise<PromotionItem[]> {
    return this.require(merchant).getPromotions(merchant, limit);
  }

  private require(merchant: MerchantId): AffiliateProvider {
    const provider = this.byMerchant.get(merchant);
    if (!provider) {
      throw new MerchantNotConfiguredError(getMerchantConfig(merchant).displayName);
    }
    return provider;
  }
}
