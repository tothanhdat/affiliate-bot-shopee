import { getMerchantConfig, MERCHANTS, type MerchantId } from "../core/merchants.js";
import type { ShopeeReportImportResult } from "../core/shopeeReportImport.js";
import { SETTINGS_REGISTRY } from "../config/settingsRegistry.js";
import type {
  AccesstradePayment,
  CommissionEntry,
  CommissionStatus,
  ImportHistoryEntry,
  Platform,
  ReconciliationSummary,
  WithdrawalRequest,
  ZaloGroup,
} from "../core/types.js";
import {
  confirmOnSubmit,
  escapeHtml,
  formatDateTime,
  formatVnd,
  statusBadge,
  successToast,
  todayDateInputValue,
} from "./htmlHelpers.js";

/**
 * Trang admin viet tay bang HTML thuan (khong dung templating lib, khong JS phia client),
 * cung convention voi dashboardHtml.ts (form POST thuan, redirect 303). Bo cuc "sidebar toi +
 * topbar + noi dung nen xam chua card trang" tham khao cau truc 1 template admin user cung
 * (2026-08-18) nhung mau sac/noi dung rieng cua du an - KHONG clone CSS/asset thuong mai.
 */

const NAV_ITEMS: Array<{ key: string; href: string; label: string; icon: string }> = [
  { key: "withdrawals", href: "/admin/withdrawals", label: "Yêu cầu rút tiền", icon: "💸" },
  { key: "users", href: "/admin/users", label: "Người dùng", icon: "👥" },
  { key: "orders", href: "/admin/orders", label: "Đơn hàng", icon: "📦" },
  { key: "record-orders", href: "/admin/record-orders", label: "Ghi nhận đơn hàng", icon: "📝" },
  { key: "accesstrade-payments", href: "/admin/accesstrade-payments", label: "Đối chiếu Accesstrade", icon: "🔄" },
  { key: "settings", href: "/admin/settings", label: "Cấu hình", icon: "⚙️" },
];

