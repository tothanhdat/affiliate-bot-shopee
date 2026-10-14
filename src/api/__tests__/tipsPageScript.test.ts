import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { TIPS_PAGE_SCRIPT } from "../tipsPageScript.js";

/**
 * Script slide cua /d/:token/tips chay tren DOM gia (khong co CSS/scroll that). Test chot LOGIC: nhan ban 3 bo slide de
 * lap vong, nhay tuc thoi ve bo giua sau khi dung, chuyen Tip bang nut/phim/cham/keo chuot, ton trong reduced-motion.
 * Do muot, quan tinh vuot va hieu ung sang/mo phai xem bang mat tren trinh duyet that.
 */

// ---- ham thuan ----

function pure() {
  const context: Record<string, unknown> = { document: { getElementById: () => null } };
  runInNewContext(TIPS_PAGE_SCRIPT, context);
  return context as {
    nearestSlideIndex(c: number[], v: number): number;
    mod(a: number, m: number): number;
    shortestDelta(from: number, to: number, count: number): number;
    swipeTarget(startIndex: number, dx: number, threshold: number): number;
  };
}

test("nearestSlideIndex: chon slide co tam gan tam khung nhin nhat", () => {
  const { nearestSlideIndex } = pure();
  assert.equal(nearestSlideIndex([100, 400, 700], 90), 0);
  assert.equal(nearestSlideIndex([100, 400, 700], 380), 1);
  assert.equal(nearestSlideIndex([100, 400, 700], 560), 2);
  assert.equal(nearestSlideIndex([100, 400, 700], 9999), 2);
  assert.equal(nearestSlideIndex([], 5), 0);
});

test("mod: luon khong am", () => {
  const { mod } = pure();
  assert.equal(mod(-1, 4), 3);
  assert.equal(mod(5, 4), 1);
  assert.equal(mod(0, 4), 0);
});

test("shortestDelta: duong ngan nhat theo vong tron (Tip cuoi -> Tip dau la +1, Tip dau -> Tip cuoi la -1)", () => {
  const { shortestDelta } = pure();
  assert.equal(shortestDelta(3, 0, 4), 1);
  assert.equal(shortestDelta(0, 3, 4), -1);
  assert.equal(shortestDelta(1, 2, 4), 1);
  assert.equal(shortestDelta(2, 1, 4), -1);
  assert.equal(shortestDelta(2, 2, 4), 0);
  assert.equal(shortestDelta(0, 1, 2), -1); // 2 Tip: huong nao cung chi 1 buoc
});

test("swipeTarget: keo sang trai qua nguong -> Tip ke, sang phai -> Tip truoc, chua toi nguong -> o lai", () => {
  const { swipeTarget } = pure();
  assert.equal(swipeTarget(5, -80, 50), 6);
  assert.equal(swipeTarget(5, 80, 50), 4);
  assert.equal(swipeTarget(5, -50, 50), 6);
  assert.equal(swipeTarget(5, -49, 50), 5);
  assert.equal(swipeTarget(5, 20, 50), 5);
});

// ---- DOM gia ----

interface FakeTrack {
  children: FakeSlide[];
}

