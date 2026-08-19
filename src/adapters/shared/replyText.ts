import type { CommissionEstimate, PromotionItem } from "../../core/affiliateProvider.js";
import { getMerchantConfig, type MerchantId } from "../../core/merchants.js";

export const USAGE_TEXT =
  "👋 Gửi cho mình link sản phẩm Shopee hoặc Lazada (ví dụ: https://shopee.vn/...-i.123.456), " +
  "mình sẽ trả về link áp mã cho bạn.";

function formatVnd(amount: number): string {
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(amount)}đ`;
}

export function formatSuccessReply(
  merchant: MerchantId,
  affiliateUrl: string,
  commissionEstimate?: CommissionEstimate | null
): string {
  const displayName = getMerchantConfig(merchant).displayName;
  // commissionEstimate chi co khi provider lay duoc du lieu CHINH THUC (khong phai scrape/doan) -
  // hien chi TikTok Shop qua Accesstrade (xem accesstradeProvider.ts). Khong co thi bo qua dong nay,
  // KHONG tu bia so - giu dung nguyen tac da thong nhat.
  // 2026-08-18: rut gon theo lua chon "Vua phai" cua user (3 phuong an), bo dong du phong
  // "gui admin neu cho lau" de tin nhan ngan hon.
  const commissionLine = commissionEstimate
    ? `💰 Hoa hồng ước tính: ~${commissionEstimate.ratePercent.toFixed(1)}% (~${formatVnd(commissionEstimate.estimatedAmount)}), đang áp dụng cho SP này.\n\n`
    : "";
  // 2026-08-19: rut gon thanh 1 cau duy nhat (bo phan biet co/khong co estimate) theo yeu cau user -
  // cau moi khong con nhac "so tien" nen khong con ly do phai tach nhanh de tranh mau thuan nhu truoc.
  const pendingLine = `Nhắn "idid" riêng cho Admin để xem hoa hồng của bạn nhé.`;
  return (
    `🛒 ${displayName}: ${affiliateUrl}\n\n` +
    commissionLine +
    `⚠️ Mở đúng link và đặt hàng ngay trong phiên đó để được ghi nhận.\n\n` +
    pendingLine
  );
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

/**
 * userId tra ve kem theo de admin sau nay tim lai dung cuoc tro chuyen (vi du go thang userId
 * vao o tim kiem cua Zalo/Telegram de nhay toi dung nguoi, khi can nhan tin hoi STK luc xu ly rut tien).
 */
export function formatDashboardLinkReply(dashboardUrl: string, userId: string): string {
  return (
    `🆔 ID của bạn là: ${userId}\n\n` +
    `🎁 Đây là link theo dõi hoa hồng của bạn: ${dashboardUrl}`
  );
}
