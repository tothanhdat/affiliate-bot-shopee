import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { renderRecordOrdersPage } from "../adminHtml.js";

/**
 * Vung keo-tha CSV cua /admin/record-orders dung 1 <input type="file"> THAT phu kin ca vung (xem
 * chu thich trong renderRecordOrdersPage) - trinh duyet tu lo het phan nhan file keo-tha/bam chon,
 * JS cua trang chi lo PHAN HIEN THI: doi vien/nen khi dang keo qua, va doi nhan sau khi chon xong.
 * Test nay boc <script> ra khoi trang da render roi chay tren DOM gia, giong cach lam voi
 * withdrawalsPageScript.test.ts.
 */

function extractScript(): string {
  const html = renderRecordOrdersPage([]);
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .find((s) => s.includes("shopee-dropzone"));
  assert.ok(script && script.trim() !== "", "trang phai co script cho vung keo-tha CSV");
  return script;
}

interface FakeClassList {
  classes: Set<string>;
  toggle(name: string, on: boolean): void;
}

function makeClassList(): FakeClassList {
  const classes = new Set<string>();
  return {
    classes,
    toggle(name, on) {
      if (on) classes.add(name);
      else classes.delete(name);
    },
  };
}

function runDropzoneScript() {
  const zoneListeners: Record<string, Array<(e: { preventDefault: () => void }) => void>> = {};
  const zone = {
    classList: makeClassList(),
    addEventListener(event: string, fn: (e: { preventDefault: () => void }) => void) {
      (zoneListeners[event] ??= []).push(fn);
    },
    fire(event: string) {
      let prevented = false;
      for (const fn of zoneListeners[event] ?? []) fn({ preventDefault: () => (prevented = true) });
      return prevented;
    },
  };

  const inputListeners: Array<() => void> = [];
  const input = {
    files: [] as Array<{ name: string }>,
    addEventListener(_event: string, fn: () => void) {
      inputListeners.push(fn);
    },
    pickFile(name: string) {
      this.files = [{ name }];
      for (const fn of inputListeners) fn();
    },
    clearFile() {
      this.files = [];
      for (const fn of inputListeners) fn();
    },
  };

  const defaultHtml = 'Kéo thả file CSV vào đây hoặc <span class="text-indigo-600 underline">chọn từ máy tính</span>';
  const label = { textContent: "", innerHTML: defaultHtml };

  const document = {
    getElementById(id: string) {
      return id === "shopee-dropzone" ? zone : null;
    },
    querySelector(sel: string) {
      if (sel === "[data-dropzone-input]") return input;
      if (sel === "[data-dropzone-label]") return label;
      return null;
    },
  };

  runInNewContext(extractScript(), { document, Array });
  return { zone, input, label, defaultHtml };
}

test("keo file qua vung drop: them class highlight va chan hanh vi mac dinh cua trinh duyet", () => {
  const { zone } = runDropzoneScript();

  const prevented = zone.fire("dragover");
  assert.equal(prevented, true, "phai preventDefault() de trinh duyet khong tu mo file");
  assert.equal(zone.classList.classes.has("border-indigo-500"), true);
  assert.equal(zone.classList.classes.has("bg-indigo-50/20"), true);
});

test("keo file ra khoi vung (dragleave) hoac tha xong (drop): bo class highlight", () => {
  const { zone } = runDropzoneScript();

  zone.fire("dragover");
  assert.equal(zone.classList.classes.has("border-indigo-500"), true);

  zone.fire("dragleave");
  assert.equal(zone.classList.classes.has("border-indigo-500"), false);
  assert.equal(zone.classList.classes.has("bg-indigo-50/20"), false);
});

test("chon xong file: nhan doi thanh ten file", () => {
  const { input, label } = runDropzoneScript();

  input.pickFile("AffiliateCommissionReport_20261004.csv");
  assert.equal(label.textContent, "AffiliateCommissionReport_20261004.csv");
});

test("bo chon file (vd nguoi dung huy hop thoai): nhan tra ve ca cum HTML goc (giu lai link gach chan)", () => {
  const { input, label, defaultHtml } = runDropzoneScript();

  input.pickFile("report.csv");
  input.clearFile();
  assert.equal(label.innerHTML, defaultHtml, "phai tra ve DUNG HTML goc, khong phai chuoi text tho");
});

/**
 * Don NHO vua "Hoan thanh" nhung con cho vai ngay o "Cho xac nhan" (2026-10-11, xem payoutHold.ts):
 * khong hien so nay thi admin import xong thay "Ghi moi Kha dung: 0" va tuong import that bai, trong
 * khi don da vao he thong binh thuong va dang doi den ngay vao Kha dung.
 */
test("ket qua import hien so don nho dang cho vao Kha dung", () => {
  const html = renderRecordOrdersPage([], undefined, {
    ordersScanned: 2,
    confirmedNew: 0,
    confirmedDuplicate: 0,
    pendingNew: 0,
    pendingUpdated: 0,
    reversedCount: 0,
    mergedMultiItem: 0,
    skippedNoSubId: 0,
    skippedSubIdNotFound: 0,
    skippedUnknownStatus: 0,
    errors: [],
    confirmedByUser: [],
    newOrderIds: [],
    statusTransitions: [],
    heldCount: 0,
    smallHoldDeferred: 3,
    debtCreatedCount: 0,
    debtsByUser: [],
    cancelledWithdrawals: [],
  });

  assert.match(html, /Đơn nhỏ đang chờ vào "Khả dụng"/);
  assert.match(html, />3</);
});
