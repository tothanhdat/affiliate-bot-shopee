export type MerchantId = "shopee" | "lazada" | "tiktokshop";

export interface MerchantConfig {
  id: MerchantId;
  displayName: string;
  hostPattern: RegExp;
  /** Domain rut gon can theo redirect de lay URL that (vi du s.shopee.vn). */
  shortHosts: Set<string>;
}

/** San DANG duoc ho tro - THEM MERCHANT MOI TAI DAY. */
export const MERCHANTS: readonly MerchantConfig[] = [
  {
    id: "shopee",
    displayName: "Shopee",
    hostPattern: /(^|\.)shopee\.(vn|com|co\.id|com\.my|com\.ph|co\.th|sg)$/i,
    shortHosts: new Set(["s.shopee.vn", "shp.ee", "vn.shp.ee"]),
  },
];

/**
 * San TUNG duoc ho tro, da ngung tu 2026-09-29 (Accesstrade/TikTok cap nhat trang thai don
 * qua cham). KHONG tao link duoc nua. Danh sach nay ton tai vi HAI ly do, ca hai deu bat buoc:
 *
 *  1. Ledger that con entry merchant='tiktokshop'/'lazada' - getMerchantConfig() phai tra duoc
 *     displayName cho chung, neu khong trang /admin/orders se CRASH khi render don cu.
 *  2. Link cua 2 san nay phai bi tu choi TU TE (RetiredMerchantLinkError trong linkValidator.ts)
 *     thay vi bi bo qua am tham. extractProductUrls() loc URL theo registry, nen neu chi xoa
 *     merchant di thi link TikTok se khong duoc nhat ra khoi tin nhan -> bot IM LANG trong
 *     Zalo DM, user tuong bot hong.
 */
export const RETIRED_MERCHANTS: readonly MerchantConfig[] = [
  {
    id: "lazada",
    displayName: "Lazada",
    hostPattern: /(^|\.)lazada\.(vn|com|co\.id|com\.my|com\.ph|co\.th|sg)$/i,
    shortHosts: new Set(),
  },
  {
    id: "tiktokshop",
    displayName: "TikTok Shop",
    hostPattern: /(^|\.)tiktok\.com$/i,
    shortHosts: new Set(["vt.tiktok.com"]),
  },
];

function matchesHost(merchant: MerchantConfig, host: string): boolean {
  return merchant.hostPattern.test(host) || merchant.shortHosts.has(host);
}

/** Merchant DANG ho tro - quyet dinh co xu ly link hay khong. */
export function detectMerchantByHost(hostname: string): MerchantConfig | null {
  const host = hostname.toLowerCase();
  return MERCHANTS.find((m) => matchesHost(m, host)) ?? null;
}

/** Merchant DA NGUNG - chi de tra loi user cho tu te, khong bao gio tao link. */
export function detectRetiredMerchantByHost(hostname: string): MerchantConfig | null {
  const host = hostname.toLowerCase();
  return RETIRED_MERCHANTS.find((m) => matchesHost(m, host)) ?? null;
}

/** Tra CA hai danh sach - don cu trong ledger van phai hien dung ten san. */
export function getMerchantConfig(id: MerchantId): MerchantConfig {
  const merchant = [...MERCHANTS, ...RETIRED_MERCHANTS].find((m) => m.id === id);
  if (!merchant) {
    throw new Error(`Unknown merchant id: ${id}`);
  }
  return merchant;
}
