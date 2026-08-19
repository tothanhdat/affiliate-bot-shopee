import { test } from "node:test";
import assert from "node:assert/strict";
import { ShopeeAffiliateProvider } from "../providers/shopeeAffiliateProvider.js";
import { MerchantNotConfiguredError } from "../errors.js";

const AFFILIATE_ID = "[REDACTED_AFFILIATE_ID]";
const SHORT_LINK_BASE_URL = "https://bot.example.com";

/** Fake createShortLink - ghi lai targetUrl duoc rut gon, tra ve code co doan de assert URL cuoi. */
function fakeShortLinker() {
  const calls: string[] = [];
  const createShortLink = (targetUrl: string) => {
    calls.push(targetUrl);
    return `code${calls.length}`;
  };
  return { calls, createShortLink };
}

test("ShopeeAffiliateProvider: dung origin_link gon (shopee.vn/product/{shopId}/{itemId}) khi tach duoc id, roi rut gon qua short link", async () => {
  const { calls, createShortLink } = fakeShortLinker();
  const provider = new ShopeeAffiliateProvider({ affiliateId: AFFILIATE_ID, createShortLink, shortLinkBaseUrl: SHORT_LINK_BASE_URL });
  const result = await provider.createAffiliateLink({
    merchant: "shopee",
    productUrl: "https://shopee.vn/Ao-thun-nam-i.123.456",
    subId: "telegram-user-a-abc123-def",
    shopId: "123",
    itemId: "456",
  });

  assert.equal(result.affiliateUrl, `${SHORT_LINK_BASE_URL}/s/code1`);
  assert.equal(calls.length, 1);

  const targetUrl = new URL(calls[0]);
  assert.equal(targetUrl.origin + targetUrl.pathname, "https://s.shopee.vn/an_redir");
  assert.equal(targetUrl.searchParams.get("origin_link"), "https://shopee.vn/product/123/456");
  assert.equal(targetUrl.searchParams.get("affiliate_id"), AFFILIATE_ID);
  assert.equal(targetUrl.searchParams.get("sub_id"), "telegram-user-a-abc123-def");
});

test("ShopeeAffiliateProvider: fallback ve productUrl goc khi khong tach duoc shopId/itemId", async () => {
  const { calls, createShortLink } = fakeShortLinker();
  const provider = new ShopeeAffiliateProvider({ affiliateId: AFFILIATE_ID, createShortLink, shortLinkBaseUrl: SHORT_LINK_BASE_URL });
  await provider.createAffiliateLink({
    merchant: "shopee",
    productUrl: "https://shopee.vn/shop/999999",
    subId: "telegram-user-a-abc123-def",
    shopId: null,
    itemId: null,
  });

  const targetUrl = new URL(calls[0]);
  assert.equal(targetUrl.searchParams.get("origin_link"), "https://shopee.vn/shop/999999");
});

test("ShopeeAffiliateProvider: nem MerchantNotConfiguredError voi merchant khac shopee", async () => {
  const { createShortLink } = fakeShortLinker();
  const provider = new ShopeeAffiliateProvider({ affiliateId: AFFILIATE_ID, createShortLink, shortLinkBaseUrl: SHORT_LINK_BASE_URL });
  await assert.rejects(
    () =>
      provider.createAffiliateLink({
        merchant: "lazada",
        productUrl: "https://lazada.vn/products/abc",
        subId: "telegram-user-a-abc123-def",
      }),
    MerchantNotConfiguredError
  );
});

test("ShopeeAffiliateProvider: getPromotions luon tra ve mang rong (khong co nguon coupon chung)", async () => {
  const { createShortLink } = fakeShortLinker();
  const provider = new ShopeeAffiliateProvider({ affiliateId: AFFILIATE_ID, createShortLink, shortLinkBaseUrl: SHORT_LINK_BASE_URL });
  const result = await provider.getPromotions("shopee", 10);
  assert.deepEqual(result, []);
});
