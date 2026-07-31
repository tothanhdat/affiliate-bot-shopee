import { env, assertAffiliateProviderConfigured } from "../../config/env.js";
import type { AffiliateProvider } from "../affiliateProvider.js";
import { AccesstradeProvider } from "./accesstradeProvider.js";
import { MockAffiliateProvider } from "./mockProvider.js";

export function createAffiliateProvider(): AffiliateProvider {
  assertAffiliateProviderConfigured();

  if (env.affiliateProvider === "accesstrade") {
    return new AccesstradeProvider({
      apiKey: env.accesstrade.apiKey,
      campaignId: env.accesstrade.campaignId,
      apiBase: env.accesstrade.apiBase,
      endpointPath: env.accesstrade.endpointPath,
      timeoutMs: env.accesstrade.timeoutMs,
      promotionsMerchant: env.accesstrade.promotionsMerchant,
      promotionsCacheTtlMs: env.accesstrade.promotionsCacheTtlMs,
    });
  }

  return new MockAffiliateProvider();
}
