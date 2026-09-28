import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { renderHandbookPage } from "../handbookHtml.js";

/**
 * Doan JS loc tim kiem cua /so-tay khong chay qua route nao nen test HTTP khong cham toi duoc.
 * Giong usersSearchScript.test.ts: boc <script> ra khoi trang da render roi chay tren 1 DOM gia.
 *
 * Khac 1 diem quan trong: cac phan tu gia o day duoc dung tu CHINH data-search ma trang that sinh
 * ra, khong phai chuoi tu bia - nho vay test bat duoc ca truong hop server sinh data-search sai
 * (vd quen bo dau) chu khong chi rieng logic so khop.
 */

const PAGE_DATA = {
  userSharePercent: 90,
  taxPercent: 10,
  platformFeePercent: 1,
  withdrawalThresholdVnd: 20_000,
};

interface FakeEl {
  tagName: string;
  dataset: { search: string };
  hidden: boolean;
  open: boolean;
}

/** Lay moi phan tu co data-search trong trang that, kem ten the (script phan biet DETAILS). */
function elementsFromRenderedPage(): FakeEl[] {
  const html = renderHandbookPage(PAGE_DATA);
  const matches = [...html.matchAll(/<([a-z]+)[^>]*\sdata-search="([^"]*)"/g)];
  assert.ok(matches.length > 0, "trang phai co phan tu mang data-search");
  return matches.map((m) => ({
    tagName: m[1].toUpperCase(),
    dataset: { search: m[2] },
    hidden: false,
    open: false,
  }));
}

function extractSearchScript(): string {
  const html = renderHandbookPage(PAGE_DATA);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script && script.trim() !== "", "trang /so-tay phai co script loc tim kiem");
  return script;
}

function runScript(elements: FakeEl[]) {
  const input = {
    value: "",
    listeners: [] as Array<() => void>,
    addEventListener(_event: string, fn: () => void) {
      this.listeners.push(fn);
    },
    type(value: string) {
      this.value = value;
      for (const fn of this.listeners) fn();
    },
  };
  const noMatch = { hidden: true };
  const document = {
    getElementById(id: string) {
      if (id === "handbook-search") return input;
      if (id === "handbook-no-match") return noMatch;
      return null;
    },
    querySelectorAll() {
      return elements;
    },
  };
  runInNewContext(extractSearchScript(), { document, String });
  return { input, noMatch };
}

/** Cac phan tu dang hien sau khi loc. */
function visible(elements: FakeEl[]): FakeEl[] {
  return elements.filter((el) => !el.hidden);
}

test("search /so-tay: chi giu lai cac muc khop tu khoa", () => {
  const elements = elementsFromRenderedPage();
  const { input } = runScript(elements);

  input.type("rút tiền");

  const shown = visible(elements);
  assert.ok(shown.length > 0, "phai con it nhat 1 muc khop 'rút tiền'");
  assert.ok(shown.length < elements.length, "phai an bot mot so muc, khong the hien tat ca");
  for (const el of shown) {
    assert.match(el.dataset.search, /rut tien/);
  }
});

test("search /so-tay: go khong dau van tim ra noi dung co dau", () => {
  const elements = elementsFromRenderedPage();
  const { input } = runScript(elements);

  input.type("rut tien");
  const withoutDiacritics = visible(elements).map((el) => el.dataset.search);

  input.type("rút tiền");
  const withDiacritics = visible(elements).map((el) => el.dataset.search);

  assert.ok(withoutDiacritics.length > 0, "go khong dau phai ra ket qua");
  assert.ok(withoutDiacritics.length < elements.length, "phai that su co loc, khong phai hien tat ca");
  assert.deepEqual(withoutDiacritics, withDiacritics, "go co dau hay khong dau phai ra cung mot tap");
});

test("search /so-tay: tim duoc lenh xemhh", () => {
  const elements = elementsFromRenderedPage();
  const { input } = runScript(elements);

  input.type("xemhh");

  const shown = visible(elements);
  assert.ok(shown.length > 0, "'xemhh' phai tim ra duoc - day la lenh user hay hoi nhat");
  assert.ok(shown.length < elements.length, "phai that su co loc, khong phai hien tat ca");
  for (const el of shown) {
    assert.match(el.dataset.search, /xemhh/);
  }
});

test("search /so-tay: muc con khop thi section chua no khong bao gio bi an", () => {
  const elements = elementsFromRenderedPage();
  const { input } = runScript(elements);

  input.type("trạng thái đơn hàng");

  // data-search cua section bao trum data-search cua moi muc con, nen khong the co canh muc con
  // hien ma section cha bi an (se thanh noi dung lo lung khong co tieu de).
  const shown = visible(elements);
  assert.ok(shown.length < elements.length, "phai that su co loc, khong phai hien tat ca");
  const shownDetails = shown.filter((el) => el.tagName === "DETAILS");
  const shownSections = shown.filter((el) => el.tagName === "SECTION");
  assert.ok(shownDetails.length > 0, "phai con muc con khop");
  assert.ok(shownSections.length > 0, "section cha phai con hien");
  const hiddenSections = elements.filter((el) => el.tagName === "SECTION" && el.hidden);
  for (const child of shownDetails) {
    for (const section of hiddenSections) {
      assert.ok(
        !section.dataset.search.includes(child.dataset.search),
        "1 section bi an trong khi muc con cua no van hien - noi dung se lo lung khong co tieu de"
      );
    }
  }
});

test("search /so-tay: muc khop duoc mo san, khong bat user bam them", () => {
  const elements = elementsFromRenderedPage();
  const { input } = runScript(elements);

  input.type("xemhh");

  for (const el of visible(elements)) {
    if (el.tagName === "DETAILS") assert.equal(el.open, true);
  }
});

test("search /so-tay: xoa tu khoa thi hien lai tat ca va dong cac muc lai", () => {
  const elements = elementsFromRenderedPage();
  const { input } = runScript(elements);

  input.type("rút tiền");
  assert.ok(visible(elements).length < elements.length, "buoc chuan bi: phai dang o trang thai da loc");

  input.type("   ");

  assert.equal(visible(elements).length, elements.length);
  assert.ok(
    elements.every((el) => el.open === false),
    "xoa tu khoa thi tra trang ve trang thai ban dau, khong de mo toe loe"
  );
});

test("search /so-tay: khong khop gi thi hien dong bao khong tim thay", () => {
  const elements = elementsFromRenderedPage();
  const { input, noMatch } = runScript(elements);

  input.type("khong-co-noi-dung-nao-nhu-vay");

  assert.equal(visible(elements).length, 0);
  assert.equal(noMatch.hidden, false);
});

test("search /so-tay: xoa tu khoa thi dong bao 'khong tim thay' bien mat", () => {
  const elements = elementsFromRenderedPage();
  const { input, noMatch } = runScript(elements);

  input.type("khong-co-noi-dung-nao-nhu-vay");
  assert.equal(noMatch.hidden, false, "buoc chuan bi: dong bao phai dang hien");

  input.type("");

  assert.equal(noMatch.hidden, true);
  assert.equal(visible(elements).length, elements.length);
});
