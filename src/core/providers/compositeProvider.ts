import { MerchantNotConfiguredError } from "../errors.js";
import { getMerchantConfig, type MerchantId } from "../merchants.js";
import type {
  AffiliateProvider,
  CreateAffiliateLinkInput,
  CreateAffiliateLinkOutput,
  PromotionItem,
} from "../affiliateProvider.js";

/**
 * Dinh tuyen 1 AffiliateProvider khac nhau THEO TUNG MERCHANT - dung khi khong co 1 nguon affiliate
 * duy nhat phu hop cho toan bo merchant. Truong hop dau tien (2026-08-19, xem T3.1): Shopee dung
 * ShopeeAffiliateProvider (co che an_redir truc tiep), Lazada/TikTok Shop van qua AccesstradeProvider
 * nhu cu. Merchant khong co provider trong map -> MerchantNotConfiguredError, cung hanh vi voi luc
 * AccesstradeProvider thieu campaign_id cho 1 merchant.
 */
export class CompositeAffiliateProvider implements AffiliateProvider {
  constructor(private readonly providers: Partial<Record<MerchantId, AffiliateProvider>>) {}

  private resolve(merchant: MerchantId): AffiliateProvider {
    const provider = this.providers[merchant];
    if (!provider) {
      throw new MerchantNotConfiguredError(getMerchantConfig(merchant).displayName);
    }
    return provider;
  }

  // async (khong chi return truc tiep) de resolve() throw dong bo tu dong bien thanh Promise
  // reject - dam bao createAffiliateLink()/getPromotions() luon la 1 promise dung nghia du
  // merchant khong co trong map, khop convention cac provider khac (AccesstradeProvider,
  // MockAffiliateProvider) va tuong thich dung voi assert.rejects() trong test.
  async createAffiliateLink(input: CreateAffiliateLinkInput): Promise<CreateAffiliateLinkOutput> {
    return this.resolve(input.merchant).createAffiliateLink(input);
  }

  async getPromotions(merchant: MerchantId, limit: number): Promise<PromotionItem[]> {
    return this.resolve(merchant).getPromotions(merchant, limit);
  }
}
