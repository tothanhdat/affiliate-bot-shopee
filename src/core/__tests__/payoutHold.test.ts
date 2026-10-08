import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAvailableFrom } from "../payoutHold.js";

const CONFIG = { thresholdVnd: 100_000, holdDays: 7 };

test("duoi nguong -> kha dung ngay (null)", () => {
  assert.equal(
    resolveAvailableFrom({
      userShareAmount: 99_999,
      completedAtVn: "2026-10-01",
      fallbackDayVn: "2026-10-05",
      config: CONFIG,
    }),
    null
  );
});

test("DUNG nguong -> BI giam (so sanh la >=, khong phai >)", () => {
  assert.equal(
    resolveAvailableFrom({
      userShareAmount: 100_000,
      completedAtVn: "2026-10-01",
      fallbackDayVn: "2026-10-05",
      config: CONFIG,
    }),
    "2026-10-08"
  );
});

test("tren nguong -> giam, dem tu completedAt chu KHONG phai fallback", () => {
  assert.equal(
    resolveAvailableFrom({
      userShareAmount: 500_000,
      completedAtVn: "2026-09-28",
      fallbackDayVn: "2026-10-05",
      config: CONFIG,
    }),
    "2026-10-05"
  );
});

test("khong biet ngay giao hang -> lui ve fallbackDayVn", () => {
  assert.equal(
    resolveAvailableFrom({
      userShareAmount: 500_000,
      completedAtVn: null,
      fallbackDayVn: "2026-10-05",
      config: CONFIG,
    }),
    "2026-10-12"
  );
});

// userShareAmount === 0 la gia tri THAT (chu bot giu toan bo hoa hong) - dung `||` o day la sai.
test("userShareAmount = 0 -> khong giam", () => {
  assert.equal(
    resolveAvailableFrom({
      userShareAmount: 0,
      completedAtVn: "2026-10-01",
      fallbackDayVn: "2026-10-05",
      config: CONFIG,
    }),
    null
  );
});

test("thresholdVnd = 0 -> TAT han tinh nang giam, moi don kha dung ngay", () => {
  assert.equal(
    resolveAvailableFrom({
      userShareAmount: 10_000_000,
      completedAtVn: "2026-10-01",
      fallbackDayVn: "2026-10-05",
      config: { thresholdVnd: 0, holdDays: 7 },
    }),
    null
  );
});

test("thresholdVnd am -> cung coi la tat (khong duoc giam het moi don)", () => {
  assert.equal(
    resolveAvailableFrom({
      userShareAmount: 500_000,
      completedAtVn: "2026-10-01",
      fallbackDayVn: "2026-10-05",
      config: { thresholdVnd: -1, holdDays: 7 },
    }),
    null
  );
});

test("holdDays = 0 -> mo khoa ngay trong ngay giao hang", () => {
  assert.equal(
    resolveAvailableFrom({
      userShareAmount: 500_000,
      completedAtVn: "2026-10-01",
      fallbackDayVn: "2026-10-05",
      config: { thresholdVnd: 100_000, holdDays: 0 },
    }),
    "2026-10-01"
  );
});
