import { test } from "node:test";
import assert from "node:assert/strict";
import { TiktokAffiliateProvider } from "../providers/tiktokAffiliateProvider.js";
import { RiohubClient, type RiohubFetchLike } from "../providers/riohubClient.js";
import { ProviderUnavailableError, ProductNotAffiliateEligibleError, NotAProductLinkError } from "../errors.js";

const BASES = ["https://a.test/api/v1"];

function providerWith(responder: RiohubFetchLike) {
  return new TiktokAffiliateProvider({
    client: new RiohubClient({ apiKey: "k", baseUrls: BASES, fetchImpl: responder }),
    creatorUsername: "creator1",
    channel: "bot",
  });
}

function jsonOk(payload: unknown): RiohubFetchLike {
  return async () => ({ ok: true, status: 200, json: async () => payload });
}

function jsonErr(status: number, code: string, message: string): RiohubFetchLike {
  return async () => ({ ok: false, status, json: async () => ({ error: { code, message } }) });
}

const BASE_INPUT = {
  merchant: "tiktokshop" as const,
  productUrl: "https://shop.tiktok.com/vn/pdp/1733204173655213684",
  subId: "m-7349128374-l9k2x1-ab3d",
};

test("tra ve link RioHub, KHONG rut gon lai qua /s/", async () => {
  const p = providerWith(jsonOk({ affiliate_link: "https://www.tiktok.com/t/ZSbtQs6NG/", product: null }));
  const out = await p.createAffiliateLink(BASE_INPUT);
  assert.equal(out.affiliateUrl, "https://www.tiktok.com/t/ZSbtQs6NG/");
});

test("gui dung sub_id 4 doan va channel", async () => {
  let body: Record<string, unknown> = {};
  const p = providerWith(async (_url, init) => {
    body = JSON.parse(init?.body ?? "{}");
    return { ok: true, status: 200, json: async () => ({ affiliate_link: "https://x" }) };
  });
  await p.createAffiliateLink(BASE_INPUT);
  assert.equal(body.sub_id, "m-7349128374-l9k2x1-ab3d");
  assert.equal(body.channel, "bot");
  assert.equal(body.creator_username, "creator1");
  assert.equal(body.product_url, BASE_INPUT.productUrl);
});

test("uu tien observed_commission hon commission.rate", async () => {
  const p = providerWith(
    jsonOk({
      affiliate_link: "https://x",
      product: {
        title: "Khan lau kinh",
        commission: { amount: "250.00 - 735.00", rate: 500 },
        observed_commission: { commission_rate: 600 },
        sales_price: { minimum_amount: "5000", maximum_amount: "14700" },
      },
    })
  );
  const out = await p.createAffiliateLink(BASE_INPUT);
  // 6,00% (observed) cua 5.000d (dau thap) = 300d, khong phai 5% = 250d
  assert.equal(out.commissionEstimate?.ratePercent, 6);
  assert.equal(out.commissionEstimate?.estimatedAmount, 300);
  assert.equal(out.productName, "Khan lau kinh");
});

test("khong co observed_commission -> lui ve commission.rate", async () => {
  const p = providerWith(
    jsonOk({
      affiliate_link: "https://x",
      product: {
        commission: { rate: 1200 },
        sales_price: { minimum_amount: "100000", maximum_amount: "300000" },
      },
    })
  );
  const out = await p.createAffiliateLink(BASE_INPUT);
  assert.equal(out.commissionEstimate?.ratePercent, 12);
  assert.equal(out.commissionEstimate?.estimatedAmount, 12000);
});

test("gia dang KHOANG -> lay dau THAP (hua it hon tra)", async () => {
  const p = providerWith(
    jsonOk({
      affiliate_link: "https://x",
      product: { commission: { rate: 1000 }, sales_price: { minimum_amount: "5000", maximum_amount: "99000" } },
    })
  );
  const out = await p.createAffiliateLink(BASE_INPUT);
  assert.equal(out.commissionEstimate?.estimatedAmount, 500);
});

test("product_error co mat -> VAN tra link, chi bo phan uoc tinh", async () => {
  const p = providerWith(
    jsonOk({ affiliate_link: "https://www.tiktok.com/t/ABC/", product: null, product_error: "timeout" })
  );
  const out = await p.createAffiliateLink(BASE_INPUT);
  assert.equal(out.affiliateUrl, "https://www.tiktok.com/t/ABC/");
  assert.equal(out.commissionEstimate, null);
  assert.equal(out.productName, null);
});

test("422 product_not_promotable -> ProductNotAffiliateEligibleError, KHONG phai cau bao tri", async () => {
  const p = providerWith(jsonErr(422, "product_not_promotable", "no commission"));
  await assert.rejects(
    () => p.createAffiliateLink(BASE_INPUT),
    (err: unknown) => {
      assert.ok(err instanceof ProductNotAffiliateEligibleError);
      assert.ok(!(err instanceof ProviderUnavailableError), "khong duoc gop vao nhanh bao tri");
      return true;
    }
  );
});

test("422 khong parse duoc URL -> NotAProductLinkError", async () => {
  const p = providerWith(
    jsonErr(422, "validation_error", "Cannot extract product_id: Unrecognized TikTok product URL format.")
  );
  await assert.rejects(
    () => p.createAffiliateLink(BASE_INPUT),
    (err: unknown) => err instanceof NotAProductLinkError
  );
});

test("500 server_error -> ProviderUnavailableError giu nguyen ma loi de bao admin", async () => {
  const p = providerWith(jsonErr(500, "server_error", "Internal server error"));
  await assert.rejects(
    () => p.createAffiliateLink(BASE_INPUT),
    (err: unknown) =>
      err instanceof ProviderUnavailableError && err.providerErrorCode === "server_error"
  );
});

test("ma loi LA van ra ProviderUnavailableError (nhanh mac dinh)", async () => {
  // Bang ma loi cua RioHub KHONG day du - mcn_membership_required va server_error deu khong co
  // trong tai lieu. Thieu nhanh mac dinh thi mot ma moi lam bot chet cam.
  const p = providerWith(jsonErr(403, "mot_ma_chua_tung_gap", "???"));
  await assert.rejects(
    () => p.createAffiliateLink(BASE_INPUT),
    (err: unknown) =>
      err instanceof ProviderUnavailableError && err.providerErrorCode === "mot_ma_chua_tung_gap"
  );
});

test("merchant khac tiktokshop -> tu choi", async () => {
  const p = providerWith(jsonOk({ affiliate_link: "https://x" }));
  await assert.rejects(() => p.createAffiliateLink({ ...BASE_INPUT, merchant: "shopee" }));
});

test("getPromotions tra rong", async () => {
  const p = providerWith(jsonOk({}));
  assert.deepEqual(await p.getPromotions("tiktokshop", 5), []);
});
