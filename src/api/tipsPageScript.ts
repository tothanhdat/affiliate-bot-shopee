/**
 * JS client cua trang slide /d/:token/tips (2026-10-14), dang chuoi de test bang node:vm
 * (tipsPageScript.test.ts). KHONG chua the <script>, backtick hay "${" de nhung an toan vao template string.
 *
 * LAP VONG (bam tiep o Tip cuoi -> Tip 1, bam truoc o Tip 1 -> Tip cuoi): server chi render cac slide THAT; script
 * nhan ban thanh 3 bo [ban sao | THAT | ban sao], dung o bo giua. Khi cuon dung lai o 1 ban sao thi NHAY TUC THOI ve
 * slide tuong ung o bo giua - 2 slide giong het nhau nen mat khong thay. Cach nay giu nguyen vuot + quan tinh +
 * scroll-snap GOC cua trinh duyet (khong tu viet physics), va hai ben Tip 1 luon lo Tip cuoi (va nguoc lai).
 *   - CSS KHONG khai bao cuon muot mac dinh: moi lan cuon deu truyen behavior ro rang, nen "auto" = tuc thoi.
 *   - Khi nhay phai tat transition (class no-anim): neu khong, slide that vua duoc danh dau active se "sang dan"
 *     0.35s trong luc ban sao vua roi di dang sang het co - nhin nhu chop.
 *   - KHONG nhay khi nguoi dung dang cham tay / dang keo chuot: nhay duoi tay se pha cu vuot.
 * Cam ung: de trinh duyet tu vuot. Chuot (may tinh): keo-tha tu viet bang pointer events (vuot qua nguong ~50px
 * thi sang Tip ke, chua toi nguong thi tra ve), vi chuot khong cuon ngang duoc nhu ngon tay.
 *
 * Progressive enhancement: script loi/tat thi van la slide thuong (khong lap vong, van vuot duoc).
 */
