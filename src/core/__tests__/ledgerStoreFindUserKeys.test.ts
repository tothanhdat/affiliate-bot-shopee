import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../ledgerStore.js";

test("findUserKeysByDisplayName: khong phan biet hoa/thuong va dau tieng Viet, ke ca chu 'đ'", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.upsertUserProfile("zalo", "1", "Nguyễn Thảo");
    store.upsertUserProfile("zalo", "2", "Đặng Dũng");
    store.upsertUserProfile("telegram", "3", "thao pham");

    assert.deepEqual(store.findUserKeysByDisplayName("THẢO").sort(), ["telegram:3", "zalo:1"]);
    assert.deepEqual(store.findUserKeysByDisplayName("dang dung"), ["zalo:2"]);
    assert.deepEqual(store.findUserKeysByDisplayName("đặng"), ["zalo:2"]);
  } finally {
    store.close();
  }
});

test("findUserKeysByDisplayName: chuoi rong/khoang trang hoac khong ai khop -> mang rong (khong khop het user)", () => {
  const store = new LedgerStore(":memory:");
  try {
    store.upsertUserProfile("zalo", "1", "Nguyễn Thảo");
    assert.deepEqual(store.findUserKeysByDisplayName(""), []);
    assert.deepEqual(store.findUserKeysByDisplayName("   "), []);
    assert.deepEqual(store.findUserKeysByDisplayName("khong ai ten nay"), []);
  } finally {
    store.close();
  }
});
