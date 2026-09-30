import { MerchantNotConfiguredError } from "../errors.js";
import { getMerchantConfig, type MerchantId } from "../merchants.js";
import type {
  AffiliateProvider,
  CommissionEstimate,
  CreateAffiliateLinkInput,
  CreateAffiliateLinkOutput,
  PromotionItem,
} from "../affiliateProvider.js";
import type { CommissionLookup } from "../commissionLookup.js";

export interface ShopeeAffiliateProviderConfig {
  /** affiliate_id co dinh cua tai khoan (affiliate.shopee.vn/account_setting), khong doi/khong can xin cap lai. */
  affiliateId: string;
  /**
   * Tao 1 short link tro toi targetUrl, tra ve code (dung boi T3.2 - xem LogStore.createShortLink).
   * Injected thay vi tu import LogStore truc tiep de provider khong phu thuoc ca 1 class luu tru
   * day du (chi can dung 1 ham nay), de test khong can khoi tao SQLite that.
   */
  createShortLink: (targetUrl: string) => string;
  /** Base URL cong khai de build link rut gon gui cho user, vi du "https://bot.example.com" (khong co dau / cuoi). */
  shortLinkBaseUrl: string;
  /**
   * Tra hoa hong uoc tinh cua san pham (2026-10-01) - TUY CHON. Khong truyen (COMMISSION_LOOKUP_ENABLED
   * =false) thi createAffiliateLink khong tra commissionEstimate va bot giu nguyen tin nhan cu.
   * Injected giong createShortLink de test khong can goi mang that.
   */
  commissionLookup?: CommissionLookup | null;
}

/**
 * Tu build link affiliate Shopee qua co che "an_redir" CHINH THUC cua Shopee - KHONG can Open API
 * (app_id/secret_key), chi can affiliate_id co dinh cua tai khoan. Xem spec_bot_ap_ma_shopee.md
 * muc 5/T3.1 de biet day du boi canh: Shopee tu choi cap Open API cho tai khoan KOC ca nhan
 * (2026-08-17), sau do phat hien + verify duoc co che nay khong can Open API (2026-08-19).
 *
 * Da verify that qua trinh duyet (2026-08-19): link tu build (khong qua Custom Link, khong qua
 * buoc rut gon nao) resolve dung CUNG 1 trang san pham voi link tao qua Custom Link portal, sub_id
 * giu nguyen dung trong utm_content - dung slot ma bot dang dung de doi soat qua subId.
 *
 * CHI xu ly duoc merchant "shopee" - tu 2026-09-29 day cung la merchant duy nhat trong scope,
 * nen no la provider that duy nhat (xem providers/index.ts).
 *
 * T3.2 (2026-08-19): link an_redir tu build dai ~150-290+ ky tu (khong gon nhu link Custom Link)
 * - rut gon qua route rieng GET /s/:code (server.ts) truoc khi tra ve cho user.
 * QUAN TRONG de khong pha tracking: route do PHAI la 302 redirect THAT sang chinh URL an_redir nay,
 * KHONG duoc fetch/proxy noi dung trang dich roi render lai - phai de trinh duyet cua user tu nhay
 * tiep sang s.shopee.vn/an_redir?..., giu nguyen toan bo cookie/uls_trackid Shopee tu sinh phia ho.
 */
export class ShopeeAffiliateProvider implements AffiliateProvider {
  constructor(private readonly config: ShopeeAffiliateProviderConfig) {}

  async createAffiliateLink(input: CreateAffiliateLinkInput): Promise<CreateAffiliateLinkOutput> {
    if (input.merchant !== "shopee") {
      throw new MerchantNotConfiguredError(getMerchantConfig(input.merchant).displayName);
    }

    // origin_link gon (shopee.vn/product/{shopId}/{itemId}) khi tach duoc shop_id/item_id - ngan
    // hon han giu nguyen slug ten san pham tieng Viet cua link goc. Neu khong tach duoc (link
    // shop/category/campaign, hoac pattern URL chua duoc xac minh trong extractIds()) fallback ve
    // chinh productUrl da resolve - giong cach Custom Link xu ly duoc moi loai trang Shopee,
    // khong chi trang san pham (xem nguon-kien-thuc-shopee-affiliate-portal.md muc 3).
    const originLink =
      input.shopId && input.itemId
        ? `https://shopee.vn/product/${input.shopId}/${input.itemId}`
        : input.productUrl;

    const url = new URL("https://s.shopee.vn/an_redir");
    url.searchParams.set("origin_link", originLink);
    url.searchParams.set("affiliate_id", this.config.affiliateId);
    url.searchParams.set("sub_id", input.subId);

    const code = this.config.createShortLink(url.toString());
    const affiliateUrl = `${this.config.shortLinkBaseUrl}/s/${code}`;

    // Uoc tinh hoa hong CHI tra duoc khi tach duoc item_id (link san pham). Link shop/category/
    // campaign khong co item_id -> bo qua, KHONG phai loi. Lookup tu nuot moi loi thanh null
    // (xem commissionLookup.ts) nen khong can try/catch o day - tinh nang phu khong duoc phep
    // lam hong viec tra link.
    const commissionEstimate =
      this.config.commissionLookup && input.itemId
        ? await this.toEstimate(this.config.commissionLookup, input.itemId)
        : null;

    return { affiliateUrl, commissionEstimate };
  }

  private async toEstimate(
    lookup: CommissionLookup,
    itemId: string
  ): Promise<CommissionEstimate | null> {
    const found = await lookup.lookup(itemId);
    if (!found) return null;
    return {
      ratePercent: found.ratePercent,
      estimatedAmount: found.commissionAmount,
      currency: "VND",
    };
  }

  /**
   * Da xac nhan Shopee Direct KHONG co nguon coupon chung tuong duong (ca 3 muc Hoa hong Shopee/
   * San pham/Uu dai doc quyen deu gan theo tung san pham cu the, khong phai danh sach ma giam gia
   * chung cua merchant) - xem nguon-kien-thuc-shopee-affiliate-portal.md muc 8. Tra ve rong thay
   * vi bao loi, vi PROMOTIONS_DISPLAY_LIMIT mac dinh da tat cho Shopee.
   */
  async getPromotions(_merchant: MerchantId, _limit: number): Promise<PromotionItem[]> {
    return [];
  }
}
