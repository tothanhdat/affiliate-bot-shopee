import { formatVnd } from "../money.js";
import { renderTemplate } from "../../adapters/shared/replyText.js";
import { SETTINGS_KEYS, faqAnswerKey } from "../settingsKeys.js";
import type { RateLimiter } from "../rateLimiter.js";
import type { FaqMuteReason } from "../types.js";
import type { FaqClassifier } from "./faqClassifier.js";
import {
  FAQ_TOPICS,
  FAQ_MUTE_MINUTES_DEFAULT,
  FAQ_OUT_OF_SCOPE_REPLY_DEFAULT,
  type FaqTopic,
} from "./faqTopics.js";

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


/**
 * Dieu phoi FAQ: cau hoi rong -> mute -> rate limit -> classify -> lay cau tra loi soan san ->
 * render placeholder. Tra ve null nghia la IM LANG (adapter khong gui gi ca), xay ra khi: cau hoi
 * rong, thread dang bi khoa (admin dang go tay / lenh "/im"), qua rate limit, HOAC classifier LOI
 * (2026-10-01). Cau hoi da duoc classifier doc xong ma khong khop chu de nao thi van CO tra loi
 * (xem outOfScopeReply) - moi quyet dinh im/noi nam o day, adapter khong tu suy luan.
 */
export class FaqService {
  constructor(private readonly options: FaqServiceOptions) {}

  async resolve(input: FaqResolveInput): Promise<string | null> {
    const { platform, threadId, userId, question } = input;

    // Chuoi rong KHONG PHAI cau hoi - im lang TRUOC ca mute/rate-limit/classifier (2026-10-01).
    // Zalo day tin nhan noi dung rong vao thread khi khach chap nhan loi moi ket ban; neu de no di
    // toi classifier thi Anthropic tra 400 ("user messages must have non-empty content") va nhanh
    // catch coi nhu "khong nhan ra chu de" -> bot gui cau "ngoai pham vi" cho nguoi chua hoi gi.
    // Adapter da chan tu goc, day la chot thu hai: moi quyet dinh im/noi phai nam trong file nay.
    if (question.trim() === "") return null;

    if (this.options.store.isFaqThreadMuted(platform, threadId, Date.now())) return null;
    if (!this.options.rateLimiter.checkAndRecord(`${platform}-faq:${userId}`).allowed) return null;

    let topicIds: string[];
    try {
      topicIds = await this.options.classifier.classify(question, FAQ_TOPICS);
    } catch (err: unknown) {
      // Loi API (het han muc / 500 / mang / 401 key het han) KHAC HAN "chay xong ma khong khop chu
      // de nao" (2026-10-01, yeu cau truc tiep cua user - truoc do 2 nhanh bi gop): luc API sap,
      // bot CHUA HE doc duoc cau hoi, noi "cau hoi nay ngoai pham vi" la noi SAI voi khach va con
      // duoi ho di. Gio IM LANG voi khach + bao admin kem ly do de admin tra loi tay.
      const detail = err instanceof Error ? err.message : String(err);
      console.warn("[faq] classifier loi:", detail);
      this.escalateClassifierFailure(input, detail);
      return null;
    }

    const topics = topicIds
      .map((id) => FAQ_TOPICS.find((t) => t.id === id))
      .filter((t): t is FaqTopic => t !== undefined);

    if (topics.length === 0) {
      this.escalateToAdmin(input);
      return this.outOfScopeReply(input);
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
    this.notifyAdmin(
      `❓ [${input.platform}] ${input.userDisplayName} (${input.userId}) vừa hỏi câu bot không hiểu:\n` +
        `"${input.question}"`
    );
  }

  /**
   * Classifier LOI (khac han "khong nhan ra chu de") -> bot da im lang voi khach, nen admin la
   * nguoi DUY NHAT con co the tra loi ho: bat buoc phai bao, kem ca cau hoi lan ly do loi.
   * Tin nay CO Y khac han tin cua escalateToAdmin: admin doc 1 dong phai biet ngay day la bot LOI
   * (di sua API/han muc) chu khong phai khach hoi cau ngoai kich ban (di soan cau tra loi moi) -
   * co test chan viec dung chung cau cho 2 viec.
   * Danh doi da duoc user chap nhan 2026-10-01: API sap thi MOI tin DM sinh 1 thong bao cho admin.
   */
  private escalateClassifierFailure(input: FaqResolveInput, detail: string): void {
    this.notifyAdmin(
      `⚠️ [${input.platform}] Không đọc được câu hỏi của ${input.userDisplayName} (${input.userId}):\n` +
        `"${input.question}"\n` +
        `Lỗi: ${detail}\n` +
        `Bot đã im lặng với khách, cần trả lời tay.`
    );
  }

  /** Bao chu bot, best-effort - loi gui chi log (dung chung boi 2 nhanh escalate o tren). */
  private notifyAdmin(message: string): void {
    this.options.notifyAdmin(message).catch((err: unknown) => {
      console.warn("[faq] khong bao duoc admin:", err instanceof Error ? err.message : err);
    });
  }

  private answerFor(topic: FaqTopic, input: FaqResolveInput): string {
    const template = this.options.store.getSetting(faqAnswerKey(topic.id), topic.defaultAnswer);
    return this.render(template, input);
  }

  /**
   * Cau tra loi khi KHONG nhan ra chu de (2026-09-13, yeu cau truc tiep cua user) - thay im lang
   * hoan toan bang 1 cau co dinh bao user cho admin, tranh cam giac bot bi loi khong phan hoi gi.
   * Duoc goi TU resolve() SAU khi da qua het cac cua kiem tra mute/rate-limit, nen KHONG BAO GIO
   * chay khi thread dang bi khoa (admin dang go tay / lenh "/im") - dung y muon cua user.
   */
  private outOfScopeReply(input: FaqResolveInput): string {
    const template = this.options.store.getSetting(
      SETTINGS_KEYS.faqOutOfScopeReply,
      FAQ_OUT_OF_SCOPE_REPLY_DEFAULT
    );
    return this.render(template, input);
  }

  /** Dung chung boi answerFor va outOfScopeReply de khong lap code doc settings + goi renderTemplate. */
  private render(template: string, input: FaqResolveInput): string {
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
