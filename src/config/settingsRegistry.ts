import { SETTINGS_KEYS, faqAnswerKey } from "../core/settingsKeys.js";
import {
  FAQ_TOPICS,
  FAQ_MUTE_MINUTES_DEFAULT,
  FAQ_ANSWER_PLACEHOLDERS,
  FAQ_OUT_OF_SCOPE_REPLY_DEFAULT,
} from "../core/faq/faqTopics.js";
import {
  USAGE_TEXT,
  WELCOME_MESSAGE_TEMPLATE_DEFAULT,
  SUCCESS_REPLY_TEMPLATE_DEFAULT,
  TIKTOK_PROVIDER_DOWN_TEMPLATE_DEFAULT,
  TIKTOK_NO_COMMISSION_TEMPLATE_DEFAULT,
  GROUP_JOIN_WELCOME_TEMPLATE_DEFAULT,
  GROUP_JOIN_BLOCKED_REPLY_TEMPLATE_DEFAULT,
  FRIEND_REQUEST_MESSAGE_DEFAULT,
  DASHBOARD_LINK_REPLY_TEMPLATE_DEFAULT,
  ORDERS_CONFIRMED_TEMPLATE_DEFAULT,
  ORDERS_CONFIRMED_CAPTION_TEMPLATE_DEFAULT,
  WITHDRAWAL_REQUESTED_TEMPLATE_DEFAULT,
  PAYOUT_DEBT_NOTICE_TEMPLATE_DEFAULT,
  WITHDRAWAL_CANCELLED_TEMPLATE_DEFAULT,
  WITHDRAWAL_PAID_TEMPLATE_DEFAULT,
  GROUP_REPORT_UPDATED_TEMPLATE_DEFAULT,
} from "../adapters/shared/replyText.js";
import { env } from "./env.js";

/**
 * Danh sach khai bao 5 setting admin sua duoc qua /admin/settings - dung CHUNG boi ca route GET
 * (build gia tri hien tai + render form) lan POST (validate + luu). Day la noi DUY NHAT can sua
 * khi them 1 setting moi sau nay (xem "Nguyen tac mo rong" trong spec) - trang settings tu dong
 * hien field moi, khong phai sua adminHtml.ts thu cong.
 *
 * CHI dung boi src/api/* (trang settings) - KHONG import vao adapter (telegram/bot.ts, zalo/bot.ts)
 * hay core, giu nguyen pattern DI hien co (adapter nhan default qua constructor option tu index.ts,
 * khong tu import src/config/*).
 */
export type SettingFieldType = "number" | "textarea";

export interface SettingFieldConfig {
  key: string;
  label: string;
  type: SettingFieldType;
  default: string;
  helpText?: string;
  min?: number;
  max?: number;
}

