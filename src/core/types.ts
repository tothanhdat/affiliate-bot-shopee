import type { MerchantId } from "./merchants.js";

export type Platform = "telegram" | "zalo" | "http";

export interface ParsedProductLink {
  merchant: MerchantId;
  /** URL san pham sau khi da resolve short domain (neu co) */
  canonicalUrl: string;
  shopId: string | null;
  itemId: string | null;
}

export interface ResolveLinkRequest {
  url: string;
  platform: Platform;
  /** id nguoi dung tren platform goc, dung de rate-limit va log, khong bat buoc voi platform=http */
  userId: string;
}

export interface ResolveLinkResult {
  merchant: MerchantId;
  originalUrl: string;
  canonicalUrl: string;
  affiliateUrl: string;
  shopId: string | null;
  itemId: string | null;
  subId: string;
}

export type RequestOutcome = "success" | "error";

export interface RequestLogEntry {
  id: string;
  timestamp: string;
  platform: Platform;
  /** null khi loi xay ra truoc khi xac dinh duoc merchant (vi du URL khong hop le) */
  merchant: MerchantId | null;
  userId: string;
  originalUrl: string;
  subId: string | null;
  outcome: RequestOutcome;
  errorCode: string | null;
  affiliateUrl: string | null;
}
