import { test } from "node:test";
import assert from "node:assert/strict";
import { renderUsersPage, userAvatar } from "../adminHtml.js";

/**
 * /admin/users hien CA user chua tung dat don (2026-10-09) + avatar Zalo cho admin de nhan dien.
 * Xem muc zalo_known_users trong CLAUDE.md.
 */

type UserRow = Parameters<typeof renderUsersPage>[0][number];

function userRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    platform: "zalo",
    userId: "u-001",
    displayName: "Trần Bảo",
    avatarUrl: null,
    availableBalance: 0,
    pendingBalance: 0,
    paidTotal: 0,
    debtRemaining: 0,
    heldBalance: 0,
    ordersCount: 1,
    commissionOverride: null,
    ...overrides,
  };
}

test("userAvatar: co avatarUrl thi ve anh bang background-image", () => {
  const html = userAvatar("Trần Bảo", "u-001", "https://s120-ava.zadn.vn/a.jpg");

  assert.match(html, /background-image:url\('https:\/\/s120-ava\.zadn\.vn\/a\.jpg'\)/);
  assert.ok(!html.includes(">TB<"), "co anh thi khong de chu cai de len tren anh");
});

test("userAvatar: khong co avatarUrl thi giu nguyen o tron chu cai", () => {
  const html = userAvatar("Trần Bảo", "u-001");

  assert.ok(html.includes("TB"), "lui ve chu dau + chu cuoi nhu truoc");
  assert.ok(!html.includes("background-image"));
});

/**
 * URL den tu Zalo (ben thu ba) va di vao thuoc tinh style= - mot URL chua ' hoac ) se dong som
 * ham url() va nhet them khai bao CSS khac vao trang admin. Khong tin duoc thi KHONG ve anh.
 */
test("userAvatar: tu choi URL khong phai https hoac co ky tu pha duoc CSS", () => {
  for (const bad of [
    "javascript:alert(1)",
    "http://s120-ava.zadn.vn/a.jpg",
    "https://ava/a.jpg');background:red;x:url('",
    'https://ava/a"b.jpg',
    "https://ava/a b.jpg",
  ]) {
    const html = userAvatar("Trần Bảo", "u-001", bad);
    assert.ok(!html.includes("background-image"), `phai bo qua URL khong tin duoc: ${bad}`);
    assert.ok(html.includes("TB"), "va lui ve chu cai");
  }
});

test("userAvatar: user chua co ten nhung co avatar van ve anh", () => {
  const html = userAvatar(null, "u-001", "https://s120-ava.zadn.vn/a.jpg");

  assert.match(html, /background-image:url\('https:\/\/s120-ava\.zadn\.vn\/a\.jpg'\)/);
});

test("/admin/users: the KPI dem ca user chua co don, kem dong phu so user da co don", () => {
  const html = renderUsersPage(
    [
      userRow({ userId: "u-001", ordersCount: 2 }),
      userRow({ userId: "u-002", ordersCount: 0, displayName: null }),
      userRow({ userId: "u-003", ordersCount: 0, displayName: null }),
    ],
    80,
    "2026-10-09"
  );

  assert.match(html, /Tổng người dùng/);
  assert.match(html, />3</, "dem ca user chua co don");
  assert.match(html, /1 đã có đơn/);
});

test("/admin/users: user chua co don van co dong trong bang", () => {
  const html = renderUsersPage([userRow({ userId: "u-moi", displayName: null, ordersCount: 0 })], 80, "2026-10-09");

  assert.match(html, /u-moi/);
  assert.match(html, /data-orders="0"/);
});

test("/admin/users: co o loc theo da/chua co don", () => {
  const html = renderUsersPage([userRow()], 80, "2026-10-09");

  assert.match(html, /id="user-orders-filter"/);
  assert.match(html, /value="with-orders"/);
  assert.match(html, /value="no-orders"/);
});

/**
 * Cau "Chua co user nao co don hang" cu la SAI ke tu khi danh sach gom ca thanh vien group: trang
 * rong gio nghia la bot chua thay ai trong group khach hang nao (hoac chua tick group nao).
 */
test("/admin/users: trang rong huong dan tick group thay vi noi ve don hang", () => {
  const html = renderUsersPage([], 80, "2026-10-09");

  assert.ok(!html.includes("Chưa có user nào có đơn hàng"));
  assert.match(html, /\/admin\/settings/);
});
