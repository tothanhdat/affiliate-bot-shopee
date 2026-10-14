import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { TIPS_PAGE_SCRIPT } from "../tipsPageScript.js";

/**
 * Script slide cua /d/:token/tips chay tren DOM gia (khong co CSS/scroll that). Test chot LOGIC: slide nao
 * dang o giua, class/aria theo do, bam cham -> cuon toi slide do, phim mui ten. Do muot va do mo cua hieu ung
 * phai xem bang mat tren trinh duyet that.
 */

test("nearestSlideIndex: chon slide co tam gan tam khung nhin nhat", () => {
  const context: Record<string, unknown> = { document: { getElementById: () => null } };
  runInNewContext(TIPS_PAGE_SCRIPT, context);
  const { nearestSlideIndex } = context as { nearestSlideIndex(c: number[], v: number): number };
  assert.equal(nearestSlideIndex([100, 400, 700], 90), 0);
  assert.equal(nearestSlideIndex([100, 400, 700], 380), 1);
  assert.equal(nearestSlideIndex([100, 400, 700], 560), 2);
  assert.equal(nearestSlideIndex([100, 400, 700], 9999), 2);
  assert.equal(nearestSlideIndex([], 5), 0);
});

interface FakeSlide {
  offsetLeft: number;
  offsetWidth: number;
  classes: Set<string>;
  classList: { toggle(name: string, force: boolean): void };
  scrollCalls: unknown[];
  scrollIntoView(options: unknown): void;
  handlers: Record<string, (event: unknown) => void>;
  addEventListener(type: string, fn: (event: unknown) => void): void;
}

function makeSlide(left: number): FakeSlide {
  const classes = new Set<string>();
  const slide: FakeSlide = {
    offsetLeft: left,
    offsetWidth: 300,
    classes,
    classList: { toggle: (name, force) => void (force ? classes.add(name) : classes.delete(name)) },
    scrollCalls: [],
    scrollIntoView(options) {
      slide.scrollCalls.push(options);
    },
    handlers: {},
    addEventListener(type, fn) {
      slide.handlers[type] = fn;
    },
  };
  return slide;
}

function makeDot() {
  const attrs: Record<string, string> = {};
  const dot = {
    attrs,
    handlers: {} as Record<string, (event: unknown) => void>,
    setAttribute: (name: string, value: string) => void (attrs[name] = value),
    getAttribute: (name: string) => attrs[name] ?? null,
    addEventListener(type: string, fn: (event: unknown) => void) {
      dot.handlers[type] = fn;
    },
  };
  return dot;
}

function mount(options: { reduceMotion?: boolean; slideCount?: number } = {}) {
  const slideCount = options.slideCount ?? 3;
  const slides = Array.from({ length: slideCount }, (_, i) => makeSlide(i * 300));
  const dots = slides.map((_, i) => {
    const dot = makeDot();
    dot.attrs["data-index"] = String(i);
    return dot;
  });
  const counter = { textContent: "" };
  const trackHandlers: Record<string, (event: unknown) => void> = {};
  const track = {
    scrollLeft: 0,
    clientWidth: 300,
    querySelectorAll: () => slides,
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      trackHandlers[type] = fn;
    },
  };
  const buttonHandlers: Record<string, () => void> = {};
  const button = (id: string) => ({ addEventListener: (_t: string, fn: () => void) => void (buttonHandlers[id] = fn) });
  const document = {
    getElementById: (id: string) =>
      id === "tips-track" ? track : id === "tips-counter" ? counter : id === "tips-prev" || id === "tips-next" ? button(id) : null,
    querySelectorAll: (selector: string) => (selector === ".tips-dot" ? dots : []),
  };
  runInNewContext(TIPS_PAGE_SCRIPT, {
    document,
    window: { matchMedia: () => ({ matches: options.reduceMotion === true }) },
    requestAnimationFrame: (fn: () => void) => fn(),
  });
  return { slides, dots, counter, track, trackHandlers, buttonHandlers };
}

test("khoi tao: slide dau active, chu so '1 / N', cham dau tien aria-current", () => {
  const m = mount();
  assert.equal(m.slides[0].classes.has("is-active"), true);
  assert.equal(m.slides[1].classes.has("is-active"), false);
  assert.equal(m.counter.textContent, "1 / 3");
  assert.equal(m.dots[0].attrs["aria-current"], "true");
  assert.equal(m.dots[1].attrs["aria-current"], "false");
});

test("cuon toi slide 3: doi slide active, chu so, cham tron", () => {
  const m = mount();
  m.track.scrollLeft = 600; // tam khung = 600 + 150 = 750 ~ tam slide 3 (600 + 150)
  m.trackHandlers.scroll({});
  assert.equal(m.slides[2].classes.has("is-active"), true);
  assert.equal(m.slides[0].classes.has("is-active"), false);
  assert.equal(m.counter.textContent, "3 / 3");
  assert.equal(m.dots[2].attrs["aria-current"], "true");
  assert.equal(m.dots[0].attrs["aria-current"], "false");
});

test("bam cham so 2: cuon muot toi slide 2 (inline center)", () => {
  const m = mount();
  m.dots[1].handlers.click({});
  assert.equal(m.slides[1].scrollCalls.length, 1);
  // Object tao trong vm khac realm (prototype khac) nen deepStrictEqual se tu choi du gia tri y het: so qua JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(m.slides[1].scrollCalls[0])), { behavior: "smooth", inline: "center", block: "nearest" });
});

test("bam slide mo ben canh: cuon toi no; bam chinh slide dang active: khong lam gi", () => {
  const m = mount();
  let prevented = false;
  m.slides[1].handlers.click({ preventDefault: () => (prevented = true) });
  assert.equal(m.slides[1].scrollCalls.length, 1);
  assert.equal(prevented, true);

  m.slides[0].handlers.click({ preventDefault: () => assert.fail("slide dang active khong duoc chan click") });
  assert.equal(m.slides[0].scrollCalls.length, 0);
});

test("phim mui ten va nut truoc/sau di chuyen 1 slide, khong vuot bien", () => {
  const m = mount();
  let prevented = 0;
  const key = (name: string) => ({ key: name, preventDefault: () => prevented++ });

  m.trackHandlers.keydown(key("ArrowRight"));
  assert.equal(m.slides[1].scrollCalls.length, 1);
  assert.equal(prevented, 1);

  m.trackHandlers.keydown(key("ArrowLeft")); // dang o slide dau (chua co scroll event) -> khong co slide truoc
  assert.equal(m.slides[0].scrollCalls.length, 0);

  m.buttonHandlers["tips-next"]();
  assert.equal(m.slides[1].scrollCalls.length, 2);
  m.buttonHandlers["tips-prev"]();
  assert.equal(m.slides[0].scrollCalls.length, 0); // van la slide dau -> khong vuot bien
});

test("prefers-reduced-motion: cuon tuc thoi (behavior auto), khong 'smooth'", () => {
  const m = mount({ reduceMotion: true });
  m.dots[2].handlers.click({});
  assert.deepEqual(JSON.parse(JSON.stringify(m.slides[2].scrollCalls[0])), { behavior: "auto", inline: "center", block: "nearest" });
});

test("chi 1 slide: script khong gan gi (khong loi)", () => {
  assert.doesNotThrow(() => mount({ slideCount: 1 }));
});
