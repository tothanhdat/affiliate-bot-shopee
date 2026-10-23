import assert from "node:assert/strict";
import { test } from "node:test";
import { maskUserId } from "../dashboardHtml.js";

test("maskUserId che 4 ky tu dau + 4 ky tu cuoi, chi hien phan giua", () => {
  assert.equal(maskUserId("1234567890123456789"), "****56789012345****");
  assert.equal(maskUserId("123456789"), "****5****");
});

test("maskUserId che het khi ID khong con phan giua de hien", () => {
  assert.equal(maskUserId("12345678"), "****");
  assert.equal(maskUserId("abc"), "****");
});
