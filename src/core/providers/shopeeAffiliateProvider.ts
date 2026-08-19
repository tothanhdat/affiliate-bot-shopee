import { MerchantNotConfiguredError } from "../errors.js";
import { getMerchantConfig, type MerchantId } from "../merchants.js";
import type {
  AffiliateProvider,
  CreateAffiliateLinkInput,
  CreateAffiliateLinkOutput,
  PromotionItem,
} from "../affiliateProvider.js";

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
 * CHI xu ly duoc merchant "shopee" - dung CompositeAffiliateProvider (compositeProvider.ts) de
 * ket hop voi provider khac (vd AccesstradeProvider) cho Lazada/TikTok Shop.
 *
 * T3.2 (2026-08-19): link an_redir tu build dai ~150-290+ ky tu (khong gon nhu link Custom Link/
 * Accesstrade tra ve) - rut gon qua route rieng GET /s/:code (server.ts) truoc khi tra ve cho user.
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
    return { affiliateUrl: `${this.config.shortLinkBaseUrl}/s/${code}` };
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
