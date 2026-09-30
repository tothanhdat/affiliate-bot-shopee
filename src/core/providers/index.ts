import { env, assertAffiliateProviderConfigured } from "../../config/env.js";
import type { AffiliateProvider } from "../affiliateProvider.js";
import type { LogStore } from "../logStore.js";
import { MockAffiliateProvider } from "./mockProvider.js";
import { ShopeeAffiliateProvider } from "./shopeeAffiliateProvider.js";
import { AddlivetagCommissionLookup, type CommissionLookup } from "../commissionLookup.js";

/**
 * Tao nguon tra hoa hong uoc tinh, hoac `null` neu chua bat/thieu cau hinh.
 *
 * Thieu API key thi ROT VE tat kem canh bao chu KHONG throw - giong cach faq/providers/index.ts
 * xu ly khi thieu ANTHROPIC_API_KEY. Ly do: day la tinh nang phu, khong duoc phep lam bot khong
 * khoi dong duoc; thieu no thi bot chi tra tin nhan nhu truoc 2026-10-01.
 */
function createCommissionLookup(): CommissionLookup | null {
  if (!env.commissionLookup.enabled) return null;

  if (env.commissionLookup.apiKey === "") {
    console.warn(
      "[commissionLookup] COMMISSION_LOOKUP_ENABLED=true nhung thieu ADDLIVETAG_API_KEY - " +
        "tat tinh nang uoc tinh hoa hong. Lay key tai addlivetag.com -> API Key -> Tao Key."
    );
    return null;
  }

  return new AddlivetagCommissionLookup({
    apiKey: env.commissionLookup.apiKey,
    timeoutMs: env.commissionLookup.timeoutMs,
    baseRatePercent: env.commissionLookup.baseRatePercent,
    capVnd: env.commissionLookup.capVnd,
  });
}

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
      commissionLookup: createCommissionLookup(),
    });
  }

  return new MockAffiliateProvider();
}
