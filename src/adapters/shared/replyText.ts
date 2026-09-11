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
      ? `Do Shopee chưa cho xem giá nên chưa tính hoa hồng liền được, đợi xíu đơn confirm là em nhắn ngay nha!`
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
/** Default cho setting "dashboard_link_reply_template" (xem SETTINGS_KEYS) - dung khi admin chua tuy chinh. */
export const DASHBOARD_LINK_REPLY_TEMPLATE_DEFAULT =
  `Đây nè 👇\n` +
  `🆔 ID: {{userId}}\n` +
  `🎁 Dashboard của bạn: {{dashboardUrl}} — bấm vào coi hoa hồng/đơn hàng bất cứ lúc nào nha, link này xài hoài không đổi.`;

export function formatDashboardLinkReply(template: string, dashboardUrl: string, userId: string): string {
  return renderTemplate(template, { dashboardUrl, userId });
}

/**
 * phan-hoi-cai-thien-trai-nghiem-nguoi-dung.md muc 1 (Option B, 2026-08-20): thong bao gop theo
 * lot ghi nhan don (record-conversion/record-conversions-csv), khong gui real-time tung don rieng.
 * 1 phan tu trong items dung chung cho ca 2 case (ghi 1 don le cung goi ham nay voi items co 1 phan tu).
 * 2026-08-20 (yeu cau truc tiep cua user sau khi test that): liet ke ten san pham + so tien tung don
 * thay vi chi tong so tien, tone gan gui/de thuong hon. productName null (admin bo trong luc ghi
 * nhan) fallback ve "Đơn <orderId>" de khong hien "null" tho trong tin nhan.
 */
/** Default cho setting "orders_confirmed_template" (xem SETTINGS_KEYS) - dung khi admin chua tuy chinh. */
export const ORDERS_CONFIRMED_TEMPLATE_DEFAULT = `{{summaryLine}}\n\nXem chi tiết: {{dashboardUrl}}`;