export const TIPS_PAGE_SCRIPT = `
function nearestSlideIndex(centers, viewCenter) {
  var best = 0;
  var bestDistance = Infinity;
  for (var i = 0; i < centers.length; i++) {
    var distance = Math.abs(centers[i] - viewCenter);
    if (distance < bestDistance) { best = i; bestDistance = distance; }
  }
  return best;
}
function mod(a, m) {
  return ((a % m) + m) % m;
}
// Buoc di NGAN NHAT tren vong tron count phan tu (Tip cuoi -> Tip dau = +1, Tip dau -> Tip cuoi = -1).
function shortestDelta(from, to, count) {
  var half = Math.floor(count / 2);
  return mod(to - from + half, count) - half;
}
// Keo chuot sang trai (dx am) qua nguong -> Tip ke; sang phai -> Tip truoc; chua toi nguong -> o lai.
function swipeTarget(startIndex, dx, threshold) {
  if (dx <= -threshold) return startIndex + 1;
  if (dx >= threshold) return startIndex - 1;
  return startIndex;
}
(function () {
  var track = document.getElementById("tips-track");
  if (!track) return;
  var originals = Array.prototype.slice.call(track.querySelectorAll(".tip-slide"));
  var count = originals.length;
  if (count < 2) return;
  var dots = Array.prototype.slice.call(document.querySelectorAll(".tips-dot"));
  var counter = document.getElementById("tips-counter");
  var prev = document.getElementById("tips-prev");
  var next = document.getElementById("tips-next");
  var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var BEHAVIOR = reduceMotion ? "auto" : "smooth";
  var SWIPE_THRESHOLD = 50;
  var SETTLE_MS = 140;

  function makeClone(source) {
    var copy = source.cloneNode(true);
    copy.setAttribute("aria-hidden", "true");
    copy.setAttribute("data-clone", "1");
    return copy;
  }
  var firstOriginal = originals[0];
  var before = originals.map(function (slide) {
    var copy = makeClone(slide);
    track.insertBefore(copy, firstOriginal);
    return copy;
  });
  var after = originals.map(function (slide) {
    var copy = makeClone(slide);
    track.appendChild(copy);
    return copy;
  });
  var slides = before.concat(originals, after);

  var current = count;
  var ticking = false;
  var touching = false;
  var drag = null;
  var suppressClick = false;
  var settleTimer = null;

  function centerLeft(slide) {
    return slide.offsetLeft + slide.offsetWidth / 2 - track.clientWidth / 2;
  }
  function render(abs) {
    current = abs;
    var real = mod(abs, count);
    slides.forEach(function (slide, i) { slide.classList.toggle("is-active", i === abs); });
    dots.forEach(function (dot, i) { dot.setAttribute("aria-current", i === real ? "true" : "false"); });
    if (counter) counter.textContent = (real + 1) + " / " + count;
  }
  // Chay fn voi transition tat, go class sau 2 khung hinh (de trinh duyet ap xong trang thai moi roi moi bat lai).
  function withoutTransition(fn) {
    track.classList.add("no-anim");
    fn();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { track.classList.remove("no-anim"); });
    });
  }
  function jumpTo(abs) {
    withoutTransition(function () {
      track.scrollTo({ left: centerLeft(slides[abs]), behavior: "auto" });
      render(abs);
    });
  }
  function goTo(abs) {
    var target = Math.max(0, Math.min(abs, slides.length - 1));
    track.scrollTo({ left: centerLeft(slides[target]), behavior: BEHAVIOR });
  }
  // Dung cuon o ban sao -> nhay ve slide tuong ung o bo giua (khong thay vi 2 slide giong het nhau).
  function settle() {
    if (touching || drag) return;
    if (current >= count && current < 2 * count) return;
    jumpTo(count + mod(current, count));
  }
  function scheduleSettle() {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, SETTLE_MS);
  }
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var centers = slides.map(function (slide) { return slide.offsetLeft + slide.offsetWidth / 2; });
      render(nearestSlideIndex(centers, track.scrollLeft + track.clientWidth / 2));
      scheduleSettle();
    });
  }

  track.addEventListener("scroll", onScroll);
  track.addEventListener("keydown", function (event) {
    if (event.key === "ArrowRight") { event.preventDefault(); goTo(current + 1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); goTo(current - 1); }
  });
  track.addEventListener("touchstart", function () { touching = true; }, { passive: true });
  function touchDone() { touching = false; scheduleSettle(); }
  track.addEventListener("touchend", touchDone, { passive: true });
  track.addEventListener("touchcancel", touchDone, { passive: true });

  // Keo bang CHUOT (may tinh). Cam ung/but de trinh duyet tu vuot.
  track.addEventListener("pointerdown", function (event) {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    drag = { startX: event.clientX, startLeft: track.scrollLeft, startIndex: current, moved: false, pointerId: event.pointerId };
    track.style.scrollSnapType = "none";
    track.classList.add("is-grabbing");
  });
  track.addEventListener("pointermove", function (event) {
    if (!drag) return;
    var dx = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) > 4) {
      drag.moved = true;
      // Chi bat pointer khi that su keo: bat ngay luc nhan thi click vao slide ben canh se roi vao track.
      if (track.setPointerCapture) { try { track.setPointerCapture(drag.pointerId); } catch (e) {} }
    }
    if (drag.moved) track.scrollLeft = drag.startLeft - dx;
  });
  function endDrag(event) {
    if (!drag) return;
    var finished = drag;
    drag = null;
    track.classList.remove("is-grabbing");
    track.style.scrollSnapType = "";
    if (!finished.moved) return;
    // Cu click ngay sau khi tha chuot khong duoc chuyen Tip them lan nua.
    suppressClick = true;
    setTimeout(function () { suppressClick = false; }, 0);
    goTo(swipeTarget(finished.startIndex, event.clientX - finished.startX, SWIPE_THRESHOLD));
  }
  track.addEventListener("pointerup", endDrag);
  track.addEventListener("pointercancel", endDrag);

  slides.forEach(function (slide, i) {
    slide.addEventListener("click", function (event) {
      if (suppressClick) { event.preventDefault(); return; }
      if (i !== current) { event.preventDefault(); goTo(i); }
    });
  });
  dots.forEach(function (dot) {
    dot.addEventListener("click", function () {
      var target = Number(dot.getAttribute("data-index"));
      goTo(current + shortestDelta(mod(current, count), target, count));
    });
  });
  if (prev) prev.addEventListener("click", function () { goTo(current - 1); });
  if (next) next.addEventListener("click", function () { goTo(current + 1); });
  if (window.addEventListener) window.addEventListener("resize", function () { jumpTo(current); });

  jumpTo(count);
})();
`;
