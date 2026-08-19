import { test } from "node:test";
import assert from "node:assert/strict";
import { CompositeAffiliateProvider } from "../providers/compositeProvider.js";
import { MerchantNotConfiguredError } from "../errors.js";
import type { AffiliateProvider, CreateAffiliateLinkInput, CreateAffiliateLinkOutput, PromotionItem } from "../affiliateProvider.js";
import type { MerchantId } from "../merchants.js";

/** Provider gia lap, chi ghi lai duoc goi voi input/merchant nao de assert dinh tuyen dung. */
class RecordingProvider implements AffiliateProvider {
  createAffiliateLinkCalls: CreateAffiliateLinkInput[] = [];
  getPromotionsCalls: Array<{ merchant: MerchantId; limit: number }> = [];

  constructor(private readonly tag: string) {}

  async createAffiliateLink(input: CreateAffiliateLinkInput): Promise<CreateAffiliateLinkOutput> {
    this.createAffiliateLinkCalls.push(input);
    return { affiliateUrl: `https://${this.tag}.local/${input.subId}` };
  }

  async getPromotions(merchant: MerchantId, limit: number): Promise<PromotionItem[]> {
    this.getPromotionsCalls.push({ merchant, limit });
    return [];
  }
}

test("CompositeAffiliateProvider: dinh tuyen createAffiliateLink dung provider theo merchant", async () => {
  const shopeeProvider = new RecordingProvider("shopee-direct");
  const accesstradeProvider = new RecordingProvider("accesstrade");
  const composite = new CompositeAffiliateProvider({
    shopee: shopeeProvider,
    lazada: accesstradeProvider,
    tiktokshop: accesstradeProvider,
  });

  const shopeeResult = await composite.createAffiliateLink({
    merchant: "shopee",
    productUrl: "https://shopee.vn/abc-i.1.2",
    subId: "sub-1",
  });
  assert.match(shopeeResult.affiliateUrl, /^https:\/\/shopee-direct\.local\//);
  assert.equal(shopeeProvider.createAffiliateLinkCalls.length, 1);
  assert.equal(accesstradeProvider.createAffiliateLinkCalls.length, 0);

  const tiktokResult = await composite.createAffiliateLink({
    merchant: "tiktokshop",
    productUrl: "https://www.tiktok.com/view/product/123",
    subId: "sub-2",
    itemId: "123",
  });
  assert.match(tiktokResult.affiliateUrl, /^https:\/\/accesstrade\.local\//);
  assert.equal(accesstradeProvider.createAffiliateLinkCalls.length, 1);
});

test("CompositeAffiliateProvider: nem MerchantNotConfiguredError voi merchant khong co trong map", async () => {
  const composite = new CompositeAffiliateProvider({
    shopee: new RecordingProvider("shopee-direct"),
  });

  await assert.rejects(
    () =>
      composite.createAffiliateLink({
        merchant: "lazada",
        productUrl: "https://lazada.vn/products/abc",
        subId: "sub-1",
      }),
    MerchantNotConfiguredError
  );
  await assert.rejects(() => composite.getPromotions("tiktokshop", 5), MerchantNotConfiguredError);
});

test("CompositeAffiliateProvider: getPromotions dinh tuyen dung provider va giu nguyen limit", async () => {
  const shopeeProvider = new RecordingProvider("shopee-direct");
  const composite = new CompositeAffiliateProvider({ shopee: shopeeProvider });

  await composite.getPromotions("shopee", 7);
  assert.deepEqual(shopeeProvider.getPromotionsCalls, [{ merchant: "shopee", limit: 7 }]);
});
