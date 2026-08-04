export type MerchantId = "shopee" | "lazada";

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