class FakeSlide {
  classes = new Set<string>();
  attrs: Record<string, string> = {};
  handlers: Record<string, (event: unknown) => void> = {};
  parent: FakeTrack | null = null;
  constructor(public key: string) {}
  get offsetLeft(): number {
    return (this.parent ? this.parent.children.indexOf(this) : 0) * 300;
  }
  offsetWidth = 300;
  classList = {
    toggle: (name: string, force: boolean) => void (force ? this.classes.add(name) : this.classes.delete(name)),
    add: (name: string) => void this.classes.add(name),
    remove: (name: string) => void this.classes.delete(name),
  };
  setAttribute(name: string, value: string) {
    this.attrs[name] = value;
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  addEventListener(type: string, fn: (event: unknown) => void) {
    this.handlers[type] = fn;
  }
  cloneNode(): FakeSlide {
    const copy = new FakeSlide(this.key);
    copy.classes = new Set(this.classes); // cloneNode that copy ca class (vd is-active cua slide dau)
    return copy;
  }
}

function makeDot(index: number) {
  const attrs: Record<string, string> = { "data-index": String(index) };
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

interface ScrollCall {
  left: number;
  behavior: string;
}

function mount(options: { reduceMotion?: boolean; count?: number } = {}) {
  const count = options.count ?? 4;
  const originals = Array.from({ length: count }, (_, i) => {
    const slide = new FakeSlide(`tip-${i}`);
    if (i === 0) slide.classes.add("is-active");
    return slide;
  });
  const track = {
    children: [...originals],
    scrollLeft: 0,
    clientWidth: 300,
    style: { scrollSnapType: "" },
    classes: new Set<string>(),
    classList: {
      add: (name: string) => void track.classes.add(name),
      remove: (name: string) => void track.classes.delete(name),
    },
    handlers: {} as Record<string, (event: unknown) => void>,
    scrollCalls: [] as ScrollCall[],
    captured: [] as number[],
    querySelectorAll: () => [...track.children],
    insertBefore(node: FakeSlide, ref: FakeSlide | null) {
      const at = ref === null ? track.children.length : track.children.indexOf(ref);
      track.children.splice(at, 0, node);
      node.parent = track;
      return node;
    },
    appendChild(node: FakeSlide) {
      return track.insertBefore(node, null);
    },
    addEventListener(type: string, fn: (event: unknown) => void) {
      track.handlers[type] = fn;
    },
    scrollTo(opts: ScrollCall) {
      // Sao chep sang object cua host: object tao trong vm khac realm (prototype khac) nen deepStrictEqual se tu choi du y het gia tri.
      track.scrollCalls.push({ left: opts.left, behavior: opts.behavior });
      if (opts.behavior === "auto") track.scrollLeft = opts.left; // "auto" = tuc thoi (khong con CSS scroll-behavior)
    },
    setPointerCapture(id: number) {
      track.captured.push(id);
    },
  };
  originals.forEach((slide) => (slide.parent = track));

  const dots = originals.map((_, i) => makeDot(i));
  const counter = { textContent: "" };
  const buttonHandlers: Record<string, () => void> = {};
  const button = (id: string) => ({ addEventListener: (_t: string, fn: () => void) => void (buttonHandlers[id] = fn) });
  const timers: Array<{ id: number; fn: () => void }> = [];
  let timerId = 0;
  const windowHandlers: Record<string, () => void> = {};
  const document = {
    getElementById: (id: string) =>
      id === "tips-track" ? track : id === "tips-counter" ? counter : id === "tips-prev" || id === "tips-next" ? button(id) : null,
    querySelectorAll: (selector: string) => (selector === ".tips-dot" ? dots : []),
  };
  runInNewContext(TIPS_PAGE_SCRIPT, {
    document,
    window: {
      matchMedia: () => ({ matches: options.reduceMotion === true }),
      addEventListener: (type: string, fn: () => void) => void (windowHandlers[type] = fn),
    },
    requestAnimationFrame: (fn: () => void) => fn(),
    setTimeout: (fn: () => void) => {
      timers.push({ id: ++timerId, fn });
      return timerId;
    },
    clearTimeout: (id: number) => {
      const at = timers.findIndex((t) => t.id === id);
      if (at !== -1) timers.splice(at, 1);
    },
  });

  /** Chay cac timer dang cho (debounce "da dung cuon" + go co chan click). */
  const runTimers = () => {
    while (timers.length) timers.shift()?.fn();
  };
  /** Mo phong cuon toi tam slide `abs` (cuon muot da chay xong) roi ban su kien scroll. */
  const scrollToSlide = (abs: number) => {
    track.scrollLeft = track.children[abs].offsetLeft; // tam slide = offsetLeft + 150 - clientWidth/2 = offsetLeft
    track.handlers.scroll({});
  };
  const activeIndexes = () => track.children.map((s, i) => (s.classes.has("is-active") ? i : -1)).filter((i) => i !== -1);
  return { count, originals, track, dots, counter, buttonHandlers, windowHandlers, runTimers, scrollToSlide, activeIndexes };
}

const last = (calls: ScrollCall[]) => calls[calls.length - 1];

// ---- nhan ban + khoi tao ----

test("nhan ban: 3 bo slide (truoc / that / sau); ban sao aria-hidden + data-clone; slide that khong bi danh dau", () => {
  const m = mount({ count: 4 });
  assert.equal(m.track.children.length, 12);
  const real = m.track.children.slice(4, 8);
  assert.deepEqual(real, m.originals); // bo giua chinh la slide that, dung thu tu
  for (const slide of real) assert.equal(slide.getAttribute("aria-hidden"), null);
  for (const slide of [...m.track.children.slice(0, 4), ...m.track.children.slice(8)]) {
    assert.equal(slide.getAttribute("aria-hidden"), "true");
    assert.equal(slide.getAttribute("data-clone"), "1");
  }
  assert.deepEqual(m.track.children.map((s) => s.key), ["tip-0", "tip-1", "tip-2", "tip-3", "tip-0", "tip-1", "tip-2", "tip-3", "tip-0", "tip-1", "tip-2", "tip-3"]);
});

test("khoi tao: nhay TUC THOI ve slide that dau tien (bo giua), chi 1 slide active, chu so '1 / N'", () => {
  const m = mount({ count: 4 });
  assert.deepEqual(m.track.scrollCalls[0], { left: 4 * 300, behavior: "auto" });
  assert.deepEqual(m.activeIndexes(), [4]);
  assert.equal(m.counter.textContent, "1 / 4");
  assert.equal(m.dots[0].attrs["aria-current"], "true");
  assert.equal(m.dots[1].attrs["aria-current"], "false");
});

test("chi 1 slide: khong nhan ban, khong gan gi, khong loi", () => {
  const m = mount({ count: 1 });
  assert.equal(m.track.children.length, 1);
  assert.equal(m.track.scrollCalls.length, 0);
});

test("cuon toi slide that thu 3: doi active, chu so '3 / N', cham tron theo chi so that", () => {
  const m = mount({ count: 4 });
  m.scrollToSlide(6); // bo giua, Tip thu 3
  assert.deepEqual(m.activeIndexes(), [6]);
  assert.equal(m.counter.textContent, "3 / 4");
  assert.equal(m.dots[2].attrs["aria-current"], "true");
  assert.equal(m.dots[0].attrs["aria-current"], "false");
});

// ---- lap vong ----

test("bam 'tiep theo' o Tip CUOI -> cuon muot sang ban sao cua Tip 1, dung roi nhay tuc thoi ve Tip 1 that (khong thay)", () => {
  const m = mount({ count: 4 });
  m.scrollToSlide(7); // Tip cuoi (4 / 4)
  assert.equal(m.counter.textContent, "4 / 4");
  m.track.scrollCalls.length = 0;

  m.buttonHandlers["tips-next"]();
  assert.deepEqual(last(m.track.scrollCalls), { left: 8 * 300, behavior: "smooth" }); // ban sao Tip 1 o bo sau

  m.scrollToSlide(8); // cuon muot toi noi
  assert.equal(m.counter.textContent, "1 / 4");
  m.runTimers(); // da dung cuon -> chuan hoa
  assert.deepEqual(last(m.track.scrollCalls), { left: 4 * 300, behavior: "auto" }); // nhay ve Tip 1 that
  assert.deepEqual(m.activeIndexes(), [4]);
  assert.equal(m.counter.textContent, "1 / 4");
  assert.equal(m.track.scrollLeft, 4 * 300);
});

test("bam 'truoc' o Tip DAU -> cuon muot sang ban sao cua Tip cuoi, roi nhay ve Tip cuoi that", () => {
  const m = mount({ count: 4 });
  m.track.scrollCalls.length = 0;

  m.buttonHandlers["tips-prev"]();
  assert.deepEqual(last(m.track.scrollCalls), { left: 3 * 300, behavior: "smooth" }); // ban sao Tip cuoi o bo truoc

  m.scrollToSlide(3);
  assert.equal(m.counter.textContent, "4 / 4");
  m.runTimers();
  assert.deepEqual(last(m.track.scrollCalls), { left: 7 * 300, behavior: "auto" }); // Tip cuoi that
  assert.deepEqual(m.activeIndexes(), [7]);
  assert.equal(m.counter.textContent, "4 / 4");
});

test("phim mui ten cung lap vong: ArrowRight o Tip cuoi, ArrowLeft o Tip dau", () => {
  const m = mount({ count: 3 });
  let prevented = 0;
  const key = (name: string) => ({ key: name, preventDefault: () => prevented++ });

  m.track.scrollCalls.length = 0;
  m.track.handlers.keydown(key("ArrowLeft")); // dang o Tip dau (abs 3)
  assert.deepEqual(last(m.track.scrollCalls), { left: 2 * 300, behavior: "smooth" });

  m.scrollToSlide(5); // Tip cuoi (abs 5)
  m.track.handlers.keydown(key("ArrowRight"));
  assert.deepEqual(last(m.track.scrollCalls), { left: 6 * 300, behavior: "smooth" });
  assert.equal(prevented, 2);
});

test("cham tron di theo duong NGAN NHAT: o Tip cuoi bam cham Tip 1 -> tien 1 buoc (khong cuon nguoc qua ca danh sach)", () => {
  const m = mount({ count: 4 });
  m.scrollToSlide(7); // Tip cuoi
  m.track.scrollCalls.length = 0;
  m.dots[0].handlers.click({});
  assert.deepEqual(last(m.track.scrollCalls), { left: 8 * 300, behavior: "smooth" });

  m.scrollToSlide(8);
  m.runTimers(); // ve Tip 1 that (abs 4)
  m.track.scrollCalls.length = 0;
  m.dots[3].handlers.click({}); // Tip 1 -> Tip cuoi: lui 1 buoc
  assert.deepEqual(last(m.track.scrollCalls), { left: 3 * 300, behavior: "smooth" });
});

test("bam slide mo ben canh (ke ca ban sao): cuon toi no; bam chinh slide dang active: khong lam gi", () => {
  const m = mount({ count: 4 });
  m.track.scrollCalls.length = 0;
  let prevented = false;
  m.track.children[3].handlers.click({ preventDefault: () => (prevented = true) }); // ban sao Tip cuoi, ben trai Tip 1
  assert.deepEqual(last(m.track.scrollCalls), { left: 3 * 300, behavior: "smooth" });
  assert.equal(prevented, true);

  m.track.scrollCalls.length = 0;
  m.track.children[4].handlers.click({ preventDefault: () => assert.fail("slide dang active khong duoc chan click") });
  assert.equal(m.track.scrollCalls.length, 0);
});

test("dang cham tay vao man hinh thi KHONG nhay (nhay duoi tay nguoi dung se pha cu vuot); tha tay xong moi nhay", () => {
  const m = mount({ count: 4 });
  m.scrollToSlide(7);
  m.buttonHandlers["tips-next"]();
  m.track.handlers.touchstart({});
  m.scrollToSlide(8);
  m.track.scrollCalls.length = 0;
  m.runTimers();
  assert.equal(m.track.scrollCalls.length, 0, "dang cham -> khong nhay");

  m.track.handlers.touchend({});
  m.runTimers();
  assert.deepEqual(last(m.track.scrollCalls), { left: 4 * 300, behavior: "auto" });
});

test("nhay ve bo giua tat transition (class no-anim) de khong thay slide sang/mo chop nhay, roi bat lai", () => {
  const m = mount({ count: 4 });
  assert.equal(m.track.classes.has("no-anim"), false, "da go sau khi khoi tao xong");
  m.scrollToSlide(7);
  m.buttonHandlers["tips-next"]();
  m.scrollToSlide(8);
  m.runTimers();
  assert.equal(m.track.classes.has("no-anim"), false);
});

test("prefers-reduced-motion: moi lan cuon tuc thoi (behavior auto), khong 'smooth'", () => {
  const m = mount({ reduceMotion: true });
  m.track.scrollCalls.length = 0;
  m.buttonHandlers["tips-next"]();
  assert.deepEqual(last(m.track.scrollCalls), { left: 5 * 300, behavior: "auto" });
});

test("xoay man hinh / doi kich thuoc: can lai vao slide hien tai (khong bi lech tam)", () => {
  const m = mount({ count: 4 });
  m.scrollToSlide(6);
  m.track.scrollCalls.length = 0;
  m.windowHandlers.resize();
  assert.deepEqual(last(m.track.scrollCalls), { left: 6 * 300, behavior: "auto" });
});

// ---- keo bang chuot (may tinh) ----

const mouseEvent = (clientX: number, extra: Record<string, unknown> = {}) => ({
  pointerType: "mouse",
  button: 0,
  pointerId: 1,
  clientX,
  ...extra,
});

test("keo chuot sang TRAI qua nguong: cuon theo tay, tat snap luc keo, tha ra -> sang Tip ke; bat lai snap", () => {
  const m = mount({ count: 4 });
  m.track.scrollCalls.length = 0;
  m.track.handlers.pointerdown(mouseEvent(500));
  assert.equal(m.track.style.scrollSnapType, "none");
  assert.equal(m.track.classes.has("is-grabbing"), true);

  m.track.handlers.pointermove(mouseEvent(420)); // keo trai 80px
  assert.equal(m.track.scrollLeft, 4 * 300 + 80); // cuon theo tay: startLeft - dx
  assert.deepEqual(m.track.captured, [1]);

  m.track.handlers.pointerup(mouseEvent(420));
  assert.equal(m.track.style.scrollSnapType, "");
  assert.equal(m.track.classes.has("is-grabbing"), false);
  assert.deepEqual(last(m.track.scrollCalls), { left: 5 * 300, behavior: "smooth" });
});

test("keo chuot sang PHAI qua nguong: ve Tip truoc; o Tip dau thi sang ban sao Tip cuoi (lap vong)", () => {
  const m = mount({ count: 4 });
  m.track.scrollCalls.length = 0;
  m.track.handlers.pointerdown(mouseEvent(100));
  m.track.handlers.pointermove(mouseEvent(190));
  m.track.handlers.pointerup(mouseEvent(190));
  assert.deepEqual(last(m.track.scrollCalls), { left: 3 * 300, behavior: "smooth" });
});

test("keo chua toi nguong: tra ve slide cu (khong chuyen Tip)", () => {
  const m = mount({ count: 4 });
  m.track.scrollCalls.length = 0;
  m.track.handlers.pointerdown(mouseEvent(300));
  m.track.handlers.pointermove(mouseEvent(280)); // 20px
  m.track.handlers.pointerup(mouseEvent(280));
  assert.deepEqual(last(m.track.scrollCalls), { left: 4 * 300, behavior: "smooth" });
});

test("sau khi keo, cu click tren slide bi nuot (khong chuyen Tip ngoai y muon); click binh thuong sau do van chay", () => {
  const m = mount({ count: 4 });
  m.track.handlers.pointerdown(mouseEvent(500));
  m.track.handlers.pointermove(mouseEvent(420));
  m.track.handlers.pointerup(mouseEvent(420));
  m.track.scrollCalls.length = 0;

  let prevented = false;
  m.track.children[6].handlers.click({ preventDefault: () => (prevented = true) }); // click ngay sau khi tha chuot
  assert.equal(prevented, true);
  assert.equal(m.track.scrollCalls.length, 0);

  m.runTimers(); // het "ngay sau khi tha"
  m.track.children[6].handlers.click({ preventDefault() {} });
  assert.equal(m.track.scrollCalls.length, 1);
});

test("chi chuot moi keo: cam ung/but (pointerType touch) de cho trinh duyet tu vuot; chuot phai bi bo qua", () => {
  const m = mount({ count: 4 });
  m.track.scrollCalls.length = 0;
  m.track.handlers.pointerdown(mouseEvent(500, { pointerType: "touch" }));
  assert.equal(m.track.style.scrollSnapType, "");
  m.track.handlers.pointerdown(mouseEvent(500, { button: 2 }));
  assert.equal(m.track.style.scrollSnapType, "");
  m.track.handlers.pointermove(mouseEvent(300));
  m.track.handlers.pointerup(mouseEvent(300));
  assert.equal(m.track.scrollCalls.length, 0);
});

test("nhan chuot ma khong keo (chi click): khong chuyen Tip, tra snap ve binh thuong", () => {
  const m = mount({ count: 4 });
  m.track.scrollCalls.length = 0;
  m.track.handlers.pointerdown(mouseEvent(500));
  m.track.handlers.pointerup(mouseEvent(500));
  assert.equal(m.track.style.scrollSnapType, "");
  assert.equal(m.track.scrollCalls.length, 0);
});

test("dang keo chuot thi KHONG nhay chuan hoa (debounce cuon khong duoc xen vao giua cu keo)", () => {
  const m = mount({ count: 4 });
  m.scrollToSlide(8); // dang o ban sao
  m.track.scrollCalls.length = 0;
  m.track.handlers.pointerdown(mouseEvent(500));
  m.runTimers();
  assert.equal(m.track.scrollCalls.length, 0);
});
