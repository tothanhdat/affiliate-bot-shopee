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

function optionalBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw.toLowerCase() === "true";
}

/**
 * Bien so tuy chon KHONG co gia tri mac dinh - bo trong thi tra `null` (khac optionalInt luon co
 * fallback). Dung cho cac tham so ma "khong truyen" mang y nghia rieng, vi du base_rate/cap cua
 * commissionLookup: bo trong = de ben cung cap tu lay rate that cua tai khoan.
 */
function optionalNumberOrNull(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return null;
  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Env var ${name} phai la so, nhan duoc: "${raw}"`);
  }
  return parsed;
}

// "shopee_direct" (them 2026-08-19): Shopee dung ShopeeAffiliateProvider (co che an_redir truc
// tiep, khong can Open API). Tu 2026-09-29 day la nguon affiliate DUY NHAT - lua chon
// "accesstrade" da bi go cung luc voi viec bo TikTok Shop/Lazada khoi scope.
export type AffiliateProviderName = "mock" | "shopee_direct";

function resolveAffiliateProvider(): AffiliateProviderName {
  const raw = optional("AFFILIATE_PROVIDER", "mock").toLowerCase();
  if (raw !== "mock" && raw !== "shopee_direct") {
    throw new Error(
      `AFFILIATE_PROVIDER phai la "mock" hoac "shopee_direct", nhan duoc: "${raw}"`
    );
  }
  return raw;
}

export const env = {
  port: optionalInt("PORT", 3000),

  affiliateProvider: resolveAffiliateProvider(),
  /** Chi dung khi AFFILIATE_PROVIDER=shopee_direct (xem ShopeeAffiliateProvider). */
  shopeeDirect: {
    /** affiliate_id co dinh cua tai khoan, lay tai affiliate.shopee.vn/account_setting. */
    affiliateId: optional("SHOPEE_AFFILIATE_ID", ""),
  },

  telegramBotToken: optional("TELEGRAM_BOT_TOKEN", ""),

  zaloGroup: {
    // Mac dinh tat - day la tinh nang tu dong hoa tai khoan Zalo ca nhan (khong chinh
    // thuc), can bat co y thuc. Xem README ve rui ro khoa tai khoan.
    enabled: optionalBool("ZALO_GROUP_ENABLED", false),
    sessionPath: optional("ZALO_SESSION_PATH", "./data/zalo-session.json"),
    qrPath: optional("ZALO_QR_PATH", "./data/zalo-qr.png"),
  },

  /**
   * FAQ tu dong tra loi trong Zalo DM (2026-09-13). Mac dinh "off" - giong AFFILIATE_PROVIDER=mock:
   * deploy code moi ma chua set key thi hanh vi bot KHONG DOI so voi truoc (van im lang voi moi DM
   * khong phai "xemhh"/link san pham).
   */
  faq: {
    provider: optional("FAQ_PROVIDER", "off"),
    apiKey: optional("ANTHROPIC_API_KEY", ""),
    model: optional("FAQ_MODEL", "claude-haiku-4-5"),
    rateLimit: {
      maxRequests: optionalInt("FAQ_RATE_LIMIT_MAX", 5),
      windowMs: optionalInt("FAQ_RATE_LIMIT_WINDOW_MS", 10 * 60 * 1000),
    },
  },

  rateLimit: {
    maxRequests: optionalInt("RATE_LIMIT_MAX_REQUESTS", 10),
    windowMs: optionalInt("RATE_LIMIT_WINDOW_MS", 5 * 60 * 1000),
  },
  /** Rieng cho POST /admin/login - chan brute-force mat khau (rui ro so 1 trong rui-ro-can-giai-quyet.md). */
  adminLoginRateLimit: {
    maxRequests: optionalInt("ADMIN_LOGIN_RATE_LIMIT_MAX_REQUESTS", 5),
    windowMs: optionalInt("ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  },
  maxLinksPerMessage: optionalInt("MAX_LINKS_PER_MESSAGE", 5),
  // Mac dinh 0 (tat) tu 2026-08-17 - tap trung hoan toan vao cashback, khong con hien
  // ma giam gia chung nua. Bat lai bang cach set > 0 trong .env neu can dung sau.
  promotionsDisplayLimit: optionalInt("PROMOTIONS_DISPLAY_LIMIT", 0),

  databasePath: optional("DATABASE_PATH", "./data/requests.db"),

  /** DB rieng cho ledger tai chinh (tach khoi requests.db de co lap du lieu tien bac). */
  ledgerDatabasePath: optional("LEDGER_DATABASE_PATH", "./data/ledger.db"),

  commission: {
    /**
     * % hoa hong user duoc nhan tren phan DA TRU thue/phi, phan con lai thuoc chu bot. Chot tai
     * thoi diem ghi nhan entry, doi sau khong anh huong nguoc cac don da ghi. Mac dinh 90% (doi tu
     * 80% ngay 2026-08-19, chu bot giu 10%).
     */
    userSharePercent: optionalInt("COMMISSION_USER_SHARE_PERCENT", 90),
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

  /**
   * Tra so tien hoa hong uoc tinh cua san pham ngay luc tra link (2026-10-01).
   * Xem src/core/commissionLookup.ts de biet VI SAO phai di qua API ben thu ba thay vi goi thang
   * Shopee (Open API bi tu choi + API noi bo portal co chu ky chong bot gan theo tung request).
   *
   * Mac dinh TAT: khong bat/khong co API key thi hanh vi bot khong doi mot ly nao - bot van tra
   * tin nhan nhu cu. Giong triet ly cua FAQ_PROVIDER=off va AFFILIATE_PROVIDER=mock.
   */
  commissionLookup: {
    enabled: optionalBool("COMMISSION_LOOKUP_ENABLED", false),
    /** Lay tai addlivetag.com -> API Key -> Tao Key. BAT BUOC tu 01/10/2026 (khong co -> HTTP 401). */
    apiKey: optional("ADDLIVETAG_API_KEY", ""),
    /**
     * Tran thoi gian cho. 5000ms (tu 2000ms, 2026-10-10) - 2000ms qua ngan, nhieu lookup bi huy
     * dung luc nhieu nguoi gui link gan nhu cung luc trong group (addlivetag cham lai duoi tai),
     * lam mat so uoc tinh oan dù order van ghi nhan binh thuong. Van la tran NGAN cho tinh nang PHU,
     * khong duoc lam cham viec tra link qua muc chiu duoc.
     */
    timeoutMs: optionalInt("COMMISSION_LOOKUP_TIMEOUT_MS", 5000),
    /**
     * CHI dien khi tier tai khoan khac mac dinh cua ben cung cap. Bo trong (mac dinh) thi ho tu
     * lay rate that - da doi chieu 2026-09-30 tren 3 san pham that, khop chinh xac portal.
     */
    baseRatePercent: optionalNumberOrNull("COMMISSION_LOOKUP_BASE_RATE_PERCENT"),
    /** Tran hoa hong san (VND) cua tai khoan. Bo trong = dung mac dinh cua ben cung cap (40.000d). */
    capVnd: optionalNumberOrNull("COMMISSION_LOOKUP_CAP_VND"),
  },

  /**
   * TikTok Shop qua RioHub (2026-10-09). Mac dinh TAT - giong FAQ_PROVIDER=off va
   * COMMISSION_LOOKUP_ENABLED=false: deploy code moi ma chua cau hinh thi hanh vi bot KHONG DOI
   * (link TikTok van nhan RetiredMerchantLinkError nhu truoc).
   * `enabled` la co THO; viec tu tat khi thieu key nam o providers/index.ts.
   */
  tiktok: {
    enabled: optionalBool("TIKTOK_ENABLED", false),
    apiKey: optional("RIOHUB_API_KEY", ""),
    creatorUsername: optional("RIOHUB_CREATOR_USERNAME", ""),
    /** Ngan cach dau phay, dung thu tu thu. Rong -> RIOHUB_DEFAULT_BASE_URLS. */
    baseUrls: optional("RIOHUB_BASE_URLS", "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== ""),
    timeoutMs: optionalInt("RIOHUB_TIMEOUT_MS", 10_000),
    /** Nhan `channel` de tach link bot tao khoi link chu bot tu tao tren app RioHub. */
    linkChannel: optional("RIOHUB_LINK_CHANNEL", "bot"),
  },

  /**
   * Anh bao "don ve" (2026-10-05). Mac dinh BAT. Render loi thi da tu dong lui ve gui text roi,
   * co nay danh cho truong hop muon tat han ma khong phai rollback (vi du anh hien sai sau khi
   * doi template nen). Xem src/core/orderImage/.
   */
  orderImage: {
    enabled: optionalBool("ORDER_IMAGE_ENABLED", true),
  },

  /**
   * Giam co dieu kien tien cua don TO truoc khi cho rut (2026-10-08, xem src/core/payoutHold.ts).
   * Chi la gia tri khoi tao/fallback - admin doi duoc ngay tai /admin/settings khong can restart.
   */
  payoutHold: {
    /** user_share_amount tu muc nay tro len thi bi giam. Dat 0 de TAT han tinh nang. */
    thresholdVnd: optionalInt("PAYOUT_HOLD_THRESHOLD_VND", 100_000),
    /**
     * So ngay giam, dem tu ngay Shopee ghi don "Hoan thanh" (= ngay giao hang). Mac dinh 7 - Shopee
     * cho tra hang 15 ngay ke tu giao hang thanh cong (dieu 3.2), 7 ngay phu khoang mot nua cua so
     * do ma van nghe duoc voi user.
     */
    holdDays: optionalInt("PAYOUT_HOLD_DAYS", 7),
    /**
     * So ngay don NHO (duoi nguong) nam lai o "Cho xac nhan" truoc khi vao Kha dung (2026-10-11).
     * Mac dinh 1: du de bat don bi huy ngay hom sau ma user chi thay "san chua cap nhat kip" chu
     * khong thay tien cua minh bi giam - xem payoutHold.ts. Dat 0 de khong cho.
     */
    smallHoldDays: optionalInt("PAYOUT_HOLD_SMALL_DAYS", 1),
  },

  withdrawal: {
    /** So du kha dung toi thieu (VND) de duoc gui yeu cau rut tien. */
    // Mac dinh 20.000d - ha tu 50.000d ngay 2026-08-20 theo phan-hoi-cai-thien-trai-nghiem-nguoi-dung.md muc 2.
    thresholdVnd: optionalInt("WITHDRAWAL_THRESHOLD_VND", 20_000),
    /** Thu muc luu anh chup man hinh bang chung da chuyen khoan (bat buoc khi "Danh dau da tra"). */
    proofDir: optional("WITHDRAWAL_PROOF_DIR", "./data/withdrawal-proofs"),
  },

  dashboard: {
    /** Dung de dung link "/d/:token" tra ve khi user nhan "xemhh". */
    baseUrl: optional("DASHBOARD_BASE_URL", "http://localhost:3000"),
  },

  /** Chat ID Telegram cua chu bot, dung de bao khi co yeu cau rut tien moi. Rong = thu kenh Zalo ben duoi. */
  adminTelegramChatId: optional("ADMIN_TELEGRAM_CHAT_ID", ""),

  /**
   * User ID Zalo cua chu bot - kenh thong bao admin DU PHONG khi instance khong chay Telegram
   * (vi du deploy rieng chi co Zalo). Chi duoc dung khi ADMIN_TELEGRAM_CHAT_ID rong, xem
   * createAdminNotifier trong src/adapters/shared/adminNotifier.ts.
   * PHAI la tai khoan Zalo KHAC tai khoan dang chay bot (bot khong tu nhan tin cho chinh no).
   * Lay uid tai /admin/users sau khi tai khoan do nhan tin cho bot 1 lan.
   */
  adminZaloUserId: optional("ADMIN_ZALO_USER_ID", ""),

  admin: {
    /** Mat khau dang nhap trang /admin (1 tai khoan mac dinh). Rong = khong ai dang nhap duoc. */
    password: optional("ADMIN_PASSWORD", ""),
  },
};

export function assertAffiliateProviderConfigured(): void {
  if (env.affiliateProvider === "mock") return;

  // Tu 2026-09-29 khong con phu thuoc ACCESSTRADE_API_KEY - Shopee di thang qua an_redir,
  // chi can affiliate_id co dinh cua tai khoan.
  if (env.shopeeDirect.affiliateId === "") {
    throw new Error(
      "AFFILIATE_PROVIDER=shopee_direct nhung thieu SHOPEE_AFFILIATE_ID. " +
        "Lay affiliate_id tai affiliate.shopee.vn/account_setting roi dien vao .env."
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
