import { adminCssHref } from "./adminAssets.js";
import type { OrdersFilterTotals, RatePercents } from "../core/ledgerStore.js";
import type { CommissionBreakdown } from "../core/commissionMath.js";
import { formatVnDateDdMm, todayVnIso } from "../core/vietnamDate.js";
import { getMerchantConfig, MERCHANTS, type MerchantId } from "../core/merchants.js";
import { vietQrImageUrl } from "../core/vietQr.js";
import type { ShopeeReportImportResult } from "../core/shopeeReportImport.js";
import type { UserCommissionOverride } from "../core/userCommissionOverride.js";
import { SETTINGS_REGISTRY, type SettingFieldConfig } from "../config/settingsRegistry.js";
import { SETTINGS_KEYS } from "../core/settingsKeys.js";
import { FAQ_TOPICS } from "../core/faq/faqTopics.js";
import type {
  CommissionEntry,
  CommissionStatus,
  ImportHistoryEntry,
  Platform,
  WithdrawalRequest,
  ZaloGroup,
} from "../core/types.js";
import { dashboardStyles } from "./adminDashboardHtml.js";
import {
  confirmOnSubmit,
  copyIconButton,
  escapeHtml,
  formatDateTime,
  formatDateTimeParts,
  formatVnd,
  statusBadge,
  successToast,
  type BadgeTone,
} from "./htmlHelpers.js";

/**
 * Trang admin viet tay bang HTML thuan (khong dung templating lib, khong JS phia client),
 * cung convention voi dashboardHtml.ts (form POST thuan, redirect 303). Bo cuc "sidebar toi +
 * topbar + noi dung nen xam chua card trang" tham khao cau truc 1 template admin user cung
 * (2026-08-18) nhung mau sac/noi dung rieng cua du an - KHONG clone CSS/asset thuong mai.
 */

const NAV_ITEMS: Array<{ key: string; href: string; label: string; icon: keyof typeof ICON_PATHS }> = [
  { key: "dashboard", href: "/admin/dashboard", label: "Tổng quan", icon: "layout-dashboard" },
  { key: "withdrawals", href: "/admin/withdrawals", label: "Yêu cầu rút tiền", icon: "wallet" },
  { key: "users", href: "/admin/users", label: "Người dùng", icon: "users" },
  { key: "orders", href: "/admin/orders", label: "Đơn hàng", icon: "shopping-cart" },
  { key: "links", href: "/admin/links", label: "Link đã tạo", icon: "link" },
  { key: "record-orders", href: "/admin/record-orders", label: "Ghi nhận đơn hàng", icon: "file-plus" },
  { key: "settings", href: "/admin/settings", label: "Cấu hình", icon: "settings" },
];

/**
 * Icon ve bang SVG INLINE, khong tai thu vien icon qua CDN (2026-10-04).
 *
 * Design ref dung Lucide qua unpkg; khu /admin chi co DUNG MOT ngoai le CDN da duoc chap nhan la
 * Chart.js o /admin/dashboard, va o day khong co ly do gi de them cai thu hai: CDN hong thi ca
 * trang mat sach icon, con inline thi khong bao gio. Duong SVG lay theo hinh cua Lucide (giay phep
 * ISC). Them icon moi thi them 1 dong vao ICON_PATHS, dung tai them runtime icon.
 */
export const ICON_PATHS: Record<string, string> = {
  "layout-dashboard":
    '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  wallet:
    '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  "shopping-cart":
    '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  "file-plus":
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/><path d="M12 18v-6"/>',
  settings:
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  "log-out":
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  package:
    '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  coins:
    '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
  "trending-up": '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  percent: '<line x1="19" x2="5" y1="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  history:
    '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  "check-check": '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
  upload:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  "qr-code":
    '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>',
  "check-circle": '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  "edit-3": '<path d="M13 21h8"/><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  "file-up":
    '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M12 12v6"/><path d="m15 15-3-3-3 3"/>',
  "upload-cloud": '<path d="M12 13v8"/><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="m8 17 4-4 4 4"/>',
  "alert-circle": '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  inbox:
    '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  "plus-circle": '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  "refresh-cw":
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  "chevron-left": '<path d="m15 18-6-6 6-6"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "message-square": '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  sliders:
    '<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/><line x1="18" x2="22" y1="16" y2="16"/>',
  send:
    '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  bell:
    '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  save:
    '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
  bot:
    '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  link:
    '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  "external-link":
    '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  "x-circle": '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  "more-horizontal": '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  "message-circle":
    '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>',
};

/**
 * Icon luon la TRANG TRI -> aria-hidden, vi nghia da nam o chu ben canh (nhan muc nav, nhan the
 * KPI, nhan nut). Cho nao chi co icon ma khong co chu (nut copy, nut lui/tien trang) thi cho DO
 * phai tu mang aria-label - xem copyIconButton() va renderPagination().
 *
 * Class `icon-svg` mang `display:block` tu @layer base cua admin.css: khong co preflight nen SVG
 * inline van nam tren duong co chu va de lai khoang trong cua net xuoi ben duoi, lam icon lech so
 * voi chu canh no.
 */
