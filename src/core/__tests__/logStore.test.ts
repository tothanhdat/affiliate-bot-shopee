import { test } from "node:test";
import assert from "node:assert/strict";
import { LogStore } from "../logStore.js";

test("LogStore: record roi queryByDateRange doc lai dung entry theo ngay", () => {
  const store = new LogStore(":memory:");
  try {
    const today = new Date().toISOString().slice(0, 10);
    store.record({
      platform: "telegram",
      merchant: "shopee",
      userId: "user-a",
      originalUrl: "https://shopee.vn/san-pham-i.1.2",
      subId: "telegram-user-a-abc-123",
      outcome: "success",
      errorCode: null,
      affiliateUrl: "https://aff.example/abc",
    });

    const entries = store.queryByDateRange(today, today, "telegram");
    assert.equal(entries.length, 1);
    assert.equal(entries[0].userId, "user-a");
    assert.equal(entries[0].subId, "telegram-user-a-abc-123");
  } finally {
    store.close();
  }
});

test("LogStore: queryByDateRange loc dung theo merchant", () => {
  const store = new LogStore(":memory:");
  try {
    const today = new Date().toISOString().slice(0, 10);
    store.record({
      platform: "telegram",
      merchant: "shopee",
      userId: "user-a",
      originalUrl: "https://shopee.vn/x-i.1.2",
      subId: "sub-shopee",
      outcome: "success",
      errorCode: null,
      affiliateUrl: "https://aff.example/1",
    });
    store.record({
      platform: "telegram",
      merchant: "lazada",
      userId: "user-a",
      originalUrl: "https://lazada.vn/x",
      subId: "sub-lazada",
      outcome: "success",
      errorCode: null,
      affiliateUrl: "https://aff.example/2",
    });

    const shopeeOnly = store.queryByDateRange(today, today, undefined, "shopee");
    assert.equal(shopeeOnly.length, 1);
    assert.equal(shopeeOnly[0].subId, "sub-shopee");
  } finally {
    store.close();
  }
});

test("LogStore: findBySubId tra ve dung entry hoac null neu khong co", () => {
  const store = new LogStore(":memory:");
  try {
    store.record({
      platform: "zalo",
      merchant: "shopee",
      userId: "user-b",
      originalUrl: "https://shopee.vn/y-i.3.4",
      subId: "zalo-user-b-xyz-999",
      outcome: "success",
      errorCode: null,
      affiliateUrl: "https://aff.example/3",
    });

    const found = store.findBySubId("zalo-user-b-xyz-999");
    assert.notEqual(found, null);
    assert.equal(found?.userId, "user-b");
    assert.equal(found?.platform, "zalo");
    assert.equal(found?.merchant, "shopee");

    assert.equal(store.findBySubId("khong-ton-tai"), null);
  } finally {
    store.close();
  }
});

test("LogStore: findBySubId bo qua entry loi (subId null)", () => {
  const store = new LogStore(":memory:");
  try {
    store.record({
      platform: "telegram",
      merchant: null,
      userId: "user-c",
      originalUrl: "not-a-valid-url",
      subId: null,
      outcome: "error",
      errorCode: "INVALID_LINK",
      affiliateUrl: null,
    });

    assert.equal(store.findBySubId("khong-ton-tai"), null);
  } finally {
    store.close();
  }
});
