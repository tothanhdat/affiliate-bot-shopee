import type { PromotionItem } from "../../core/affiliateProvider.js";
import { getMerchantConfig, type MerchantId } from "../../core/merchants.js";

export const USAGE_TEXT =
  "👋 Gửi cho mình link sản phẩm Shopee hoặc Lazada (ví dụ: https://shopee.vn/...-i.123.456), " +
  "mình sẽ trả về link áp mã cho bạn.";

/**
 * Nhan hien thi rieng tung merchant. "22%" la con so marketing co dinh cho Shopee
 * theo yeu cau cua chu bot - KHONG phai % thuc te tinh tu API (Accesstrade khong
 * cung cap % giam theo tung san pham). Merchant moi mac dinh dung ten thuong hieu
 * thuan, khong bia them con so khi chua co du lieu/xac nhan.
 */
const MERCHANT_LABELS: Record<MerchantId, string> = {
  shopee: "Shopee 22%",
  lazada: "Lazada",
};

export function formatSuccessReply(merchant: MerchantId, affiliateUrl: string): string {
  const label = MERCHANT_LABELS[merchant];
  return `👉 Link áp mã ${label}: ${affiliateUrl}\n✅ Bấm vào link để nhận mã ưu đãi giảm sâu nhất`;
}

export function formatErrorReply(userMessage: string): string {
  return `❌ ${userMessage}`;
}

export function formatSkippedReply(processedCount: number, skippedCount: number): string {
  return `⚠️ Chỉ xử lý ${processedCount} link đầu tiên, bỏ qua ${skippedCount} link còn lại.`;
}

export function formatPromotionsReply(merchant: MerchantId, items: PromotionItem[]): string {
  const displayName = getMerchantConfig(merchant).displayName;
  const lines = items.map((item) => `- [${item.couponCode}] ${item.description}`);
  return (
    `🎟️ Mã giảm giá ${displayName} đang chạy (chung, không đảm bảo áp dụng cho sản phẩm này):\n` +
    lines.join("\n")
  );
}