export function formatOrdersConfirmedReply(
  template: string,
  items: ConfirmedOrderItem[],
  dashboardUrl: string
): string {
  const total = items.reduce((sum, item) => sum + item.userShareAmount, 0);
  const label = (item: ConfirmedOrderItem) => (item.productName ? item.productName : `Đơn ${item.orderId}`);

  const summaryLine =
    items.length === 1
      ? `Yayyy 🎉 đơn "${label(items[0])}" của bạn confirm rồi nè, về túi bạn ${formatVnd(items[0].userShareAmount)} 💸`
      : `Chốt đợt này bạn có ${items.length} đơn về luôn nè 🥳\n` +
        `${items.map((item) => `${label(item)}: ${formatVnd(item.userShareAmount)}`).join(" / ")}\n` +
        `Tổng cộng: ${formatVnd(total)} 💰`;

  return renderTemplate(template, { summaryLine, dashboardUrl });
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
 * 2026-09-07 (yeu cau truc tiep cua user): doan "Theo doi hoa hong" doi tu huong dan nhan "xemhh"
 * sang hien THANG link dashboard (tham so dashboardUrl moi, lay qua findOrCreateDashboardToken
 * trong zalo/bot.ts) - "xemhh" van con nhung chi con la cach lay LAI link neu lo mat.
 * 2026-09-07 (rut gon lan 2, cung ngay - yeu cau truc tiep cua user sau khi thay 2 DM chao lien
 * tiep qua dai dong): bo han cac doan "cach dung"/luu y Shopee/link So tay - da co du o
 * GROUP_JOIN_WELCOME_TEMPLATE_DEFAULT (DM chao luc vua join group, gui truoc do). Template nay
 * gio CHI tap trung % hoa hong + link dashboard, xung "em" dong bo voi cac template khac (formatSuccessReply
 * nhanh shopee cung xung "em").
 */
/** Default cho setting "welcome_message_template" (xem SETTINGS_KEYS) - dung khi admin chua tuy chinh. */
export const WELCOME_MESSAGE_TEMPLATE_DEFAULT =
  `Gửi link đầu tiên rồi nè, em chào lại phát cho chắc kèo luôn nha! 🎉\n\n` +
  `💰 Bạn nhận {{userSharePercent}}% hoa hồng mỗi đơn (sau thuế/phí sàn), em giữ lại {{botSharePercent}}% để vận hành thôi. Đơn cần vài ngày đến 1 tuần để sàn xác nhận, có đơn mới là em tự nhắn báo liền, khỏi cần hỏi lại đâu.\n\n` +
  `📊 Đây là dashboard riêng của bạn nè, bấm vào xem chi tiết từng đơn/số dư bất cứ lúc nào, link xài hoài không đổi: {{dashboardUrl}}\n\n` +
  `💵 Đủ từ {{withdrawalThreshold}} là rút được liền trên dashboard luôn. Lỡ mất link thì nhắn "xemhh" cho em để lấy lại nha!`;

/** Default cho setting "withdrawal_requested_template" (xem SETTINGS_KEYS) - dung khi admin chua tuy chinh. */
export const WITHDRAWAL_REQUESTED_TEMPLATE_DEFAULT =
  `Đã ghi nhận yêu cầu rút {{amount}} nha 💸 Admin check thông tin xong sẽ nhắn riêng xác nhận trước khi chuyển khoản, chờ chút xíu nhen!`;

/** DM tu dong khi user gui yeu cau rut tien thanh cong tren dashboard (POST /d/:token/withdraw). */
export function formatWithdrawalRequestedReply(template: string, amountVnd: number): string {
  return renderTemplate(template, { amount: formatVnd(amountVnd) });
}

/** Default cho setting "withdrawal_paid_template" (xem SETTINGS_KEYS) - dung khi admin chua tuy chinh. */
export const WITHDRAWAL_PAID_TEMPLATE_DEFAULT =
  `Tiền đã bay về bạn rồi đó 🥰 Vô dashboard xem ảnh chuyển khoản nếu cần đối chiếu nha: {{dashboardUrl}}`;

/** DM tu dong khi admin danh dau 1 yeu cau rut tien la "da tra" (POST /admin/withdrawals/:id/mark-paid). */
export function formatWithdrawalPaidReply(template: string, dashboardUrl: string): string {
  return renderTemplate(template, { dashboardUrl });
}

export function formatWelcomeReply(
  template: string,
  userSharePercent: number,
  withdrawalThresholdVnd: number,
  dashboardUrl: string
): string {
  const botSharePercent = 100 - userSharePercent;
  return renderTemplate(template, {
    userSharePercent: String(userSharePercent),
    botSharePercent: String(botSharePercent),
    withdrawalThreshold: formatVnd(withdrawalThresholdVnd),
    dashboardUrl,
  });
}

/**
 * DM chao mung gui 1 LAN DUY NHAT toi user NGAY LUC vua duoc ADD vao group (2026-09-07, yeu cau
 * truc tiep cua user - truoc do phai doi den khi user tu gui link san pham dau tien moi co
 * formatWelcomeReply o tren, khien user moi khong biet cach dung phai nhan tin rieng hoi admin).
 * Ngan gon, tone GenZ, chi kem link So tay hoan tien - KHONG kem dashboard (dashboard chi co y
 * nghia sau khi user da co hoat dong, xem formatWelcomeReply). Khong co placeholder dong nao nen
 * khong can di qua renderTemplate, tra thang template. Xung "em" (sua 2026-09-07 cung ngay, dong
 * bo voi WELCOME_MESSAGE_TEMPLATE_DEFAULT) - rieng "nha tụi mình" giu nguyen vi la so nhieu (chao
 * vao khong gian chung), khong phai bot tu xung ngoi thu nhat so it.
 */
/** Default cho setting "group_join_welcome_template" (xem SETTINGS_KEYS) - dung khi admin chua tuy chinh. */
export const GROUP_JOIN_WELCOME_TEMPLATE_DEFAULT =
  `Ơ hi bạn mới toanh 👋🎉 Chào mừng vào nhà tụi mình nha!\n\n` +
  `Em là bot săn sale hoàn tiền nè — cứ thả link sản phẩm Shopee/TikTok Shop vào group, em trả lại link mua hàng gắn mã hoàn tiền liền, mua xong là có tiền về túi 💸\n\n` +
  `Chưa rành cách chơi thì đọc lẹ Sổ tay hoàn tiền ở đây nè: https://docs.google.com/document/d/1-Dc7L6fHg350j3sVlpMPxZLgObspwov1gTY9eM4ajSk\n\n` +
  `Có gì cứ hỏi riêng em, đừng ngại nha! 🥳`;

export function formatGroupJoinWelcomeReply(template: string): string {
  return template;
}

/**
 * Tin nhan bot gui VAO GROUP sau khi admin import xong file bao cao Shopee tren /admin/record-orders
 * (2026-09-11, yeu cau truc tiep cua user) - khac moi template khac trong file nay o cho day la tin
 * gui cho CA GROUP, khong phai DM cho 1 user, nen tuyet doi khong chua so lieu ca nhan (so tien,
 * ten don) - chi bao "du lieu da cap nhat" + chi duong vao dashboard rieng.
 * Gui MOI lan import thanh cong, ke ca khi 0 don moi (quyet dinh cua user: giu nhip thong bao deu
 * dan hang ngay), nen noi dung co chu dich khong noi gi ve so luong don.
 * {{date}} la ngay HOM QUA theo gio VN, dinh dang dd/mm - xem src/core/vietnamDate.ts.
 */
/** Default cho setting "group_report_updated_template" (xem SETTINGS_KEYS) - dung khi admin chua tuy chinh. */
export const GROUP_REPORT_UPDATED_TEMPLATE_DEFAULT =
  `Đơn hàng Shopee ngày {{date}} đã được cập nhật lên hệ thống. ` +
  `Anh/Chị vào link dashboard của mình để xem nhé. ` +
  `Nếu chưa nhận được link, anh/chị nhắn "xemhh" để xem nhé.`;

export function formatGroupReportUpdatedReply(template: string, date: string): string {
  return renderTemplate(template, { date });
}