export const SETTINGS_REGISTRY: SettingFieldConfig[] = [
  {
    key: SETTINGS_KEYS.userSharePercent,
    label: "% hoa hồng user nhận",
    type: "number",
    default: String(env.commission.userSharePercent),
    min: 0,
    max: 100,
    helpText: "Phần trăm user nhận trên hoa hồng sau khi trừ thuế/phí sàn (0-100). Phần còn lại thuộc về chủ bot. Số này chỉ áp dụng cho đơn được ghi nhận TỪ ĐÂY TRỞ ĐI: mỗi đơn chốt tỉ lệ ngay lúc ghi nhận, nên đổi số này KHÔNG tính lại tiền cho đơn đã ghi — kể cả đơn đang \"Chờ xác nhận\" (pending), vì đó là đơn user đã mua, chỉ chờ Shopee duyệt. Đổi sai thì các đơn đã ghi trong lần import đó giữ luôn tỉ lệ sai, không tự chữa được bằng cách sửa lại số này.",
  },
  {
    key: SETTINGS_KEYS.withdrawalThresholdVnd,
    label: "Ngưỡng rút tiền tối thiểu (VNĐ)",
    type: "number",
    default: String(env.withdrawal.thresholdVnd),
    min: 1,
    helpText: "Số dư khả dụng tối thiểu để user gửi được yêu cầu rút tiền.",
  },
  {
    key: SETTINGS_KEYS.usageText,
    label: "Hướng dẫn khi chưa gửi link sản phẩm",
    type: "textarea",
    default: USAGE_TEXT,
    helpText: "Không có placeholder động.",
  },
  {
    key: SETTINGS_KEYS.welcomeMessageTemplate,
    label: "Tin nhắn chào mừng khi gửi link đầu tiên (Zalo DM, gửi 1 lần/user)",
    type: "textarea",
    default: WELCOME_MESSAGE_TEMPLATE_DEFAULT,
    helpText:
      "Placeholder hợp lệ: {{userSharePercent}}, {{botSharePercent}}, {{withdrawalThreshold}}, {{dashboardUrl}}.",
  },
  {
    key: SETTINGS_KEYS.groupJoinWelcomeTemplate,
    label: "Tin nhắn chào mừng khi vừa được thêm vào group (Zalo DM, gửi 1 lần/user)",
    type: "textarea",
    default: GROUP_JOIN_WELCOME_TEMPLATE_DEFAULT,
    helpText: "Placeholder hợp lệ: {{handbookUrl}} (link trang Sổ tay hoàn tiền của bot, /so-tay).",
  },
  {
    key: SETTINGS_KEYS.groupJoinBlockedReplyTemplate,
    label: "Tin nhắn chào bù trong group khi user chặn tin nhắn từ người lạ (Zalo)",
    type: "textarea",
    default: GROUP_JOIN_BLOCKED_REPLY_TEMPLATE_DEFAULT,
    helpText:
      "Dùng khi DM chào mừng bị Zalo từ chối vì user bật 'không nhận tin nhắn từ người lạ' — bot nhắn vào group và gửi luôn lời mời kết bạn. Placeholder hợp lệ: {{name}} (tên người mới, bot tự tag @, đừng tự thêm dấu @), {{handbookUrl}} (link trang Sổ tay hoàn tiền của bot, /so-tay).",
  },
  {
    key: SETTINGS_KEYS.friendRequestMessage,
    label: "Lời nhắn kèm lời mời kết bạn (Zalo)",
    type: "textarea",
    default: FRIEND_REQUEST_MESSAGE_DEFAULT,
    helpText: "Không có placeholder động. Nên viết ngắn — Zalo giới hạn độ dài lời nhắn kết bạn.",
  },
  {
    key: SETTINGS_KEYS.successReplyTemplate,
    label: "Tin nhắn trả link mua hàng thành công",
    type: "textarea",
    default: SUCCESS_REPLY_TEMPLATE_DEFAULT,
    helpText:
      "Placeholder hợp lệ: {{link}} và {{commissionLine}}. "
      + "{{commissionLine}} tự đổi theo tình huống: tra được hoa hồng thì thành câu báo số tiền ước tính "
      + "user nhận được, không tra được thì thành câu hẹn báo sau khi Shopee xác nhận đơn. "
      + "GIỮ placeholder này trong template — viết thẳng câu hoa hồng vào đây thì bot sẽ không bao giờ "
      + "hiện được số tiền ước tính nữa.",
  },
  {
    key: SETTINGS_KEYS.tiktokProviderDownTemplate,
    label: "Tin nhắn khi hệ thống Affiliate TikTok bảo trì",
    type: "textarea",
    default: TIKTOK_PROVIDER_DOWN_TEMPLATE_DEFAULT,
    helpText: "Không có placeholder động. Gửi khi RioHub không gọi được (sập, hết hạn mức, key sai).",
  },
  {
    key: SETTINGS_KEYS.tiktokNoCommissionTemplate,
    label: "Tin nhắn khi sản phẩm TikTok chưa bật hoàn tiền",
    type: "textarea",
    default: TIKTOK_NO_COMMISSION_TEMPLATE_DEFAULT,
    helpText: "Không có placeholder động. Đừng hẹn thử lại sau — sản phẩm này sẽ vẫn không có hoa hồng.",
  },
  {
    key: SETTINGS_KEYS.dashboardLinkReplyTemplate,
    label: 'Tin nhắn trả link dashboard (lệnh "xemhh")',
    type: "textarea",
    default: DASHBOARD_LINK_REPLY_TEMPLATE_DEFAULT,
    helpText: "Placeholder hợp lệ: {{userId}}, {{dashboardUrl}}.",
  },
  {
    key: SETTINGS_KEYS.ordersConfirmedTemplate,
    label: "Tin nhắn báo đơn hàng được xác nhận",
    type: "textarea",
    default: ORDERS_CONFIRMED_TEMPLATE_DEFAULT,
    helpText:
      "Placeholder hợp lệ: {{summaryLine}} (tự tính tên đơn/số tiền, khác nhau khi 1 đơn hay gộp nhiều đơn), {{heldLine}} (câu giải thích phần tiền đang bị giam, rỗng nếu không có đơn nào bị giam), {{debtLine}} (câu nhắc khoản nợ hoàn trả sẽ bị trừ khi user rút tiền, rỗng nếu không có nợ), {{dashboardUrl}}.",
  },
  {
    key: SETTINGS_KEYS.ordersConfirmedCaptionTemplate,
    label: "Caption đi kèm ảnh báo đơn về",
    type: "textarea",
    default: ORDERS_CONFIRMED_CAPTION_TEMPLATE_DEFAULT,
    helpText:
      "Placeholder hợp lệ: {{dashboardUrl}}, {{heldLine}}, {{debtLine}} (2 câu sau mặc định KHÔNG có trong caption vì ảnh đã tự vẽ hai điều này - chỉ thêm vào nếu bạn muốn nhắc lại bằng chữ). Dùng khi gửi được ảnh. Nếu render ảnh lỗi thì bot gửi mẫu tin ở ô trên thay thế.",
  },
  {
    key: SETTINGS_KEYS.withdrawalRequestedTemplate,
    label: "Tin nhắn báo đã ghi nhận yêu cầu rút tiền",
    type: "textarea",
    default: WITHDRAWAL_REQUESTED_TEMPLATE_DEFAULT,
    helpText: "Placeholder hợp lệ: {{amount}} (số tiền đã format VNĐ).",
  },
  {
    key: SETTINGS_KEYS.withdrawalPaidTemplate,
    label: "Tin nhắn báo đã chuyển tiền rút",
    type: "textarea",
    default: WITHDRAWAL_PAID_TEMPLATE_DEFAULT,
    helpText: "Placeholder hợp lệ: {{dashboardUrl}}.",
  },
  {
    key: SETTINGS_KEYS.payoutHoldThresholdVnd,
    label: "Ngưỡng giam đơn to (đ)",
    type: "number",
    default: String(env.payoutHold.thresholdVnd),
    min: 0,
    helpText:
      "Đơn có tiền hoàn của user từ mức này trở lên sẽ bị giam một thời gian trước khi cho rút, để kịp phát hiện khách trả hàng. Đặt 0 để tắt hẳn việc giam. Không có placeholder động.",
  },
  {
    key: SETTINGS_KEYS.payoutHoldDays,
    label: "Số ngày giam đơn to",
    type: "number",
    default: String(env.payoutHold.holdDays),
    min: 0,
    max: 60,
    helpText:
      "Đếm từ ngày Shopee ghi đơn là Hoàn thành (= ngày giao hàng), đúng mốc Shopee đếm 15 ngày được trả hàng. Ngày mở khoá được CHỐT lúc đơn chuyển Khả dụng — đổi số này không dịch ngày của đơn đã chốt trước đó. Không có placeholder động.",
  },
  {
    key: SETTINGS_KEYS.payoutDebtNoticeTemplate,
    label: "Tin nhắn khi đơn đã trả tiền bị trả hàng",
    type: "textarea",
    default: PAYOUT_DEBT_NOTICE_TEMPLATE_DEFAULT,
    helpText:
      "Gửi 1 lần cho mỗi đơn, khi báo cáo Shopee ghi đơn đã huỷ mà tiền đã chuyển cho user rồi. Khoản đó thành nợ và được trừ khi user gửi yêu cầu rút tiền lần sau. Placeholder hợp lệ: {{orderId}}, {{amount}}, {{dashboardUrl}}.",
  },
  {
    key: SETTINGS_KEYS.withdrawalCancelledTemplate,
    label: "Tin nhắn khi huỷ yêu cầu rút",
    type: "textarea",
    default: WITHDRAWAL_CANCELLED_TEMPLATE_DEFAULT,
    helpText: "Placeholder hợp lệ: {{amount}}, {{reason}}, {{dashboardUrl}}.",
  },
  {
    key: SETTINGS_KEYS.groupReportUpdatedTemplate,
    label: "Tin nhắn vào group sau khi import báo cáo Shopee",
    type: "textarea",
    default: GROUP_REPORT_UPDATED_TEMPLATE_DEFAULT,
    helpText:
      'Gửi vào các group Zalo được tick ở mục "Group Zalo nhận thông báo" bên dưới, mỗi lần import báo cáo Shopee thành công (kể cả khi không có đơn mới). Placeholder hợp lệ: {{date}} (ngày hôm qua theo giờ VN, dạng dd/mm). Đây là tin nhắn CHUNG cho cả group — đừng đưa số tiền/tên đơn của cá nhân vào đây.',
  },
  {
    key: SETTINGS_KEYS.faqMuteMinutes,
    label: "Số phút bot im lặng sau khi admin nhắn tay",
    type: "number",
    default: String(FAQ_MUTE_MINUTES_DEFAULT),
    min: 1,
    max: 1440,
    helpText:
      'Khi admin tự nhắn tay cho user trong Zalo DM, bot ngừng trả lời FAQ trong thread đó bằng đúng số phút này (không ảnh hưởng việc xử lý link sản phẩm và lệnh "xemhh" — 2 thứ đó luôn chạy). Gõ "/im" trong thread để khoá vô thời hạn, "/noi" để mở lại.',
  },
  {
    key: SETTINGS_KEYS.faqOutOfScopeReply,
    label: "FAQ — Câu trả lời khi ngoài phạm vi",
    type: "textarea",
    default: FAQ_OUT_OF_SCOPE_REPLY_DEFAULT,
    helpText:
      `Bot gửi câu này khi KHÔNG nhận ra chủ đề của câu hỏi (thay vì im lặng hoàn toàn). ` +
      `Placeholder dùng được: ${FAQ_ANSWER_PLACEHOLDERS.map((p) => `{{${p}}}`).join(", ")}. ` +
      `Không áp dụng khi thread đang bị khoá (admin đang tự nhắn tay, hoặc đã gõ "/im") — lúc đó bot vẫn im lặng như cũ.`,
  },
  // 8 o textarea cho 8 chu de FAQ - sinh tu FAQ_TOPICS thay vi liet ke tay, de them chu de moi chi
  // phai sua faqTopics.ts (form /admin/settings tu hien them o tuong ung).
  ...FAQ_TOPICS.map((topic) => ({
    key: faqAnswerKey(topic.id),
    label: `FAQ — ${topic.label}`,
    type: "textarea" as const,
    default: topic.defaultAnswer,
    helpText:
      `Câu trả lời bot gửi khi nhận ra user đang hỏi về: ${topic.description}. ` +
      `Placeholder dùng được: ${FAQ_ANSWER_PLACEHOLDERS.map((p) => `{{${p}}}`).join(", ")}. ` +
      `Lưu ý: sửa nội dung thì giữ đúng chủ đề — phần mô tả để AI nhận diện câu hỏi nằm trong code, không đổi theo ô này.`,
  })),
];
