import {
  Zalo,
  LoginQRCallbackEventType,
  ThreadType,
  GroupEventType,
  Reactions,
  type Message,
  type GroupEvent,
  type API,
  type TAttachmentContent,
} from "zca-js";
import { AppError } from "../../core/errors.js";
import type { LedgerStore } from "../../core/ledgerStore.js";
import { extractProductUrls } from "../../core/linkValidator.js";
import type { LinkResolverService } from "../../core/linkResolverService.js";
import type { MerchantId } from "../../core/merchants.js";
import type { FaqService } from "../../core/faq/faqService.js";
import { loadZaloCredentials, saveZaloCredentials } from "./session.js";
import { SentMessageTracker } from "./sentMessageTracker.js";
import {
  USAGE_TEXT,
  SUCCESS_REPLY_TEMPLATE_DEFAULT,
  WELCOME_MESSAGE_TEMPLATE_DEFAULT,
  GROUP_JOIN_WELCOME_TEMPLATE_DEFAULT,
  GROUP_JOIN_BLOCKED_REPLY_TEMPLATE_DEFAULT,
  FRIEND_REQUEST_MESSAGE_DEFAULT,
  DASHBOARD_LINK_REPLY_TEMPLATE_DEFAULT,
  formatSuccessReply,
  formatErrorReply,
  formatSkippedReply,
  formatPromotionsReply,
  formatDashboardLinkReply,
  formatWelcomeReply,
  formatGroupJoinWelcomeReply,
  formatGroupJoinBlockedGroupReply,
} from "../shared/replyText.js";

export interface ZaloGroupBotOptions {
  sessionPath: string;
  qrPath: string;
  maxLinksPerMessage: number;
  promotionsLimit: number;
  ledgerStore: LedgerStore;
  dashboardBaseUrl: string;
  /** Dung de dien vao DM chao mung user moi (formatWelcomeReply) - dong bo voi COMMISSION_USER_SHARE_PERCENT. */
  commissionUserSharePercent: number;
  /** Dung de dien vao DM chao mung user moi (formatWelcomeReply) - dong bo voi WITHDRAWAL_THRESHOLD_VND. */
  withdrawalThresholdVnd: number;
  /**
   * Tra loi cau hoi FAQ trong DM (2026-09-13). Khong truyen (vd FAQ_PROVIDER=off) thi bot IM LANG
   * voi moi DM khong phai "xemhh"/link san pham - dung hanh vi truoc 2026-09-13.
   */
  faqService?: FaqService;
}

/**
 * Adapter dieu khien 1 tai khoan Zalo ca nhan (qua thu vien khong chinh thuc zca-js)
 * de tra loi trong CAC GROUP ma tai khoan do la thanh vien - khong dung Zalo OA
 * chinh thuc (da bo scope nay, xem CLAUDE.md). Zalo cam ro hanh vi tu dong hoa tai
 * khoan ca nhan trong dieu khoan su dung - tai khoan co the bi khoa, nen dung tai
 * khoan phu/throwaway, khong dung tai khoan chinh.
 * T2.3 them lenh "xemhh" xu ly rieng trong tin nhan DM (ThreadType.User) - lan dau file
 * nay phan biet DM vs group, vi truoc gio chi tra loi giong het nhau ca 2 loai thread.
 */
/** Cho lan thu dang nhap lai khi listener bao "closed" ma khong phai do stop() chu dich. */
const RECONNECT_DELAY_MS = 10_000;

export class ZaloGroupBot {
  private api: API | null = null;
  private stopping = false;
  private reconnecting = false;
  /** Nho msgId bot vua gui de khong nham tin cua chinh minh voi tin admin go tay - xem handleSelfMessage. */
  private readonly sentTracker = new SentMessageTracker();

  constructor(
    private readonly resolver: LinkResolverService,
    private readonly options: ZaloGroupBotOptions
  ) {}

  async start(): Promise<void> {
    await this.connect();
  }

