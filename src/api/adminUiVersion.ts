/**
 * TAM THOI (2026-10-02) — ha tang cho nut chuyen giao dien cu/moi cua khu /admin.
 *
 * Muc dich: dung lai toan bo /admin theo skill `/evon:ui-ux` ma KHONG dong vao ban dang chay.
 * Ban cu (`v1`) la MAC DINH tuyet doi: khong co cookie, cookie rac, instance cua nguoi van hanh
 * khac — tat ca deu thay y het hom qua. Chi khi admin tu bam nut moi sang `v2`.
 *
 * **CA FILE NAY SE BI XOA** khi chot giao dien moi: luc do doi ten `adminHtmlV2/` thanh chinh thuc,
 * xoa ban cu, xoa route /admin/ui/:version va xoa middleware chen widget trong server.ts. Dung xay
 * them tinh nang nao dua tren cookie `admin_ui`.
 */

export const ADMIN_UI_COOKIE = "admin_ui";

export type AdminUiVersion = "v1" | "v2";

/** Trang quay ve khi khong doan duoc nguoi dung dang o dau (hoac `back` khong an toan). */
const DEFAULT_BACK_PATH = "/admin/dashboard";

/** Doc version tu cookie. MOI gia tri khong hop le deu lui ve `v1` — khong bao gio throw. */
export function resolveAdminUiVersion(cookies: Record<string, string>): AdminUiVersion {
  return parseAdminUiVersion(cookies[ADMIN_UI_COOKIE]) ?? "v1";
}

/** Dung cho param `:version` cua route doi giao dien — tra `null` de route tra 404. */
export function parseAdminUiVersion(raw: unknown): AdminUiVersion | null {
  return raw === "v1" || raw === "v2" ? raw : null;
}

/**
 * Loc tham so `back` truoc khi dua vao `res.redirect()`.
 *
 * CHONG OPEN-REDIRECT: `back` den tu query string nen nguoi la go duoc. Chi nhan path NOI BO trong
 * khu /admin. Cac cua da chan (co test cho tung cai):
 *  - URL tuyet doi (`https://evil.com`) va protocol-relative (`//evil.com`) — khong bat dau "/admin"
 *  - dau "\" — Chrome/IE tung quy doi thanh "/", nen "/admin\@evil.com" co the thanh host khac
 *  - CR/LF — chong chen them header vao response
 *  - chinh route /admin/ui/ — tranh bam nut xong lai nhay vong lai chinh no
 *
 * Query string duoc GIU NGUYEN co chu dich: bam doi giao dien giua luc dang loc /admin/orders ma
 * mat bo loc la buc nhat.
 */
export function safeAdminBackPath(raw: unknown): string {
  if (typeof raw !== "string" || raw === "") return DEFAULT_BACK_PATH;
  if (/[\r\n\\]/.test(raw)) return DEFAULT_BACK_PATH;
  if (raw !== "/admin" && !raw.startsWith("/admin/")) return DEFAULT_BACK_PATH;
  if (raw.startsWith("/admin/ui/")) return DEFAULT_BACK_PATH;
  return raw;
}

/**
 * Nut chuyen giao dien, noi tren moi trang /admin.
 *
 * CSS viet INLINE co chu dich: widget nay phai hien dung ke ca khi ban `v2` da thay sach stylesheet
 * cua ban cu. No duoc chen vao ngay truoc `</body>` boi middleware trong server.ts, nen ca hai ban
 * `adminShell()` deu khong can biet gi ve no.
 */
export function adminUiSwitcherHtml(current: AdminUiVersion, backPath: string): string {
  const back = encodeURIComponent(safeAdminBackPath(backPath));

  const tab = (version: AdminUiVersion, label: string): string => {
    const active = version === current;
    const style = active
      ? "background:#6a4fd8;color:#fff;"
      : "background:transparent;color:#4b5563;";
    return (
      `<a href="/admin/ui/${version}?back=${back}"` +
      (active ? ' aria-current="true"' : "") +
      ` style="${style}padding:0.2rem 0.6rem;border-radius:999px;text-decoration:none;font-weight:600;">` +
      `${label}</a>`
    );
  };

  return (
    `<div class="admin-ui-switch" style="position:fixed;right:1rem;bottom:1rem;z-index:9999;` +
    `display:flex;align-items:center;gap:0.35rem;padding:0.3rem 0.45rem;border-radius:999px;` +
    `background:#fff;border:1px solid #d1d5db;box-shadow:0 4px 14px rgba(0,0,0,0.14);` +
    `font:600 12px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;">` +
    `<span style="color:#9ca3af;padding-left:0.3rem;">Giao diện</span>` +
    tab("v1", "Cũ") +
    tab("v2", "Mới") +
    `</div>`
  );
}
