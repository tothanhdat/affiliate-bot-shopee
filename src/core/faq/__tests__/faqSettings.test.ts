import { test } from "node:test";
import assert from "node:assert/strict";
import { SETTINGS_KEYS, faqAnswerKey } from "../../settingsKeys.js";
import { SETTINGS_REGISTRY } from "../../../config/settingsRegistry.js";
import { FAQ_TOPICS, FAQ_MUTE_MINUTES_DEFAULT } from "../faqTopics.js";

test("faqAnswerKey: sinh key theo topic id", () => {
  assert.equal(faqAnswerKey("ty_le_hoa_hong"), "faq_answer_ty_le_hoa_hong");
});

test("SETTINGS_REGISTRY: moi chu de FAQ co dung 1 o textarea", () => {
  for (const topic of FAQ_TOPICS) {
    const field = SETTINGS_REGISTRY.filter((f) => f.key === faqAnswerKey(topic.id));
    assert.equal(field.length, 1, `thieu hoac trung field cho ${topic.id}`);
    assert.equal(field[0].type, "textarea");
    assert.equal(field[0].default, topic.defaultAnswer);
  }
});

test("SETTINGS_REGISTRY: co field so phut khoa FAQ, gioi han hop ly", () => {
  const field = SETTINGS_REGISTRY.find((f) => f.key === SETTINGS_KEYS.faqMuteMinutes);
  assert.ok(field, "thieu field faqMuteMinutes");
  assert.equal(field.type, "number");
  assert.equal(field.default, String(FAQ_MUTE_MINUTES_DEFAULT));
  assert.equal(field.min, 1);
  assert.equal(field.max, 1440);
});

test("SETTINGS_REGISTRY: khong co key trung nhau", () => {
  const keys = SETTINGS_REGISTRY.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length);
});