export function icon(name: keyof typeof ICON_PATHS, extraClass = ""): string {
  const cls = extraClass ? `icon-svg ${extraClass}` : "icon-svg";
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

function shellStyles(): string {
  return `<style>
  /*
   * Bang mau cua khu /admin. 2026-10-04: chuyen sang thang slate + accent indigo theo design ref
   * cua user (truoc do la xam tim #1f2333 / #6a4fd8). Day la cho DUY NHAT khai bao mau cho 5 trang
   * CHUA lam lai (withdrawals, users, record-orders, settings) - sua o day la 5 trang do doi mau
   * theo ngay, khong phai sua tung trang. Gia tri lay dung thang mau Tailwind de khop voi utilities
   * dung trong vo trang va /admin/orders: slate-900/50/200/800/500/400, indigo-600.
   *
   * CO Y KHONG doi 3 cap mau trang thai (--success/--warning/--danger): chung dang duoc dung lam
   * mau cot trong chart cua /admin/dashboard va da qua kiem tra tuong phan/mu mau (xem muc
   * adminDashboardHtml.ts trong CLAUDE.md). Doi chung se phai validate lai ca bo 4 mau, trong khi
   * design ref chi doi mau NHAN (tim -> indigo) chu khong doi nghia mau nao.
   */
  :root {
    --sidebar-bg: #0f172a;
    --sidebar-text: #94a3b8;
    --sidebar-text-active: #ffffff;
    --sidebar-active-bg: #4f46e5;
    --accent: #4f46e5;
    --content-bg: #f8fafc;
    --card-bg: #ffffff;
    --card-border: #e2e8f0;
    --text: #1e293b;
    --text-muted: #64748b;
    --success: #16a34a;
    --success-soft: #e8f8ee;
    --warning: #b45309;
    --warning-soft: #fef3e2;
    --danger: #dc2626;
    --danger-soft: #fdeaea;
    /* Chu mo hon --text-muted, dung cho hang phu duoi gia tri chinh trong bang (gio/ngay, userId).
       Giu rieng mot bien de khong ha --text-muted (nhan cot, chu .muted) xuong duoi nguong doc duoc. */
    --text-faint: #94a3b8;
    /* Bong rat nhe cua card, lay dung tu design ref - khong phai bong "noi", chi de card tach khoi
       nen slate-50 them mot chut. Phong cach du an van la flat. */
    --card-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
  }
  * { box-sizing: border-box; }
  /* Inter dung TRUOC font he thong (2026-10-04, theo design ref) - tai qua Google Fonts trong
     adminShell(). Chuoi du phong phia sau giu nguyen font cu, nen Google Fonts bi chan thi trang
     ve dung hinh truoc day chu khong roi xuong serif. */
  body { margin: 0; font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: var(--content-bg); color: var(--text); -webkit-font-smoothing: antialiased; }
  /* .layout khoa dung 100vh + overflow hidden (2026-09-13, phan hoi truc tiep cua user: cuon
     trang dang keo ca sidebar cuon theo vi truoc day .layout chi co min-height nen cao ra theo
     noi dung, khien sidebar (stretch theo chieu cao .layout) dai ra va cuon cung trang) - sidebar
     va topbar giu nguyen cho, CHI .content (bang duoi) duoc cuon rieng qua overflow-y: auto. */
  .layout { display: flex; height: 100vh; overflow: hidden; }
  /* Sidebar la cot flex 3 phan: thuong hieu (cao co dinh) - nav (cuon duoc) - khoi tai khoan duoi
     cung. Phai la flex column, neu khong thi khoi tai khoan khong dinh duoc xuong day khi nav ngan. */
  .sidebar { width: 256px; flex-shrink: 0; background: var(--sidebar-bg); display: flex; flex-direction: column; }
  .sidebar .brand {
    height: 64px; flex-shrink: 0; display: flex; align-items: center; gap: 0.7rem;
    padding: 0 1.25rem; border-bottom: 1px solid #1e293b; white-space: nowrap; overflow: hidden;
  }
  /* O vuong bo goc mang chu dau - thay cho emoji 🛒 cu. Mot chu cai trong o mau nhan la cach lam
     logo an toan nhat khi du an chua co bo nhan dien: khong gia lam logo thuong hieu nao. */
  .sidebar .brand .brand-mark {
    width: 32px; height: 32px; flex-shrink: 0; border-radius: 8px; background: var(--accent);
    color: #fff; font-weight: 700; font-size: 1rem; display: flex; align-items: center; justify-content: center;
    box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.18);
  }
  .sidebar .brand .brand-text { min-width: 0; line-height: 1.2; }
  .sidebar .brand .brand-name { color: #fff; font-weight: 700; font-size: 0.95rem; }
  .sidebar .brand .brand-sub { color: var(--sidebar-text); font-size: 0.72rem; }
  .sidebar nav { flex: 1; min-height: 0; overflow-y: auto; padding: 0.75rem; }
  .sidebar nav a {
    display: flex; align-items: center; gap: 0.7rem; padding: 0.6rem 0.75rem; color: var(--sidebar-text);
    text-decoration: none; font-size: 0.87rem; font-weight: 500; border-radius: 8px; margin: 0.12rem 0; white-space: nowrap;
  }
  .sidebar nav a .icon { flex-shrink: 0; width: 1rem; height: 1rem; }
  .sidebar nav a:hover { color: #fff; background: rgba(30, 41, 59, 0.6); }
  .sidebar nav a.active { background: var(--sidebar-active-bg); color: var(--sidebar-text-active); font-weight: 600; }
  .sidebar nav a.active:hover { background: var(--sidebar-active-bg); }
  /* Dem so yeu cau rut dang cho, hien ngay tren muc nav. Mau cam = "co viec phai lam", dung mot
     vai mau voi the KPI "Chờ duyệt rút" o /admin/dashboard. An khi = 0 (xem adminShell) chu khong
     hien so 0: mot badge luon sang se thanh trang tri va nguoi dung thoi nhin no. */
  .sidebar nav a .nav-badge {
    margin-left: auto; flex-shrink: 0; background: rgba(245, 158, 11, 0.2); color: #fbbf24;
    font-size: 0.7rem; font-weight: 600; padding: 0.05rem 0.45rem; border-radius: 999px;
  }
  .sidebar nav a.active .nav-badge { background: rgba(255, 255, 255, 0.22); color: #fff; }
  .sidebar .sidebar-foot {
    flex-shrink: 0; border-top: 1px solid #1e293b; padding: 0.9rem 1rem;
    display: flex; align-items: center; gap: 0.7rem;
  }
  .sidebar .sidebar-foot .avatar {
    width: 36px; height: 36px; flex-shrink: 0; border-radius: 999px; background: #334155; color: #fff;
    font-size: 0.72rem; font-weight: 600; display: flex; align-items: center; justify-content: center;
    box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.3);
  }
  .sidebar .sidebar-foot .who { min-width: 0; font-size: 0.75rem; line-height: 1.3; }
  .sidebar .sidebar-foot .who .who-name { color: #fff; font-weight: 600; }
  /* Dong trang thai duoi sidebar: cham xanh + chu xanh (design ref 2026-10-04). Mau xanh o day la
     TRANG THAI PHIEN dang nhap, khong phai tien - khong dung --success de khoi lan voi cac so tien
     mau xanh trong bang. */
  .sidebar .sidebar-foot .who .who-sub {
    color: #34d399; font-size: 0.7rem; display: flex; align-items: center; gap: 0.35rem;
  }
  .sidebar .sidebar-foot .who .who-sub::before {
    content: ""; width: 0.375rem; height: 0.375rem; border-radius: 999px; background: currentColor; flex-shrink: 0;
  }
  .sidebar .sidebar-foot form { margin: 0 0 0 auto; }
  .sidebar .sidebar-foot button.logout {
    background: none; border: none; color: var(--sidebar-text); padding: 0.4rem;
    border-radius: 8px; cursor: pointer; display: flex; line-height: 0;
  }
  .sidebar .sidebar-foot button.logout svg { width: 1rem; height: 1rem; }
  .sidebar .sidebar-foot button.logout:hover { color: #fb7185; background: #1e293b; }
  .sidebar .sidebar-foot button.logout:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
  .topbar {
    background: #fff; border-bottom: 1px solid var(--card-border); padding: 0 1.75rem; height: 64px;
    display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-shrink: 0;
  }
  .topbar h1 { font-size: 0.9rem; margin: 0; font-weight: 600; }
  .topbar .topbar-left { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
  /* Duong dan "Trang chu / <ten trang>". Ten trang hien tai la <h1> (van la tieu de that cua trang,
     chi doi cho) nen cay tieu de khong doi; "Trang chu" la lien ket ve /admin/dashboard. */
  .topbar .crumbs { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; min-width: 0; }
  .topbar .crumbs a { color: var(--text-muted); text-decoration: none; white-space: nowrap; }
  .topbar .crumbs a:hover { color: var(--text); }
  .topbar .crumbs .sep { color: #cbd5e1; }
  .topbar form { margin: 0; }
  /* Cong tac an/hien menu tren mobile (checkbox hack thuan CSS, khong them JS) - #sidebar-toggle
     nam truoc .sidebar trong markup de :checked ~ .sidebar/.sidebar-backdrop hoat dong duoc. An
     hoan toan tren desktop, chi hien trong @media ben duoi. */
  .sidebar-toggle-input { display: none; }
  .sidebar-toggle-btn { display: none; }
  .sidebar-backdrop { display: none; }
  .content { padding: 1.75rem; overflow-y: auto; min-height: 0; }
  .card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 14px; padding: 1.25rem; margin-bottom: 1.25rem; box-shadow: var(--card-shadow); }
  .card h2 { font-size: 0.95rem; margin: 0 0 1rem; }
  .totals { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; }
  .totals .stat { flex: 1 1 160px; background: var(--content-bg); border: 1px solid var(--card-border); border-radius: 12px; padding: 0.85rem 1rem; }
  .stat .label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin-bottom: 0.3rem; }
  .stat .value { font-size: 1.2rem; font-weight: 700; }
  .stat.accent .value { color: var(--accent); }
  .stat.danger .value { color: var(--danger); }
  .payment-form { display: flex; gap: 0.75rem; align-items: flex-end; flex-wrap: wrap; }
  .payment-form label { display: block; font-size: 0.72rem; color: var(--text-muted); margin-bottom: 0.3rem; text-transform: uppercase; letter-spacing: 0.03em; }
  .payment-form input[type="text"], .payment-form select {
    padding: 0.45rem 0.6rem; border: 1px solid var(--card-border); border-radius: 8px; font-size: 0.85rem;
  }
  .table-scroll { overflow-x: auto; }
  /*
   * KHOANH TRONG '.card' (2026-10-04) - truoc day la selector 'table'/'thead th'/'tbody td' toan
   * cuc. BAT BUOC phai khoanh sau khi nap Tailwind: CSS trong the <style> nay KHONG nam trong
   * @layer nao, ma CSS khong layer thi THANG moi CSS co layer bat ke do dac hieu - tuc la
   * 'thead th { padding: ... }' se de bep 'class="px-4 py-3.5"' cua Tailwind, class co trong DOM ma
   * khong co tac dung nao (dung loai bay "hong cam" o W3/W4). Bang cua giao dien moi
   * (/admin/orders) KHONG nam trong '.card' nen khong bi cham toi.
   *
   * Moi bang cua 5 trang chua lam lai deu nam trong '.card' (da kiem: withdrawals, users,
   * record-orders x2, va '.chart-table' cua /admin/dashboard) nen chung trong y het truoc.
   * THEM bang moi vao mot trang cu thi phai de trong '.card', neu khong no se mat het dinh dang.
   */
  .card table { width: 100%; border-collapse: collapse; font-size: 0.85rem; white-space: nowrap; }
  .card thead th { text-align: left; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); padding: 0 0.6rem 0.6rem; border-bottom: 1px solid var(--card-border); }
  .card tbody td { padding: 0.7rem 0.6rem; border-bottom: 1px solid var(--card-border); vertical-align: top; }
  .card tbody tr:last-child td { border-bottom: none; }
  .muted { color: var(--text-muted); font-size: 0.78rem; }
  .empty { color: var(--text-muted); font-size: 0.9rem; padding: 1rem 0; text-align: center; }
  .badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 999px; font-size: 0.72rem; font-weight: 600; white-space: nowrap; }
  .cell-truncate { display: inline-block; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
  .summary-list { list-style: none; padding: 0; margin: 0.75rem 0; font-size: 0.85rem; }
  .summary-list li { padding: 0.3rem 0; border-bottom: 1px solid var(--card-border); }
  .summary-list li:last-child { border-bottom: none; }
  .toast {
    position: fixed; top: 1.25rem; right: 1.25rem; z-index: 1000;
    background: var(--success-soft); color: var(--success); padding: 0.85rem 1.25rem;
    border-radius: 10px; font-size: 0.88rem; font-weight: 600; box-shadow: 0 6px 20px rgba(0,0,0,0.15);
    animation: toast-fade 4s ease-in forwards;
  }
  @keyframes toast-fade {
    0% { opacity: 0; transform: translateY(-8px); }
    8% { opacity: 1; transform: translateY(0); }
    85% { opacity: 1; }
    100% { opacity: 0; transform: translateY(-8px); pointer-events: none; }
  }
  .badge-success { background: var(--success-soft); color: var(--success); }
  .badge-warning { background: var(--warning-soft); color: var(--warning); }
  .badge-danger { background: var(--danger-soft); color: var(--danger); }
  a.link { color: var(--accent); text-decoration: none; font-weight: 600; font-size: 0.82rem; }
  a.link:hover { text-decoration: underline; }
  button.primary, input[type="submit"].primary {
    background: var(--accent); color: #fff; border: none; border-radius: 8px;
    padding: 0.5rem 1rem; font-size: 0.85rem; font-weight: 600; cursor: pointer;
  }
  button.primary:hover { filter: brightness(1.08); }
  /* Nut pha huy (xoa uu dai % rieng) - PHAI khac nut "Luu" dung ngay tren cung trang, neu cung
     mau .primary thi rat de bam nham. Dung vien do + chu do thay vi nen do day: hanh dong nay
     khong phai hanh dong chinh cua trang. */
  button.danger {
    background: #fff; color: var(--danger); border: 1px solid var(--danger); border-radius: 8px;
    padding: 0.5rem 1rem; font-size: 0.85rem; font-weight: 600; cursor: pointer;
  }
  button.danger:hover { background: var(--danger-soft); }
  button.secondary {
    background: #fff; color: var(--text); border: 1px solid var(--card-border); border-radius: 8px;
    padding: 0.5rem 1rem; font-size: 0.85rem; font-weight: 600; cursor: pointer;
  }
  button.secondary:hover { background: var(--content-bg); }
  /* Hang nut hanh dong cua form (Luu / Xem truoc / Quay lai): khong co khoang cach thi cac nut dinh
     sat nhau. Khoi phu (vd "Bo khoa") tach khoi hang chinh bang duong ke + khoang trong, de khong bam nham. */
  .actions-row { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
  .form-secondary { margin-top: 1.5rem; padding-top: 1.25rem; border-top: 1px solid var(--card-border); }
  .filters { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 1.25rem; align-items: flex-end; }
  .filters label { display: block; font-size: 0.72rem; color: var(--text-muted); margin-bottom: 0.3rem; text-transform: uppercase; letter-spacing: 0.03em; }
  .filters select, .filters input[type="text"], .filters input[type="search"] {
    padding: 0.45rem 0.6rem; border: 1px solid var(--card-border); border-radius: 8px; font-size: 0.85rem; min-width: 140px;
  }
  .filters .search-input { min-width: 280px; }
  /* Dropdown chon nhieu gia tri (bo loc "Trang thai" o /admin/orders): <details> dong vai tro nut
     xo xuong, panel ben trong la danh sach checkbox. HTML khong co san multi-select dang dropdown
     (<select multiple> la o danh sach trai dai, phai giu Ctrl de chon) nen phai dung cach nay. */
  .dropdown-check { position: relative; display: inline-block; }
  /* Phai KHOP CHIEU CAO voi 3 o loc ben canh - chung dung utility Tailwind (text-xs + px-3 py-2 +
     rounded-lg + border-slate-200), con cai nay la <summary> nen khong dung chung class duoc. Moi
     con so duoi day la ban dich cua dung cac utility do: 0.75rem = text-xs, 0.5rem/0.75rem = py-2/px-3,
     line-height 1rem = leading cua text-xs. Doi mot ben thi phai doi ben kia, neu khong hang bo loc
     se co mot o cao hon ba o con lai. */
  .dropdown-check > summary {
    list-style: none; cursor: pointer; user-select: none;
    padding: 0.5rem 2rem 0.5rem 0.75rem; border: 1px solid var(--card-border); border-radius: 8px;
    font-size: 0.75rem; line-height: 1rem; min-width: 170px; background: #fff; color: #334155; position: relative;
  }
  .dropdown-check > summary::-webkit-details-marker { display: none; }
  .dropdown-check > summary::after {
    content: "▾"; position: absolute; right: 0.7rem; top: 50%; transform: translateY(-50%);
    color: var(--text-muted); font-size: 0.75rem;
  }
  .dropdown-check[open] > summary { border-color: var(--accent); }
  .dropdown-panel {
    position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; min-width: 100%; white-space: nowrap;
    background: #fff; border: 1px solid var(--card-border); border-radius: 10px; padding: 0.35rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  }
  .dropdown-panel label {
    display: flex; align-items: center; gap: 0.5rem; margin: 0; padding: 0.4rem 0.5rem; border-radius: 6px;
    font-size: 0.85rem; text-transform: none; letter-spacing: normal; color: var(--text); cursor: pointer;
  }
  .dropdown-panel label:hover { background: var(--content-bg); }
  .dropdown-panel input[type="checkbox"] { margin: 0; cursor: pointer; }
  .pagination { display: flex; gap: 0.35rem; flex-wrap: wrap; align-items: center; margin-top: 1.1rem; }
  .pagination a, .pagination span {
    display: inline-flex; align-items: center; justify-content: center; min-width: 34px;
    text-align: center; padding: 0.35rem 0.6rem;
    border: 1px solid var(--card-border); border-radius: 8px; font-size: 0.82rem; font-weight: 600;
    color: var(--accent); text-decoration: none;
  }
  /* Nut lui/tien la icon SVG (xem renderPagination) - khong co font-size nao chi phoi kich thuoc no. */
  .pagination a svg, .pagination span svg { width: 0.85rem; height: 0.85rem; }
  .pagination a:hover { background: var(--content-bg); }
  .pagination .current { background: var(--accent); border-color: var(--accent); color: #fff; }
  .pagination .disabled, .pagination .gap { color: var(--text-muted); border-color: transparent; font-weight: 400; }
  .error { background: var(--danger-soft); color: var(--danger); padding: 0.85rem 1rem; border-radius: 12px; margin-bottom: 1.25rem; font-size: 0.9rem; }
  .success { background: var(--success-soft); color: var(--success); padding: 0.85rem 1rem; border-radius: 12px; margin-bottom: 1.25rem; font-size: 0.9rem; }
  .login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--content-bg); }
  .login-card { background: #fff; border: 1px solid var(--card-border); border-radius: 14px; padding: 2rem; width: 320px; box-shadow: var(--card-shadow); }
  .login-card h1 { font-size: 1.15rem; margin: 0 0 1.25rem; }
  /* Thuong hieu tren man dang nhap: dung lai .brand-mark cua sidebar nen o vuong chu "S" giong het
     2 noi - doi mau nhan thi ca 2 doi theo. */
  .login-brand { display: flex; align-items: center; gap: 0.7rem; margin-bottom: 1.5rem; }
  .login-brand .brand-mark {
    width: 36px; height: 36px; flex-shrink: 0; border-radius: 9px; background: var(--accent);
    color: #fff; font-weight: 700; font-size: 1.05rem; display: flex; align-items: center; justify-content: center;
  }
  .login-brand-name { font-weight: 700; font-size: 1rem; line-height: 1.2; }
  .login-brand-sub { color: var(--text-muted); font-size: 0.75rem; }
  .login-card input[type="password"] {
    width: 100%; padding: 0.6rem 0.75rem; border: 1px solid var(--card-border); border-radius: 8px; font-size: 0.9rem; margin-bottom: 1rem;
  }
  .login-card button { width: 100%; }
  textarea {
    width: 100%; min-height: 90px; padding: 0.6rem 0.75rem; border: 1px solid var(--card-border);
    border-radius: 8px; font-size: 0.88rem; font-family: inherit; margin-bottom: 1rem; resize: vertical;
  }
  .settings-form { display: flex; flex-direction: column; max-width: 720px; }
  .settings-form .field { padding: 1.15rem 0; }
  .settings-form .field:first-child { padding-top: 0; }
  .settings-form .field + .field { border-top: 1px solid var(--card-border); }
  .settings-form label { display: block; font-size: 0.85rem; font-weight: 600; color: var(--text); margin-bottom: 0.55rem; }
  .settings-form input[type="number"] {
    width: 220px; padding: 0.55rem 0.7rem; border: 1px solid var(--card-border); border-radius: 8px; font-size: 0.9rem;
  }
  .settings-form textarea { min-height: 130px; line-height: 1.55; margin-bottom: 0.5rem; }
  .settings-form .help { font-size: 0.78rem; color: var(--text-muted); margin: 0.4rem 0 0; line-height: 1.5; }
  .settings-form .actions { padding-top: 1.35rem; }
  .group-choice { display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0; font-size: 0.85rem; }
  .group-choice + .group-choice { border-top: 1px solid var(--card-border); }
  .group-choice .group-name { font-weight: 600; color: var(--text); }
  .group-choice .group-id { font-size: 0.75rem; color: var(--text-muted); font-family: ui-monospace, monospace; }

  /* Responsive (2026-08-21, phan hoi truc tiep cua user sau khi test tren mobile that - ban dau
     tung doi sidebar thanh thanh nav ngang o tren, nhung user muon menu VAN nam ben trai, chi thu
     gon con icon mac dinh + co nut bam de mo/dong, khong phai chuyen len tren). Duoi 768px: sidebar
     mac dinh thu gon con 1 "rail" chi hien icon (khong chiem nhieu cho ngang man hinh hep). Nut
     hamburger trong topbar (label cho #sidebar-toggle) mo rong sidebar thanh drawer de len tren noi
     dung (position: fixed) kem lop nen mo (.sidebar-backdrop, cung la 1 label) - bam ra ngoai drawer
     se tu dong dong lai. Thuan CSS (checkbox hack), khong can JS - trang nay von khong dung JS phia
     client ngoai vai onclick/onsubmit inline co san (confirmOnSubmit, copyButton). */
  @media (max-width: 768px) {
    .sidebar-toggle-btn {
      display: inline-flex; align-items: center; justify-content: center; width: 2.25rem; height: 2.25rem;
      border: 1px solid var(--card-border); border-radius: 8px; font-size: 1.1rem; cursor: pointer; flex-shrink: 0;
    }
    .sidebar-toggle-btn:hover { background: var(--content-bg); }
    .topbar { padding: 0 0.85rem; height: 56px; gap: 0.5rem; }
    .topbar-left { flex: 1; min-width: 0; }
    .topbar h1 { font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    /* Bo "Trang chủ /" tren man hep: duong dan 2 cap an het cho cua ten trang, ma nut ☰ ngay ben
       canh da la duong ve menu. Giu ca the <h1> nen cay tieu de khong doi. */
    .topbar .crumbs .crumb-home, .topbar .crumbs .sep { display: none; }
    .content { padding: 1rem; }

    .sidebar { width: 56px; overflow: hidden; transition: width 0.18s ease; }
    .sidebar .brand { padding: 0; justify-content: center; }
    .sidebar .brand .brand-text { display: none; }
    .sidebar nav { padding: 0.5rem; }
    .sidebar nav a { justify-content: center; padding: 0.6rem 0; }
    .sidebar nav a .label { display: none; }
    /* Badge bi an cung label: o che do rail chi con icon, mot con so lo lung canh icon khong noi
       len no dem cai gi. */
    .sidebar nav a .nav-badge { display: none; }
    /* Che do rail giu lai HANH DONG (dang xuat) va bo phan trang tri (avatar, ten) - 56px khong du
       cho ca hai, va avatar thi khong bam duoc de lam gi. */
    .sidebar .sidebar-foot { padding: 0.75rem 0; justify-content: center; }
    .sidebar .sidebar-foot .avatar, .sidebar .sidebar-foot .who { display: none; }
    .sidebar .sidebar-foot form { margin: 0; }

    .sidebar-toggle-input:checked ~ .layout .sidebar {
      width: 256px; position: fixed; top: 0; left: 0; bottom: 0; z-index: 50;
      box-shadow: 4px 0 20px rgba(0, 0, 0, 0.28);
    }
    .sidebar-toggle-input:checked ~ .layout .sidebar .brand { justify-content: flex-start; padding: 0 1.25rem; }
    .sidebar-toggle-input:checked ~ .layout .sidebar .brand .brand-text { display: block; }
    .sidebar-toggle-input:checked ~ .layout .sidebar nav { padding: 0.75rem; }
    .sidebar-toggle-input:checked ~ .layout .sidebar nav a { justify-content: flex-start; padding: 0.6rem 0.75rem; }
    .sidebar-toggle-input:checked ~ .layout .sidebar nav a .label { display: inline; }
    .sidebar-toggle-input:checked ~ .layout .sidebar nav a .nav-badge { display: inline; }
    .sidebar-toggle-input:checked ~ .layout .sidebar .sidebar-foot { padding: 0.9rem 1rem; justify-content: flex-start; }
    .sidebar-toggle-input:checked ~ .layout .sidebar .sidebar-foot .avatar,
    .sidebar-toggle-input:checked ~ .layout .sidebar .sidebar-foot .who { display: flex; }
    .sidebar-toggle-input:checked ~ .layout .sidebar .sidebar-foot .who { display: block; }
    .sidebar-toggle-input:checked ~ .layout .sidebar .sidebar-foot form { margin: 0 0 0 auto; }
    .sidebar-toggle-input:checked ~ .sidebar-backdrop {
      display: block; position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5); z-index: 45; cursor: pointer;
    }

    .payment-form, .filters { flex-direction: column; align-items: stretch; }
    .payment-form > div, .filters > div { width: 100%; }
    .payment-form input[type="text"], .payment-form select,
    .filters input[type="text"], .filters select { width: 100%; min-width: 0; }
    .settings-form { max-width: 100%; }
    .settings-form input[type="number"] { width: 100%; }
    .totals .stat { flex: 1 1 100%; }

    /* Giao dien moi tren man hep: the KPI ve 1 cot, thanh bo loc thanh cot doc va moi o keo het
       chieu ngang (giong .filters/.payment-form ngay tren). O tim bo min-width de khong keo trang
       rong ra - .toolbar nam trong .content vua du 1 man. Bang van cuon ngang trong .table-scroll:
       9 cot tien/trang thai khong the nhoi vao 375px, va cuon ngang TRONG bang (khong phai ca
       trang) la hanh vi dung. */
    .kpi-row { grid-template-columns: 1fr; gap: 0.75rem; }
    .toolbar { flex-direction: column; align-items: stretch; }
    .toolbar .toolbar-fields { flex-direction: column; align-items: stretch; }
    .toolbar .toolbar-fields > div { width: 100%; }
    .toolbar select, .toolbar input[type="search"] { width: 100%; min-width: 0; }
    .search-field input[type="search"] { min-width: 0; }
    .toolbar .dropdown-check, .toolbar .dropdown-check > summary { width: 100%; min-width: 0; }
    .toolbar .toolbar-actions button { width: 100%; }
    .data-footer { flex-direction: column; align-items: flex-start; }

    /* Safari tren iOS TU PHONG TO ca trang khi focus vao o nhap co font duoi 16px, va khong bao gio
       thu lai - ep 16px o man hep de chan. Trang nay co <meta user-scalable=no> nen hien tai chua
       bi, nhung do la cach chan te hon (no khoa luon thao tac phong to bang 2 ngon cua nguoi dung),
       nen khong dua vao no. !important la can that: phai thang duoc utility font-size cua Tailwind
       (text-xs) dat truc tiep tren tung o loc. */
    input, textarea, select { font-size: 16px !important; }
  }
${dashboardStyles()}
</style>`;
}

/**
 * Phan <head> dung chung: font Inter + file CSS cua Tailwind.
 *
 * admin.css duoc sinh ra boi 'npm run build:css' (xem src/api/styles/admin.css) va serve boi route
 * GET /admin/assets/admin.css trong server.ts. Dat TRUOC 'shellStyles()' co chu dich: CSS tay trong
 * shellStyles la phan rieng cua du an, phai thang duoc utilities khi hai ben noi ve cung mot thuoc
 * tinh (vd .card da co bo goc/vien rieng).
 */
function headAssets(): string {
  return `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${adminCssHref()}">
${shellStyles()}`;
}

/**
 * Vo trang dung chung cho ca 6 trang /admin.
 *
 * `pendingWithdrawals` (tuy chon) hien thanh badge tren muc nav "Yeu cau rut tien". De `undefined`
 * hoac 0 thi KHONG hien gi - badge luon sang se thanh trang tri, va day la con so duy nhat trong
 * nav co nghia "co viec phai lam ngay" (tien user dang cho chu bot chuyen).
 */
export function adminShell(
  activeNav: string,
  pageTitle: string,
  bodyHtml: string,
  pendingWithdrawals?: number
): string {
  const navLinks = NAV_ITEMS.map((item) => {
    const badge =
      item.key === "withdrawals" && pendingWithdrawals && pendingWithdrawals > 0
        ? `<span class="nav-badge">${pendingWithdrawals}</span>`
        : "";
    return `<a href="${item.href}" class="${item.key === activeNav ? "active" : ""}"${
      item.key === activeNav ? ' aria-current="page"' : ""
    }><span class="icon">${icon(item.icon)}</span><span class="label">${item.label}</span>${badge}</a>`;
  }).join("\n");

  // #sidebar-toggle + .sidebar-backdrop nam TRUOC .layout, cung cap voi no trong <body> - can thiet
  // de CSS ":checked ~ .layout .sidebar" va ":checked ~ .sidebar-backdrop" trong shellStyles() hoat
  // dong (checkbox hack thuan CSS cho menu mobile, xem chi tiet trong khoi @media cua shellStyles()).
  //
  // Khoi tai khoan duoi sidebar CO Y khong hien email: he thong chi co 1 mat khau ADMIN_PASSWORD,
  // khong co tai khoan/email nao ca (xem adminAuth.ts). Design ref co dong "admin@sanhoantien.up"
  // nhung bay ra mot email khong ton tai la bia du lieu ngay trong giao dien van hanh.
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>${pageTitle} — Admin</title>
${headAssets()}
</head>
<body>
<input type="checkbox" id="sidebar-toggle" class="sidebar-toggle-input">
<label for="sidebar-toggle" class="sidebar-backdrop" aria-hidden="true"></label>
<div class="layout">
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark" aria-hidden="true">S</div>
      <div class="brand-text">
        <div class="brand-name">Sàn Hoàn Tiền</div>
        <div class="brand-sub">Admin Console</div>
      </div>
    </div>
    <nav aria-label="Menu quản trị">${navLinks}</nav>
    <div class="sidebar-foot">
      <div class="avatar" aria-hidden="true">AD</div>
      <div class="who">
        <div class="who-name">Chủ bot</div>
        <div class="who-sub">Đã đăng nhập</div>
      </div>
      <form method="POST" action="/admin/logout">
        <button type="submit" class="logout" title="Đăng xuất" aria-label="Đăng xuất">${icon("log-out")}</button>
      </form>
    </div>
  </aside>
  <div class="main">
    <div class="topbar">
      <div class="topbar-left">
        <label for="sidebar-toggle" class="sidebar-toggle-btn" aria-label="Mở/đóng menu">☰</label>
        <nav class="crumbs" aria-label="Đường dẫn">
          <a class="crumb-home" href="/admin/dashboard">Trang chủ</a>
          <span class="sep" aria-hidden="true">/</span>
          <h1>${pageTitle}</h1>
        </nav>
      </div>
    </div>
    <div class="content">${bodyHtml}</div>
  </div>
</div>
</body>
</html>`;
}

export function renderAdminLoginPage(errorMessage?: string): string {
  const errorBlock = errorMessage ? `<div class="error">${escapeHtml(errorMessage)}</div>` : "";
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>Đăng nhập Admin</title>
${headAssets()}
</head>
<body>
<div class="login-wrap">
  <div class="login-card">
    <div class="login-brand">
      <div class="brand-mark" aria-hidden="true">S</div>
      <div>
        <div class="login-brand-name">Sàn Hoàn Tiền</div>
        <div class="login-brand-sub">Admin Console</div>
      </div>
    </div>
    ${errorBlock}
    <form method="POST" action="/admin/login">
      <input type="password" name="password" placeholder="Mật khẩu admin" autofocus>
      <button type="submit" class="primary">Đăng nhập</button>
    </form>
  </div>
</div>
</body>
</html>`;
}

/** Key dung chung de tra ten trong displayNames map, phai khop voi LedgerStore.getDisplayNamesMap(). */
export function nameKey(platform: string, userId: string): string {
  return `${platform}:${userId}`;
}

export function nameCell(name: string | null | undefined): string {
  return name ? escapeHtml(name) : `<span class="muted">—</span>`;
}

export function renderWithdrawalsPage(
  pending: WithdrawalRequest[],
  paidHistory: WithdrawalRequest[],
  displayNames: Map<string, string>,
  errorMessage?: string | null,
  cancelledHistory: WithdrawalRequest[] = []
): string {
  const errorBlock = errorMessage
    ? `<div class="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">${escapeHtml(
        errorMessage
      )}</div>`
    : "";

  // Ca 2 the KPI dem so tien THAT di qua ngan hang (amount = so phai chuyen, da tru no) - day la
  // con so admin can de biet phai chuan bi bao nhieu tien, khong phai tong user yeu cau.
  const pendingTotal = pending.reduce((sum, w) => sum + w.amount, 0);
  const paidTotal = paidHistory.reduce((sum, w) => sum + w.amount, 0);

  /**
   * O so tien (mo hinh no 2026-10-08, yeu cau truc tiep cua user): yeu cau co tru no thi PHAI hien du
   * 3 so - user rut bao nhieu, dang no bao nhieu, va so cuoi cung admin phai chuyen (QR cung tao theo
   * so nay). Chi hien 1 so thi admin khong doi chieu duoc voi con so user thay tren dashboard.
   * amount = 0 la yeu cau TU DONG xac nhan (rut <= no): khong co dong nao chuyen.
   */
  const amountCell = (w: WithdrawalRequest, struck = false): string => {
    const main = struck
      ? "text-base font-bold tabular-nums text-slate-400 line-through"
      : "text-base font-bold tabular-nums text-slate-900";
    if (w.debtApplied <= 0) return `<div class="${main}">${formatVnd(w.amount)}</div>`;
    return `<div class="inline-grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
      <span class="text-left text-slate-500">Rút</span><span class="text-slate-700">${formatVnd(w.amount + w.debtApplied)}</span>
      <span class="text-left text-slate-500">Trừ nợ</span><span class="text-rose-600">−${formatVnd(w.debtApplied)}</span>
    </div>
    <div class="mt-1 border-t border-slate-200 pt-1">
      ${
        w.amount > 0
          ? `<div class="text-[10px] uppercase tracking-wide text-slate-400">Phải chuyển</div><div class="${main}">${formatVnd(w.amount)}</div>`
          : `<div class="text-[11px] font-semibold text-slate-500">Tự trừ nợ, không chuyển</div>`
      }
    </div>`;
  };

  const kpiRow = kpiGrid(
    [
      kpiCard({
        label: "Yêu cầu đang chờ thanh toán",
        value: formatVnd(pendingTotal),
        note: `${pending.length} yêu cầu đang chờ xử lý`,
        icon: "clock",
        valueClass: "text-slate-900",
        iconClass: "bg-amber-100 text-amber-700",
        tone: "alert",
      }),
      kpiCard({
        label: "Đã chi trả thành công",
        value: formatVnd(paidTotal),
        note: `${paidHistory.length} giao dịch hoàn tất`,
        icon: "check-check",
        valueClass: "text-slate-800",
        iconClass: "bg-emerald-50 text-emerald-600",
      }),
    ],
    2
  );

  /** O "Thoi gian & Kenh" - dung chung cho ca 2 bang. */
  const whenCell = (iso: string | null): string => {
    if (!iso) return `<span class="text-slate-400">—</span>`;
    const when = formatDateTimeParts(iso);
    return `<div class="font-medium tabular-nums text-slate-800">${escapeHtml(when.time)}</div>
      <div class="text-[11px] tabular-nums text-slate-400">${escapeHtml(when.date)}</div>`;
  };

  /** O "Nguoi nhan" - ten + userId co nut copy. */
  const whoCell = (w: WithdrawalRequest): string => {
    const name = displayNames.get(nameKey(w.platform, w.userId));
    return `<div class="font-semibold text-slate-800">${
      name ? escapeHtml(name) : `<span class="font-medium italic text-slate-400">Chưa đặt tên</span>`
    }</div>
    <div class="mt-0.5 flex items-center gap-1 font-mono text-[11px] text-slate-400">
      ${escapeHtml(w.userId)}
      ${copyIconButton(w.userId, `Sao chép User ID ${w.userId}`)}
    </div>`;
  };

  const rows = pending
    .map((w) => {
      const who = displayNames.get(nameKey(w.platform, w.userId)) ?? `${w.platform}/${w.userId}`;
      const confirmMsg = `Xác nhận ĐÃ CHUYỂN KHOẢN ${formatVnd(w.amount)} cho ${who}? Hành động này không thể hoàn tác.`;

      // Ma QR chuyen khoan. `null` = ngan hang chua co ma hoac VietQR bao khong ho tro chuyen khoan
      // -> KHONG hien nut, tot hon la hien mot ma quet khong ra. Xem src/core/vietQr.ts.
      const qrUrl = vietQrImageUrl({
        bankName: w.bankName,
        accountNumber: w.bankAccountNumber,
        accountHolder: w.bankAccountHolder,
        amount: w.amount,
        // KHONG truyen noi dung chuyen khoan (yeu cau user 2026-10-08): de trong cho app ngan hang tu
        // lay noi dung mac dinh.
      });
      // <details> dong san CO CHU DICH: anh QR tai tu img.vietqr.io, de <img> hien luon thi mo trang
      // co 50 yeu cau la gui du lieu ngan hang cua 50 khach sang ben thu ba du admin khong nhin cai nao.
      // Anh QR mo GIAN TAI CHO (day cao hang bang) chu khong phai panel noi de tuyet doi nhu design
      // ref. Bat buoc phai vay: bang nam trong .table-scroll (overflow-x: auto de cuon ngang tren
      // man hep), ma mot phan tu position:absolute KHONG THE thoat ra khoi vung cuon do - da thu,
      // panel bi cat mat nua duoi. Doi lai, mo QR lam hang cao them mot chut, chap nhan duoc.
      const qrBlock = qrUrl
        ? `<details class="qr-pop mt-2 border-t border-slate-200/80 pt-2">
            <summary class="inline-flex cursor-pointer list-none items-center gap-1 rounded text-[10px] font-semibold text-indigo-600 hover:underline">
              ${icon("qr-code", "h-3 w-3")} QR Pay
            </summary>
            <img src="${escapeHtml(qrUrl)}" alt="Mã QR chuyển khoản ${escapeHtml(
              w.bankName
            )}" width="200" height="237" loading="lazy" class="mt-2 block h-auto w-[200px] rounded border border-slate-200 bg-white">
            <div class="mt-1 w-[200px] text-center text-[10px] leading-snug text-slate-400">Ảnh QR tải từ img.vietqr.io</div>
          </details>`
        : `<div class="mt-2 border-t border-slate-200/80 pt-2 text-[10px] text-slate-400" title="VietQR không hỗ trợ chuyển khoản tới ngân hàng này">Ngân hàng này không tạo được QR</div>`;

      const bankBlock = `<div class="inline-block min-w-[210px] rounded-lg border border-slate-200/80 bg-slate-50 p-2.5">
        <div class="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">${escapeHtml(
          w.bankName
        )}</div>
        <div class="mt-0.5 flex items-center justify-between gap-2 font-mono text-sm font-bold text-slate-900">
          <span>${escapeHtml(w.bankAccountNumber)}</span>
          ${copyIconButton(w.bankAccountNumber, `Sao chép số tài khoản ${w.bankAccountNumber}`)}
        </div>
        <div class="text-[11px] font-medium uppercase text-slate-500">${escapeHtml(w.bankAccountHolder)}</div>
        ${qrBlock}
      </div>`;

      // <form> nam NGOAI bang (xem payForms ben duoi) va 2 control tro vao no qua thuoc tinh `form`:
      // mot <form> khong the boc 2 <td> roi nhau, ma thiet ke nay dat o chon file va nut gui o 2 cot
      // khac nhau. Day la cach hop le duy nhat de giu nguyen bo cuc.
      const formId = `pay-${w.id}`;

      return `<tr class="transition hover:bg-slate-50/80" data-search="${escapeHtml(
        `${displayNames.get(nameKey(w.platform, w.userId)) ?? ""} ${w.userId} ${w.bankAccountNumber} ${
          w.bankAccountHolder
        } ${w.bankName}`.toLowerCase()
      )}">
  <td class="px-6 py-4 align-top">
    ${whenCell(w.createdAt)}
    <div class="mt-1">${platformChip(w.platform)}</div>
  </td>
  <td class="px-6 py-4 align-top">${whoCell(w)}</td>
  <td class="px-6 py-4 align-top">${bankBlock}</td>
  <td class="px-6 py-4 text-right align-top">${amountCell(w)}</td>
  <td class="px-6 py-4 align-top">
    <!-- Boc trong span RELATIVE la bat buoc, dung bo: o chon file duoc an bang .sr-only (position:
         absolute). Khong co to tien nao position:relative thi khoi bao cua no la ca trang, nen no
         THOAT khoi vung cat cua .table-scroll va neo o vi tri tinh giua long bang rong ~1100px ->
         keo ca trang cuon ngang 570px tren mobile (bug that, do duoc o 375px). -->
    <span class="relative inline-block">
      <label for="proofImage-${w.id}" class="group inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-slate-600 transition hover:border-indigo-400 hover:bg-indigo-50/30">
        ${icon("upload", "h-3.5 w-3.5 text-slate-400 group-hover:text-indigo-600")}
        <span class="text-[11px] font-medium" data-proof-label>Đính kèm bill</span>
      </label>
      <input type="file" id="proofImage-${w.id}" name="proofImage" accept="image/*" form="${formId}" class="sr-only" data-proof-input>
    </span>
  </td>
  <td class="px-6 py-4 text-right align-top">
    <button type="submit" form="${formId}" class="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
      ${icon("check", "h-3.5 w-3.5")} Đánh dấu đã trả
    </button>
  </td>
</tr>`;
    })
    .join("\n");

  // Cac <form> that, dat ngoai <table>: trinh duyet khong cho <form> lam con truc tiep cua <tr>, no
  // se bi day ra khoi bang luc phan tich HTML va mat action/enctype.
  const payForms = pending
    .map((w) => {
      const who = displayNames.get(nameKey(w.platform, w.userId)) ?? `${w.platform}/${w.userId}`;
      const confirmMsg = `Xác nhận ĐÃ CHUYỂN KHOẢN ${formatVnd(w.amount)} cho ${who}? Hành động này không thể hoàn tác.`;
      return `<form id="pay-${w.id}" method="POST" action="/admin/withdrawals/${w.id}/mark-paid" enctype="multipart/form-data" ${confirmOnSubmit(
        confirmMsg
      )} hidden></form>`;
    })
    .join("\n");

  const historyRows = paidHistory
    .map((w) => {
      const proofLink = w.amount === 0 && w.debtApplied > 0
        ? `<span class="text-[11px] text-slate-400">Tự động (trừ nợ)</span>`
        : w.proofImagePath
        ? `<a class="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 no-underline hover:underline" href="/admin/withdrawal-proofs/${encodeURIComponent(
            w.proofImagePath
          )}" target="_blank" rel="noopener">Xem ảnh</a>`
        : `<span class="text-slate-400">—</span>`;
      return `<tr class="transition hover:bg-slate-50/80" data-search="${escapeHtml(
        `${displayNames.get(nameKey(w.platform, w.userId)) ?? ""} ${w.userId} ${w.bankAccountNumber} ${
          w.bankAccountHolder
        } ${w.bankName}`.toLowerCase()
      )}">
  <td class="px-6 py-4 align-top">
    ${whenCell(w.paidAt)}
    <div class="mt-1">${platformChip(w.platform)}</div>
  </td>
  <td class="px-6 py-4 align-top">${whoCell(w)}</td>
  <td class="px-6 py-4 align-top">
    <div class="text-[11px] font-semibold uppercase tracking-wide text-slate-600">${escapeHtml(w.bankName)}</div>
    <div class="font-mono text-xs text-slate-500">${escapeHtml(w.bankAccountNumber)}</div>
  </td>
  <td class="px-6 py-4 text-right align-top">${amountCell(w)}</td>
  <td class="px-6 py-4 align-top">${proofLink}</td>
</tr>`;
    })
    .join("\n");

  const thClass = "px-6 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500";

  const pendingPanel =
    pending.length > 0
      ? `<div class="table-scroll">
  <table class="w-full border-collapse whitespace-nowrap text-xs">
    <thead class="border-b border-slate-200 bg-slate-50">
      <tr>
        <th class="${thClass}">Thời gian &amp; kênh</th>
        <th class="${thClass}">Người nhận</th>
        <th class="${thClass}">Tài khoản thụ hưởng</th>
        <th class="${thClass} !text-right">Số tiền</th>
        <th class="${thClass}">Ảnh chứng từ (tuỳ chọn)</th>
        <th class="${thClass} !text-right">Thao tác</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-slate-100">${rows}</tbody>
  </table>
</div>
${payForms}`
      : `<div class="px-5 py-14 text-center">
  <div class="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">${icon(
    "check-check",
    "h-5 w-5"
  )}</div>
  <div class="mb-1 text-sm font-semibold text-slate-700">Không có yêu cầu nào đang chờ</div>
  <p class="m-0 text-xs text-slate-500">Mọi yêu cầu rút tiền đã được xử lý xong.</p>
</div>`;

  const historyPanel =
    paidHistory.length > 0
      ? `<div class="table-scroll">
  <table class="w-full border-collapse whitespace-nowrap text-xs">
    <thead class="border-b border-slate-200 bg-slate-50">
      <tr>
        <th class="${thClass}">Thời gian trả &amp; kênh</th>
        <th class="${thClass}">Người nhận</th>
        <th class="${thClass}">Tài khoản nhận</th>
        <th class="${thClass} !text-right">Số tiền</th>
        <th class="${thClass}">Bằng chứng</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-slate-100">${historyRows}</tbody>
  </table>
</div>`
      : `<div class="px-5 py-14 text-center">
  <div class="mb-1 text-sm font-semibold text-slate-700">Chưa có yêu cầu nào được đánh dấu đã trả</div>
  <p class="m-0 text-xs text-slate-500">Sau khi bạn chuyển khoản và bấm "Đánh dấu đã trả", giao dịch sẽ nằm ở đây.</p>
</div>`;

  // Tab thu 3 CHI hien khi that su co yeu cau da huy (2026-10-08): day la truong hop hiem, bay mot tab
  // rong tren moi lan vao trang la them nhieu cho mat.
  const cancelledRows = cancelledHistory
    .map(
      (w) => `<tr class="transition hover:bg-slate-50/80" data-search="${escapeHtml(
        `${displayNames.get(nameKey(w.platform, w.userId)) ?? ""} ${w.userId} ${w.bankAccountNumber} ${
          w.bankAccountHolder
        } ${w.bankName}`.toLowerCase()
      )}">
  <td class="px-6 py-4 align-top">
    ${whenCell(w.cancelledAt)}
    <div class="mt-1">${platformChip(w.platform)}</div>
  </td>
  <td class="px-6 py-4 align-top">${whoCell(w)}</td>
  <td class="px-6 py-4 text-right align-top">
    <!-- Gach ngang + lam mo: so that de doi soat, nhung de kieu thuong thi hang nay doc ra thanh
         "da tra cho khach" - tien nay khong ai nhan ca. Cung quy tac voi don reversed o /admin/orders. -->
    ${amountCell(w, true)}
  </td>
  <td class="px-6 py-4 align-top text-xs text-slate-500">${
    w.cancelReason ? escapeHtml(w.cancelReason) : `<span class="text-slate-400">—</span>`
  }</td>
</tr>`
    )
    .join("\n");

  const cancelledPanel = `<div class="table-scroll">
  <table class="w-full border-collapse whitespace-nowrap text-xs">
    <thead class="border-b border-slate-200 bg-slate-50">
      <tr>
        <th class="${thClass}">Thời gian huỷ &amp; kênh</th>
        <th class="${thClass}">Người nhận</th>
        <th class="${thClass} !text-right">Số tiền (đã huỷ)</th>
        <th class="${thClass}">Lí do</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-slate-100">${cancelledRows}</tbody>
  </table>
</div>`;

  const tabBtn = (target: string, active: boolean, iconName: keyof typeof ICON_PATHS, label: string, count: number, countTone: string) =>
    `<button type="button" role="tab" aria-selected="${active}" aria-controls="panel-${target}" data-tab="${target}"
      class="-mb-px flex items-center gap-2 border-b-2 py-4 text-xs transition ${
        active
          ? "border-indigo-600 font-bold text-indigo-600"
          : "border-transparent font-medium text-slate-500 hover:border-slate-300 hover:text-slate-800"
      }">
      ${icon(iconName, "h-4 w-4")} ${label}
      <span class="rounded-full px-2 py-0.5 text-[10px] font-bold ${countTone}">${count}</span>
    </button>`;

  const fieldClass =
    "w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 " +
    "transition outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20";

  // Tabs + tim kiem + nhan ten file da chon. Tat ca client-side, khong reload.
  // Logic duoc test qua src/api/__tests__/withdrawalsPageScript.test.ts (chay script tren DOM gia).
  const pageScript = `<script>
(function () {
  var tabs = Array.prototype.slice.call(document.querySelectorAll("[data-tab]"));
  var panels = Array.prototype.slice.call(document.querySelectorAll("[data-panel]"));
  function show(name) {
    tabs.forEach(function (t) {
      var on = t.dataset.tab === name;
      t.setAttribute("aria-selected", String(on));
      t.className = t.className
        .replace(/border-indigo-600|border-transparent/, on ? "border-indigo-600" : "border-transparent")
        .replace(/font-bold|font-medium/, on ? "font-bold" : "font-medium")
        .replace(/text-indigo-600|text-slate-500/, on ? "text-indigo-600" : "text-slate-500");
    });
    panels.forEach(function (p) { p.hidden = p.dataset.panel !== name; });
  }
  tabs.forEach(function (t) { t.addEventListener("click", function () { show(t.dataset.tab); }); });

  // O tim loc CA HAI bang cung luc, nen doi tab van giu nguyen tu khoa dang go.
  var input = document.getElementById("withdrawal-search");
  if (input) {
    var rows = Array.prototype.slice.call(document.querySelectorAll("[data-panel] tbody tr"));
    input.addEventListener("input", function () {
      var q = input.value.trim().toLowerCase();
      rows.forEach(function (row) {
        row.hidden = q !== "" && (row.dataset.search || "").indexOf(q) === -1;
      });
    });
  }

  // O chon file bi an di de thay bang nut vien dut, nen phai TU bao ten file da chon - khong thi
  // admin khong co cach nao biet anh bill da dinh kem duoc hay chua.
  Array.prototype.slice.call(document.querySelectorAll("[data-proof-input]")).forEach(function (fileInput) {
    fileInput.addEventListener("change", function () {
      var label = document.querySelector('label[for="' + fileInput.id + '"] [data-proof-label]');
      if (!label) return;
      var file = fileInput.files && fileInput.files[0];
      label.textContent = file ? file.name : "Đính kèm bill";
    });
  });
})();
</script>`;

  const body = `${errorBlock}
${kpiRow}
<div class="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
  <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/50 px-6">
    <div class="flex gap-6" role="tablist">
      ${tabBtn("pending", true, "clock", "Yêu cầu đang chờ", pending.length, "bg-amber-100 text-amber-700")}
      ${tabBtn("history", false, "history", "Lịch sử đã trả gần đây", paidHistory.length, "bg-slate-100 text-slate-600")}
      ${
        cancelledHistory.length > 0
          ? tabBtn("cancelled", false, "x-circle", "Đã huỷ", cancelledHistory.length, "bg-rose-100 text-rose-700")
          : ""
      }
    </div>
    <div class="relative w-full py-2 sm:w-56 sm:py-0">
      ${icon("search", "pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400")}
      <label class="sr-only" for="withdrawal-search">Tìm yêu cầu rút tiền</label>
      <input type="search" id="withdrawal-search" autocomplete="off" placeholder="Tìm theo người nhận, STK..." class="${fieldClass} pl-8">
    </div>
  </div>
  <div data-panel="pending" id="panel-pending" role="tabpanel">${pendingPanel}</div>
  <div data-panel="history" id="panel-history" role="tabpanel" hidden>${historyPanel}</div>
  ${
    cancelledHistory.length > 0
      ? `<div data-panel="cancelled" id="panel-cancelled" role="tabpanel" hidden>${cancelledPanel}</div>`
      : ""
  }
</div>
${pageScript}`;

  return adminShell("withdrawals", "Yêu cầu rút tiền", body, pending.length);
}

/**
 * Menu "⋯" cua tung hang /admin/users (2026-10-08, yeu cau truc tiep cua user): gom "Cau hinh %" va
 * "Xoa no" vao 1 nut, chi "Xem don" con nam ngoai. Moi khoan no la 1 muc RIENG (kem ma don + so tien)
 * vi 1 user co the no tu nhieu don - gop thanh 1 nut "Xoa no" thi admin khong biet minh dang xoa gi.
 *
 * Panel la `position: fixed` + toa do do script dat luc mo (rowMenuScript), KHONG phai absolute: bang
 * nam trong .table-scroll (overflow-x: auto) nen panel absolute bi CAT o hang cuoi - cung bay da gap
 * voi QR o /admin/withdrawals. Panel an (visibility) cho toi khi script dat xong toa do, tranh nhay
 * 1 khung hinh o vi tri sai.
 *
 * Moi <form> xoa no nam TRONG panel (cung 1 <td>) nen khong can noi qua thuoc tinh `form`.
 */
function rowActionsMenu(
  platform: Platform,
  userId: string,
  debts: Array<{ id: string; orderId: string; amount: number }>
): string {
  const debtItems = debts
    .map(
      (d) => `<form method="POST" action="/admin/users/${encodeURIComponent(platform)}/${encodeURIComponent(
        userId
      )}/debts/${encodeURIComponent(d.id)}/write-off" ${confirmOnSubmit(
        `Xoá khoản nợ ${formatVnd(d.amount)} (đơn ${d.orderId}) của user này? Số tiền sẽ không còn bị trừ ở lần rút tiếp theo của họ nữa.`
      )}>
        <button type="submit" class="row-menu-item row-menu-item-danger" role="menuitem">${icon(
          "x-circle",
          "h-3.5 w-3.5"
        )}<span>Xoá nợ<span class="row-menu-sub">Đơn ${escapeHtml(d.orderId)} · ${formatVnd(d.amount)}</span></span></button>
      </form>`
    )
    .join("\n");
  return `<details class="row-menu" data-row-menu>
      <summary class="row-menu-trigger" aria-label="Thao tác khác" title="Thao tác khác">${icon(
        "more-horizontal",
        "h-4 w-4"
      )}</summary>
      <div class="row-menu-panel" role="menu">
        <a class="row-menu-item" role="menuitem" href="${commissionConfigHref(platform, userId)}">${icon(
          "percent",
          "h-3.5 w-3.5"
        )}<span>Cấu hình % hoa hồng</span></a>
        ${debtItems ? `<div class="row-menu-sep"></div>${debtItems}` : ""}
      </div>
    </details>`;
}

/**
 * Dat toa do panel menu "⋯" luc mo (xem rowActionsMenu). Mo 1 menu thi dong cac menu khac; bam ra
 * ngoai / Esc / cuon / doi kich thuoc cua so thi dong - panel la fixed nen de mo luc cuon se troi
 * lech khoi nut. Thieu cho duoi man hinh thi lat len tren nut.
 */
const rowMenuScript = `<script>
(function () {
  var menus = Array.prototype.slice.call(document.querySelectorAll("[data-row-menu]"));
  if (menus.length === 0) return;
  function place(d) {
    var trigger = d.querySelector("summary");
    var panel = d.querySelector(".row-menu-panel");
    var r = trigger.getBoundingClientRect();
    var w = panel.offsetWidth, h = panel.offsetHeight;
    var left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    var top = r.bottom + 4;
    if (top + h > window.innerHeight - 8 && r.top - h - 4 > 8) top = r.top - h - 4;
    panel.style.left = left + "px";
    panel.style.top = top + "px";
    d.setAttribute("data-placed", "");
  }
  function closeAll(except) {
    menus.forEach(function (d) { if (d !== except && d.open) d.open = false; });
  }
  menus.forEach(function (d) {
    d.addEventListener("toggle", function () {
      if (d.open) { closeAll(d); place(d); } else { d.removeAttribute("data-placed"); }
    });
  });
  document.addEventListener("click", function (e) {
    menus.forEach(function (d) { if (d.open && !d.contains(e.target)) d.open = false; });
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeAll(null); });
  window.addEventListener("resize", function () { closeAll(null); });
  window.addEventListener("scroll", function () { closeAll(null); }, true);
})();
</script>`;

export function renderUsersPage(
  list: Array<{
    platform: Platform;
    userId: string;
    displayName: string | null;
    /**
     * Avatar Zalo (2026-10-09). TUY CHON co chu dich: user Telegram va user bot chi biet qua tin
     * nhan (event tin nhan khong mang avatar) khong co anh - UI tu lui ve o tron chu cai.
     */
    avatarUrl?: string | null;
    availableBalance: number;
    pendingBalance: number;
    /** Phan user se nhan cua cac don dang cho Shopee duyet (2026-10-10) - khac pendingBalance (cho rut). */
    pendingConfirmationBalance: number;
    paidTotal: number;
    /** No hoan tra con phai tru (2026-10-08) - KHONG tru vao availableBalance, chi tru luc duyet rut. */
    debtRemaining: number;
    /** Tien da duoc Shopee duyet nhung con bi giam (2026-10-08). */
    heldBalance: number;
    ordersCount: number;
    commissionOverride: UserCommissionOverride | null;
  }>,
  /** % chung hien hanh - hien cho user chua co uu dai rieng, de admin doi chieu. */
  generalSharePercent: number,
  /** "YYYY-MM-DD" gio VN, de biet uu dai nao da het han. */
  todayVn: string,
  /** So yeu cau rut dang cho - chi de hien badge tren muc nav, xem adminShell(). */
  pendingWithdrawals?: number
,
  /**
   * No hoan tra chua tra het cua tung user (2026-10-08), khoa theo `${platform}:${userId}`. Chi
   * dung de ve cac muc "Xoa no" trong menu "⋯" - so tien da nam trong truong debtRemaining cua tung dong.
   */
  userDebts: Map<string, Array<{ id: string; orderId: string; amount: number }>> = new Map()): string {
  const rows = list
    .map((u, index) => {
      const name =
        u.displayName && u.displayName.trim() !== ""
          ? `<div class="font-semibold text-slate-800">${escapeHtml(u.displayName)}</div>`
          : `<div class="font-medium italic text-slate-400">Chưa đặt tên</div>`;
      return `<tr class="transition hover:bg-slate-50/80" data-search="${escapeHtml(
        `${u.displayName ?? ""} ${u.userId}`.toLowerCase()
      )}" data-orders="${u.ordersCount}" data-paid="${u.paidTotal}" data-pending="${u.pendingConfirmationBalance}" data-index="${index}">
  <td class="px-4 py-3.5">
    <div class="flex items-center gap-3">
      ${userAvatar(u.displayName, u.userId, u.avatarUrl)}
      <div class="min-w-0">
        ${name}
        <div class="mt-0.5 flex items-center gap-1 font-mono text-[11px] text-slate-400">
          ${escapeHtml(u.userId)}
          ${copyIconButton(u.userId, `Sao chép User ID ${u.userId}`)}
        </div>
      </div>
    </div>
  </td>
  <td class="px-4 py-3.5">${platformChip(u.platform)}</td>
  <td class="px-4 py-3.5 text-center">${commissionCell(u.commissionOverride, generalSharePercent, todayVn)}</td>
  <td class="px-4 py-3.5 text-center font-medium tabular-nums text-slate-700">${u.ordersCount}</td>
  ${moneyCell(u.availableBalance, "font-semibold text-emerald-600")}
  ${moneyCell(u.pendingConfirmationBalance, "font-semibold text-amber-600")}
  ${moneyCell(u.pendingBalance, "font-semibold text-amber-600")}
  ${moneyCell(u.paidTotal, "font-medium text-slate-700")}
  ${moneyCell(u.debtRemaining, "font-semibold text-rose-600")}
  <td class="px-4 py-3.5 text-right">
    <div class="flex items-center justify-end gap-1.5">
      <a class="inline-flex items-center gap-1 rounded bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-600 no-underline transition hover:bg-indigo-100" href="/admin/orders?platform=${encodeURIComponent(
        u.platform
      )}&userId=${encodeURIComponent(u.userId)}">${icon("package", "h-3 w-3")} Xem đơn</a>
      ${rowActionsMenu(u.platform, u.userId, userDebts.get(nameKey(u.platform, u.userId)) ?? [])}
    </div>
  </td>
</tr>`;
    })
    .join("\n");

  // Tim kiem + sap xep, CA HAI deu chay client-side (khong reload trang): moi <tr> mang san
  // data-search = "ten userId" da viet thuong, data-orders/data-paid de sap xep, va data-index la
  // THU TU GOC tu server. Danh sach user nam tron trong 1 trang nen khong can query server - va vi
  // vay so dem "Hiển thị: N tài khoản" doi NGAY khi go, khong phai bam nut nao.
  //
  // CO Y khong lam thanh form GET nhu /admin/orders: tron 2 kieu tuong tac tren cung mot thanh (mot
  // o doi tuc thi, mot o phai bam nut) la cho de bam nham nhat.
  //
  // data-index la chot chong TROI THU TU: `sort` cua JS on dinh, nhung neu chi so sanh gia tri thi
  // cac dong BANG NHAU (rat pho bien o day - phan lon user co 1 don va 0d da nhan) se giu thu tu
  // cua lan sap xep TRUOC, nen doi qua doi lai giua 2 tieu chi se lam danh sach xao dan. So sanh
  // lui ve data-index thi "Mặc định" luon tra ve dung thu tu server (kha dung giam dan) va 2 tieu
  // chi kia luon ra cung mot ket qua.
  //
  // Logic ben trong duoc test qua src/api/__tests__/usersSearchScript.test.ts (chay script nay tren
  // DOM gia) - sua o day thi chay lai test do.
  const searchScript = `<script>
(function () {
  var input = document.getElementById("user-search");
  if (!input) return;
  var sortSelect = document.getElementById("user-sort");
  var tbody = document.getElementById("users-tbody");
  var rows = Array.prototype.slice.call(document.querySelectorAll("#users-table tbody tr"));
  var counter = document.getElementById("users-count");
  var emptyHint = document.getElementById("users-no-match");
  var ordersFilter = document.getElementById("user-orders-filter");
  function refresh() {
    var q = input.value.trim().toLowerCase();
    var group = ordersFilter ? ordersFilter.value : "";
    var shown = 0;
    rows.forEach(function (row) {
      var hasOrders = Number(row.dataset.orders || 0) > 0;
      var match =
        (q === "" || (row.dataset.search || "").indexOf(q) !== -1) &&
        (group === "" || (group === "with-orders" ? hasOrders : !hasOrders));
      row.hidden = !match;
      if (match) shown++;
    });
    if (counter) counter.textContent = String(shown);
    if (emptyHint) emptyHint.hidden = shown !== 0;
  }
  function applySort() {
    if (!sortSelect || !tbody) return;
    var key = sortSelect.value;
    rows.slice().sort(function (a, b) {
      if (key !== "") {
        var diff = Number(b.dataset[key] || 0) - Number(a.dataset[key] || 0);
        if (diff !== 0) return diff;
      }
      return Number(a.dataset.index || 0) - Number(b.dataset.index || 0);
    }).forEach(function (row) { tbody.appendChild(row); });
  }
  input.addEventListener("input", refresh);
  if (ordersFilter) ordersFilter.addEventListener("change", refresh);
  if (sortSelect) sortSelect.addEventListener("change", applySort);
})();
</script>`;

  // 4 the KPI cong tu chinh `list` dang render, khong truy van them: 3 cot tien cua bang cong lai
  // DUNG BANG 3 the tien o tren, nen khong the venh nhau.
  const kpiRow = kpiGrid([
    kpiCard({
      label: "Tổng người dùng",
      value: String(list.length),
      // Tu 2026-10-09 danh sach gom ca thanh vien group chua mua lan nao, nen con so tong KHONG con
      // la "so khach da mua" - khong noi ro ra thi doc nham thanh doanh so.
      note: `${list.filter((u) => u.ordersCount > 0).length} đã có đơn`,
      icon: "users",
      valueClass: "text-slate-800",
      iconClass: "bg-indigo-50 text-indigo-600",
    }),
    kpiCard({
      label: "Đang chờ rút",
      value: formatVnd(list.reduce((sum, u) => sum + u.pendingBalance, 0)),
      icon: "clock",
      valueClass: "text-amber-600",
      iconClass: "bg-amber-50 text-amber-600",
    }),
    kpiCard({
      label: "Khả dụng (ví user)",
      value: formatVnd(list.reduce((sum, u) => sum + u.availableBalance, 0)),
      icon: "wallet",
      valueClass: "text-emerald-600",
      iconClass: "bg-emerald-50 text-emerald-600",
    }),
    kpiCard({
      label: "Đã chi trả thành công",
      value: formatVnd(list.reduce((sum, u) => sum + u.paidTotal, 0)),
      icon: "check-circle",
      valueClass: "text-slate-800",
      iconClass: "bg-blue-50 text-blue-600",
    }),
  ]);

  // KHONG phai <form>: ca 2 o deu loc tuc thi bang JS, khong co gi de submit. Boc trong <form> se
  // moi nguoi dung bam Enter roi tai lai trang ve dung trang cu. FIELD_CLASS/SELECT_CHEVRON_CLASS
  // dinh nghia o dau file.
  const filterBar = `<div class="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
  <div class="flex flex-1 flex-wrap items-center gap-3">
    <div class="relative w-full sm:max-w-xs">
      ${icon("search", "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400")}
      <label class="sr-only" for="user-search">Tìm người dùng</label>
      <input type="search" id="user-search" autocomplete="off" placeholder="Tìm theo tên khách, User ID..." class="${FIELD_CLASS} pl-9">
    </div>
    <div class="w-full sm:w-44">
      <label class="sr-only" for="user-orders-filter">Hiển thị nhóm</label>
      <select id="user-orders-filter" class="${FIELD_CLASS} ${SELECT_CHEVRON_CLASS}">
        <option value="">Tất cả</option>
        <option value="with-orders">Đã có đơn</option>
        <option value="no-orders">Chưa có đơn</option>
      </select>
    </div>
    <div class="w-full sm:w-56">
      <label class="sr-only" for="user-sort">Sắp xếp</label>
      <select id="user-sort" class="${FIELD_CLASS} ${SELECT_CHEVRON_CLASS}">
        <option value="">Mặc định (khả dụng cao nhất)</option>
        <option value="orders">Số đơn nhiều nhất</option>
        <option value="paid">Hoa hồng đã nhận nhiều nhất</option>
        <option value="pending">Chờ xác nhận cao nhất</option>
      </select>
    </div>
  </div>
  <div class="text-xs text-slate-500">Hiển thị: <span class="font-semibold text-slate-700"><span id="users-count">${
    list.length
  }</span> tài khoản</span></div>
</div>`;

  const thClass = "px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500";
  const table = `<div class="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
  <div class="table-scroll">
    <table id="users-table" class="w-full border-collapse whitespace-nowrap text-xs">
      <thead class="border-b border-slate-200 bg-slate-50">
        <tr>
          <th class="${thClass}">Người dùng / User ID</th>
          <th class="${thClass}">Kênh</th>
          <th class="${thClass} !text-center">% hoa hồng</th>
          <th class="${thClass} !text-center">Số đơn</th>
          <th class="${thClass} !text-right">Khả dụng</th>
          <th class="${thClass} !text-right" title="Phần user sẽ nhận của các đơn đang chờ Shopee duyệt, chưa thành Khả dụng">Chờ xác nhận</th>
          <th class="${thClass} !text-right">Đang chờ rút</th>
          <th class="${thClass} !text-right">Đã nhận</th>
          <th class="${thClass} !text-right" title="Tiền đã trả cho user rồi nhưng đơn bị trả hàng - sẽ trừ khi user gửi yêu cầu rút tiền lần sau">Nợ hoàn trả</th>
          <th class="${thClass} !text-right">Hành động</th>
        </tr>
      </thead>
      <tbody id="users-tbody" class="divide-y divide-slate-100">${rows}</tbody>
    </table>
  </div>
  <div class="px-5 py-14 text-center" id="users-no-match" hidden>
    <div class="mb-1 text-sm font-semibold text-slate-700">Không có user nào khớp</div>
    <p class="m-0 text-xs text-slate-500">Thử xoá bớt từ khoá hoặc chọn lại nhóm hiển thị.</p>
  </div>
</div>`;

  const emptyCard = `<div class="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
  <div class="px-5 py-14 text-center">
    <div class="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">${icon(
      "users",
      "h-5 w-5"
    )}</div>
    <div class="mb-1 text-sm font-semibold text-slate-700">Chưa có người dùng nào</div>
    <p class="m-0 text-xs text-slate-500">Danh sách gồm thành viên các nhóm Zalo bạn đã tick ở <a class="font-medium text-indigo-600 underline" href="/admin/settings">Cài đặt</a>, cộng với mọi user đã từng có đơn. Chưa tick nhóm nào thì chưa có ai ở đây.</p>
  </div>
</div>`;

  const body = list.length > 0 ? `${kpiRow}\n${filterBar}\n${table}\n${searchScript}\n${rowMenuScript}` : `${kpiRow}\n${emptyCard}`;

  return adminShell("users", "Người dùng", body, pendingWithdrawals);
}

export function commissionConfigHref(platform: Platform, userId: string): string {
  return `/admin/users/${encodeURIComponent(platform)}/${encodeURIComponent(userId)}/commission`;
}

/**
 * O "% hoa hong" tren /admin/users. Uu dai HET HAN van hien (kem nhan "đã hết hạn") chu khong an di:
 * admin can thay minh da hua gi voi ai, va day cung la loi nhac de gia han neu con muon.
 */
function commissionCell(
  override: UserCommissionOverride | null,
  generalSharePercent: number,
  todayVn: string
): string {
  const chip = "inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium";
  if (!override) {
    return `<span class="${chip} bg-slate-100 text-slate-700">Chung ${generalSharePercent}%</span>`;
  }
  const expired = override.endDate !== null && todayVn > override.endDate;
  const notStarted = todayVn < override.startDate;
  if (expired) {
    // Uu dai het han: chip mo di (khong phai do - het han khong phai loi), kem ngay het de admin
    // biet minh da hua gi va co gia han hay khong.
    return `<span class="${chip} bg-slate-100 text-slate-400 line-through">${override.userSharePercent}%</span>
      <div class="mt-0.5 text-[11px] text-slate-400">hết hạn ${formatVnDate(override.endDate!)}</div>`;
  }
  const window = notStarted
    ? `từ ${formatVnDate(override.startDate)}`
    : override.endDate === null
      ? "không hạn"
      : `đến ${formatVnDate(override.endDate)}`;
  return `<span class="${chip} bg-indigo-50 text-indigo-700">${override.userSharePercent}%</span>
    <div class="mt-0.5 text-[11px] text-slate-400">${escapeHtml(window)}</div>`;
}

/** "YYYY-MM-DD" -> "dd/mm/yyyy" de doc cho nguoi Viet. Chuoi vao luon do he thong sinh ra. */
function formatVnDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

/**
 * Trang cau hinh % hoa hong rieng cho 1 user. Trang RIENG thay vi form nhoi vao tung hang bang
 * /admin/users: can cho dong canh bao khi dat thap hon % chung, va cho nut xoa uu dai.
 */
export function renderUserCommissionPage(input: {
  platform: Platform;
  userId: string;
  displayName: string | null;
  override: UserCommissionOverride | null;
  generalSharePercent: number;
  todayVn: string;
  errorMessage?: string | null;
  /** So yeu cau rut dang cho - chi de hien badge tren muc nav, xem adminShell(). */
  pendingWithdrawals?: number;
}): string {
  const o = input.override;
  const errorBlock = input.errorMessage ? `<div class="error">${escapeHtml(input.errorMessage)}</div>` : "";
  const who = input.displayName
    ? `${escapeHtml(input.displayName)} <span class="muted">(${escapeHtml(input.platform)} · ${escapeHtml(input.userId)})</span>`
    : `${escapeHtml(input.platform)} · ${escapeHtml(input.userId)}`;

  const currentBlock = o
    ? `<p class="help">Đang áp dụng: <strong>${o.userSharePercent}%</strong> từ ${formatVnDate(o.startDate)}${
        o.endDate === null ? " (không hạn)" : ` đến ${formatVnDate(o.endDate)}`
      }${o.endDate !== null && input.todayVn > o.endDate ? " — <strong>đã hết hạn</strong>" : ""}.</p>`
    : `<p class="help">User này đang dùng % chung (<strong>${input.generalSharePercent}%</strong>).</p>`;

  const deleteForm = o
    ? `<form method="POST" action="${commissionConfigHref(input.platform, input.userId)}/delete" ${confirmOnSubmit(
        "Xoá ưu đãi riêng của user này? Các đơn đã ghi nhận không bị ảnh hưởng."
      )}>
  <button type="submit" class="danger">Xoá ưu đãi, trả về % chung</button>
</form>`
    : "";

  const body = `<div class="card">
<h2>% hoa hồng riêng — ${who}</h2>
${errorBlock}
${currentBlock}
<form method="POST" action="${commissionConfigHref(input.platform, input.userId)}" class="settings-form" ${confirmOnSubmit(
    "Lưu tỉ lệ riêng cho user này? Áp dụng cho đơn ghi nhận từ hôm nay trở đi."
  )}>
  <div class="field">
    <label for="userSharePercent">% user nhận (0-100)</label>
    <input type="number" id="userSharePercent" name="userSharePercent" min="0" max="100" step="1" value="${
      o ? o.userSharePercent : input.generalSharePercent
    }" required>
    <p class="help">% chung hiện hành là <strong>${input.generalSharePercent}%</strong>. Đặt <strong>thấp hơn</strong> số này nghĩa là trả cho user ít hơn mức trang Sổ tay (/so-tay) đang hứa công khai — vẫn lưu được, nhưng bạn nên biết trước.</p>
  </div>
  <div class="field">
    <label for="endDate">Ngày kết thúc</label>
    <input type="date" id="endDate" name="endDate" value="${o?.endDate ?? ""}" min="${input.todayVn}">
    <p class="help">Bỏ trống = không hạn. Sau ngày này đơn mới sẽ quay về % chung. Hạn tính theo <strong>ngày user đặt đơn</strong> (không phải ngày bạn import báo cáo), nên đơn mua trong hạn mà Shopee báo cáo trễ vẫn được hưởng.</p>
  </div>
  <div class="field">
    <p class="help">Ngày bắt đầu là <strong>hôm nay (${formatVnDate(
      input.todayVn
    )})</strong>, tự gán khi lưu — đơn đã mua trước hôm nay không bị tính lại theo tỉ lệ mới.</p>
  </div>
  <div><button type="submit" class="primary">Lưu</button> <a class="link" href="/admin/users">Quay lại</a></div>
</form>
</div>
${deleteForm ? `<div class="card">${deleteForm}</div>` : ""}`;

  return adminShell("users", "Người dùng", body, input.pendingWithdrawals);
}

export interface OrdersFilters {
  platform?: Platform;
  userId?: string;
  merchant?: MerchantId;
  /** Nhieu trang thai cung luc (form dung checkbox). Rong = khong loc, hien tat ca. */
  statuses?: CommissionStatus[];
  /** O tim 1 dong: khop mot phan ma don / userId / ten hien thi. Xem CommissionEntryFilters.search. */
  search?: string;
}

/** So don hien tren 1 trang /admin/orders. */
export const ORDERS_PAGE_SIZE = 50;

export interface OrdersPagination {
  /** Trang dang xem, 1-based - da duoc route kep ve khoang hop le truoc khi truyen vao day. */
  page: number;
  totalPages: number;
  totalEntries: number;
}

/**
 * Dung lai URL /admin/orders giu NGUYEN bo loc hien tai, chi doi so trang - moi link phan trang deu
 * di qua day, neu khong thi bam sang trang 2 se mat sach bo loc admin vua chon.
 */
function ordersPageHref(filters: OrdersFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.platform) params.set("platform", filters.platform);
  if (filters.merchant) params.set("merchant", filters.merchant);
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.search) params.set("q", filters.search);
  for (const status of filters.statuses ?? []) params.append("status", status);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query === "" ? "/admin/orders" : `/admin/orders?${query}`;
}

