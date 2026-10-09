import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MERCHANTS,
  buildMerchantRegistry,
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

test("co TAT -> tiktokshop nam trong danh sach da ngung", () => {
  const { active, retired } = buildMerchantRegistry({ tiktokEnabled: false });
  assert.equal(active.find((m) => m.id === "tiktokshop"), undefined);
  assert.ok(retired.find((m) => m.id === "tiktokshop"));
});

test("co BAT -> tiktokshop chuyen sang danh sach dang ho tro", () => {
  const { active, retired } = buildMerchantRegistry({ tiktokEnabled: true });
  assert.ok(active.find((m) => m.id === "tiktokshop"));
  assert.equal(retired.find((m) => m.id === "tiktokshop"), undefined);
});

test("lazada LUON o danh sach da ngung, khong phu thuoc co tiktok", () => {
  for (const tiktokEnabled of [true, false]) {
    const { retired } = buildMerchantRegistry({ tiktokEnabled });
    assert.ok(retired.find((m) => m.id === "lazada"));
  }
});

test("tiktokshop KHONG resolve short link, shopee thi CO", () => {
  const { active } = buildMerchantRegistry({ tiktokEnabled: true });
  const tiktok = active.find((m) => m.id === "tiktokshop");
  const shopee = active.find((m) => m.id === "shopee");
  // RioHub tu theo redirect, bot khong can goi mang them.
  assert.equal(tiktok?.resolveShortLinks, false);
  // Shopee van phai resolve: an_redir can URL that.
  assert.notEqual(shopee?.resolveShortLinks, false);
});

test("vt.tiktok.com VAN duoc nhan dien la tiktok du khong resolve", () => {
  const { active } = buildMerchantRegistry({ tiktokEnabled: true });
  const tiktok = active.find((m) => m.id === "tiktokshop");
  // Bo shortHosts di thi extractProductUrls khong nhat link ra -> bot IM LANG.
  assert.ok(tiktok?.shortHosts.has("vt.tiktok.com"));
});
