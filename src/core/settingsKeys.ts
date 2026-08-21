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
} as const;
