/**
 * Ten cac key luu trong bang `settings` cua LedgerStore - tach rieng file nay (thay vi de thang
 * trong ledgerStore.ts) de src/config/settingsRegistry.ts (biet ca env lan UI) cung import duoc
 * ma khong keo LedgerStore phu thuoc nguoc lai config layer.
 */
export const SETTINGS_KEYS = {
  userSharePercent: "commission_user_share_percent",
  withdrawalThresholdVnd: "withdrawal_threshold_vnd",
  usageText: "usage_text",
  welcomeMessageTemplate: "welcome_message_template",
  successReplyTemplate: "success_reply_template",
  groupJoinWelcomeTemplate: "group_join_welcome_template",
  dashboardLinkReplyTemplate: "dashboard_link_reply_template",
  ordersConfirmedTemplate: "orders_confirmed_template",
  withdrawalRequestedTemplate: "withdrawal_requested_template",
  withdrawalPaidTemplate: "withdrawal_paid_template",
  groupReportUpdatedTemplate: "group_report_updated_template",
  faqMuteMinutes: "faq_mute_minutes",
  /** Cau tra loi khi FAQ khong nhan ra chu de (2026-09-13) - xem FAQ_OUT_OF_SCOPE_REPLY_DEFAULT. */
  faqOutOfScopeReply: "faq_out_of_scope_reply",
} as const;

/**
 * Key luu cau tra loi FAQ cua 1 chu de (2026-09-13). Tach ham thay vi liet ke tay trong SETTINGS_KEYS
 * vi danh sach chu de nam trong FAQ_TOPICS (core/faq/faqTopics.ts) - them chu de moi chi sua 1 noi.
 */
export function faqAnswerKey(topicId: string): string {
  return `faq_answer_${topicId}`;
}
