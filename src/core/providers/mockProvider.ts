import type {
  AffiliateProvider,
  CreateAffiliateLinkInput,
  CreateAffiliateLinkOutput,
  PromotionItem,
} from "../affiliateProvider.js";

const MOCK_PROMOTIONS: PromotionItem[] = [
  { couponCode: "MOCKCODE10", description: "Giam 10% toi da 50,000d cho don tu 200,000d (du lieu gia lap)" },
  { couponCode: "MOCKCODE20", description: "Giam 20% toi da 100,000d cho don tu 500,000d (du lieu gia lap)" },
];

/**
 * Provider gia lap, dung khi chua co credentials Accesstrade that (T0.1 chua hoan tat).
 * Sinh 1 "short link" deterministic tu subId de dev/test toan bo luong end-to-end.
 * KHONG dung trong production - hoa hong se khong duoc ghi nhan that.
 */
export class MockAffiliateProvider implements AffiliateProvider {
  async createAffiliateLink(
    input: CreateAffiliateLinkInput
  ): Promise<CreateAffiliateLinkOutput> {
    return {
      affiliateUrl: `https://mock-aff.local/${input.subId}?target=${encodeURIComponent(
        input.productUrl
      )}`,
    };
  }

  async getPromotions(limit: number): Promise<PromotionItem[]> {
    return MOCK_PROMOTIONS.slice(0, limit);
  }
}
