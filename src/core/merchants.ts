export type MerchantId = "shopee" | "lazada" | "tiktokshop";

export interface MerchantConfig {
  id: MerchantId;
  displayName: string;
  hostPattern: RegExp;
  /**
   * Domain rut gon can theo redirect de lay URL that (vi du s.shopee.vn).
   * Lazada: CHUA xac minh co ton tai short-domain rieng hay khong - de trong,
   * neu phat hien domain rut gon that cua Lazada thi bo sung sau.
   */
  shortHosts: Set<string>;
}

export const MERCHANTS: readonly MerchantConfig[] = [
  {
    id: "shopee",
    displayName: "Shopee",
    hostPattern: /(^|\.)shopee\.(vn|com|co\.id|com\.my|com\.ph|co\.th|sg)$/i,
    shortHosts: new Set(["s.shopee.vn", "shp.ee", "vn.shp.ee"]),
  },
  {
    id: "lazada",
    displayName: "Lazada",
    hostPattern: /(^|\.)lazada\.(vn|com|co\.id|com\.my|com\.ph|co\.th|sg)$/i,
    shortHosts: new Set(),
  },
  {
    id: "tiktokshop",
    displayName: "TikTok Shop",
    // tiktok.com dung chung cho ca video thuong lan san pham TikTok Shop - khong tach rieng
    // duoc bang domain, nen link khong phai san pham se bi extractIds() (linkValidator.ts)
    // tu choi bang NotAProductLinkError thay vi xu ly nham nhu link san pham.
    hostPattern: /(^|\.)tiktok\.com$/i,
    // Da xac minh that (2026-08-18): link share tu app/Shop tab dung domain nay, resolve thang
    // ra www.tiktok.com/view/product/{id}. Chua xac minh cac domain rut gon khac (vm.tiktok.com...).
    shortHosts: new Set(["vt.tiktok.com"]),
  },
];

export function detectMerchantByHost(hostname: string): MerchantConfig | null {
  const host = hostname.toLowerCase();
  for (const merchant of MERCHANTS) {
    if (merchant.hostPattern.test(host) || merchant.shortHosts.has(host)) {
      return merchant;
    }
  }
  return null;
}

export function getMerchantConfig(id: MerchantId): MerchantConfig {
  const merchant = MERCHANTS.find((m) => m.id === id);
  if (!merchant) {
    throw new Error(`Unknown merchant id: ${id}`);
  }
  return merchant;
}
