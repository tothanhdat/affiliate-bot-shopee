import { test } from "node:test";
import assert from "node:assert/strict";
import { extractShopeeUrls, parseShopeeLink } from "../linkValidator.js";
import { InvalidLinkError, NotShopeeLinkError } from "../errors.js";

test("extractShopeeUrls: tim link Shopee trong tin nhan lan text khac", () => {
  const text =
    "Xem cai ao nay dep ne https://shopee.vn/Ao-thun-i.111.222 con day la link google https://google.com/search?q=x";
  const urls = extractShopeeUrls(text);
  assert.deepEqual(urls, ["https://shopee.vn/Ao-thun-i.111.222"]);
});

test("extractShopeeUrls: khong co link Shopee nao thi tra ve mang rong", () => {
  assert.deepEqual(extractShopeeUrls("chao ban, khong co link gi ca"), []);
});

test("extractShopeeUrls: nhan nhieu link Shopee cung luc", () => {
  const text = "link 1: https://shopee.vn/a-i.1.2 link 2: https://shopee.vn/b-i.3.4";
  const urls = extractShopeeUrls(text);
  assert.equal(urls.length, 2);
});

test("parseShopeeLink: tach dung shop_id/item_id tu dang -i.{shop}.{item}", async () => {
  const result = await parseShopeeLink("https://shopee.vn/Ao-thun-nam-i.123456.789012");
  assert.equal(result.shopId, "123456");
  assert.equal(result.itemId, "789012");
});

test("parseShopeeLink: tach dung shop_id/item_id tu dang /product/{shop}/{item}", async () => {
  const result = await parseShopeeLink("https://shopee.vn/product/111/222");
  assert.equal(result.shopId, "111");
  assert.equal(result.itemId, "222");
});

test("parseShopeeLink: link Shopee khong co pattern id van hop le, id la null", async () => {
  const result = await parseShopeeLink("https://shopee.vn/some-shop-page");
  assert.equal(result.shopId, null);
  assert.equal(result.itemId, null);
  assert.equal(result.canonicalUrl, "https://shopee.vn/some-shop-page");
});

test("parseShopeeLink: nem NotShopeeLinkError voi domain khac Shopee", async () => {
  await assert.rejects(() => parseShopeeLink("https://example.com/product"), NotShopeeLinkError);
});

test("parseShopeeLink: nem InvalidLinkError voi chuoi khong phai URL", async () => {
  await assert.rejects(() => parseShopeeLink("khong-phai-url"), InvalidLinkError);
});
