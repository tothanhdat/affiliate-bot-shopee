import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { renderSettingsPage } from "../adminHtml.js";

/**
 * Trang /admin/settings (2026-10-04) gop 23 gia tri cua SETTINGS_REGISTRY vao 4 tab (FAQ/hoa hong &
 * rut tien/mau tin nhan/thong bao nhom Zalo), dem "thay doi chua luu", va chen {{bien}} vao vi tri
 * con tro. Test nay boc <script> ra khoi trang da render roi chay tren DOM gia, giong cach lam voi
 * recordOrdersPageScript.test.ts/withdrawalsPageScript.test.ts.
 */

function extractScript(): string {
  const html = renderSettingsPage({});
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .find((s) => s.includes("settings-dirty-count"));
  assert.ok(script && script.trim() !== "", "trang phai co script cho tab/dem thay doi/chen bien");
  return script;
}

interface FakeField {
  id: string;
  name: string;
  value: string;
  defaultValue: string;
  selectionStart?: number;
  selectionEnd?: number;
  focus(): void;
  setSelectionRange(a: number, b: number): void;
}

function makeField(id: string, value: string): FakeField {
  return {
    id,
    name: id,
    value,
    defaultValue: value,
    focus() {},
    setSelectionRange() {},
  };
}

function makeTab(name: string) {
  let clickHandler: (() => void) | null = null;
  return {
    dataset: { settingsTab: name },
    className: "-mb-px flex items-center gap-2 border-b-2 py-3 text-xs transition border-transparent font-medium text-slate-400",
    setAttribute() {},
    addEventListener(evt: string, fn: () => void) {
      if (evt === "click") clickHandler = fn;
    },
    click() {
      clickHandler?.();
    },
  };
}

function makePanel(name: string) {
  return { dataset: { settingsPanel: name }, hidden: name !== "faq" };
}

function makeInsertButton(targetId: string, text: string) {
  let clickHandler: (() => void) | null = null;
  return {
    dataset: { insertTarget: targetId, insertText: text },
    addEventListener(evt: string, fn: () => void) {
      if (evt === "click") clickHandler = fn;
    },
    click() {
      clickHandler?.();
    },
  };
}

function runSettingsScript() {
  const fieldA = makeField("field-a", "giá trị gốc");
  const fieldB = makeField("field-b", "khác mẫu");
  const fields = [fieldA, fieldB];

  const inputListeners: Array<() => void> = [];
  const form = {
    addEventListener(evt: string, fn: () => void) {
      if (evt === "input") inputListeners.push(fn);
    },
    fireInput() {
      inputListeners.forEach((fn) => fn());
    },
    querySelectorAll(selector: string) {
      if (selector === "input[name], textarea[name]") return fields;
      return [];
    },
  };

  const tabFaq = makeTab("faq");
  const tabCommission = makeTab("commission");
  const tabNotifyGroups = makeTab("notify-groups");
  const tabs = [tabFaq, tabCommission, tabNotifyGroups];
  const panelFaq = makePanel("faq");
  const panelCommission = makePanel("commission");
  const panelNotifyGroups = { dataset: { settingsPanel: "notify-groups" }, hidden: true };
  const panels = [panelFaq, panelCommission, panelNotifyGroups];

  const insertBtn = makeInsertButton("field-a", "{{dashboardUrl}}");
  const insertButtons = [insertBtn];

  const dirtyCountEl = { textContent: "" };
  // style.display, KHONG phai .hidden - script dung setHidden() set thang style.display vi
  // ".hidden=true" tren phan tu co class "flex" khong an duoc gi tren trinh duyet that (xem
  // comment setHidden() trong adminHtml.ts). Gia lap dung co che nay de test khong "xanh gia".
  const dirtyBarEl = { style: { display: "" } };
  const topBarEl = { style: { display: "" } };
  const bottomBarEl = { style: { display: "" } };

  const byId = new Map<string, unknown>([
    ["settings-form", form],
    ["settings-dirty-count", dirtyCountEl],
    ["settings-dirty-bar", dirtyBarEl],
    ["settings-top-bar", topBarEl],
    ["settings-bottom-bar", bottomBarEl],
    ["field-a", fieldA],
    ["field-b", fieldB],
  ]);

  const document = {
    getElementById(id: string) {
      return byId.get(id) ?? null;
    },
    querySelectorAll(selector: string) {
      if (selector === "[data-settings-tab]") return tabs;
      if (selector === "[data-settings-panel]") return panels;
      if (selector === "[data-insert-target]") return insertButtons;
      return [];
    },
  };

  runInNewContext(extractScript(), { document, Array });

  return {
    fieldA,
    fieldB,
    form,
    tabFaq,
    tabCommission,
    tabNotifyGroups,
    panelFaq,
    panelCommission,
    panelNotifyGroups,
    insertBtn,
    dirtyCountEl,
    dirtyBarEl,
    topBarEl,
    bottomBarEl,
  };
}