/** Day so trang hien tren thanh phan trang: luon co trang dau/cuoi + 1 trang ke hien tai, con lai la "…". */
export function paginationItems(page: number, totalPages: number): Array<number | "gap"> {
  const wanted = new Set<number>([1, totalPages, page - 1, page, page + 1]);
  const pages = [...wanted].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const items: Array<number | "gap"> = [];
  pages.forEach((n, i) => {
    if (i > 0 && n - pages[i - 1] > 1) items.push("gap");
    items.push(n);
  });
  return items;
}

function renderPagination(filters: OrdersFilters, pagination: OrdersPagination): string {
  if (pagination.totalPages <= 1) return "";
  const { page, totalPages } = pagination;
  // Nut lui/tien chi co icon nen BAT BUOC co aria-label - mot mui nhon khong tu noi len no di dau.
  const prev =
    page > 1
      ? `<a href="${escapeHtml(ordersPageHref(filters, page - 1))}" aria-label="Trang trước">${icon("chevron-left")}</a>`
      : `<span class="disabled" aria-hidden="true">${icon("chevron-left")}</span>`;
  const next =
    page < totalPages
      ? `<a href="${escapeHtml(ordersPageHref(filters, page + 1))}" aria-label="Trang sau">${icon("chevron-right")}</a>`
      : `<span class="disabled" aria-hidden="true">${icon("chevron-right")}</span>`;
  const middle = paginationItems(page, totalPages)
    .map((item) =>
      item === "gap"
        ? `<span class="gap">…</span>`
        : item === page
          ? `<span class="current" aria-current="page">${item}</span>`
          : `<a href="${escapeHtml(ordersPageHref(filters, item))}">${item}</a>`
    )
    .join("");
  return `<nav class="pagination" aria-label="Phân trang đơn hàng">${prev}${middle}${next}</nav>`;
}

