/**
 * JS client cua trang slide /d/:token/tips (2026-10-14), dang chuoi de test bang node:vm
 * (tipsPageScript.test.ts). KHONG chua the <script>, backtick hay "${" de nhung an toan vao template string.
 *
 * Progressive enhancement: neu script nay loi thi scroll-snap van vuot duoc, chi mat hieu ung sang/mo va cham tron.
 * Script CHI lam 4 viec: danh dau slide dang o giua (is-active), dong bo cham tron + "2 / 5", bam cham/slide mo/
 * nut/phim de cuon toi slide khac, ton trong prefers-reduced-motion.
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
(function () {
  var track = document.getElementById("tips-track");
  if (!track) return;
  var slides = Array.prototype.slice.call(track.querySelectorAll(".tip-slide"));
  if (slides.length < 2) return;
  var dots = Array.prototype.slice.call(document.querySelectorAll(".tips-dot"));
  var counter = document.getElementById("tips-counter");
  var prev = document.getElementById("tips-prev");
  var next = document.getElementById("tips-next");
  var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var active = 0;
  var ticking = false;

  function render(index) {
    active = index;
    slides.forEach(function (slide, i) { slide.classList.toggle("is-active", i === index); });
    dots.forEach(function (dot, i) { dot.setAttribute("aria-current", i === index ? "true" : "false"); });
    if (counter) counter.textContent = (index + 1) + " / " + slides.length;
  }
  function goTo(index) {
    if (index < 0 || index >= slides.length) return;
    slides[index].scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", inline: "center", block: "nearest" });
  }
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var centers = slides.map(function (slide) { return slide.offsetLeft + slide.offsetWidth / 2; });
      render(nearestSlideIndex(centers, track.scrollLeft + track.clientWidth / 2));
    });
  }

  track.addEventListener("scroll", onScroll);
  track.addEventListener("keydown", function (event) {
    if (event.key === "ArrowRight") { event.preventDefault(); goTo(active + 1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); goTo(active - 1); }
  });
  slides.forEach(function (slide, i) {
    slide.addEventListener("click", function (event) {
      if (i !== active) { event.preventDefault(); goTo(i); }
    });
  });
  dots.forEach(function (dot) {
    dot.addEventListener("click", function () { goTo(Number(dot.getAttribute("data-index"))); });
  });
  if (prev) prev.addEventListener("click", function () { goTo(active - 1); });
  if (next) next.addEventListener("click", function () { goTo(active + 1); });
  render(0);
})();
`;
