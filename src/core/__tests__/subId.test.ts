import { test } from "node:test";
import assert from "node:assert/strict";
import { SUBID_PLATFORM_CODE, generateSubId } from "../subId.js";
import type { Platform } from "../types.js";

const ALL_PLATFORMS: Platform[] = ["zalo", "telegram", "http"];

// Test QUAN TRONG NHAT cua file nay: subId hien nguyen van trong bao cao Shopee, nen ten nen tang
// o day la loi tu khai voi Shopee. Neu ai refactor "cho de doc" roi nhet ten nen tang lai vao,
// test nay phai do. Xem doc comment cua SUBID_PLATFORM_CODE trong subId.ts de biet ly do day du.
test("generateSubId: KHONG chua ten nen tang nao trong chuoi", () => {
  for (const platform of ALL_PLATFORMS) {
    const subId = generateSubId(platform, "9053348487804998642");
    for (const name of ALL_PLATFORMS) {
      assert.ok(
        !subId.includes(name),
        `subId "${subId}" khong duoc chua ten nen tang "${name}"`
      );
    }
  }
});

// Cung khong duoc "muon" ten 1 nen tang khac de trong nhu traffic tu kenh Shopee uu tien hon -
// click van mang User-Agent Zalo nen Shopee doi chieu duoc, luc do la khai sai nguon (dieu khoan
// (c)/(t)(iii)/(u) Chinh sach chong gian lan TTLK) chu khong con la "khong khai gi".
test("SUBID_PLATFORM_CODE: khong muon ten nen tang khac (facebook/instagram/tiktok...)", () => {
  const forbidden = ["facebook", "fb", "instagram", "ig", "tiktok", "youtube", "shopee"];
  for (const code of Object.values(SUBID_PLATFORM_CODE)) {
    assert.ok(
      !forbidden.includes(code.toLowerCase()),
      `ma nen tang "${code}" khong duoc la ten 1 kenh khac`
    );
  }
});

test("generateSubId: dung dinh dang {ma}-{userId}-{timestamp36}-{random} (4 doan)", () => {
  const subId = generateSubId("zalo", "9053348487804998642");
  const parts = subId.split("-");
  assert.equal(parts.length, 4, `subId "${subId}" phai co dung 4 doan`);
  assert.equal(parts[0], SUBID_PLATFORM_CODE.zalo);
  // userId phai con nguyen trong chuoi: neu requests.db mat, day la manh moi duy nhat de quy don
  // ve dung user bang tay tu bao cao Shopee.
  assert.equal(parts[1], "9053348487804998642");
  assert.match(parts[2], /^[0-9a-z]+$/);
  assert.match(parts[3], /^[0-9a-f]{6}$/);
});

test("SUBID_PLATFORM_CODE: moi nen tang 1 ma RIENG (khong trung nhau)", () => {
  const codes = ALL_PLATFORMS.map((p) => SUBID_PLATFORM_CODE[p]);
  assert.equal(new Set(codes).size, codes.length, `ma bi trung: ${codes.join(",")}`);
});

test("generateSubId: 2 lan goi lien tiep cho cung 1 user ra 2 subId khac nhau", () => {
  const a = generateSubId("zalo", "123");
  const b = generateSubId("zalo", "123");
  assert.notEqual(a, b);
});