const STATUS_OPTIONS: CommissionStatus[] = ["pending", "confirmed", "paid", "reversed"];
const STATUS_LABELS: Record<CommissionStatus, string> = {
  pending: "Chờ xác nhận",
  confirmed: "Khả dụng / đang chờ rút",
  paid: "Đã rút",
  reversed: "Đã huỷ",
};
export const PLATFORM_OPTIONS: Platform[] = ["telegram", "zalo", "http"];

export function selectOptions<T extends string>(
  options: readonly T[],
  labelFor: (v: T) => string,
  selected: T | undefined
): string {
  const all = `<option value=""${!selected ? " selected" : ""}>Tất cả</option>`;
  const rest = options
    .map((v) => `<option value="${v}"${v === selected ? " selected" : ""}>${labelFor(v)}</option>`)
    .join("");
  return all + rest;
}

/**
 * Sau sac pastel cho avatar chu cai. KHONG co do va hong-do: hai sac do da mang nghia "loi" va
 * "hanh dong nguy hiem" khap /admin, mot user ma avatar do se trong nhu tai khoan dang co van de.
 */
const AVATAR_TONES = [
  "bg-emerald-50 text-emerald-700 ring-emerald-200",
  "bg-sky-50 text-sky-700 ring-sky-200",
  "bg-indigo-50 text-indigo-700 ring-indigo-200",
  "bg-pink-50 text-pink-700 ring-pink-200",
  "bg-amber-50 text-amber-700 ring-amber-200",
  "bg-violet-50 text-violet-700 ring-violet-200",
];