  /**
   * Dang nhap + gan listener - tach rieng khoi start() de goi lai duoc khi can reconnect
   * (xem registerListener, event "closed"). Moi lan goi tao API/Zalo instance MOI.
   */
  private async connect(): Promise<void> {
    // selfListen: true - mac dinh zca-js NUOT AM THAM moi group_event co isSelf=true, VA isSelf
    // dung true khong chi khi bot la nguoi DUOC add ma ca khi CHINH tai khoan bot la actor thuc
    // hien hanh dong (vd chu bot dung chinh tai khoan dang login cho bot de tu xoa/them thanh vien
    // - rat pho bien vi tai khoan bot cung la tai khoan Zalo ca nhan chu bot dung hang ngay). Neu
    // khong bat co nay, DM chao mung group-join se im lang tuyet doi trong dung truong hop test
    // thuc te nhat (phat hien 2026-09-07 tu bao cao that cua user, xem handleGroupEvent).
    const zalo = new Zalo({ selfListen: true });
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

    // Nap san danh sach group de admin tick duoc NGAY tren /admin/settings, khong phai cho den khi co
    // nguoi nhan tin trong group (xem maybeRegisterGroup). Best-effort: loi goi API chi log canh bao,
    // khong duoc lam that bai ca viec khoi dong bot.
    this.syncKnownGroups(this.api).catch((err: unknown) => {
      console.warn("[zalo] khong dong bo duoc danh sach group:", (err as Error).message);
    });
  }

  /**
   * Ghi nhan TOAN BO group bot dang la thanh vien vao bang zalo_groups (2026-09-11) - getAllGroups()
   * chi tra ve id (gridVerMap), phai goi getGroupInfo() cho ca danh sach de lay ten hien thi cho admin.
   * Chay 1 lan moi lan dang nhap (ke ca reconnect) - KHONG bat/tat notify cho group nao, lua chon do
   * thuoc ve admin va duoc giu nguyen qua cac lan dong bo (xem LedgerStore.upsertZaloGroup).
   */
  private async syncKnownGroups(api: API): Promise<void> {
    const all = await api.getAllGroups();
    const groupIds = Object.keys(all.gridVerMap ?? {});
    if (groupIds.length === 0) return;

    const info = await api.getGroupInfo(groupIds);
    for (const groupId of groupIds) {
      this.options.ledgerStore.upsertZaloGroup(groupId, info.gridInfoMap?.[groupId]?.name ?? "");
    }
    console.log(`[zalo] Da dong bo ${groupIds.length} group vao danh sach chon thong bao (/admin/settings).`);
  }

  /**
   * Bo sung 1 group vua thay tin nhan nhung chua co trong bang (vd bot duoc add vao group moi GIUA
   * luc dang chay, sau lan syncKnownGroups cua phien dang nhap nay). Chi goi getGroupInfo cho group
   * CHUA BIET - khong phai moi tin nhan (tranh 1 request mang/tin nhan). Neu lay ten that bai van ghi
   * nhan group voi ten rong: de khong thu lai o moi tin nhan tiep theo, ten se duoc dien o lan dong bo
   * ke tiep (upsertZaloGroup khong cho ten rong ghi de ten da biet).
   */
  private async maybeRegisterGroup(api: API, groupId: string): Promise<void> {
    if (this.options.ledgerStore.hasZaloGroup(groupId)) return;

    let name = "";
    try {
      const info = await api.getGroupInfo(groupId);
      name = info.gridInfoMap?.[groupId]?.name ?? "";
    } catch (err) {
      console.warn(`[zalo] khong lay duoc ten group ${groupId}:`, (err as Error).message);
    }
    this.options.ledgerStore.upsertZaloGroup(groupId, name);
  }

  /**
   * zca-js tu retry noi bo khi socket dong (event "disconnected", retryOnClose: true trong
   * connect()), nhung chi retry theo config PHIA SERVER Zalo tra ve (ctx.settings.features.socket) -
   * neu code dong khong nam trong danh sach duoc retry, hoac het retry-budget, no bo cuoc HAN va
   * bao "closed" - tu do ve sau khong con nhan tin nhan/group_event nao nua, im lang vinh vien
   * cho toi khi process duoc restart thu cong (phat hien tu su co that 2026-09-08: mat ket noi
   * ~24h khong ai biet vi khong co log loi ro rang nao khac). Bat buoc tu dang nhap lai o day.
   */
  private scheduleReconnect(): void {
    if (this.stopping || this.reconnecting) return;
    this.reconnecting = true;
    console.warn(`[zalo] Se thu dang nhap lai sau ${RECONNECT_DELAY_MS / 1000}s...`);
    setTimeout(() => {
      this.reconnecting = false;
      if (this.stopping) return;
      this.connect().catch((err: unknown) => {
        console.error("[zalo] Dang nhap lai that bai:", err);
        this.scheduleReconnect();
      });
    }, RECONNECT_DELAY_MS);
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
    api.listener.on("group_event", (event) => {
      console.log(`[zalo] Nhan group_event type=${event.type} isSelf=${event.isSelf} thread=${event.threadId}`);
      this.handleGroupEvent(api, event).catch((err: unknown) => {
        console.error("[zalo] Loi khong xu ly duoc khi xu ly group_event:", err);
      });
    });
    api.listener.on("error", (err) => {
      console.warn("[zalo] Loi tu listener:", err);
    });
    api.listener.on("closed", (code, reason) => {
      console.warn(`[zalo] Ket noi bi dong (code=${code}): ${reason}`);
      this.scheduleReconnect();
    });
    api.listener.on("disconnected", (code, reason) => {
      console.warn(`[zalo] Bi ngat ket noi (code=${code}): ${reason}`);
    });
  }

