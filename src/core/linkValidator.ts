import {
  InvalidLinkError,
  NotAProductLinkError,
  RetiredMerchantLinkError,
  UnsupportedMerchantLinkError,
} from "./errors.js";
import { detectMerchantByHost, detectRetiredMerchantByHost, type MerchantConfig } from "./merchants.js";
import type { ParsedProductLink } from "./types.js";

const URL_IN_TEXT_PATTERN = /https?:\/\/[^\s<>"']+/gi;

/**
 * Tim tat ca URL bot can PHAN HOI trong 1 doan text: ca merchant dang ho tro lan san da ngung.
 * San da ngung van phai duoc nhat ra, neu khong adapter se coi nhu tin nhan khong co link va
 * IM LANG (xem RETIRED_MERCHANTS trong merchants.ts).
 */
export function extractProductUrls(text: string): string[] {
  const matches = text.match(URL_IN_TEXT_PATTERN) ?? [];
  return matches.filter((raw) => {
    try {
      const host = new URL(raw).hostname;
      return detectMerchantByHost(host) !== null || detectRetiredMerchantByHost(host) !== null;
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
 * Tach shop_id/item_id tu URL - hien chi xac minh pattern cho Shopee. Khong tach duoc id KHONG
 * phai loi: metadata nay la optional (xem ResolveLinkResult), khong doan mo regex cho merchant
 * chua co pattern duoc kiem chung.
 */
function extractIds(merchant: MerchantConfig, url: URL): { shopId: string | null; itemId: string | null } {
  if (merchant.id === "shopee") {
    // Dang: /ten-san-pham-i.{shopId}.{itemId}
    const iPatternMatch = url.pathname.match(/-i\.(\d+)\.(\d+)(?:$|[/?])/);
    if (iPatternMatch) {
      return { shopId: iPatternMatch[1], itemId: iPatternMatch[2] };
    }
    // Dang: /product/{shopId}/{itemId} va /opaanlp/{shopId}/{itemId}.
    // "opaanlp" la segment CO DINH (khong phai slug ten san pham) app Shopee dung khi nguoi dung
    // bam "Chia se" - do tren du lieu that 2026-09-29: 58/90 link trong short_links la dang nay,
    // /product/ chi 30. Chi khop dung 2 segment DA XAC MINH, KHONG dung /{bat-ky}/{id}/{id} (xem
    // "khong doan mo regex" trong CLAUDE.md) vi trang shop/category cung co dang 2 so tuong tu.
    // Tach duoc id la quan trong hon metadata: ShopeeAffiliateProvider dung chung de rut origin_link
    // ve shopee.vn/product/{shop}/{item}, bo query string ~700 ky tu cua link goc (credential_token,
    // gads_t_sig, uls_trackid, va ca tham so affiliate cua NGUOI KHAC neu link duoc chia se lai).
    const productPatternMatch = url.pathname.match(/\/(?:product|opaanlp)\/(\d+)\/(\d+)/);
    if (productPatternMatch) {
      return { shopId: productPatternMatch[1], itemId: productPatternMatch[2] };
    }
    return { shopId: null, itemId: null };
  }

  return { shopId: null, itemId: null };
}

/**
 * sv.shopee.vn la subdomain rieng cho Shopee Video (link dang /share-video/...), khong co noi
 * dung san pham nao o day - khac voi cac trang shopee.vn khac (shop/category/campaign...) van
 * hop le du khong tach duoc shopId/itemId. Phat hien qua bug that (2026-08-28): bot tung tao
 * link an_redir voi origin_link tro thang toi trang video nay, nhung phien click dung o trang
 * video/live la truong hop Shopee KHONG tinh hoa hong (xem canh bao "Khong xem video/live trong
 * phien" da co san trong SUCCESS_REPLY_TEMPLATE_DEFAULT, replyText.ts) - nen link tao ra vo ich,
 * tu choi ngay tu dau thay vi tao 1 link chac chan khong ra hoa hong.
 */
function isShopeeVideoLink(url: URL): boolean {
  return url.hostname.toLowerCase() === "sv.shopee.vn";
}

/**
 * Ghep merchant + canonical URL thanh ParsedProductLink, kem validate rieng cho Shopee Video:
 * case nay bi tu choi hang NotAProductLinkError thay vi coi id rong la optional metadata
 * (khac cac URL Shopee khac, xem extractIds()).
 */
function buildParsedLink(merchant: MerchantConfig, canonicalUrl: URL): ParsedProductLink {
  if (merchant.id === "shopee" && isShopeeVideoLink(canonicalUrl)) {
    throw new NotAProductLinkError(merchant.displayName);
  }
  const { shopId, itemId } = extractIds(merchant, canonicalUrl);
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

  // Chan truoc khi resolve redirect: short link cua san da ngung (vd vt.tiktok.com) khong can
  // goi mang lam gi, ket qua da biet truoc.
  if (detectRetiredMerchantByHost(url.hostname)) {
    throw new RetiredMerchantLinkError();
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
