import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { AppError } from "../../core/errors.js";
import { extractShopeeUrls } from "../../core/linkValidator.js";
import type { LinkResolverService } from "../../core/linkResolverService.js";
import type { PromotionItem } from "../../core/affiliateProvider.js";

const USAGE_TEXT =
  "👋 Gửi cho mình link sản phẩm Shopee (ví dụ: https://shopee.vn/...-i.123.456), " +
  "mình sẽ trả về link áp mã cho bạn.";

function formatSuccessReply(affiliateUrl: string): string {
  return `👉 Link áp mã Shopee 22%: ${affiliateUrl}\n✅ Bấm vào link để nhận mã ưu đãi giảm sâu nhất`;
}

function formatErrorReply(userMessage: string): string {
  return `❌ ${userMessage}`;
}

function formatSkippedReply(processedCount: number, skippedCount: number): string {
  return `⚠️ Chỉ xử lý ${processedCount} link đầu tiên, bỏ qua ${skippedCount} link còn lại.`;
}

function formatPromotionsReply(items: PromotionItem[]): string {
  const lines = items.map((item) => `- [${item.couponCode}] ${item.description}`);
  return (
    `🎟️ Mã giảm giá Shopee đang chạy (chung, không đảm bảo áp dụng cho sản phẩm này):\n` +
    lines.join("\n")
  );
}

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
    let successCount = 0;

    for (const rawUrl of linksToProcess) {
      try {
        const result = await resolver.resolve({ url: rawUrl, platform: "telegram", userId });
        successCount++;
        await ctx.reply(formatSuccessReply(result.affiliateUrl), {
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

    if (successCount > 0 && promotionsLimit > 0) {
      try {
        const promotions = await resolver.getPromotions(promotionsLimit);
        if (promotions.length > 0) {
          await ctx.reply(formatPromotionsReply(promotions));
        }
      } catch (err) {
        console.warn("[telegram] khong lay duoc danh sach khuyen mai:", (err as Error).message);
      }
    }
  });

  return bot;
}
