import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveConfirmPlan } from "../payoutHold.js";

/** Don to giam 7 ngay (hien thi "Dang tam giu"), don nho cho them 1 ngay o "Cho xac nhan". */
const CONFIG = { thresholdVnd: 100_000, holdDays: 7, smallHoldDays: 1 };
/** Hom nay trong moi test duoi day - de co dinh vi ham nay nhan todayVn qua tham so. */
const TODAY = "2026-10-11";

function plan(params: {
  userShareAmount: number;
  completedAtVn?: string | null;
  plannedAvailableFrom?: string | null;
  config?: { thresholdVnd: number; holdDays: number; smallHoldDays?: number };
}) {
  return resolveConfirmPlan({
    userShareAmount: params.userShareAmount,
    completedAtVn: params.completedAtVn === undefined ? TODAY : params.completedAtVn,
    fallbackDayVn: TODAY,
    todayVn: TODAY,
    plannedAvailableFrom: params.plannedAvailableFrom ?? null,
    config: params.config ?? CONFIG,
  });
}

test("DUNG nguong -> confirmed + bi giam (so sanh la >=, khong phai >)", () => {
  assert.deepEqual(plan({ userShareAmount: 100_000 }), {
    status: "confirmed",
    availableFrom: "2026-10-18",
  });
});

test("tren nguong -> dem tu completedAt chu KHONG phai fallbackDayVn", () => {
  assert.deepEqual(plan({ userShareAmount: 500_000, completedAtVn: "2026-09-28" }), {
    status: "confirmed",
    availableFrom: "2026-10-05",
  });
});

test("don to khong biet ngay giao hang -> lui ve fallbackDayVn", () => {
  assert.deepEqual(plan({ userShareAmount: 500_000, completedAtVn: null }), {
    status: "confirmed",
    availableFrom: "2026-10-18",
  });
});

// Day la trong tam cua thay doi 2026-10-11: don nho KHONG duoc hien "Dang tam giu" cho user, no nam
// im o "Cho xac nhan" them smallHoldDays ngay roi moi vao Kha dung (xem doc comment dau payoutHold.ts).
test("duoi nguong -> PENDING + ngay vao Kha dung = completedAt + smallHoldDays", () => {
  assert.deepEqual(plan({ userShareAmount: 99_999 }), {
    status: "pending",
    availableFrom: "2026-10-12",
  });
});

test("duoi nguong, smallHoldDays = 0 -> confirmed ngay (hanh vi truoc 2026-10-11)", () => {
  assert.deepEqual(
    plan({ userShareAmount: 99_999, config: { thresholdVnd: 100_000, holdDays: 7, smallHoldDays: 0 } }),
    { status: "confirmed", availableFrom: null }
  );
});

// Mac dinh phai la "khong cho" de 1 call site moi quen truyen smallHoldDays khong am tham lam don
// cua user nam lai o "Cho xac nhan" (mat tien trong Kha dung la hau qua nang hon mat tinh nang).
test("duoi nguong, thieu han smallHoldDays -> confirmed ngay", () => {
  assert.deepEqual(plan({ userShareAmount: 99_999, config: { thresholdVnd: 100_000, holdDays: 7 } }), {
    status: "confirmed",
    availableFrom: null,
  });
});

// userShareAmount === 0 la gia tri THAT (chu bot giu toan bo hoa hong) - khong co dong nao de cho.
test("userShareAmount = 0 -> confirmed ngay, khong cho", () => {
  assert.deepEqual(plan({ userShareAmount: 0 }), { status: "confirmed", availableFrom: null });
});

test("thresholdVnd = 0 -> TAT han: don to confirmed ngay", () => {
  assert.deepEqual(
    plan({ userShareAmount: 10_000_000, config: { thresholdVnd: 0, holdDays: 7, smallHoldDays: 1 } }),
    { status: "confirmed", availableFrom: null }
  );
});

// Cong tac TONG: dat nguong 0 phai tat CA nhanh don nho, neu khong admin tat tinh nang ma don nho
// van bi giu lai 1 ngay.
test("thresholdVnd = 0 -> TAT han: don nho cung confirmed ngay", () => {
  assert.deepEqual(
    plan({ userShareAmount: 50_000, config: { thresholdVnd: 0, holdDays: 7, smallHoldDays: 1 } }),
    { status: "confirmed", availableFrom: null }
  );
});

test("thresholdVnd am -> cung coi la tat (khong duoc giam het moi don)", () => {
  assert.deepEqual(
    plan({ userShareAmount: 500_000, config: { thresholdVnd: -1, holdDays: 7, smallHoldDays: 1 } }),
    { status: "confirmed", availableFrom: null }
  );
});

test("holdDays = 0 -> don to mo khoa ngay trong ngay giao hang", () => {
  assert.deepEqual(
    plan({
      userShareAmount: 500_000,
      completedAtVn: "2026-10-01",
      config: { thresholdVnd: 100_000, holdDays: 0, smallHoldDays: 1 },
    }),
    { status: "confirmed", availableFrom: "2026-10-01" }
  );
});

// Bao cao Shopee liet ke lai ca lich su, nen don giao tu lau moi import hom nay khong duoc cho them:
// cua so rui ro tra hang da troi qua trong thuc te roi.
test("don nho giao tu lau (import tre) -> confirmed ngay, khong cho them", () => {
  assert.deepEqual(plan({ userShareAmount: 50_000, completedAtVn: "2026-09-01" }), {
    status: "confirmed",
    availableFrom: "2026-09-02",
  });
});

// Day la rang buoc user yeu cau truc tiep: doi setting KHONG duoc dich ngay cua don da chot.
test("ke hoach da chot, chua toi han -> van pending, KHONG tinh lai theo setting moi", () => {
  assert.deepEqual(
    plan({
      userShareAmount: 50_000,
      completedAtVn: "2026-10-10",
      plannedAvailableFrom: "2026-10-12",
      config: { thresholdVnd: 100_000, holdDays: 7, smallHoldDays: 30 },
    }),
    { status: "pending", availableFrom: "2026-10-12" }
  );
});

test("ke hoach da chot, dung bang hom nay -> confirmed (ca 2 dau khoang tinh vao)", () => {
  assert.deepEqual(plan({ userShareAmount: 50_000, plannedAvailableFrom: TODAY }), {
    status: "confirmed",
    availableFrom: TODAY,
  });
});

test("ke hoach da chot, qua han (admin import tre) -> confirmed, giu nguyen ngay da chot", () => {
  assert.deepEqual(plan({ userShareAmount: 50_000, plannedAvailableFrom: "2026-10-05" }), {
    status: "confirmed",
    availableFrom: "2026-10-05",
  });
});
