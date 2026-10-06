import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

/**
 * Ve RIENG con so don (phan chen vao khe trong cua tieu de in san) thanh 1 anh PNG trong suot.
 *
 * VI SAO KHONG VE THANG BANG satori (da thu, khong dat):
 * - `backgroundClip: "text"` cua satori khong cat sach theo net chu: con sot mot vet mau hinh
 *   chu nhat phia tren con so.
 * - Khi gop `backgroundClip: "text"` voi `WebkitTextStroke` thi stroke KHONG duoc ve ra.
 * Dac ta cua chu bot doi CA BA: gradient doc + vien trang mo + bong do. Viet thang SVG roi
 * cho resvg render la cach duy nhat kiem soat du ca ba.
 *
 * Mot lan goi them resvg cho mot anh ~100x66 la khong dang ke so voi lan render anh chinh.
 */

const FONT_PATH = fileURLToPath(new URL("./assets/Montserrat-ExtraBold.ttf", import.meta.url));

/** Dai mau: dinh vang sang -> day cam am, cho tiep voi cum chu vang in san tren nen. */
const GRADIENT_STOPS = [
  { offset: "0%", color: "#FFF176" },
  { offset: "30%", color: "#FFE082" },
  { offset: "85%", color: "#F57C00" },
  { offset: "100%", color: "#E65100" },
];

export interface OrderCountBadgeOptions {
  /** So don - chi dung chu so nen khong can escape XML. */
  count: number;
  width: number;
  height: number;
  fontSize: number;
}

function buildSvg({ count, width, height, fontSize }: OrderCountBadgeOptions): string {
  const stops = GRADIENT_STOPS.map(
    (s) => `<stop offset="${s.offset}" stop-color="${s.color}"/>`
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient>
<filter id="d" x="-40%" y="-40%" width="180%" height="180%">
<feDropShadow dx="0" dy="${(fontSize * 0.035).toFixed(2)}" stdDeviation="${(fontSize * 0.023).toFixed(2)}" flood-color="#B76E00" flood-opacity="0.38"/>
</filter>
</defs>
<g filter="url(#d)">
<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
 font-family="Montserrat" font-weight="800" font-size="${fontSize}"
 fill="url(#g)" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="${Math.max(1, fontSize * 0.022).toFixed(2)}"
 paint-order="stroke fill">${Math.trunc(count)}</text>
</g>
</svg>`;
}

/** Tra PNG trong suot chua con so da to gradient + vien + bong. */
export function renderOrderCountBadge(options: OrderCountBadgeOptions): Buffer {
  const svg = buildSvg(options);
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: options.width },
    // Khong nap font he thong: tren Railway khong co Montserrat, va de `true` thi resvg se
    // am tham thay bang font khac thay vi bao loi.
    font: { fontFiles: [FONT_PATH], loadSystemFonts: false, defaultFontFamily: "Montserrat" },
  })
    .render()
    .asPng();
  return Buffer.from(png);
}
