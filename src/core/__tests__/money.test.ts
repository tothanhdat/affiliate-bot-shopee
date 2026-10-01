import { test } from "node:test";
import assert from "node:assert/strict";
import { formatVnd } from "../money.js";
import { ImplausibleCommissionAmountError, InsufficientBalanceError } from "../errors.js";

/**
 * 1 ham dinh dang tien DUY NHAT cho ca he thong (2026-10-01). Truoc do co 4 ban sao roi rac
 * (htmlHelpers.ts, replyText.ts, faqService.ts, va toLocaleString tho trong errors.ts) - ban trong
 * htmlHelpers.ts quen lam tron nen dashboard hien "146.457,765đ" trong khi tin nhan bot cho cung
 * don do lai hien "146.458đ".
 */

test("formatVnd: luon ra so nguyen", () => {
  assert.equal(formatVnd(146_457.765), "146.458đ");
  assert.equal(formatVnd(22_990.5), "22.991đ");
  assert.equal(formatVnd(1_000_000), "1.000.000đ");
});

test("loi so du khong du: so tien trong cau thong bao da lam tron", () => {
  const err = new InsufficientBalanceError(12_345.678, 50_000);
  assert.match(err.userMessage, /12\.346đ/);
  // Khong con dau phay THAP PHAN (vd "12.345,678") - dau phay ngu phap trong cau van hop le.
  assert.doesNotMatch(err.userMessage, /\d,\d/);
});

test("loi hoa hong vo ly: so tien trong cau thong bao da lam tron", () => {
  const err = new ImplausibleCommissionAmountError(1_234.56, 2_000.49, 50);
  assert.match(err.userMessage, /1\.235đ/);
  assert.match(err.userMessage, /2\.000đ/);
  assert.doesNotMatch(err.userMessage, /\d,\d/);
});
