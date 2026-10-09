import { env, assertAffiliateProviderConfigured } from "../../config/env.js";
import type { AffiliateProvider } from "../affiliateProvider.js";
import type { LogStore } from "../logStore.js";
import { MockAffiliateProvider } from "./mockProvider.js";
import { ShopeeAffiliateProvider } from "./shopeeAffiliateProvider.js";
import { AddlivetagCommissionLookup, type CommissionLookup } from "../commissionLookup.js";
import type { MerchantId } from "../merchants.js";
import { CompositeAffiliateProvider } from "./compositeProvider.js";
import { RiohubClient } from "./riohubClient.js";
import { TiktokAffiliateProvider } from "./tiktokAffiliateProvider.js";

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
 * Provider TikTok, hoac `null` neu chua bat/thieu cau hinh.
 *
 * Thieu key thi ROT VE tat kem canh bao chu KHONG throw - giong createCommissionLookup(). Ly do:
 * TikTok la tinh nang them, khong duoc phep lam bot khong khoi dong duoc; thieu no thi link TikTok
 * quay ve hanh vi cu (RetiredMerchantLinkError).
 */
function createTiktokProvider(): AffiliateProvider | null {
  if (!env.tiktok.enabled) return null;

  const missing: string[] = [];
  if (env.tiktok.apiKey === "") missing.push("RIOHUB_API_KEY");
  if (env.tiktok.creatorUsername === "") missing.push("RIOHUB_CREATOR_USERNAME");
  if (missing.length > 0) {
    console.warn(
      `[tiktok] TIKTOK_ENABLED=true nhung thieu ${missing.join(", ")} - tat TikTok. ` +
        "Lay API key tai riohub.vn/tiktok-shop-developer."
    );
    return null;
  }

  return new TiktokAffiliateProvider({
    client: new RiohubClient({
      apiKey: env.tiktok.apiKey,
      baseUrls: env.tiktok.baseUrls,
      timeoutMs: env.tiktok.timeoutMs,
    }),
    creatorUsername: env.tiktok.creatorUsername,
    channel: env.tiktok.linkChannel,
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

  if (env.affiliateProvider !== "shopee_direct") {
    return new MockAffiliateProvider();
  }

  const byMerchant = new Map<MerchantId, AffiliateProvider>();
  byMerchant.set(
    "shopee",
    new ShopeeAffiliateProvider({
      affiliateId: env.shopeeDirect.affiliateId,
      createShortLink: (targetUrl) => logStore.createShortLink(targetUrl),
      shortLinkBaseUrl: env.dashboard.baseUrl.replace(/\/$/, ""),
      commissionLookup: createCommissionLookup(),
    })
  );

  const tiktok = createTiktokProvider();
  if (tiktok) byMerchant.set("tiktokshop", tiktok);

  // Mot provider thi tra thang - do mot lop gian tiep cho truong hop pho bien nhat.
  const only = byMerchant.size === 1 ? [...byMerchant.values()][0] : null;
  return only ?? new CompositeAffiliateProvider(byMerchant);
}
