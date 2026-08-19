import { Zalo, LoginQRCallbackEventType, ThreadType, type Message, type API, type TAttachmentContent } from "zca-js";
import { AppError } from "../../core/errors.js";
import type { LedgerStore } from "../../core/ledgerStore.js";
import { extractProductUrls } from "../../core/linkValidator.js";
import type { LinkResolverService } from "../../core/linkResolverService.js";
import type { MerchantId } from "../../core/merchants.js";
import { loadZaloCredentials, saveZaloCredentials } from "./session.js";
import {
  USAGE_TEXT,
  formatSuccessReply,
  formatErrorReply,
  formatSkippedReply,
  formatPromotionsReply,
  formatDashboardLinkReply,
} from "../shared/replyText.js";

export interface ZaloGroupBotOptions {
  sessionPath: string;
  qrPath: string;
  maxLinksPerMessage: number;
  promotionsLimit: number;
  ledgerStore: LedgerStore;
  dashboardBaseUrl: string;
}

/**
 * Adapter dieu khien 1 tai khoan Zalo ca nhan (qua thu vien khong chinh thuc zca-js)
 * de tra loi trong CAC GROUP ma tai khoan do la thanh vien - khong dung Zalo OA
 * chinh thuc (da bo scope nay, xem CLAUDE.md). Zalo cam ro hanh vi tu dong hoa tai
 * khoan ca nhan trong dieu khoan su dung - tai khoan co the bi khoa, nen dung tai
 * khoan phu/throwaway, khong dung tai khoan chinh.
 * T2.3 them lenh "idid" xu ly rieng trong tin nhan DM (ThreadType.User) - lan dau file
 * nay phan biet DM vs group, vi truoc gio chi tra loi giong het nhau ca 2 loai thread.
 */
export class ZaloGroupBot {
  private api: API | null = null;

  constructor(
    private readonly resolver: LinkResolverService,
    private readonly options: ZaloGroupBotOptions
  ) {}

  async start(): Promise<void> {
    const zalo = new Zalo();
    const saved = loadZaloCredentials(this.options.sessionPath);

    if (saved) {
      try {
        this.api = await zalo.login(saved);
        console.log("[zalo] Dang nhap thanh cong bang session da luu.");
      } catch (err) {
        console.warn(
          "[zalo] Session da luu khong con hop le, can dang nhap lai qua QR:",
          (err as Error).message
        );
        this.api = null;
      }
    }

    if (!this.api) {
      this.api = await this.loginWithQr(zalo);
    }

    this.registerListener(this.api);
    this.api.listener.start({ retryOnClose: true });
  }

  private async loginWithQr(zalo: Zalo): Promise<API> {
    console.log("[zalo] Chua co session hop le - can dang nhap qua QR.");
    return zalo.loginQR({}, (event) => {
      switch (event.type) {
        case LoginQRCallbackEventType.QRCodeGenerated:
          event.actions
            .saveToFile(this.options.qrPath)
            .then(() =>
              console.log(
                `[zalo] Da luu QR code tai ${this.options.qrPath} - mo anh nay va quet bang tai khoan Zalo dung cho bot.`
              )
            )
            .catch((err: unknown) => console.warn("[zalo] Khong the luu QR ra file:", err));
          break;
        case LoginQRCallbackEventType.QRCodeScanned:
          console.log(`[zalo] QR da duoc quet boi: ${event.data.display_name}`);
          break;
        case LoginQRCallbackEventType.QRCodeExpired:
          console.warn("[zalo] QR code het han, dang tao lai...");
          event.actions.retry();
          break;
        case LoginQRCallbackEventType.QRCodeDeclined:
          console.warn("[zalo] Dang nhap QR bi tu choi tren dien thoai.");
          break;
        case LoginQRCallbackEventType.GotLoginInfo:
          saveZaloCredentials(this.options.sessionPath, {
            imei: event.data.imei,
            cookie: event.data.cookie,
            userAgent: event.data.userAgent,
          });
          console.log(
            `[zalo] Da luu session vao ${this.options.sessionPath} - lan khoi dong sau se khong can quet QR nua.`
          );
          break;
      }
    });
  }