  private async handleMessage(api: API, message: Message): Promise<void> {
    if (message.isSelf) {
      await this.handleSelfMessage(message);
      return;
    }

    const text = extractMessageText(message.data.content);
    if (text === null) return;
    const userId = message.data.uidFrom;
    this.options.ledgerStore.upsertUserProfile("zalo", userId, message.data.dName ?? "");

    // T2.3: lenh "xemhh" chi hoat dong trong tin nhan rieng (DM), khong phai group - tranh
    // thanh vien khac trong group vo tinh kich hoat link ca nhan cua nguoi khac (link dashboard
    // se lo hoa hong/don hang ca nhan neu bot lo tra loi trong group).
    if (message.type === ThreadType.User) {
      if (text.trim().toLowerCase() === "xemhh") {
        const { token } = this.options.ledgerStore.findOrCreateDashboardToken("zalo", userId);
        const dashboardLinkTemplate = this.options.ledgerStore.getDashboardLinkReplyTemplate(
          DASHBOARD_LINK_REPLY_TEMPLATE_DEFAULT
        );
        await this.sendTrackedDirect(
          api,
          message.threadId,
          formatDashboardLinkReply(dashboardLinkTemplate, `${this.options.dashboardBaseUrl}/d/${token}`, userId)
        );
        return;
      }

      // 2026-09-10 (feedback that tu user cuoi): nhieu nguoi ngai gui link trong group vi so thanh
      // vien khac biet minh dang mua gi, nen DM gui link san pham cung duoc tra link hoan tien y
      // het trong group (dung chung processProductLinks). Khac group o DUY NHAT cach gui reply:
      // khong tag @ten, vi mention chi co y nghia trong group.
      const dmLinks = extractProductUrls(text);
      if (dmLinks.length === 0) {
        // Truoc 2026-09-13 nhanh nay IM LANG tuyet doi (quyet dinh goc 2026-08-17, tai khang dinh
        // 2026-08-21). Gio thu nhan dien cau hoi FAQ truoc - KHONG nhan ra chu de nao thi VAN im
        // lang y nhu cu (faqService.resolve tra null), nen hanh vi chi mo rong chu khong dao nguoc.
        await this.maybeAnswerFaq(api, message, text);
        return;
      }

      await this.maybeSendWelcomeMessage(api, userId);
      await this.processProductLinks(userId, dmLinks, (body) =>
        this.sendTrackedDirect(api, message.threadId, body)
      );
      return;
    }

    // Ghi nhan group nay vao danh sach chon thong bao (/admin/settings) - dat TRUOC nhanh "khong co
    // link" de group van duoc ghi nhan du tin nhan dau tien thay duoc khong phai link san pham.
    await this.maybeRegisterGroup(api, message.threadId);

    const links = extractProductUrls(text);

    if (links.length === 0) {
      await this.sendGroupReply(api, message, this.options.ledgerStore.getUsageText(USAGE_TEXT));
      return;
    }

    // 2026-09-24 (yeu cau truc tiep cua user): tha tim NGAY khi nhan ra co link san pham, TRUOC
    // khi goi API tao link - de user thay bot da nhan duoc tin trong luc cho. Co chu dich tha ca
    // khi link hoa ra khong tao duoc (vd Shopee Video): user da chap nhan doi lay phan hoi tuc thi.
    await this.reactHeart(api, message);

    // 2026-08-20 (yeu cau truc tiep cua user): DM chao mung LAN DAU user gui link san pham trong
    // group - best-effort, khong duoc lam gian doan viec xu ly link nghiep vu chinh du DM that bai
    // (vd user chan tin nhan tu nguoi la).
    await this.maybeSendWelcomeMessage(api, userId);
    await this.processProductLinks(userId, links, (body) => this.sendGroupReply(api, message, body));
  }

