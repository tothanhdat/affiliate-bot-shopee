import { test } from "node:test";
import assert from "node:assert/strict";
import jpeg from "jpeg-js";
import { buildOrderImageView } from "../orderImage/orderImageLayout.js";
import {
  renderOrdersImage,
  renderOrdersImageSafe,
  ORDER_IMAGE_WIDTH,
  ORDER_IMAGE_HEIGHT,
} from "../orderImage/orderImageRenderer.js";
import type { ConfirmedOrderItem } from "../orderIngest.js";

const item = (
  orderId: string,
  userShareAmount: number,
  productName: string | null = "San pham"
): ConfirmedOrderItem => ({ orderId, productName, userShareAmount });

const view = (items: ConfirmedOrderItem[], availableVnd = 5000) =>
  buildOrderImageView({ items, availableVnd, withdrawalThresholdVnd: 20000 });

test("tra ve JPEG dung kich thuoc khung", async () => {
  const out = await renderOrdersImage(view([item("A", 2290), item("B", 13776), item("C", 2362)]));
  // Magic bytes cua JPEG: FF D8 FF
  assert.equal(out.data[0], 0xff);
  assert.equal(out.data[1], 0xd8);
  assert.equal(out.data[2], 0xff);
  assert.equal(out.width, ORDER_IMAGE_WIDTH);
  assert.equal(out.height, ORDER_IMAGE_HEIGHT);
  const decoded = jpeg.decode(out.data);
  assert.equal(decoded.width, ORDER_IMAGE_WIDTH);
  assert.equal(decoded.height, ORDER_IMAGE_HEIGHT);
});

test("render duoc voi 1, 2, 3 va 5 don", async () => {
  const all = [item("A", 2290), item("B", 13776), item("C", 2362), item("D", 8100), item("E", 21400)];
  for (const n of [1, 2, 3, 5]) {
    const out = await renderOrdersImage(view(all.slice(0, n)));
    assert.ok(out.data.length > 1000, `so don = ${n} ra anh rong`);
  }
});

/**
 * Chan bay lineClamp: lineClamp cua satori CHI an khi display la "block". De "flex" thi no im
 * lang bo qua, ten dai tran ra 5 dong va day so tien ra khoi the.
 */
test("ten san pham cuc dai khong lam vo bo cuc", async () => {
  const long =
    "Combo 3 hộp Yến Sào Khánh Hoà nguyên tổ loại đặc biệt 100g tặng kèm đường phèn hạt sen " +
    "hộp quà biếu tết cao cấp sang trọng dành cho người lớn tuổi (+4 sản phẩm khác)";
  const out = await renderOrdersImage(view([item("A", 93500, long), item("B", 1000, long)]));
  assert.equal(out.height, ORDER_IMAGE_HEIGHT);
});

test("render duoc ca hai trang thai so du", async () => {
  const chuaDu = await renderOrdersImage(view([item("A", 1000)], 18428));
  const duRoi = await renderOrdersImage(view([item("A", 1000)], 29000));
  // Hai trang thai in chu khac nhau nen anh phai khac nhau.
  assert.notEqual(chuaDu.data.toString("base64"), duRoi.data.toString("base64"));
});

test("renderOrdersImageSafe tra null thay vi nem loi khi view hong", async () => {
  const broken = { ...view([item("A", 1000)]), cards: null } as never;
  const out = await renderOrdersImageSafe(broken);
  assert.equal(out, null);
});
