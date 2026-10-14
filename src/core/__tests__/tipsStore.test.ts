import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore, TIP_DESCRIPTION_MAX_LENGTH, TIP_TITLE_MAX_LENGTH } from "../ledgerStore.js";
import { AppError, InvalidTipError } from "../errors.js";

function newStore(): LedgerStore {
  return new LedgerStore(":memory:");
}

function titles(store: LedgerStore, onlyActive = false): string[] {
  return store.listTips({ onlyActive }).map((tip) => tip.title);
}

test("createTip: tip moi xep CUOI, sort_order tang dan, mac dinh dang bat", () => {
  const store = newStore();
  const a = store.createTip({ title: "A", description: "", imagePath: null });
  const b = store.createTip({ title: "B", description: "mo ta", imagePath: "b.png" });
  assert.equal(a.sortOrder, 1);
  assert.equal(b.sortOrder, 2);
  assert.equal(b.imagePath, "b.png");
  assert.equal(a.imagePath, null);
  assert.equal(a.isActive, true);
  assert.deepEqual(titles(store), ["A", "B"]);
});

test("createTip: cat khoang trang 2 dau, doi CRLF thanh LF trong mo ta", () => {
  const store = newStore();
  const tip = store.createTip({ title: "  Tieu de  ", description: "dong 1\r\ndong 2\r\n", imagePath: null });
  assert.equal(tip.title, "Tieu de");
  assert.equal(tip.description, "dong 1\ndong 2");
});

test("createTip: tieu de rong / qua dai / mo ta qua dai -> InvalidTipError (AppError) va khong ghi gi", () => {
  const store = newStore();
  assert.throws(() => store.createTip({ title: "   ", description: "", imagePath: null }), InvalidTipError);
  assert.throws(
    () => store.createTip({ title: "x".repeat(TIP_TITLE_MAX_LENGTH + 1), description: "", imagePath: null }),
    InvalidTipError
  );
  assert.throws(
    () => store.createTip({ title: "ok", description: "y".repeat(TIP_DESCRIPTION_MAX_LENGTH + 1), imagePath: null }),
    InvalidTipError
  );
  try {
    store.createTip({ title: "", description: "", imagePath: null });
    assert.fail("phai nem loi");
  } catch (err) {
    assert.ok(err instanceof AppError);
    assert.equal((err as AppError).code, "INVALID_TIP");
  }
  assert.equal(store.listTips().length, 0);
});

test("createTip: dung dung do dai toi da thi duoc chap nhan", () => {
  const store = newStore();
  store.createTip({
    title: "x".repeat(TIP_TITLE_MAX_LENGTH),
    description: "y".repeat(TIP_DESCRIPTION_MAX_LENGTH),
    imagePath: null,
  });
  assert.equal(store.listTips().length, 1);
});

test("listTips({onlyActive}) + countActiveTips + setTipActive", () => {
  const store = newStore();
  const a = store.createTip({ title: "A", description: "", imagePath: null });
  store.createTip({ title: "B", description: "", imagePath: null });
  assert.equal(store.countActiveTips(), 2);

  assert.equal(store.setTipActive(a.id, false), true);
  assert.deepEqual(titles(store, true), ["B"]);
  assert.deepEqual(titles(store), ["A", "B"]); // admin van thay tip da tat
  assert.equal(store.countActiveTips(), 1);

  assert.equal(store.setTipActive(a.id, true), true);
  assert.equal(store.countActiveTips(), 2);
  assert.equal(store.setTipActive(9999, true), false);
});

test("updateTip: undefined giu anh cu, null bo anh, chuoi doi anh; tra ve anh cu de xoa file", () => {
  const store = newStore();
  const tip = store.createTip({ title: "A", description: "d", imagePath: "old.png" });

  const kept = store.updateTip(tip.id, { title: "A2", description: "d2" });
  assert.ok(kept);
  assert.equal(kept.tip.title, "A2");
  assert.equal(kept.tip.imagePath, "old.png");
  assert.equal(kept.previousImagePath, "old.png");

  const replaced = store.updateTip(tip.id, { title: "A2", description: "d2", imagePath: "new.webp" });
  assert.ok(replaced);
  assert.equal(replaced.tip.imagePath, "new.webp");
  assert.equal(replaced.previousImagePath, "old.png");

  const removed = store.updateTip(tip.id, { title: "A2", description: "d2", imagePath: null });
  assert.ok(removed);
  assert.equal(removed.tip.imagePath, null);
  assert.equal(removed.previousImagePath, "new.webp");
});

test("updateTip: khong co tip -> null; du lieu sai -> InvalidTipError va giu nguyen ban ghi", () => {
  const store = newStore();
  assert.equal(store.updateTip(404, { title: "x", description: "" }), null);
  const tip = store.createTip({ title: "A", description: "d", imagePath: null });
  assert.throws(() => store.updateTip(tip.id, { title: " ", description: "d" }), InvalidTipError);
  assert.equal(store.getTipById(tip.id)?.title, "A");
});

test("deleteTip: tra ve anh de caller xoa file; khong co tip -> null", () => {
  const store = newStore();
  const tip = store.createTip({ title: "A", description: "", imagePath: "a.jpg" });
  assert.deepEqual(store.deleteTip(tip.id), { imagePath: "a.jpg" });
  assert.equal(store.getTipById(tip.id), null);
  assert.equal(store.deleteTip(tip.id), null);
});

test("tip moi sau khi xoa tip cuoi van xep CUOI (khong trung sort_order)", () => {
  const store = newStore();
  store.createTip({ title: "A", description: "", imagePath: null });
  const b = store.createTip({ title: "B", description: "", imagePath: null });
  store.deleteTip(b.id);
  const c = store.createTip({ title: "C", description: "", imagePath: null });
  assert.deepEqual(titles(store), ["A", "C"]);
  assert.ok(c.sortOrder > 1);
});

test("reorderTips: hoan vi dung -> doi thu tu (ke ca tip da tat)", () => {
  const store = newStore();
  const a = store.createTip({ title: "A", description: "", imagePath: null });
  const b = store.createTip({ title: "B", description: "", imagePath: null });
  const c = store.createTip({ title: "C", description: "", imagePath: null });
  store.setTipActive(b.id, false);
  store.reorderTips([c.id, a.id, b.id]);
  assert.deepEqual(titles(store), ["C", "A", "B"]);
  assert.deepEqual(titles(store, true), ["C", "A"]);
});

test("reorderTips: thieu / thua / trung / khong phai so nguyen -> tu choi va KHONG ghi gi", () => {
  const store = newStore();
  const a = store.createTip({ title: "A", description: "", imagePath: null });
  const b = store.createTip({ title: "B", description: "", imagePath: null });
  const before = store.listTips().map((tip) => tip.id);

  assert.throws(() => store.reorderTips([b.id]), InvalidTipError); // thieu
  assert.throws(() => store.reorderTips([b.id, a.id, 9999]), InvalidTipError); // thua
  assert.throws(() => store.reorderTips([a.id, a.id]), InvalidTipError); // trung
  assert.throws(() => store.reorderTips([a.id, 1.5]), InvalidTipError); // khong phai so nguyen
  assert.throws(() => store.reorderTips(["1", "2"] as unknown as number[]), InvalidTipError); // sai kieu
  assert.deepEqual(store.listTips().map((tip) => tip.id), before);
});

test("reorderTips: bang rong + danh sach rong la hop le", () => {
  const store = newStore();
  store.reorderTips([]);
  assert.equal(store.listTips().length, 0);
});