  /**
   * Duyet danh sach link san pham cua 1 tin nhan -> tao link affiliate -> gui reply, dung chung cho
   * CA group lan DM (2026-09-10). Diem khac nhau duy nhat giua 2 noi la cach gui reply, nen no duoc
   * truyen vao qua sendReply (group: kem mention @ten; DM: van ban thuan) thay vi nhan doi ca vong
   * lap nay - sua logic xu ly link o day la ap dung cho ca 2 luong.
   */
  private async processProductLinks(
    userId: string,
    links: string[],
    sendReply: (body: string) => Promise<void>
  ): Promise<void> {
    const linksToProcess = links.slice(0, this.options.maxLinksPerMessage);
    const skippedCount = links.length - linksToProcess.length;
    const successMerchants = new Set<MerchantId>();

    for (const rawUrl of linksToProcess) {
      try {
        const result = await this.resolver.resolve({ url: rawUrl, platform: "zalo", userId });
        successMerchants.add(result.merchant);
        const successTemplate = this.options.ledgerStore.getSuccessReplyTemplate(SUCCESS_REPLY_TEMPLATE_DEFAULT);
        await sendReply(
          formatSuccessReply(successTemplate, result.merchant, result.affiliateUrl, result.commissionEstimate)
        );
      } catch (err) {
        // AppError.message chua chi tiet chan doan (vd "Affiliate API error: HTTP 400: ...") con
        // userMessage chi la cau chung chung cho user - truoc 2026-09-02 chi tiet nay bi vut di
        // hoan toan, khien moi loi tao link deu phai trace tay lai tu dau. Luon log truoc khi tra loi.
        const detail = err instanceof Error ? err.message : String(err);
        const code = err instanceof AppError ? err.code : "UNKNOWN";
        console.warn(`[zalo] tao link that bai (${code}) cho ${rawUrl}: ${detail}`);
        const userMessage =
          err instanceof AppError ? err.userMessage : "Đã có lỗi không xác định, vui lòng thử lại sau.";
        await sendReply(formatErrorReply(userMessage));
      }
    }

    if (skippedCount > 0) {
      await sendReply(formatSkippedReply(linksToProcess.length, skippedCount));
    }

    if (this.options.promotionsLimit > 0) {
      for (const merchant of successMerchants) {
        try {
          const promotions = await this.resolver.getPromotions(merchant, this.options.promotionsLimit);
          if (promotions.length > 0) {
            await sendReply(formatPromotionsReply(merchant, promotions));
          }
        } catch (err) {
          console.warn(`[zalo] khong lay duoc danh sach khuyen mai (${merchant}):`, (err as Error).message);
        }
      }
    }
  }

  /**
   * Gui reply trong GROUP kem tag @dName nguoi gui o dau tin nhan - phan-hoi truc tiep cua user
   * (2026-08-20): nhieu nguoi gui link cung luc trong group thi khong biet bot dang tra loi ai.
   * Dung Mention cua zca-js (tappable, khong phai chi la text "@ten") thay vi ghep chuoi thuong.
   * Fallback ve gui van ban thuong (khong mention) neu Zalo profile khong co dName (hiem, tranh
   * hien thi "@ " truoc noi dung).
   */
  /**
   * Gui DM va GHI NHAN msgId - bat buoc dung cho MOI tin bot gui trong DM. Gui thang qua
   * api.sendMessage ma quen ghi nhan se lam bot tuong do la tin admin go tay roi TU KHOA CHINH MINH.
   */
  private async sendTrackedDirect(api: API, threadId: string, body: string): Promise<void> {
    const result = (await api.sendMessage(body, threadId, ThreadType.User)) as
      | { message?: { msgId?: number } | null }
      | undefined;
    this.sentTracker.record(result?.message?.msgId, body);
  }

