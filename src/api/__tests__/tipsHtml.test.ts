import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTipsPage } from "../tipsHtml.js";
import type { Tip } from "../../core/types.js";

function tip(id: number, overrides: Partial<Tip> = {}): Tip {
  return {
    id,
    title: `Tieu de ${id}`,
    description: `Mo ta ${id}`,
    imagePath: `anh-${id}.png`,
    sortOrder: id,
    isActive: true,
    createdAt: "2026-10-14T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
    ...overrides,
  };
}

const slideCount = (html: string) => (html.match(/<article class="tip-slide/g) ?? []).length;

test("moi slide co thu tu Tieu de -> Anh -> Mo ta", () => {
  const html = renderTipsPage({ token: "tok", tips: [tip(1), tip(2)] });
  const first = html.slice(html.indexOf('<article class="tip-slide'), html.indexOf("</article>"));
  const title = first.indexOf("Tieu de 1");
  const image = first.indexOf("<img");
  const description = first.indexOf("Mo ta 1");
  assert.ok(title !== -1 && image !== -1 && description !== -1);
  assert.ok(title < image && image < description, "phai la tieu de, roi anh, roi mo ta");
});

test("nhieu Tip: dung so slide, slide dau is-active, co cham tron + chu so + mui ten + track focus duoc", () => {
  const html = renderTipsPage({ token: "tok", tips: [tip(1), tip(2), tip(3)] });
  assert.equal(slideCount(html), 3);
  assert.match(html, /<article class="tip-slide is-active"[^>]*data-index="0"/);
  assert.equal((html.match(/class="tips-dot"/g) ?? []).length, 3);
  assert.match(html, /id="tips-counter"[^>]*>1 \/ 3</);
  assert.match(html, /id="tips-prev"/);
  assert.match(html, /id="tips-next"/);
  assert.match(html, /id="tips-track"[^>]*tabindex="0"/);
  assert.match(html, /aria-roledescription="carousel"/);
  assert.doesNotMatch(html, /class="tips-track tips-single"/);
});

test("chi 1 Tip: khong cham, khong chu so, khong mui ten; track mang class tips-single", () => {
  const html = renderTipsPage({ token: "tok", tips: [tip(1)] });
  assert.equal(slideCount(html), 1);
  assert.match(html, /class="tips-track tips-single"/);
  assert.doesNotMatch(html, /class="tips-dot"/);
  assert.doesNotMatch(html, /id="tips-counter"/);
  assert.doesNotMatch(html, /id="tips-prev"/);
});

test("Tip khong anh: khong co <img> va khong chua khung anh trong; Tip khong mo ta: khong co the mo ta", () => {
  const html = renderTipsPage({ token: "tok", tips: [tip(1, { imagePath: null, description: "" })] });
  assert.doesNotMatch(html, /<img /);
  assert.doesNotMatch(html, /class="tip-image"/);
  assert.doesNotMatch(html, /class="tip-desc"/);
  assert.match(html, /Tieu de 1/);
});

test("anh: URL /tips/images/ da encode, slide dau khong lazy, slide sau lazy, co onerror an khung anh", () => {
  const html = renderTipsPage({ token: "tok", tips: [tip(1, { imagePath: "a b.png" }), tip(2)] });
  assert.match(html, /src="\/tips\/images\/a%20b\.png"/);
  const [first, second] = html.split('<article class="tip-slide').slice(1);
  assert.doesNotMatch(first, /loading="lazy"/);
  assert.match(second, /loading="lazy"/);
  assert.match(html, /onerror="this\.parentNode\.style\.display='none'"/);
});

test("escape HTML o tieu de va mo ta (khong chen duoc the)", () => {
  const html = renderTipsPage({
    token: "tok",
    tips: [tip(1, { title: '<script>alert("x")</script>', description: "a & b <img src=x onerror=alert(1)>" })],
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /a &amp; b &lt;img/);
});

test("mo ta giu xuong dong bang white-space: pre-line (khong doi \\n thanh <br>)", () => {
  const html = renderTipsPage({ token: "tok", tips: [tip(1, { description: "dong 1\ndong 2" })] });
  assert.match(html, /white-space: pre-line/);
  assert.match(html, /dong 1\ndong 2/);
  assert.doesNotMatch(html, /<br/);
});

test("khong co Tip: cau thong bao + link quay lai, khong co slide va khong co script slide", () => {
  const html = renderTipsPage({ token: "tok", tips: [] });
  assert.match(html, /Chưa có mẹo nào, bạn quay lại sau nhé/);
  assert.match(html, /href="\/d\/tok"/);
  assert.equal(slideCount(html), 0);
  assert.doesNotMatch(html, /nearestSlideIndex/);
});

test("link quay lai dung /d/<token> (token duoc encode)", () => {
  const html = renderTipsPage({ token: "a/b c", tips: [tip(1)] });
  assert.match(html, /href="\/d\/a%2Fb%20c"/);
});

test("CSS chot: scroll-snap, slide mo, prefers-reduced-motion, mui ten chi cho may co chuot; transition khong dung 'all'", () => {
  const html = renderTipsPage({ token: "tok", tips: [tip(1), tip(2)] });
  assert.match(html, /scroll-snap-type: x mandatory/);
  assert.match(html, /scroll-snap-align: center/);
  assert.match(html, /scroll-snap-stop: always/);
  assert.match(html, /\.tip-slide\.is-active/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(html, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.doesNotMatch(html, /transition: all/);
});

test("co noscript de slide khong bi mo hoan toan khi tat JS", () => {
  const html = renderTipsPage({ token: "tok", tips: [tip(1), tip(2)] });
  assert.match(html, /<noscript>/);
});

test("lap vong: CSS KHONG dat scroll-behavior:smooth (script tu truyen behavior; neu co thi 'auto' khong con la tuc thoi va cu nhay ve bo giua se bi cuon muot lo ra)", () => {
  const html = renderTipsPage({ token: "tok", tips: [tip(1), tip(2)] });
  assert.doesNotMatch(html, /scroll-behavior/);
});

test("lap vong: co class no-anim de nhay ve bo giua khong bi chop sang/mo; track co the nam keo bang chuot", () => {
  const html = renderTipsPage({ token: "tok", tips: [tip(1), tip(2)] });
  assert.match(html, /\.tips-track\.no-anim \.tip-slide \{[^}]*transition: none/);
  assert.match(html, /\.tips-track\.is-grabbing \{[^}]*user-select: none/);
  assert.match(html, /@media \(hover: hover\) and \(pointer: fine\) \{[^}]*\.tips-track \{ cursor: grab/);
});

test("anh trong slide khong the bi trinh duyet 'keo ra' (draggable=false) - neu khong keo chuot tren anh se keo ma anh thay vi chuyen Tip", () => {
  const html = renderTipsPage({ token: "tok", tips: [tip(1), tip(2)] });
  const imgs = html.match(/<img [^>]*>/g) ?? [];
  assert.equal(imgs.length, 2);
  for (const img of imgs) assert.match(img, /draggable="false"/);
});

test("server van chi render slide THAT (script moi nhan ban): khong co ban sao san trong HTML", () => {
  const html = renderTipsPage({ token: "tok", tips: [tip(1), tip(2), tip(3)] });
  assert.equal(slideCount(html), 3);
  assert.doesNotMatch(html, /<article[^>]*data-clone/); // (chuoi "data-clone" co trong script nhung khong duoc co tren the article)
});

test("anh Tips hien DAY DU, khong bi cat: khung doc 2:3 + object-fit contain (anh Tips deu la 1024x1536, khung ngang 4:3 + cover tung cat mat phan tren/duoi)", () => {
  const html = renderTipsPage({ token: "tok", tips: [tip(1), tip(2)] });
  assert.match(html, /\.tip-image \{[^}]*aspect-ratio: 2 \/ 3/);
  assert.match(html, /\.tip-image img \{[^}]*object-fit: contain/);
  assert.doesNotMatch(html, /object-fit: cover/);
  assert.doesNotMatch(html, /aspect-ratio: 4 \/ 3/);
});

test("tieu de cua Tip can GIUA (text-align: center) va cat dong can bang de tieu de 2 dong khong le", () => {
  const html = renderTipsPage({ token: "tok", tips: [tip(1), tip(2)] });
  assert.match(html, /h2\.tip-title \{[^}]*text-align: center/);
  assert.match(html, /h2\.tip-title \{[^}]*text-wrap: balance/);
});
