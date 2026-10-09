import { test } from "node:test";
import assert from "node:assert/strict";
import { CompositeAffiliateProvider } from "../providers/compositeProvider.js";
import { MerchantNotConfiguredError } from "../errors.js";
import type { AffiliateProvider } from "../affiliateProvider.js";
import type { MerchantId } from "../merchants.js";

// Chu thich kieu la BAT BUOC: `new Map([["shopee", ...]])` duoc TS suy thanh Map<string, ...>,
// khong khop ReadonlyMap<MerchantId, ...> cua constructor -> loi bien dich.
type ProviderMap = Map<MerchantId, AffiliateProvider>;

function fakeProvider(tag: string): AffiliateProvider {
  return {
    createAffiliateLink: async () => ({ affiliateUrl: `https://${tag}` }),
    getPromotions: async () => [{ couponCode: tag, description: tag }],
  };
}

const INPUT = { productUrl: "https://x", subId: "m-1-2-3" };

test("dinh tuyen dung provider theo merchant", async () => {
  const map: ProviderMap = new Map([
    ["shopee", fakeProvider("shopee")],
    ["tiktokshop", fakeProvider("tiktok")],
  ]);
  const c = new CompositeAffiliateProvider(map);
  assert.equal((await c.createAffiliateLink({ ...INPUT, merchant: "shopee" })).affiliateUrl, "https://shopee");
  assert.equal((await c.createAffiliateLink({ ...INPUT, merchant: "tiktokshop" })).affiliateUrl, "https://tiktok");
});

test("merchant khong co provider -> MerchantNotConfiguredError", async () => {
  const map: ProviderMap = new Map([["shopee", fakeProvider("shopee")]]);
  const c = new CompositeAffiliateProvider(map);
  await assert.rejects(
    () => c.createAffiliateLink({ ...INPUT, merchant: "tiktokshop" }),
    (err: unknown) => err instanceof MerchantNotConfiguredError
  );
});

test("getPromotions cung dinh tuyen theo merchant", async () => {
  const map: ProviderMap = new Map([["tiktokshop", fakeProvider("tiktok")]]);
  const c = new CompositeAffiliateProvider(map);
  assert.equal((await c.getPromotions("tiktokshop", 3))[0]?.couponCode, "tiktok");
});