  /**
   * Tin do CHINH tai khoan bot gui ra (selfListen=true moi thay duoc - xem start()). Hai nguon: bot
   * tu gui, hoac CHU BOT mo Zalo go tay tra loi user. Nguon thu 2 la tin hieu "admin dang tu van,
   * bot im di" - day la lop chong chen ngang chinh, admin khong phai nho lenh gi ca.
   *
   * CHI xu ly DM: trong group bo qua nhu cu, neu khong bot se tu khoa minh moi lan tra link.
   */
  private async handleSelfMessage(message: Message): Promise<void> {
    if (message.type !== ThreadType.User) return;
    const faqService = this.options.faqService;
    if (faqService === undefined) return;

    const text = extractMessageText(message.data.content);
    if (text === null) return;

    const msgId = message.data.msgId === undefined ? "" : String(message.data.msgId);
    if (this.sentTracker.isOwn(msgId, text)) return;

    const threadId = message.threadId;
    const command = text.trim().toLowerCase();
    if (command === "/im") {
      faqService.muteByAdminCommand("zalo", threadId);
      return;
    }
    if (command === "/noi") {
      faqService.unmute("zalo", threadId);
      return;
    }
    faqService.muteByAdminTyping("zalo", threadId);
  }

  /** Cau hoi trong DM khong phai "xemhh" va khong chua link - tra loi FAQ neu nhan ra chu de. */
  private async maybeAnswerFaq(api: API, message: Message, text: string): Promise<void> {
    const faqService = this.options.faqService;
    if (faqService === undefined) return;

    const userId = message.data.uidFrom;
    const { token } = this.options.ledgerStore.findOrCreateDashboardToken("zalo", userId);
    const answer = await faqService.resolve({
      platform: "zalo",
      userId,
      threadId: message.threadId,
      question: text,
      userDisplayName: message.data.dName ?? "",
      dashboardUrl: `${this.options.dashboardBaseUrl}/d/${token}`,
    });
    if (answer === null) return;
    await this.sendTrackedDirect(api, message.threadId, answer);
  }

  /**
   * Tha tim len chinh tin nhan user vua gui trong group (2026-09-24). Reaction ve qua listener
   * event "reaction" rieng, KHONG phai event "message", nen tim bot tu tha khong bi handleSelfMessage
   * hieu nham la admin go tay roi tu khoa FAQ (xem CLAUDE.md cua thu muc nay).
   * Best-effort: that bai chi log, tuyet doi khong chan viec tra link.
   */
  private async reactHeart(api: API, message: Message): Promise<void> {
    try {
      await api.addReaction(Reactions.HEART, {
        data: { msgId: message.data.msgId, cliMsgId: message.data.cliMsgId },
        threadId: message.threadId,
        type: message.type,
      });
    } catch (err) {
      console.warn(`[zalo] tha tim tin nhan ${message.data.msgId} that bai:`, (err as Error).message);
    }
  }

  private async sendGroupReply(api: API, message: Message, body: string): Promise<void> {
    const dName = message.data.dName?.trim();
    if (!dName) {
      await api.sendMessage(body, message.threadId, message.type);
      return;
    }
    const mentionLabel = `@${dName} `;
    await api.sendMessage(
      {
        msg: `${mentionLabel}${body}`,
        mentions: [{ pos: 0, uid: message.data.uidFrom, len: mentionLabel.length - 1 }],
      },
      message.threadId,
      message.type
    );
  }

  /**
   * DM chao mung 1 LAN DUY NHAT toi user vua gui link san pham DAU TIEN trong group (2026-08-20,
   * yeu cau truc tiep cua user). LedgerStore.tryClaimWelcomeMessage() dam bao chi lan goi DAU
   * TIEN moi thuc su gui (INSERT unique, an toan voi race) - cac lan sau (userId da co trong bang
   * welcome_messages) khong lam gi ca, khong gui lai. Best-effort: loi gui (vd user chan tin nhan
   * tu nguoi la) chi log canh bao, KHONG throw len tren de khong lam gian doan xu ly link chinh.
   */
  private async maybeSendWelcomeMessage(api: API, userId: string): Promise<void> {
    const isFirstTime = this.options.ledgerStore.tryClaimWelcomeMessage("zalo", userId);
    if (!isFirstTime) return;

    try {
      const welcomeTemplate = this.options.ledgerStore.getWelcomeMessageTemplate(WELCOME_MESSAGE_TEMPLATE_DEFAULT);
      const userSharePercent = this.options.ledgerStore.getUserSharePercent(this.options.commissionUserSharePercent);
      const withdrawalThresholdVnd = this.options.ledgerStore.getWithdrawalThresholdVnd(
        this.options.withdrawalThresholdVnd
      );
      const { token } = this.options.ledgerStore.findOrCreateDashboardToken("zalo", userId);
      const dashboardUrl = `${this.options.dashboardBaseUrl}/d/${token}`;
      await this.sendTrackedDirect(
        api,
        userId,
        formatWelcomeReply(welcomeTemplate, userSharePercent, withdrawalThresholdVnd, dashboardUrl)
      );
    } catch (err) {
      console.warn(`[zalo] gui DM chao mung toi ${userId} that bai:`, (err as Error).message);
    }
  }

