import { test } from "node:test";
import assert from "node:assert/strict";
import { SentMessageTracker } from "../sentMessageTracker.js";
import { collectSentMsgIds, buildDirectMessagePayload } from "../bot.js";

/**
 * zca-js tra ve { message, attachment[] }. Khi co dinh kem thi CHU co the di cung attachment va
 * `message` tra ve null. Chi ghi nhan result.message.msgId se lam bot KHONG nhan ra tin cua chinh
 * minh -> handleSelfMessage hieu nham la admin go tay -> bot TU KHOA FAQ cua chinh no 30 phut.
 */

test("gom msgId tu CA message lan moi phan tu attachment", () => {
  assert.deepEqual(collectSentMsgIds({ message: { msgId: 11 }, attachment: [] }), [11]);
  assert.deepEqual(collectSentMsgIds({ message: null, attachment: [{ msgId: 22 }] }), [22]);
  assert.deepEqual(collectSentMsgIds({ message: { msgId: 11 }, attachment: [{ msgId: 22 }, { msgId: 33 }] }), [
    11, 22, 33,
  ]);
});

test("khong co msgId nao thi tra ve mot phan tu null de van ghi dau vet theo noi dung", () => {
  assert.deepEqual(collectSentMsgIds(undefined), [null]);
  assert.deepEqual(collectSentMsgIds({ message: null, attachment: [] }), [null]);
});

test("tracker nhan ra tin cua chinh bot khi msgId CHI nam trong attachment", () => {
  const tracker = new SentMessageTracker();
  for (const id of collectSentMsgIds({ message: null, attachment: [{ msgId: 22 }] })) {
    tracker.record(id, "noi dung");
  }
  assert.equal(tracker.isOwn("22", "noi dung"), true);
});

test("khong co anh thi gui chuoi thuan", () => {
  assert.equal(buildDirectMessagePayload({ text: "chao" }), "chao");
});

test("co anh thi gui kem attachments dung metadata", () => {
  const image = {
    data: Buffer.from([1, 2, 3]),
    width: 1408,
    height: 768,
    filename: "don-ve.jpg" as const,
  };
  const payload = buildDirectMessagePayload({ text: "co anh", image });
  assert.notEqual(typeof payload, "string");
  const obj = payload as {
    msg: string;
    attachments: Array<{ filename: string; metadata: { totalSize: number; width: number; height: number } }>;
  };
  assert.equal(obj.msg, "co anh");
  assert.equal(obj.attachments.length, 1);
  assert.equal(obj.attachments[0].filename, "don-ve.jpg");
  assert.equal(obj.attachments[0].metadata.totalSize, 3);
  assert.equal(obj.attachments[0].metadata.width, 1408);
  assert.equal(obj.attachments[0].metadata.height, 768);
});
