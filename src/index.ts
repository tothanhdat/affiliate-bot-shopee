import { env } from "./config/env.js";
import { createServer } from "./api/server.js";
import { createTelegramBot } from "./adapters/telegram/bot.js";
import { createZaloGroupBot, type ZaloGroupBot } from "./adapters/zalo/bot.js";
import { AdminSessionStore } from "./core/adminAuth.js";
import { LedgerStore } from "./core/ledgerStore.js";
import { LogStore } from "./core/logStore.js";
import { LinkResolverService } from "./core/linkResolverService.js";
import { RateLimiter } from "./core/rateLimiter.js";
import { createAffiliateProvider } from "./core/providers/index.js";
import type { Platform } from "./core/types.js";
import type { NotifyUser } from "./core/notification.js";
import { createAdminNotifier } from "./adapters/shared/adminNotifier.js";
import { FaqService } from "./core/faq/faqService.js";
import { createFaqClassifier } from "./core/faq/providers/index.js";

const logStore = new LogStore(env.databasePath);
const ledgerStore = new LedgerStore(env.ledgerDatabasePath);
const rateLimiter = new RateLimiter(env.rateLimit.maxRequests, env.rateLimit.windowMs);
const adminLoginRateLimiter = new RateLimiter(env.adminLoginRateLimit.maxRequests, env.adminLoginRateLimit.windowMs);
const affiliateProvider = createAffiliateProvider(logStore);
const resolver = new LinkResolverService(affiliateProvider, logStore, rateLimiter);

if (env.affiliateProvider === "mock") {
  console.warn(
    "[warn] AFFILIATE_PROVIDER=mock - dang chay voi affiliate link gia. " +
      "Dat SHOPEE_AFFILIATE_ID + AFFILIATE_PROVIDER=shopee_direct de dung that."
  );
}

// Dung truoc createServer (nhung .launch()/.start() sau khi server da listen, giu nguyen thu tu
// nhu cu) vi notifyAdmin/notifyUser can tham chieu telegramBot/zaloBot con song luc dang ky route
// trong createServer - closure chi doc gia tri luc GOI ham (sau khi ca 2 bot da khoi dong xong),
// khong phai luc dinh nghia, nen khai bao "let" truoc roi gan gia tri sau van an toan.
let telegramBot: ReturnType<typeof createTelegramBot> | null = null;
let zaloBot: ZaloGroupBot | null = null;
if (env.telegramBotToken === "") {
  console.warn(
    "[warn] Thieu TELEGRAM_BOT_TOKEN - bo qua khoi dong Telegram Adapter. " +
      "Hoan tat T0.2 va dien TELEGRAM_BOT_TOKEN vao .env de bat bot."
  );
} else {
  telegramBot = createTelegramBot(resolver, {
    commissionUserSharePercent: env.commission.userSharePercent,
    commissionTaxPercent: env.commission.taxPercent,
    commissionPlatformFeePercent: env.commission.platformFeePercent,
    token: env.telegramBotToken,
    maxLinksPerMessage: env.maxLinksPerMessage,
    promotionsLimit: env.promotionsDisplayLimit,
    ledgerStore,
    dashboardBaseUrl: env.dashboard.baseUrl,
  });
}

// Thong bao cho chu bot: uu tien Telegram, khong co thi rot xuong Zalo DM (instance Zalo-only
// truoc day mat sach thong bao "co yeu cau rut tien moi"), khong co nua thi chi log.
// Thu tu fallback + ly do xem createAdminNotifier.
if (env.adminTelegramChatId === "" && env.adminZaloUserId === "") {
  console.warn(
    "[warn] Thieu CA ADMIN_TELEGRAM_CHAT_ID va ADMIN_ZALO_USER_ID - yeu cau rut tien se KHONG duoc " +
      'bao o dau ca. Dung "npx tsx src/scripts/ledgerAdmin.ts list-pending-withdrawals" de xem thu cong.'
  );
} else if (env.adminTelegramChatId === "") {
  console.log("[admin-notify] Se bao cho chu bot qua Zalo DM (ADMIN_ZALO_USER_ID).");
}

const notifyAdmin = createAdminNotifier({
  resolveTelegramSender: () =>
    telegramBot && env.adminTelegramChatId !== ""
      ? async (message: string) => {
          await telegramBot!.telegram.sendMessage(env.adminTelegramChatId, message);
        }
      : null,
  resolveZaloSender: () =>
    zaloBot && env.adminZaloUserId !== ""
      ? async (message: string) => {
          await zaloBot!.sendDirectMessage(env.adminZaloUserId, { text: message });
        }
      : null,
});

