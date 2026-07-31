import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { AppError } from "../../core/errors.js";
import { extractShopeeUrls } from "../../core/linkValidator.js";
import type { LinkResolverService } from "../../core/linkResolverService.js";

const USAGE_TEXT =
  "Gui cho minh 1 link san pham Shopee (vi du: https://shopee.vn/...-i.123.456), " +
  "minh se tra ve link rut gon cho ban.";

export function createTelegramBot(resolver: LinkResolverService, token: string, maxLinksPerMessage: number) {
  const bot = new Telegraf(token);

  bot.start((ctx) => ctx.reply(USAGE_TEXT));
  bot.help((ctx) => ctx.reply(USAGE_TEXT));

  bot.on(message("text"), async (ctx) => {
    const text = ctx.message.text;
    const isPrivateChat = ctx.chat.type === "private";
    const links = extractShopeeUrls(text);

    if (links.length === 0) {
      // Nhom: im lang de tranh spam. Chat rieng: goi y cach dung.
      if (isPrivateChat) await ctx.reply(USAGE_TEXT);
      return;
    }

    const userId = String(ctx.from.id);
    const linksToProcess = links.slice(0, maxLinksPerMessage);
    const skippedCount = links.length - linksToProcess.length;

    for (const rawUrl of linksToProcess) {
      try {
        const result = await resolver.resolve({ url: rawUrl, platform: "telegram", userId });
        await ctx.reply(`Link affiliate: ${result.affiliateUrl}`, { reply_parameters: { message_id: ctx.message.message_id } });
      } catch (err) {
        const message = err instanceof AppError ? err.userMessage : "Da co loi khong xac dinh, vui long thu lai sau.";
        await ctx.reply(message, { reply_parameters: { message_id: ctx.message.message_id } });
      }
    }

    if (skippedCount > 0) {
      await ctx.reply(`Chi xu ly ${maxLinksPerMessage} link dau tien, bo qua ${skippedCount} link con lai.`);
    }
  });

  return bot;
}
