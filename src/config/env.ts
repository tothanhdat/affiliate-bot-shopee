import "dotenv/config";

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

export const env = {
  port: optionalInt("PORT", 3000),

  affiliateProvider: resolveAffiliateProvider(),
  accesstrade: {
    apiKey: optional("ACCESSTRADE_API_KEY", ""),
    apiBase: optional("ACCESSTRADE_API_BASE", "https://api.accesstrade.vn"),
    endpointPath: optional("ACCESSTRADE_ENDPOINT_PATH", "/v1/product_link/create"),
    timeoutMs: optionalInt("ACCESSTRADE_TIMEOUT_MS", 4000),
  },

  telegramBotToken: optional("TELEGRAM_BOT_TOKEN", ""),

  rateLimit: {
    maxRequests: optionalInt("RATE_LIMIT_MAX_REQUESTS", 10),
    windowMs: optionalInt("RATE_LIMIT_WINDOW_MS", 5 * 60 * 1000),
  },
  maxLinksPerMessage: optionalInt("MAX_LINKS_PER_MESSAGE", 5),

  databasePath: optional("DATABASE_PATH", "./data/requests.db"),
};

export function assertAffiliateProviderConfigured(): void {
  if (env.affiliateProvider === "accesstrade" && env.accesstrade.apiKey === "") {
    throw new Error(
      "AFFILIATE_PROVIDER=accesstrade nhung thieu ACCESSTRADE_API_KEY. " +
        "Hoan tat T0.1 (dang ky Accesstrade, lay API key) roi dien vao .env, " +
        "hoac dat AFFILIATE_PROVIDER=mock de chay thu."
    );
  }
}

export function assertTelegramConfigured(): void {
  if (env.telegramBotToken === "") {
    throw new Error(
      "Thieu TELEGRAM_BOT_TOKEN. Hoan tat T0.2 (tao bot qua BotFather) roi dien vao .env."
    );
  }
}
