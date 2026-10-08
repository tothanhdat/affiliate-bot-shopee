import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOrdersConfirmedNotification } from "../orderImage/ordersConfirmedNotification.js";
import { ORDER_IMAGE_WIDTH, ORDER_IMAGE_HEIGHT } from "../orderImage/orderImageRenderer.js";
import type { ConfirmedOrderItem } from "../orderIngest.js";

const items: ConfirmedOrderItem[] = [{ orderId: "A", productName: "San pham", userShareAmount: 2290 }];
const base = {
  items,
  availableVnd: 2290,
  withdrawalThresholdVnd: 20000,
  fallbackText: "TEXT DU PHONG",
  captionText: "CAPTION",
};

test("bat anh thi tra caption kem anh JPEG", async () => {
  const n = await buildOrdersConfirmedNotification({ ...base, imageEnabled: true });
  assert.equal(n.text, "CAPTION");
  assert.ok(n.image, "phai co anh");
  assert.equal(n.image?.width, ORDER_IMAGE_WIDTH);
  assert.equal(n.image?.height, ORDER_IMAGE_HEIGHT);
  assert.ok(n.image?.filename.endsWith(".jpg"));
});

test("tat anh thi tra text du phong, khong render gi ca", async () => {
  let rendered = false;
  const n = await buildOrdersConfirmedNotification({
    ...base,
    imageEnabled: false,
    renderImpl: async () => {
      rendered = true;
      throw new Error("khong duoc goi");
    },
  });
  assert.equal(n.text, "TEXT DU PHONG");
  assert.equal(n.image, undefined);
  assert.equal(rendered, false);
});

/** Tien cua user khong duoc phep mat chi vi anh hong. */
test("render loi thi van tra text du phong chu khong nem loi", async () => {
  const n = await buildOrdersConfirmedNotification({
    ...base,
    imageEnabled: true,
    renderImpl: async () => {
      throw new Error("resvg hong");
    },
  });
  assert.equal(n.text, "TEXT DU PHONG");
  assert.equal(n.image, undefined);
});

test("buildOrdersConfirmedNotification truyen heldVnd/heldUnlockDayText xuong view", async () => {
  let seen: { heldLine: string | null } | null = null;
  await buildOrdersConfirmedNotification({
    items: [{ orderId: "A", productName: "May anh", userShareAmount: 150_000 }],
    availableVnd: 0,
    withdrawalThresholdVnd: 20_000,
    heldVnd: 150_000,
    heldUnlockDayText: "15/10",
    fallbackText: "text",
    captionText: "caption",
    imageEnabled: true,
    renderImpl: async (view) => {
      seen = { heldLine: view.heldLine };
      return { data: Buffer.from("x"), width: 10, height: 10 };
    },
  });
  assert.equal(seen!.heldLine, "Trong đó 150.000đ mở khoá từ 15/10");
});

test("buildOrdersConfirmedNotification truyen debtVnd xuong view, doc lap voi heldVnd", async () => {
  let seen: { heldLine: string | null; debtLine: string | null } | null = null;
  await buildOrdersConfirmedNotification({
    items: [
      { orderId: "NEW1", productName: "San pham 1", userShareAmount: 20_000 },
      { orderId: "NEW2", productName: "San pham 2", userShareAmount: 30_000 },
    ],
    availableVnd: 0,
    withdrawalThresholdVnd: 20_000,
    debtVnd: 120_000,
    fallbackText: "text",
    captionText: "caption",
    imageEnabled: true,
    renderImpl: async (view) => {
      seen = { heldLine: view.heldLine, debtLine: view.debtLine };
      return { data: Buffer.from("x"), width: 10, height: 10 };
    },
  });
  assert.equal(seen!.heldLine, null, "no khong lien quan gi toi giam, heldVnd khong duoc truyen");
  assert.equal(seen!.debtLine, "Đang nợ 120.000đ, trừ khi rút tiền");
});
