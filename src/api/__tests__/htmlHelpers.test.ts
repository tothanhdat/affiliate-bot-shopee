import { test } from "node:test";
import assert from "node:assert/strict";
import { formatVnd } from "../htmlHelpers.js";

/**
 * MOI so tien hien thi tren web (dashboard ca nhan, toan bo /admin, trang So tay) deu di qua
 * formatVnd va phai ra SO NGUYEN (yeu cau cua user 2026-10-01).
 *
 * Ly do co so le ngay tu dau: Shopee tra hoa hong le toi phan nghin dong (vd 22.990,5d) nen
 * commission_amount/after_tax_amount trong DB la so thuc; cong nhieu don lai ra "146.457,765d",
 * trong nhu loi he thong. Lam tron CHI o buoc hien thi - so trong DB giu nguyen do chinh xac.
 */

test("formatVnd: lam tron so le ve so nguyen", () => {
  assert.equal(formatVnd(146_457.765), "146.458đ");
  assert.equal(formatVnd(130_493.765), "130.494đ");
});

test("formatVnd: .5 lam tron len", () => {
  assert.equal(formatVnd(22_990.5), "22.991đ");
});

test("formatVnd: so nguyen giu nguyen, van co dau cham ngan cach hang nghin", () => {
  assert.equal(formatVnd(1_000_000), "1.000.000đ");
  assert.equal(formatVnd(0), "0đ");
});

test("formatVnd: khong bao gio con dau phay thap phan trong chuoi tra ve", () => {
  for (const value of [0.4, 0.6, 1.05, 999.999, 1_234_567.891]) {
    assert.ok(!formatVnd(value).includes(","), `formatVnd(${value}) = ${formatVnd(value)}`);
  }
});
