import type { MerchantId } from "./merchants.js";

export interface CreateAffiliateLinkInput {
  merchant: MerchantId;
  /** URL san pham da chuan hoa (canonical) */
  productUrl: string;
  /** id dung de tracking/doi soat hoa hong, xem T1.4 */
  subId: string;
  /**
   * id san pham da tach san tu linkValidator.ts (vi du product_id cua TikTok Shop).
   * Optional - phan lon provider/merchant khong can, nhung AccesstradeProvider dung
   * gia tri nay cho TikTok Shop (bat buoc phai co, xem accesstradeProvider.ts).
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
   * Uoc tinh hoa hong theo du lieu CHINH THUC tu nguon affiliate (khong phai scrape) - optional,
   * hien chi TikTok Shop qua Accesstrade co (xem accesstradeProvider.ts). null/undefined neu
   * provider/merchant khong ho tro hoac lay du lieu that bai (khong lam fail ca lan tao link).
   */
  commissionEstimate?: CommissionEstimate | null;
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
