import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { AppError } from "../../core/errors.js";
import type { LedgerStore } from "../../core/ledgerStore.js";
import { extractProductUrls } from "../../core/linkValidator.js";
import type { LinkResolverService } from "../../core/linkResolverService.js";
import type { MerchantId } from "../../core/merchants.js";
import {
  USAGE_TEXT,
  SUCCESS_REPLY_TEMPLATE_DEFAULT,
  formatSuccessReply,
  formatErrorReply,
  formatSkippedReply,
  formatPromotionsReply,
  formatDashboardLinkReply,
} from "../shared/replyText.js";

export interface TelegramBotOptions {
  token: string;
  maxLinksPerMessage: number;
  promotionsLimit: number;
  ledgerStore: LedgerStore;
  dashboardBaseUrl: string;
}

export function createTelegramBot(resolver: LinkResolverService, options: TelegramBotOptions) {
  const { token, maxLinksPerMessage, promotionsLimit, ledgerStore, dashboardBaseUrl } = options;
  const bot = new Telegraf(token);

  bot.start((ctx) => ctx.reply(ledgerStore.getUsageText(USAGE_TEXT)));
  bot.help((ctx) => ctx.reply(ledgerStore.getUsageText(USAGE_TEXT)));

  bot.on(message("text"), async (ctx) => {
    const text = ctx.message.text;
    const userId = String(ctx.from.id);
    const displayName =
      [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ").trim() ||
      (ctx.from.username ? `@${ctx.from.username}` : "");
    ledgerStore.upsertUserProfile("telegram", userId, displayName);

    // T2.3: lenh "xemhh" chi hoat dong trong tin nhan rieng (DM), khong phai group - tranh
    // thanh vien khac trong group vo tinh kich hoat link ca nhan cua nguoi khac.
    if (ctx.chat.type === "private" && text.trim().toLowerCase() === "xemhh") {
      const { token: dashboardToken } = ledgerStore.findOrCreateDashboardToken("telegram", userId);
      await ctx.reply(formatDashboardLinkReply(`${dashboardBaseUrl}/d/${dashboardToken}`, userId));
      return;
    }

    const links = extractProductUrls(text);

    if (links.length === 0) {
      await ctx.reply(ledgerStore.getUsageText(USAGE_TEXT));
      return;
    }

    const linksToProcess = links.slice(0, maxLinksPerMessage);
    const skippedCount = links.length - linksToProcess.length;
    const successMerchants = new Set<MerchantId>();

    for (const rawUrl of linksToProcess) {
      try {
        const result = await resolver.resolve({ url: rawUrl, platform: "telegram", userId });
        successMerchants.add(result.merchant);
        const successTemplate = ledgerStore.getSuccessReplyTemplate(SUCCESS_REPLY_TEMPLATE_DEFAULT);
        await ctx.reply(
          formatSuccessReply(successTemplate, result.merchant, result.affiliateUrl, result.commissionEstimate),
          { reply_parameters: { message_id: ctx.message.message_id } }
        );
      } catch (err) {
        const userMessage =
          err instanceof AppError ? err.userMessage : "Đã có lỗi không xác định, vui lòng thử lại sau.";
        await ctx.reply(formatErrorReply(userMessage), {
          reply_parameters: { message_id: ctx.message.message_id },
        });
      }
    }

    if (skippedCount > 0) {
      await ctx.reply(formatSkippedReply(linksToProcess.length, skippedCount));
    }

    if (promotionsLimit > 0) {
      for (const merchant of successMerchants) {
        try {
          const promotions = await resolver.getPromotions(merchant, promotionsLimit);
          if (promotions.length > 0) {
            await ctx.reply(formatPromotionsReply(merchant, promotions));
          }
        } catch (err) {
          console.warn(
            `[telegram] khong lay duoc danh sach khuyen mai (${merchant}):`,
            (err as Error).message
          );
        }
      }
    }
  });

  return bot;
}
