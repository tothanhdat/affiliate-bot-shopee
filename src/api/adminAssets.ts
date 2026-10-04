import { statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Duong dan CSS cua khu /admin, kem "van" de pha cache trinh duyet (2026-10-04).
 *
 * LY DO PHAI CO: public/admin.css duoc serve voi max-age dai, nen khong co van thi sau moi lan
 * deploy admin van dung file CSS CU cho den khi cache het han - giao dien hien sai ma khong ai
 * hieu tai sao (da gap that luc preview: sua CSS, build lai, trinh duyet van ve nut copy theo ban cu).
 *
 * Van lay tu mtime cua chinh file da build: moi lan `npm run build:css` chay la doi, va khong doi
 * khi chi restart app. Doc MOT LAN roi nho lai - file nay khong doi giua chung mot tien trinh
 * (build xong moi start).
 *
 * Thieu file (chua chay build:css) -> van "dev": link van tro dung cho, de route tinh tra 404 va
 * canh bao luc khoi dong trong server.ts noi ro phai chay lenh nao. KHONG throw - mot trang admin
 * xau van con dung duoc, con nem loi o day thi ca app khong khoi dong noi.
 */
let cachedHref: string | null = null;

export function adminCssHref(): string {
  if (cachedHref !== null) return cachedHref;
  let version = "dev";
  try {
    version = Math.trunc(statSync(resolve(process.cwd(), "public", "admin.css")).mtimeMs).toString(36);
  } catch {
    // Khong co file - giu "dev", canh bao da duoc in o server.ts.
  }
  cachedHref = `/admin/assets/admin.css?v=${version}`;
  return cachedHref;
}