  /**
   * Xu ly event "group_event" cua zca-js - hien CHI quan tam loai JOIN (co thanh vien moi duoc them
   * vao group). KHONG dung event.isSelf de loc bo ca event - field nay dung true khong chi khi bot
   * la nguoi DUOC add, ma CA KHI chinh tai khoan bot la actor thuc hien hanh dong add/xoa (rat pho
   * bien: chu bot dung chinh tai khoan dang login cho bot de tu quan ly group) - loc theo isSelf se
   * bo sot dung truong hop nay (phat hien 2026-09-07 tu test that cua user, xem selfListen o start()).
   * Thay vao do, tu loc TUNG PHAN TU trong updateMembers trung uid cua chinh bot (qua api.getOwnId(),
   * dong bo - khong phai Promise) - chi bo qua dung phan tu do, khong bo qua ca event.
   */
  private async handleGroupEvent(api: API, event: GroupEvent): Promise<void> {
    if (event.type !== GroupEventType.JOIN) return;

    const ownUid = api.getOwnId();
    for (const member of event.data.updateMembers) {
      if (member.id === ownUid) continue;
      await this.maybeSendGroupJoinWelcome(api, member.id, member.dName ?? "", event.threadId);
    }
  }

  /**
   * DM chao mung 1 LAN DUY NHAT NGAY LUC user vua duoc ADD vao group (2026-09-07, yeu cau truc tiep
   * cua user - truoc do phai doi user tu gui link san pham dau tien moi co DM chao, khien user moi
   * khong biet cach dung phai nhan tin hoi admin). tryClaimGroupJoinMessage dam bao chi gui 1 lan/
   * user (bang RIENG voi welcome_messages, xem ledgerStore.ts). Best-effort giong maybeSendWelcomeMessage
   * o tren: loi gui (vd user chan tin nhan tu nguoi la) chi log canh bao, khong throw len tren.
   */
  private async maybeSendGroupJoinWelcome(
    api: API,
    userId: string,
    displayName: string,
    groupId: string
  ): Promise<void> {
    const isFirstTime = this.options.ledgerStore.tryClaimGroupJoinMessage("zalo", userId);
    if (!isFirstTime) return;

    try {
      const template = this.options.ledgerStore.getGroupJoinWelcomeTemplate(GROUP_JOIN_WELCOME_TEMPLATE_DEFAULT);
      await this.sendTrackedDirect(api, userId, formatGroupJoinWelcomeReply(template));
    } catch (err) {
      const detail = (err as Error).message;
      // code cua ZaloApiError (neu co) - hien chua biet ma so that cua loi "chan nguoi la" nen van
      // phai nhan dien bang text, log them code de sau nay siet lai theo ma so cho chac.
      const code = (err as { code?: number | null }).code ?? "";
      console.warn(`[zalo] gui DM chao mung (group join) toi ${userId} that bai (code=${code}):`, detail);
      if (isStrangerBlockedError(detail)) {
        await this.greetBlockedUserInGroup(api, userId, displayName, groupId);
      }
    }
  }

