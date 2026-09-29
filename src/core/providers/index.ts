import { env, assertAffiliateProviderConfigured } from "../../config/env.js";
import type { AffiliateProvider } from "../affiliateProvider.js";
import type { LogStore } from "../logStore.js";
import { MockAffiliateProvider } from "./mockProvider.js";
import { ShopeeAffiliateProvider } from "./shopeeAffiliateProvider.js";

/**
 * logStore duoc truyen vao (thay vi ShopeeAffiliateProvider tu tao rieng 1 SQLite store) vi
 * short_links (T3.2) dung chung DB voi requests.db - tranh 2 ket noi/2 file rieng cho cung 1
 * du lieu khong phai tai chinh.
 *
 * Tu 2026-09-29 chi con 1 duong tao link that: Shopee qua co che an_redir. Accesstrade da bi
 * go han cung luc voi viec bo TikTok Shop/Lazada khoi scope - khong con merchant nao di qua no.
 */
export function createAffiliateProvider(logStore: LogStore): AffiliateProvider {
  assertAffiliateProviderConfigured();

  if (env.affiliateProvider === "shopee_direct") {
    return new ShopeeAffiliateProvider({
      affiliateId: env.shopeeDirect.affiliateId,
      createShortLink: (targetUrl) => logStore.createShortLink(targetUrl),
      // DASHBOARD_BASE_URL nguoi dung dien co the co dau "/" cuoi - bo di de khong tao URL
      // dang "https://bot.example.com//s/abc123".
      shortLinkBaseUrl: env.dashboard.baseUrl.replace(/\/$/, ""),
    });
  }

  return new MockAffiliateProvider();
}
