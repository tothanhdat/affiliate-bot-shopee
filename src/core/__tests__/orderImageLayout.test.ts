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

// Kha dung < no thi chua rut duoc (yeu cau user 2026-10-08) - anh phai noi cung mot so voi dashboard.
test("dang no lon hon Kha dung: con thieu = no - Kha dung, du Kha dung da qua nguong", () => {
  const view = buildOrderImageView({
    items: [item("A", 1000)],
    availableVnd: 25_000,
    withdrawalThresholdVnd: 20_000,
    debtVnd: 40_000,
  });
  assert.equal(view.canWithdraw, false);
  assert.equal(view.missingText, "15.000đ");
});

test("Kha dung du bu no va qua nguong: rut duoc", () => {
  const view = buildOrderImageView({
    items: [item("A", 1000)],
    availableVnd: 40_000,
    withdrawalThresholdVnd: 20_000,
    debtVnd: 40_000,
  });
  assert.equal(view.canWithdraw, true);
});

test("khong lam thay doi mang items cua caller", () => {
  const items = [item("A", 100), item("B", 900)];
  buildOrderImageView({ items, availableVnd: 0, withdrawalThresholdVnd: 1 });
  assert.deepEqual(
    items.map((i) => i.orderId),
    ["A", "B"]
  );
});

// ---------------------------------------------------------------------------
// Dong "Trong do X mo khoa tu dd/mm" (2026-10-08)
//
// Anh in Tong cong cua lo CANH So du kha dung. Don bi giam vao Tong cong nhung KHONG vao So du kha
// dung -> user soi dung mot tam anh thay 2 so khong khop.
// ---------------------------------------------------------------------------

test("lo KHONG co don bi giam -> heldLine null (anh y nhu cu)", () => {
  const view = buildOrderImageView({
    items: [{ orderId: "A", productName: "San pham", userShareAmount: 10_000 }],
    availableVnd: 10_000,
    withdrawalThresholdVnd: 20_000,
  });
  assert.equal(view.heldLine, null);
});

test("heldVnd = 0 -> van la null, khong hien 'Trong do 0d'", () => {
  const view = buildOrderImageView({
    items: [{ orderId: "A", productName: "San pham", userShareAmount: 10_000 }],
    availableVnd: 10_000,
    withdrawalThresholdVnd: 20_000,
    heldVnd: 0,
    heldUnlockDayText: "15/10",
  });
  assert.equal(view.heldLine, null);
});

test("lo co don bi giam -> heldLine noi ro so tien va ngay mo khoa", () => {
  const view = buildOrderImageView({
    items: [
      { orderId: "BIG", productName: "May anh", userShareAmount: 150_000 },
      { orderId: "SMALL", productName: "Ao thun", userShareAmount: 16_000 },
    ],
    availableVnd: 16_000,
    withdrawalThresholdVnd: 20_000,
    heldVnd: 150_000,
    heldUnlockDayText: "15/10",
  });
  assert.equal(view.heldLine, "Trong đó 150.000đ mở khoá từ 15/10");
  assert.equal(view.totalText, "166.000đ", "TONG van tinh tren TAT CA don");
  assert.equal(view.availableText, "16.000đ", "so du KHONG gom don bi giam");
});

test("thieu ngay mo khoa -> khong bia dong giam", () => {
  const view = buildOrderImageView({
    items: [{ orderId: "A", productName: "San pham", userShareAmount: 150_000 }],
    availableVnd: 0,
    withdrawalThresholdVnd: 20_000,
    heldVnd: 150_000,
    heldUnlockDayText: null,
  });
  assert.equal(view.heldLine, null);
});

// ---------------------------------------------------------------------------
// debtLine - giai thich khoan NO HOAN TRA dang tru vao Kha dung (2026-10-08)
//
// Khac heldLine (chi lien quan toi LO don vua ve), no co the TON TAI TU TRUOC
// (don bi tra hang o mot lan import khac, khong lien quan gi toi don trong lo
// nay) - nen day la mot khai niem DOC LAP, khong gop chung dieu kien voi heldLine.
// ---------------------------------------------------------------------------

test("khong co no -> debtLine null", () => {
  const view = buildOrderImageView({
    items: [{ orderId: "A", productName: "San pham", userShareAmount: 10_000 }],
    availableVnd: 10_000,
    withdrawalThresholdVnd: 20_000,
  });
  assert.equal(view.debtLine, null);
});

test("debtVnd = 0 -> van la null", () => {
  const view = buildOrderImageView({
    items: [{ orderId: "A", productName: "San pham", userShareAmount: 10_000 }],
    availableVnd: 10_000,
    withdrawalThresholdVnd: 20_000,
    debtVnd: 0,
  });
  assert.equal(view.debtLine, null);
});

// Day la truong hop CHINH user yeu cau: no co tu TRUOC (khong phai don trong lo
// nay bi huy), lo nay chi la 2 don MOI ve - nhung Kha dung da bi tru no ngay lap
// tuc, nen anh/tin nhan PHAI giai thich tai sao Kha dung < Tong cong cua lo.
test("co no tu TRUOC (khong lien quan lo nay) -> debtLine noi ro so tien", () => {
  const view = buildOrderImageView({
    items: [
      { orderId: "NEW1", productName: "San pham 1", userShareAmount: 20_000 },
      { orderId: "NEW2", productName: "San pham 2", userShareAmount: 30_000 },
    ],
    // gross 50k - no 120k (tu truoc, khong lien quan NEW1/NEW2) -> floor 0
    availableVnd: 0,
    withdrawalThresholdVnd: 20_000,
    debtVnd: 120_000,
  });
  assert.equal(view.debtLine, "Đang nợ 120.000đ, trừ khi rút tiền");
  assert.equal(view.totalText, "50.000đ", "tong van la tien cua LO nay");
  assert.equal(view.availableText, "0đ", "kha dung da tru het vi no lon hon gross");
});

test("co CA held lan debt cung luc -> ca hai deu khac null, doc lap nhau", () => {
  const view = buildOrderImageView({
    items: [{ orderId: "BIG", productName: "May anh", userShareAmount: 150_000 }],
    availableVnd: 0,
    withdrawalThresholdVnd: 20_000,
    heldVnd: 150_000,
    heldUnlockDayText: "15/10",
    debtVnd: 40_000,
  });
  assert.equal(view.heldLine, "Trong đó 150.000đ mở khoá từ 15/10");
  assert.equal(view.debtLine, "Đang nợ 40.000đ, trừ khi rút tiền");
});
