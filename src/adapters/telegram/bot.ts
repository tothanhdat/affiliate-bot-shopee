import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { AppError } from "../../core/errors.js";
import { extractProductUrls } from "../../core/linkValidator.js";
import type { LinkResolverService } from "../../core/linkResolverService.js";
import type { MerchantId } from "../../core/merchants.js";
import {
  USAGE_TEXT,
  formatSuccessReply,
  formatErrorReply,
  formatSkippedReply,
  formatPromotionsReply,
} from "../shared/replyText.js";

export function createTelegramBot(
  resolver: LinkResolverService,
  token: string,
  maxLinksPerMessage: number,
  promotionsLimit: number
) {
  const bot = new Telegraf(token);

  bot.start((ctx) => ctx.reply(USAGE_TEXT));
  bot.help((ctx) => ctx.reply(USAGE_TEXT));

  bot.on(message("text"), async (ctx) => {
    const text = ctx.message.text;
    const links = extractProductUrls(text);

    if (links.length === 0) {
      await ctx.reply(USAGE_TEXT);
      return;
    }

    const userId = String(ctx.from.id);
    const linksToProcess = links.slice(0, maxLinksPerMessage);
    const skippedCount = links.length - linksToProcess.length;
    const successMerchants = new Set<MerchantId>();

    for (const rawUrl of linksToProcess) {
      try {
        const result = await resolver.resolve({ url: rawUrl, platform: "telegram", userId });
        successMerchants.add(result.merchant);
        await ctx.reply(formatSuccessReply(result.merchant, result.affiliateUrl), {
          reply_parameters: { message_id: ctx.message.message_id },
        });
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
