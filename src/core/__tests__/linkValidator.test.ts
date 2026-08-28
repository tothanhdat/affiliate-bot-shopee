import { test } from "node:test";
import assert from "node:assert/strict";
import { extractProductUrls, parseProductLink } from "../linkValidator.js";
import { InvalidLinkError, NotAProductLinkError, UnsupportedMerchantLinkError } from "../errors.js";

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

test("parseProductLink: link Shopee khong co pattern id van hop le, id la null", async () => {
  const result = await parseProductLink("https://shopee.vn/some-shop-page");
  assert.equal(result.shopId, null);
  assert.equal(result.itemId, null);
  assert.equal(result.canonicalUrl, "https://shopee.vn/some-shop-page");
});

test("parseProductLink: nhan dien merchant Lazada, chua co pattern tach id nen shopId/itemId la null", async () => {
  const result = await parseProductLink("https://www.lazada.vn/products/ao-thun-i333.html");
  assert.equal(result.merchant, "lazada");
  assert.equal(result.shopId, null);
  assert.equal(result.itemId, null);
});

test("parseProductLink: nem UnsupportedMerchantLinkError voi domain khong duoc ho tro", async () => {
  await assert.rejects(() => parseProductLink("https://example.com/product"), UnsupportedMerchantLinkError);
});

test("extractProductUrls: nhan dien link TikTok Shop (tiktok.com)", () => {
  const text = "san pham ngon: https://www.tiktok.com/view/product/1733294149780801469?region=VN";
  const urls = extractProductUrls(text);
  assert.equal(urls.length, 1);
});

test("parseProductLink: tach dung product_id tu dang /view/product/{id} cua TikTok Shop", async () => {
  const result = await parseProductLink("https://www.tiktok.com/view/product/1733294149780801469?region=VN&local=en");
  assert.equal(result.merchant, "tiktokshop");
  assert.equal(result.shopId, null);
  assert.equal(result.itemId, "1733294149780801469");
});

test("parseProductLink: nem NotAProductLinkError voi link tiktok.com khong phai san pham (vd video thuong)", async () => {
  await assert.rejects(
    () => parseProductLink("https://www.tiktok.com/@someuser/video/1234567890123456789"),
    NotAProductLinkError
  );
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