/**
 * Avatar chu cai cua 1 user.
 *
 * **Mau lay theo userId, KHONG theo ten hien thi**: user Zalo doi ten hien thi thuong xuyen, lay
 * theo ten thi mau nhay moi lan ho doi ten va admin mat dau hieu nhan ra ho. Theo userId thi cung
 * mot nguoi luon ra cung mot mau, moi lan tai lai.
 *
 * **Chu cai lay tu tu DAU va tu CUOI cua ten**, khong phai 2 tu dau: ten tieng Viet co ten goi nam
 * o CUOI, nen "Nguyễn Hoàng Minh Khuê Trâm Anh" ra "NA" (Nguyễn + Anh) chu khong phai "NH" (hai chu
 * ho/dem, khong giup nhan ra ai).
 *
 * **User chua co ten hien thi** (rat pho bien voi Zalo) dung sac TRUNG TINH + ky tu dau cua userId,
 * khong phai dau "?": dau hoi doc ra nhu mot trang thai loi, trong khi day chi la "bot chua tung
 * thay ten". Cot ben canh da ghi ro "Chưa đặt tên" nen khong co gi mo ho.
 */
export function userAvatar(displayName: string | null, userId: string, avatarUrl?: string | null): string {
  const base =
    "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ring-1";

  // Avatar Zalo (2026-10-09). Ve bang background-image INLINE thay vi <img>: anh 404 thi con lai o
  // tron mau (mau suy tu userId nen van phan biet duoc nguoi), khong ra icon anh hong, va khong can
  // mot dong JS nao cho fallback. TUYET DOI khong dua URL vao utility `bg-[url(...)]` cua Tailwind -
  // URL co khoang trang/ngoac se bi bo quet @source cat token va khong sinh ra CSS nao, khong co
  // canh bao build (bay thu ba trong CLAUDE.md).
  const safeAvatar = safeAvatarUrl(avatarUrl);
  if (safeAvatar !== null) {
    return `<span class="${base} border-0 bg-slate-100 bg-cover bg-center ring-slate-200" style="background-image:url('${safeAvatar}')" aria-hidden="true"></span>`;
  }

  if (!displayName || displayName.trim() === "") {
    const fallback = escapeHtml((userId.trim().charAt(0) || "?").toLocaleUpperCase("vi"));
    return `<span class="${base} bg-slate-100 text-slate-500 ring-slate-200" aria-hidden="true">${fallback}</span>`;
  }
  const words = displayName.trim().split(/\s+/);
  const first = words[0].charAt(0);
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : "";
  const initials = escapeHtml(`${first}${last}`.toLocaleUpperCase("vi"));

  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  const tone = AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];

  return `<span class="${base} ${tone}" aria-hidden="true">${initials}</span>`;
}

/**
 * URL avatar chi duoc dung khi CHAC CHAN khong pha duoc thuoc tinh style= (2026-10-09). URL nay den
 * tu Zalo (ben thu ba) va di vao `url('...')` trong CSS inline: mot URL chua `'` hoac `)` se dong
 * som ham url() roi nhet them khai bao CSS bat ky vao trang admin. Khong escape cho an toan ma TU
 * CHOI han: tra null -> UI lui ve o tron chu cai, mat avatar chu khong mat quyen kiem soat trang.
 * Chi nhan https (avatar Zalo luon la https; http se bi trinh duyet chan vi mixed content).
 */
