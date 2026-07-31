import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "../rateLimiter.js";

test("RateLimiter: cho phep den dung so luong toi da trong window", () => {
  const limiter = new RateLimiter(2, 60_000);
  try {
    assert.equal(limiter.checkAndRecord("user-a").allowed, true);
    assert.equal(limiter.checkAndRecord("user-a").allowed, true);
    assert.equal(limiter.checkAndRecord("user-a").allowed, false);
  } finally {
    limiter.stop();
  }
});

test("RateLimiter: cac key khac nhau khong anh huong lan nhau", () => {
  const limiter = new RateLimiter(1, 60_000);
  try {
    assert.equal(limiter.checkAndRecord("user-a").allowed, true);
    assert.equal(limiter.checkAndRecord("user-b").allowed, true);
    assert.equal(limiter.checkAndRecord("user-a").allowed, false);
  } finally {
    limiter.stop();
  }
});

test("RateLimiter: cho phep lai sau khi het window", async () => {
  const limiter = new RateLimiter(1, 50);
  try {
    assert.equal(limiter.checkAndRecord("user-a").allowed, true);
    assert.equal(limiter.checkAndRecord("user-a").allowed, false);
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(limiter.checkAndRecord("user-a").allowed, true);
  } finally {
    limiter.stop();
  }
});
