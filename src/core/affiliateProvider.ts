import type { MerchantId } from "./merchants.js";

export interface CreateAffiliateLinkInput {
  merchant: MerchantId;
  /** URL san pham da chuan hoa (canonical) */
  productUrl: string;
  /** id dung de tracking/doi soat hoa hong, xem T1.4 */
  subId: string;
}

export interface CreateAffiliateLinkOutput {
  affiliateUrl: string;
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
