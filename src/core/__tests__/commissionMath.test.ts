import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCommissionBreakdown } from "../commissionMath.js";

/**
 * Phep tinh chia hoa hong duoc dung o HAI noi: ledgerStore.recordConversion() (ghi tien that) va
 * trang So tay hoan tien (/so-tay, vi du minh hoa cho user). Test o day chot dung thu tu tru va
 * cach lam tron - neu 2 noi tinh khac nhau thi So tay se hua 1 con so ma dashboard tra 1 con so
 * khac, do la loai sai lech ve tien khong duoc phep xay ra.
 */

test("computeCommissionBreakdown: tru thue truoc, phi san tinh tren phan DA TRU THUE", () => {
  const result = computeCommissionBreakdown({
    commissionAmount: 7584,
    taxPercent: 10,
    platformFeePercent: 1,
    userSharePercent: 90,
  });

  assert.equal(result.taxAmount, 758);
  assert.equal(result.afterTaxOnly, 6826);
  // 1% tinh tren 6826 (da tru thue), KHONG phai tren 7584 goc.
  assert.equal(result.platformFeeAmount, 68);
  assert.equal(result.afterTaxAmount, 6758);
  assert.equal(result.userShareAmount, 6082);
});

test("computeCommissionBreakdown: phan chu bot la phan con lai, khong lam tron rieng", () => {
  const result = computeCommissionBreakdown({
    commissionAmount: 7584,
    taxPercent: 10,
    platformFeePercent: 1,
    userSharePercent: 90,
  });

  // Tinh rieng round(6758 * 10 / 100) = 676, cong voi 6082 thanh 6758 -> vua khop o vi du nay,
  // nhung nguyen tac chung phai la "phan con lai" de tong KHONG BAO GIO lech vi lam tron 2 lan.
  assert.equal(result.botShareAmount, result.afterTaxAmount - result.userShareAmount);
  assert.equal(result.userShareAmount + result.botShareAmount, result.afterTaxAmount);
});

test("computeCommissionBreakdown: 0% thue va 0% phi thi giu nguyen hoa hong goc", () => {
  const result = computeCommissionBreakdown({
    commissionAmount: 10_000,
    taxPercent: 0,
    platformFeePercent: 0,
    userSharePercent: 90,
  });

  assert.equal(result.taxAmount, 0);
  assert.equal(result.platformFeeAmount, 0);
  assert.equal(result.afterTaxAmount, 10_000);
  assert.equal(result.userShareAmount, 9000);
});

test("computeCommissionBreakdown: hoa hong 0d khong sinh so am", () => {
  const result = computeCommissionBreakdown({
    commissionAmount: 0,
    taxPercent: 10,
    platformFeePercent: 1,
    userSharePercent: 90,
  });

  assert.deepEqual(
    {
      taxAmount: result.taxAmount,
      platformFeeAmount: result.platformFeeAmount,
      afterTaxAmount: result.afterTaxAmount,
      userShareAmount: result.userShareAmount,
      botShareAmount: result.botShareAmount,
    },
    { taxAmount: 0, platformFeeAmount: 0, afterTaxAmount: 0, userShareAmount: 0, botShareAmount: 0 }
  );
});

test("computeCommissionBreakdown: userSharePercent 100 thi chu bot khong giu dong nao", () => {
  const result = computeCommissionBreakdown({
    commissionAmount: 5000,
    taxPercent: 10,
    platformFeePercent: 1,
    userSharePercent: 100,
  });

  assert.equal(result.userShareAmount, result.afterTaxAmount);
  assert.equal(result.botShareAmount, 0);
});
