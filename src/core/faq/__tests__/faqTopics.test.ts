import { test } from "node:test";
import assert from "node:assert/strict";
import { FAQ_TOPICS, FAQ_ANSWER_PLACEHOLDERS } from "../faqTopics.js";

test("FAQ_TOPICS: du 8 chu de, id khong trung", () => {
  assert.equal(FAQ_TOPICS.length, 8);
  const ids = FAQ_TOPICS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("FAQ_TOPICS: id chi gom chu thuong/so/gach duoi (parseTopicIds dua vao dieu nay)", () => {
  for (const topic of FAQ_TOPICS) {
    assert.match(topic.id, /^[a-z0-9_]+$/, `id sai dinh dang: ${topic.id}`);
  }
});

test("FAQ_TOPICS: moi chu de deu co label/description/defaultAnswer khong rong", () => {
  for (const topic of FAQ_TOPICS) {
    assert.ok(topic.label.trim().length > 0, `thieu label: ${topic.id}`);
    assert.ok(topic.description.trim().length > 0, `thieu description: ${topic.id}`);
    assert.ok(topic.defaultAnswer.trim().length > 0, `thieu defaultAnswer: ${topic.id}`);
  }
});

// Placeholder go sai (vd {{dashboardURL}}) se hien nguyen xi trong tin nhan that gui cho user,
// vi renderTemplate() co y GIU NGUYEN placeholder khong khop thay vi throw.
test("FAQ_TOPICS: moi placeholder trong defaultAnswer deu nam trong danh sach duoc ho tro", () => {
  for (const topic of FAQ_TOPICS) {
    for (const match of topic.defaultAnswer.matchAll(/\{\{(\w+)\}\}/g)) {
      assert.ok(
        FAQ_ANSWER_PLACEHOLDERS.includes(match[1]),
        `placeholder la trong ${topic.id}: {{${match[1]}}}`
      );
    }
  }
});