test("chuyen tab: bam tab khac an panel dang mo, hien panel duoc chon", () => {
  const { tabCommission, panelFaq, panelCommission } = runSettingsScript();
  assert.equal(panelFaq.hidden, false);
  assert.equal(panelCommission.hidden, true);

  tabCommission.click();

  assert.equal(panelFaq.hidden, true);
  assert.equal(panelCommission.hidden, false);
});

test("ca 2 thanh 'Luu cau hinh' (dau) va 'Luu tat ca thay doi' (cuoi) chi thuoc 3 tab trong #settings-form, an di o tab notify-groups", () => {
  const { tabNotifyGroups, tabFaq, topBarEl, bottomBarEl } = runSettingsScript();
  assert.notEqual(topBarEl.style.display, "none", "mac dinh (tab faq) phai hien");
  assert.notEqual(bottomBarEl.style.display, "none", "mac dinh (tab faq) phai hien");

  tabNotifyGroups.click();
  assert.equal(topBarEl.style.display, "none", "tab notify-groups co nut Luu rieng, khong duoc hien nut nay");
  assert.equal(bottomBarEl.style.display, "none", "tab notify-groups co nut Luu rieng, khong duoc hien nut nay");

  tabFaq.click();
  assert.notEqual(topBarEl.style.display, "none", "quay lai tab trong form thi hien lai");
  assert.notEqual(bottomBarEl.style.display, "none", "quay lai tab trong form thi hien lai");
});

test("dem thay doi chua luu: 0 luc tai trang, tang khi sua field va go 'input'", () => {
  const { fieldA, form, dirtyCountEl, dirtyBarEl } = runSettingsScript();
  assert.equal(dirtyCountEl.textContent, "0");
  assert.equal(dirtyBarEl.style.display, "none");

  fieldA.value = "giá trị gốc đã sửa";
  form.fireInput();

  assert.equal(dirtyCountEl.textContent, "1");
  assert.notEqual(dirtyBarEl.style.display, "none");
});

test("topBar/bottomBar/dirtyBar an/hien bang style.display, KHONG dung thuoc tinh 'hidden' (bug that: '.hidden=true' tren phan tu co class 'flex' khong co tac dung gi tren trinh duyet that, vi trang khong nap preflight nen '[hidden]' cua UA thua '.flex{display:flex}' cua Tailwind)", () => {
  const script = extractScript();
  assert.match(script, /function setHidden/, "phai dung helper setHidden() set style.display");
  assert.doesNotMatch(script, /topBar\.hidden\s*=/, "KHONG duoc quay lai dung topBar.hidden =");
  assert.doesNotMatch(script, /bottomBar\.hidden\s*=/, "KHONG duoc quay lai dung bottomBar.hidden =");
  assert.doesNotMatch(script, /dirtyBar\.hidden\s*=/, "KHONG duoc quay lai dung dirtyBar.hidden =");
});

test("chen bien vao dung vi tri con tro, khong ghi de toan bo noi dung", () => {
  const { fieldA, insertBtn, dirtyCountEl } = runSettingsScript();
  fieldA.selectionStart = 6;
  fieldA.selectionEnd = 6;

  insertBtn.click();

  assert.equal(fieldA.value, "giá tr{{dashboardUrl}}ị gốc");
  assert.equal(dirtyCountEl.textContent, "1", "chen bien xong phai tinh lai so thay doi");
});
