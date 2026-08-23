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
  .layout { display: flex; min-height: 100vh; }
  .sidebar { width: 230px; flex-shrink: 0; background: var(--sidebar-bg); padding: 1.5rem 0; }
  .sidebar .brand { color: #fff; font-weight: 700; font-size: 1.05rem; padding: 0 1.25rem 1.5rem; white-space: nowrap; overflow: hidden; }
  .sidebar nav a {
    display: flex; align-items: center; gap: 0.7rem; padding: 0.65rem 1.25rem; color: var(--sidebar-text);
    text-decoration: none; font-size: 0.9rem; border-radius: 8px; margin: 0.15rem 0.75rem; white-space: nowrap;
  }
  .sidebar nav a .icon { flex-shrink: 0; font-size: 1.05rem; line-height: 1; }
  .sidebar nav a.active { background: var(--sidebar-active-bg); color: var(--sidebar-text-active); font-weight: 600; }
  .main { flex: 1; min-width: 0; }
  .topbar {
    background: #fff; border-bottom: 1px solid var(--card-border); padding: 1rem 1.75rem;
    display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
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
  .content { padding: 1.75rem; }
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
  .filters select, .filters input[type="text"] {
    padding: 0.45rem 0.6rem; border: 1px solid var(--card-border); border-radius: 8px; font-size: 0.85rem; min-width: 140px;
  }
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
<meta name="viewport" content="width=device-width, initial-scale=1">
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
<meta name="viewport" content="width=device-width, initial-scale=1">
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
      (u) => `<tr>
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

  const body = `<div class="card">
<h2>Người dùng (${list.length})</h2>
${
  list.length > 0
    ? `<div class="table-scroll"><table>
<thead><tr><th>Kênh</th><th>User ID</th><th>Tên</th><th>Khả dụng</th><th>Đang chờ rút</th><th>Đã nhận</th><th>Số đơn</th><th></th></tr></thead>
<tbody>${rows}</tbody>
</table></div>`
    : `<p class="empty">Chưa có user nào có đơn hàng.</p>`
}
</div>`;

  return adminShell("users", "Người dùng", body);
}

export interface OrdersFilters {
  platform?: Platform;
  userId?: string;
  merchant?: MerchantId;
  status?: CommissionStatus;
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

export function renderOrdersPage(
  entries: CommissionEntry[],
  filters: OrdersFilters,
  displayNames: Map<string, string>
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
    <select name="status">${selectOptions(STATUS_OPTIONS, (v) => STATUS_LABELS[v], filters.status)}</select>
  </div>
  ${filters.userId ? `<input type="hidden" name="userId" value="${escapeHtml(filters.userId)}">` : ""}
  <div><button type="submit" class="primary">Lọc</button></div>
</form>`;

  const body = `<div class="card">
<h2>Đơn hàng (tối đa 300 đơn gần nhất)</h2>
${filterForm}
${
  entries.length > 0
    ? `<div class="table-scroll"><table>
<thead><tr><th>Mã đơn</th><th>Kênh</th><th>User ID</th><th>Tên</th><th>Merchant</th><th>Sản phẩm</th><th>Khách nhận</th><th>Admin nhận</th><th>Trạng thái</th><th></th></tr></thead>
<tbody>${rows}</tbody>
</table></div>`
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
  <li>Đã huỷ (Không hợp lệ): <strong>${shopeeReportResult.reversedCount}</strong></li>
  <li>Bỏ qua - đơn nhiều sản phẩm (chưa hỗ trợ): ${shopeeReportResult.skippedMultiItem}</li>
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
<p class="muted">Upload thẳng file export từ affiliate.shopee.vn/report/conversion_report (vd AffiliateCommissionReport_*.csv) - không cần đổi tên cột. Trạng thái ghi nhận lấy theo cột "Trạng thái sản phẩm liên kết" trong file. Đơn nhiều sản phẩm cùng 1 mã đơn hiện chưa hỗ trợ tự động.</p>
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
  successMessage?: string | null
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
<h2>5 giá trị chỉnh được qua form này</h2>
${errorBlock}
${successBlock}
<form method="POST" action="/admin/settings" class="settings-form" ${confirmOnSubmit("Xác nhận lưu thay đổi cấu hình này? Áp dụng ngay lập tức, không cần khởi động lại bot.")}>
${fields}
<div class="actions"><button type="submit" class="primary">Lưu thay đổi</button></div>
</form>
</div>`;

  return adminShell("settings", "Cấu hình", body);
}
