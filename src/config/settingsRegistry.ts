import { SETTINGS_KEYS } from "../core/settingsKeys.js";
import {
  USAGE_TEXT,
  WELCOME_MESSAGE_TEMPLATE_DEFAULT,
  SUCCESS_REPLY_TEMPLATE_DEFAULT,
  GROUP_JOIN_WELCOME_TEMPLATE_DEFAULT,
  DASHBOARD_LINK_REPLY_TEMPLATE_DEFAULT,
  ORDERS_CONFIRMED_TEMPLATE_DEFAULT,
  WITHDRAWAL_REQUESTED_TEMPLATE_DEFAULT,
  WITHDRAWAL_PAID_TEMPLATE_DEFAULT,
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
    helpText: "Phần trăm user nhận trên hoa hồng sau khi trừ thuế/phí sàn (0-100). Phần còn lại thuộc về chủ bot. Lưu ý: đổi số này cũng áp dụng NGƯỢC cho các đơn đang \"Chờ xác nhận\" (pending) ở lần đối soát kế tiếp — accesstradeSync tính lại userShareAmount theo % mới nhất mỗi lần sync, không giữ % lúc đơn được tạo. Chỉ đơn đã \"Khả dụng\"/\"Đã rút\" (confirmed/paid) mới giữ nguyên, không bị ảnh hưởng.",
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
    helpText: "Không có placeholder động.",
  },
  {
    key: SETTINGS_KEYS.successReplyTemplate,
    label: "Tin nhắn trả link mua hàng thành công",
    type: "textarea",
    default: SUCCESS_REPLY_TEMPLATE_DEFAULT,
    helpText: "Placeholder hợp lệ: {{link}}, {{commissionLine}} (dòng hoa hồng ước tính, tự tính theo sản phẩm).",
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
      "Placeholder hợp lệ: {{summaryLine}} (tự tính tên đơn/số tiền, khác nhau khi 1 đơn hay gộp nhiều đơn), {{dashboardUrl}}.",
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
];
