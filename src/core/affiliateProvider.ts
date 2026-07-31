export interface CreateAffiliateLinkInput {
  /** URL Shopee da chuan hoa (canonical) */
  productUrl: string;
  /** id dung de tracking/doi soat hoa hong, xem T1.4 */
  subId: string;
}

export interface CreateAffiliateLinkOutput {
  affiliateUrl: string;
}

export interface AffiliateProvider {
  createAffiliateLink(input: CreateAffiliateLinkInput): Promise<CreateAffiliateLinkOutput>;
}
