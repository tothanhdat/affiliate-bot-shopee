import express, { type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { computeDashboardStats, parseDashboardRange } from "../core/dashboardStats.js";
import {
  adminShell,
  ORDERS_PAGE_SIZE,
  renderAdminLoginPage,
  renderEditCommissionPage,
  renderOrdersPage,
  renderRecordOrdersPage,
  renderReverseConfirmPage,
  renderSettingsPage,
  renderUserCommissionPage,
  renderUsersPage,
  renderWithdrawalsPage,
  type OrdersFilters,
} from "./adminHtml.js";
import { renderAdminDashboardPage } from "./adminDashboardHtml.js";
import { renderDashboardPage, renderInvalidTokenPage } from "./dashboardHtml.js";
import { renderHandbookPage } from "./handbookHtml.js";
import { LINKS_PAGE_SIZE, renderLinksPage } from "./adminLinksHtml.js";
import type { AdminSessionStore } from "../core/adminAuth.js";
import { AppError, EntryNotPendingError } from "../core/errors.js";
import { effectivePercents, type LedgerStore } from "../core/ledgerStore.js";
import { computeCommissionBreakdown } from "../core/commissionMath.js";
import type { LinkResolverService } from "../core/linkResolverService.js";
import type { CreatedLinkFilters, LogStore } from "../core/logStore.js";
import { MERCHANTS, type MerchantId } from "../core/merchants.js";
import {
  recordSingleOrder,
  type RecordOrderConfig,
  type RecordableOrderStatus,
} from "../core/orderIngest.js";
import type { RateLimiter } from "../core/rateLimiter.js";
import { importShopeeReport, type ShopeeReportImportResult } from "../core/shopeeReportImport.js";
import type { CommissionStatus, Platform, RequestOutcome } from "../core/types.js";
import type { NotifyUser } from "../core/notification.js";
import { buildOrdersConfirmedNotification } from "../core/orderImage/ordersConfirmedNotification.js";
import {
  formatGroupReportUpdatedReply,
  formatOrdersConfirmedReply,
  formatPayoutDebtNotice,
  formatWithdrawalCancelledReply,
  formatWithdrawalDebtSettledReply,
  formatWithdrawalPaidReply,
  formatWithdrawalRequestedReply,
  GROUP_REPORT_UPDATED_TEMPLATE_DEFAULT,
  ORDERS_CONFIRMED_TEMPLATE_DEFAULT,
  ORDERS_CONFIRMED_CAPTION_TEMPLATE_DEFAULT,
  formatOrdersConfirmedCaption,
  PAYOUT_DEBT_NOTICE_TEMPLATE_DEFAULT,
  WITHDRAWAL_CANCELLED_TEMPLATE_DEFAULT,
  WITHDRAWAL_PAID_TEMPLATE_DEFAULT,
  WITHDRAWAL_REQUESTED_TEMPLATE_DEFAULT,
} from "../adapters/shared/replyText.js";
import { SETTINGS_REGISTRY } from "../config/settingsRegistry.js";
import { normalizeNewlines } from "../core/textNormalize.js";
import { formatVnDateDdMm, todayVnIso, yesterdayVnDdMm } from "../core/vietnamDate.js";
import { formatVnd } from "../core/money.js";

const VALID_PLATFORMS: Platform[] = ["telegram", "zalo", "http"];
const VALID_MERCHANTS: MerchantId[] = MERCHANTS.map((m) => m.id);
const VALID_STATUSES: CommissionStatus[] = ["pending", "confirmed", "paid", "reversed"];
const ADMIN_SESSION_COOKIE = "admin_session";

/**
 * Doc bo loc trang thai tu query /admin/orders. Form dung checkbox nen Express tra ve string khi tick
 * 1 o va MANG khi tick nhieu o - phai nhan ca 2 dang. Gia tri la/trung lap bi loai bo (query do nguoi
 * dung go tay), mang rong = khong loc.
 */
function parseStatusFilter(raw: unknown): CommissionStatus[] {
  const values = Array.isArray(raw) ? raw : [raw];
  const valid = values.filter(
    (v): v is CommissionStatus => typeof v === "string" && VALID_STATUSES.includes(v as CommissionStatus)
  );
  return [...new Set(valid)];
}

/** So trang tu query: chi nhan so nguyen duong, moi gia tri khac (rac, 0, am, so le) ve trang 1. */
/**
 * Doc 1 tham so ngay "YYYY-MM-DD" tu query string. Tra `undefined` cho moi gia tri khong dung dinh
 * dang HOAC khong phai ngay co that ("2026-13-99") - day la chuoi admin go tay duoc, bo qua mot bo
 * loc sai van tot hon la loc ra bang rong roi de ho tuong he thong mat du lieu.
 */
function parseIsoDateParam(value: unknown): string | undefined {
  // Nhan "YYYY-MM-DD" (link cu / go tay) hoac "YYYY-MM-DDTHH:mm" (o datetime-local, 2026-10-10).
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(value)) return undefined;
  const parsed = new Date(`${value.length === 10 ? `${value}T00:00` : value}:00.000Z`);
  // Date() tu "cuon" ngay/gio khong co that (31/02 -> 03/03, 25:00 -> 01:00 hom sau) nen phai doi
  // chieu lai chinh chuoi goc.
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, value.length) === value ? value : undefined;
}

function parsePageParam(raw: unknown): number {
  if (typeof raw !== "string") return 1;
  const page = Number(raw);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** Doc tay tu header Cookie - khong them dependency cookie-parser chi de doc 1 cookie. */
function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key) result[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return result;
}

// 5MB la du rong rai cho file CSV doi soat hang tuan (vai tram dong), khong can lon hon.
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// 5MB du cho 1 anh chup man hinh chuyen khoan. Chi nhan image/* - fileFilter goi next(err) neu sai
// loai, roi loi nay roi xuong error handler chung o cuoi file (giong cach csvUpload dang xu ly).
const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("File dinh kem phai la anh (jpg/png/webp...)."));
      return;
    }
    cb(null, true);
  },
});

/**
 * Thu muc chua CSS da build cua khu /admin (src/api/styles/admin.css -> public/admin.css).
 *
 * Duong dan tinh theo cwd, giong cach `./data/...` cua env.ts - app luon duoc chay tu goc repo
 * (`npm run dev`, `npm start`, va Railway cung dat cwd o goc). KHONG tinh theo import.meta.url vi
 * ban TS chay tai src/api/ con ban build chay tai dist/api/, hai cho cach `public/` khac nhau.
 *
 * File nay la san pham build nen KHONG co trong git (xem .gitignore) - thieu no thi moi trang
 * /admin hien ra tran trui, vi vay co canh bao luc khoi dong trong createServer().
 */
const adminAssetsDir = resolve(process.cwd(), "public");

