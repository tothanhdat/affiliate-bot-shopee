import multer from "multer";
import type { Express, Request, RequestHandler, Response, NextFunction } from "express";
import type { LedgerStore } from "../core/ledgerStore.js";
import { AppError, InvalidTipError } from "../core/errors.js";
import { TIP_IMAGE_MAX_BYTES, deleteTipImage, saveTipImage } from "../core/tipImage.js";
import { adminShell } from "./adminHtml.js";
import { renderAdminTipsPage, type TipsAdminDraft } from "./adminTipsHtml.js";

/**
 * Route cua Tips (2026-10-14), tach khoi server.ts (da qua dai). Xem
 * docs/superpowers/specs/2026-10-14-tips-slide-design.md muc 4, 5 va 7.
 */

export interface TipsRoutesDeps {
  ledgerStore: LedgerStore;
  tipsImageDir: string;
  /** Redirect ve /admin/login neu chua dang nhap (dung cho route tra HTML). */
  requireAdminAuth: RequestHandler;
  /** Chi hoi co dang nhap hay khong (dung cho route JSON, de tu tra 401 thay vi redirect). */
  isAdminSession: (req: Request) => boolean;
  navPendingWithdrawals: () => number;
}

// 5MB la TRAN cua tung anh; file qua gioi han bi multer chan (LIMIT_FILE_SIZE) va doi thanh thong bao 422 ben duoi.
const tipUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: TIP_IMAGE_MAX_BYTES } });

/**
 * Boc multer de loi (qua dung luong...) KHONG roi xuong error handler chung (tra JSON 500) ma thanh thong bao
 * hien tren trang: luu vao res.locals, route doc lai va tra 422 kem chu admin da go.
 */
function parseTipForm(req: Request, res: Response, next: NextFunction): void {
  tipUpload.single("image")(req, res, (err: unknown) => {
    if (err) {
      res.locals.tipUploadError =
        err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
          ? "Ảnh quá lớn, tối đa 5MB."
          : "Không đọc được file tải lên, hãy thử lại.";
    }
    next();
  });
}

function failOnUploadError(res: Response): void {
  if (typeof res.locals.tipUploadError === "string") throw new InvalidTipError(res.locals.tipUploadError);
}

function parseTipId(raw: string): number | null {
  return /^[0-9]+$/.test(raw) ? Number(raw) : null;
}

function userMessageOf(err: unknown): string {
  if (err instanceof AppError) return err.userMessage;
  console.error("[tips] loi khong xac dinh:", err);
  return "Lỗi không xác định, vui lòng thử lại sau.";
}

const NOT_FOUND_MESSAGE = "Không tìm thấy Tip này (có thể đã bị xoá).";

