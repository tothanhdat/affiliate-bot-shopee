import type { CommissionEstimate, PromotionItem } from "../../core/affiliateProvider.js";
import { getMerchantConfig, type MerchantId } from "../../core/merchants.js";
import type { ConfirmedOrderItem } from "../../core/orderIngest.js";

export const USAGE_TEXT =
  "👋 Gửi cho mình link sản phẩm Shopee hoặc TikTok Shop (ví dụ: https://vn.shp.ee/xxxxxxx), " +
  "mình sẽ trả về link áp mã cho bạn.";

/**
 * Zalo DM voi noi dung khong khop lenh "xemhh" - truoc day IM LANG hoan toan (quyet dinh 2026-08-17,
 * tranh lo link dashboard neu lo tra loi nham trong group), nhung lam nguoi lan dau dung tuong bot loi.
 * phan-hoi-cai-thien-trai-nghiem-nguoi-dung.md muc 10 (2026-08-20): tra loi 1 cau huong dan co dinh,
 * KHONG lo bat ky thong tin ca nhan/link dashboard nao. Dat o day (dung chung style cac template
 * khac) du hien chi Zalo DM dung, de neu sau can dung lai cho noi khac thi co san.
 * Cu phap doi tu "idid" sang "xemhh" ngay 2026-08-20 (yeu cau truc tiep cua user, de nghia hon).
 */
