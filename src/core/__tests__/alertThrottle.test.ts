import { test } from "node:test";
import assert from "node:assert/strict";
import { AlertThrottle } from "../alertThrottle.js";

test("tin dau tien LUON duoc gui ngay", () => {
  const t = new AlertThrottle(15 * 60_000);
  assert.equal(t.shouldSend("server_error", 1_000), true);
});

test("trong cua so thi gop - su co 7 phut khong duoc sinh 20 tin giong nhau", () => {
  const t = new AlertThrottle(15 * 60_000);
  t.shouldSend("server_error", 0);
  assert.equal(t.shouldSend("server_error", 60_000), false);
  assert.equal(t.shouldSend("server_error", 14 * 60_000), false);
});

test("het cua so thi gui lai", () => {
  const t = new AlertThrottle(15 * 60_000);
  t.shouldSend("server_error", 0);
  assert.equal(t.shouldSend("server_error", 15 * 60_000), true);
});

test("ma loi KHAC nhau khong chan nhau", () => {
  const t = new AlertThrottle(15 * 60_000);
  t.shouldSend("server_error", 0);
  // Key sai la viec khac han backend sap - admin phai biet ngay.
  assert.equal(t.shouldSend("unauthorized", 1_000), true);
});
