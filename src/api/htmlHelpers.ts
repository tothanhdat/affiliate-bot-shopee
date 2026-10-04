import type { CommissionEntry } from "../core/types.js";

/** Helper dung chung cho moi trang HTML viet tay trong src/api (dashboard user va admin). */

/**
 * Mot so tien hien thi tren web, LUON la so nguyen (yeu cau cua user 2026-10-01).
 *
 * Shopee tra hoa hong le toi phan nghin dong (vd 22.990,5d) nen commission_amount/after_tax_amount
 * trong DB la so thuc; khong lam tron thi cong nhieu don ra "146.457,765đ", trong nhu loi he thong.
 * Lam tron CHI o buoc hien thi - so trong DB giu nguyen do chinh xac, moi phep tinh tien van chay
 * tren so goc (xem commissionMath.ts).
 *
 * Chuoi bi tru di khong lech: thue/phi/phan user deu da duoc Math.round thanh so nguyen tu luc ghi,
 * nen phan thap phan cua "hoa hong goc" va "hoa hong sau thue" luon y het nhau - lam tron tung so
 * roi tru van ra dung bang tru truoc roi lam tron.
 *
 * maximumFractionDigits: 0 dung dung cach cua formatVnd trong adapters/shared/replyText.ts (tin
 * nhan bot) - 2 noi phai ra cung 1 con so cho cung 1 don.
 */
export { formatVnd } from "../core/money.js";

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

/**
 * Cung moc thoi gian nhu formatDateTime() nhung tach lam 2 manh, de trang /admin/orders xep "gio •
 * ngay" tren 1 dong phu duoi ma don. Dinh dang CO DINH (2 chu so, 24h, dd/mm/yyyy) chu khong theo
 * mac dinh cua locale: hang nay nam duoi ma don o cot hep nhat cua bang, de locale tu chon thi
 * "9:05:55" va "09:05:55" lan nhau lam cac dong lech chieu ngang.
 */
export function formatDateTimeParts(iso: string): { time: string; date: string } {
  const value = new Date(iso);
  const timeZone = "Asia/Ho_Chi_Minh";
  return {
    time: value.toLocaleTimeString("vi-VN", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }),
    date: value.toLocaleDateString("vi-VN", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" }),
  };
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escape 1 chuoi de nhet an toan vao trong 1 JS string literal dung dau nhay don ('...'). */
function jsStringLiteral(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Toast thanh cong goc tren-phai, tu bien mat sau vai giay - dung THUAN CSS animation (class
 * .toast, dinh nghia keyframes trong <style> cua adminHtml.ts), KHONG can JS/setTimeout, giu dung
 * triet ly "HTML tay, JS toi thieu" cua thu muc nay. Dung cho cac action "import"/hang loat - khac
 * banner tinh <div class="success"> da co san cho form ghi 1 don le (van giu nguyen, khong doi).
 */
export function successToast(message: string): string {
  return `<div class="toast" role="status">${escapeHtml(message)}</div>`;
}

/**
 * Tra ve attribute `onsubmit="return confirm('...');"` de gan vao 1 the <form> - popup xac nhan
 * bat buoc cho MOI action lien quan den tien (rut tien, danh dau da tra, huy don, ghi nhan
 * don...). Day la 1 trong so RAT IT ngoai le dung JS phia client trong toan bo
 * src/api - chi la thuoc tinh inline dung API co san cua trinh duyet, khong them script/dependency.
 */
export function confirmOnSubmit(message: string): string {
  return `onsubmit="return confirm('${escapeHtml(jsStringLiteral(message))}');"`;
}

/**
 * Nut copy nhanh 1 gia tri (vd ma don hang) vao clipboard - dung navigator.clipboard.writeText()
 * co san cua trinh duyet, khong them thu vien nao. Ngoai le JS thu 2 (sau confirmOnSubmit), chi
 * 1 dong onclick inline, doi text nut tam thoi de bao da copy thanh cong roi tu doi lai sau 1.2s.
 */
export function copyButton(value: string, label = "Copy"): string {
  const safeValue = escapeHtml(jsStringLiteral(value));
  const safeLabel = escapeHtml(label);
  return (
    `<button type="button" class="copy-btn" onclick="navigator.clipboard.writeText('${safeValue}')` +
    `.then(()=>{this.textContent='Đã copy';setTimeout(()=>{this.textContent='${safeLabel}'},1200)})">${safeLabel}</button>`
  );
}

/**
 * Ban chi-co-icon cua copyButton(), dung trong o bang chat hep (ma don o /admin/orders) - nhan chu
 * "Copy" canh moi ma don lam cot do rong them ~4rem va keo mat khoi chinh no.
 *
 * Phan hoi "da copy" lam bang CACH DOI ICON (copy -> dau tich) chu khong chi doi mau: doi mau don
 * thuan thi nguoi mu mau khong thay gi xay ra. Hai icon nam san trong nut, CSS (.copy-icon /
 * .copy-icon.copied trong adminHtml.ts) chon hien cai nao - nho vay onclick khong phai nhoi mot
 * chuoi SVG vao trong attribute HTML.
 */
export function copyIconButton(value: string, ariaLabel: string): string {
  const safeValue = escapeHtml(jsStringLiteral(value));
  return (
    `<button type="button" class="copy-icon" title="${escapeHtml(ariaLabel)}" aria-label="${escapeHtml(ariaLabel)}"` +
    ` onclick="navigator.clipboard.writeText('${safeValue}')` +
    `.then(()=>{this.classList.add('copied');setTimeout(()=>this.classList.remove('copied'),1200)})">` +
    `<span class="i-copy" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></span>` +
    `<span class="i-done" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>` +
    `</button>`
  );
}

export type BadgeTone = "success" | "warning" | "danger";

/** Nhan + mau badge cho 1 commission entry - dung chung boi dashboard user va admin. */
export function statusBadge(entry: CommissionEntry): { label: string; tone: BadgeTone } {
  if (entry.status === "confirmed" && entry.withdrawalId) {
    return { label: "Đang chờ rút", tone: "warning" };
  }
  switch (entry.status) {
    case "pending":
      return { label: "Chờ xác nhận", tone: "warning" };
    case "confirmed":
      return { label: "Khả dụng", tone: "success" };
    case "paid":
      return { label: "Đã rút", tone: "success" };
    case "reversed":
      return { label: "Đã huỷ", tone: "danger" };
  }
}