export function registerTipsRoutes(app: Express, deps: TipsRoutesDeps): void {
  const { ledgerStore, tipsImageDir, requireAdminAuth, navPendingWithdrawals } = deps;

  function sendPage(res: Response, status: number, extra: { errorMessage?: string; draft?: TipsAdminDraft } = {}): void {
    res
      .status(status)
      .type("html")
      .send(
        adminShell(
          "tips",
          "Tips",
          renderAdminTipsPage({ tips: ledgerStore.listTips(), ...extra }),
          navPendingWithdrawals()
        )
      );
  }

  function readFields(req: Request): { title: string; description: string } {
    return {
      title: typeof req.body?.title === "string" ? req.body.title : "",
      description: typeof req.body?.description === "string" ? req.body.description : "",
    };
  }

  app.get("/admin/tips", requireAdminAuth, (_req: Request, res: Response) => {
    sendPage(res, 200);
  });

  app.post("/admin/tips", requireAdminAuth, parseTipForm, (req: Request, res: Response) => {
    const fields = readFields(req);
    let savedImage: string | null = null;
    try {
      failOnUploadError(res);
      if (req.file) savedImage = saveTipImage(tipsImageDir, req.file.buffer);
      ledgerStore.createTip({ ...fields, imagePath: savedImage });
      res.redirect(303, "/admin/tips");
    } catch (err) {
      // DB khong ghi duoc thi khong de file vua luu thanh file mo coi.
      deleteTipImage(tipsImageDir, savedImage);
      sendPage(res, 422, { errorMessage: userMessageOf(err), draft: { id: null, ...fields } });
    }
  });

  // PHAI khai bao TRUOC "/admin/tips/:id" - neu khong "reorder" bi hieu la mot :id. Route JSON nen tu kiem tra
  // dang nhap de tra 401 JSON (cong cu/fetch khong xu ly duoc redirect ve trang login).
  app.post("/admin/tips/reorder", (req: Request, res: Response) => {
    if (!deps.isAdminSession(req)) {
      res.status(401).json({ ok: false, message: "Chưa đăng nhập hoặc phiên đã hết hạn, hãy tải lại trang." });
      return;
    }
    const ids = req.body?.ids;
    if (!Array.isArray(ids)) {
      res.status(422).json({ ok: false, message: "Danh sách thứ tự không hợp lệ." });
      return;
    }
    try {
      ledgerStore.reorderTips(ids as number[]);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(422).json({ ok: false, message: err.userMessage });
        return;
      }
      throw err;
    }
  });

  app.post("/admin/tips/:id", requireAdminAuth, parseTipForm, (req: Request, res: Response) => {
    const id = parseTipId(req.params.id);
    if (id === null || ledgerStore.getTipById(id) === null) {
      sendPage(res, 404, { errorMessage: NOT_FOUND_MESSAGE });
      return;
    }
    const fields = readFields(req);
    const action = typeof req.body?.imageAction === "string" ? req.body.imageAction : "keep";
    let savedImage: string | null = null;
    try {
      failOnUploadError(res);
      // Co file va khong phai "bo anh" -> thay anh, ke ca khi radio van de "Giu nguyen": chon file xong ma bi bo qua im lang la bay.
      let nextImage: string | null | undefined = undefined;
      if (req.file && action !== "remove") {
        savedImage = saveTipImage(tipsImageDir, req.file.buffer);
        nextImage = savedImage;
      } else if (action === "replace") {
        throw new InvalidTipError("Bạn chọn “Thay ảnh” nhưng chưa chọn file ảnh nào.");
      } else if (action === "remove") {
        nextImage = null;
      }
      const result = ledgerStore.updateTip(id, { ...fields, imagePath: nextImage });
      if (result === null) {
        deleteTipImage(tipsImageDir, savedImage);
        sendPage(res, 404, { errorMessage: NOT_FOUND_MESSAGE });
        return;
      }
      // Chi xoa file cu SAU khi DB da ghi xong.
      if (nextImage !== undefined) deleteTipImage(tipsImageDir, result.previousImagePath);
      res.redirect(303, "/admin/tips");
    } catch (err) {
      deleteTipImage(tipsImageDir, savedImage);
      sendPage(res, 422, { errorMessage: userMessageOf(err), draft: { id, ...fields } });
    }
  });

  app.post("/admin/tips/:id/active", requireAdminAuth, (req: Request, res: Response) => {
    const id = parseTipId(req.params.id);
    const active = req.body?.active === "1";
    if (id === null || !ledgerStore.setTipActive(id, active)) {
      sendPage(res, 404, { errorMessage: NOT_FOUND_MESSAGE });
      return;
    }
    res.redirect(303, "/admin/tips");
  });

  app.post("/admin/tips/:id/delete", requireAdminAuth, (req: Request, res: Response) => {
    const id = parseTipId(req.params.id);
    const removed = id === null ? null : ledgerStore.deleteTip(id);
    if (removed === null) {
      sendPage(res, 404, { errorMessage: NOT_FOUND_MESSAGE });
      return;
    }
    deleteTipImage(tipsImageDir, removed.imagePath);
    res.redirect(303, "/admin/tips");
  });
}
