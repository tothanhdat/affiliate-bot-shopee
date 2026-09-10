/**
 * Dinh tuyen thong bao cho CHU BOT (khac notifyUser - gui cho nguoi dung cuoi): uu tien
 * Telegram, khong co thi rot xuong Zalo DM, khong co nua thi chi log.
 *
 * Ly do co file nay (2026-09-10): truoc day notifyAdmin la closure ngay trong src/index.ts va
 * CHI gui duoc qua Telegram (telegramBot + ADMIN_TELEGRAM_CHAT_ID). Mot instance chay Zalo-only
 * (khong khai TELEGRAM_BOT_TOKEN - vi du ban deploy rieng cho chu bot khac) se mat SACH thong bao
 * "co yeu cau rut tien moi": no chi con nam trong console.warn cua log server, tuc la tien cua
 * user nam cho ma chu bot khong he hay biet. Tach ra day de test duoc thu tu fallback.
 *
 * KHONG import telegraf/zca-js o day - caller (src/index.ts) tu dong goi bot that thanh ham
 * (message) => Promise<void>, giu file nay sach khoi moi phu thuoc platform.
 */
export interface AdminNotifierOptions {
  /**
   * Tra ve ham gui Telegram neu da cau hinh day du (co bot VA co chat id), null neu chua.
   * Duoc goi LAI moi lan notifyAdmin chay - khong phai 1 lan luc tao notifier - vi trong
   * src/index.ts ca telegramBot lan zaloBot deu duoc gan SAU khi notifier da duoc tao
   * (createServer can tham chieu notifyAdmin truoc khi 2 bot khoi dong xong).
   */
  resolveTelegramSender: () => ((message: string) => Promise<void>) | null;
  /** Tuong tu cho Zalo DM - can ca zaloBot dang song VA ADMIN_ZALO_USER_ID khac rong. */
  resolveZaloSender: () => ((message: string) => Promise<void>) | null;
  /** Goi khi khong kenh nao kha dung. Mac dinh console.warn. */
  logUnavailable?: (message: string) => void;
}

const defaultLogUnavailable = (message: string): void => {
  console.warn(
    "[admin-notify] khong the gui thong bao (chua co Telegram: telegramBot + ADMIN_TELEGRAM_CHAT_ID, " +
      "cung khong co Zalo: zaloBot + ADMIN_ZALO_USER_ID):",
    message
  );
};

/**
 * Tao ham notifyAdmin(message). Loi gui duoc NEM RA cho caller xu ly (moi call site hien tai
 * da co .catch() rieng) - co chu dich khong tu doi sang kenh con lai khi kenh dau that bai,
 * vi nhu vay se gui trung 2 lan trong truong hop loi tam thoi (vd Telegram 429 roi retry duoc).
 */
export function createAdminNotifier(options: AdminNotifierOptions): (message: string) => Promise<void> {
  const logUnavailable = options.logUnavailable ?? defaultLogUnavailable;

  return async (message: string): Promise<void> => {
    const sendTelegram = options.resolveTelegramSender();
    if (sendTelegram) {
      await sendTelegram(message);
      return;
    }

    const sendZalo = options.resolveZaloSender();
    if (sendZalo) {
      await sendZalo(message);
      return;
    }

    logUnavailable(message);
  };
}
