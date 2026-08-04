import { InvalidLinkError, UnsupportedMerchantLinkError } from "./errors.js";
import { detectMerchantByHost, type MerchantConfig } from "./merchants.js";
import type { ParsedProductLink } from "./types.js";

const URL_IN_TEXT_PATTERN = /https?:\/\/[^\s<>"']+/gi;

/** Tim tat ca URL cua cac merchant duoc ho tro (bao gom short link) trong 1 doan text tin nhan. */
export function extractProductUrls(text: string): string[] {
  const matches = text.match(URL_IN_TEXT_PATTERN) ?? [];
  return matches.filter((raw) => {
    try {
      const host = new URL(raw).hostname;
      return detectMerchantByHost(host) !== null;
    } catch {
      return false;
    }
  });
}

/**
 * Short link (vi du s.shopee.vn, shp.ee) khong chua shop_id/item_id truc tiep trong URL,
 * can theo redirect de lay URL that. Dung HEAD truoc, fallback GET neu server khong ho tro HEAD.
 */
async function resolveRedirect(shortUrl: string): Promise<string> {
  try {
    const res = await fetch(shortUrl, { method: "HEAD", redirect: "follow" });
    if (res.url) return res.url;
  } catch {
    // fallthrough to GET
  }
  try {
    const res = await fetch(shortUrl, { method: "GET", redirect: "follow" });
    await res.body?.cancel();
    if (res.url) return res.url;
  } catch (err) {
    throw new InvalidLinkError("không thể mở short link (có thể đã hết hạn hoặc mạng lỗi)");
  }
  throw new InvalidLinkError("khong the mo short link (co the da het han hoac mang loi)");
}

/**
 * Tach shop_id/item_id tu URL - hien chi xac minh pattern cho Shopee. Voi merchant
 * khac (vi du Lazada) chua co pattern duoc kiem chung, tra ve null thay vi doan mo.
 * Khong tach duoc id khong phai loi - metadata nay la optional (xem ResolveLinkResult).
 */
function extractIds(merchant: MerchantConfig, url: URL): { shopId: string | null; itemId: string | null } {
  if (merchant.id !== "shopee") {
    return { shopId: null, itemId: null };
  }
  // Dang: /ten-san-pham-i.{shopId}.{itemId}
  const iPatternMatch = url.pathname.match(/-i\.(\d+)\.(\d+)(?:$|[/?])/);
  if (iPatternMatch) {
    return { shopId: iPatternMatch[1], itemId: iPatternMatch[2] };
  }
  // Dang: /product/{shopId}/{itemId}
  const productPatternMatch = url.pathname.match(/\/product\/(\d+)\/(\d+)/);
  if (productPatternMatch) {
    return { shopId: productPatternMatch[1], itemId: productPatternMatch[2] };
  }
  return { shopId: null, itemId: null };
}

/**
 * Validate + chuan hoa 1 link san pham tho thanh canonical URL kem merchant + shop_id/item_id (neu tach duoc).
 */
export async function parseProductLink(rawUrl: string): Promise<ParsedProductLink> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new InvalidLinkError("không phải URL hợp lệ");
  }

  const merchant = detectMerchantByHost(url.hostname);
  if (!merchant) {
    throw new UnsupportedMerchantLinkError();
  }

  if (merchant.shortHosts.has(url.hostname.toLowerCase())) {
    const resolvedUrl = await resolveRedirect(rawUrl);
    let resolved: URL;
    try {
      resolved = new URL(resolvedUrl);
    } catch {
      throw new InvalidLinkError("short link trả về URL không hợp lệ");
    }
    const resolvedMerchant = detectMerchantByHost(resolved.hostname);
    if (!resolvedMerchant) {
      throw new UnsupportedMerchantLinkError();
    }
    const { shopId, itemId } = extractIds(resolvedMerchant, resolved);
    return { merchant: resolvedMerchant.id, canonicalUrl: resolved.toString(), shopId, itemId };
  }

  const { shopId, itemId } = extractIds(merchant, url);
  return { merchant: merchant.id, canonicalUrl: url.toString(), shopId, itemId };
}
