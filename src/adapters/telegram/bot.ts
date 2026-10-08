import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { AppError } from "../../core/errors.js";
import type { LedgerStore } from "../../core/ledgerStore.js";
import { extractProductUrls } from "../../core/linkValidator.js";
import type { LinkResolverService } from "../../core/linkResolverService.js";
import type { MerchantId } from "../../core/merchants.js";
import type { LinkSourceContext } from "../../core/types.js";
import {
  USAGE_TEXT,
  SUCCESS_REPLY_TEMPLATE_DEFAULT,
  DASHBOARD_LINK_REPLY_TEMPLATE_DEFAULT,
  formatSuccessReply,
  formatErrorReply,
  formatSkippedReply,
  formatPromotionsReply,
  formatDashboardLinkReply,
  toCommissionReplyEstimate,
} from "../shared/replyText.js";

export interface TelegramBotOptions {
  token: string;
  maxLinksPerMessage: number;
  promotionsLimit: number;
  ledgerStore: LedgerStore;
  dashboardBaseUrl: string;
  /** Dong bo voi COMMISSION_USER_SHARE_PERCENT - gia tri khoi tao, admin doi duoc qua /admin/settings. */
  commissionUserSharePercent: number;
  /**
   * Thue + phi san, dung de doi hoa hong GOC thanh so tien user THUC NHAN trong tin nhan tra link
   * (2026-10-01). Dong bo voi COMMISSION_TAX_PERCENT / COMMISSION_PLATFORM_FEE_PERCENT - phai
   * giong het gia tri ledgerStore dung luc ghi don that, neu khong bot hua mot dang ma dashboard
   * tra mot dang.
   */
  commissionTaxPercent: number;
  commissionPlatformFeePercent: number;
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
      const dashboardLinkTemplate = ledgerStore.getDashboardLinkReplyTemplate(DASHBOARD_LINK_REPLY_TEMPLATE_DEFAULT);
      await ctx.reply(
        formatDashboardLinkReply(dashboardLinkTemplate, `${dashboardBaseUrl}/d/${dashboardToken}`, userId)
      );
      return;
    }

    // Noi gui, chi de ghi log cho /admin/links. Telegram goi DM la chat "private".
    const sourceContext: LinkSourceContext = ctx.chat.type === "private" ? "dm" : "group";

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
        const result = await resolver.resolve({ url: rawUrl, platform: "telegram", userId, sourceContext });
        successMerchants.add(result.merchant);
        const successTemplate = ledgerStore.getSuccessReplyTemplate(SUCCESS_REPLY_TEMPLATE_DEFAULT);
        const replyEstimate = toCommissionReplyEstimate(result.commissionEstimate, {
          taxPercent: options.commissionTaxPercent,
          platformFeePercent: options.commissionPlatformFeePercent,
          // Doc tu ledgerStore: admin doi % ngay tren /admin/settings khong can restart.
          userSharePercent: ledgerStore.getUserSharePercent(options.commissionUserSharePercent),
        });
        await ctx.reply(
          formatSuccessReply(successTemplate, result.affiliateUrl, replyEstimate, result.noCommission),
          { reply_parameters: { message_id: ctx.message.message_id } }
        );
      } catch (err) {
        // Giong zalo/bot.ts: log chi tiet chan doan truoc khi tra ve cau chung chung cho user.
        const detail = err instanceof Error ? err.message : String(err);
        const code = err instanceof AppError ? err.code : "UNKNOWN";
        console.warn(`[telegram] tao link that bai (${code}) cho ${rawUrl}: ${detail}`);
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
