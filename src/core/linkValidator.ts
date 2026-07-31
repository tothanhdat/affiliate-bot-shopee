import { InvalidLinkError, NotShopeeLinkError } from "./errors.js";
import type { ParsedShopeeLink } from "./types.js";

const SHOPEE_HOST_PATTERN = /(^|\.)shopee\.(vn|com|co\.id|com\.my|com\.ph|co\.th|sg)$/i;
const SHOPEE_SHORT_HOSTS = new Set(["s.shopee.vn", "shp.ee", "vn.shp.ee"]);

const URL_IN_TEXT_PATTERN = /https?:\/\/[^\s<>"']+/gi;

/** Tim tat ca URL Shopee (bao gom short link) trong 1 doan text tin nhan. */
export function extractShopeeUrls(text: string): string[] {
  const matches = text.match(URL_IN_TEXT_PATTERN) ?? [];
  return matches.filter((raw) => {
    try {
      const host = new URL(raw).hostname.toLowerCase();
      return SHOPEE_HOST_PATTERN.test(host) || SHOPEE_SHORT_HOSTS.has(host);
    } catch {
      return false;
    }
  });
}

function isShopeeHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return SHOPEE_HOST_PATTERN.test(host) || SHOPEE_SHORT_HOSTS.has(host);
}

function isShopeeShortHost(hostname: string): boolean {
  return SHOPEE_SHORT_HOSTS.has(hostname.toLowerCase());
}

/**
 * Short link Shopee (s.shopee.vn, shp.ee) khong chua shop_id/item_id truc tiep trong URL,
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
    throw new InvalidLinkError("khong the mo short link (co the da het han hoac mang loi)");
  }
  throw new InvalidLinkError("khong the mo short link (co the da het han hoac mang loi)");
}

function extractIds(url: URL): { shopId: string | null; itemId: string | null } {
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
 * Validate + chuan hoa 1 link Shopee tho thanh canonical URL kem shop_id/item_id (neu tach duoc).
 * Khong tach duoc id khong phai loi - co the la link shop/category, van chuyen tiep sang buoc tao affiliate link.
 */
export async function parseShopeeLink(rawUrl: string): Promise<ParsedShopeeLink> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new InvalidLinkError("khong phai URL hop le");
  }

  if (!isShopeeHost(url.hostname)) {
    throw new NotShopeeLinkError();
  }

  if (isShopeeShortHost(url.hostname)) {
    const resolvedUrl = await resolveRedirect(rawUrl);
    let resolved: URL;
    try {
      resolved = new URL(resolvedUrl);
    } catch {
      throw new InvalidLinkError("short link tra ve URL khong hop le");
    }
    if (!isShopeeHost(resolved.hostname)) {
      throw new NotShopeeLinkError();
    }
    const { shopId, itemId } = extractIds(resolved);
    return { canonicalUrl: resolved.toString(), shopId, itemId };
  }

  const { shopId, itemId } = extractIds(url);
  return { canonicalUrl: url.toString(), shopId, itemId };
}
