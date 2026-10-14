import type { Tip } from "../core/types.js";
import { pageShell } from "./dashboardHtml.js";
import { escapeHtml } from "./htmlHelpers.js";
import { TIPS_PAGE_SCRIPT } from "./tipsPageScript.js";

/**
 * Trang Tips cua user: /d/:token/tips (2026-10-14). Mobile la man hinh CHINH. Slide ngang bang CSS scroll-snap
 * thuan; script chi danh dau slide dang o giua (xem tipsPageScript.ts). Spec muc 7.
 *
 * Bo cuc slide: --gap + spacer 2 dau (14% - gap) + slide 72% -> slide dau/cuoi cung nam CHINH GIUA va luon lo mep
 * slide ke ben (~14% - gap, tru phan bi scale thu nho; do that o khung 390px ban 78%/11% chi lo ~15px - qua mong). Dung % thuan (cung quy chieu = be rong track) thay vi cqw/calc phuc tap
 * de chay duoc tren WebView Zalo cu.
 */

const TIPS_PAGE_CSS = `
  .tips-head { display: flex; align-items: center; margin-bottom: 0.5rem; }
  .tips-back { color: var(--text-muted); font-size: 0.875rem; text-decoration: none; }
  .tips-viewport { position: relative; max-width: 520px; margin: 1.25rem auto 0; }
  @media (max-width: 560px) { .tips-viewport { margin-left: -1rem; margin-right: -1rem; } }
  .tips-track {
    --gap: 0.75rem;
    display: flex;
    gap: var(--gap);
    align-items: flex-start;
    overflow-x: auto;
    position: relative;
    padding: 0.25rem 0 1.25rem;
    scroll-snap-type: x mandatory;
    scroll-behavior: smooth;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    outline: none;
  }
  .tips-track::-webkit-scrollbar { display: none; }
  .tips-track::before, .tips-track::after { content: ""; flex: 0 0 calc(14% - var(--gap)); }
  .tip-slide {
    flex: 0 0 72%;
    scroll-snap-align: center;
    scroll-snap-stop: always;
    background: var(--card-bg);
    -webkit-backdrop-filter: blur(16px);
    backdrop-filter: blur(16px);
    border: 1px solid var(--card-border);
    box-shadow: var(--card-shadow);
    border-radius: 18px;
    overflow: hidden;
    opacity: 0.45;
    transform: scale(0.94);
    transform-origin: center top;
    transition: opacity 0.35s ease, transform 0.35s ease;
    cursor: pointer;
  }
  .tip-slide.is-active { opacity: 1; transform: scale(1); cursor: default; }
  .tips-single::before, .tips-single::after { display: none; }
  .tips-single { scroll-snap-type: none; padding-left: 1rem; padding-right: 1rem; }
  .tips-single .tip-slide { flex-basis: 100%; cursor: default; }
  h2.tip-title { font-size: 1.125rem; font-weight: 700; color: #fff; margin: 1rem 1rem 0.75rem; line-height: 1.35; }
  .tip-image {
    margin: 0 0.75rem;
    aspect-ratio: 4 / 3;
    border-radius: 12px;
    overflow: hidden;
    background: oklch(1 0 0 / 0.06);
  }
  .tip-image img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .tip-desc {
    margin: 0;
    padding: 0.875rem 1rem 1.125rem;
    color: var(--text-soft);
    font-size: 0.9375rem;
    line-height: 1.55;
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
  .tips-dots { display: flex; justify-content: center; gap: 0.125rem; margin-top: 0.25rem; }
  .tips-dot {
    width: 1.5rem; height: 1.5rem; padding: 0; border: 0; background: none; cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .tips-dot::before {
    content: ""; width: 0.5rem; height: 0.5rem; border-radius: 999px;
    background: var(--text-dim); opacity: 0.55;
    transition: width 0.25s ease, opacity 0.25s ease, background-color 0.25s ease;
  }
  .tips-dot[aria-current="true"]::before { width: 1.25rem; background: var(--accent); opacity: 1; }
  .tips-counter { text-align: center; color: var(--text-dim); font-size: 0.8125rem; margin-top: 0.25rem; }
  .tips-arrow {
    display: none; position: absolute; top: 40%; z-index: 2;
    width: 2.25rem; height: 2.25rem; padding: 0; border-radius: 999px; cursor: pointer;
    border: 1px solid oklch(1 0 0 / 0.25); background: oklch(0.3 0.06 295 / 0.85); color: #fff;
    font-size: 1.25rem; line-height: 1; align-items: center; justify-content: center;
  }
  #tips-prev { left: 0.5rem; }
  #tips-next { right: 0.5rem; }
  @media (hover: hover) and (pointer: fine) { .tips-arrow { display: inline-flex; } }
  @media (prefers-reduced-motion: reduce) {
    .tips-track { scroll-behavior: auto; }
    .tip-slide, .tips-dot::before { transition: none; }
  }
`;

function renderSlide(tip: Tip, index: number, total: number): string {
  const image = tip.imagePath
    ? `<div class="tip-image"><img src="/tips/images/${encodeURIComponent(tip.imagePath)}" alt="${escapeHtml(tip.title)}"${
        index === 0 ? "" : ' loading="lazy"'
      } decoding="async" onerror="this.parentNode.style.display='none'"></div>`
    : "";
  const description = tip.description ? `<p class="tip-desc">${escapeHtml(tip.description)}</p>` : "";
  return `<article class="tip-slide${index === 0 ? " is-active" : ""}" data-index="${index}" aria-roledescription="slide" aria-label="${index + 1} / ${total}">
<h2 class="tip-title">${escapeHtml(tip.title)}</h2>
${image}
${description}
</article>`;
}

export function renderTipsPage(input: { token: string; tips: Tip[] }): string {
  const { tips } = input;
  const backHref = `/d/${encodeURIComponent(input.token)}`;
  const head = `<div class="tips-head"><a class="tips-back" href="${backHref}">← Hoa hồng của bạn</a></div>
<h1>💡 Tips</h1>`;

  if (tips.length === 0) {
    return pageShell(
      "Tips",
      `${head}
<div class="card" style="margin-top:1.25rem"><p style="margin:0">Chưa có mẹo nào, bạn quay lại sau nhé.</p></div>`,
      TIPS_PAGE_CSS
    );
  }

  const single = tips.length === 1;
  const slides = tips.map((tip, index) => renderSlide(tip, index, tips.length)).join("\n");
  const arrows = single
    ? ""
    : `<button type="button" id="tips-prev" class="tips-arrow" aria-label="Mẹo trước">‹</button>
<button type="button" id="tips-next" class="tips-arrow" aria-label="Mẹo sau">›</button>`;
  const dots = single
    ? ""
    : `<div class="tips-dots" id="tips-dots">${tips
        .map(
          (_tip, index) =>
            `<button type="button" class="tips-dot" data-index="${index}" aria-label="Mẹo ${index + 1}" aria-current="${index === 0 ? "true" : "false"}"></button>`
        )
        .join("")}</div>
<div class="tips-counter" id="tips-counter" aria-live="polite">1 / ${tips.length}</div>`;

  const body = `${head}
<div class="tips-viewport">
<div id="tips-track" class="tips-track${single ? " tips-single" : ""}" tabindex="0" role="region" aria-roledescription="carousel" aria-label="Danh sách mẹo">
${slides}
</div>
${arrows}
</div>
${dots}
<noscript><style>.tip-slide { opacity: 1; transform: none; }</style></noscript>
<script>${TIPS_PAGE_SCRIPT}</script>`;

  return pageShell("Tips", body, TIPS_PAGE_CSS);
}
