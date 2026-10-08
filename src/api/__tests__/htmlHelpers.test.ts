import { test } from "node:test";
import assert from "node:assert/strict";
import { formatVnd, statusBadge } from "../htmlHelpers.js";
import type { CommissionEntry } from "../../core/types.js";

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

// ---------------------------------------------------------------------------
// statusBadge: "Đang tạm giữ" (2026-10-08)
//
// Day la trang thai HIEN THI, khong phai trang thai trong DB - entry van la `confirmed`, chi khac o
// cho available_from con o tuong lai. Phai tach khoi "Khả dụng" vi 2 chu do nghia la RUT DUOC NGAY.
// ---------------------------------------------------------------------------

function badgeEntry(over: Partial<CommissionEntry> = {}): CommissionEntry {
  return {
    id: "e1",
    createdAt: "2026-10-08T01:00:00.000Z",
    orderDate: "2026-10-08",
    completedAt: null,
    availableFrom: null,
    platform: "zalo",
    userId: "u1",
    merchant: "shopee",
    subId: "k-u1-a-b",
    orderId: "ORD1",
    productName: null,
    orderAmount: 100_000,
    commissionAmount: 10_000,
    taxAmount: 0,
    platformFeeAmount: 0,
    afterTaxAmount: 10_000,
    userShareAmount: 8_000,
    taxPercent: 0,
    platformFeePercent: 0,
    userSharePercent: 80,
    status: "confirmed",
    withdrawalId: null,
    note: null,
    proofImagePath: null,
    ...over,
  } as CommissionEntry;
}

test("statusBadge: confirmed khong bi giam -> 'Khả dụng'", () => {
  assert.equal(statusBadge(badgeEntry(), "2026-10-08").label, "Khả dụng");
});

test("statusBadge: confirmed nhung chua toi ngay mo khoa -> 'Đang tạm giữ'", () => {
  const b = statusBadge(badgeEntry({ availableFrom: "2026-10-15" }), "2026-10-08");
  assert.equal(b.label, "Đang tạm giữ");
  assert.equal(b.tone, "warning", "la trang thai DANG CHO, cung tong voi 'Chờ xác nhận'");
});

// Ranh gioi: dung ngay mo khoa thi DA rut duoc, khong con tam giu nua.
test("statusBadge: DUNG ngay mo khoa -> da la 'Khả dụng'", () => {
  assert.equal(statusBadge(badgeEntry({ availableFrom: "2026-10-08" }), "2026-10-08").label, "Khả dụng");
});

test("statusBadge: da qua ngay mo khoa -> 'Khả dụng'", () => {
  assert.equal(statusBadge(badgeEntry({ availableFrom: "2026-08-01" }), "2026-10-08").label, "Khả dụng");
});

// Khong the xay ra trong thuc te (requestWithdrawal loai don bi giam) nhung thu tu kiem phai dung:
// da nam trong yeu cau rut thi "Đang chờ rút" moi la thong tin user can.
test("statusBadge: da nam trong yeu cau rut -> 'Đang chờ rút' thang truoc", () => {
  const b = statusBadge(badgeEntry({ availableFrom: "2026-10-15", withdrawalId: "w1" }), "2026-10-08");
  assert.equal(b.label, "Đang chờ rút");
});

test("statusBadge: pending/paid/reversed khong bi anh huong", () => {
  assert.equal(statusBadge(badgeEntry({ status: "pending" }), "2026-10-08").label, "Chờ xác nhận");
  assert.equal(statusBadge(badgeEntry({ status: "paid" }), "2026-10-08").label, "Đã rút");
  assert.equal(statusBadge(badgeEntry({ status: "reversed" }), "2026-10-08").label, "Đã huỷ");
});
