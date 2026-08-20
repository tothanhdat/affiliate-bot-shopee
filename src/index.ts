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
import { syncAccesstradeTransactions } from "./core/accesstradeSync.js";
import { formatOrdersConfirmedReply } from "./adapters/shared/replyText.js";

const logStore = new LogStore(env.databasePath);
const ledgerStore = new LedgerStore(env.ledgerDatabasePath);
const rateLimiter = new RateLimiter(env.rateLimit.maxRequests, env.rateLimit.windowMs);
const adminLoginRateLimiter = new RateLimiter(env.adminLoginRateLimit.maxRequests, env.adminLoginRateLimit.windowMs);
const affiliateProvider = createAffiliateProvider(logStore);
const resolver = new LinkResolverService(affiliateProvider, logStore, rateLimiter);

if (env.affiliateProvider === "mock") {
  console.warn(
    "[warn] AFFILIATE_PROVIDER=mock - dang chay voi affiliate link gia. " +
      "Hoan tat T0.1 va dat ACCESSTRADE_API_KEY + AFFILIATE_PROVIDER=accesstrade de dung that."
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

// phan-hoi-cai-thien-trai-nghiem-nguoi-dung.md muc 1: bao user khi don duoc admin ghi nhan (qua
// /admin/record-orders hoac ledgerAdmin.ts). Chi dinh tuyen Telegram/Zalo - "http" khong co noi
// nhan (khong phai chat platform), rot xuong nhanh else cuoi (chi log).
const notifyUser = async (platform: Platform, userId: string, message: string): Promise<void> => {
  if (platform === "telegram" && telegramBot) {
    await telegramBot.telegram.sendMessage(userId, message);
  } else if (platform === "zalo" && zaloBot) {
    await zaloBot.sendDirectMessage(userId, message);
  } else {
    console.warn(`[user-notify] khong the gui thong bao (${platform}/${userId} chua co bot tuong ung):`, message);
  }
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
  env.withdrawal.proofDir,
  adminLoginRateLimiter,
  env.dashboard.baseUrl,
  notifyUser
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
    withdrawalThresholdVnd: env.withdrawal.thresholdVnd,
  });
  zaloBot.start().then(
    () => console.log("[zalo] Bot dang chay"),
    (err: unknown) => console.error("[zalo] Khong the khoi dong Zalo Adapter:", err)
  );
}

// T2.1 tu dong hoa (2026-08-20, rui-ro-can-giai-quyet.md muc 8): dinh ky goi Accesstrade
// /v1/transactions thay cho ledgerAdmin.ts record-conversions-csv thu cong hang tuan. CHI ap dung
// cho merchant di qua Accesstrade (TikTok Shop/Lazada) - Shopee KHONG BAO GIO xuat hien o day (di
// thang qua an_redir, khong qua Accesstrade), van can doi soat thu cong rieng nhu cu.
let accesstradeSyncTimer: NodeJS.Timeout | null = null;

async function runAccesstradeSync(): Promise<void> {
  console.log("[accesstrade-sync] Bat dau dong bo dinh ky...");
  try {
    const result = await syncAccesstradeTransactions(logStore, ledgerStore, {
      apiKey: env.accesstrade.apiKey,
      apiBase: env.accesstrade.apiBase,
      timeoutMs: env.accesstrade.timeoutMs,
      lookbackDays: env.accesstradeSync.lookbackDays,
      recordOrderConfig: {
        taxPercent: env.commission.taxPercent,
        platformFeePercent: env.commission.platformFeePercent,
        userSharePercent: env.commission.userSharePercent,
        maxCommissionRatioPercent: env.commission.maxRatioPercent,
      },
    });
    console.log(
      `[accesstrade-sync] Xong: quet ${result.transactionsScanned} giao dich, ${result.confirmedNew} don moi, ` +
        `${result.confirmedDuplicate} da co san, ${result.pendingNew} dang cho duyet, ${result.reversedCount} bi huy, ` +
        `${result.skippedNoSubId + result.skippedSubIdNotFound} bo qua, ${result.errors.length} loi.`
    );
    if (result.errors.length > 0) {
      console.warn("[accesstrade-sync] Chi tiet loi:", result.errors);
    }

    for (const summary of result.confirmedByUser) {
      const { token } = ledgerStore.findOrCreateDashboardToken(summary.platform, summary.userId);
      notifyUser(summary.platform, summary.userId, formatOrdersConfirmedReply(summary.items, `${env.dashboard.baseUrl}/d/${token}`)).catch(
        (err) => console.warn("[accesstrade-sync] gui thong bao user that bai:", err)
      );
    }

    if (result.confirmedNew > 0 || result.pendingNew > 0 || result.reversedCount > 0 || result.errors.length > 0) {
      notifyAdmin(
        `🔄 Đối soát Accesstrade tự động: ${result.confirmedNew} đơn mới, ${result.pendingNew} đơn chờ duyệt, ${result.reversedCount} đơn bị huỷ` +
          (result.errors.length > 0 ? `, ${result.errors.length} lỗi (xem log server)` : "")
      ).catch((err) => console.warn("[accesstrade-sync] gui thong bao admin that bai:", err));
    }
  } catch (err) {
    console.error("[accesstrade-sync] Loi khi dong bo:", err);
  }
}

function msUntilNextHour(hour: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

if (env.accesstradeSync.enabled) {
  if (env.accesstrade.apiKey === "") {
    console.warn("[warn] ACCESSTRADE_SYNC_ENABLED=true nhung thieu ACCESSTRADE_API_KEY - bo qua dong bo tu dong.");
  } else {
    const delayMs = msUntilNextHour(env.accesstradeSync.hour);
    console.log(
      `[accesstrade-sync] Da bat - lan chay dau tien sau ${Math.round(delayMs / 60000)} phut (${env.accesstradeSync.hour}h moi ngay).`
    );
    accesstradeSyncTimer = setTimeout(() => {
      void runAccesstradeSync();
      accesstradeSyncTimer = setInterval(() => void runAccesstradeSync(), 24 * 60 * 60 * 1000);
    }, delayMs);
  }
}

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[shutdown] Nhan ${signal}, dang dong service...`);
  telegramBot?.stop(signal);
  zaloBot?.stop();
  rateLimiter.stop();
  adminLoginRateLimiter.stop();
  if (accesstradeSyncTimer) clearTimeout(accesstradeSyncTimer);
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  logStore.close();
  ledgerStore.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
