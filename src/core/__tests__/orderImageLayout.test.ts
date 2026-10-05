import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOrderImageView } from "../orderImage/orderImageLayout.js";
import type { ConfirmedOrderItem } from "../orderIngest.js";

/**
 * View model cua anh bao "don ve". Test o day chot 2 thu de sai nhat: chon dung 3 don len the,
 * va TONG phai tinh tren TAT CA don - neu ai do sua thanh tong 3 the dang hien thi thi user se
 * thay so tien nho hon so thuc nhan, do la sai lech ve TIEN.
 */

const item = (
  orderId: string,
  userShareAmount: number,
  productName: string | null = "San pham"
): ConfirmedOrderItem => ({ orderId, productName, userShareAmount });

test("chon 3 don tien cao nhat, xep giam dan", () => {
  const view = buildOrderImageView({
    items: [item("A", 2290), item("B", 13776), item("C", 2362), item("D", 21400)],
    availableVnd: 0,
    withdrawalThresholdVnd: 20000,
  });
  assert.equal(view.cards.length, 3);
  assert.deepEqual(
    view.cards.map((c) => c.amountText),
    ["21.400đ", "13.776đ", "2.362đ"]
  );
  assert.deepEqual(
    view.cards.map((c) => c.index),
    [1, 2, 3]
  );
  assert.equal(view.extraCount, 1);
  assert.equal(view.orderCount, 4);
});

test("tong cong tinh tren TAT CA don, khong phai 3 don hien tren anh", () => {
  const view = buildOrderImageView({
    items: [item("A", 2290), item("B", 13776), item("C", 2362), item("D", 8100), item("E", 21400)],
    availableVnd: 0,
    withdrawalThresholdVnd: 20000,
  });
  assert.equal(view.totalText, "47.928đ");
});

test("productName rong thi lui ve 'Don <orderId>'", () => {
  const view = buildOrderImageView({
    items: [item("260909K72F4DAY", 5000, null)],
    availableVnd: 0,
    withdrawalThresholdVnd: 20000,
  });
  assert.equal(view.cards[0].name, "Đơn 260909K72F4DAY");
});

test("du nguong (bang dung nguong) thi rut duoc, khong con dong thieu bao nhieu", () => {
  const view = buildOrderImageView({
    items: [item("A", 1000)],
    availableVnd: 20000,
    withdrawalThresholdVnd: 20000,
  });
  assert.equal(view.canWithdraw, true);
  assert.equal(view.missingText, null);
  assert.equal(view.availableText, "20.000đ");
});

test("chua du nguong thi bao con thieu bao nhieu", () => {
  const view = buildOrderImageView({
    items: [item("A", 1000)],
    availableVnd: 18428,
    withdrawalThresholdVnd: 20000,
  });
  assert.equal(view.canWithdraw, false);
  assert.equal(view.missingText, "1.572đ");
});

test("khong lam thay doi mang items cua caller", () => {
  const items = [item("A", 100), item("B", 900)];
  buildOrderImageView({ items, availableVnd: 0, withdrawalThresholdVnd: 1 });
  assert.deepEqual(
    items.map((i) => i.orderId),
    ["A", "B"]
  );
});
