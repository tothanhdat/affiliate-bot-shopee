import { env } from "./config/env.js";
import { createServer } from "./api/server.js";
import { createTelegramBot } from "./adapters/telegram/bot.js";
import { createZaloGroupBot, type ZaloGroupBot } from "./adapters/zalo/bot.js";
import { LogStore } from "./core/logStore.js";
import { LinkResolverService } from "./core/linkResolverService.js";
import { RateLimiter } from "./core/rateLimiter.js";
import { createAffiliateProvider } from "./core/providers/index.js";

const logStore = new LogStore(env.databasePath);
const rateLimiter = new RateLimiter(env.rateLimit.maxRequests, env.rateLimit.windowMs);
const affiliateProvider = createAffiliateProvider();
const resolver = new LinkResolverService(affiliateProvider, logStore, rateLimiter);

if (env.affiliateProvider === "mock") {
  console.warn(
    "[warn] AFFILIATE_PROVIDER=mock - dang chay voi affiliate link gia. " +
      "Hoan tat T0.1 va dat ACCESSTRADE_API_KEY + AFFILIATE_PROVIDER=accesstrade de dung that."
  );
}

const app = createServer(resolver, logStore);
const httpServer = app.listen(env.port, () => {
  console.log(`[http] Core Service dang chay tai http://localhost:${env.port}`);
});

let telegramBot: ReturnType<typeof createTelegramBot> | null = null;
if (env.telegramBotToken === "") {
  console.warn(
    "[warn] Thieu TELEGRAM_BOT_TOKEN - bo qua khoi dong Telegram Adapter. " +
      "Hoan tat T0.2 va dien TELEGRAM_BOT_TOKEN vao .env de bat bot."
  );
} else {
  telegramBot = createTelegramBot(
    resolver,
    env.telegramBotToken,
    env.maxLinksPerMessage,
    env.promotionsDisplayLimit
  );
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
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
