import { test } from "node:test";
import assert from "node:assert/strict";
import { formatVnDateDdMm, yesterdayVnDdMm } from "../vietnamDate.js";

test("formatVnDateDdMm: dinh dang dd/mm theo gio VN, co padding 0", () => {
  // 2026-09-05T03:00:00Z = 10:00 ngay 05/09 gio VN
  assert.equal(formatVnDateDdMm(new Date("2026-09-05T03:00:00Z")), "05/09");
});

test("formatVnDateDdMm: cuoi ngay UTC da sang ngay moi o VN (+07)", () => {
  // 2026-09-05T17:30:00Z = 00:30 ngay 06/09 gio VN - neu tinh theo UTC se ra sai ngay (05/09)
  assert.equal(formatVnDateDdMm(new Date("2026-09-05T17:30:00Z")), "06/09");
});

test("yesterdayVnDdMm: tru 1 ngay theo gio VN (truong hop thuong - upload 9h30 sang)", () => {
  // 2026-09-11T02:30:00Z = 09:30 ngay 11/09 gio VN -> hom qua = 10/09
  assert.equal(yesterdayVnDdMm(new Date("2026-09-11T02:30:00Z")), "10/09");
});

test("yesterdayVnDdMm: moc nua dem gio VN, khong phai nua dem UTC", () => {
  // 23:30 ngay 11/09 gio VN -> hom qua van la 10/09
  assert.equal(yesterdayVnDdMm(new Date("2026-09-11T16:30:00Z")), "10/09");
  // 00:30 ngay 12/09 gio VN -> hom qua da la 11/09
  assert.equal(yesterdayVnDdMm(new Date("2026-09-11T17:30:00Z")), "11/09");
});

test("yesterdayVnDdMm: moc doi thang (01/03 -> 28/02, 2026 khong phai nam nhuan)", () => {
  assert.equal(yesterdayVnDdMm(new Date("2026-03-01T03:00:00Z")), "28/02");
});

test("yesterdayVnDdMm: moc doi nam (01/01 -> 31/12)", () => {
  assert.equal(yesterdayVnDdMm(new Date("2027-01-01T03:00:00Z")), "31/12");
});
