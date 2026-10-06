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

/**
 * Mau lay bang cach DO THAT tren chu "ĐƠN" in san cua template (he 1678x937), de con so doc ra
 * nhu cung mot cum chu chu khong phai mot mon ghep vao:
 * - Gradient chay NGANG (trai -> phai), khong phai doc: do doc theo cot cho #FDF1B3 o canh trai
 *   va #FDE589 o canh phai, con bien thien theo chieu DOC trong cung mot cot gan nhu bang 0.
 * - KHONG co vien trang. Mep tren cua "ĐƠN" chuyen thang tu nen sang mau to, chi co khu rang cua.
 * - Bong do: ngay duoi net chu la #c24810 roi nhat dan ve nen trong ~10px. Chu TRANG ben canh
 *   ("VỀ LUÔN NÈ") do ra #c54912 - gan nhu trung, tuc ca dong tieu de dung CHUNG mot kieu bong.
 */
const GRADIENT_STOPS = [
  { offset: "0%", color: "#FDF1B3" },
  { offset: "100%", color: "#FDE589" },
];
/**
 * Bong do: do lech/do nhoe/do dam tinh theo fontSize de giu nguyen ty le khi doi template.
 * Cac he so duoi day do bang cach DO LAI diem toi nhat duoi net chu va so voi "ĐƠN" in san:
 * dat #b23f00 (do sang 90) so voi #a53d06 (do sang 86) cua "ĐƠN" - sai lech 4/255.
 */
const SHADOW_COLOR = "#C14000";
const SHADOW_OPACITY = 0.95;
const SHADOW_DY_RATIO = 0.1;
const SHADOW_BLUR_RATIO = 0.03;

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
<linearGradient id="g" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient>
<filter id="d" x="-40%" y="-40%" width="180%" height="180%">
<feDropShadow dx="0" dy="${(fontSize * SHADOW_DY_RATIO).toFixed(2)}" stdDeviation="${(fontSize * SHADOW_BLUR_RATIO).toFixed(2)}" flood-color="${SHADOW_COLOR}" flood-opacity="${SHADOW_OPACITY}"/>
</filter>
</defs>
<g filter="url(#d)">
<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
 font-family="Montserrat" font-weight="800" font-size="${fontSize}"
 fill="url(#g)">${Math.trunc(count)}</text>
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
