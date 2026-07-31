import express, { type Request, type Response, type NextFunction } from "express";
import { AppError } from "../core/errors.js";
import type { LinkResolverService } from "../core/linkResolverService.js";
import type { LogStore } from "../core/logStore.js";
import type { Platform } from "../core/types.js";

const VALID_PLATFORMS: Platform[] = ["telegram", "zalo", "http"];

export function createServer(resolver: LinkResolverService, logStore: LogStore) {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
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

  // T1.4 acceptance: query lai lich su theo ngay/platform.
  app.get("/api/v1/logs", (req: Request, res: Response) => {
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    const platform =
      typeof req.query.platform === "string" && VALID_PLATFORMS.includes(req.query.platform as Platform)
        ? (req.query.platform as Platform)
        : undefined;

    if (!from || !to) {
      res.status(400).json({
        success: false,
        error: { code: "INVALID_QUERY", message: "Can query param 'from' va 'to' (YYYY-MM-DD)." },
      });
      return;
    }

    const entries = logStore.queryByDateRange(from, to, platform);
    res.status(200).json({ success: true, data: entries });
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
