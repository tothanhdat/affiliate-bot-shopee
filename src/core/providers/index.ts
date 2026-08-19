import { env, assertAffiliateProviderConfigured } from "../../config/env.js";
import type { AffiliateProvider } from "../affiliateProvider.js";
import type { LogStore } from "../logStore.js";
import { AccesstradeProvider, type AccesstradeProviderConfig } from "./accesstradeProvider.js";
import { CompositeAffiliateProvider } from "./compositeProvider.js";
import { MockAffiliateProvider } from "./mockProvider.js";
import { ShopeeAffiliateProvider } from "./shopeeAffiliateProvider.js";

function buildAccesstradeConfig(): AccesstradeProviderConfig {
  return {
    apiKey: env.accesstrade.apiKey,
    apiBase: env.accesstrade.apiBase,
    endpointPath: env.accesstrade.endpointPath,
    timeoutMs: env.accesstrade.timeoutMs,
    promotionsCacheTtlMs: env.accesstrade.promotionsCacheTtlMs,
    merchants: env.accesstrade.merchants,
  };
}

/**
 * logStore duoc truyen vao (thay vi ShopeeAffiliateProvider tu tao rieng 1 SQLite store) vi
 * short_links (T3.2) dung chung DB voi requests.db - tranh 2 ket noi/2 file rieng cho cung 1
 * du lieu khong phai tai chinh.
 */
export function createAffiliateProvider(logStore: LogStore): AffiliateProvider {
  assertAffiliateProviderConfigured();

  if (env.affiliateProvider === "accesstrade") {
    return new AccesstradeProvider(buildAccesstradeConfig());
  }

  if (env.affiliateProvider === "shopee_direct") {
    // Shopee di thang qua co che an_redir (khong qua Accesstrade) - Lazada/TikTok Shop van
    // dung chung 1 instance AccesstradeProvider nhu truoc (xem T3.1, spec muc 5).
    const accesstradeProvider = new AccesstradeProvider(buildAccesstradeConfig());
    return new CompositeAffiliateProvider({
      shopee: new ShopeeAffiliateProvider({
        affiliateId: env.shopeeDirect.affiliateId,
        createShortLink: (targetUrl) => logStore.createShortLink(targetUrl),
        // DASHBOARD_BASE_URL nguoi dung dien co the co dau "/" cuoi - bo di de khong tao URL
        // dang "https://bot.example.com//s/abc123".
        shortLinkBaseUrl: env.dashboard.baseUrl.replace(/\/$/, ""),
      }),
      lazada: accesstradeProvider,
      tiktokshop: accesstradeProvider,
    });
  }

  return new MockAffiliateProvider();
}
