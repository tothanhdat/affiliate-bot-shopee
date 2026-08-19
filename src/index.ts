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

const logStore = new LogStore(env.databasePath);
const ledgerStore = new LedgerStore(env.ledgerDatabasePath);
const rateLimiter = new RateLimiter(env.rateLimit.maxRequests, env.rateLimit.windowMs);
const affiliateProvider = createAffiliateProvider(logStore);
const resolver = new LinkResolverService(affiliateProvider, logStore, rateLimiter);

if (env.affiliateProvider === "mock") {
  console.warn(
    "[warn] AFFILIATE_PROVIDER=mock - dang chay voi affiliate link gia. " +
      "Hoan tat T0.1 va dat ACCESSTRADE_API_KEY + AFFILIATE_PROVIDER=accesstrade de dung that."
  );
}

// Dung truoc createServer (nhung .launch() sau khi server da listen, giu nguyen thu tu nhu cu) vi
// notifyAdmin can tham chieu telegramBot.telegram con song luc dang ky route trong createServer.
let telegramBot: ReturnType<typeof createTelegramBot> | null = null;
if (env.telegramBotToken === "") {
  console.warn(
    "[warn] Thieu TELEGRAM_BOT_TOKEN - bo qua khoi dong Telegram Adapter. " +
      "Hoan tat T0.2 va dien TELEGRAM_BOT_TOKEN vao .env de bat bot."
  );
} else {
  telegramBot = createTelegramBot(resolver, {
    token: env.telegramBotToken,
    maxLinksPerMessage: env.maxLinksPerMessage,
    promotionsLimit: env.promotionsDisplayLimit,
    ledgerStore,
    dashboardBaseUrl: env.dashboard.baseUrl,
  });
}

if (env.adminTelegramChatId === "") {
  console.warn(
    "[warn] Thieu ADMIN_TELEGRAM_CHAT_ID - yeu cau rut tien se KHONG duoc bao qua Telegram. " +
      'Dung "npx tsx src/scripts/ledgerAdmin.ts list-pending-withdrawals" de xem thu cong.'
  );
}

const notifyAdmin =
  telegramBot && env.adminTelegramChatId !== ""
    ? async (message: string): Promise<void> => {
        await telegramBot!.telegram.sendMessage(env.adminTelegramChatId, message);
      }
    : async (message: string): Promise<void> => {
        console.warn("[admin-notify] khong the gui thong bao (chua co telegramBot/ADMIN_TELEGRAM_CHAT_ID):", message);
      };

if (env.admin.password === "") {
  console.warn(
    "[warn] Thieu ADMIN_PASSWORD - khong ai dang nhap duoc trang /admin. " +
      "Dat ADMIN_PASSWORD trong .env de bat."
  );
}
const adminSessionStore = new AdminSessionStore(env.admin.password);

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
  env.withdrawal.proofDir
);
const httpServer = app.listen(env.port, () => {
  console.log(`[http] Core Service dang chay tai http://localhost:${env.port}`);
});

if (telegramBot) {
  telegramBot.launch();
  console.log("[telegram] Bot dang chay (long polling)");
}

let zaloBot: ZaloGroupBot | null = null;
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
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  logStore.close();
  ledgerStore.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