// FAQ tu dong tra loi trong Zalo DM (2026-09-13). Dat SAU notifyAdmin vi FaqService can no de bao
// chu bot khi gap cau hoi khong nhan ra. Rate limiter RIENG cho FAQ - khong dung chung voi rate
// limit tao link, de 1 user hoi nhieu khong bi chan mat quyen tao link (va nguoc lai).
const faqRateLimiter = new RateLimiter(env.faq.rateLimit.maxRequests, env.faq.rateLimit.windowMs);
// createFaqClassifier tra `null` khi FAQ khong chay duoc (provider=off, mac dinh; hoac thieu
// ANTHROPIC_API_KEY) - luc do KHONG tao FaqService, va `faqService: undefined` lam adapter im lang
// tuyet doi y het hanh vi truoc khi co tinh nang FAQ (2026-10-01). Truoc day factory tra ve mot
// classifier "rong" luon tra mang rong, ma mang rong lai roi vao nhanh "khong nhan ra chu de" nen
// bot tra "Cau hoi nay ngoai pham vi..." cho MOI tin DM du FAQ dang tat - xem providers/index.ts.
const faqClassifier = createFaqClassifier({
  provider: env.faq.provider,
  apiKey: env.faq.apiKey,
  model: env.faq.model,
});
const faqService =
  faqClassifier === null
    ? undefined
    : new FaqService({
        classifier: faqClassifier,
        store: ledgerStore,
        rateLimiter: faqRateLimiter,
        notifyAdmin,
        defaultUserSharePercent: env.commission.userSharePercent,
        defaultWithdrawalThresholdVnd: env.withdrawal.thresholdVnd,
      });

// phan-hoi-cai-thien-trai-nghiem-nguoi-dung.md muc 1: bao user khi don duoc admin ghi nhan (qua
// /admin/record-orders hoac ledgerAdmin.ts). Chi dinh tuyen Telegram/Zalo - "http" khong co noi
// nhan (khong phai chat platform), rot xuong nhanh else cuoi (chi log).
const notifyUser: NotifyUser = async (platform, userId, notification) => {
  if (platform === "telegram" && telegramBot) {
    if (notification.image) {
      await telegramBot.telegram.sendPhoto(
        userId,
        { source: notification.image.data },
        { caption: notification.text }
      );
    } else {
      await telegramBot.telegram.sendMessage(userId, notification.text);
    }
  } else if (platform === "zalo" && zaloBot) {
    await zaloBot.sendDirectMessage(userId, notification);
  } else {
    console.warn(
      `[user-notify] khong the gui thong bao (${platform}/${userId} chua co bot tuong ung):`,
      notification.text
    );
  }
};

if (env.admin.password === "") {
  console.warn(
    "[warn] Thieu ADMIN_PASSWORD - khong ai dang nhap duoc trang /admin. " +
      "Dat ADMIN_PASSWORD trong .env de bat."
  );
}
const adminSessionStore = new AdminSessionStore(env.admin.password);

// 2026-09-11: thong bao vao GROUP Zalo (khac notifyUser la DM cho 1 user) sau moi lan admin import
// bao cao Shopee tren web. Doc `zaloBot` LUC GOI, khong phai luc tao closure - giong notifyUser o
// tren, vi zaloBot chi duoc gan SAU loi goi createServer() ben duoi.
const notifyZaloGroup = async (groupId: string, message: string): Promise<void> => {
  if (!zaloBot) {
    console.warn(`[group-notify] Zalo adapter chua chay - bo qua thong bao vao group ${groupId}:`, message);
    return;
  }
  await zaloBot.sendGroupMessage(groupId, message);
};

const app = createServer(
  resolver,
  logStore,
  ledgerStore,
  notifyAdmin,
  env.withdrawal.thresholdVnd,
  adminSessionStore,
  {
    taxPercent: env.commission.taxPercent,
    platformFeePercent: env.commission.platformFeePercent,
    userSharePercent: env.commission.userSharePercent,
    maxCommissionRatioPercent: env.commission.maxRatioPercent,
  },
  env.withdrawal.proofDir,
  adminLoginRateLimiter,
  env.dashboard.baseUrl,
  notifyUser,
  notifyZaloGroup,
  env.orderImage.enabled
);
const httpServer = app.listen(env.port, () => {
  console.log(`[http] Core Service dang chay tai http://localhost:${env.port}`);
});

if (telegramBot) {
  telegramBot.launch();
  console.log("[telegram] Bot dang chay (long polling)");
}

if (!env.zaloGroup.enabled) {
  console.warn(
    "[warn] ZALO_GROUP_ENABLED khac true - bo qua khoi dong Zalo Adapter. " +
      "Day la tinh nang tu dong hoa tai khoan Zalo ca nhan (khong chinh thuc), dat true trong .env neu muon bat."
  );
} else {
  zaloBot = createZaloGroupBot(resolver, {
    sessionPath: env.zaloGroup.sessionPath,
    qrPath: env.zaloGroup.qrPath,
    maxLinksPerMessage: env.maxLinksPerMessage,
    promotionsLimit: env.promotionsDisplayLimit,
    ledgerStore,
    dashboardBaseUrl: env.dashboard.baseUrl,
    commissionUserSharePercent: env.commission.userSharePercent,
    commissionTaxPercent: env.commission.taxPercent,
    commissionPlatformFeePercent: env.commission.platformFeePercent,
    withdrawalThresholdVnd: env.withdrawal.thresholdVnd,
    faqService,
  });
  zaloBot.start().then(
    () => console.log("[zalo] Bot dang chay"),
    (err: unknown) => console.error("[zalo] Khong the khoi dong Zalo Adapter:", err)
  );
}

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[shutdown] Nhan ${signal}, dang dong service...`);
  telegramBot?.stop(signal);
  zaloBot?.stop();
  rateLimiter.stop();
  adminLoginRateLimiter.stop();
  faqRateLimiter.stop();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  logStore.close();
  ledgerStore.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
