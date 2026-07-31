import type {
  AffiliateProvider,
  CreateAffiliateLinkInput,
  CreateAffiliateLinkOutput,
} from "../affiliateProvider.js";

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
}
