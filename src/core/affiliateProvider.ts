import type { MerchantId } from "./merchants.js";

export interface CreateAffiliateLinkInput {
  merchant: MerchantId;
  /** URL san pham da chuan hoa (canonical) */
  productUrl: string;
  /** id dung de tracking/doi soat hoa hong, xem T1.4 */
  subId: string;
  /**
   * shop_id da tach san tu linkValidator.ts (Shopee). Optional - null neu link khong khop pattern
   * tach duoc (vd link shop/category/campaign) hoac merchant khac Shopee. ShopeeAffiliateProvider
   * dung gia tri nay (cung itemId) de dung origin_link gon thay vi giu nguyen productUrl.
   */
  shopId?: string | null;
  /**
   * id san pham da tach san tu linkValidator.ts (item_id cua Shopee).
   * Optional - metadata thoi, khong provider nao con bat buoc phai co tu 2026-09-29
   * (TikTok Shop - truong hop duy nhat tung bat buoc - da bi bo khoi scope).
   */
  itemId?: string | null;
}

export interface CommissionEstimate {
  /** % hoa hong GOC (chua tru thue/phi, chua chia % cho user) - vd 3.9 nghia la 3.9% */
  ratePercent: number;
  /** so tien hoa hong GOC uoc tinh, tinh theo gia ban hien tai - CO THE DOI theo thoi gian/gia that luc mua */
  estimatedAmount: number;
  currency: string;
}

export interface CreateAffiliateLinkOutput {
  affiliateUrl: string;
  /**
   * true = da xac minh san pham nay KHONG co hoa hong (chua bat), khac han voi commissionEstimate
   * rong vi "khong tra duoc". Bot dung co nay de bao thang cho user thay vi hen "doi Shopee xac
   * nhan don" - loi hen do se khong bao gio den.
   */
  noCommission?: boolean;
  /**
   * Uoc tinh hoa hong theo du lieu CHINH THUC tu nguon affiliate (khong phai scrape) - optional.
   * Hien KHONG provider nao con tra ve gia tri nay (nguon duy nhat tung co la TikTok Shop qua
   * Accesstrade, da bi bo khoi scope 2026-09-29). Giu lai vi day la field cua interface chung.
   */
  commissionEstimate?: CommissionEstimate | null;
  /**
   * Ten san pham, neu nguon affiliate tinh co biet (Shopee: di kem ket qua tra hoa hong, khong
   * ton request rieng). Chi dung de GHI LOG cho /admin/links - KHONG duoc dua vao tin nhan tra
   * link: ten do la ten ben thu ba tra ve, khong phai thong tin bot tu xac minh.
   */
  productName?: string | null;
}

export interface PromotionItem {
  /** ma coupon, dung de nhap tay luc thanh toan */
  couponCode: string;
  /** mo ta khuyen mai (thuong da chua % giam, dieu kien don toi thieu) */
  description: string;
}

export interface AffiliateProvider {
  createAffiliateLink(input: CreateAffiliateLinkInput): Promise<CreateAffiliateLinkOutput>;
  /**
   * Danh sach khuyen mai/coupon dang chay chung cua 1 merchant (khong gan voi 1 san pham cu the).
   * Khong co field "so luot con lai" - nguon du lieu affiliate khong cung cap thong tin nay.
   */
  getPromotions(merchant: MerchantId, limit: number): Promise<PromotionItem[]>;
}
