import { test } from "node:test";
import assert from "node:assert/strict";
import { RiohubClient, type RiohubFetchLike } from "../providers/riohubClient.js";
import { TiktokAffiliateProvider } from "../providers/tiktokAffiliateProvider.js";
import {
  TIKTOK_ACTUAL_SHORTFALL_SLACK,
  TIKTOK_PIT_RETAINED_RATIO,
  estimateTiktokNetCommission,
  isActualBelowAssumed,
} from "../tiktokCommission.js";

test("hang so: giu 90% sau khi TikTok khau tru pit, bien canh bao 2%", () => {
  assert.equal(TIKTOK_PIT_RETAINED_RATIO, 0.9);
  assert.equal(TIKTOK_ACTUAL_SHORTFALL_SLACK, 0.02);
});

test("estimateTiktokNetCommission: don that 2.136d -> 1.922d, lam tron 1 lan", () => {
  assert.equal(estimateTiktokNetCommission(2136), 1922);
  assert.equal(estimateTiktokNetCommission(3190), 2871);
  assert.equal(estimateTiktokNetCommission(0), 0);
  assert.equal(estimateTiktokNetCommission(5), 5); // 4,5 -> 5 (Math.round)
});

test("isActualBelowAssumed: so sanh thang voi assumed tru bien", () => {
  // est 2136 -> assumed 1922, bien round(42,72)=43 -> nguong 1879
  assert.equal(isActualBelowAssumed(2136, 1922), false, "dung bang so da tra");
  assert.equal(isActualBelowAssumed(2136, 1879), false, "cham nguong van chua canh bao");
  assert.equal(isActualBelowAssumed(2136, 1878), true);
  assert.equal(isActualBelowAssumed(2136, 0), true, "MCN giu het");
  assert.equal(isActualBelowAssumed(2136, 2136), false, "thuc nhan CAO hon so da tra: khong phai van de");
});

function providerReturning(payload: unknown) {
  const fetchImpl: RiohubFetchLike = async () => ({ ok: true, status: 200, json: async () => payload });
  return new TiktokAffiliateProvider({
    client: new RiohubClient({ apiKey: "k", baseUrls: ["https://a.test/api/v1"], fetchImpl }),
    creatorUsername: "creator1",
    channel: "bot",
  });
}

test("estimateFrom (cau bot gui luc tra link) va ledger dung CUNG mot cong thuc", async () => {
  // gia 10.000d, rate 5,00% -> hoa hong tho 500d. Ledger ghi estimateTiktokNetCommission(500).
  const out = await providerReturning({
    affiliate_link: "https://x",
    product: { commission: { rate: 500 }, sales_price: { minimum_amount: "10000" } },
  }).createAffiliateLink({
    merchant: "tiktokshop",
    productUrl: "https://shop.tiktok.com/vn/pdp/1",
    subId: "m-1-a-b",
  });
  assert.equal(out.commissionEstimate?.estimatedAmount, estimateTiktokNetCommission(500));
  assert.equal(out.commissionEstimate?.estimatedAmount, 450);
});
