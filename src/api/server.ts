import express, { type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import {
  renderAccesstradePaymentsPage,
  renderAdminLoginPage,
  renderOrdersPage,
  renderRecordOrdersPage,
  renderReverseConfirmPage,
  renderSettingsPage,
  renderUsersPage,
  renderWithdrawalsPage,
  type OrdersFilters,
} from "./adminHtml.js";
import { renderDashboardPage, renderInvalidTokenPage } from "./dashboardHtml.js";
import type { AdminSessionStore } from "../core/adminAuth.js";
import { AppError } from "../core/errors.js";
import type { LedgerStore } from "../core/ledgerStore.js";
import type { LinkResolverService } from "../core/linkResolverService.js";
import type { LogStore } from "../core/logStore.js";
import { MERCHANTS, type MerchantId } from "../core/merchants.js";
import {
  recordOrderFromAccesstrade,
  type RecordOrderConfig,
  type RecordableOrderStatus,
} from "../core/orderIngest.js";
import type { RateLimiter } from "../core/rateLimiter.js";
import { importShopeeReport, type ShopeeReportImportResult } from "../core/shopeeReportImport.js";
import type { CommissionStatus, Platform } from "../core/types.js";
import {
  formatOrdersConfirmedReply,
  formatWithdrawalPaidReply,
  formatWithdrawalRequestedReply,
} from "../adapters/shared/replyText.js";
import { SETTINGS_REGISTRY } from "../config/settingsRegistry.js";

const VALID_PLATFORMS: Platform[] = ["telegram", "zalo", "http"];
const VALID_MERCHANTS: MerchantId[] = MERCHANTS.map((m) => m.id);
const VALID_STATUSES: CommissionStatus[] = ["pending", "confirmed", "paid", "reversed"];
const ADMIN_SESSION_COOKIE = "admin_session";

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
  notifyUser: (platform: Platform, userId: string, message: string) => Promise<void>
) {
  const app = express();
  // Can de doc dung IP that cua client tu header X-Forwarded-For - Railway (va da so PaaS) dat app
  // sau 1 reverse proxy, khong bat cai nay thi req.ip luon la IP noi bo cua proxy, rate limit theo
  // IP se vo nghia (moi client bi gop chung 1 "IP").
  app.set("trust proxy", true);
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

    try {
      const result = await resolver.resolve({ url, platform: resolvedPlatform, userId: resolvedUserId });
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
  app.get("/api/v1/logs", (req: Request, res: Response) => {
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
  app.get("/d/:token", (req: Request, res: Response) => {
    const identity = ledgerStore.getUserByToken(req.params.token);
    if (!identity) {
      res.status(404).type("html").send(renderInvalidTokenPage());
      return;
    }

    const summary = ledgerStore.getUserSummary(identity.platform, identity.userId);
    const pendingWithdrawal = ledgerStore.getPendingWithdrawal(identity.platform, identity.userId);
    const displayName = ledgerStore.getDisplayName(identity.platform, identity.userId);
    res.type("html").send(
      renderDashboardPage({
        ...summary,
        pendingWithdrawal,
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
      // Best-effort: loi gui thong bao khong duoc lam fail response, yeu cau rut tien da luu DB roi.
      notifyAdmin(
        `💸 Yêu cầu rút tiền mới: ${identity.platform}/${identity.userId} - ${withdrawal.amount.toLocaleString("vi-VN")}đ (id: ${withdrawal.id})`
      ).catch((notifyErr) => {
        console.warn("[admin-notify] gui thong bao yeu cau rut tien that bai:", notifyErr);
      });
      notifyUser(identity.platform, identity.userId, formatWithdrawalRequestedReply(withdrawal.amount)).catch(
        (notifyErr) => {
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

  app.get("/admin/login", (_req: Request, res: Response) => {
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
    res.redirect(303, "/admin/withdrawals");
  });

  app.get("/admin/withdrawals", requireAdminAuth, (_req: Request, res: Response) => {
    res.type("html").send(
      renderWithdrawalsPage(
        ledgerStore.listPendingWithdrawals(),
        ledgerStore.listPaidWithdrawals(),
        ledgerStore.getDisplayNamesMap()
      )
    );
  });

  app.post(
    "/admin/withdrawals/:id/mark-paid",
    requireAdminAuth,
    proofUpload.single("proofImage"),
    (req: Request, res: Response) => {
      if (!req.file) {
        res
          .status(422)
          .type("html")
          .send(
            renderWithdrawalsPage(
              ledgerStore.listPendingWithdrawals(),
              ledgerStore.listPaidWithdrawals(),
              ledgerStore.getDisplayNamesMap(),
              "Cần đính kèm ảnh chụp màn hình đã chuyển khoản thành công."
            )
          );
        return;
      }

      try {
        mkdirSync(withdrawalProofDir, { recursive: true });
        const ext = extname(req.file.originalname) || ".png";
        const filename = `${req.params.id}-${Date.now()}${ext}`;
        writeFileSync(join(withdrawalProofDir, filename), req.file.buffer);
        const paid = ledgerStore.markWithdrawalPaid(req.params.id, filename);
        // Best-effort: loi gui thong bao khong duoc lam fail response, da danh dau "paid" trong DB roi.
        const { token } = ledgerStore.findOrCreateDashboardToken(paid.platform, paid.userId);
        notifyUser(paid.platform, paid.userId, formatWithdrawalPaidReply(`${dashboardBaseUrl}/d/${token}`)).catch(
          (notifyErr) => {
            console.warn("[user-notify] gui thong bao da chuyen khoan that bai:", notifyErr);
          }
        );
        res.redirect(303, "/admin/withdrawals");
      } catch (err) {
        const message = err instanceof AppError ? err.userMessage : "Lỗi không xác định, vui lòng thử lại sau.";
        res
          .status(422)
          .type("html")
          .send(
            renderWithdrawalsPage(
              ledgerStore.listPendingWithdrawals(),
              ledgerStore.listPaidWithdrawals(),
              ledgerStore.getDisplayNamesMap(),
              message
            )
          );
      }
    }
  );

  // Xem lai anh chup bang chung da luu - basename() chan path traversal tu :filename. sendFile can
  // duong dan tuyet doi (resolve tu withdrawalProofDir co the la relative, vd "./data/...").
  app.get("/admin/withdrawal-proofs/:filename", requireAdminAuth, (req: Request, res: Response) => {
    res.sendFile(resolve(withdrawalProofDir, basename(req.params.filename)), (err) => {
      if (err) res.status(404).type("html").send("Không tìm thấy ảnh.");
    });
  });

  app.get("/admin/users", requireAdminAuth, (_req: Request, res: Response) => {
    res.type("html").send(renderUsersPage(ledgerStore.listUsers()));
  });

  // T4 doi chieu dong tien: xem lich su + ghi nhan 1 lan Accesstrade CHUYEN KHOAN THAT cho chu bot,
  // so sanh voi tong da tra user (xem ledgerStore.getReconciliationSummary). receivedAt la ngay
  // Accesstrade THAT SU chuyen (chon tren form, mac dinh hom nay) - khac voi luc admin ghi vao he thong.
  app.get("/admin/accesstrade-payments", requireAdminAuth, (_req: Request, res: Response) => {
    res
      .type("html")
      .send(
        renderAccesstradePaymentsPage(ledgerStore.listAccesstradePayments(), ledgerStore.getReconciliationSummary())
      );
  });

  app.post("/admin/accesstrade-payments", requireAdminAuth, (req: Request, res: Response) => {
    const amountRaw = typeof req.body?.amount === "string" ? req.body.amount.trim() : "";
    const amount = Number(amountRaw);
    const note = typeof req.body?.note === "string" && req.body.note.trim() !== "" ? req.body.note.trim() : undefined;
    const receivedAtDate = typeof req.body?.receivedAt === "string" ? req.body.receivedAt.trim() : "";
    // Chi nhan dung dang "YYYY-MM-DD" tu <input type="date"> - khong hop le/rong thi dung mac dinh
    // (thoi diem ghi) thay vi bao loi, vi day chi la truong ghi chu ngay, khong phai du lieu quan trong.
    const receivedAt = /^\d{4}-\d{2}-\d{2}$/.test(receivedAtDate) ? `${receivedAtDate}T00:00:00.000Z` : undefined;

    if (!Number.isFinite(amount)) {
      res
        .status(422)
        .type("html")
        .send(
          renderAccesstradePaymentsPage(
            ledgerStore.listAccesstradePayments(),
            ledgerStore.getReconciliationSummary(),
            `Số tiền "${amountRaw}" không hợp lệ, vui lòng nhập số.`
          )
        );
      return;
    }

    try {
      ledgerStore.recordAccesstradePayment({ amountVnd: amount, note, receivedAt });
      res.redirect(303, "/admin/accesstrade-payments");
    } catch (err) {
      const errorMessage = err instanceof AppError ? err.userMessage : "Lỗi không xác định, vui lòng thử lại sau.";
      res
        .status(422)
        .type("html")
        .send(
          renderAccesstradePaymentsPage(
            ledgerStore.listAccesstradePayments(),
            ledgerStore.getReconciliationSummary(),
            errorMessage
          )
        );
    }
  });

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
      status:
        typeof req.query.status === "string" && VALID_STATUSES.includes(req.query.status as CommissionStatus)
          ? (req.query.status as CommissionStatus)
          : undefined,
    };
    const entries = ledgerStore.listCommissionEntries(filters);
    res.type("html").send(renderOrdersPage(entries, filters, ledgerStore.getDisplayNamesMap()));
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
    res.type("html").send(renderReverseConfirmPage(entry, displayName, blockedMessage));
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
      res.status(422).type("html").send(renderReverseConfirmPage(entry, displayName));
      return;
    }
    try {
      ledgerStore.reverseCommissionEntry(req.params.id, reason);
      res.redirect(303, "/admin/orders");
    } catch (err) {
      const message = err instanceof AppError ? err.userMessage : "Lỗi không xác định, vui lòng thử lại sau.";
      res.status(422).type("html").send(renderReverseConfirmPage(entry, displayName, message));
    }
  });

  // Ghi nhan don hang tu Accesstrade tren web - thay the (khong thay the, chi THEM lua chon ngoai CLI)
  // cho ledgerAdmin.ts record-conversion / record-conversions-csv. Dung chung logic qua core/orderIngest.ts
  // de khong lap lai (tra subId -> platform/userId/merchant -> ledgerStore.recordConversion).
  app.get("/admin/record-orders", requireAdminAuth, (_req: Request, res: Response) => {
    res.type("html").send(renderRecordOrdersPage(ledgerStore.listImportHistory(20)));
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
        renderRecordOrdersPage(ledgerStore.listImportHistory(20), {
          ok: false,
          message: "Thiếu subId/orderId hoặc orderAmount/commissionAmount không phải số.",
        })
      );
      return;
    }

    try {
      const requestOrderConfig = {
        ...orderConfig,
        userSharePercent: ledgerStore.getUserSharePercent(orderConfig.userSharePercent),
      };
      const entry = recordOrderFromAccesstrade(logStore, ledgerStore, requestOrderConfig, {
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
      // nhat voi accesstradeSync.ts (khong DM cho entry pending). Best-effort - loi gui khong duoc
      // lam fail response, don da ghi vao ledger roi.
      if (entry.status === "confirmed") {
        const { token } = ledgerStore.findOrCreateDashboardToken(entry.platform, entry.userId);
        notifyUser(
          entry.platform,
          entry.userId,
          formatOrdersConfirmedReply(
            [{ orderId: entry.orderId, productName: entry.productName, userShareAmount: entry.userShareAmount }],
            `${dashboardBaseUrl}/d/${token}`
          )
        ).catch((notifyErr) => {
          console.warn("[user-notify] gui thong bao don moi that bai:", notifyErr);
        });
      }
      // Lich su (2026-08-23): form "Ghi 1 don le" luon tao 1 entry MOI (recordOrderFromAccesstrade
      // chi INSERT, khong bao gio UPDATE entry co san) - vi vay khong bao gio co statusTransitions.
      ledgerStore.recordImportHistory({ actionType: "single", newOrderIds: [entry.orderId], statusTransitions: [] });

      const statusLabel = entry.status === "pending" ? "Chờ xác nhận" : "Khả dụng";
      const amountHint =
        entry.status === "pending"
          ? `dự kiến user nhận ~${entry.userShareAmount.toLocaleString("vi-VN")}đ khi được xác nhận`
          : `user nhận ${entry.userShareAmount.toLocaleString("vi-VN")}đ`;
      res.type("html").send(
        renderRecordOrdersPage(ledgerStore.listImportHistory(20), {
          ok: true,
          message: `Đã ghi nhận đơn "${entry.orderId}" (${statusLabel}) - ${amountHint}.`,
        })
      );
    } catch (err) {
      const message = err instanceof AppError ? err.userMessage : "Lỗi không xác định, vui lòng thử lại sau.";
      res.status(422).type("html").send(renderRecordOrdersPage(ledgerStore.listImportHistory(20), { ok: false, message }));
    }
  });

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
            renderRecordOrdersPage(ledgerStore.listImportHistory(20), null, null, "Chưa chọn file báo cáo Shopee nào.")
          );
        return;
      }

      const requestOrderConfig = {
        ...orderConfig,
        userSharePercent: ledgerStore.getUserSharePercent(orderConfig.userSharePercent),
      };
      const result = importShopeeReport(
        logStore,
        ledgerStore,
        { recordOrderConfig: requestOrderConfig },
        req.file.buffer.toString("utf8")
      );
      for (const summary of result.confirmedByUser) {
        const { token } = ledgerStore.findOrCreateDashboardToken(summary.platform, summary.userId);
        notifyUser(
          summary.platform,
          summary.userId,
          formatOrdersConfirmedReply(summary.items, `${dashboardBaseUrl}/d/${token}`)
        ).catch((notifyErr) => {
          console.warn("[user-notify] gui thong bao gop don moi (bao cao Shopee) that bai:", notifyErr);
        });
      }
      // Ghi lich su du ket qua co gi thay doi hay khong (0 don moi/0 doi trang thai) - de admin thay
      // "da chay luc nay" thay vi khong thay gi ca, xem comment LedgerStore.recordImportHistory().
      ledgerStore.recordImportHistory({
        actionType: "csv",
        newOrderIds: result.newOrderIds,
        statusTransitions: result.statusTransitions,
      });
      res.type("html").send(renderRecordOrdersPage(ledgerStore.listImportHistory(20), null, result));
    }
  );

  app.get("/admin/settings", requireAdminAuth, (req: Request, res: Response) => {
    const currentValues: Record<string, string> = {};
    for (const entry of SETTINGS_REGISTRY) {
      currentValues[entry.key] = ledgerStore.getSetting(entry.key, entry.default);
    }
    const successMessage = req.query.saved === "1" ? "Đã lưu thay đổi cấu hình thành công." : null;
    res.type("html").send(renderSettingsPage(currentValues, null, successMessage));
  });

  app.post("/admin/settings", requireAdminAuth, (req: Request, res: Response) => {
    const submitted: Record<string, string> = {};
    const errors: string[] = [];

    for (const entry of SETTINGS_REGISTRY) {
      const raw = typeof req.body?.[entry.key] === "string" ? req.body[entry.key] : "";
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
        const raw = typeof req.body?.[entry.key] === "string" ? req.body[entry.key] : "";
        previewValues[entry.key] = submitted[entry.key] ?? raw;
      }
      res.status(422).type("html").send(renderSettingsPage(previewValues, errors.join(" ")));
      return;
    }

    for (const entry of SETTINGS_REGISTRY) {
      ledgerStore.setSetting(entry.key, submitted[entry.key]);
    }
    res.redirect(303, "/admin/settings?saved=1");
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
