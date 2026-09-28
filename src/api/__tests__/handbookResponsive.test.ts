import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHandbookPage } from "../handbookHtml.js";

/**
 * Cac bay "vo tren dien thoai" cua trang /so-tay. Phan lon nguoi doc So tay la user Zalo bam link
 * tu tin nhan tren dien thoai, nen day moi la man hinh CHINH chu khong phai desktop.
 *
 * Khong co trinh duyet that de do pixel, nen test o day chot cac QUY TAC CSS bat buoc phai con -
 * moi cai deu ung voi 1 loi da biet (iOS tu zoom khi focus input, muc luc 12 dong day het noi dung
 * xuong duoi, bang 2 cot bi bop, glow lam tran ngang).
 */

const html = renderHandbookPage({
  userSharePercent: 90,
  taxPercent: 10,
  platformFeePercent: 1,
  withdrawalThresholdVnd: 20_000,
});

/** CSS da bo comment - de comment dung truoc 1 selector khong lam hong viec do tim selector do. */
const css = html.replace(/\/\*[\s\S]*?\*\//g, "");

/** Lay noi dung ben trong moi khoi @media co max-width (cac quy tac danh cho man hinh hep). */
function mobileMediaBlocks(): string[] {
  const blocks: string[] = [];
  const re = /@media\s*\(max-width:[^)]*\)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    blocks.push(css.slice(start, i - 1));
  }
  return blocks;
}

/** Quy tac cho `selector` nam trong bat ky khoi @media max-width nao. */
function mobileRuleFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const block of mobileMediaBlocks()) {
    const rule = block.match(new RegExp(`(^|[{},])\\s*${escaped}\\s*\\{([^}]*)\\}`));
    if (rule) return rule[2];
  }
  return "";
}

test("responsive: co khai bao viewport", () => {
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1/);
});

test("responsive: khong chan user phong to trang", () => {
  // Khoa zoom la loi tiep can co ban - nguoi lon tuoi doc So tay tren dien thoai can phong to duoc.
  assert.ok(!/user-scalable\s*=\s*no/.test(html), "khong duoc khoa zoom");
  assert.ok(!/maximum-scale\s*=\s*1/.test(html), "khong duoc chan phong to");
});

test("responsive: o tim kiem it nhat 16px tren mobile de iOS khong tu zoom ca trang", () => {
  // Safari iOS tu phong to trang khi focus vao input co font-size < 16px, phong xong khong tu thu
  // lai - user bi ket o trang thai trang bi cat mep phai.
  const rule = mobileRuleFor("#handbook-search");
  const size = rule.match(/font-size:\s*([\d.]+)(px|rem)/);
  assert.ok(size, "phai co quy tac font-size cho #handbook-search trong @media max-width");
  const px = size![2] === "rem" ? Number(size![1]) * 16 : Number(size![1]);
  assert.ok(px >= 16, `font-size o tim kiem tren mobile la ${px}px, phai >= 16px`);
});

test("responsive: bo cuc doi ve 1 cot tren mobile", () => {
  assert.match(mobileRuleFor(".layout"), /grid-template-columns:\s*1fr/);
});

test("responsive: muc luc khong dinh (sticky) tren mobile", () => {
  // Sticky tren man hinh cao ~600px se an mat phan lon noi dung.
  assert.match(mobileRuleFor(".toc"), /position:\s*static/);
});

test("responsive: muc luc khong day noi dung xuong duoi man hinh dau tien", () => {
  // Muc luc co 12 link; xep doc tren dien thoai la ~400px truoc khi thay chu dau tien cua So tay.
  // Tren mobile phai gon lai thanh 1 hang cuon ngang (chi con cac muc chinh).
  const list = mobileRuleFor(".toc-list");
  assert.match(list, /display:\s*flex/, "muc luc phai nam ngang tren mobile");
  assert.match(list, /overflow-x:\s*auto/, "muc luc nam ngang thi phai cuon ngang duoc");
  assert.match(mobileRuleFor(".toc-sublist"), /display:\s*none/, "muc con phai an di tren mobile");
});

test("responsive: bang 'nhan - y nghia' xuong 1 cot tren man hinh hep", () => {
  assert.match(mobileRuleFor(".kv-row"), /grid-template-columns:\s*1fr/);
});

test("responsive: cac chang tinh tien khong bi bop tren man hinh hep", () => {
  assert.match(mobileRuleFor(".calc-step"), /flex-wrap:\s*wrap/);
});

test("responsive: chan tran ngang do cac khoi glow trang tri", () => {
  // .bg-glow rong 600-700px va co left/right am - khong chan thi dien thoai cuon ngang duoc.
  assert.match(html, /overflow-x:\s*hidden/);
});

test("responsive: the nam trong vung nhin, khong dat chieu rong co dinh qua man hinh hep nhat", () => {
  // Bo qua .bg-glow (trang tri, da bi overflow-x:hidden chan). Con lai khong duoc co width/min-width
  // co dinh vuot 320px - do la be ngang long nhat con pho bien (iPhone SE).
  const glowless = html.replace(/\.bg-glow-\d\s*\{[^}]*\}/g, "");
  for (const m of glowless.matchAll(/(?:^|[;{\s])(min-width|width):\s*(\d+)px/g)) {
    assert.ok(Number(m[2]) <= 320, `co ${m[1]}: ${m[2]}px - vuot be ngang 320px cua man hinh hep nhat`);
  }
});

test("responsive: loc tim kiem khong de lai o trong trong muc luc", () => {
  // Tren mobile muc luc la 1 hang flex co gap. Neu data-search dat tren the <a> thi khi loc, <a>
  // bi an nhung <li> bao ngoai van con - van sinh ra 1 khoang gap trong giua cac muc. Phai dat
  // tren chinh <li> de ca o (va sublist cua no) bien mat han.
  for (const m of html.matchAll(/<([a-z]+)[^>]*\sdata-search="/g)) {
    assert.notEqual(m[1], "a", "data-search phai nam tren <li> cua muc luc, khong phai tren <a>");
  }
  const tocItems = [...html.matchAll(/<li[^>]*\sdata-search="/g)];
  assert.ok(tocItems.length >= 3, "moi muc cua muc luc phai co data-search rieng de loc duoc");
});

test("responsive: cac o cua luoi phai co lai duoc, khong keo gian ca trang", () => {
  // Grid item mac dinh co min-width:auto = khong the hep hon noi dung cua no. Muc luc tren mobile
  // la 1 hang ngang khong xuong dong (~520px), nen o .toc keo track grid rong ra theo, main rong
  // theo luon, roi `margin: 0 auto` cua .page-content can giua khoi qua kho -> mep TRAI lot han ra
  // ngoai man hinh. Do that bang Chrome headless o 440px: nav.toc rong 546px trong viewport 485px.
  const rule = css.match(/\.layout\s*>\s*\*\s*\{([^}]*)\}/);
  assert.ok(rule, "phai co quy tac cho cac o truc tiep cua .layout");
  assert.match(rule![1], /min-width:\s*0/, "o cua luoi phai duoc phep co lai (min-width: 0)");
});
