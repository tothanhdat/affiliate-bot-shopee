import type { MerchantId } from "../merchants.js";
import type {
  AffiliateProvider,
  CreateAffiliateLinkInput,
  CreateAffiliateLinkOutput,
  PromotionItem,
} from "../affiliateProvider.js";

const MOCK_PROMOTIONS: Record<MerchantId, PromotionItem[]> = {
  shopee: [
    { couponCode: "MOCKSHOPEE10", description: "Giam 10% toi da 50,000d cho don tu 200,000d (du lieu gia lap)" },
    { couponCode: "MOCKSHOPEE20", description: "Giam 20% toi da 100,000d cho don tu 500,000d (du lieu gia lap)" },
  ],
  lazada: [
    { couponCode: "MOCKLAZADA15", description: "Giam 15% toi da 80,000d cho don tu 300,000d (du lieu gia lap)" },
  ],
};

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

  async getPromotions(merchant: MerchantId, limit: number): Promise<PromotionItem[]> {
    return (MOCK_PROMOTIONS[merchant] ?? []).slice(0, limit);
  }
}