export function createServer(
  resolver: LinkResolverService,
  logStore: LogStore,
  ledgerStore: LedgerStore,
  notifyAdmin: (message: string) => Promise<void>,
  withdrawalThresholdVnd: number,
  adminSessionStore: AdminSessionStore,
  orderConfig: RecordOrderConfig,
  withdrawalProofDir: string,
  adminLoginRateLimiter: RateLimiter,
  dashboardBaseUrl: string,
  notifyUser: NotifyUser,
  /**
   * Gui 1 tin nhan vao 1 GROUP Zalo (2026-09-11) - khac notifyUser (DM cho 1 user cuoi). Do index.ts
   * truyen vao, tro vao ZaloGroupBot.sendGroupMessage(). undefined khi ZALO_GROUP_ENABLED=false (hoac
   * trong test khong quan tam) - route import bao cao bo qua buoc thong bao group, khong loi.
   */
  notifyZaloGroup?: (groupId: string, message: string) => Promise<void>,
  /**
   * Co ORDER_IMAGE_ENABLED (2026-10-05). Tat thi 2 nhanh bao don confirmed quay ve gui tin van
   * ban thuan nhu truoc. Mac dinh true de cac cho goi cu (test) khong phai sua.
   */
  orderImageEnabled = true,
  /**
   * Lay danh sach thanh vien cua 1 group Zalo vua duoc admin tick (2026-10-09) - do index.ts truyen
   * vao, tro vao ZaloGroupBot.syncGroupMembers(). undefined khi ZALO_GROUP_ENABLED=false: luc do
   * khong co bot nao de hoi, roster se duoc dong bo o lan dang nhap ke tiep.
   */
  syncZaloGroupMembers?: (groupId: string) => Promise<void>
) {
  const app = express();
  // Can de doc dung IP that cua client tu header X-Forwarded-For - Railway (va da so PaaS) dat app
  // sau 1 reverse proxy, khong bat cai nay thi req.ip luon la IP noi bo cua proxy, rate limit theo
  // IP se vo nghia (moi client bi gop chung 1 "IP").
  //
  // BAO MAT (2026-09-13): dat = SO HOP proxy (1 = chi Railway proxy), KHONG dat = true. Voi "true"
  // Express tin TOAN BO chuoi X-Forwarded-For va lay entry TRAI NHAT lam req.ip - ma entry do do
  // CLIENT tu dat, nen ke tan cong doi header moi request de vuot rate-limit login (da chung minh:
  // 50 lan doan mat khau, 0 lan bi chan). Voi "1", Express chi tin 1 hop cuoi (Railway proxy) va
  // dung dung IP client ma proxy that ghi lai, bo qua header gia cua client. Neu sau nay dat them
  // proxy phia truoc (vd Cloudflare -> Railway = 2 hop), tang so nay len cho khop so tang proxy.
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
    const cookies = parseCookies(req.headers.cookie);
    if (!adminSessionStore.isValid(cookies[ADMIN_SESSION_COOKIE])) {
      res.redirect(303, "/admin/login");
      return;
    }
    next();
  }

  /**
   * Badge "co bao nhieu yeu cau rut dang cho" tren muc nav cua MOI trang /admin (2026-10-04).
   *
   * Doc lai o tung request chu khong cache: day la con so duy nhat trong nav mang nghia "co viec
   * phai lam ngay", hien so cu la te hon khong hien. Truy van dem tren bang nho (withdrawal_requests
   * dang cho) nen chi phi khong dang ke.
   */
  function navPendingWithdrawals(): number {
    return ledgerStore.listPendingWithdrawals().length;
  }

  /**
   * CSS cua khu /admin, sinh boi `npm run build:css` tu src/api/styles/admin.css.
   *
   * Cache DAI + immutable an toan vi duong dan trong HTML mang "van" theo mtime cua file (xem
   * adminAssets.ts): deploy moi -> URL moi -> trinh duyet tai lai. Khong co van thi sau moi lan
   * deploy admin se dung CSS cu cho den khi cache het han.
   * File NAY la san pham build nen khong co trong git - thieu no thi moi trang /admin hien ra tran
   * trui. Vi vay co canh bao luc khoi dong ben duoi, va `npm run build`/`npm run dev` da chay
   * build:css truoc.
   */
  if (!existsSync(join(adminAssetsDir, "admin.css"))) {
    console.warn(
      `[admin] Khong thay ${join(adminAssetsDir, "admin.css")} - cac trang /admin se hien ra tran trui. ` +
        `Chay "npm run build:css" de sinh lai.`
    );
  }
  app.use("/admin/assets", express.static(adminAssetsDir, { fallthrough: false, maxAge: "1y", immutable: true }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // T3.2: rut gon link an_redir tu build (ShopeeAffiliateProvider). QUAN TRONG: PHAI la 302
  // redirect THAT sang target_url (res.redirect), KHONG duoc fetch/proxy noi dung trang dich roi
  // tra ve - proxy se lam mat toan bo cookie/uls_trackid Shopee tu sinh phia ho khi trinh duyet
  // that cua user tu nhay tiep, pha tracking hoa hong. Code khong ton tai -> 404 HTML don gian,
  // khong redirect ve dau (tranh open-redirect toi 1 URL mac dinh khong ro rang).
  app.get("/s/:code", (req: Request, res: Response) => {
    const targetUrl = logStore.resolveShortLink(req.params.code);
    if (!targetUrl) {
      res.status(404).type("html").send("Không tìm thấy link.");
      return;
    }
    res.redirect(302, targetUrl);
  });

  // T1.1 acceptance: POST link Shopee hop le -> short link; link khong hop le -> loi ro rang, khong crash.
  app.post("/api/v1/resolve", async (req: Request, res: Response) => {
    const { url, platform, userId } = req.body ?? {};

    if (typeof url !== "string" || url.trim() === "") {
      res.status(400).json({ success: false, error: { code: "INVALID_LINK", message: "Thieu truong 'url'." } });
      return;
    }
    const resolvedPlatform: Platform =
      typeof platform === "string" && VALID_PLATFORMS.includes(platform as Platform)
        ? (platform as Platform)
        : "http";
    const resolvedUserId = typeof userId === "string" && userId.trim() !== "" ? userId : "anonymous";

    // BAO MAT (2026-09-13): rate-limit theo IP that (req.ip, dung sau khi "trust proxy" da dat dung
    // so hop) chu KHONG theo userId - userId o endpoint HTTP nay do client tu gui trong body nen
    // xoay vong duoc de vuot rate-limit (da chung minh: 40 request userId khac nhau deu qua du gioi
    // han 10). Telegram/Zalo van rate-limit theo userId that cua ho (khong truyen rateLimitKey).
    try {
      const result = await resolver.resolve({
        url,
        platform: resolvedPlatform,
        userId: resolvedUserId,
        rateLimitKey: `http-ip:${req.ip ?? "unknown"}`,
        // Endpoint HTTP khong co khai niem group/DM - xem LinkSourceContext.
        sourceContext: "api",
      });
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(422).json({ success: false, error: { code: err.code, message: err.userMessage } });
        return;
      }
      res.status(500).json({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "Loi khong xac dinh, vui long thu lai sau." },
      });
    }
  });

  // T1.4 acceptance: query lai lich su theo ngay/platform/merchant.
  // BAO MAT (2026-09-13): bat buoc dang nhap admin - log chua userId (Telegram/Zalo), link san
  // pham user da gui (originalUrl), subId, affiliateUrl. Truoc day route nay mo cong khai, bat ky
  // ai biet domain deu tai ve toan bo lich su request cua moi user (da chung minh: HTTP 200, 40
  // entries khong can cookie). Day la du lieu hanh vi/danh tinh, phai sau requireAdminAuth.
  app.get("/api/v1/logs", requireAdminAuth, (req: Request, res: Response) => {
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    const platform =
      typeof req.query.platform === "string" && VALID_PLATFORMS.includes(req.query.platform as Platform)
        ? (req.query.platform as Platform)
        : undefined;
    const merchant =
      typeof req.query.merchant === "string" && VALID_MERCHANTS.includes(req.query.merchant as MerchantId)
        ? (req.query.merchant as MerchantId)
        : undefined;

    if (!from || !to) {
      res.status(400).json({
        success: false,
        error: { code: "INVALID_QUERY", message: "Can query param 'from' va 'to' (YYYY-MM-DD)." },
      });
      return;
    }

    const entries = logStore.queryByDateRange(from, to, platform, merchant);
    res.status(200).json({ success: true, data: entries });
  });

  // T2.3: dashboard ca nhan xem theo token. Token sai/khong ton tai -> 404 HTML, khong lo user khac.
  // So tay hoan tien - trang CONG KHAI (khong requireAdminAuth, khong can token): bot gui link
  // tran nay vao group Zalo cho user moi, ho chua tung dang nhap gi ca. Thay cho file Google Docs
  // cu (2026-09-28) - moi con so tren trang doc LIVE tai day tu settings/env, nen admin doi % o
  // /admin/settings la trang doi ngay, khong can sua tai lieu tay va khong can restart.
  app.get("/so-tay", (_req: Request, res: Response) => {
    res.type("html").send(
      renderHandbookPage({
        userSharePercent: ledgerStore.getUserSharePercent(orderConfig.userSharePercent),
        taxPercent: orderConfig.taxPercent,
        platformFeePercent: orderConfig.platformFeePercent,
        withdrawalThresholdVnd: ledgerStore.getWithdrawalThresholdVnd(withdrawalThresholdVnd),
        payoutHoldThresholdVnd: ledgerStore.getPayoutHoldThresholdVnd(orderConfig.holdConfig.thresholdVnd),
        payoutHoldDays: ledgerStore.getPayoutHoldDays(orderConfig.holdConfig.holdDays),
      })
    );
  });

  app.get("/d/:token", (req: Request, res: Response) => {
    const identity = ledgerStore.getUserByToken(req.params.token);
    if (!identity) {
      res.status(404).type("html").send(renderInvalidTokenPage());
      return;
    }

    const summary = ledgerStore.getUserSummary(identity.platform, identity.userId);
    const pendingWithdrawal = ledgerStore.getPendingWithdrawal(identity.platform, identity.userId);
    const displayName = ledgerStore.getDisplayName(identity.platform, identity.userId);
    // ?tru-no=<id> do POST /withdraw gan vao khi yeu cau vua duoc tu dong xac nhan de tru no. Phai
    // kiem tra yeu cau thuoc DUNG user nay (query string ai cung go tay duoc) va dung la loai tu dong.
    const settledId = typeof req.query["tru-no"] === "string" ? req.query["tru-no"] : null;
    const settledCandidate = settledId ? ledgerStore.getWithdrawalById(settledId) : null;
    const settledWithdrawal =
      settledCandidate &&
      settledCandidate.platform === identity.platform &&
      settledCandidate.userId === identity.userId &&
      settledCandidate.status === "paid" &&
      settledCandidate.amount === 0 &&
      settledCandidate.debtApplied > 0
        ? settledCandidate
        : null;
    res.type("html").send(
      renderDashboardPage({
        ...summary,
        pendingWithdrawal,
        settledWithdrawal,
        thresholdVnd: ledgerStore.getWithdrawalThresholdVnd(withdrawalThresholdVnd),
        token: req.params.token,
        platform: identity.platform,
        userId: identity.userId,
        displayName,
      })
    );
  });

  // Xem lai anh bang chung da chuyen khoan cho DON HANG CUA CHINH MINH - khong dung requireAdminAuth
  // (day la trang cong khai qua token), nen phai tu kiem tra filename thuoc ve 1 entry cua dung
  // user nay (qua getUserSummary da JOIN san proof_image_path) truoc khi tra file, tranh 1 user
  // xem duoc anh chuyen khoan cua user khac neu doan/thu ten file.
  app.get("/d/:token/withdrawal-proofs/:filename", (req: Request, res: Response) => {
    const identity = ledgerStore.getUserByToken(req.params.token);
    if (!identity) {
      res.status(404).type("html").send(renderInvalidTokenPage());
      return;
    }
    const summary = ledgerStore.getUserSummary(identity.platform, identity.userId);
    const owned = summary.entries.some((e) => e.proofImagePath === req.params.filename);
    if (!owned) {
      res.status(404).type("html").send("Không tìm thấy ảnh.");
      return;
    }
    res.sendFile(resolve(withdrawalProofDir, basename(req.params.filename)), (err) => {
      if (err) res.status(404).type("html").send("Không tìm thấy ảnh.");
    });
  });

  // T2.4: gui yeu cau rut toan bo so du kha dung. Loi (chua du nguong / da co yeu cau cho) ->
  // render lai dashboard kem errorMessage thay vi tra JSON, vi day la 1 form HTML thuan.
  app.post("/d/:token/withdraw", async (req: Request, res: Response) => {
    const identity = ledgerStore.getUserByToken(req.params.token);
    if (!identity) {
      res.status(404).type("html").send(renderInvalidTokenPage());
      return;
    }

    try {
      const bankName = typeof req.body?.bankName === "string" ? req.body.bankName : "";
      const bankAccountNumber =
        typeof req.body?.bankAccountNumber === "string" ? req.body.bankAccountNumber : "";
      const bankAccountHolder =
        typeof req.body?.bankAccountHolder === "string" ? req.body.bankAccountHolder : "";
      const currentThresholdVnd = ledgerStore.getWithdrawalThresholdVnd(withdrawalThresholdVnd);
      const withdrawal = ledgerStore.requestWithdrawal(identity.platform, identity.userId, currentThresholdVnd, {
        bankName,
        bankAccountNumber,
        bankAccountHolder,
      });
      const requestedVnd = withdrawal.amount + withdrawal.debtApplied;

      // Mo hinh no 2026-10-08: so rut <= no -> requestWithdrawal() da TU DONG xac nhan (khong co
      // dong nao phai chuyen). KHONG bao admin "yeu cau rut moi" - khong co viec gi cho admin lam,
      // bao ra thi admin vao /admin/withdrawals tim mot yeu cau khong ton tai trong tab dang cho.
      if (withdrawal.status === "paid") {
        notifyUser(identity.platform, identity.userId, {
          text: formatWithdrawalDebtSettledReply({
            debtAppliedVnd: withdrawal.debtApplied,
            debtRemainingVnd: ledgerStore.getOutstandingDebtTotal(identity.platform, identity.userId),
            dashboardUrl: `${dashboardBaseUrl}/d/${req.params.token}`,
          }),
        }).catch((notifyErr) => {
          console.warn("[user-notify] gui thong bao tu dong tru no that bai:", notifyErr);
        });
        res.redirect(303, `/d/${req.params.token}?tru-no=${encodeURIComponent(withdrawal.id)}`);
        return;
      }

      // Best-effort: loi gui thong bao khong duoc lam fail response, yeu cau rut tien da luu DB roi.
      notifyAdmin(
        withdrawal.debtApplied > 0
          ? `💸 Yêu cầu rút tiền mới: ${identity.platform}/${identity.userId} - rút ${formatVnd(requestedVnd)}, trừ nợ ${formatVnd(withdrawal.debtApplied)}, cần chuyển ${formatVnd(withdrawal.amount)} (id: ${withdrawal.id})`
          : `💸 Yêu cầu rút tiền mới: ${identity.platform}/${identity.userId} - ${formatVnd(withdrawal.amount)} (id: ${withdrawal.id})`
      ).catch((notifyErr) => {
        console.warn("[admin-notify] gui thong bao yeu cau rut tien that bai:", notifyErr);
      });
      const withdrawalRequestedTemplate = ledgerStore.getWithdrawalRequestedTemplate(
        WITHDRAWAL_REQUESTED_TEMPLATE_DEFAULT
      );
      notifyUser(identity.platform, identity.userId, {
        text: formatWithdrawalRequestedReply(withdrawalRequestedTemplate, requestedVnd, {
          debtAppliedVnd: withdrawal.debtApplied,
          transferVnd: withdrawal.amount,
        }),
      }).catch((notifyErr) => {
          console.warn("[user-notify] gui thong bao xac nhan yeu cau rut tien that bai:", notifyErr);
        }
      );
      res.redirect(303, `/d/${req.params.token}`);
    } catch (err) {
      const summary = ledgerStore.getUserSummary(identity.platform, identity.userId);
      const pendingWithdrawal = ledgerStore.getPendingWithdrawal(identity.platform, identity.userId);
      const displayName = ledgerStore.getDisplayName(identity.platform, identity.userId);
      const errorMessage = err instanceof AppError ? err.userMessage : "Loi khong xac dinh, vui long thu lai sau.";
      res.status(422).type("html").send(
        renderDashboardPage({
          ...summary,
          pendingWithdrawal,
          thresholdVnd: ledgerStore.getWithdrawalThresholdVnd(withdrawalThresholdVnd),
          token: req.params.token,
          platform: identity.platform,
          userId: identity.userId,
          displayName,
          errorMessage,
        })
      );
    }
  });

  // --- Admin ("/admin/*"): xem yeu cau rut tien / user / don hang, dang nhap 1 tai khoan mac
  // dinh (ADMIN_PASSWORD trong env). Khong co form tao/sua don hang - viec do van qua CSV/CLI
  // (ledgerAdmin.ts), xem quy-trinh-van-hanh-cashback.md.

  app.get("/admin/login", (req: Request, res: Response) => {
    res.type("html").send(renderAdminLoginPage());
  });

  // Rui ro so 1 (rui-ro-can-giai-quyet.md): chan brute-force ADMIN_PASSWORD - toi da
  // ADMIN_LOGIN_RATE_LIMIT_MAX_REQUESTS lan thu (mac dinh 5) MOI IP trong 1 khoang thoi gian (mac
  // dinh 15 phut), tinh CA lan dung lan sai (don gian, khop voi RateLimiter san co - admin dang
  // nhap that hiem khi can hon vai lan). Key theo req.ip (can "trust proxy" o tren de dung voi
  // client that phia sau reverse proxy cua Railway).
  app.post("/admin/login", (req: Request, res: Response) => {
    const rateCheck = adminLoginRateLimiter.checkAndRecord(req.ip ?? "unknown");
    if (!rateCheck.allowed) {
      res
        .status(429)
        .type("html")
        .send(
          renderAdminLoginPage(
            `Thử sai quá nhiều lần, vui lòng đợi ${Math.ceil(rateCheck.retryAfterSeconds / 60)} phút rồi thử lại.`
          )
        );
      return;
    }

    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const token = adminSessionStore.login(password);
    if (!token) {
      res.status(401).type("html").send(renderAdminLoginPage("Sai mật khẩu."));
      return;
    }
    res.cookie(ADMIN_SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax" });
    res.redirect(303, "/admin");
  });

  app.post("/admin/logout", (req: Request, res: Response) => {
    const cookies = parseCookies(req.headers.cookie);
    adminSessionStore.logout(cookies[ADMIN_SESSION_COOKIE]);
    res.clearCookie(ADMIN_SESSION_COOKIE);
    res.redirect(303, "/admin/login");
  });

  app.get("/admin", requireAdminAuth, (_req: Request, res: Response) => {
    res.redirect(303, "/admin/dashboard");
  });

  /**
   * Trang tong quan (2026-10-01). Khac cac trang /admin con lai o cho: renderDashboardPage() tra ve
   * PHAN THAN, server tu boc adminShell - de adminDashboardHtml.ts khong phai import nguoc lai
   * adminHtml.ts (adminHtml.ts da import dashboardStyles() tu do, boc 2 chieu se thanh vong tron).
   */
  app.get("/admin/dashboard", requireAdminAuth, (req: Request, res: Response) => {
    const range = parseDashboardRange(req.query.range);
    const stats = computeDashboardStats(ledgerStore, logStore, range);
    res.type("html").send(adminShell("dashboard", "Tổng quan", renderAdminDashboardPage(stats), navPendingWithdrawals()));
  });

  app.get("/admin/withdrawals", requireAdminAuth, (req: Request, res: Response) => {
    res.type("html").send(
      withdrawalsPage()
    );
  });

  app.post(
    "/admin/withdrawals/:id/mark-paid",
    requireAdminAuth,
    proofUpload.single("proofImage"),
    (req: Request, res: Response) => {
      try {
        // Anh chuyen khoan TUY CHON tu 2026-10-01 (yeu cau cua user) - khong co anh thi van danh dau
        // da tra, chi la withdrawal do khong co bang chung doi chieu ve sau.
        let filename: string | null = null;
        if (req.file) {
          mkdirSync(withdrawalProofDir, { recursive: true });
          const ext = extname(req.file.originalname) || ".png";
          filename = `${req.params.id}-${Date.now()}${ext}`;
          writeFileSync(join(withdrawalProofDir, filename), req.file.buffer);
        }
        const paid = ledgerStore.markWithdrawalPaid(req.params.id, filename);
        // Best-effort: loi gui thong bao khong duoc lam fail response, da danh dau "paid" trong DB roi.
        const { token } = ledgerStore.findOrCreateDashboardToken(paid.platform, paid.userId);
        const withdrawalPaidTemplate = ledgerStore.getWithdrawalPaidTemplate(WITHDRAWAL_PAID_TEMPLATE_DEFAULT);
        notifyUser(paid.platform, paid.userId, {
          text: formatWithdrawalPaidReply(withdrawalPaidTemplate, `${dashboardBaseUrl}/d/${token}`),
        }).catch((notifyErr) => {
          console.warn("[user-notify] gui thong bao da chuyen khoan that bai:", notifyErr);
        });
        res.redirect(303, "/admin/withdrawals");
      } catch (err) {
        const message = err instanceof AppError ? err.userMessage : "Lỗi không xác định, vui lòng thử lại sau.";
        res
          .status(422)
          .type("html")
          .send(
            withdrawalsPage(message)
          );
      }
    }
  );

  /**
   * Huy 1 yeu cau rut dang cho (2026-10-08) - dung khi bao cao Shopee ghi don trong yeu cau nay da bi
   * tra hang va admin CHUA chuyen khoan.
   *
   * Tu 2026-10-08 withdrawal_requests co trang thai thu 3 'cancelled'; truoc do bang chi di MOT CHIEU
   * requested -> paid.
   */
  /**
   * Phan tien TRONG MOT LO don vua ghi dang bi giam (2026-10-08) + ngay mo khoa SOM NHAT cua lo.
   *
   * Can cho ca anh lan text bao "don ve": tin nhan in TONG cua lo canh SO DU KHA DUNG, ma don bi giam
   * vao tong nhung khong vao so du -> user doi chieu trong cung mot tin thay 2 so khong khop.
   */
  function heldInBatch(
    platform: Platform,
    userId: string,
    orderIds: Set<string>
  ): { amountVnd: number; unlockDayText: string } | null {
    const held = ledgerStore
      .getHeldEntries(platform, userId)
      .filter((e) => orderIds.has(e.orderId) && e.availableFrom !== null);
    if (held.length === 0) return null;
    const amountVnd = held.reduce((sum, e) => sum + e.userShareAmount, 0);
    // getHeldEntries sap theo available_from ASC nen phan tu dau la ngay mo khoa SOM NHAT.
    // T12:00:00Z de khong bi lech ngay khi format lai theo gio VN (+07).
    const unlockDayText = formatVnDateDdMm(new Date(`${held[0].availableFrom}T12:00:00Z`));
    return { amountVnd, unlockDayText };
  }

  /**
   * Trang /admin/withdrawals - gom lai 1 cho vi co 3 noi render no (GET, 2 nhanh loi 422), de 3 noi
   * khong lech nhau ve du lieu canh bao / tab "Da huy".
   */
  function withdrawalsPage(errorMessage?: string | null): string {
    const pending = ledgerStore.listPendingWithdrawals();
    return renderWithdrawalsPage(
      pending,
      ledgerStore.listPaidWithdrawals(),
      ledgerStore.getDisplayNamesMap(),
      errorMessage,
      ledgerStore.listCancelledWithdrawals()
    );
  }

  // Xem lai anh chup bang chung da luu - basename() chan path traversal tu :filename. sendFile can
  // duong dan tuyet doi (resolve tu withdrawalProofDir co the la relative, vd "./data/...").
  app.get("/admin/withdrawal-proofs/:filename", requireAdminAuth, (req: Request, res: Response) => {
    res.sendFile(resolve(withdrawalProofDir, basename(req.params.filename)), (err) => {
      if (err) res.status(404).type("html").send("Không tìm thấy ảnh.");
    });
  });

  app.get("/admin/users", requireAdminAuth, (req: Request, res: Response) => {
    const generalSharePercent = ledgerStore.getUserSharePercent(orderConfig.userSharePercent);
    const users = ledgerStore.listUsers();
    // Chi lay chi tiet no cho user THAT SU dang no - khong quet het danh sach.
    const userDebts = new Map<string, Array<{ id: string; orderId: string; amount: number }>>();
    for (const u of users) {
      if (u.debtRemaining <= 0) continue;
      userDebts.set(
        `${u.platform}:${u.userId}`,
        ledgerStore
          .listOutstandingDebts(u.platform, u.userId)
          .map((d) => ({ id: d.id, orderId: d.orderId, amount: d.remaining }))
      );
    }
    res
      .type("html")
      .send(
        renderUsersPage(users, generalSharePercent, todayVnIso(), navPendingWithdrawals(), userDebts)
      );
  });

  // --- % hoa hong RIENG tung user (2026-10-01) ---------------------------------------------------
  // Ai duoc muc nao do admin quyet dinh tay o day; he thong khong tu chon, khong tu gia han.
  // Ty le duoc ap LUC GHI NHAN don roi chot vao entry, nen sua/xoa o day khong hoi to don da ghi.

  /** Tra ve null (va tu tra 404) neu platform khong nam trong danh sach hop le. */
  function readUserRouteParams(req: Request, res: Response): { platform: Platform; userId: string } | null {
    const platform = req.params.platform;
    const userId = req.params.userId;
    if (!VALID_PLATFORMS.includes(platform as Platform) || !userId) {
      res.status(404).type("html").send("<p>Không tìm thấy user.</p>");
      return null;
    }
    return { platform: platform as Platform, userId };
  }

  app.get("/admin/users/:platform/:userId/commission", requireAdminAuth, (req: Request, res: Response) => {
    const params = readUserRouteParams(req, res);
    if (!params) return;
    res.type("html").send(
      renderUserCommissionPage({
        platform: params.platform,
        userId: params.userId,
        displayName: ledgerStore.getDisplayName(params.platform, params.userId),
        override: ledgerStore.getUserCommissionOverride(params.platform, params.userId),
        generalSharePercent: ledgerStore.getUserSharePercent(orderConfig.userSharePercent),
        todayVn: todayVnIso(),
        pendingWithdrawals: navPendingWithdrawals(),
      })
    );
  });

  app.post("/admin/users/:platform/:userId/commission", requireAdminAuth, (req: Request, res: Response) => {
    const params = readUserRouteParams(req, res);
    if (!params) return;

    const todayVn = todayVnIso();
    const generalSharePercent = ledgerStore.getUserSharePercent(orderConfig.userSharePercent);
    const renderError = (message: string): void => {
      res.status(422).type("html").send(
        renderUserCommissionPage({
          platform: params.platform,
          userId: params.userId,
          displayName: ledgerStore.getDisplayName(params.platform, params.userId),
          override: ledgerStore.getUserCommissionOverride(params.platform, params.userId),
          generalSharePercent,
          todayVn,
          errorMessage: message,
          pendingWithdrawals: navPendingWithdrawals(),
        })
      );
    };

    const rawPercent = typeof req.body.userSharePercent === "string" ? req.body.userSharePercent.trim() : "";
    // Number("") = 0 nen phai chan chuoi rong TRUOC khi doi so, khong thi bo trong o nay se luu thanh 0%.
    if (rawPercent === "") {
      renderError("Vui lòng nhập % hoa hồng user nhận.");
      return;
    }
    const percent = Number(rawPercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      renderError("% hoa hồng phải là số trong khoảng 0 đến 100.");
      return;
    }

    const rawEndDate = typeof req.body.endDate === "string" ? req.body.endDate.trim() : "";
    let endDate: string | null = null;
    if (rawEndDate !== "") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawEndDate)) {
        renderError("Ngày kết thúc không đúng định dạng.");
        return;
      }
      // Luu 1 uu dai het han san thi khong ap dung cho don nao ca - im lang nhan vao la bay.
      if (rawEndDate < todayVn) {
        renderError("Ngày kết thúc đã ở quá khứ nên ưu đãi sẽ không áp dụng cho đơn nào. Chọn hôm nay trở đi.");
        return;
      }
      endDate = rawEndDate;
    }

    ledgerStore.setUserCommissionOverride({
      platform: params.platform,
      userId: params.userId,
      userSharePercent: percent,
      startDate: todayVn,
      endDate,
    });
    res.redirect(303, "/admin/users");
  });

  app.post("/admin/users/:platform/:userId/commission/delete", requireAdminAuth, (req: Request, res: Response) => {
    const params = readUserRouteParams(req, res);
    if (!params) return;
    ledgerStore.deleteUserCommissionOverride(params.platform, params.userId);
    res.redirect(303, "/admin/users");
  });

  /**
   * Admin xoa 1 khoan no hoan tra (2026-10-08) - user bo di, no treo vinh vien lam meo moi con so
   * tong. Dong no duoc GIU LAI (chi dien written_off_at) de con doi soat.
   */
  app.post(
    "/admin/users/:platform/:userId/debts/:debtId/write-off",
    requireAdminAuth,
    (req: Request, res: Response) => {
      const params = readUserRouteParams(req, res);
      if (!params) return;
      ledgerStore.writeOffDebt(req.params.debtId);
      res.redirect(303, "/admin/users");
    }
  );

  app.get("/admin/orders", requireAdminAuth, (req: Request, res: Response) => {
    const filters: OrdersFilters = {
      platform:
        typeof req.query.platform === "string" && VALID_PLATFORMS.includes(req.query.platform as Platform)
          ? (req.query.platform as Platform)
          : undefined,
      userId: typeof req.query.userId === "string" && req.query.userId !== "" ? req.query.userId : undefined,
      merchant:
        typeof req.query.merchant === "string" && VALID_MERCHANTS.includes(req.query.merchant as MerchantId)
          ? (req.query.merchant as MerchantId)
          : undefined,
      statuses: parseStatusFilter(req.query.status),
      // O tim 1 dong (2026-10-04). Cat bot khoang trang va bo qua chuoi rong de "?q=" khong bi hieu
      // la mot dieu kien loc - neu khong thi bam Loc voi o tim de trong se them menh de LIKE '%%'
      // vao moi truy van (van dung ket qua, nhung lam trang bao "dang co bo loc" trong o danh sach rong).
      search: typeof req.query.q === "string" && req.query.q.trim() !== "" ? req.query.q.trim() : undefined,
      // Toggle cot thoi gian (2026-10-10): gia tri la -> mac dinh (import). Chi la cach hien thi.
      timeMode: req.query.time === "order" ? "order" : undefined,
    };

    // Tong so don + 3 so cua the KPI lay trong MOT truy van dung CHUNG bo loc voi bang (xem
    // LedgerStore.getOrdersFilterTotals) - truoc day la countCommissionEntries() rieng. Mot bo so,
    // khong the venh nhau. Phai co TRUOC khi lay trang, vi so trang quyet dinh viec kep "page" ve
    // khoang hop le (vd admin dang o trang 5 roi doi bo loc con 1 trang -> ?page=5 phai ve trang 1,
    // khong duoc tra bang rong).
    const totals = ledgerStore.getOrdersFilterTotals(filters);
    const totalPages = Math.max(1, Math.ceil(totals.totalEntries / ORDERS_PAGE_SIZE));
    const page = Math.min(parsePageParam(req.query.page), totalPages);
    const entries = ledgerStore.listCommissionEntries(filters, {
      limit: ORDERS_PAGE_SIZE,
      offset: (page - 1) * ORDERS_PAGE_SIZE,
    });
    res.type("html").send(
      renderOrdersPage(
        entries,
        filters,
        ledgerStore.getDisplayNamesMap(),
        { page, totalPages, totalEntries: totals.totalEntries },
        totals,
        navPendingWithdrawals(),
        // Chi tra no cho dung cac don DANG hien tren trang nay (50 don/trang), khong quet ca bang.
        new Set(
          entries
            .filter((e) => ledgerStore.getDebtByOrder(e.merchant, e.orderId) !== null)
            .map((e) => e.orderId)
        )
      )
    );
  });

  /**
   * Danh sach MOI luot tao link (2026-10-08). Ten hien thi cua user nam o DB KHAC (user_profiles
   * ben ledgerStore) nen phai gop trong JS - khong JOIN duoc qua 2 ket noi SQLite.
   */
  app.get("/admin/links", requireAdminAuth, (req: Request, res: Response) => {
    // Khong con loc theo kenh (2026-10-10, yeu cau user: chi kinh doanh tren Zalo) - ?platform= cu bi bo qua.
    const filters: CreatedLinkFilters = {
      outcome:
        req.query.outcome === "success" || req.query.outcome === "error"
          ? (req.query.outcome as RequestOutcome)
          : undefined,
      userId: typeof req.query.userId === "string" && req.query.userId !== "" ? req.query.userId : undefined,
      // Chuoi rong bi bo qua de "?q=" khong bi tinh la mot dieu kien loc (trang se bao "dang loc"
      // trong o danh sach rong).
      search: typeof req.query.q === "string" && req.query.q.trim() !== "" ? req.query.q.trim() : undefined,
      fromDate: parseIsoDateParam(req.query.from),
      toDate: parseIsoDateParam(req.query.to),
    };
    // O tim kiem cung khop TEN HIEN THI cua user (2026-10-10): ten nam o ledger.db, bang requests o
    // log.db -> tra khoa user o day roi dua xuong logStore.
    if (filters.search) filters.searchUserKeys = ledgerStore.findUserKeysByDisplayName(filters.search);

    // Tong so + 4 the KPI lay trong MOT truy van dung CHUNG bo loc voi bang. Phai co TRUOC khi lay
    // trang vi so trang quyet dinh viec kep "page" ve khoang hop le (admin dang o trang 5 roi doi
    // bo loc con 1 trang -> ?page=5 phai ve trang 1, khong duoc tra bang rong).
    const totals = logStore.getCreatedLinksTotals(filters);
    const totalPages = Math.max(1, Math.ceil(totals.total / LINKS_PAGE_SIZE));
    const page = Math.min(parsePageParam(req.query.page), totalPages);
    const entries = logStore.listCreatedLinks(filters, {
      limit: LINKS_PAGE_SIZE,
      offset: (page - 1) * LINKS_PAGE_SIZE,
    });
    res.type("html").send(
      renderLinksPage(
        entries,
        filters,
        ledgerStore.getDisplayNamesMap(),
        { page, totalPages, totalEntries: totals.total },
        totals,
        navPendingWithdrawals()
      )
    );
  });

  app.get("/admin/orders/:id/reverse", requireAdminAuth, (req: Request, res: Response) => {
    const entry = ledgerStore.getEntryById(req.params.id);
    if (!entry) {
      res.redirect(303, "/admin/orders");
      return;
    }
    const displayName = ledgerStore.getDisplayNamesMap().get(`${entry.platform}:${entry.userId}`) ?? null;
    // Chan tu truoc neu entry khong con "pending" - khong de admin dien ly do roi moi bao loi
    // (2026-08-20: chi huy duoc don dang "Cho xac nhan", "Kha dung" xem la da hoan tat).
    const blockedMessage =
      entry.status !== "pending"
        ? "Chỉ huỷ được đơn đang ở trạng thái \"Chờ xác nhận\" - đơn này đã \"Khả dụng\" (hoặc đã rút/đã huỷ), được xem là đã hoàn tất, không thể huỷ qua đây nữa."
        : null;
    res.type("html").send(renderReverseConfirmPage(entry, displayName, blockedMessage, navPendingWithdrawals()));
  });

  app.post("/admin/orders/:id/reverse", requireAdminAuth, (req: Request, res: Response) => {
    const entry = ledgerStore.getEntryById(req.params.id);
    if (!entry) {
      res.redirect(303, "/admin/orders");
      return;
    }
    const displayName = ledgerStore.getDisplayNamesMap().get(`${entry.platform}:${entry.userId}`) ?? null;
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (reason === "") {
      res.status(422).type("html").send(renderReverseConfirmPage(entry, displayName, null, navPendingWithdrawals()));
      return;
    }
    try {
      ledgerStore.reverseCommissionEntry(req.params.id, reason);
      res.redirect(303, "/admin/orders");
    } catch (err) {
      const message = err instanceof AppError ? err.userMessage : "Lỗi không xác định, vui lòng thử lại sau.";
      res.status(422).type("html").send(renderReverseConfirmPage(entry, displayName, message, navPendingWithdrawals()));
    }
  });

  // Sua tay hoa hong goc cua don "pending" (2026-10-10) - tien khach/chu bot tinh lai theo ty le DA CHOT
  // cua don, so duoc KHOA khong cho import bao cao Shopee ghi de. Xem LedgerStore.overrideCommissionAmount.
  const NOT_PENDING_COMMISSION_MESSAGE =
    'Chỉ sửa được hoa hồng gốc của đơn đang ở trạng thái "Chờ xác nhận" - đơn đã "Khả dụng" (hoặc đã rút/đã huỷ) là tiền đã chốt với user.';

  /** So thap phan khong am (toi da 2 chu so le), tra null neu khong hop le. Khong doan dinh dang "50.000". */
  function parseCommissionAmountInput(raw: unknown): number | null {
    if (typeof raw !== "string") return null;
    const text = raw.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
    return Number(text);
  }

  const commissionFallbackPercents = () => ({
    taxPercent: orderConfig.taxPercent,
    platformFeePercent: orderConfig.platformFeePercent,
    userSharePercent: ledgerStore.getUserSharePercent(orderConfig.userSharePercent),
  });

  app.get("/admin/orders/:id/commission", requireAdminAuth, (req: Request, res: Response) => {
    const entry = ledgerStore.getEntryById(req.params.id);
    if (!entry) {
      res.redirect(303, "/admin/orders");
      return;
    }
    const displayName = ledgerStore.getDisplayNamesMap().get(`${entry.platform}:${entry.userId}`) ?? null;
    const pendingWithdrawals = navPendingWithdrawals();
    if (entry.status !== "pending") {
      res
        .type("html")
        .send(
          renderEditCommissionPage({ entry, displayName, blockedMessage: NOT_PENDING_COMMISSION_MESSAGE, pendingWithdrawals })
        );
      return;
    }

    // ?commissionAmount= = nut "Xem truoc": chi tinh, KHONG ghi gi.
    const rawAmount = req.query.commissionAmount;
    if (typeof rawAmount !== "string") {
      res.type("html").send(renderEditCommissionPage({ entry, displayName, pendingWithdrawals }));
      return;
    }
    const amount = parseCommissionAmountInput(rawAmount);
    if (amount === null) {
      res
        .status(422)
        .type("html")
        .send(
          renderEditCommissionPage({
            entry,
            displayName,
            errorMessage: "Hoa hồng gốc phải là số không âm (ví dụ 50000).",
            inputValue: rawAmount,
            pendingWithdrawals,
          })
        );
      return;
    }
    if (amount > (entry.orderAmount * orderConfig.maxCommissionRatioPercent) / 100) {
      res
        .status(422)
        .type("html")
        .send(
          renderEditCommissionPage({
            entry,
            displayName,
            errorMessage: `Hoa hồng ${formatVnd(amount)} vượt quá ${orderConfig.maxCommissionRatioPercent}% giá trị đơn (${formatVnd(entry.orderAmount)}), có thể gõ nhầm.`,
            inputValue: rawAmount,
            pendingWithdrawals,
          })
        );
      return;
    }
    const percents = effectivePercents(entry, commissionFallbackPercents());
    const breakdown = computeCommissionBreakdown({ commissionAmount: amount, ...percents });
    res
      .type("html")
      .send(
        renderEditCommissionPage({
          entry,
          displayName,
          preview: { commissionAmount: amount, percents, breakdown },
          inputValue: rawAmount,
          pendingWithdrawals,
        })
      );
  });

  app.post("/admin/orders/:id/commission", requireAdminAuth, (req: Request, res: Response) => {
    const entry = ledgerStore.getEntryById(req.params.id);
    if (!entry) {
      res.redirect(303, "/admin/orders");
      return;
    }
    const displayName = ledgerStore.getDisplayNamesMap().get(`${entry.platform}:${entry.userId}`) ?? null;
    const pendingWithdrawals = navPendingWithdrawals();
    const rawAmount = typeof req.body?.commissionAmount === "string" ? req.body.commissionAmount : "";
    const fail = (message: string) =>
      res
        .status(422)
        .type("html")
        .send(
          renderEditCommissionPage({
            entry,
            displayName,
            ...(entry.status === "pending" ? { errorMessage: message } : { blockedMessage: message }),
            inputValue: rawAmount,
            pendingWithdrawals,
          })
        );

    try {
      if (req.body?.action === "unlock") {
        ledgerStore.clearCommissionOverride(entry.id);
        res.redirect(303, "/admin/orders");
        return;
      }
      const amount = parseCommissionAmountInput(rawAmount);
      if (amount === null) {
        fail("Hoa hồng gốc phải là số không âm (ví dụ 50000).");
        return;
      }
      ledgerStore.overrideCommissionAmount(entry.id, {
        commissionAmount: amount,
        fallbackPercents: commissionFallbackPercents(),
        maxCommissionRatioPercent: orderConfig.maxCommissionRatioPercent,
      });
      res.redirect(303, "/admin/orders");
    } catch (err) {
      fail(
        err instanceof EntryNotPendingError
          ? NOT_PENDING_COMMISSION_MESSAGE
          : err instanceof AppError
            ? err.userMessage
            : "Lỗi không xác định, vui lòng thử lại sau."
      );
    }
  });

  // Ghi nhan don hang tren web - THEM lua chon ngoai CLI ledgerAdmin.ts record-conversion /
  // record-shopee-report. Dung chung logic qua core/orderIngest.ts
  // de khong lap lai (tra subId -> platform/userId/merchant -> ledgerStore.recordConversion).
  app.get("/admin/record-orders", requireAdminAuth, (req: Request, res: Response) => {
    res.type("html").send(renderRecordOrdersPage(ledgerStore.listImportHistory(20), null, null, null, navPendingWithdrawals()));
  });

  app.post("/admin/record-orders/single", requireAdminAuth, (req: Request, res: Response) => {
    const subId = typeof req.body?.subId === "string" ? req.body.subId.trim() : "";
    const orderId = typeof req.body?.orderId === "string" ? req.body.orderId.trim() : "";
    const orderAmount = Number(req.body?.orderAmount);
    const commissionAmount = Number(req.body?.commissionAmount);
    const productName =
      typeof req.body?.productName === "string" && req.body.productName.trim() !== ""
        ? req.body.productName.trim()
        : undefined;
    const note = typeof req.body?.note === "string" && req.body.note.trim() !== "" ? req.body.note.trim() : undefined;
    const status: RecordableOrderStatus = req.body?.status === "pending" ? "pending" : "confirmed";

    if (!subId || !orderId || !Number.isFinite(orderAmount) || !Number.isFinite(commissionAmount)) {
      res.status(422).type("html").send(
        renderRecordOrdersPage(
          ledgerStore.listImportHistory(20),
          { ok: false, message: "Thiếu subId/orderId hoặc orderAmount/commissionAmount không phải số." },
          null,
          null,
          navPendingWithdrawals()
        )
      );
      return;
    }

    try {
      const requestOrderConfig = {
        ...orderConfig,
        userSharePercent: ledgerStore.getUserSharePercent(orderConfig.userSharePercent),
        // Doc LUC XU LI chu khong dung gia tri env dong bang luc khoi dong: admin doi nguong/so ngay
        // giam o /admin/settings phai co hieu luc ngay, khong can restart.
        holdConfig: {
          thresholdVnd: ledgerStore.getPayoutHoldThresholdVnd(orderConfig.holdConfig.thresholdVnd),
          holdDays: ledgerStore.getPayoutHoldDays(orderConfig.holdConfig.holdDays),
        },
      };
      const entry = recordSingleOrder(logStore, ledgerStore, requestOrderConfig, {
        subId,
        orderId,
        productName,
        orderAmount,
        commissionAmount,
        note,
        status,
      });
      // phan-hoi-cai-thien-trai-nghiem-nguoi-dung.md muc 1: ghi 1 don le -> bao ngay, khong gop lot.
      // CHI bao khi da "confirmed" (Kha dung) - don "pending" (Cho xac nhan) chua chac chan, dong
      // nhat voi shopeeReportImport.ts (khong DM cho entry pending). Best-effort - loi gui khong duoc
      // lam fail response, don da ghi vao ledger roi.
      if (entry.status === "confirmed") {
        const { token } = ledgerStore.findOrCreateDashboardToken(entry.platform, entry.userId);
        const dashboardUrl = `${dashboardBaseUrl}/d/${token}`;
        const ordersConfirmedTemplate = ledgerStore.getOrdersConfirmedTemplate(ORDERS_CONFIRMED_TEMPLATE_DEFAULT);
        const captionTemplate = ledgerStore.getOrdersConfirmedCaptionTemplate(
          ORDERS_CONFIRMED_CAPTION_TEMPLATE_DEFAULT
        );
        const confirmedItems = [
          { orderId: entry.orderId, productName: entry.productName, userShareAmount: entry.userShareAmount },
        ];
        // So du doc SAU khi don da ghi vao ledger - doc truoc thi anh bao thieu dung don vua ghi.
        const held = heldInBatch(entry.platform, entry.userId, new Set([entry.orderId]));
        // No DOC LAP voi lo don nay - co the den tu mot lan import KHAC (don bi tra hang tu truoc).
        // Doc CUNG luc voi availableVnd (sau khi ghi xong) de 2 so nhat quan voi nhau.
        const debtVnd = ledgerStore.getOutstandingDebtTotal(entry.platform, entry.userId);
        buildOrdersConfirmedNotification({
          items: confirmedItems,
          availableVnd: ledgerStore.getAvailableBalance(entry.platform, entry.userId),
          withdrawalThresholdVnd: ledgerStore.getWithdrawalThresholdVnd(withdrawalThresholdVnd),
          heldVnd: held?.amountVnd ?? 0,
          heldUnlockDayText: held?.unlockDayText ?? null,
          debtVnd,
          fallbackText: formatOrdersConfirmedReply(ordersConfirmedTemplate, confirmedItems, dashboardUrl, held, debtVnd),
          captionText: formatOrdersConfirmedCaption(captionTemplate, dashboardUrl, held, debtVnd),
          imageEnabled: orderImageEnabled,
        })
          .then((notification) => notifyUser(entry.platform, entry.userId, notification))
          .catch((notifyErr) => {
            console.warn("[user-notify] gui thong bao don moi that bai:", notifyErr);
          });
      }
      // Lich su (2026-08-23): form "Ghi 1 don le" luon tao 1 entry MOI (recordSingleOrder
      // chi INSERT, khong bao gio UPDATE entry co san) - vi vay khong bao gio co statusTransitions.
      ledgerStore.recordImportHistory({ actionType: "single", newOrderIds: [entry.orderId], statusTransitions: [] });

      const statusLabel = entry.status === "pending" ? "Chờ xác nhận" : "Khả dụng";
      const amountHint =
        entry.status === "pending"
          ? `dự kiến user nhận ~${formatVnd(entry.userShareAmount)} khi được xác nhận`
          : `user nhận ${formatVnd(entry.userShareAmount)}`;
      res.type("html").send(
        renderRecordOrdersPage(
          ledgerStore.listImportHistory(20),
          { ok: true, message: `Đã ghi nhận đơn "${entry.orderId}" (${statusLabel}) - ${amountHint}.` },
          null,
          null,
          navPendingWithdrawals()
        )
      );
    } catch (err) {
      const message = err instanceof AppError ? err.userMessage : "Lỗi không xác định, vui lòng thử lại sau.";
      res.status(422).type("html").send(renderRecordOrdersPage(ledgerStore.listImportHistory(20), { ok: false, message }, null, null, navPendingWithdrawals()));
    }
  });

  /**
   * Gui tin "don hang ngay <hom qua> da duoc cap nhat" vao cac group Zalo admin da tick tren
   * /admin/settings (bang zalo_groups). Best-effort tung group: loi gui 1 group chi log canh bao,
   * khong chan group con lai va khong lam fail response upload cua admin (giong pattern notifyUser).
   * Khong lam gi khi chay ma khong co notifyZaloGroup (ZALO_GROUP_ENABLED=false) hoac admin chua
   * tick group nao.
   */
  function notifyEnabledZaloGroups(): void {
    if (!notifyZaloGroup) return;
    const groups = ledgerStore.listNotifyEnabledZaloGroups();
    if (groups.length === 0) return;

    const template = ledgerStore.getGroupReportUpdatedTemplate(GROUP_REPORT_UPDATED_TEMPLATE_DEFAULT);
    const message = formatGroupReportUpdatedReply(template, yesterdayVnDdMm());
    for (const group of groups) {
      notifyZaloGroup(group.groupId, message).catch((err: unknown) => {
        console.warn(`[group-notify] gui thong bao vao group ${group.groupId} (${group.name}) that bai:`, err);
      });
    }
  }

  app.post(
    "/admin/record-orders/shopee-report",
    requireAdminAuth,
    csvUpload.single("file"),
    (req: Request, res: Response) => {
      if (!req.file) {
        res
          .status(422)
          .type("html")
          .send(
            renderRecordOrdersPage(ledgerStore.listImportHistory(20), null, null, "Chưa chọn file báo cáo Shopee nào.", navPendingWithdrawals())
          );
        return;
      }

      const requestOrderConfig = {
        ...orderConfig,
        userSharePercent: ledgerStore.getUserSharePercent(orderConfig.userSharePercent),
        // Doc LUC XU LI chu khong dung gia tri env dong bang luc khoi dong: admin doi nguong/so ngay
        // giam o /admin/settings phai co hieu luc ngay, khong can restart.
        holdConfig: {
          thresholdVnd: ledgerStore.getPayoutHoldThresholdVnd(orderConfig.holdConfig.thresholdVnd),
          holdDays: ledgerStore.getPayoutHoldDays(orderConfig.holdConfig.holdDays),
        },
      };
      const result = importShopeeReport(
        logStore,
        ledgerStore,
        { recordOrderConfig: requestOrderConfig },
        req.file.buffer.toString("utf8")
      );
      for (const summary of result.confirmedByUser) {
        const { token } = ledgerStore.findOrCreateDashboardToken(summary.platform, summary.userId);
        const dashboardUrl = `${dashboardBaseUrl}/d/${token}`;
        const ordersConfirmedTemplate = ledgerStore.getOrdersConfirmedTemplate(ORDERS_CONFIRMED_TEMPLATE_DEFAULT);
        const captionTemplate = ledgerStore.getOrdersConfirmedCaptionTemplate(
          ORDERS_CONFIRMED_CAPTION_TEMPLATE_DEFAULT
        );
        // So du doc SAU khi importShopeeReport da ghi xong - doc truoc thi anh bao thieu dung
        // cac don vua import.
        const held = heldInBatch(
          summary.platform,
          summary.userId,
          new Set(summary.items.map((i) => i.orderId))
        );
        // No DOC LAP voi lo don nay - co the den tu mot ma don KHAC trong CUNG lan import nay, hoac tu
        // mot lan import TRUOC do. Doc CUNG luc voi availableVnd (sau khi ghi xong) de 2 so nhat quan.
        const debtVnd = ledgerStore.getOutstandingDebtTotal(summary.platform, summary.userId);
        buildOrdersConfirmedNotification({
          items: summary.items,
          availableVnd: ledgerStore.getAvailableBalance(summary.platform, summary.userId),
          withdrawalThresholdVnd: ledgerStore.getWithdrawalThresholdVnd(withdrawalThresholdVnd),
          heldVnd: held?.amountVnd ?? 0,
          heldUnlockDayText: held?.unlockDayText ?? null,
          debtVnd,
          fallbackText: formatOrdersConfirmedReply(ordersConfirmedTemplate, summary.items, dashboardUrl, held, debtVnd),
          captionText: formatOrdersConfirmedCaption(captionTemplate, dashboardUrl, held, debtVnd),
          imageEnabled: orderImageEnabled,
        })
          .then((notification) => notifyUser(summary.platform, summary.userId, notification))
          .catch((notifyErr) => {
            console.warn("[user-notify] gui thong bao gop don moi (bao cao Shopee) that bai:", notifyErr);
          });
      }

      // Don bi tra hang SAU KHI da tra tien -> no hoan tra. Gui 1 lan cho moi don (bang payout_debts
      // co UNIQUE(merchant, order_id) nen import lai cung bao cao khong sinh no moi -> khong DM lai).
      // Best-effort: loi gui khong duoc lam fail response upload, no da ghi trong DB roi.
      const debtNoticeTemplate = ledgerStore.getPayoutDebtNoticeTemplate(PAYOUT_DEBT_NOTICE_TEMPLATE_DEFAULT);
      for (const debt of result.debtsByUser) {
        const { token } = ledgerStore.findOrCreateDashboardToken(debt.platform, debt.userId);
        notifyUser(debt.platform, debt.userId, {
          text: formatPayoutDebtNotice(debtNoticeTemplate, {
            orderId: debt.orderId,
            amount: debt.amount,
            dashboardUrl: `${dashboardBaseUrl}/d/${token}`,
          }),
        }).catch((notifyErr) => {
          console.warn("[user-notify] gui thong bao don bi tra hang that bai:", notifyErr);
        });
      }
      // Yeu cau rut BI TU DONG HUY vi mot don trong do bao "Da huy" (2026-10-08, yeu cau truc tiep
      // cua user - DAO NGUOC quyet dinh brainstorm ban dau "canh bao admin, admin tu quyet"). Dung
      // LAI dung template/ham da xay cho route huy THU CONG tren /admin/withdrawals (Task 7/12), chi
      // khac nguon goc (import tu dong thay vi admin bam nut) - cung 1 cau cho user doc, khong tao
      // thanh 2 kieu tin nhan rieng cho cung 1 su kien "yeu cau rut cua ban bi huy".
      //
      // RUI RO DA DUOC NGUOI DUNG CHAP NHAN (xem doc comment cua ShopeeReportImportResult.cancelledWithdrawals):
      // neu admin DA chuyen khoan tay nhung CHUA bam "Danh dau da tra" truoc khi import nay chay, tien
      // se bi tinh la "chua chuyen" va quay lai Kha dung cua user - khong co cach nao he thong tu phat
      // hien duoc dieu nay.
      const withdrawalCancelledTemplate = ledgerStore.getWithdrawalCancelledTemplate(
        WITHDRAWAL_CANCELLED_TEMPLATE_DEFAULT
      );
      for (const cancelled of result.cancelledWithdrawals) {
        const { token } = ledgerStore.findOrCreateDashboardToken(cancelled.platform, cancelled.userId);
        notifyUser(cancelled.platform, cancelled.userId, {
          text: formatWithdrawalCancelledReply(withdrawalCancelledTemplate, {
            amount: cancelled.amount,
            reason: "bạn có đơn hàng bị trả lại",
            dashboardUrl: `${dashboardBaseUrl}/d/${token}`,
          }),
        }).catch((notifyErr) => {
          console.warn("[user-notify] gui thong bao tu dong huy yeu cau rut that bai:", notifyErr);
        });
      }

      // 2026-09-11 (yeu cau truc tiep cua user): bao CA GROUP biet du lieu hoa hong vua duoc cap nhat,
      // thay vi chi DM rieng tung user co don moi. Gui MOI lan import thanh cong - ke ca khi 0 don moi
      // (quyet dinh cua user: giu nhip thong bao hang ngay) - nen noi dung khong noi gi ve so luong don.
      // Best-effort nhu notifyUser o tren: loi gui khong duoc lam fail response upload cua admin.
      notifyEnabledZaloGroups();

      // Ghi lich su du ket qua co gi thay doi hay khong (0 don moi/0 doi trang thai) - de admin thay
      // "da chay luc nay" thay vi khong thay gi ca, xem comment LedgerStore.recordImportHistory().
      ledgerStore.recordImportHistory({
        actionType: "csv",
        newOrderIds: result.newOrderIds,
        statusTransitions: result.statusTransitions,
      });
      res.type("html").send(renderRecordOrdersPage(ledgerStore.listImportHistory(20), null, result, null, navPendingWithdrawals()));
    }
  );

  app.get("/admin/settings", requireAdminAuth, (req: Request, res: Response) => {
    const currentValues: Record<string, string> = {};
    for (const entry of SETTINGS_REGISTRY) {
      currentValues[entry.key] = ledgerStore.getSetting(entry.key, entry.default);
    }
    const successMessage =
      req.query.saved === "1"
        ? "Đã lưu thay đổi cấu hình thành công."
        : req.query.groupsSaved === "1"
          ? "Đã lưu danh sách group Zalo nhận thông báo."
          : null;
    res.type("html").send(renderSettingsPage(currentValues, null, successMessage, ledgerStore.listZaloGroups(), navPendingWithdrawals()));
  });

  app.post("/admin/settings", requireAdminAuth, (req: Request, res: Response) => {
    const submitted: Record<string, string> = {};
    const errors: string[] = [];

    for (const entry of SETTINGS_REGISTRY) {
      // normalizeNewlines: trinh duyet nop <textarea> len dang CRLF, luu nguyen se lam Zalo desktop
      // hien thi moi dong trong thanh gap doi - xem textNormalize.ts.
      const raw = typeof req.body?.[entry.key] === "string" ? normalizeNewlines(req.body[entry.key]) : "";
      const trimmed = raw.trim();

      if (entry.type === "number") {
        const num = Number(trimmed);
        const outOfRange =
          (entry.min !== undefined && num < entry.min) || (entry.max !== undefined && num > entry.max);
        if (trimmed === "" || !Number.isFinite(num) || outOfRange) {
          const rangeHint =
            entry.min !== undefined && entry.max !== undefined
              ? ` (${entry.min}-${entry.max})`
              : entry.min !== undefined
                ? ` (>= ${entry.min})`
                : "";
          errors.push(`"${entry.label}" phải là số hợp lệ${rangeHint}.`);
        } else {
          submitted[entry.key] = String(Math.round(num));
        }
      } else {
        if (trimmed === "") {
          errors.push(`"${entry.label}" không được để trống.`);
        } else {
          submitted[entry.key] = trimmed;
        }
      }
    }

    if (errors.length > 0) {
      const previewValues: Record<string, string> = {};
      for (const entry of SETTINGS_REGISTRY) {
        const raw = typeof req.body?.[entry.key] === "string" ? normalizeNewlines(req.body[entry.key]) : "";
        previewValues[entry.key] = submitted[entry.key] ?? raw;
      }
      res
        .status(422)
        .type("html")
        .send(renderSettingsPage(previewValues, errors.join(" "), null, ledgerStore.listZaloGroups(), navPendingWithdrawals()));
      return;
    }

    for (const entry of SETTINGS_REGISTRY) {
      ledgerStore.setSetting(entry.key, submitted[entry.key]);
    }
    res.redirect(303, "/admin/settings?saved=1");
  });

  /**
   * Luu lua chon "group Zalo nhan thong bao" (2026-09-11) - route RIENG voi POST /admin/settings vi
   * danh sach group la du lieu dong tu bang zalo_groups, khong khai bao duoc trong SETTINGS_REGISTRY
   * (xem renderZaloGroupsCard trong adminHtml.ts). Form HTML khong gui ve checkbox bi bo tick, nen
   * body rong = "tat het" - setZaloGroupNotifySelection ghi lai ca danh sach theo dung y nghia do.
   */
  app.post("/admin/settings/zalo-groups", requireAdminAuth, (req: Request, res: Response) => {
    const raw = req.body?.groupIds;
    // express.urlencoded tra ve string khi chi tick 1 group, array khi tick nhieu, undefined khi khong tick gi.
    const groupIds = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : typeof raw === "string" ? [raw] : [];
    // Group VUA duoc tick (chua bat truoc do) = admin vua khai "day la group khach hang" -> lay
    // danh sach thanh vien ngay, de /admin/users co nguoi lien ma khong phai cho restart bot.
    // Doc truoc khi ghi: sau setZaloGroupNotifySelection thi khong con biet group nao la MOI.
    const alreadyEnabled = new Set(ledgerStore.listNotifyEnabledZaloGroups().map((group) => group.groupId));
    const newlyEnabled = groupIds.filter((groupId) => !alreadyEnabled.has(groupId));
    ledgerStore.setZaloGroupNotifySelection(groupIds);
    // Best-effort, KHONG await: bot chua dang nhap hoac Zalo loi khong duoc lam that bai viec luu
    // lua chon cua admin (roster se duoc dong bo o lan dang nhap ke tiep).
    if (syncZaloGroupMembers !== undefined) {
      for (const groupId of newlyEnabled) {
        syncZaloGroupMembers(groupId).catch((err: unknown) => {
          console.warn(`[admin] khong dong bo duoc thanh vien group ${groupId}:`, (err as Error).message);
        });
      }
    }
    res.redirect(303, "/admin/settings?groupsSaved=1");
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Loi khong xac dinh, vui long thu lai sau." },
    });
  });

  return app;
}
