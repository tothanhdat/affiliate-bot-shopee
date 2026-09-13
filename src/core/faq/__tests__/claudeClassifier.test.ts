import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClassifierSystemPrompt, parseTopicIds } from "../providers/claudeClassifier.js";
import { createFaqClassifier } from "../providers/index.js";
import { FAQ_TOPICS } from "../faqTopics.js";

test("buildClassifierSystemPrompt: liet ke du id + mo ta cua moi chu de", () => {
  const prompt = buildClassifierSystemPrompt(FAQ_TOPICS);
  for (const topic of FAQ_TOPICS) {
    assert.ok(prompt.includes(topic.id), `thieu id ${topic.id}`);
    assert.ok(prompt.includes(topic.description), `thieu mo ta ${topic.id}`);
  }
});

test("parseTopicIds: nhan dung 1 id", () => {
  assert.deepEqual(parseTopicIds("ty_le_hoa_hong", FAQ_TOPICS), ["ty_le_hoa_hong"]);
});

test("parseTopicIds: chiu duoc dinh dang JSON array va chu thua xung quanh", () => {
  assert.deepEqual(parseTopicIds('["cach_rut_tien"]', FAQ_TOPICS), ["cach_rut_tien"]);
  assert.deepEqual(parseTopicIds("Chu de: cach_rut_tien.", FAQ_TOPICS), ["cach_rut_tien"]);
});

test("parseTopicIds: nhan 2 id, giu thu tu xuat hien", () => {
  assert.deepEqual(parseTopicIds('["cach_rut_tien", "xem_so_du"]', FAQ_TOPICS), [
    "cach_rut_tien",
    "xem_so_du",
  ]);
});

test("parseTopicIds: id la / KHONG_BIET -> rong", () => {
  assert.deepEqual(parseTopicIds("KHONG_BIET", FAQ_TOPICS), []);
  assert.deepEqual(parseTopicIds("khong_ro_chu_de_nay", FAQ_TOPICS), []);
  assert.deepEqual(parseTopicIds("", FAQ_TOPICS), []);
});

// Model doc vet ca danh sach chu de thay vi chon -> khong duoc coi la "khop 2 chu de dau tien".
test("parseTopicIds: qua 2 id -> coi nhu khong dang tin, tra rong", () => {
  const raw = FAQ_TOPICS.map((t) => t.id).join(", ");
  assert.deepEqual(parseTopicIds(raw, FAQ_TOPICS), []);
});

test("parseTopicIds: id trung lap chi tinh 1 lan", () => {
  assert.deepEqual(parseTopicIds("xem_so_du xem_so_du", FAQ_TOPICS), ["xem_so_du"]);
});

test("createFaqClassifier: provider 'off' luon tra rong", async () => {
  const classifier = createFaqClassifier({ provider: "off", apiKey: "", model: "claude-haiku-4-5" });
  assert.deepEqual(await classifier.classify("hoàn tiền sao?", FAQ_TOPICS), []);
});

test("createFaqClassifier: provider 'claude' thieu apiKey -> rot ve off thay vi crash luc khoi dong", async () => {
  const classifier = createFaqClassifier({ provider: "claude", apiKey: "", model: "claude-haiku-4-5" });
  assert.deepEqual(await classifier.classify("hoàn tiền sao?", FAQ_TOPICS), []);
});
