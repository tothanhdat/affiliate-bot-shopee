import { test } from "node:test";
import assert from "node:assert/strict";
import { LinkResolverService } from "../linkResolverService.js";
import { LogStore } from "../logStore.js";
import { RateLimiter } from "../rateLimiter.js";
import type { AffiliateProvider, CreateAffiliateLinkOutput } from "../affiliateProvider.js";

/**
 * Nhung gi resolver GHI VAO LOG - day la nguon du lieu duy nhat cua trang /admin/links. Provider
 * biet ten san pham + hoa hong, adapter biet noi gui (group/DM); neu resolver khong chuyen cho
 * nao trong so do xuong logStore thi 3 cot cua trang do trong vinh vien.
 */

const PRODUCT_URL = "https://shopee.vn/product/123/456";

function fakeProvider(output: Partial<CreateAffiliateLinkOutput>): AffiliateProvider {
  return {
    createAffiliateLink: async () => ({
      affiliateUrl: "https://bot.example/s/aaaaaaa",
      ...output,
    }),
    getPromotions: async () => [],
  };
}

function makeResolver(provider: AffiliateProvider): { resolver: LinkResolverService; logStore: LogStore } {
  const logStore = new LogStore(":memory:");
  const resolver = new LinkResolverService(provider, logStore, new RateLimiter(100, 60_000));
  return { resolver, logStore };
}

test("ghi ten san pham va hoa hong GOC uoc tinh vao log", async () => {
  const { resolver, logStore } = makeResolver(
    fakeProvider({
      productName: "Máy ảnh Canon EOS R50",
      commissionEstimate: { ratePercent: 2.5, estimatedAmount: 40000, currency: "VND" },
    })
  );
  try {
    await resolver.resolve({ url: PRODUCT_URL, platform: "zalo", userId: "u1", sourceContext: "group" });

    const [row] = logStore.listCreatedLinks();
    assert.equal(row.productName, "Máy ảnh Canon EOS R50");
    assert.equal(row.commissionEstimate, 40000);
    assert.equal(row.sourceContext, "group");
  } finally {
    logStore.close();
  }
});

test("san pham da xac minh CHUA BAT hoa hong -> ghi 0, KHONG ghi null", async () => {
  // Ranh gioi song con (xem commissionLookup.ts): 0 la "da xac minh khong co hoa hong", null la
  // "khong tra duoc". Ghi lan nhau thi trang admin noi sai ve san pham do.
  const { resolver, logStore } = makeResolver(
    fakeProvider({ noCommission: true, commissionEstimate: null, productName: "Gối massage" })
  );
  try {
    await resolver.resolve({ url: PRODUCT_URL, platform: "zalo", userId: "u1", sourceContext: "dm" });

    assert.equal(logStore.listCreatedLinks()[0].commissionEstimate, 0);
  } finally {
    logStore.close();
  }
});

test("khong tra duoc hoa hong -> ghi null, KHONG ghi 0", async () => {
  const { resolver, logStore } = makeResolver(fakeProvider({ commissionEstimate: null }));
  try {
    await resolver.resolve({ url: PRODUCT_URL, platform: "zalo", userId: "u1", sourceContext: "dm" });

    assert.equal(logStore.listCreatedLinks()[0].commissionEstimate, null);
  } finally {
    logStore.close();
  }
});

test("luot LOI van ghi noi gui - loi xay ra truoc khi biet merchant nhung noi gui thi luon biet", async () => {
  const { resolver, logStore } = makeResolver(fakeProvider({}));
  try {
    await assert.rejects(
      resolver.resolve({ url: "https://khong-ho-tro.example/x", platform: "telegram", userId: "u9", sourceContext: "group" })
    );

    const [row] = logStore.listCreatedLinks();
    assert.equal(row.outcome, "error");
    assert.equal(row.sourceContext, "group");
    assert.equal(row.productName, null);
    assert.equal(row.commissionEstimate, null);
  } finally {
    logStore.close();
  }
});

test("khong truyen sourceContext (vd request HTTP cu) -> ghi null, khong crash", async () => {
  const { resolver, logStore } = makeResolver(fakeProvider({}));
  try {
    await resolver.resolve({ url: PRODUCT_URL, platform: "http", userId: "ip-1" });

    assert.equal(logStore.listCreatedLinks()[0].sourceContext, null);
  } finally {
    logStore.close();
  }
});
