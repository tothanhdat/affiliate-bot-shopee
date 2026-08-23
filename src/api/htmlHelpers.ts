import type { CommissionEntry } from "../core/types.js";

/** Helper dung chung cho moi trang HTML viet tay trong src/api (dashboard user va admin). */

export function formatVnd(amount: number): string {
  return `${new Intl.NumberFormat("vi-VN").format(amount)}đ`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

/** "YYYY-MM-DD" cua ngay hom nay (gio VN) - dung lam value mac dinh cho <input type="date">. */
export function todayDateInputValue(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
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
 * bat buoc cho MOI action lien quan den tien (rut tien, danh dau da tra, huy don, ghi nhan don/
 * khoan Accesstrade...). Day la 1 trong so RAT IT ngoai le dung JS phia client trong toan bo
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