function safeAvatarUrl(avatarUrl: string | null | undefined): string | null {
  const url = avatarUrl?.trim() ?? "";
  if (!url.startsWith("https://")) return null;
  if (/["'()\\\s]/.test(url)) return null;
  return url;
}

/** Ten kenh viet hoa dung cach de hien cho nguoi doc - gia tri trong DB van la "zalo"/"telegram"/"http". */
export const PLATFORM_LABELS: Record<Platform, string> = {
  zalo: "Zalo",
  telegram: "Telegram",
  http: "HTTP",
};

/**
 * Chip ten kenh. DUNG CHUNG boi /admin/orders va /admin/users - mot thu xuat hien o hai trang thi
 * phai trong giong het nhau, neu khong la hai app ghep lai.
 *
 * Zalo xanh duong va Telegram xanh da troi la mau thuong hieu that cua hai ben; HTTP trung tinh vi
 * no khong phai thuong hieu nao, chi la duong goi API truc tiep.
 */
export function platformChip(platform: Platform): string {
  const tone: Record<Platform, string> = {
    zalo: "border-blue-100 bg-blue-50 text-blue-600",
    telegram: "border-sky-100 bg-sky-50 text-sky-600",
    http: "border-slate-200 bg-slate-100 text-slate-700",
  };
  return `<span class="inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium ${tone[platform]}">${PLATFORM_LABELS[platform]}</span>`;
}

/**
 * Mot the KPI dau trang. DUNG CHUNG boi /admin/orders va /admin/users (D1: mot thanh phan, mot hinh).
 *
 * `note` de rong thi khong render dong thu ba - trang /admin/users khong co gi can chu thich them,
 * con /admin/orders thi BAT BUOC co ("khong tinh đơn đã huỷ").
 */
export function kpiCard(input: {
  label: string;
  value: string;
  note?: string;
  icon: keyof typeof ICON_PATHS;
  valueClass: string;
  iconClass: string;
  /**
   * "alert" = vien cam + nen cam rat nhat: the dang bao CO VIEC PHAI LAM NGAY (vd tien user dang
   * cho chuyen khoan). Chi dung cho the that su can hanh dong - to mau de "cho noi bat" se lam mat
   * tac dung canh bao cua no.
   */
  tone?: "alert";
}): string {
  const note = input.note
    ? `<div class="mt-0.5 text-[11px] ${input.tone === "alert" ? "text-amber-600" : "text-slate-400"}">${
        input.note
      }</div>`
    : "";
  const shell =
    input.tone === "alert"
      ? "border-amber-200 bg-amber-50/30"
      : "border-slate-200/80 bg-white";
  return `<div class="flex items-center justify-between gap-3 rounded-xl border ${shell} p-4 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
    <div class="min-w-0">
      <div class="text-xs font-medium text-slate-500">${input.label}</div>
      <div class="mt-1 text-2xl font-bold tabular-nums ${input.valueClass}">${input.value}</div>
      ${note}
    </div>
    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${input.iconClass}">${icon(
      input.icon,
      "h-5 w-5"
    )}</div>
  </div>`;
}

/**
 * Luoi the KPI - dung chung de cac trang co cung diem ngat cot.
 *
 * `columns` la so cot o man rong: 4 cho trang nhieu chi so, 2 cho trang it. Hai the keo het be ngang
 * man hinh trong rat trong rong nen ban 2 cot bi gioi han be ngang lai.
 */
export function kpiGrid(cards: string[], columns: 2 | 4 = 4): string {
  const wide = columns === 4 ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-2 md:max-w-3xl";
  return `<div class="mb-5 grid grid-cols-1 gap-4 ${wide}">\n${cards.join("\n")}\n</div>`;
}

/**
 * O tien trong bang. So 0 LUON lam mo (text-slate-400) du o do dang mang mau gi.
 *
 * Co chu dich: bang /admin/users co 3 cot tien ma phan lon user chi co so o MOT cot - to dam ca 3
 * thi mat nhin phai doc tung so moi biet cho nao co tien that. Lam mo so 0 de mat roi thang vao
 * dung cho dang co tien.
 */
function moneyCell(amount: number, toneClass: string): string {
  const cls = amount === 0 ? "font-medium text-slate-400" : toneClass;
  return `<td class="px-4 py-3.5 text-right tabular-nums ${cls}">${formatVnd(amount)}</td>`;
}

/**
 * Class dung chung cho moi o nhap/o chon cua giao dien moi (2026-10-04) - truoc day lap lai y het
 * nhau 3 lan (toolbar /admin/orders, /admin/users, o tim /admin/withdrawals), gop lai mot cho de
 * sua mot lan la ap dung het. Khong co preflight nen MOI control phai TU mang day du vien + nen +
 * bo goc (W9); `appearance-none` + SELECT_CHEVRON_CLASS cho <select> de no cao bang <input> va
 * trong giong nhau tren moi he dieu hanh - select goc cua Safari macOS cao hon va bo goc khac.
 */
export const FIELD_CLASS =
  "w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 " +
  "transition outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20";

/** Nhan phia tren 1 o nhap (kieu "LABEL IN HOA NHO" cua form 2 cot) - dung cung FIELD_CLASS. */
export const FIELD_LABEL_CLASS = "mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500";

// Mui nhon ve bang background-image (data URI) thay vi 1 the <svg> dat tuyet doi: <select> khong
// nhan phan tu con nao ngoai <option> nen khong co cach nao nhet icon vao trong no.
//
// LA MOT CLASS CSS THAT (`.field-select` trong admin.css), KHONG PHAI utility tuy y cua Tailwind
// (`bg-[url(...)]`) - da dinh that: chuoi SVG co dau cach (vd "viewBox=%220 0 24 24%22"), ma bo
// quet @source cua Tailwind v4 cat token tai KHOANG TRANG DAU TIEN trong chuoi class, nen class
// `bg-[url('data:image/svg+xml...` bi coi la khong hop le va KHONG SINH RA CSS NAO - mui ten tren
// 4 <select> (orders, users, record-orders) am tham bien mat, khong co loi build nao bao. Chuyen
// het sang 1 class CSS viet tay la cach duy nhat an toan voi moi gia tri co dau cach ben trong.
export const SELECT_CHEVRON_CLASS = "field-select";


/**
 * Mau chip ten san o cot "Sàn / Kênh" (2026-10-04, yeu cau truc tiep cua user: to mau dung nhu
 * design ref, dao lai lua chon de mau trung tinh truoc do).
 *
 * CHI to mau cho san DANG ho tro. RETIRED_MERCHANTS (tiktokshop, lazada - don cu van hien o day,
 * xem merchants.ts) giu mau trung tinh: chon mau thuong hieu cho mot san da ngung ho tro la viec
 * vo ich, va de mac dinh thi them san moi vao MERCHANTS cung khong vo giao dien - chi la chua co
 * mau rieng cho den khi ai do them vao bang nay.
 *
 * LUU Y khi doi: cam cua Shopee TRUNG TONG voi trang thai "Chờ xác nhận" o cot ben canh. Hai cai
 * phan biet duoc nho HINH DANG chu khong nho mau - chip la goc vuong, khong co dau tron; pill
 * trang thai la bo tron hoan toan + co dau tron (xem statusPill). Dung lam chip bo tron, cung dung
 * them dau tron vao chip.
 */
export function merchantChipClass(merchant: MerchantId): string {
  const byMerchant: Partial<Record<MerchantId, string>> = {
    shopee: "border-orange-100 bg-orange-50 text-orange-600",
    // TikTok: nen den dac trung cua thuong hieu. Cam/xanh la/xanh duong/do da mang nghia rieng trong
    // khu /admin (cho xac nhan, kha dung, kenh Zalo, da huy) nen khong dung lai cho san.
    tiktokshop: "border-slate-800 bg-slate-900 text-white",
  };
  return byMerchant[merchant] ?? "border-slate-200 bg-white text-slate-700";
}

/**
 * Pill trang thai cua 1 don.
 *
 * Mau lay tu BIEN --success/--warning/--danger chu khong tu thang mau Tailwind (emerald/amber/rose
 * cua design ref): 3 cap mau do dang duoc dung lam mau cot trong chart cua /admin/dashboard, va 1
 * trang thai phai co CUNG mot mau o moi cho no xuat hien. Lay thang thang Tailwind se lam pill va
 * chart lech nhau mot chut, du mat thuong kho noi ra nhung doi chieu thi sai.
 *
 * 2026-10-05: BO dau tron truoc chu (yeu cau truc tiep cua user, ref co dau tron + con dat
 * `animate-pulse` len dau tron cua don "chờ xác nhận") - chu trong pill VAN la kenh phan biet
 * chinh voi mu mau do-luc (cap "Khả dụng" #16a34a / "Đã huỷ" #dc2626 truot kiem tra, xem ghi chu
 * chart trong CLAUDE.md), dau tron chi la trang tri them nen bo di khong mat thong tin gi.
 */
export function statusPill(badge: { label: string; tone: BadgeTone }): string {
  const tone = {
    success: { bg: "--success-soft", fg: "--success" },
    warning: { bg: "--warning-soft", fg: "--warning" },
    danger: { bg: "--danger-soft", fg: "--danger" },
  }[badge.tone];
  return (
    `<span class="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap"` +
    ` style="background:var(${tone.bg});color:var(${tone.fg});border-color:color-mix(in srgb, var(${tone.fg}) 25%, transparent)">` +
    `${badge.label}</span>`
  );
}

/** Nhan tom tat hien tren nut dropdown "Trang thai" - giu dong bo voi refresh() trong statusDropdownScript. */
function statusSummaryLabel(checked: readonly CommissionStatus[]): string {
  if (checked.length === 0 || checked.length === STATUS_OPTIONS.length) return "Tất cả";
  if (checked.length === 1) return STATUS_LABELS[checked[0]];
  return `${checked.length} trạng thái`;
}

export function renderOrdersPage(
  entries: CommissionEntry[],
  filters: OrdersFilters,
  displayNames: Map<string, string>,
  pagination: OrdersPagination,
  totals: OrdersFilterTotals,
  /** So yeu cau rut dang cho - chi de hien badge tren muc nav, xem adminShell(). */
  pendingWithdrawals?: number,
  /**
   * Ma don DA tra tien cho user roi nhung bi tra hang (2026-10-08) - entry giu nguyen status 'paid'
   * (tien ra khoi tay that, user co sao ke) nen phai co dau hieu rieng, neu khong hang do nhin y het
   * mot don binh thuong.
   */
  debtOrderIds: Set<string> = new Set()
): string {
  const todayVn = todayVnIso();
  const rows = entries
    .map((e) => {
      const badge = statusBadge(e, todayVn);
      // `block truncate` thay cho .cell-truncate cu: can <td class="max-w-xs"> de co moc cat. Giu
      // title de hover ra ten day du - ten san pham Shopee thuong dai hon ca chieu rong man hinh.
      const product = e.productName
        ? `<span class="block truncate font-medium text-slate-700" title="${escapeHtml(e.productName)}">${escapeHtml(e.productName)}</span>`
        : `<span class="text-slate-400">—</span>`;
      // 2026-08-20 (quyet dinh chot lai voi user): CHI huy duoc don dang "pending" - "confirmed"
      // (Kha dung) nghia la bao cao Shopee da ghi "Hoan thanh"/chot so lieu, xem la hoan tat, khong
      // con ly do gi de huy nua. LedgerStore.reverseCommissionEntry() cung tu choi ngay o
      // tang du lieu neu status khac "pending" (EntryNotPendingError) - day chi la an link o UI.
      const reverseLink =
        e.status === "pending"
          ? `<a class="inline-block rounded border border-rose-200 px-2.5 py-1 text-[11px] font-medium text-rose-600 no-underline whitespace-nowrap transition hover:bg-rose-50 hover:border-rose-300" href="/admin/orders/${e.id}/reverse">Huỷ đơn</a>`
          : `<span class="text-slate-300">—</span>`;
      // % user nhan DA CHOT cua rieng don nay (2026-10-01) - doi % tren /admin/settings khong hoi
      // to don da ghi, nen 2 don canh nhau co the khac %. "—" la don ghi truoc khi he thong chot ty
      // le: KHONG suy nguoc tu 2 cot tien de dien so vao day, lam tron se ra % sai (xem taxFeePercents
      // trong dashboardHtml.ts) va o day admin dung so nay de doi soat.
      const lockedShare = e.userSharePercent === null ? `<span class="muted">—</span>` : `${e.userSharePercent}%`;
      const displayName = displayNames.get(nameKey(e.platform, e.userId));
      const when = formatDateTimeParts(e.createdAt);
      // Don da huy: 2 cot tien van hien SO THAT (admin con doi soat voi bao cao Shopee) nhung phai
      // gach ngang + lam mo. De nguyen kieu thuong thi hang "Đã huỷ" doc ra thanh "khach nhan 5đ"
      // - mot so tien khong ai duoc nhan, va chinh 4 the KPI ben tren cung khong cong no vao.
      const voided = e.status === "reversed";
      const userMoneyClass = voided
        ? "text-slate-400 line-through"
        : "font-semibold text-emerald-600";
      const ownerMoneyClass = voided ? "text-slate-400 line-through" : "font-medium text-slate-700";

      // Dat DUOI pill trang thai thay vi them 1 cot rieng: bang nay da 9 cot va padding px-4 la muc
      // VUA DU de cot "Thao tac" khong bi day ra ngoai man ~1700px (xem CLAUDE.md). Ve nghia thi ngay
      // mo khoa cung la chi tiet cua trang thai ("Kha dung, nhung tu ngay X"), nen o day la dung cho.
      // PHAI so voi hom nay, khong chi kiem availableFrom !== null: don da qua ngay mo khoa van giu
      // nguyen gia tri trong cot do, nen bo phep so sanh thi sau vai tuan MOI don to deu deo nhan
      // "dang bi giam" vinh vien (bug that, phat hien khi xem trang that chu khong qua test).
      //
      // withdrawalId === null la chot phong thu: requestWithdrawal() da loai don bi giam nen trang
      // thai "vua bi giam vua nam trong yeu cau rut" khong the xay ra - nhung neu rang buoc do vo
      // thi nhan giam o day se mau thuan voi pill "Dang cho rut" ngay ben canh.
      const heldHint =
        e.availableFrom !== null &&
        e.status === "confirmed" &&
        e.withdrawalId === null &&
        e.availableFrom > todayVn
          ? `<div class="mt-1 text-[10px] font-medium text-slate-500" title="Đơn to được giữ thêm vài ngày để kịp phát hiện khách trả hàng">mở khoá ${escapeHtml(
              formatVnDateDdMm(new Date(`${e.availableFrom}T12:00:00Z`))
            )}</div>`
          : "";
      const returnedHint = debtOrderIds.has(e.orderId)
        ? `<div class="mt-1 text-[10px] font-semibold text-rose-600" title="Đơn này bị trả hàng sau khi đã trả tiền cho user - thành nợ, trừ khi user rút tiền lần sau">⚠ đã trả hàng</div>`
        : "";
      const statusDetail = `${heldHint}${returnedHint}`;

      // Hoa hong GOC san tra (2026-10-10), chua tru thue/phi/chia %. Don pending co nut but chi sang
      // trang sua (khong nhet nut vao cot "Thao tac": cot do dang sat mep man hinh). Don da sua tay
      // co dong phu de admin biet so nay KHONG con chay theo bao cao Shopee nua.
      const commissionClass = voided ? "text-slate-400 line-through" : "font-medium text-slate-700";
      const editCommissionLink =
        e.status === "pending"
          ? `<a class="text-slate-400 transition hover:text-indigo-600" href="/admin/orders/${e.id}/commission" title="Sửa hoa hồng gốc" aria-label="Sửa hoa hồng gốc đơn ${escapeHtml(e.orderId)}">${icon("edit-3", "h-3.5 w-3.5")}</a>`
          : "";
      const overriddenHint =
        e.commissionOverriddenAt !== null && e.status === "pending"
          ? `<div class="mt-1 text-[10px] font-medium text-indigo-600" title="Admin đã sửa tay - import báo cáo Shopee sau sẽ không ghi đè số này">✎ đã sửa tay</div>`
          : "";
      const commissionCell = `<div class="flex items-center justify-end gap-1.5"><span class="${commissionClass}">${formatVnd(e.commissionAmount)}</span>${editCommissionLink}</div>${overriddenHint}`;

      return `<tr class="transition hover:bg-slate-50/80">
  <td class="px-4 py-3.5">
    <div class="flex items-center gap-1.5 font-semibold text-slate-800">
      <span>${escapeHtml(e.orderId)}</span>
      ${copyIconButton(e.orderId, `Sao chép mã đơn ${e.orderId}`)}
    </div>
    <div class="mt-0.5 text-[11px] text-slate-400 tabular-nums">${escapeHtml(when.time)} • ${escapeHtml(when.date)}</div>
  </td>
  <td class="px-4 py-3.5">
    <div class="font-medium text-slate-800">${nameCell(displayName)}</div>
    <div class="mt-0.5 text-[11px] text-slate-400">ID: ${escapeHtml(e.userId)}</div>
  </td>
  <td class="px-4 py-3.5">
    <div class="flex items-center gap-1.5">
      <span class="inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium ${merchantChipClass(e.merchant)}">${getMerchantConfig(e.merchant).displayName}</span>
      ${platformChip(e.platform)}
    </div>
  </td>
  <td class="max-w-[200px] px-4 py-3.5">${product}</td>
  <td class="px-4 py-3.5 text-right tabular-nums">${commissionCell}</td>
  <td class="px-4 py-3.5 text-right font-medium text-slate-600 tabular-nums">${lockedShare}</td>
  <td class="px-4 py-3.5 text-right tabular-nums ${userMoneyClass}">${formatVnd(e.userShareAmount)}</td>
  <td class="px-4 py-3.5 text-right tabular-nums ${ownerMoneyClass}">${formatVnd(e.afterTaxAmount - e.userShareAmount)}</td>
  <td class="px-4 py-3.5 text-center">
    ${statusPill(badge)}${statusDetail}
  </td>
  <td class="px-4 py-3.5 text-right">${reverseLink}</td>
</tr>`;
    })
    .join("\n");

  // Chua loc gi = tick san TAT CA (yeu cau truc tiep cua user 2026-09-22). Bo tick het cung tuong
  // duong "tat ca" o phia server (statuses rong = khong loc), nen 2 trang thai nay cung mot nhan.
  const checkedStatuses = filters.statuses && filters.statuses.length > 0 ? filters.statuses : STATUS_OPTIONS;

  // Dropdown thu gon (<details> + panel) thay cho hang checkbox trai ngang - logic ben trong duoc
  // test qua src/api/__tests__/ordersStatusDropdown.test.ts (chay script nay tren DOM gia).
  const statusDropdownScript = `<script>
(function () {
  var dropdown = document.getElementById("status-dropdown");
  if (!dropdown) return;
  var summary = document.getElementById("status-summary");
  var boxes = Array.prototype.slice.call(dropdown.querySelectorAll("input[type=checkbox]"));
  function refresh() {
    var checked = boxes.filter(function (b) { return b.checked; });
    if (checked.length === 0 || checked.length === boxes.length) summary.textContent = "Tất cả";
    else if (checked.length === 1) summary.textContent = checked[0].dataset.label;
    else summary.textContent = checked.length + " trạng thái";
  }
  boxes.forEach(function (b) { b.addEventListener("change", refresh); });
  // <details> khong tu dong dong khi bam ra ngoai - phai tu xu ly, neu khong panel se che mat bang.
  document.addEventListener("click", function (e) {
    if (dropdown.open && !dropdown.contains(e.target)) dropdown.open = false;
  });
  refresh();
})();
</script>`;

  // 4 the KPI tinh TREN DUNG bo loc dang ap (xem LedgerStore.getOrdersFilterTotals). Dong ghi chu
  // thu ba cua moi the la BAT BUOC chu khong phai trang tri: 2 the tien khong tinh don huỷ, va neu
  // khong noi ra thi admin loc rieng trang thai "Đã huỷ" se thay "0 đ" ma khong hieu tai sao.
  // KHONG dat ten the la "Doanh thu Admin (20%)" nhu design ref: % gio chot theo TUNG don (cot
  // "% chốt" ngay trong bang), nen in mot con so % co dinh vao tieu de la noi sai ngay tren trang
  // chung minh dieu nguoc lai.
  const kpiRow = kpiGrid([
    kpiCard({
      label: "Tổng số đơn hàng",
      value: String(totals.totalEntries),
      note: "theo bộ lọc đang áp",
      icon: "package",
      valueClass: "text-slate-800",
      iconClass: "bg-slate-100 text-slate-600",
    }),
    kpiCard({
      label: "Đơn chờ xác nhận",
      value: String(totals.pendingEntries),
      note: "chờ Shopee duyệt",
      icon: "clock",
      valueClass: "text-amber-600",
      iconClass: "bg-amber-50 text-amber-600",
    }),
    kpiCard({
      label: "Hoàn tiền khách nhận",
      value: formatVnd(totals.userShareTotal),
      note: "không tính đơn đã huỷ",
      icon: "coins",
      valueClass: "text-emerald-600",
      iconClass: "bg-emerald-50 text-emerald-600",
    }),
    kpiCard({
      label: "Lợi nhuận chủ bot",
      value: formatVnd(totals.ownerShareTotal),
      note: "không tính đơn đã huỷ",
      icon: "trending-up",
      valueClass: "text-indigo-600",
      iconClass: "bg-indigo-50 text-indigo-600",
    }),
  ]);

  // Form GET khong co input "page" -> moi lan bam Loc tu dong ve trang 1 (co chu dich: doi bo loc
  // thi so trang cu khong con y nghia). `userId` van la input AN: do la bo loc khop CHINH XAC do
  // /admin/users bam sang, khac o tim mot dong ben duoi - bam Loc khong duoc lam mat no.
  // Khong co preflight nen MOI control phai tu mang day du vien + nen + bo goc, khong thua gi tu
  // reset (W9). `appearance-none` + mui nhon tu ve cho <select> de 3 o loc cao bang nhau va trong
  // giong nhau tren moi he dieu hanh - select goc cua Safari macOS cao hon va bo goc khac.
  // Form GET khong co input "page" -> moi lan bam Loc tu dong ve trang 1 (co chu dich: doi bo loc
  // thi so trang cu khong con y nghia). `userId` van la input AN: do la bo loc khop CHINH XAC do
  // /admin/users bam sang, khac o tim mot dong ben duoi - bam Loc khong duoc lam mat no. FIELD_CLASS/
  // FIELD_LABEL_CLASS/SELECT_CHEVRON_CLASS dinh nghia o dau file (W9: moi control phai tu mang du
  // vien+nen+bo goc vi khong co preflight).
  const filterForm = `<form method="GET" action="/admin/orders" class="mb-5 flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
  <div class="flex flex-wrap items-end gap-3">
    <div class="w-full sm:w-72">
      <label class="${FIELD_LABEL_CLASS}" for="orders-q">Tìm kiếm</label>
      <div class="relative">
        ${icon("search", "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400")}
        <input type="search" id="orders-q" name="q" value="${escapeHtml(filters.search ?? "")}" placeholder="Tìm theo mã đơn, tên hoặc user ID..." class="${FIELD_CLASS} pl-9">
      </div>
    </div>
    <div class="w-full sm:w-40">
      <label class="${FIELD_LABEL_CLASS}" for="orders-platform">Kênh</label>
      <select id="orders-platform" name="platform" class="${FIELD_CLASS} ${SELECT_CHEVRON_CLASS}">${selectOptions(
        PLATFORM_OPTIONS,
        (v) => PLATFORM_LABELS[v],
        filters.platform
      )}</select>
    </div>
    <div class="w-full sm:w-40">
      <label class="${FIELD_LABEL_CLASS}" for="orders-merchant">Sàn</label>
      <select id="orders-merchant" name="merchant" class="${FIELD_CLASS} ${SELECT_CHEVRON_CLASS}">${selectOptions(
        MERCHANTS.map((m) => m.id),
        (id) => getMerchantConfig(id).displayName,
        filters.merchant
      )}</select>
    </div>
    <div class="w-full sm:w-auto">
      <label class="${FIELD_LABEL_CLASS}">Trạng thái</label>
      <details class="dropdown-check" id="status-dropdown">
        <summary><span id="status-summary">${escapeHtml(statusSummaryLabel(checkedStatuses))}</span></summary>
        <div class="dropdown-panel">${STATUS_OPTIONS.map(
          (s) =>
            `<label><input type="checkbox" name="status" value="${s}" data-label="${escapeHtml(
              STATUS_LABELS[s]
            )}"${checkedStatuses.includes(s) ? " checked" : ""}> ${STATUS_LABELS[s]}</label>`
        ).join("")}</div>
      </details>
    </div>
  </div>
  ${filters.userId ? `<input type="hidden" name="userId" value="${escapeHtml(filters.userId)}">` : ""}
  <button type="submit" class="inline-flex w-full shrink-0 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 sm:w-auto">
    ${icon("search", "h-3.5 w-3.5")} Lọc
  </button>
</form>`;

  const hasFilter = Boolean(
    filters.search || filters.platform || filters.merchant || filters.userId || filters.statuses?.length
  );
  const emptyState = `<div class="px-5 py-14 text-center">
  <div class="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">${icon(
    "package",
    "h-5 w-5"
  )}</div>
  <div class="mb-1 text-sm font-semibold text-slate-700">${
    hasFilter ? "Không có đơn nào khớp bộ lọc" : "Chưa có đơn hàng nào"
  }</div>
  <p class="m-0 text-xs text-slate-500">${
    hasFilter
      ? "Thử bỏ bớt điều kiện lọc, hoặc xoá nội dung trong ô tìm kiếm."
      : 'Đơn sẽ xuất hiện ở đây sau khi bạn import báo cáo Shopee ở trang <a class="font-semibold text-indigo-600 no-underline hover:underline" href="/admin/record-orders">Ghi nhận đơn hàng</a>.'
  }</p>
</div>`;

  // Dong "Hiển thị x–y trên tổng số z": can nguoi doc biet minh dang xem khuc nao cua tap ket qua.
  // Chan duoi lay theo so dong THAT SU render (entries.length) chu khong phai page * PAGE_SIZE -
  // trang cuoi thuong khong day, tinh theo cong thuc se bao thua don.
  const firstIndex = (pagination.page - 1) * ORDERS_PAGE_SIZE + 1;
  const lastIndex = firstIndex + entries.length - 1;
  const rangeText = `Hiển thị <strong class="font-semibold text-slate-800 tabular-nums">${firstIndex} – ${lastIndex}</strong> trên tổng số <strong class="font-semibold text-slate-800 tabular-nums">${pagination.totalEntries}</strong> đơn hàng`;

  const thClass = "px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500";
  const table = `<div class="table-scroll">
    <table class="w-full border-collapse whitespace-nowrap text-xs">
      <thead class="border-b border-slate-200 bg-slate-50">
        <tr>
          <th class="${thClass}">Mã đơn &amp; thời gian</th>
          <th class="${thClass}">Khách hàng</th>
          <th class="${thClass}">Sàn / Kênh</th>
          <th class="${thClass}">Sản phẩm</th>
          <th class="${thClass} !text-right" title="Hoa hồng Shopee trả, trước khi trừ thuế/phí và chia %">Hoa hồng gốc</th>
          <th class="${thClass} !text-right">% chốt</th>
          <th class="${thClass} !text-right">Khách nhận</th>
          <th class="${thClass} !text-right">Chủ bot nhận</th>
          <th class="${thClass} !text-center">Trạng thái</th>
          <th class="${thClass} !text-right">Thao tác</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100">${rows}</tbody>
    </table>
  </div>
  <div class="flex flex-col items-start justify-between gap-3 border-t border-slate-200 px-4 py-3.5 text-xs text-slate-500 sm:flex-row sm:items-center">
    <div>${rangeText}</div>
    ${renderPagination(filters, pagination)}
  </div>`;

  const body = `${kpiRow}
${filterForm}
${statusDropdownScript}
<div class="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
${entries.length > 0 ? table : emptyState}
</div>`;

  return adminShell("orders", "Đơn hàng", body, pendingWithdrawals);
}

export function renderReverseConfirmPage(
  entry: CommissionEntry,
  displayName?: string | null,
  blockedMessage?: string | null,
  /** So yeu cau rut dang cho - chi de hien badge tren muc nav, xem adminShell(). */
  pendingWithdrawals?: number
): string {
  const who = displayName ? `${escapeHtml(displayName)} (${escapeHtml(entry.platform)} / ${escapeHtml(entry.userId)})` : `${escapeHtml(entry.platform)} / ${escapeHtml(entry.userId)}`;
  const info = `<p class="muted">${who} — ${getMerchantConfig(entry.merchant).displayName} — ${formatVnd(entry.userShareAmount)}</p>`;

  const content = blockedMessage
    ? `${info}<div class="error">${escapeHtml(blockedMessage)}</div>`
    : `${info}<form method="POST" action="/admin/orders/${entry.id}/reverse" ${confirmOnSubmit(`Xác nhận HUỶ đơn ${entry.orderId} (${formatVnd(entry.userShareAmount)})? Hành động này không thể hoàn tác.`)}>
  <label class="muted" for="reason">Lý do huỷ (bắt buộc)</label>
  <textarea id="reason" name="reason" required placeholder="Vd: đơn bị hoàn hàng, khách huỷ..."></textarea>
  <button type="submit" class="primary">Xác nhận huỷ đơn</button>
</form>`;

  const body = `<div class="card">
<h2>Huỷ đơn hàng ${escapeHtml(entry.orderId)}</h2>
${content}
</div>`;

  return adminShell("orders", "Huỷ đơn hàng", body, pendingWithdrawals);
}

export interface EditCommissionPreview {
  commissionAmount: number;
  percents: RatePercents;
  breakdown: CommissionBreakdown;
}

/**
 * Trang sua tay hoa hong goc cua 1 don "Cho xac nhan" (2026-10-10). Trang RIENG (cung kieu trang Huy
 * don) thay vi nhoi form vao hang bang: can cho cho bang "xem truoc" khach/chu bot se nhan bao nhieu
 * va nut bo khoa. Ban xem truoc do SERVER tinh bang computeCommissionBreakdown (qua GET ?commissionAmount=)
 * chu khong lap lai phep lam tron bang JS - 2 noi tinh khac nhau thi trang hua 1 so, luc luu ra so khac.
 */
export function renderEditCommissionPage(input: {
  entry: CommissionEntry;
  displayName?: string | null;
  /** Co gia tri = khong cho sua (don khong con pending). */
  blockedMessage?: string | null;
  errorMessage?: string | null;
  preview?: EditCommissionPreview | null;
  /** Gia tri admin vua go (de giu lai o input khi loi / xem truoc). */
  inputValue?: string;
  pendingWithdrawals?: number;
}): string {
  const e = input.entry;
  const who = input.displayName
    ? `${escapeHtml(input.displayName)} (${escapeHtml(e.platform)} / ${escapeHtml(e.userId)})`
    : `${escapeHtml(e.platform)} / ${escapeHtml(e.userId)}`;
  const info = `<p class="muted">${who} — ${getMerchantConfig(e.merchant).displayName} — giá trị đơn ${formatVnd(e.orderAmount)}${
    e.productName ? ` — ${escapeHtml(e.productName)}` : ""
  }</p>`;

  const ownerOf = (afterTax: number, user: number) => afterTax - user;
  const previewTable = input.preview
    ? (() => {
        const p = input.preview;
        const b = p.breakdown;
        const row = (label: string, now: number, next: number) =>
          `<tr><td>${label}</td><td style="text-align:right">${formatVnd(now)}</td><td style="text-align:right"><strong>${formatVnd(next)}</strong></td></tr>`;
        return `<table>
