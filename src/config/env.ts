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
  // Rong vi chua xac minh TikTok Shop co dung chung endpoint /v1/offers_informations
  // khong (endpoint tao link cua no da khac hoan toan Shopee/Lazada, xem accesstradeProvider.ts) -
  // khong doan mo slug. getPromotions cho merchant nay se bao loi ro rang neu bi goi ma chua co config.
  tiktokshop: "",
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
  // Mac dinh 0 (tat) tu 2026-08-17 - tap trung hoan toan vao cashback, khong con hien
  // ma giam gia chung nua. Bat lai bang cach set > 0 trong .env neu can dung sau.
  promotionsDisplayLimit: optionalInt("PROMOTIONS_DISPLAY_LIMIT", 0),

  databasePath: optional("DATABASE_PATH", "./data/requests.db"),

  /** DB rieng cho ledger tai chinh (tach khoi requests.db de co lap du lieu tien bac). */
  ledgerDatabasePath: optional("LEDGER_DATABASE_PATH", "./data/ledger.db"),

  commission: {
    /** % hoa hong user duoc nhan tren phan DA TRU thue/phi, phan con lai thuoc chu bot. Chot tai thoi diem ghi nhan entry, doi sau khong anh huong nguoc cac don da ghi. */
    userSharePercent: optionalInt("COMMISSION_USER_SHARE_PERCENT", 80),
    /** % thue tren hoa hong goc, tru truoc tien. Mac dinh 10% theo tham khao 1 bot doi thu (xem CLAUDE.md). */
    taxPercent: optionalInt("COMMISSION_TAX_PERCENT", 10),
    /** % phi san, tinh tren phan hoa hong DA TRU THUE (khong phai tren hoa hong goc). Mac dinh 1% theo tham khao 1 bot doi thu. */
    platformFeePercent: optionalInt("COMMISSION_PLATFORM_FEE_PERCENT", 1),
    /**
     * Nguong hop ly cua commissionAmount so voi orderAmount (%) khi ghi nhan don tay - vuot qua bi
     * tu choi ngay (ImplausibleCommissionAmountError), chan loi go nham (vd them 1 so 0) luc nhap CLI/CSV.
     */
    maxRatioPercent: optionalInt("COMMISSION_MAX_RATIO_PERCENT", 50),
  },

  withdrawal: {
    /** So du kha dung toi thieu (VND) de duoc gui yeu cau rut tien. */
    thresholdVnd: optionalInt("WITHDRAWAL_THRESHOLD_VND", 50_000),
    /** Thu muc luu anh chup man hinh bang chung da chuyen khoan (bat buoc khi "Danh dau da tra"). */
    proofDir: optional("WITHDRAWAL_PROOF_DIR", "./data/withdrawal-proofs"),
  },

  dashboard: {
    /** Dung de dung link "/d/:token" tra ve khi user nhan "idid". */
    baseUrl: optional("DASHBOARD_BASE_URL", "http://localhost:3000"),
  },

  /** Chat ID Telegram cua chu bot, dung de bao khi co yeu cau rut tien moi. Rong = chi xem duoc qua ledgerAdmin.ts list-pending-withdrawals. */
  adminTelegramChatId: optional("ADMIN_TELEGRAM_CHAT_ID", ""),

  admin: {
    /** Mat khau dang nhap trang /admin (1 tai khoan mac dinh). Rong = khong ai dang nhap duoc. */
    password: optional("ADMIN_PASSWORD", ""),
  },
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