function shellStyles(): string {
  return `<style>
  :root {
    --sidebar-bg: #1f2333;
    --sidebar-text: #aab0c6;
    --sidebar-text-active: #ffffff;
    --sidebar-active-bg: rgba(130, 87, 229, 0.25);
    --accent: #6a4fd8;
    --content-bg: #f3f4f8;
    --card-bg: #ffffff;
    --card-border: #e6e8f0;
    --text: #262b3d;
    --text-muted: #7c8194;
    --success: #16a34a;
    --success-soft: #e8f8ee;
    --warning: #b45309;
    --warning-soft: #fef3e2;
    --danger: #dc2626;
    --danger-soft: #fdeaea;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Inter", system-ui, sans-serif; background: var(--content-bg); color: var(--text); }
  /* .layout khoa dung 100vh + overflow hidden (2026-09-13, phan hoi truc tiep cua user: cuon
     trang dang keo ca sidebar cuon theo vi truoc day .layout chi co min-height nen cao ra theo
     noi dung, khien sidebar (stretch theo chieu cao .layout) dai ra va cuon cung trang) - sidebar
     va topbar giu nguyen cho, CHI .content (bang duoi) duoc cuon rieng qua overflow-y: auto. */
  .layout { display: flex; height: 100vh; overflow: hidden; }
  .sidebar { width: 230px; flex-shrink: 0; background: var(--sidebar-bg); padding: 1.5rem 0; overflow-y: auto; }
  .sidebar .brand { color: #fff; font-weight: 700; font-size: 1.05rem; padding: 0 1.25rem 1.5rem; white-space: nowrap; overflow: hidden; }
  .sidebar nav a {
    display: flex; align-items: center; gap: 0.7rem; padding: 0.65rem 1.25rem; color: var(--sidebar-text);
    text-decoration: none; font-size: 0.9rem; border-radius: 8px; margin: 0.15rem 0.75rem; white-space: nowrap;
  }
  .sidebar nav a .icon { flex-shrink: 0; font-size: 1.05rem; line-height: 1; }
  .sidebar nav a.active { background: var(--sidebar-active-bg); color: var(--sidebar-text-active); font-weight: 600; }
  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
  .topbar {
    background: #fff; border-bottom: 1px solid var(--card-border); padding: 1rem 1.75rem;
    display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-shrink: 0;
  }
  .topbar h1 { font-size: 1.1rem; margin: 0; }
  .topbar .topbar-left { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
  .topbar form { margin: 0; }
  .topbar button.logout {
    background: none; border: 1px solid var(--card-border); color: var(--text-muted);
    border-radius: 8px; padding: 0.4rem 0.9rem; font-size: 0.82rem; cursor: pointer;
  }
  .topbar button.logout:hover { background: var(--content-bg); }
  /* Cong tac an/hien menu tren mobile (checkbox hack thuan CSS, khong them JS) - #sidebar-toggle
     nam truoc .sidebar trong markup de :checked ~ .sidebar/.sidebar-backdrop hoat dong duoc. An
     hoan toan tren desktop, chi hien trong @media ben duoi. */
  .sidebar-toggle-input { display: none; }
  .sidebar-toggle-btn { display: none; }
  .sidebar-backdrop { display: none; }
  .content { padding: 1.75rem; overflow-y: auto; min-height: 0; }
  .card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 14px; padding: 1.25rem; margin-bottom: 1.25rem; }
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
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; white-space: nowrap; }
  thead th { text-align: left; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); padding: 0 0.6rem 0.6rem; border-bottom: 1px solid var(--card-border); }
  tbody td { padding: 0.7rem 0.6rem; border-bottom: 1px solid var(--card-border); vertical-align: top; }
  tbody tr:last-child td { border-bottom: none; }
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
  .dropdown-check > summary {
    list-style: none; cursor: pointer; user-select: none;
    padding: 0.45rem 2rem 0.45rem 0.6rem; border: 1px solid var(--card-border); border-radius: 8px;
    font-size: 0.85rem; min-width: 190px; background: #fff; color: var(--text); position: relative;
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
    display: inline-block; min-width: 34px; text-align: center; padding: 0.35rem 0.6rem;
    border: 1px solid var(--card-border); border-radius: 8px; font-size: 0.82rem; font-weight: 600;
    color: var(--accent); text-decoration: none;
  }
  .pagination a:hover { background: var(--content-bg); }
  .pagination .current { background: var(--accent); border-color: var(--accent); color: #fff; }
  .pagination .disabled, .pagination .gap { color: var(--text-muted); border-color: transparent; font-weight: 400; }
  .error { background: var(--danger-soft); color: var(--danger); padding: 0.85rem 1rem; border-radius: 12px; margin-bottom: 1.25rem; font-size: 0.9rem; }
  .success { background: var(--success-soft); color: var(--success); padding: 0.85rem 1rem; border-radius: 12px; margin-bottom: 1.25rem; font-size: 0.9rem; }
  .login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--content-bg); }
  .login-card { background: #fff; border: 1px solid var(--card-border); border-radius: 14px; padding: 2rem; width: 320px; }
  .login-card h1 { font-size: 1.15rem; margin: 0 0 1.25rem; }
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
    .topbar { padding: 0.75rem 0.85rem; gap: 0.5rem; }
    .topbar-left { flex: 1; min-width: 0; }
    .topbar h1 { font-size: 0.95rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .topbar > form { flex-shrink: 0; min-width: 0; }
    .topbar button.logout { flex-shrink: 0; white-space: nowrap; padding: 0.35rem 0.6rem; font-size: 0.75rem; }
    .content { padding: 1rem; }

    .sidebar { width: 56px; overflow: hidden; transition: width 0.18s ease; }
    .sidebar .brand { padding: 0 0 1.25rem; text-align: center; }
    .sidebar .brand .brand-text { display: none; }
    .sidebar nav a { justify-content: center; padding: 0.65rem 0; margin: 0.15rem 0.5rem; }
    .sidebar nav a .label { display: none; }

    .sidebar-toggle-input:checked ~ .layout .sidebar {
      width: 230px; position: fixed; top: 0; left: 0; bottom: 0; z-index: 50;
      box-shadow: 4px 0 20px rgba(0, 0, 0, 0.28); overflow-y: auto;
    }
    .sidebar-toggle-input:checked ~ .layout .sidebar .brand { text-align: left; padding: 0 1.25rem 1.5rem; }
    .sidebar-toggle-input:checked ~ .layout .sidebar .brand .brand-text { display: inline; }
    .sidebar-toggle-input:checked ~ .layout .sidebar nav a { justify-content: flex-start; padding: 0.65rem 1.25rem; margin: 0.15rem 0.75rem; }
    .sidebar-toggle-input:checked ~ .layout .sidebar nav a .label { display: inline; }
    .sidebar-toggle-input:checked ~ .sidebar-backdrop {
      display: block; position: fixed; inset: 0; background: rgba(15, 17, 28, 0.45); z-index: 45; cursor: pointer;
    }

    .payment-form, .filters { flex-direction: column; align-items: stretch; }
    .payment-form > div, .filters > div { width: 100%; }
    .payment-form input[type="text"], .payment-form select,
    .filters input[type="text"], .filters select { width: 100%; min-width: 0; }
    .settings-form { max-width: 100%; }
    .settings-form input[type="number"] { width: 100%; }
    .totals .stat { flex: 1 1 100%; }
  }
</style>`;
}