<thead><tr><th></th><th style="text-align:right">Hiện tại</th><th style="text-align:right">Sau khi sửa</th></tr></thead>
<tbody>
${row("Hoa hồng gốc (sàn trả)", e.commissionAmount, p.commissionAmount)}
${row(`Thuế (${p.percents.taxPercent}%)`, e.taxAmount, b.taxAmount)}
${row(`Phí sàn (${p.percents.platformFeePercent}%)`, e.platformFeeAmount, b.platformFeeAmount)}
${row(`Khách nhận (${p.percents.userSharePercent}%)`, e.userShareAmount, b.userShareAmount)}
${row("Chủ bot nhận", ownerOf(e.afterTaxAmount, e.userShareAmount), b.botShareAmount)}
</tbody></table>
<p class="muted">Tính theo tỉ lệ đã chốt của riêng đơn này, không theo % hiện hành ở Cài đặt.</p>`;
      })()
    : "";

  const errorBlock = input.errorMessage ? `<div class="error">${escapeHtml(input.errorMessage)}</div>` : "";
  const action = `/admin/orders/${e.id}/commission`;
  const lockNote =
    e.commissionOverriddenAt !== null
      ? `<p class="help">Đơn này đang <strong>khoá</strong> hoa hồng ở ${formatVnd(e.commissionAmount)} (admin sửa tay). Import báo cáo Shopee sau vẫn đổi trạng thái đơn nhưng giữ số này, và báo ở mục cảnh báo nếu Shopee ghi số khác.</p>`
      : `<p class="help">Sau khi lưu, số này được <strong>khoá</strong>: import báo cáo Shopee sau sẽ không ghi đè (chỉ báo cảnh báo nếu Shopee ghi số khác). Khi đơn chuyển "Khả dụng", user nhận tiền theo số đã khoá.</p>`;
  const unlockForm =
    e.commissionOverriddenAt !== null
      ? `<form method="POST" action="${action}" class="form-secondary" ${confirmOnSubmit("Bỏ khoá? Số tiền hiện tại giữ nguyên cho tới lần import báo cáo Shopee kế tiếp, khi đó sẽ lấy lại số của Shopee.")}>
  <input type="hidden" name="action" value="unlock">
  <button type="submit" class="danger">Bỏ khoá, dùng lại số của Shopee ở lần import sau</button>
</form>`
      : "";

  const content = input.blockedMessage
    ? `${info}<div class="error">${escapeHtml(input.blockedMessage)}</div><p><a class="link" href="/admin/orders">Quay lại</a></p>`
    : `${info}${errorBlock}
<form method="POST" action="${action}" class="settings-form">
  <div class="field">
    <label for="commissionAmount">Hoa hồng gốc (đ)</label>
    <input type="number" id="commissionAmount" name="commissionAmount" min="0" step="any" value="${escapeHtml(
      input.inputValue ?? String(e.commissionAmount)
    )}" required>
    ${lockNote}
  </div>
  ${previewTable ? `<div class="field">${previewTable}</div>` : ""}
  <div class="actions actions-row">
    <button type="submit" name="action" value="save" class="primary">Lưu</button>
    <button type="submit" class="secondary" formmethod="GET" formaction="${action}">Xem trước</button>
    <a class="link" href="/admin/orders">Quay lại</a>
  </div>
</form>
${unlockForm}`;

  return adminShell(
    "orders",
    "Sửa hoa hồng gốc",
    `<div class="card">
<h2>Sửa hoa hồng gốc — đơn ${escapeHtml(e.orderId)}</h2>
${content}
</div>`,
    input.pendingWithdrawals
  );
}

export interface SingleOrderFormResult {
  ok: boolean;
  message: string;
}

const ACTION_TYPE_LABELS: Record<ImportHistoryEntry["actionType"], string> = {
  csv: "Import CSV (báo cáo Shopee)",
  single: "Ghi 1 đơn lẻ (form)",
};

export function renderRecordOrdersPage(
  history: ImportHistoryEntry[],
  singleResult?: SingleOrderFormResult | null,
  shopeeReportResult?: ShopeeReportImportResult | null,
  shopeeReportError?: string | null,
  /** So yeu cau rut dang cho - chi de hien badge tren muc nav, xem adminShell(). */
  pendingWithdrawals?: number
): string {
  // Banner thanh cong/loi - cung mot kieu dang dung o withdrawals/orders (vien+nen nhat theo mau,
  // chu dam mau). KHONG dung lai .success/.error cua CSS cu: 2 class do khong co trong .card moi
  // (chung chi duoc test voi nen trang cua CSS tay, mau se sai tren nen trang cua Tailwind).
  const banner = (tone: "success" | "error", message: string): string => {
    const cls =
      tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-rose-200 bg-rose-50 text-rose-700";
    return `<div class="mb-4 rounded-lg border ${cls} px-3.5 py-2.5 text-xs font-medium">${escapeHtml(message)}</div>`;
  };

  const singleBlock = singleResult ? banner(singleResult.ok ? "success" : "error", singleResult.message) : "";

  // Nhan form kieu doc (label thuong, khong viet hoa) - KHAC FIELD_LABEL_CLASS (nhan toolbar viet
  // hoa nho dung o /admin/orders, /admin/users): hai ngu canh khac nhau, mot cai la nhan loc tren
  // thanh cong cu, cai nay la nhan cua 1 form nhap lieu doc - ep dung chung se sai ca hai noi.
  const fieldLabel = (forId: string, text: string, required = true): string =>
    `<label class="mb-1 block text-xs font-medium text-slate-700" for="${forId}">${escapeHtml(text)} ${
      required
        ? '<span class="text-rose-500">*</span>'
        : '<span class="font-normal text-slate-400">(Tuỳ chọn)</span>'
    }</label>`;

  const singleCard = `<div class="rounded-xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.03)] lg:col-span-7">
  <div class="mb-5 flex items-center justify-between border-b border-slate-100 pb-4">
    <div>
      <h2 class="flex items-center gap-2 text-sm font-bold text-slate-900">${icon(
        "edit-3",
        "h-4 w-4 text-indigo-600"
      )} Ghi 1 đơn lẻ thủ công</h2>
      <p class="mt-0.5 text-xs text-slate-500">Nhập trực tiếp đơn phát sinh ngoài luồng hoặc bù hoa hồng</p>
    </div>
    <span class="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">Single Entry</span>
  </div>
  ${singleBlock}
  <form method="POST" action="/admin/record-orders/single" class="space-y-4 text-xs" ${confirmOnSubmit(
    "Xác nhận ghi nhận đơn hàng này vào hệ thống? Số liệu sẽ dùng để tính hoa hồng cho user."
  )}>
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div>
        ${fieldLabel("subId", "SubID người dùng")}
        <input type="text" id="subId" name="subId" placeholder="vd: telegram-566659887-abc123-def456" required class="${FIELD_CLASS} font-mono">
      </div>
      <div>
        ${fieldLabel("orderId", "Mã đơn (Order ID)")}
        <input type="text" id="orderId" name="orderId" placeholder="vd: 261003K7001S1D" required class="${FIELD_CLASS} font-mono">
      </div>
    </div>
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div>
        ${fieldLabel("orderAmount", "Giá trị đơn hàng (VNĐ)")}
        <div class="relative">
          <input type="text" inputmode="numeric" id="orderAmount" name="orderAmount" placeholder="0" required class="${FIELD_CLASS} pr-8">
          <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400">đ</span>
        </div>
      </div>
      <div>
        ${fieldLabel("commissionAmount", "Hoa hồng gốc (sàn trả)")}
        <div class="relative">
          <input type="text" inputmode="numeric" id="commissionAmount" name="commissionAmount" placeholder="0" required class="${FIELD_CLASS} pr-8">
          <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400">đ</span>
        </div>
      </div>
    </div>
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div>
        ${fieldLabel("productName", "Tên sản phẩm", false)}
        <input type="text" id="productName" name="productName" placeholder="Nhập tên mặt hàng..." class="${FIELD_CLASS}">
      </div>
      <div>
        <label class="mb-1 block text-xs font-medium text-slate-700" for="status">Trạng thái ghi nhận</label>
        <select id="status" name="status" class="${FIELD_CLASS} ${SELECT_CHEVRON_CLASS}">
          <option value="confirmed" selected>Khả dụng (cộng ngay vào ví)</option>
          <option value="pending">Chờ xác nhận</option>
        </select>
      </div>
    </div>
    <div>
      ${fieldLabel("single-note", "Ghi chú nội bộ", false)}
      <input type="text" id="single-note" name="note" placeholder="Lý do ghi nhận bù, đơn phát sinh qua chat..." class="${FIELD_CLASS}">
    </div>
    <div class="flex justify-end pt-1">
      <button type="submit" class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
        ${icon("plus-circle", "h-4 w-4")} Ghi nhận đơn
      </button>
    </div>
  </form>
</div>`;

  const shopeeReportErrorBlock = shopeeReportError ? banner("error", shopeeReportError) : "";

  // Toast chi hien khi import THAT SU chay xong (co ket qua tra ve, khong phai loi truoc khi xu ly
  // nhu "chua chon file" - truong hop do da co shopeeReportErrorBlock rieng, khong can toast).
  const shopeeReportToast = shopeeReportResult
    ? successToast(
        shopeeReportResult.newOrderIds.length > 0 || shopeeReportResult.statusTransitions.length > 0
          ? `Import thành công: ${shopeeReportResult.newOrderIds.length} đơn mới, ${shopeeReportResult.statusTransitions.length} đơn cập nhật trạng thái.`
          : "Import hoàn tất: không có đơn nào thay đổi."
      )
    : "";

  // 1 dong thong ke = 1 the nho trong luoi 2 cot. Gop lai o day thay vi viet 8 lan giong het nhau.
  const statRow = (label: string, value: number): string =>
    `<div class="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
      <dt class="text-slate-500">${label}</dt>
      <dd class="font-semibold tabular-nums text-slate-800">${value}</dd>
    </div>`;

  const shopeeReportResultBlock = shopeeReportResult
    ? `<div class="mt-4 border-t border-slate-100 pt-4">
    <dl class="grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2">
      ${statRow("Số đơn quét được", shopeeReportResult.ordersScanned)}
      ${statRow(`Ghi mới "Khả dụng" (trùng bỏ qua ${shopeeReportResult.confirmedDuplicate})`, shopeeReportResult.confirmedNew)}
      ${statRow(`Ghi mới "Chờ xác nhận" (cập nhật lại ${shopeeReportResult.pendingUpdated})`, shopeeReportResult.pendingNew)}
      ${statRow("Đã huỷ (đơn huỷ / không hợp lệ)", shopeeReportResult.reversedCount)}
      ${statRow("Đơn nhiều sản phẩm đã gộp", shopeeReportResult.mergedMultiItem)}
      ${statRow("Bỏ qua - không tách được subId", shopeeReportResult.skippedNoSubId)}
      ${statRow("Bỏ qua - subId không khớp user", shopeeReportResult.skippedSubIdNotFound)}
      ${statRow("Bỏ qua - trạng thái lạ", shopeeReportResult.skippedUnknownStatus)}
    </dl>
    ${
      shopeeReportResult.errors.length > 0
        ? `<div class="mt-3 max-h-32 overflow-y-auto rounded-lg border border-amber-200/60 bg-amber-50/60 p-2.5">
          <ul class="space-y-1 text-[11px] text-amber-800">
            ${shopeeReportResult.errors.map((e) => `<li>• ${escapeHtml(e)}</li>`).join("\n")}
          </ul>
        </div>`
        : ""
    }
  </div>`
    : "";

  const shopeeReportCard = `<div class="flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.03)] lg:col-span-5">
  <div class="space-y-3">
    <div class="flex items-center gap-2">
      <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-orange-100 bg-orange-50 text-xs font-bold text-orange-600">S</div>
      <div>
        <h2 class="text-sm font-bold text-slate-900">Import báo cáo Shopee Affiliate</h2>
        <span class="text-[11px] text-slate-500">Tự động gộp mã đơn &amp; trích xuất hoa hồng</span>
      </div>
    </div>
    ${shopeeReportErrorBlock}
    <div class="space-y-1 rounded-lg border border-amber-200/60 bg-amber-50/70 p-3 text-[11px] text-amber-800">
      <div class="flex items-center gap-1 font-semibold text-amber-900">${icon(
        "alert-circle",
        "h-3.5 w-3.5"
      )} Quy định file tải lên:</div>
      <p>• File gốc xuất từ: <code class="rounded bg-amber-100/60 px-1 py-0.5 font-mono text-[10px]">affiliate.shopee.vn/report</code></p>
      <p>• Giữ nguyên tên file dạng <code class="rounded bg-amber-100/60 px-1 py-0.5 font-mono text-[10px]">AffiliateCommissionReport_*.csv</code></p>
      <p>• Đơn nhiều mặt hàng sẽ tự động gộp thành 1 bản ghi chính xác.</p>
    </div>
    <form method="POST" action="/admin/record-orders/shopee-report" enctype="multipart/form-data" ${confirmOnSubmit(
      "Xác nhận import file báo cáo Shopee này? Sẽ ghi nhận/cập nhật đơn hàng vào hệ thống."
    )}>
      <!--
        O chon file la 1 INPUT THAT, trai rong TOAN BO vung keo-tha (position:absolute inset-0,
        opacity-0) thay vi an bang sr-only: lam vay thi (1) keo-tha file tu may vao vung nay hoat
        dong qua co che goc cua trinh duyet, khong can JS rieng cho drop; (2) bubble "vui long chon
        file" (thuoc tinh required) neo dung vao ca vung to, khong phai mot diem 1px o goc man hinh
        nhu khi dung sr-only. Cac phan tu con deu them pointer-events-none de click luon roi xuong
        dung input ben duoi.
      -->
      <div id="shopee-dropzone" class="group relative cursor-pointer rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/50 p-6 text-center transition hover:border-indigo-500 hover:bg-indigo-50/20">
        <input type="file" id="shopee-file" name="file" accept=".csv,text/csv" required class="absolute inset-0 h-full w-full cursor-pointer opacity-0" data-dropzone-input>
        <div class="pointer-events-none mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 transition group-hover:scale-110">${icon(
          "file-up",
          "h-5 w-5"
        )}</div>
        <div class="pointer-events-none mt-2 text-xs font-semibold text-slate-700" data-dropzone-label>Kéo thả file CSV vào đây hoặc <span class="text-indigo-600 underline">chọn từ máy tính</span></div>
        <p class="pointer-events-none mt-1 text-[11px] text-slate-400">Định dạng hỗ trợ: .CSV (dung lượng tối đa 15MB)</p>
      </div>
      <button type="submit" class="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600">
        ${icon("upload-cloud", "h-4 w-4")} Tiến hành import CSV
      </button>
    </form>
    ${shopeeReportResultBlock}
  </div>
</div>`;

  // Nhan "Loai" cua 1 lan ghi nhan: cam (Shopee) cho import CSV, trung tinh cho form don le - dung
  // CUNG cap mau da dung lam chip merchant Shopee o /admin/orders (xem merchantChipClass), vi day
  // van la "lien quan Shopee" chu khong phai mot nghia mau moi.
  const actionTypeChip = (type: ImportHistoryEntry["actionType"]): string => {
    const cls =
      type === "csv"
        ? "border-orange-100 bg-orange-50 text-orange-600"
        : "border-slate-200 bg-slate-100 text-slate-700";
    return `<span class="inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium ${cls}">${escapeHtml(
      ACTION_TYPE_LABELS[type]
    )}</span>`;
  };

  /** Danh sach ma don dang chip nho, boc dong duoc - khac cac bang khac (whitespace-nowrap) vi 1 lan
   *  import CSV co the ra hang chuc ma don, ep tren 1 dong se keo bang rong vo han. */
  const orderIdChips = (ids: string[]): string =>
    ids.length > 0
      ? `<div class="flex max-w-xs flex-wrap gap-1">${ids
          .map(
            (id) =>
              `<span class="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">${escapeHtml(
                id
              )}</span>`
          )
          .join("")}</div>`
      : `<span class="text-slate-300">—</span>`;

  const transitionsCell = (transitions: ImportHistoryEntry["statusTransitions"]): string =>
    transitions.length > 0
      ? `<div class="space-y-1">${transitions
          .map(
            (t) =>
              `<div class="font-mono text-[11px] text-slate-600">${escapeHtml(t.orderId)}: ${
                STATUS_LABELS[t.from]
              } → <span class="font-semibold text-slate-800">${STATUS_LABELS[t.to]}</span></div>`
          )
          .join("")}</div>`
      : `<span class="text-slate-300">—</span>`;

  const historyRows = history
    .map(
      (h) => `<tr class="transition hover:bg-slate-50/80">
  <td class="whitespace-nowrap px-6 py-3.5 align-top text-slate-600">${formatDateTime(h.createdAt)}</td>
  <td class="whitespace-nowrap px-6 py-3.5 align-top">${actionTypeChip(h.actionType)}</td>
  <td class="px-6 py-3.5 align-top">${orderIdChips(h.newOrderIds)}</td>
  <td class="px-6 py-3.5 align-top">${transitionsCell(h.statusTransitions)}</td>
</tr>`
    )
    .join("\n");

  const thClass = "px-6 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500";

  const historyPanel =
    history.length > 0
      ? `<div class="table-scroll">
    <table class="w-full border-collapse text-xs">
      <thead class="border-b border-slate-200 bg-slate-50">
        <tr>
          <th class="${thClass}">Thời gian</th>
          <th class="${thClass}">Loại</th>
          <th class="${thClass}">Đơn mới</th>
          <th class="${thClass}">Đơn đổi trạng thái</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100">${historyRows}</tbody>
    </table>
  </div>`
      : `<div class="px-5 py-14 text-center">
    <div class="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">${icon(
      "inbox",
      "h-5 w-5"
    )}</div>
    <div class="mb-1 text-sm font-semibold text-slate-700">Chưa có lượt ghi nhận nào</div>
    <p class="m-0 text-xs text-slate-500">Các giao dịch nhập đơn lẻ hoặc import file CSV sẽ được lưu nhật ký tại đây.</p>
  </div>`;

  const historyCard = `<div class="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
  <div class="flex items-center justify-between border-b border-slate-100 px-6 py-4">
    <div>
      <h2 class="flex items-center gap-2 text-sm font-bold text-slate-900">${icon(
        "history",
        "h-4 w-4 text-slate-500"
      )} Lịch sử ghi nhận đơn hàng</h2>
      <p class="mt-0.5 text-xs text-slate-500">Nhật ký các lượt ghi nhận thủ công và import file Shopee gần đây</p>
    </div>
    <a href="/admin/record-orders" title="Làm mới" aria-label="Làm mới danh sách" class="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">${icon(
      "refresh-cw",
      "h-4 w-4"
    )}</a>
  </div>
  ${historyPanel}
</div>`;

  // Keo-tha highlight: chi doi mau vien/nen cua vung drop khi dang keo file qua - khong anh huong
  // den viec file co duoc nhan hay khong (co che do la cua trinh duyet qua input[type=file] phu kin
  // ca vung, xem chu thich trong markup). Cap nhat nhan "da chon file" sau khi chon/keo tha xong.
  // Test qua src/api/__tests__/recordOrdersPageScript.test.ts (chay tren DOM gia).
  const pageScript = `<script>
(function () {
  var zone = document.getElementById("shopee-dropzone");
  var input = document.querySelector("[data-dropzone-input]");
  var label = document.querySelector("[data-dropzone-label]");
  if (!zone || !input || !label) return;
  var defaultHtml = label.innerHTML;
  function setDragging(on) {
    zone.classList.toggle("border-indigo-500", on);
    zone.classList.toggle("bg-indigo-50/20", on);
  }
  ["dragenter", "dragover"].forEach(function (evt) {
    zone.addEventListener(evt, function (e) { e.preventDefault(); setDragging(true); });
  });
  ["dragleave", "drop"].forEach(function (evt) {
    zone.addEventListener(evt, function () { setDragging(false); });
  });
  input.addEventListener("change", function () {
    var file = input.files && input.files[0];
    label.textContent = file ? file.name : "";
    if (!file) label.innerHTML = defaultHtml;
  });
})();
</script>`;

  // Thong tin tinh ve nguon du lieu ho tro - dat o dau trang (ngang hang voi luoi 2 khoi), khong
  // phai trong topbar dung chung: topbar la phan vo trang chung cho ca 6 trang, mot badge chi lien
  // quan rieng trang nay khong nen nam trong do.
  const supportBadge = `<div class="mb-5 flex justify-end">
  <span class="inline-flex items-center gap-1.5 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
    ${icon("info", "h-3.5 w-3.5")} Hỗ trợ CSV Shopee Affiliate
  </span>
</div>`;

  const body = `${shopeeReportToast}
${supportBadge}
<div class="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
  ${singleCard}
  ${shopeeReportCard}
