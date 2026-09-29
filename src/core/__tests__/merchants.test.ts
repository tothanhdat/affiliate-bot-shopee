import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MERCHANTS,
  RETIRED_MERCHANTS,
  detectMerchantByHost,
  detectRetiredMerchantByHost,
  getMerchantConfig,
} from "../merchants.js";

test("MERCHANTS: chi con Shopee", () => {
  assert.deepEqual(
    MERCHANTS.map((m) => m.id),
    ["shopee"]
  );
});

test("detectMerchantByHost: nhan Shopee, KHONG nhan san da ngung", () => {
  assert.equal(detectMerchantByHost("shopee.vn")?.id, "shopee");
  assert.equal(detectMerchantByHost("s.shopee.vn")?.id, "shopee");
  assert.equal(detectMerchantByHost("www.tiktok.com"), null);
  assert.equal(detectMerchantByHost("lazada.vn"), null);
});

test("detectRetiredMerchantByHost: nhan ca domain chinh lan short link cua san da ngung", () => {
  assert.equal(detectRetiredMerchantByHost("www.tiktok.com")?.id, "tiktokshop");
  assert.equal(detectRetiredMerchantByHost("vt.tiktok.com")?.id, "tiktokshop");
  assert.equal(detectRetiredMerchantByHost("shop.tiktok.com")?.id, "tiktokshop");
  assert.equal(detectRetiredMerchantByHost("lazada.vn")?.id, "lazada");
  assert.equal(detectRetiredMerchantByHost("shopee.vn"), null);
});

// Chan hoi quy: ledger that dang co entry merchant='tiktokshop'/'lazada'. Neu getMerchantConfig
// chi tra MERCHANTS thi no se throw luc render don cu -> CRASH trang /admin/orders.
test("getMerchantConfig: van tra duoc ten hien thi cua san da ngung", () => {
  assert.equal(getMerchantConfig("shopee").displayName, "Shopee");
  assert.equal(getMerchantConfig("tiktokshop").displayName, "TikTok Shop");
  assert.equal(getMerchantConfig("lazada").displayName, "Lazada");
});

test("RETIRED_MERCHANTS: dung 2 san da ngung", () => {
  assert.deepEqual(
    [...RETIRED_MERCHANTS].map((m) => m.id).sort(),
    ["lazada", "tiktokshop"]
  );
});
