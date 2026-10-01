import { test } from "node:test";
import assert from "node:assert/strict";
import { createFaqClassifier } from "../providers/index.js";

/**
 * 2026-10-01: factory tra `null` khi FAQ khong chay duoc, KHONG tra ve mot classifier "rong".
 * Truoc do no tra OffFaqClassifier (classify() -> mang rong), ma mang rong lai roi dung vao nhanh
 * "khong nhan ra chu de" cua FaqService -> bot tra "Cau hoi nay ngoai pham vi..." cho MOI tin DM
 * tren moi instance de FAQ_PROVIDER=off (mac dinh!), trong khi doc va chinh class do hua "bot im
 * lang y het hanh vi truoc khi co tinh nang nay". `null` buoc index.ts khong tao FaqService, va
 * adapter da co san duong im lang khi thieu faqService.
 */

test("createFaqClassifier: provider=off -> null (khong tao classifier rong)", () => {
  assert.equal(createFaqClassifier({ provider: "off", apiKey: "sk-test", model: "claude-haiku-4-5" }), null);
});

test("createFaqClassifier: provider la -> null", () => {
  assert.equal(createFaqClassifier({ provider: "gpt", apiKey: "sk-test", model: "claude-haiku-4-5" }), null);
});

test("createFaqClassifier: provider=claude nhung thieu apiKey -> null, KHONG throw", () => {
  assert.equal(createFaqClassifier({ provider: "claude", apiKey: "", model: "claude-haiku-4-5" }), null);
});

test("createFaqClassifier: provider=claude + co apiKey -> tra ve classifier that", () => {
  const classifier = createFaqClassifier({
    provider: "claude",
    apiKey: "sk-test",
    model: "claude-haiku-4-5",
  });
  assert.notEqual(classifier, null);
  assert.equal(typeof classifier?.classify, "function");
});
