import { test } from "node:test";
import assert from "node:assert/strict";
import { isOverrideActiveOn, resolveUserSharePercent } from "../userCommissionOverride.js";
import type { UserCommissionOverride } from "../userCommissionOverride.js";

/**
 * % hoa hong RIENG cho 1 user, co han su dung (2026-10-01). Moc so sanh la ngay user DAT don
 * (order_date tu bao cao Shopee), KHONG phai ngay admin import - Shopee bao cao tre vai ngay nen
 * so voi ngay import se lam don mua sat han mat uu dai. Ca 2 dau khoang deu TINH VAO (inclusive).
 */

const GENERAL = 80;

function override(fields: Partial<UserCommissionOverride> = {}): UserCommissionOverride {
  return {
    platform: "zalo",
    userId: "user-a",
    userSharePercent: 95,
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...fields,
  };
}

test("don dat trong han -> dung % rieng", () => {
  assert.equal(resolveUserSharePercent(override(), GENERAL, "2026-10-15"), 95);
});

test("ngay bat dau va ngay ket thuc deu TINH VAO han", () => {
  assert.equal(resolveUserSharePercent(override(), GENERAL, "2026-10-01"), 95);
  assert.equal(resolveUserSharePercent(override(), GENERAL, "2026-10-31"), 95);
});

test("don dat TRUOC ngay bat dau -> % chung (uu dai khong hoi to don ton dong)", () => {
  assert.equal(resolveUserSharePercent(override(), GENERAL, "2026-09-30"), GENERAL);
});

test("don dat SAU ngay ket thuc -> % chung", () => {
  assert.equal(resolveUserSharePercent(override(), GENERAL, "2026-11-01"), GENERAL);
});

test("endDate null = khong han -> moi ngay tu ngay bat dau tro di deu dung % rieng", () => {
  const vinhVien = override({ endDate: null });
  assert.equal(resolveUserSharePercent(vinhVien, GENERAL, "2026-10-01"), 95);
  assert.equal(resolveUserSharePercent(vinhVien, GENERAL, "2099-12-31"), 95);
  // Van khong hoi to truoc ngay bat dau.
  assert.equal(resolveUserSharePercent(vinhVien, GENERAL, "2026-09-30"), GENERAL);
});

test("khong co override -> % chung", () => {
  assert.equal(resolveUserSharePercent(null, GENERAL, "2026-10-15"), GENERAL);
});

test("% rieng THAP hon % chung van duoc ap dung (quyet dinh cua admin, form canh bao rieng)", () => {
  assert.equal(resolveUserSharePercent(override({ userSharePercent: 50 }), GENERAL, "2026-10-15"), 50);
});

test("% rieng = 0 la gia tri that, khong bi coi la 'chua dat' roi lui ve % chung", () => {
  assert.equal(resolveUserSharePercent(override({ userSharePercent: 0 }), GENERAL, "2026-10-15"), 0);
});

test("isOverrideActiveOn: bien cua khoang", () => {
  const o = override();
  assert.equal(isOverrideActiveOn(o, "2026-09-30"), false);
  assert.equal(isOverrideActiveOn(o, "2026-10-01"), true);
  assert.equal(isOverrideActiveOn(o, "2026-10-31"), true);
  assert.equal(isOverrideActiveOn(o, "2026-11-01"), false);
});