</div>
${historyCard}
${pageScript}`;

  return adminShell("record-orders", "Ghi nhận đơn hàng", body, pendingWithdrawals);
}

/**
 * Chia SETTINGS_REGISTRY (23 gia tri) ve 1 trong 3 tab cua /admin/settings theo KEY - xem
 * renderSettingsPage(). Dung prefix/key so sanh thay vi sua tung the goi render, de them 1 setting
 * moi vao registry thi TU rot dung tab ma khong phai sua ham nay (tru tab "faq").
 */
function settingsTabOf(key: string): "faq" | "commission" | "messages" {
  if (
    key.startsWith("faq_answer_") ||
    key === SETTINGS_KEYS.faqOutOfScopeReply ||
    key === SETTINGS_KEYS.faqMuteMinutes
  ) {
    return "faq";
  }
  if (
    key === SETTINGS_KEYS.userSharePercent ||
    key === SETTINGS_KEYS.withdrawalThresholdVnd ||
    key === SETTINGS_KEYS.payoutHoldThresholdVnd ||
    key === SETTINGS_KEYS.payoutHoldDays
  ) {
    return "commission";
  }
  return "messages";
}

/**
 * Lay danh sach {{placeholder}} xuat hien trong helpText cua 1 entry - dung lam chip "bấm để chèn".
 * CO Y khong khai bao 1 danh sach rieng (vd FIELD_PLACEHOLDERS): helpText cua settingsRegistry.ts
 * da liet ke dung placeholder hop le cua tung o ("Placeholder hợp lệ: {{x}}, {{y}}."), doc lai TU DO
 * thi chip khong bao gio lech voi cau mo ta - khai bao 2 lan se co ngay luc 1 ben sua quen ben kia.
 */
function extractPlaceholders(helpText?: string): string[] {
  if (!helpText) return [];
  const found = new Set<string>();
  for (const m of helpText.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)) found.add(m[1]);
  return [...found];
}

function placeholderChipsRow(fieldId: string, placeholders: string[]): string {
  if (placeholders.length === 0) return "";
  const chips = placeholders
    .map(
      (p) =>
        `<button type="button" data-insert-target="${fieldId}" data-insert-text="{{${p}}}" class="rounded-md border border-indigo-200 bg-white px-2 py-1 font-mono text-[11px] text-indigo-700 shadow-sm transition hover:bg-indigo-50" title="Bấm để chèn vào vị trí con trỏ">{{${p}}}</button>`
    )
    .join("");
  return `<div class="mb-2 flex flex-wrap items-center gap-1.5">${chips}</div>`;
}

const SETTINGS_FIELD_LABEL_CLASS = "mb-1.5 block text-xs font-medium text-slate-600";
const SETTINGS_FIELD_CLASS =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs leading-relaxed text-slate-800 " +
  "transition outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20";

function settingControl(entry: SettingFieldConfig, value: string): string {
  if (entry.type === "number") {
    return `<input type="number" id="${entry.key}" name="${entry.key}" value="${escapeHtml(value)}"${
      entry.min !== undefined ? ` min="${entry.min}"` : ""
    }${entry.max !== undefined ? ` max="${entry.max}"` : ""} required class="${SETTINGS_FIELD_CLASS} max-w-[180px]">`;
  }
  return `<textarea id="${entry.key}" name="${entry.key}" rows="5" required class="${SETTINGS_FIELD_CLASS}">${escapeHtml(
    value
  )}</textarea>`;
}

/**
 * 1 the setting co the dong/mo (<details>), dung chung cho ca 3 tab. `badgeLabel` (so thu tu, dung
 * cho FAQ) va `badgeIcon` (dung cho 2 tab con lai) la HAI the thay nhau, khong dung ca hai cung luc.
 * `aiNote` chi co o FAQ topic (cau mo ta LLM dung de phan loai cau hoi, xem FaqTopic.description) -
 * KHONG dung tren o "ngoai pham vi" (khong phai 1 FaqTopic that) hay 2 tab khac.
 */
function settingCard(input: {
  controlId: string;
  badgeLabel?: string;
  badgeIcon?: keyof typeof ICON_PATHS;
  title: string;
  fieldLabel?: string;
  aiNote?: string;
  control: string;
  helpText?: string;
  placeholders: string[];
}): string {
  const badge = input.badgeLabel
    ? `<span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-100 text-xs font-bold text-indigo-700">${escapeHtml(
        input.badgeLabel
      )}</span>`
    : input.badgeIcon
      ? `<span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-100 text-indigo-700">${icon(
          input.badgeIcon,
          "h-3.5 w-3.5"
        )}</span>`
      : "";
  const fieldLabelBlock = input.fieldLabel
    ? `<label for="${input.controlId}" class="${SETTINGS_FIELD_LABEL_CLASS}">${escapeHtml(input.fieldLabel)}</label>`
    : "";
  const aiNoteBlock = input.aiNote
    ? `<div class="mt-3 flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-[11px] text-slate-500">
      ${icon("bot", "mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500")}
      <p class="m-0"><span class="font-medium text-slate-600">Bot nhận ra chủ đề này khi:</span> ${escapeHtml(input.aiNote)}</p>
    </div>`
    : "";
  const helpBlock = input.helpText
    ? `<p class="mt-2 text-[11px] leading-relaxed text-slate-400">${escapeHtml(input.helpText)}</p>`
    : "";
  return `<details open class="details-plain group overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
  <summary class="flex cursor-pointer list-none items-center justify-between gap-2 border-b border-slate-200/80 bg-slate-50/70 px-5 py-3">
    <span class="flex items-center gap-2.5 text-xs font-bold text-slate-800">${badge}${escapeHtml(input.title)}</span>
    ${icon("chevron-down", "h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180")}
  </summary>
  <div class="p-5">
    ${fieldLabelBlock}
    ${placeholderChipsRow(input.controlId, input.placeholders)}
    ${input.control}
    ${aiNoteBlock}
    ${helpBlock}
  </div>
</details>`;
}

const SETTINGS_TAB_BTN_CLASS = {
  active: "border-indigo-600 font-bold text-indigo-600",
  inactive: "border-transparent font-medium text-slate-400 hover:border-slate-300 hover:text-slate-700",
};

function settingsTabBtn(target: string, active: boolean, iconName: keyof typeof ICON_PATHS, label: string): string {
  // shrink-0 + whitespace-nowrap: 4 tab voi nhan dai ("Kịch bản trả lời FAQ (AI Bot)") se tu vo
  // dong trong chinh no tren man hep neu khong co 2 class nay, thanh mot hang tab cao lom khom -
  // xem .tabs-scroll o div bao ngoai (tabsBar) cho huong giai quyet (cuon ngang thay vi xuong dong).
  return `<button type="button" role="tab" aria-selected="${active}" aria-controls="settings-panel-${target}" data-settings-tab="${target}"
    class="-mb-px flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 py-3 text-xs transition ${active ? SETTINGS_TAB_BTN_CLASS.active : SETTINGS_TAB_BTN_CLASS.inactive}">
    ${icon(iconName, "h-4 w-4")} ${escapeHtml(label)}
  </button>`;
}

export function renderSettingsPage(
  currentValues: Record<string, string>,
  errorMessage?: string | null,
  successMessage?: string | null,
  zaloGroups: ZaloGroup[] = [],
  /** So yeu cau rut dang cho - chi de hien badge tren muc nav, xem adminShell(). */
  pendingWithdrawals?: number
): string {
  const errorBlock = errorMessage
    ? `<div class="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">${escapeHtml(errorMessage)}</div>`
    : "";
  const successBlock = successMessage
    ? `<div class="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">${escapeHtml(successMessage)}</div>`
    : "";

  const faqTopicById = new Map(FAQ_TOPICS.map((t) => [t.id, t]));
  let faqIndex = 0;

  const cardFor = (entry: SettingFieldConfig): string => {
    const value = currentValues[entry.key] ?? entry.default;
    const control = settingControl(entry, value);
    const placeholders = entry.type === "number" ? [] : extractPlaceholders(entry.helpText);

    if (entry.key.startsWith("faq_answer_")) {
      faqIndex += 1;
      const topicId = entry.key.slice("faq_answer_".length);
      const topic = faqTopicById.get(topicId);
      return settingCard({
        controlId: entry.key,
        badgeLabel: String(faqIndex),
        title: topic ? topic.label : entry.label.replace(/^FAQ — /, ""),
        fieldLabel: "Kịch bản câu trả lời gửi cho User:",
        aiNote: topic?.description,
        control,
        helpText: entry.helpText,
        placeholders,
      });
    }
    if (entry.key === SETTINGS_KEYS.faqOutOfScopeReply) {
      return settingCard({
        controlId: entry.key,
        badgeIcon: "alert-circle",
        title: "Khi không nhận ra chủ đề nào ở trên",
        fieldLabel: "Kịch bản câu trả lời gửi cho User:",
        control,
        helpText: entry.helpText,
        placeholders,
      });
    }
    if (entry.key === SETTINGS_KEYS.faqMuteMinutes) {
      return settingCard({
        controlId: entry.key,
        badgeIcon: "clock",
        title: entry.label,
        control,
        helpText: entry.helpText,
        placeholders,
      });
    }
    if (entry.key === SETTINGS_KEYS.userSharePercent) {
      return settingCard({ controlId: entry.key, badgeIcon: "percent", title: entry.label, control, helpText: entry.helpText, placeholders });
    }
    if (entry.key === SETTINGS_KEYS.withdrawalThresholdVnd) {
      return settingCard({ controlId: entry.key, badgeIcon: "wallet", title: entry.label, control, helpText: entry.helpText, placeholders });
    }
    return settingCard({
      controlId: entry.key,
      badgeIcon: "send",
      title: entry.label,
      control,
      helpText: entry.helpText,
      placeholders,
    });
  };

  const faqCards: string[] = [];
  const commissionCards: string[] = [];
  const messageCards: string[] = [];
  for (const entry of SETTINGS_REGISTRY) {
    const tab = settingsTabOf(entry.key);
    const card = cardFor(entry);
    if (tab === "faq") faqCards.push(card);
    else if (tab === "commission") commissionCards.push(card);
    else messageCards.push(card);
  }

  const saveConfirm = confirmOnSubmit(
    "Xác nhận lưu thay đổi cấu hình này? Áp dụng ngay lập tức, không cần khởi động lại bot."
  );

  // id rieng de pageScript an di khi dang o tab "notify-groups" - CUNG LY DO voi settings-bottom-bar
  // ben duoi: nut nay nop #settings-form, khong co y nghia gi tren tab chi hien danh sach group Zalo.
  const topBar = `<div id="settings-top-bar" class="mb-6 flex flex-wrap items-center justify-between gap-3">
  <div id="settings-dirty-bar" style="display:none" class="flex items-center gap-2 text-xs text-slate-500">
    <span class="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true"></span>
    Thay đổi chưa lưu: <span id="settings-dirty-count" class="font-semibold text-amber-600">0</span>
  </div>
  <button type="submit" class="ml-auto inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700">
    ${icon("save", "h-4 w-4")} Lưu cấu hình
  </button>
</div>`;

  // id rieng de pageScript an di khi dang o tab "notify-groups" - tab do co form/nut Luu RIENG
  // (POST /admin/settings/zalo-groups), nut nay chi thuoc 3 tab con lai cua #settings-form.
  const bottomBar = `<div id="settings-bottom-bar" class="flex items-center justify-between border-t border-slate-200 pt-4">
  <span class="text-[11px] text-slate-400">Thay đổi áp dụng ngay cho bot, không cần khởi động lại.</span>
  <button type="submit" class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700">
    ${icon("save", "h-4 w-4")} Lưu tất cả thay đổi
  </button>
</div>`;

  // overflow-x-auto: 4 nhan tab cong lai dai hon 375px (man hinh Zalo/Chrome mobile - xem man hinh
  // CHINH trong CLAUDE.md phan handbookHtml.ts), nen cho cuon ngang thay vi de tung nhan tu xuong
  // dong trong chinh no (da gap that, sua bang shrink-0 + whitespace-nowrap tren settingsTabBtn()).
  const tabsBar = `<div class="mb-6 overflow-x-auto border-b border-slate-200">
  <div class="flex w-max min-w-full gap-7 text-xs font-semibold" role="tablist">
    ${settingsTabBtn("faq", true, "message-square", "Kịch bản trả lời FAQ (AI Bot)")}
    ${settingsTabBtn("commission", false, "sliders", "Hoa hồng & rút tiền")}
    ${settingsTabBtn("messages", false, "send", "Mẫu tin nhắn bot")}
    ${settingsTabBtn("notify-groups", false, "bell", "Thông báo nhóm Zalo")}
  </div>
</div>`;

  // Tabs + dem thay doi chua luu + chen bien. Tat ca client-side, khong reload.
  // Logic duoc test qua src/api/__tests__/settingsPageScript.test.ts (chay script tren DOM gia).
  const pageScript = `<script>
(function () {
  var tabs = Array.prototype.slice.call(document.querySelectorAll("[data-settings-tab]"));
  var panels = Array.prototype.slice.call(document.querySelectorAll("[data-settings-panel]"));

  // BUG THAT da gap (2026-10-05): dat ".hidden = true" tren mot phan tu VON co class "flex"
  // (topBar/bottomBar/dirtyBar deu dung flex de xep hang ngang) KHONG an duoc gi ca - trang
  // KHONG nap preflight nen khong co rule "[hidden]{display:none}" du manh de thang author rule
  // ".flex{display:flex}" cua Tailwind (ca hai cung "normal importance", author LUON thang UA bat
  // ke class nao khai bao truoc/sau). Da verify bang getComputedStyle(): .hidden=true tren phan tu
  // co class flex van tra ve display:"flex". Phai TU tay set style.display thay vi dua vao thuoc
  // tinh "hidden" - inline style luon thang moi class du co "flex" hay khong.
  function setHidden(el, hide) {
    if (el) el.style.display = hide ? "none" : "";
  }

  // Thanh "Luu cau hinh" (dau trang) va "Luu tat ca thay doi" (cuoi trang) CHI thuoc ve
  // #settings-form (3 tab faq/commission/messages) - tab "notify-groups" co form/nut Luu RIENG
  // trong renderZaloGroupsCard(), nen phai an ca 2 thanh nay luc dang o tab do, khong thi nut nop
  // mot form dang bi an se treo lo lung tren man hinh, gay cam giac "qua nhieu nut".
  var topBar = document.getElementById("settings-top-bar");
  var bottomBar = document.getElementById("settings-bottom-bar");
  function showTab(name) {
    tabs.forEach(function (t) {
      var on = t.dataset.settingsTab === name;
      t.setAttribute("aria-selected", String(on));
      t.className = t.className
        .replace(/border-indigo-600|border-transparent/, on ? "border-indigo-600" : "border-transparent")
        .replace(/font-bold|font-medium/, on ? "font-bold" : "font-medium")
        .replace(/text-indigo-600|text-slate-400/, on ? "text-indigo-600" : "text-slate-400");
    });
    setHidden(topBar, name === "notify-groups");
    setHidden(bottomBar, name === "notify-groups");
    panels.forEach(function (p) { p.hidden = p.dataset.settingsPanel !== name; });
  }
  tabs.forEach(function (t) { t.addEventListener("click", function () { showTab(t.dataset.settingsTab); }); });

  // Dem thay doi chua luu: so sanh .value voi .defaultValue (gia tri HTML goc luc render, trinh
  // duyet tu giu san) - CHI tinh tren field cua form#settings-form, khong tinh checkbox group Zalo
  // (form rieng, route rieng, nut Luu rieng).
  var form = document.getElementById("settings-form");
  var dirtyCountEl = document.getElementById("settings-dirty-count");
  var dirtyBar = document.getElementById("settings-dirty-bar");
  function refreshDirty() {
    if (!form) return;
    var fields = Array.prototype.slice.call(form.querySelectorAll("input[name], textarea[name]"));
    var n = fields.filter(function (f) { return f.value !== f.defaultValue; }).length;
    if (dirtyCountEl) dirtyCountEl.textContent = String(n);
    setHidden(dirtyBar, n === 0);
  }
  if (form) {
    form.addEventListener("input", refreshDirty);
    refreshDirty();
  }

  // Chen {{bien}} vao dung vi tri con tro cua o dang sua, roi tinh lai so thay doi.
  Array.prototype.slice.call(document.querySelectorAll("[data-insert-target]")).forEach(function (btn) {
    btn.addEventListener("click", function () {
      var target = document.getElementById(btn.dataset.insertTarget);
      if (!target) return;
      var start = typeof target.selectionStart === "number" ? target.selectionStart : target.value.length;
      var end = typeof target.selectionEnd === "number" ? target.selectionEnd : target.value.length;
      var text = btn.dataset.insertText || "";
      target.value = target.value.slice(0, start) + text + target.value.slice(end);
      var pos = start + text.length;
      target.focus();
      if (typeof target.setSelectionRange === "function") target.setSelectionRange(pos, pos);
      refreshDirty();
    });
  });
})();
</script>`;

  const body = `${errorBlock}
${successBlock}
${tabsBar}
<form id="settings-form" method="POST" action="/admin/settings" class="space-y-6" ${saveConfirm}>
  ${topBar}
  <div data-settings-panel="faq" id="settings-panel-faq" role="tabpanel" class="space-y-5">${faqCards.join("\n")}</div>
  <div data-settings-panel="commission" id="settings-panel-commission" role="tabpanel" hidden class="space-y-5">${commissionCards.join("\n")}</div>
  <div data-settings-panel="messages" id="settings-panel-messages" role="tabpanel" hidden class="space-y-5">${messageCards.join("\n")}</div>
  ${bottomBar}
</form>
<div data-settings-panel="notify-groups" id="settings-panel-notify-groups" role="tabpanel" hidden class="mt-6">${renderZaloGroupsCard(zaloGroups)}</div>
${pageScript}`;

  return adminShell("settings", "Cấu hình", body, pendingWithdrawals);
}

/**
 * Card chon group Zalo nhan thong bao sau moi lan import bao cao Shopee (2026-09-11). KHONG di qua
 * SETTINGS_REGISTRY vi registry la khai bao TINH (label/type/default co dinh trong code), con danh
 * sach group la du lieu DONG doc tu bang zalo_groups - nhet vao registry se pha tinh chat "them 1
 * setting chi sua 1 file" cua no. Vi vay card nay co form + route rieng (POST /admin/settings/zalo-groups)
 * - PHAI nam NGOAI <form id="settings-form"> cua ham tren (2 <form> khong duoc long nhau, trinh
 * duyet se day form con ra ngoai luc phan tich HTML, giong bug "form trong tr" da gap o trang
 * withdrawals).
 */
function renderZaloGroupsCard(zaloGroups: ZaloGroup[]): string {
  if (zaloGroups.length === 0) {
    return `<div class="rounded-xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
  <h2 class="mb-1.5 text-sm font-bold text-slate-900">Group Zalo nhận thông báo</h2>
  <p class="m-0 text-xs leading-relaxed text-slate-500">Chưa phát hiện group nào. Bot tự ghi nhận danh sách group lúc đăng nhập Zalo và khi có tin nhắn mới trong group — bật Zalo adapter rồi chờ bot khởi động xong (hoặc chờ có người nhắn trong group), sau đó tải lại trang này.</p>
</div>`;
  }

  const rows = zaloGroups
    .map(
      (group) => `<label class="flex items-center gap-3 border-t border-slate-100 px-5 py-3 text-xs first:border-t-0">
  <input type="checkbox" name="groupIds" value="${escapeHtml(group.groupId)}"${
        group.notifyEnabled ? " checked" : ""
      } class="h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/30">
  <span class="font-semibold text-slate-700">${escapeHtml(group.name || "(chưa lấy được tên)")}</span>
  <span class="ml-auto font-mono text-[11px] text-slate-400">${escapeHtml(group.groupId)}</span>
</label>`
    )
    .join("\n");

  return `<div class="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
  <div class="border-b border-slate-200/80 bg-slate-50/70 p-5">
    <h2 class="mb-1.5 text-sm font-bold text-slate-900">Group Zalo nhận thông báo</h2>
    <p class="m-0 text-xs leading-relaxed text-slate-500">Tick group sẽ nhận tin "đơn hàng đã được cập nhật" mỗi lần import báo cáo Shopee thành công. Mặc định tất cả đều TẮT — tài khoản Zalo chạy bot thường cũng ở trong các group cá nhân không liên quan.</p>
  </div>
  <form method="POST" action="/admin/settings/zalo-groups" ${confirmOnSubmit("Xác nhận lưu danh sách group nhận thông báo?")}>
    ${rows}
    <div class="flex justify-end border-t border-slate-100 p-4">
      <button type="submit" class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700">${icon(
        "save",
        "h-4 w-4"
      )} Lưu danh sách group</button>
    </div>
  </form>
</div>`;
}
