import { env } from "../config/env.js";

export type MerchantId = "shopee" | "lazada" | "tiktokshop";

export interface MerchantConfig {
  id: MerchantId;
  displayName: string;
  hostPattern: RegExp;
  /** Domain rut gon can theo redirect de lay URL that (vi du s.shopee.vn). */
  shortHosts: Set<string>;
  /**
   * Co theo redirect cua shortHosts khong (mac dinh TRUE).
   *
   * `shortHosts` ganh HAI vai tro: nhan dien merchant theo host, VA kich hoat resolve redirect.
   * TikTok can vai tro thu nhat (khong co thi extractProductUrls khong nhat link vt.tiktok.com ra,
   * bot IM LANG) nhung KHONG can vai tro thu hai (RioHub tu resolve, da verify 2026-10-09).
   * Xoa shortHosts di de tat resolve la sai - no tat luon kha nang nhan dien.
   */
  resolveShortLinks?: boolean;
}

const SHOPEE: MerchantConfig = {
  id: "shopee",
  displayName: "Shopee",
  hostPattern: /(^|\.)shopee\.(vn|com|co\.id|com\.my|com\.ph|co\.th|sg)$/i,
  shortHosts: new Set(["s.shopee.vn", "shp.ee", "vn.shp.ee"]),
};

const LAZADA: MerchantConfig = {
  id: "lazada",
  displayName: "Lazada",
  hostPattern: /(^|\.)lazada\.(vn|com|co\.id|com\.my|com\.ph|co\.th|sg)$/i,
  shortHosts: new Set(),
};

const TIKTOK_SHOP: MerchantConfig = {
  id: "tiktokshop",
  displayName: "TikTok Shop",
  hostPattern: /(^|\.)tiktok\.com$/i,
  shortHosts: new Set(["vt.tiktok.com"]),
  resolveShortLinks: false,
};

export interface MerchantRegistryOptions {
  /** TIKTOK_ENABLED. Xem src/config/env.ts. */
  tiktokEnabled: boolean;
}

/**
 * Registry THAT SU khac nhau giua cac instance: instance chua bat TikTok phai giu nguyen hanh vi
 * cu (link TikTok -> RetiredMerchantLinkError), nen tiktokshop nam o danh sach nao la tuy cau hinh.
 * Ham thuan de test doi duoc co ma khong phai mock env. THEM MERCHANT MOI TAI DAY.
 */
export function buildMerchantRegistry(options: MerchantRegistryOptions): {
  active: readonly MerchantConfig[];
  retired: readonly MerchantConfig[];
} {
  return options.tiktokEnabled
    ? { active: [SHOPEE, TIKTOK_SHOP], retired: [LAZADA] }
    : { active: [SHOPEE], retired: [LAZADA, TIKTOK_SHOP] };
}

const defaultRegistry = buildMerchantRegistry({ tiktokEnabled: env.tiktok.enabled });

/** San DANG duoc ho tro - xem buildMerchantRegistry(). */
export const MERCHANTS: readonly MerchantConfig[] = defaultRegistry.active;

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
export const RETIRED_MERCHANTS: readonly MerchantConfig[] = defaultRegistry.retired;

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
