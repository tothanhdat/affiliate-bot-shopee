import { test } from "node:test";
import assert from "node:assert/strict";
import { extractProductUrls, parseProductLink } from "../linkValidator.js";
import {
  InvalidLinkError,
  NotAProductLinkError,
  RetiredMerchantLinkError,
  UnsupportedMerchantLinkError,
} from "../errors.js";

test("extractProductUrls: tim link Shopee trong tin nhan lan text khac", () => {
  const text =
    "Xem cai ao nay dep ne https://shopee.vn/Ao-thun-i.111.222 con day la link google https://google.com/search?q=x";
  const urls = extractProductUrls(text);
  assert.deepEqual(urls, ["https://shopee.vn/Ao-thun-i.111.222"]);
});

test("extractProductUrls: nhan ca link Shopee lan Lazada trong cung 1 tin nhan", () => {
  const text = "shopee: https://shopee.vn/a-i.1.2 lazada: https://www.lazada.vn/products/abc-i333.html";
  const urls = extractProductUrls(text);
  assert.equal(urls.length, 2);
});

test("extractProductUrls: khong co link nao duoc ho tro thi tra ve mang rong", () => {
  assert.deepEqual(extractProductUrls("chao ban, khong co link gi ca"), []);
});

test("extractProductUrls: nhan nhieu link Shopee cung luc", () => {
  const text = "link 1: https://shopee.vn/a-i.1.2 link 2: https://shopee.vn/b-i.3.4";
  const urls = extractProductUrls(text);
  assert.equal(urls.length, 2);
});

test("parseProductLink: tach dung shop_id/item_id tu dang -i.{shop}.{item} cua Shopee", async () => {
  const result = await parseProductLink("https://shopee.vn/Ao-thun-nam-i.123456.789012");
  assert.equal(result.merchant, "shopee");
  assert.equal(result.shopId, "123456");
  assert.equal(result.itemId, "789012");
});

test("parseProductLink: tach dung shop_id/item_id tu dang /product/{shop}/{item} cua Shopee", async () => {
  const result = await parseProductLink("https://shopee.vn/product/111/222");
  assert.equal(result.shopId, "111");
  assert.equal(result.itemId, "222");
});

/**
 * Dang /opaanlp/{shop}/{item} la dang app Shopee sinh ra khi bam "Chia se" - chiem 58/90 link
 * that trong production (do lai 2026-09-29), nhieu hon han dang /product/ (30). Truoc khi nhan
 * dang duoc, extractIds tra null nen origin_link giu nguyen query string ~700 ky tu cua link goc
 * (credential_token, gads_t_sig, uls_trackid va ca tham so affiliate cua NGUOI KHAC).
 */
test("parseProductLink: tach dung shop_id/item_id tu dang /opaanlp/{shop}/{item} cua app Shopee", async () => {
  const result = await parseProductLink(
    "https://shopee.vn/opaanlp/438333144/10002287009?__mobile__=1&credential_token=3fbCuxANWvpk&uls_trackid=56o2868i00kj&utm_medium=affiliates&utm_source=an_17326960274"
  );
  assert.equal(result.shopId, "438333144");
  assert.equal(result.itemId, "10002287009");
});

test("parseProductLink: link Shopee khong co pattern id van hop le, id la null", async () => {
  const result = await parseProductLink("https://shopee.vn/some-shop-page");
  assert.equal(result.shopId, null);
  assert.equal(result.itemId, null);
  assert.equal(result.canonicalUrl, "https://shopee.vn/some-shop-page");
});

test("parseProductLink: nem RetiredMerchantLinkError voi link Lazada (san da ngung)", async () => {
  await assert.rejects(
    () => parseProductLink("https://www.lazada.vn/products/ao-thun-i333.html"),
    RetiredMerchantLinkError
  );
});

test("parseProductLink: nem UnsupportedMerchantLinkError voi domain khong duoc ho tro", async () => {
  await assert.rejects(() => parseProductLink("https://example.com/product"), UnsupportedMerchantLinkError);
});

test("extractProductUrls: nhan dien link TikTok Shop (tiktok.com)", () => {
  const text = "san pham ngon: https://www.tiktok.com/view/product/1733294149780801469?region=VN";
  const urls = extractProductUrls(text);
  assert.equal(urls.length, 1);
});

test("parseProductLink: nem RetiredMerchantLinkError voi moi link TikTok Shop (san da ngung)", async () => {
  await assert.rejects(
    () => parseProductLink("https://www.tiktok.com/view/product/1733294149780801469?region=VN&local=en"),
    RetiredMerchantLinkError
  );
  await assert.rejects(
    () => parseProductLink("https://shop.tiktok.com/vn/pdp/1732783707240498274?_d=ebja7ibeka4jl4&scene=pdp"),
    RetiredMerchantLinkError
  );
});

test("parseProductLink: link video TikTok thuong cung bao la san da ngung, khong doi ra loi khac", async () => {
  await assert.rejects(
    () => parseProductLink("https://www.tiktok.com/@someuser/video/1234567890123456789"),
    RetiredMerchantLinkError
  );
});

// Neu extractProductUrls KHONG nhat link cua san da ngung ra khoi tin nhan thi adapter se coi
// nhu tin nhan khong co link -> Zalo DM im lang tuyet doi -> user tuong bot hong.
test("extractProductUrls: VAN nhat link cua san da ngung de con tra loi duoc", () => {
  assert.deepEqual(extractProductUrls("mua cai nay https://vt.tiktok.com/ZSABC123/ nhe"), [
    "https://vt.tiktok.com/ZSABC123/",
  ]);
  assert.deepEqual(extractProductUrls("https://www.lazada.vn/products/x-i1.html"), [
    "https://www.lazada.vn/products/x-i1.html",
  ]);
});

test("parseProductLink: short link cua san da ngung bi tu choi NGAY, khong goi mang", async () => {
  await assert.rejects(() => parseProductLink("https://vt.tiktok.com/ZSABC123/"), RetiredMerchantLinkError);
});

test("parseProductLink: nem InvalidLinkError voi chuoi khong phai URL", async () => {
  await assert.rejects(() => parseProductLink("khong-phai-url"), InvalidLinkError);
});

test("parseProductLink: nem NotAProductLinkError voi link Shopee Video (sv.shopee.vn/share-video)", async () => {
  await assert.rejects(
    () =>
      parseProductLink(
        "https://sv.shopee.vn/share-video/aIAUX-6xBwDxgDMcAAAAAA==?c=share_web&contentType=0&fromShareLink=share-marker"
      ),
    NotAProductLinkError
  );
});
