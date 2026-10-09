import { AppError, ProductNotAffiliateEligibleError, ProviderUnavailableError } from "../../core/errors.js";
import type { AlertThrottle } from "../../core/alertThrottle.js";
import { TIKTOK_NO_COMMISSION_TEMPLATE_DEFAULT, TIKTOK_PROVIDER_DOWN_TEMPLATE_DEFAULT } from "./replyText.js";

export interface ProviderErrorContext {
  /** Chi can getter template - de test khong phai dung ca LedgerStore. */
  ledgerStore: {
    getTiktokProviderDownTemplate(defaultValue: string): string;
    getTiktokNoCommissionTemplate(defaultValue: string): string;
  };
  /** Khong truyen -> khong bao admin (vd test, hoac instance chua noi). */
  alertThrottle?: AlertThrottle;
  notifyAdmin?: (text: string) => Promise<void>;
}

/**
 * Chon cau tra loi user cho mot loi tao link - DUNG CHUNG cho Telegram va Zalo.
 *
 * `ProviderUnavailableError` = phia nguon affiliate hong -> dung template admin sua duoc, va BAO
 * ADMIN (gop theo ma loi de khong spam). Cac loi khac (san pham chua bat hoa hong, link khong phai
 * trang san pham) la cau tra loi THAT ve san pham - khong bao admin.
 */
export function resolveErrorUserMessage(err: unknown, ctx: ProviderErrorContext): string {
  if (err instanceof ProviderUnavailableError) {
    if (ctx.alertThrottle?.shouldSend(err.providerErrorCode)) {
      ctx
        .notifyAdmin?.(`⚠️ Nguồn affiliate TikTok lỗi (${err.providerErrorCode}): ${err.message}`)
        .catch(() => {});
    }
    return ctx.ledgerStore.getTiktokProviderDownTemplate(TIKTOK_PROVIDER_DOWN_TEMPLATE_DEFAULT);
  }
  // Chi TikTok nem loi nay (422 product_not_promotable). Khong bao admin: day la su that ve san pham.
  if (err instanceof ProductNotAffiliateEligibleError) {
    return ctx.ledgerStore.getTiktokNoCommissionTemplate(TIKTOK_NO_COMMISSION_TEMPLATE_DEFAULT);
  }
  return err instanceof AppError ? err.userMessage : "Đã có lỗi không xác định, vui lòng thử lại sau.";
}