  /**
   * User bat "khong nhan tin nhan tu nguoi la" nen DM chao mung o tren bi Zalo tu choi (2026-09-24,
   * yeu cau truc tiep cua user sau su co that - rat nhieu nguoi bat cai dat nay). Chao bu ngay
   * trong group kem tag @ten, va gui LUON loi moi ket ban: ket ban la cach duy nhat de ve sau bot
   * DM bao don hang cho ho duoc.
   * CHI chay khi dung loi bi chan - loi khac (mang/timeout) giu nguyen hanh vi cu la im lang, vi
   * noi "ban dang chan tin nhan cua em" khi that ra la loi mang thi con te hon khong noi gi.
   * Ca 2 buoc deu best-effort, loi chi log - day la nhanh phu, khong duoc lam hong gi them.
   */
  private async greetBlockedUserInGroup(
    api: API,
    userId: string,
    displayName: string,
    groupId: string
  ): Promise<void> {
    try {
      const friendRequestMessage = this.options.ledgerStore.getFriendRequestMessage(FRIEND_REQUEST_MESSAGE_DEFAULT);
      await api.sendFriendRequest(friendRequestMessage, userId);
    } catch (err) {
      console.warn(`[zalo] gui loi moi ket ban toi ${userId} that bai:`, (err as Error).message);
    }

    try {
      const template = this.options.ledgerStore.getGroupJoinBlockedReplyTemplate(
        GROUP_JOIN_BLOCKED_REPLY_TEMPLATE_DEFAULT
      );
      const name = displayName.trim();
      // Khong co dName (hiem) -> gui van ban thuan, khong tag: tranh hien thi "@" tro tren.
      if (name === "") {
        await api.sendMessage(formatGroupJoinBlockedGroupReply(template, "bạn"), groupId, ThreadType.Group);
        return;
      }
      const mentionLabel = `@${name}`;
      const body = formatGroupJoinBlockedGroupReply(template, mentionLabel);
      await api.sendMessage(
        { msg: body, mentions: [{ pos: body.indexOf(mentionLabel), uid: userId, len: mentionLabel.length }] },
        groupId,
        ThreadType.Group
      );
    } catch (err) {
      console.warn(`[zalo] chao bu trong group ${groupId} cho ${userId} that bai:`, (err as Error).message);
    }
  }

  /**
   * Gui tin nhan DM chu dong toi 1 userId (khong phai tra loi 1 message nhan duoc) - dung boi
   * notifyUser trong index.ts de bao user khi don duoc admin ghi nhan (phan-hoi-cai-thien-trai-nghiem-nguoi-dung.md
   * muc 1). Nem loi neu chua dang nhap (this.api null) - goi noi dung tu bat try/catch.
   */
  async sendDirectMessage(userId: string, message: string): Promise<void> {
    if (!this.api) {
      throw new Error("Zalo bot chua dang nhap, khong the gui tin nhan.");
    }
    await this.sendTrackedDirect(this.api, userId, message);
  }

  /**
   * Gui 1 tin nhan chu dong vao GROUP (2026-09-11) - dung boi route POST /admin/record-orders/shopee-report
   * (qua notifyZaloGroup trong index.ts) de bao ca group biet don hang vua duoc cap nhat. Khong kem
   * mention ai: day la thong bao chung cho ca group, khong phai tra loi 1 nguoi (khac sendGroupReply).
   * Nem loi neu chua dang nhap - noi goi tu bat (.catch) de khong lam fail request cua admin.
   */
  async sendGroupMessage(groupId: string, message: string): Promise<void> {
    if (!this.api) {
      throw new Error("Zalo bot chua dang nhap, khong the gui tin nhan.");
    }
    await this.api.sendMessage(message, groupId, ThreadType.Group);
  }

  stop(): void {
    this.stopping = true;
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

/**
 * Zalo tu choi DM vi nguoi nhan bat "khong nhan tin nhan tu nguoi la" - thong bao that quan sat
 * duoc (2026-09-24): "Bạn chưa thể gửi tin nhắn đến người này vì người này chặn không nhận tin
 * nhắn từ người lạ.". ZaloApiError co mang theo `code` so nhung chua biet ma so cua rieng loi nay
 * (log cu chi in message), nen tam nhan dien bang text - doi lay duoc ma so that thi siet lai.
 * Chi bat dung cum "nguoi la": cum "chan" khong thoi con trung ca case user chan han bot, luc do
 * gui loi moi ket ban chi la lam phien.
 */
function isStrangerBlockedError(message: string): boolean {
  return message.normalize("NFC").toLowerCase().includes("người lạ");
}

export function createZaloGroupBot(resolver: LinkResolverService, options: ZaloGroupBotOptions): ZaloGroupBot {
  return new ZaloGroupBot(resolver, options);
}