function formatVnd(amount: number): string {
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(amount)}đ`;
}

/**
 * Thay moi `{{key}}` trong template bang vars[key] tuong ung - key khong khop (vd admin go sai
 * ten placeholder) thi GIU NGUYEN placeholder, khong throw, tranh crash luc gui tin that.
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => (key in vars ? vars[key] : match));
}

/** Default cho setting "success_reply_template" (xem SETTINGS_KEYS) - dung khi admin chua tuy chinh. */
export const SUCCESS_REPLY_TEMPLATE_DEFAULT =
  `Link đây ạ: {{link}}\n\n` +
  `{{commissionLine}}\n\n` +
  `Nếu cần theo dõi các đơn hàng đã đặt và hoa hồng nhận được, bạn vui lòng nhắn với cú pháp "xemhh" riêng cho Admin nhé.\n\n` +
  `⚠️ Lưu ý quan trọng: Bạn mở đúng link và đặt hàng ngay trong phiên đó mới được ghi nhận nhé. Không xem video/live trong phiên nhé.`;

export function formatSuccessReply(
  template: string,
  merchant: MerchantId,
  affiliateUrl: string,
  commissionEstimate?: CommissionEstimate | null
): string {
  // commissionEstimate chi co khi provider lay duoc du lieu CHINH THUC (khong phai scrape/doan) -
  // hien chi TikTok Shop qua Accesstrade (xem accesstradeProvider.ts). Khong co thi bo qua dong nay,
  // KHONG tu bia so - giu dung nguyen tac da thong nhat.
  // 2026-08-20 (viet lai theo gop y truc tiep cua user sau khi xem tin nhan that): cau "mình sẽ chủ
  // dong nhan tin cho ban" thay cho "nhan 'xemhh' de theo doi" o dong nay - vi tu 2026-08-20 da co
  // thong bao tu dong khi don duoc xac nhan (phan-hoi-cai-thien-trai-nghiem-nguoi-dung.md muc 1), noi
  // "cho minh chu dong bao" khong con la loi hua suong nua. Dong "xemhh" van giu o duoi cho case user
  // muon tu tra cuu truoc khi co thong bao.
  const commissionLine = commissionEstimate
    ? `💰 Hoa hồng ước tính: ~${commissionEstimate.ratePercent.toFixed(1)}% (~${formatVnd(commissionEstimate.estimatedAmount)}), đang áp dụng cho SP này. Số liệu có thể thay đổi khi đơn được xác nhận.`
    : merchant === "shopee"
      ? `Vì sàn Shopee không cho phép mình xem giá sản phẩm nên tạm thời mình chưa tính được hoa hồng thực tế. Bạn vui lòng đợi đơn hoàn tất rồi mình sẽ chủ động nhắn tin cho bạn nhé.`
      : `Đơn cần thời gian để hệ thống affiliate xác nhận, mình sẽ chủ động nhắn tin cho bạn khi đơn hoàn tất nhé.`;
  return renderTemplate(template, { link: affiliateUrl, commissionLine });
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

/**
 * phan-hoi-cai-thien-trai-nghiem-nguoi-dung.md muc 1 (Option B, 2026-08-20): thong bao gop theo
 * lot ghi nhan don (record-conversion/record-conversions-csv), khong gui real-time tung don rieng.
 * 1 phan tu trong items dung chung cho ca 2 case (ghi 1 don le cung goi ham nay voi items co 1 phan tu).
 * 2026-08-20 (yeu cau truc tiep cua user sau khi test that): liet ke ten san pham + so tien tung don
 * thay vi chi tong so tien, tone gan gui/de thuong hon. productName null (admin bo trong luc ghi
 * nhan) fallback ve "Đơn <orderId>" de khong hien "null" tho trong tin nhan.
 */
export function formatOrdersConfirmedReply(items: ConfirmedOrderItem[], dashboardUrl: string): string {
  const total = items.reduce((sum, item) => sum + item.userShareAmount, 0);
  const label = (item: ConfirmedOrderItem) => (item.productName ? item.productName : `Đơn ${item.orderId}`);

  if (items.length === 1) {
    const [item] = items;
    return (
      `🎉 Yay, đơn "${label(item)}" của bạn đã được xác nhận rồi nè! Bạn nhận được ${formatVnd(item.userShareAmount)} hoa hồng 💰\n\n` +
      `Xem chi tiết: ${dashboardUrl}`
    );
  }

  const lines = items.map((item) => `- ${label(item)}: ${formatVnd(item.userShareAmount)}`).join("\n");
  return (
    `🎉 Yay, bạn có ${items.length} đơn mới được xác nhận rồi nè!\n` +
    `${lines}\n\n` +
    `💰 Tổng cộng bạn nhận được: ${formatVnd(total)}\n\n` +
    `Xem chi tiết: ${dashboardUrl}`
  );
}

/**
 * 2026-08-20 (yeu cau truc tiep cua user, viet lai toan bo noi dung lan 2 cung ngay): DM chao
 * mung gui 1 LAN DUY NHAT toi user vua gui link san pham DAU TIEN trong group (xem
 * LedgerStore.tryClaimWelcomeMessage - dam bao khong gui lai lan 2). userSharePercent/
 * withdrawalThresholdVnd truyen vao thay vi hard-code - dong bo voi COMMISSION_USER_SHARE_PERCENT/
 * WITHDRAWAL_THRESHOLD_VND trong .env, tranh phai sua tay text nay moi lan doi ty le/nguong.
 * CHI dung boi Zalo (zca-js DM duoc bat ky user nao) - Telegram Bot API chan DM toi user chua tung
 * tu nhan tin cho bot truoc (loi "Forbidden: bot can't initiate conversation"), nen khong ap dung
 * cho Telegram (quyet dinh 2026-08-20, xem zalo/bot.ts).
 */
/** Default cho setting "welcome_message_template" (xem SETTINGS_KEYS) - dung khi admin chua tuy chinh. */
export const WELCOME_MESSAGE_TEMPLATE_DEFAULT =
  `Chào bạn, rất vui vì bạn đã tham gia group nha! 🎉\n\n` +
  `Mình là bot hỗ trợ săn sale hoàn tiền (cashback) khi mua hàng qua Shopee, TikTok Shop. Trước khi dùng, gửi bạn vài thông tin quan trọng để dùng cho thuận tiện nhé:\n\n` +
  `🛍️ Cách dùng: Cứ dán link sản phẩm vào group, mình tự nhận diện sàn và trả ngay link mua hàng được gắn mã hoàn tiền — bấm đúng link đó rồi mua như bình thường là được ghi nhận.\n\n` +
  `💰 Hoa hồng: Bạn nhận {{userSharePercent}}% hoa hồng phát sinh (sau khi trừ thuế và phí sàn), mình giữ lại {{botSharePercent}}% để duy trì vận hành.\n\n` +
  `⏳ Thời gian ghi nhận: Sau khi mua, đơn cần vài ngày đến một tuần để sàn xác nhận. Mình đối soát định kỳ hàng tuần, có đơn mới sẽ tự động nhắn báo bạn, không cần hỏi lại.\n\n` +
  `📊 Theo dõi hoa hồng: Nhắn "xemhh" cho mình qua tin nhắn riêng (không phải trong group) bất cứ lúc nào để lấy link dashboard cá nhân — xem chi tiết từng đơn và số dư.\n\n` +
  `💵 Rút tiền: Khi số dư đạt từ {{withdrawalThreshold}}, bạn yêu cầu rút toàn bộ ngay trên dashboard (không hỗ trợ rút một phần), điền thông tin ngân hàng là xong — admin sẽ nhắn riêng xác nhận lại trước khi chuyển khoản.\n\n` +
  `⚠️ Lưu ý: Shopee không hỗ trợ xem hoa hồng ước tính trước — chỉ TikTok Shop mới trả được ước tính hoa hồng ngay khi lấy link, còn lại phải chờ đơn được xác nhận mới biết chính xác. Đơn đang chờ xác nhận có thể bị huỷ nếu không đạt yêu cầu đối soát của sàn — khi đã xác nhận (Khả dụng) rồi thì hoa hồng cho đơn đó không thay đổi nữa.\n\n` +
  `Xem Sổ tay hoàn tiền chi tiết tại link: https://docs.google.com/document/d/1-Dc7L6fHg350j3sVlpMPxZLgObspwov1gTY9eM4ajSk/edit?tab=t.0\n\n` +
  `Có gì thắc mắc cứ nhắn mình hoặc tag admin trong group nha. Chúc bạn săn sale vui! 🥳`;

export function formatWelcomeReply(template: string, userSharePercent: number, withdrawalThresholdVnd: number): string {
  const botSharePercent = 100 - userSharePercent;
  return renderTemplate(template, {
    userSharePercent: String(userSharePercent),
    botSharePercent: String(botSharePercent),
    withdrawalThreshold: formatVnd(withdrawalThresholdVnd),
  });
}
