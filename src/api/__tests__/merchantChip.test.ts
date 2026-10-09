import { test } from "node:test";
import assert from "node:assert/strict";
import { merchantChipClass } from "../adminHtml.js";

test("chip TikTok Shop co mau rieng, khong roi ve trung tinh", () => {
  const cls = merchantChipClass("tiktokshop");
  assert.notEqual(cls, merchantChipClass("lazada"), "khong duoc dung chung mau voi san da ngung");
  assert.notEqual(cls, merchantChipClass("shopee"));
});

test("chip van goc vuong de khong lan voi pill trang thai bo tron", () => {
  assert.ok(!merchantChipClass("tiktokshop").includes("rounded-full"));
});
