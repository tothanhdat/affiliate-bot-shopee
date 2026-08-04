import "dotenv/config";
import { MERCHANTS, type MerchantId } from "../core/merchants.js";

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Env var ${name} phai la so nguyen, nhan duoc: "${raw}"`);
  }
  return parsed;
}

function optionalBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw.toLowerCase() === "true";
}

export type AffiliateProviderName = "mock" | "accesstrade";

function resolveAffiliateProvider(): AffiliateProviderName {
  const raw = optional("AFFILIATE_PROVIDER", "mock").toLowerCase();
  if (raw !== "mock" && raw !== "accesstrade") {
    throw new Error(
      `AFFILIATE_PROVIDER phai la "mock" hoac "accesstrade", nhan duoc: "${raw}"`
    );
  }
  return raw;
}

/**
 * "shopee" -> "SHOPEE", dung de suy ra ten bien moi truong ACCESSTRADE_CAMPAIGN_ID_SHOPEE, v.v.
 * promotionsMerchant mac dinh xac minh that (2026-07-31): shopee, lazada_kol.
 */
const DEFAULT_PROMOTIONS_MERCHANT: Record<MerchantId, string> = {
  shopee: "shopee",
  lazada: "lazada_kol",
};

function resolveAccesstradeMerchants(): Record<MerchantId, { campaignId: string; promotionsMerchant: string }> {
  const result = {} as Record<MerchantId, { campaignId: string; promotionsMerchant: string }>;
  for (const merchant of MERCHANTS) {
    const suffix = merchant.id.toUpperCase();
    result[merchant.id] = {
      campaignId: optional(`ACCESSTRADE_CAMPAIGN_ID_${suffix}`, ""),
      promotionsMerchant: optional(
        `ACCESSTRADE_PROMOTIONS_MERCHANT_${suffix}`,
        DEFAULT_PROMOTIONS_MERCHANT[merchant.id]
      ),
    };
  }
  return result;
}

export const env = {
  port: optionalInt("PORT", 3000),

  affiliateProvider: resolveAffiliateProvider(),
  accesstrade: {
    apiKey: optional("ACCESSTRADE_API_KEY", ""),
    apiBase: optional("ACCESSTRADE_API_BASE", "https://api.accesstrade.vn"),
    endpointPath: optional("ACCESSTRADE_ENDPOINT_PATH", "/v1/product_link/create"),
    timeoutMs: optionalInt("ACCESSTRADE_TIMEOUT_MS", 4000),
    promotionsCacheTtlMs: optionalInt("ACCESSTRADE_PROMOTIONS_CACHE_TTL_MS", 10 * 60 * 1000),
    /** campaign_id + promotions merchant slug rieng cho tung merchant (Shopee, Lazada...) */
    merchants: resolveAccesstradeMerchants(),
  },

  telegramBotToken: optional("TELEGRAM_BOT_TOKEN", ""),

  zaloGroup: {
    // Mac dinh tat - day la tinh nang tu dong hoa tai khoan Zalo ca nhan (khong chinh
    // thuc), can bat co y thuc. Xem README ve rui ro khoa tai khoan.
    enabled: optionalBool("ZALO_GROUP_ENABLED", false),
    sessionPath: optional("ZALO_SESSION_PATH", "./data/zalo-session.json"),
    qrPath: optional("ZALO_QR_PATH", "./data/zalo-qr.png"),
  },

  rateLimit: {
    maxRequests: optionalInt("RATE_LIMIT_MAX_REQUESTS", 10),
    windowMs: optionalInt("RATE_LIMIT_WINDOW_MS", 5 * 60 * 1000),
  },
  maxLinksPerMessage: optionalInt("MAX_LINKS_PER_MESSAGE", 5),
  promotionsDisplayLimit: optionalInt("PROMOTIONS_DISPLAY_LIMIT", 3),

  databasePath: optional("DATABASE_PATH", "./data/requests.db"),
};

export function assertAffiliateProviderConfigured(): void {
  if (env.affiliateProvider !== "accesstrade") return;

  if (env.accesstrade.apiKey === "") {
    throw new Error(
      "AFFILIATE_PROVIDER=accesstrade nhung thieu ACCESSTRADE_API_KEY. " +
        "Hoan tat T0.1 (dang ky Accesstrade, lay API key) roi dien vao .env, " +
        "hoac dat AFFILIATE_PROVIDER=mock de chay thu."
    );
  }
  // Khong bat buoc campaign_id cho TAT CA merchant o day - moi merchant duoc kiem tra
  // rieng luc xu ly request that (MerchantNotConfiguredError), vi co the ban chi dung
  // 1 vai merchant (vi du chi Shopee) chu chua dang ky Lazada.
}

export function assertTelegramConfigured(): void {
  if (env.telegramBotToken === "") {
    throw new Error(
      "Thieu TELEGRAM_BOT_TOKEN. Hoan tat T0.2 (tao bot qua BotFather) roi dien vao .env."
    );
  }
}