  private registerListener(api: API): void {
    api.listener.on("connected", () => {
      console.log("[zalo] Listener da ket noi WebSocket thanh cong.");
    });
    api.listener.on("message", (message) => {
      console.log(`[zalo] Nhan tin nhan tu ${message.data.uidFrom} (thread=${message.threadId}, type=${message.type})`);
      this.handleMessage(api, message).catch((err: unknown) => {
        console.error("[zalo] Loi khong xu ly duoc khi xu ly tin nhan:", err);
      });
    });
    api.listener.on("error", (err) => {
      console.warn("[zalo] Loi tu listener:", err);
    });
    api.listener.on("closed", (code, reason) => {
      console.warn(`[zalo] Ket noi bi dong (code=${code}): ${reason}`);
    });
    api.listener.on("disconnected", (code, reason) => {
      console.warn(`[zalo] Bi ngat ket noi (code=${code}): ${reason}`);
    });
  }

  private async handleMessage(api: API, message: Message): Promise<void> {
    if (message.isSelf) return;

    const text = extractMessageText(message.data.content);
    if (text === null) return;
    const userId = message.data.uidFrom;
    this.options.ledgerStore.upsertUserProfile("zalo", userId, message.data.dName ?? "");

    // T2.3: lenh "idid" chi hoat dong trong tin nhan rieng (DM), khong phai group - tranh
    // thanh vien khac trong group vo tinh kich hoat link ca nhan cua nguoi khac (link dashboard
    // se lo hoa hong/don hang ca nhan neu bot lo tra loi trong group).
    if (message.type === ThreadType.User) {
      if (text.trim().toLowerCase() === "idid") {
        const { token } = this.options.ledgerStore.findOrCreateDashboardToken("zalo", userId);
        await api.sendMessage(
          formatDashboardLinkReply(`${this.options.dashboardBaseUrl}/d/${token}`, userId),
          message.threadId,
          message.type
        );
      }
      // Tin nhan rieng (DM) voi noi dung khac "idid" (vd link san pham, cau hoi...): bot CHU Y
      // IM LANG, khong tu dong xu ly hay tra loi gi - de admin tu vao tra loi thu cong. Day la
      // quyet dinh co chu dich (2026-08-17), khac voi group (van xu ly link nhu binh thuong ben duoi).
      return;
    }

    const links = extractProductUrls(text);

    if (links.length === 0) {
      await api.sendMessage(USAGE_TEXT, message.threadId, message.type);
      return;
    }

    const linksToProcess = links.slice(0, this.options.maxLinksPerMessage);
    const skippedCount = links.length - linksToProcess.length;
    const successMerchants = new Set<MerchantId>();

    for (const rawUrl of linksToProcess) {
      try {
        const result = await this.resolver.resolve({ url: rawUrl, platform: "zalo", userId });
        successMerchants.add(result.merchant);
        await api.sendMessage(
          formatSuccessReply(result.merchant, result.affiliateUrl, result.commissionEstimate),
          message.threadId,
          message.type
        );
      } catch (err) {
        const userMessage =
          err instanceof AppError ? err.userMessage : "Đã có lỗi không xác định, vui lòng thử lại sau.";
        await api.sendMessage(formatErrorReply(userMessage), message.threadId, message.type);
      }
    }

    if (skippedCount > 0) {
      await api.sendMessage(
        formatSkippedReply(linksToProcess.length, skippedCount),
        message.threadId,
        message.type
      );
    }

    if (this.options.promotionsLimit > 0) {
      for (const merchant of successMerchants) {
        try {
          const promotions = await this.resolver.getPromotions(merchant, this.options.promotionsLimit);
          if (promotions.length > 0) {
            await api.sendMessage(formatPromotionsReply(merchant, promotions), message.threadId, message.type);
          }
        } catch (err) {
          console.warn(`[zalo] khong lay duoc danh sach khuyen mai (${merchant}):`, (err as Error).message);
        }
      }
    }
  }

  stop(): void {
    this.api?.listener.stop();
  }
}

/**
 * message.data.content la string CHI KHI tin nhan la text thuan - neu nguoi gui de Zalo tu dong
 * tao link preview (mac dinh khi dan URL, tru khi tat preview tay), content tro thanh object
 * TAttachmentContent voi URL that nam o field href, khong phai string nua. Truoc day code chi
 * check `typeof content === "string"` nen IM LANG voi moi tin nhan co preview - tuc la voi da so
 * cach user thuong gui link (phat hien 2026-08-19, xem rui-ro-can-giai-quyet.md).
 */
function extractMessageText(content: string | TAttachmentContent | Record<string, unknown>): string | null {
  if (typeof content === "string") return content;
  if (typeof content === "object" && content !== null && typeof (content as TAttachmentContent).href === "string") {
    return (content as TAttachmentContent).href;
  }
  return null;
}

export function createZaloGroupBot(resolver: LinkResolverService, options: ZaloGroupBotOptions): ZaloGroupBot {
  return new ZaloGroupBot(resolver, options);
}
