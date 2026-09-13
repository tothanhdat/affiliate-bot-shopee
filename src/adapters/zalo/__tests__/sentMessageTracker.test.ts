import { test } from "node:test";
import assert from "node:assert/strict";
import { SentMessageTracker } from "../sentMessageTracker.js";

function trackerAt(clock: { now: number }) {
  return new SentMessageTracker({ now: () => clock.now });
}

test("isOwn: msgId da ghi -> dung la tin cua bot", () => {
  const clock = { now: 1_000_000 };
  const tracker = trackerAt(clock);
  tracker.record(12345, "xin chao");
  assert.equal(tracker.isOwn("12345", "xin chao"), true);
});

test("isOwn: msgId la -> khong phai tin cua bot (admin go tay)", () => {
  const clock = { now: 1_000_000 };
  const tracker = trackerAt(clock);
  tracker.record(12345, "xin chao");
  assert.equal(tracker.isOwn("99999", "admin go tay"), false);
});

// api.sendMessage co the tra message: null -> khong co msgId de doi chieu, roi ve so khop noi dung.
test("isOwn: khong co msgId -> so khop noi dung trong 60s", () => {
  const clock = { now: 1_000_000 };
  const tracker = trackerAt(clock);
  tracker.record(null, "cau tra loi cua bot");
  assert.equal(tracker.isOwn("77777", "cau tra loi cua bot"), true);
  clock.now += 61_000;
  assert.equal(tracker.isOwn("77777", "cau tra loi cua bot"), false);
});

test("isOwn: entry het han sau 5 phut", () => {
  const clock = { now: 1_000_000 };
  const tracker = trackerAt(clock);
  tracker.record(12345, "xin chao");
  clock.now += 4 * 60_000;
  assert.equal(tracker.isOwn("12345", "xin chao"), true);
  clock.now += 2 * 60_000;
  assert.equal(tracker.isOwn("12345", "xin chao"), false);
});

test("record: khong phinh vo han - entry cu bi don khi ghi them", () => {
  const clock = { now: 1_000_000 };
  const tracker = trackerAt(clock);
  for (let i = 0; i < 100; i += 1) tracker.record(i, `tin ${i}`);
  clock.now += 6 * 60_000;
  tracker.record(999, "tin moi");
  assert.equal(tracker.size, 1);
});
