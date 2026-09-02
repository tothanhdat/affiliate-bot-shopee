import { test } from "node:test";
import assert from "node:assert/strict";
import { AccesstradeProvider } from "../providers/accesstradeProvider.js";
import { AffiliateApiError, ProductNotAffiliateEligibleError } from "../errors.js";

/**
 * Accesstrade bao loi NGHIEP VU bang body {"status": false} TRONG response HTTP 200 (khong dung
 * ma HTTP loi) - phat hien 2026-09-02 khi trace 1 link TikTok Shop that bi bot tra ve "he thong
 * dang gap su co". Cac test duoi day khoa lai cach phan loai response do.
 */

const BASE_CONFIG = {
  apiKey: "test-key",
  apiBase: "https://api.accesstrade.test",
  endpointPath: "/v1/product_link/create",
  timeoutMs: 5000,
  promotionsCacheTtlMs: 60_000,
  merchants: { lazada: { campaignId: "camp-1", promotionsMerchant: "lazada_kol" } },
  shortLinkBaseUrl: "https://bot.example.com",
};

/** Thay global fetch bang stub tra ve san body theo tung URL; tra ve ham restore. */
function stubFetch(handler: (url: string) => { status?: number; body: unknown }) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input instanceof URL ? input : (input as Request)?.url ?? input);
    const { status = 200, body } = handler(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function makeProvider() {
  const shortened: string[] = [];
  const provider = new AccesstradeProvider({
    ...BASE_CONFIG,
    createShortLink: (targetUrl: string) => {
      shortened.push(targetUrl);
      return `code${shortened.length}`;
    },
  });
  return { provider, shortened };
}

const TIKTOK_INPUT = {
  merchant: "tiktokshop" as const,
  productUrl: "https://shop.tiktok.com/vn/pdp/1733246148341695964",
  subId: "zalo-user-1-abc123-def456",
  itemId: "1733246148341695964",
};

const NOT_ELIGIBLE_MESSAGE =
  "Precondition Required. This operation requires a product that complies with platform " +
  "policy and is available in the Affiliate Center. Please check the product status, " +
  "select an available product, and retry.";

test("AccesstradeProvider: san pham chua bat tiep thi lien ket (status:false trong HTTP 200) -> ProductNotAffiliateEligibleError", async () => {
  const restore = stubFetch(() => ({
    body: { data: null, message: NOT_ELIGIBLE_MESSAGE, status: false },
  }));
  try {
    const { provider } = makeProvider();
    await assert.rejects(
      () => provider.createAffiliateLink(TIKTOK_INPUT),
      (err: unknown) => {
        assert.ok(
          err instanceof ProductNotAffiliateEligibleError,
          `mong doi ProductNotAffiliateEligibleError, nhan duoc ${(err as Error).constructor.name}`
        );
        assert.equal((err as ProductNotAffiliateEligibleError).code, "PRODUCT_NOT_AFFILIATE_ELIGIBLE");
        // KHONG duoc bao user "thu lai sau" - thu lai bao nhieu lan cung the.
        assert.ok(!(err as ProductNotAffiliateEligibleError).userMessage.includes("thử lại sau"));
        return true;
      }
    );
  } finally {
    restore();
  }
});

test("AccesstradeProvider: status:false vi ly do khac -> AffiliateApiError giu nguyen message goc de log", async () => {
  const restore = stubFetch(() => ({
    body: { data: null, message: "Campaign is not active for this publisher.", status: false },
  }));
  try {
    const { provider } = makeProvider();
    await assert.rejects(
      () => provider.createAffiliateLink(TIKTOK_INPUT),
      (err: unknown) => {
        assert.ok(err instanceof AffiliateApiError, "phai la AffiliateApiError chung");
        assert.ok(
          (err as Error).message.includes("Campaign is not active"),
          `message phai chua ly do that de doc duoc trong log, nhan duoc: ${(err as Error).message}`
        );
        return true;
      }
    );
  } finally {
    restore();
  }
});

test("AccesstradeProvider: response thanh cong van tao link binh thuong (khong bi guard chan nham)", async () => {
  const restore = stubFetch((url) => {
    if (url.includes("/v2/tiktokshop_product_feeds")) {
      return { body: { data: { products: [] } } };
    }
    return { body: { data: { aff_short_url: "https://shorten.asia/xyz" } } };
  });
  try {
    const { provider, shortened } = makeProvider();
    const result = await provider.createAffiliateLink(TIKTOK_INPUT);
    assert.equal(result.affiliateUrl, "https://bot.example.com/s/code1");
    assert.deepEqual(shortened, ["https://shorten.asia/xyz"]);
  } finally {
    restore();
  }
});

test("AccesstradeProvider: guard status:false ap dung ca cho nhanh Shopee/Lazada, khong rieng TikTok Shop", async () => {
  const restore = stubFetch(() => ({
    body: { data: null, message: NOT_ELIGIBLE_MESSAGE, status: false },
  }));
  try {
    const { provider } = makeProvider();
    await assert.rejects(
      () =>
        provider.createAffiliateLink({
          merchant: "lazada",
          productUrl: "https://www.lazada.vn/products/i123.html",
          subId: "zalo-user-1-abc123-def456",
        }),
      ProductNotAffiliateEligibleError
    );
  } finally {
    restore();
  }
});

test("AccesstradeProvider: response thieu han short link (khong co status:false) van la AffiliateApiError", async () => {
  const restore = stubFetch(() => ({ body: { data: { something_else: 1 } } }));
  try {
    const { provider } = makeProvider();
    await assert.rejects(
      () => provider.createAffiliateLink(TIKTOK_INPUT),
      (err: unknown) => {
        assert.ok(err instanceof AffiliateApiError);
        assert.ok((err as Error).message.includes("khong tim thay short link"));
        return true;
      }
    );
  } finally {
    restore();
  }
});
