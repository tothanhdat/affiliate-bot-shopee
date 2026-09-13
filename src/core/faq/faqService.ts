import { renderTemplate } from "../../adapters/shared/replyText.js";
import { SETTINGS_KEYS, faqAnswerKey } from "../settingsKeys.js";
import type { RateLimiter } from "../rateLimiter.js";
import type { FaqMuteReason } from "../types.js";
import type { FaqClassifier } from "./faqClassifier.js";
import { FAQ_TOPICS, FAQ_MUTE_MINUTES_DEFAULT, type FaqTopic } from "./faqTopics.js";

/**
 * Port hep toi LedgerStore - khai bao o day thay vi import class that de core/faq khong phu thuoc
 * nguoc vao toan bo LedgerStore. LedgerStore thoa man interface nay theo structural typing, khong
 * can sua gi ben do.
 */
export interface FaqStore {
  isFaqThreadMuted(platform: string, threadId: string, nowMs: number): boolean;
  muteFaqThread(platform: string, threadId: string, mutedUntilMs: number | null, reason: FaqMuteReason): void;
  unmuteFaqThread(platform: string, threadId: string): void;
  getSetting(key: string, defaultValue: string): string;
  getSettingInt(key: string, defaultValue: number): number;
}

export interface FaqServiceOptions {
  classifier: FaqClassifier;
  store: FaqStore;
  /** Rate limit RIENG cho FAQ (khong dung chung voi rate limit tao link) - chan 1 user dot tien API. */
  rateLimiter: RateLimiter;
  /** Bao cho CHU BOT, khong phai user - xem adapters/shared/adminNotifier.ts. */
  notifyAdmin: (message: string) => Promise<void>;
  /** Fallback khi admin chua override tren /admin/settings (dong bo voi env, giong cac cho khac). */
  defaultUserSharePercent: number;
  defaultWithdrawalThresholdVnd: number;
}

export interface FaqResolveInput {
  platform: string;
  userId: string;
  threadId: string;
  question: string;
  userDisplayName: string;
  /** Link dashboard ca nhan cua user - adapter tao san qua findOrCreateDashboardToken. */
  dashboardUrl: string;
}

function formatVnd(amount: number): string {
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(amount)}đ`;
}

/**
 * Dieu phoi FAQ: mute -> rate limit -> classify -> lay cau tra loi soan san -> render placeholder.
 * Tra ve null nghia la IM LANG (adapter khong gui gi ca) - moi quyet dinh im/noi nam o day, adapter
 * khong tu suy luan.
 */
export class FaqService {
  constructor(private readonly options: FaqServiceOptions) {}

  async resolve(input: FaqResolveInput): Promise<string | null> {
    const { platform, threadId, userId, question } = input;

    if (this.options.store.isFaqThreadMuted(platform, threadId, Date.now())) return null;
    if (!this.options.rateLimiter.checkAndRecord(`${platform}-faq:${userId}`).allowed) return null;

    let topicIds: string[] = [];
    try {
      topicIds = await this.options.classifier.classify(question, FAQ_TOPICS);
    } catch (err: unknown) {
      // Loi API khong duoc lam hong luong tin nhan - xu ly y het "khong nhan ra cau hoi".
      console.warn("[faq] classifier loi:", err instanceof Error ? err.message : err);
      topicIds = [];
    }

    const topics = topicIds
      .map((id) => FAQ_TOPICS.find((t) => t.id === id))
      .filter((t): t is FaqTopic => t !== undefined);

    if (topics.length === 0) {
      this.escalateToAdmin(input);
      return null;
    }

    return topics.map((topic) => this.answerFor(topic, input)).join("\n\n");
  }

  /** Admin vua go tay trong thread -> bot im N phut de khong chen ngang cuoc tro chuyen. */
  muteByAdminTyping(platform: string, threadId: string): void {
    this.options.store.muteFaqThread(platform, threadId, Date.now() + this.muteMs(), "admin_typed");
  }

  /** Lenh "/im" - khoa vo thoi han cho toi khi admin go "/noi". */
  muteByAdminCommand(platform: string, threadId: string): void {
    this.options.store.muteFaqThread(platform, threadId, null, "admin_command");
  }

  unmute(platform: string, threadId: string): void {
    this.options.store.unmuteFaqThread(platform, threadId);
  }

  private muteMs(): number {
    return this.options.store.getSettingInt(SETTINGS_KEYS.faqMuteMinutes, FAQ_MUTE_MINUTES_DEFAULT) * 60_000;
  }

  /**
   * Khong nhan ra cau hoi -> CHI bao chu bot, KHONG tu khoa thread (sua 2026-09-13 theo bao cao
   * that: khoa o day se lam im ca cau FAQ hop le hoi NGAY SAU DO, du admin chua he can thiep gi -
   * xem test "sau 1 cau khong nhan ra, cau FAQ hop le tiep theo VAN duoc tra loi"). Khoa thread CHI
   * xay ra khi admin THAT SU go tay (muteByAdminTyping, phat hien qua SentMessageTracker trong
   * zalo/bot.ts) hoac go lenh "/im" (muteByAdminCommand) - khong phai do bot tu doan.
   */
  private escalateToAdmin(input: FaqResolveInput): void {
    const message =
      `❓ [${input.platform}] ${input.userDisplayName} (${input.userId}) vừa hỏi câu bot không hiểu:\n` +
      `"${input.question}"`;
    this.options.notifyAdmin(message).catch((err: unknown) => {
      console.warn("[faq] khong bao duoc admin:", err instanceof Error ? err.message : err);
    });
  }

  private answerFor(topic: FaqTopic, input: FaqResolveInput): string {
    const template = this.options.store.getSetting(faqAnswerKey(topic.id), topic.defaultAnswer);
    const userShare = this.options.store.getSettingInt(
      SETTINGS_KEYS.userSharePercent,
      this.options.defaultUserSharePercent
    );
    const threshold = this.options.store.getSettingInt(
      SETTINGS_KEYS.withdrawalThresholdVnd,
      this.options.defaultWithdrawalThresholdVnd
    );
    return renderTemplate(template, {
      userSharePercent: String(userShare),
      botSharePercent: String(100 - userShare),
      withdrawalThreshold: formatVnd(threshold),
      dashboardUrl: input.dashboardUrl,
    });
  }
}