function adminShell(activeNav: string, pageTitle: string, bodyHtml: string): string {
  const navLinks = NAV_ITEMS.map(
    (item) =>
      `<a href="${item.href}" class="${item.key === activeNav ? "active" : ""}"><span class="icon">${item.icon}</span><span class="label">${item.label}</span></a>`
  ).join("\n");

  // #sidebar-toggle + .sidebar-backdrop nam TRUOC .layout, cung cap voi no trong <body> - can thiet
  // de CSS ":checked ~ .layout .sidebar" va ":checked ~ .sidebar-backdrop" trong shellStyles() hoat
  // dong (checkbox hack thuan CSS cho menu mobile, xem chi tiet trong khoi @media cua shellStyles()).
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>${pageTitle} — Admin</title>
${shellStyles()}
</head>
<body>
<input type="checkbox" id="sidebar-toggle" class="sidebar-toggle-input">
<label for="sidebar-toggle" class="sidebar-backdrop" aria-hidden="true"></label>
<div class="layout">
  <aside class="sidebar">
    <div class="brand">🛒<span class="brand-text"> Bot Admin</span></div>
    <nav>${navLinks}</nav>
  </aside>
  <div class="main">
    <div class="topbar">
      <div class="topbar-left">
        <label for="sidebar-toggle" class="sidebar-toggle-btn" aria-label="Mở/đóng menu">☰</label>
        <h1>${pageTitle}</h1>
      </div>
      <form method="POST" action="/admin/logout"><button type="submit" class="logout">Đăng xuất</button></form>
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
${shellStyles()}
</head>
<body>
<div class="login-wrap">
  <div class="login-card">
    <h1>🛒 Bot Admin</h1>
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
function nameKey(platform: string, userId: string): string {
  return `${platform}:${userId}`;
}

function nameCell(name: string | null | undefined): string {
  return name ? escapeHtml(name) : `<span class="muted">—</span>`;
}

export function renderWithdrawalsPage(
  pending: WithdrawalRequest[],
  paidHistory: WithdrawalRequest[],
  displayNames: Map<string, string>,
  errorMessage?: string | null
): string {
  const errorBlock = errorMessage ? `<div class="error">${escapeHtml(errorMessage)}</div>` : "";

  const rows = pending
    .map((w) => {
      const who = displayNames.get(nameKey(w.platform, w.userId)) ?? `${w.platform}/${w.userId}`;
      const confirmMsg = `Xác nhận ĐÃ CHUYỂN KHOẢN ${formatVnd(w.amount)} cho ${who}? Hành động này không thể hoàn tác.`;
      return `<tr>
  <td>${formatDateTime(w.createdAt)}</td>
  <td>${escapeHtml(w.platform)}</td>
  <td>${escapeHtml(w.userId)}</td>
  <td>${nameCell(displayNames.get(nameKey(w.platform, w.userId)))}</td>
  <td>${formatVnd(w.amount)}</td>
  <td>${escapeHtml(w.bankName)}<br>${escapeHtml(w.bankAccountNumber)}<br>${escapeHtml(w.bankAccountHolder)}</td>
  <td>
    <form method="POST" action="/admin/withdrawals/${w.id}/mark-paid" enctype="multipart/form-data" class="payment-form" ${confirmOnSubmit(confirmMsg)}>
      <div>
        <label for="proofImage-${w.id}">Ảnh chuyển khoản</label>
        <input type="file" id="proofImage-${w.id}" name="proofImage" accept="image/*" required>
      </div>
      <div><button type="submit" class="primary">Đánh dấu đã trả</button></div>
    </form>
  </td>
</tr>`;
    })
    .join("\n");

  const pendingCard = `<div class="card">
<h2>Yêu cầu rút tiền đang chờ (${pending.length})</h2>
${errorBlock}
${
  pending.length > 0
    ? `<div class="table-scroll"><table>
<thead><tr><th>Thời gian</th><th>Kênh</th><th>User ID</th><th>Tên</th><th>Số tiền</th><th>Ngân hàng</th><th>Xác nhận đã trả (bắt buộc đính kèm ảnh)</th></tr></thead>
<tbody>${rows}</tbody>
</table></div>`
    : `<p class="empty">Không có yêu cầu nào đang chờ.</p>`
}
</div>`;

  const historyRows = paidHistory
    .map((w) => {
      const proofLink = w.proofImagePath
        ? `<a class="link" href="/admin/withdrawal-proofs/${encodeURIComponent(w.proofImagePath)}" target="_blank" rel="noopener">Xem ảnh</a>`
        : `<span class="muted">—</span>`;
      return `<tr>
  <td>${w.paidAt ? formatDateTime(w.paidAt) : "—"}</td>
  <td>${escapeHtml(w.platform)}</td>
  <td>${escapeHtml(w.userId)}</td>
  <td>${nameCell(displayNames.get(nameKey(w.platform, w.userId)))}</td>
  <td>${formatVnd(w.amount)}</td>
  <td>${proofLink}</td>
</tr>`;
    })
    .join("\n");

  const historyCard = `<div class="card">
<h2>Lịch sử đã trả gần đây (${paidHistory.length})</h2>
${
  paidHistory.length > 0
    ? `<div class="table-scroll"><table>
<thead><tr><th>Thời gian trả</th><th>Kênh</th><th>User ID</th><th>Tên</th><th>Số tiền</th><th>Bằng chứng</th></tr></thead>
<tbody>${historyRows}</tbody>
</table></div>`
    : `<p class="empty">Chưa có yêu cầu nào được đánh dấu đã trả.</p>`
}
</div>`;

  return adminShell("withdrawals", "Yêu cầu rút tiền", `${pendingCard}\n${historyCard}`);
}

export function renderAccesstradePaymentsPage(
  payments: AccesstradePayment[],
  summary: ReconciliationSummary,
  errorMessage?: string | null
): string {
  const isNegative = summary.remainingVnd < 0;
  const errorBlock = errorMessage ? `<div class="error">${escapeHtml(errorMessage)}</div>` : "";
  const warningBlock = isNegative
    ? `<div class="error">⚠️ Đang trả cho user vượt quá số tiền đã nhận thật từ Accesstrade (âm ${formatVnd(Math.abs(summary.remainingVnd))}). Kiểm tra lại số liệu hoặc ghi nhận thêm khoản Accesstrade đã chuyển.</div>`
    : "";

  const summaryCard = `<div class="card">
<h2>Số dư chủ bot (đối chiếu dòng tiền)</h2>
${errorBlock}
${warningBlock}
<div class="totals">
  <div class="stat"><div class="label">Đã nhận từ Accesstrade</div><div class="value">${formatVnd(summary.totalReceivedVnd)}</div></div>
  <div class="stat"><div class="label">Đã trả cho user</div><div class="value">${formatVnd(summary.totalPaidToUsersVnd)}</div></div>
  <div class="stat ${isNegative ? "danger" : "accent"}"><div class="label">Còn lại</div><div class="value">${formatVnd(summary.remainingVnd)}</div></div>
</div>
<form method="POST" action="/admin/accesstrade-payments" class="payment-form" ${confirmOnSubmit("Xác nhận ghi nhận khoản Accesstrade đã chuyển này? Số liệu sẽ dùng để đối chiếu dòng tiền.")}>
  <div>
    <label for="amount">Số tiền Accesstrade đã chuyển (đ)</label>
    <input type="text" id="amount" name="amount" placeholder="vd: 2000000" inputmode="numeric">
  </div>
  <div>
    <label for="receivedAt">Ngày chuyển</label>
    <input type="date" id="receivedAt" name="receivedAt" value="${todayDateInputValue()}">
  </div>
  <div>
    <label for="payment-note">Ghi chú (tuỳ chọn)</label>
    <input type="text" id="payment-note" name="note" placeholder="vd: chuyển khoản kỳ tháng 8">
  </div>
  <div><button type="submit" class="primary">Ghi nhận</button></div>
</form>
</div>`;

  const rows = payments
    .map(
      (p) => `<tr>
  <td>${formatDateTime(p.receivedAt)}</td>
  <td>${formatVnd(p.amountVnd)}</td>
  <td>${p.note ? escapeHtml(p.note) : `<span class="muted">—</span>`}</td>
</tr>`
    )
    .join("\n");

  const historyCard = `<div class="card">
<h2>Lịch sử Accesstrade đã chuyển tiền (${payments.length})</h2>
${
  payments.length > 0
    ? `<div class="table-scroll"><table>
<thead><tr><th>Ngày chuyển</th><th>Số tiền</th><th>Ghi chú</th></tr></thead>
<tbody>${rows}</tbody>
</table></div>`
    : `<p class="empty">Chưa ghi nhận lần chuyển khoản nào.</p>`
}
</div>`;

  return adminShell("accesstrade-payments", "Đối chiếu Accesstrade", `${summaryCard}\n${historyCard}`);
}

export function renderUsersPage(
  list: Array<{
    platform: Platform;
    userId: string;
    displayName: string | null;
    availableBalance: number;
    pendingBalance: number;
    paidTotal: number;
    ordersCount: number;
  }>
): string {
  const rows = list
    .map(
      (u) => `<tr data-search="${escapeHtml(`${u.displayName ?? ""} ${u.userId}`.toLowerCase())}">
  <td>${escapeHtml(u.platform)}</td>
  <td>${escapeHtml(u.userId)}</td>
  <td>${nameCell(u.displayName)}</td>
  <td>${formatVnd(u.availableBalance)}</td>
  <td>${formatVnd(u.pendingBalance)}</td>
  <td>${formatVnd(u.paidTotal)}</td>
  <td>${u.ordersCount}</td>
  <td><a class="link" href="/admin/orders?platform=${encodeURIComponent(u.platform)}&userId=${encodeURIComponent(u.userId)}">Xem đơn hàng</a></td>
</tr>`
    )
    .join("\n");

  // Loc client-side (khong reload trang): moi <tr> mang san data-search = "ten userId" da viet thuong,
  // JS chi can so khop chuoi con. Danh sach user nam tron trong 1 trang nen khong can query server.
  // Logic ben trong duoc test qua src/api/__tests__/usersSearchScript.test.ts (chay script nay tren
  // DOM gia) - sua o day thi chay lai test do.
  const searchScript = `<script>
(function () {
  var input = document.getElementById("user-search");
  if (!input) return;
  var rows = Array.prototype.slice.call(document.querySelectorAll("#users-table tbody tr"));
  var counter = document.getElementById("users-count");
  var emptyHint = document.getElementById("users-no-match");
  input.addEventListener("input", function () {
    var q = input.value.trim().toLowerCase();
    var shown = 0;
    rows.forEach(function (row) {
      var match = q === "" || (row.dataset.search || "").indexOf(q) !== -1;
      row.hidden = !match;
      if (match) shown++;
    });
    if (counter) counter.textContent = String(shown);
    if (emptyHint) emptyHint.hidden = shown !== 0;
  });
})();
</script>`;

  const body = `<div class="card">
<h2>Người dùng (<span id="users-count">${list.length}</span>)</h2>
${
  list.length > 0
    ? `<div class="filters">
  <div>
    <label for="user-search">Tìm kiếm</label>
    <input type="search" id="user-search" class="search-input" placeholder="Nhập tên hoặc User ID..." autocomplete="off">
  </div>
</div>
<div class="table-scroll"><table id="users-table">
<thead><tr><th>Kênh</th><th>User ID</th><th>Tên</th><th>Khả dụng</th><th>Đang chờ rút</th><th>Đã nhận</th><th>Số đơn</th><th></th></tr></thead>
<tbody>${rows}</tbody>
</table></div>
<p class="empty" id="users-no-match" hidden>Không có user nào khớp từ khoá.</p>
${searchScript}`
    : `<p class="empty">Chưa có user nào có đơn hàng.</p>`
}
</div>`;

  return adminShell("users", "Người dùng", body);
}

export interface OrdersFilters {
  platform?: Platform;
  userId?: string;
  merchant?: MerchantId;
  /** Nhieu trang thai cung luc (form dung checkbox). Rong = khong loc, hien tat ca. */
  statuses?: CommissionStatus[];
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
  for (const status of filters.statuses ?? []) params.append("status", status);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query === "" ? "/admin/orders" : `/admin/orders?${query}`;
}

/** Day so trang hien tren thanh phan trang: luon co trang dau/cuoi + 1 trang ke hien tai, con lai la "…". */
function paginationItems(page: number, totalPages: number): Array<number | "gap"> {
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
  const prev =
    page > 1
      ? `<a href="${escapeHtml(ordersPageHref(filters, page - 1))}">‹ Trước</a>`
      : `<span class="disabled">‹ Trước</span>`;
  const next =
    page < totalPages
      ? `<a href="${escapeHtml(ordersPageHref(filters, page + 1))}">Sau ›</a>`
      : `<span class="disabled">Sau ›</span>`;
  const middle = paginationItems(page, totalPages)
    .map((item) =>
      item === "gap"
        ? `<span class="gap">…</span>`
        : item === page
          ? `<span class="current">${item}</span>`
          : `<a href="${escapeHtml(ordersPageHref(filters, item))}">${item}</a>`
    )
    .join("");
  return `<div class="pagination">${prev}${middle}${next}</div>`;
}

const STATUS_OPTIONS: CommissionStatus[] = ["pending", "confirmed", "paid", "reversed"];
const STATUS_LABELS: Record<CommissionStatus, string> = {
  pending: "Chờ xác nhận",
  confirmed: "Khả dụng / đang chờ rút",
  paid: "Đã rút",
  reversed: "Đã huỷ",
};
const PLATFORM_OPTIONS: Platform[] = ["telegram", "zalo", "http"];

function selectOptions<T extends string>(
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
  pagination: OrdersPagination
): string {
  const rows = entries
    .map((e) => {
      const badge = statusBadge(e);
      const product = e.productName
        ? `<span class="cell-truncate" title="${escapeHtml(e.productName)}">${escapeHtml(e.productName)}</span>`
        : `<span class="muted">—</span>`;
      // 2026-08-20 (quyet dinh chot lai voi user): CHI huy duoc don dang "pending" - "confirmed"
      // (Khai dung) nghia la Accesstrade da duyet chinh thuc/chot so lieu, xem la hoan tat, khong
      // con ly do gi de huy nua (khop FAQ chinh thuc Accesstrade: "hoa hong duoc duyet" la so lieu
      // cuoi cung dung de thanh toan). LedgerStore.reverseCommissionEntry() cung tu choi ngay o
      // tang du lieu neu status khac "pending" (EntryNotPendingError) - day chi la an link o UI.
      const reverseLink =
        e.status === "pending" ? `<a class="link" href="/admin/orders/${e.id}/reverse">Huỷ đơn</a>` : "";
      return `<tr>
  <td>
    <div>${escapeHtml(e.orderId)}</div>
    <div class="muted">${formatDateTime(e.createdAt)}</div>
  </td>
  <td>${escapeHtml(e.platform)}</td>
  <td>${escapeHtml(e.userId)}</td>
  <td>${nameCell(displayNames.get(nameKey(e.platform, e.userId)))}</td>
  <td>${getMerchantConfig(e.merchant).displayName}</td>
  <td>${product}</td>
  <td>${formatVnd(e.userShareAmount)}</td>
  <td>${formatVnd(e.afterTaxAmount - e.userShareAmount)}</td>
  <td><span class="badge badge-${badge.tone}">${badge.label}</span></td>
  <td>${reverseLink}</td>
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

  const filterForm = `<form method="GET" action="/admin/orders" class="filters">
  <div>
    <label>Platform</label>
    <select name="platform">${selectOptions(PLATFORM_OPTIONS, (v) => v, filters.platform)}</select>
  </div>
  <div>
    <label>Merchant</label>
    <select name="merchant">${selectOptions(
      MERCHANTS.map((m) => m.id),
      (id) => getMerchantConfig(id).displayName,
      filters.merchant
    )}</select>
  </div>
  <div>
    <label>Trạng thái</label>
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
  ${filters.userId ? `<input type="hidden" name="userId" value="${escapeHtml(filters.userId)}">` : ""}
  <div><button type="submit" class="primary">Lọc</button></div>
</form>`;

  const heading =
    pagination.totalPages > 1
      ? `Đơn hàng (${pagination.totalEntries} đơn — trang ${pagination.page}/${pagination.totalPages})`
      : `Đơn hàng (${pagination.totalEntries})`;

  const body = `<div class="card">
<h2>${heading}</h2>
${filterForm}
${statusDropdownScript}
${
  entries.length > 0
    ? `<div class="table-scroll"><table>
<thead><tr><th>Mã đơn</th><th>Kênh</th><th>User ID</th><th>Tên</th><th>Merchant</th><th>Sản phẩm</th><th>Khách nhận</th><th>Admin nhận</th><th>Trạng thái</th><th></th></tr></thead>
<tbody>${rows}</tbody>
</table></div>
${renderPagination(filters, pagination)}`
    : `<p class="empty">Không có đơn hàng nào khớp bộ lọc.</p>`
}
</div>`;

  return adminShell("orders", "Đơn hàng", body);
}

export function renderReverseConfirmPage(
  entry: CommissionEntry,
  displayName?: string | null,
  blockedMessage?: string | null
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

  return adminShell("orders", "Huỷ đơn hàng", body);
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
  shopeeReportError?: string | null
): string {
  const singleBlock = singleResult
    ? `<div class="${singleResult.ok ? "success" : "error"}">${escapeHtml(singleResult.message)}</div>`
    : "";

  const singleCard = `<div class="card">
<h2>Ghi 1 đơn lẻ</h2>
${singleBlock}
<form method="POST" action="/admin/record-orders/single" class="payment-form" ${confirmOnSubmit("Xác nhận ghi nhận đơn hàng này vào hệ thống? Số liệu sẽ dùng để tính hoa hồng cho user.")}>
  <div>
    <label for="subId">subId</label>
    <input type="text" id="subId" name="subId" placeholder="telegram-566659887-abc123-def456" required>
  </div>
  <div>
    <label for="orderId">Mã đơn (orderId)</label>
    <input type="text" id="orderId" name="orderId" required>
  </div>
  <div>
    <label for="orderAmount">Giá trị đơn (đ)</label>
    <input type="text" id="orderAmount" name="orderAmount" inputmode="numeric" required>
  </div>
  <div>
    <label for="commissionAmount">Hoa hồng gốc (đ)</label>
    <input type="text" id="commissionAmount" name="commissionAmount" inputmode="numeric" required>
  </div>
  <div>
    <label for="productName">Tên sản phẩm (tuỳ chọn)</label>
    <input type="text" id="productName" name="productName">
  </div>
  <div>
    <label for="single-note">Ghi chú (tuỳ chọn)</label>
    <input type="text" id="single-note" name="note">
  </div>
  <div>
    <label for="status">Trạng thái</label>
    <select id="status" name="status">
      <option value="confirmed" selected>Khả dụng</option>
      <option value="pending">Chờ xác nhận</option>
    </select>
  </div>
  <div><button type="submit" class="primary">Ghi nhận</button></div>
</form>
</div>`;

  const shopeeReportErrorBlock = shopeeReportError ? `<div class="error">${escapeHtml(shopeeReportError)}</div>` : "";

  // Toast chi hien khi import THAT SU chay xong (co ket qua tra ve, khong phai loi truoc khi xu ly
  // nhu "chua chon file" - truong hop do da co shopeeReportErrorBlock rieng, khong can toast).
  const shopeeReportToast = shopeeReportResult
    ? successToast(
        shopeeReportResult.newOrderIds.length > 0 || shopeeReportResult.statusTransitions.length > 0
          ? `Import thành công: ${shopeeReportResult.newOrderIds.length} đơn mới, ${shopeeReportResult.statusTransitions.length} đơn cập nhật trạng thái.`
          : "Import hoàn tất: không có đơn nào thay đổi."
      )
    : "";

  const shopeeReportResultBlock = shopeeReportResult
    ? `<ul class="summary-list">
  <li>Số đơn quét được: <strong>${shopeeReportResult.ordersScanned}</strong></li>
  <li>Ghi mới "Khả dụng": <strong>${shopeeReportResult.confirmedNew}</strong> (trùng, bỏ qua: ${shopeeReportResult.confirmedDuplicate})</li>
  <li>Ghi mới "Chờ xác nhận": <strong>${shopeeReportResult.pendingNew}</strong> (cập nhật lại số liệu: ${shopeeReportResult.pendingUpdated})</li>
  <li>Đã huỷ (đơn bị huỷ / không hợp lệ): <strong>${shopeeReportResult.reversedCount}</strong></li>
  <li>Đơn nhiều sản phẩm đã gộp: ${shopeeReportResult.mergedMultiItem}</li>
  <li>Bỏ qua - không tách được subId: ${shopeeReportResult.skippedNoSubId}</li>
  <li>Bỏ qua - subId không khớp user nào: ${shopeeReportResult.skippedSubIdNotFound}</li>
  <li>Bỏ qua - trạng thái lạ: ${shopeeReportResult.skippedUnknownStatus}</li>
</ul>
${
  shopeeReportResult.errors.length > 0
    ? `<div class="table-scroll"><table>
<thead><tr><th>Cảnh báo / lỗi</th></tr></thead>
<tbody>${shopeeReportResult.errors.map((e) => `<tr><td>${escapeHtml(e)}</td></tr>`).join("\n")}</tbody>
</table></div>`
    : ""
}`
    : "";

  const shopeeReportCard = `<div class="card">
<h2>Import báo cáo gốc Shopee Affiliate</h2>
<p class="muted">Upload thẳng file export từ affiliate.shopee.vn/report/conversion_report (vd AffiliateCommissionReport_*.csv) - không cần đổi tên cột. Trạng thái ghi nhận lấy theo cột "Trạng thái sản phẩm liên kết" trong file. Đơn nhiều sản phẩm cùng 1 mã đơn được tự động gộp thành 1 đơn (dòng bị huỷ trong đơn không tính vào tổng).</p>
${shopeeReportErrorBlock}
<form method="POST" action="/admin/record-orders/shopee-report" enctype="multipart/form-data" class="payment-form" ${confirmOnSubmit("Xác nhận import file báo cáo Shopee này? Sẽ ghi nhận/cập nhật đơn hàng vào hệ thống.")}>
  <div>
    <label for="shopee-file">File báo cáo Shopee (.csv)</label>
    <input type="file" id="shopee-file" name="file" accept=".csv,text/csv" required>
  </div>
  <div><button type="submit" class="primary">Import</button></div>
</form>
${shopeeReportResultBlock}
</div>`;

  const historyRows = history
    .map((h) => {
      const newOrdersCell = h.newOrderIds.length > 0 ? h.newOrderIds.map((id) => escapeHtml(id)).join(", ") : "0";
      const transitionsCell =
        h.statusTransitions.length > 0
          ? h.statusTransitions
              .map((t) => `${escapeHtml(t.orderId)}: ${STATUS_LABELS[t.from]} → ${STATUS_LABELS[t.to]}`)
              .join("<br>")
          : "0";
      return `<tr>
  <td>${formatDateTime(h.createdAt)}</td>
  <td>${escapeHtml(ACTION_TYPE_LABELS[h.actionType])}</td>
  <td>${newOrdersCell}</td>
  <td>${transitionsCell}</td>
</tr>`;
    })
    .join("\n");

  const historyCard = `<div class="card">
<h2>Lịch sử ghi nhận đơn hàng</h2>
${
  history.length > 0
    ? `<div class="table-scroll"><table>
<thead><tr><th>Thời gian</th><th>Loại</th><th>Đơn mới</th><th>Đơn đổi trạng thái</th></tr></thead>
<tbody>${historyRows}</tbody>
</table></div>`
    : `<p class="empty">Chưa có lượt ghi nhận nào.</p>`
}
</div>`;

  return adminShell(
    "record-orders",
    "Ghi nhận đơn hàng",
    `${shopeeReportToast}\n${singleCard}\n${shopeeReportCard}\n${historyCard}`
  );
}

export function renderSettingsPage(
  currentValues: Record<string, string>,
  errorMessage?: string | null,
  successMessage?: string | null,
  zaloGroups: ZaloGroup[] = []
): string {
  const errorBlock = errorMessage ? `<div class="error">${escapeHtml(errorMessage)}</div>` : "";
  const successBlock = successMessage ? `<div class="success">${escapeHtml(successMessage)}</div>` : "";

  const fields = SETTINGS_REGISTRY.map((entry) => {
    const value = currentValues[entry.key] ?? entry.default;
    const helpBlock = entry.helpText ? `<p class="help">${escapeHtml(entry.helpText)}</p>` : "";
    const control =
      entry.type === "number"
        ? `<input type="number" id="${entry.key}" name="${entry.key}" value="${escapeHtml(value)}"${
            entry.min !== undefined ? ` min="${entry.min}"` : ""
          }${entry.max !== undefined ? ` max="${entry.max}"` : ""} required>`
        : `<textarea id="${entry.key}" name="${entry.key}" required>${escapeHtml(value)}</textarea>`;
    return `<div class="field">
  <label for="${entry.key}">${escapeHtml(entry.label)}</label>
  ${control}
  ${helpBlock}
</div>`;
  }).join("\n");

  const body = `<div class="card">
<h2>${SETTINGS_REGISTRY.length} giá trị chỉnh được qua form này</h2>
${errorBlock}
${successBlock}
<form method="POST" action="/admin/settings" class="settings-form" ${confirmOnSubmit("Xác nhận lưu thay đổi cấu hình này? Áp dụng ngay lập tức, không cần khởi động lại bot.")}>
${fields}
<div class="actions"><button type="submit" class="primary">Lưu thay đổi</button></div>
</form>
</div>
${renderZaloGroupsCard(zaloGroups)}`;

  return adminShell("settings", "Cấu hình", body);
}

/**
 * Card chon group Zalo nhan thong bao sau moi lan import bao cao Shopee (2026-09-11). KHONG di qua
 * SETTINGS_REGISTRY vi registry la khai bao TINH (label/type/default co dinh trong code), con danh
 * sach group la du lieu DONG doc tu bang zalo_groups - nhet vao registry se pha tinh chat "them 1
 * setting chi sua 1 file" cua no. Vi vay card nay co form + route rieng (POST /admin/settings/zalo-groups).
 */
function renderZaloGroupsCard(zaloGroups: ZaloGroup[]): string {
  if (zaloGroups.length === 0) {
    return `<div class="card">
<h2>Group Zalo nhận thông báo</h2>
<p class="help">Chưa phát hiện group nào. Bot tự ghi nhận danh sách group lúc đăng nhập Zalo và khi có tin nhắn mới trong group — bật Zalo adapter rồi chờ bot khởi động xong (hoặc chờ có người nhắn trong group), sau đó tải lại trang này.</p>
</div>`;
  }

  const rows = zaloGroups
    .map(
      (group) => `<label class="group-choice">
<input type="checkbox" name="groupIds" value="${escapeHtml(group.groupId)}"${group.notifyEnabled ? " checked" : ""}>
<span class="group-name">${escapeHtml(group.name || "(chưa lấy được tên)")}</span>
<span class="group-id">${escapeHtml(group.groupId)}</span>
</label>`
    )
    .join("\n");

  return `<div class="card">
<h2>Group Zalo nhận thông báo</h2>
<p class="help">Tick group sẽ nhận tin "đơn hàng đã được cập nhật" mỗi lần import báo cáo Shopee thành công. Mặc định tất cả đều TẮT — tài khoản Zalo chạy bot thường cũng ở trong các group cá nhân không liên quan.</p>
<form method="POST" action="/admin/settings/zalo-groups" class="settings-form" ${confirmOnSubmit("Xác nhận lưu danh sách group nhận thông báo?")}>
${rows}
<div class="actions"><button type="submit" class="primary">Lưu danh sách group</button></div>
</form>
</div>`;
}
