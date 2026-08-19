import { InvalidLinkError, NotAProductLinkError, UnsupportedMerchantLinkError } from "./errors.js";
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

// Khong co timeout truoc day khien 1 short link (vd vt.tiktok.com) cham/khong phan hoi lam
// treo VO THOI HAN ca luong xu ly tin nhan (khong loi, khong tra loi, khong log gi) - phat
// hien qua Zalo Group Adapter "im lang" du listener nhan dung tin nhan (2026-08-19).
const SHORT_LINK_TIMEOUT_MS = 8000;

/**
 * Short link (vi du s.shopee.vn, shp.ee) khong chua shop_id/item_id truc tiep trong URL,
 * can theo redirect de lay URL that. Dung HEAD truoc, fallback GET neu server khong ho tro HEAD.
 */
async function resolveRedirect(shortUrl: string): Promise<string> {
  try {
    const res = await fetch(shortUrl, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(SHORT_LINK_TIMEOUT_MS),
    });
    if (res.url) return res.url;
  } catch {
    // fallthrough to GET
  }
  try {
    const res = await fetch(shortUrl, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(SHORT_LINK_TIMEOUT_MS),
    });
    await res.body?.cancel();
    if (res.url) return res.url;
  } catch (err) {
    throw new InvalidLinkError("không thể mở short link (có thể đã hết hạn hoặc mạng lỗi)");
  }
  throw new InvalidLinkError("khong the mo short link (co the da het han hoac mang loi)");
}

/**
 * Tach shop_id/item_id tu URL - hien chi xac minh pattern cho Shopee va TikTok Shop.
 * Voi merchant khac (vi du Lazada) chua co pattern duoc kiem chung, tra ve null thay
 * vi doan mo. Voi Shopee, khong tach duoc id KHONG phai loi - metadata nay la optional
 * (xem ResolveLinkResult). Voi TikTok Shop thi khac: itemId (product_id) la BAT BUOC
 * de goi duoc AccesstradeProvider (xem accesstradeProvider.ts) - buildParsedLink() ben
 * duoi se nem NotAProductLinkError neu tach that bai, KHONG coi la optional metadata.
 */
function extractIds(merchant: MerchantConfig, url: URL): { shopId: string | null; itemId: string | null } {
  if (merchant.id === "shopee") {
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

  if (merchant.id === "tiktokshop") {
    // Dang da xac minh that (2026-08-18): /view/product/{productId}
    const productMatch = url.pathname.match(/\/view\/product\/(\d+)/);
    if (productMatch) {
      return { shopId: null, itemId: productMatch[1] };
    }
    return { shopId: null, itemId: null };
  }

  return { shopId: null, itemId: null };
}

/**
 * Ghep merchant + canonical URL thanh ParsedProductLink, kem validate rieng cho TikTok
 * Shop: itemId la bat buoc (khac Shopee) vi tiktok.com dung chung cho ca video thuong -
 * link khong khop pattern /view/product/{id} coi nhu KHONG PHAI link san pham, tu choi
 * ro rang thay vi goi API voi du lieu thieu.
 */
function buildParsedLink(merchant: MerchantConfig, canonicalUrl: URL): ParsedProductLink {
  const { shopId, itemId } = extractIds(merchant, canonicalUrl);
  if (merchant.id === "tiktokshop" && itemId === null) {
    throw new NotAProductLinkError(merchant.displayName);
  }
  return { merchant: merchant.id, canonicalUrl: canonicalUrl.toString(), shopId, itemId };
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
    return buildParsedLink(resolvedMerchant, resolved);
  }

  return buildParsedLink(merchant, url);
}
