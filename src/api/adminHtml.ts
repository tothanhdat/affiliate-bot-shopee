import { getMerchantConfig, MERCHANTS, type MerchantId } from "../core/merchants.js";
import type { OrderRowResult } from "../core/orderIngest.js";
import { SETTINGS_REGISTRY } from "../config/settingsRegistry.js";
import type {
  AccesstradePayment,
  CommissionEntry,
  CommissionStatus,
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
  todayDateInputValue,
} from "./htmlHelpers.js";

/**
 * Trang admin viet tay bang HTML thuan (khong dung templating lib, khong JS phia client),
 * cung convention voi dashboardHtml.ts (form POST thuan, redirect 303). Bo cuc "sidebar toi +
 * topbar + noi dung nen xam chua card trang" tham khao cau truc 1 template admin user cung
 * (2026-08-18) nhung mau sac/noi dung rieng cua du an - KHONG clone CSS/asset thuong mai.
 */

const NAV_ITEMS: Array<{ key: string; href: string; label: string }> = [
  { key: "withdrawals", href: "/admin/withdrawals", label: "Yêu cầu rút tiền" },
  { key: "users", href: "/admin/users", label: "Người dùng" },
  { key: "orders", href: "/admin/orders", label: "Đơn hàng" },
  { key: "record-orders", href: "/admin/record-orders", label: "Ghi nhận đơn hàng" },
  { key: "accesstrade-payments", href: "/admin/accesstrade-payments", label: "Đối chiếu Accesstrade" },
  { key: "settings", href: "/admin/settings", label: "Cấu hình" },
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
  .sidebar .brand { color: #fff; font-weight: 700; font-size: 1.05rem; padding: 0 1.25rem 1.5rem; }
  .sidebar nav a {
    display: block; padding: 0.65rem 1.25rem; color: var(--sidebar-text); text-decoration: none;
    font-size: 0.9rem; border-radius: 8px; margin: 0.15rem 0.75rem;
  }
  .sidebar nav a.active { background: var(--sidebar-active-bg); color: var(--sidebar-text-active); font-weight: 600; }
  .main { flex: 1; min-width: 0; }
  .topbar {
    background: #fff; border-bottom: 1px solid var(--card-border); padding: 1rem 1.75rem;
    display: flex; align-items: center; justify-content: space-between;
  }
  .topbar h1 { font-size: 1.1rem; margin: 0; }
  .topbar form { margin: 0; }
  .topbar button.logout {
    background: none; border: 1px solid var(--card-border); color: var(--text-muted);
    border-radius: 8px; padding: 0.4rem 0.9rem; font-size: 0.82rem; cursor: pointer;
  }
  .topbar button.logout:hover { background: var(--content-bg); }
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
  .payment-form input[type="text"] {
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
</style>`;
}

function adminShell(activeNav: string, pageTitle: string, bodyHtml: string): string {
  const navLinks = NAV_ITEMS.map(
    (item) =>
      `<a href="${item.href}" class="${item.key === activeNav ? "active" : ""}">${item.label}</a>`
  ).join("\n");

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle} — Admin</title>
${shellStyles()}
</head>
<body>
<div class="layout">
  <aside class="sidebar">
    <div class="brand">🛒 Bot Admin</div>
    <nav>${navLinks}</nav>
  </aside>
  <div class="main">
    <div class="topbar">
      <h1>${pageTitle}</h1>
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
      const product = e.productName ? escapeHtml(e.productName) : `<span class="muted">—</span>`;
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

export function renderRecordOrdersPage(
  singleResult?: SingleOrderFormResult | null,
  csvResults?: OrderRowResult[] | null,
  csvError?: string | null
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
  <div><button type="submit" class="primary">Ghi nhận</button></div>
</form>
</div>`;

  const okCount = csvResults ? csvResults.filter((r) => r.ok).length : 0;
  const csvResultsBlock =
    csvResults && csvResults.length > 0
      ? `<div class="table-scroll"><table>
<thead><tr><th>Dòng</th><th>Mã đơn</th><th>subId</th><th>Kết quả</th><th>Chi tiết</th></tr></thead>
<tbody>${csvResults
          .map(
            (r) => `<tr>
  <td>${r.line}</td>
  <td>${escapeHtml(r.orderId)}</td>
  <td>${escapeHtml(r.subId)}</td>
  <td><span class="badge badge-${r.ok ? "success" : "danger"}">${r.ok ? "OK" : "LỖI"}</span></td>
  <td>${escapeHtml(r.detail)}</td>
</tr>`
          )
          .join("\n")}</tbody>
</table></div>
<p class="muted">Tổng: ${csvResults.length} dòng, ${okCount} thành công, ${csvResults.length - okCount} lỗi.</p>`
      : "";

  const csvErrorBlock = csvError ? `<div class="error">${escapeHtml(csvError)}</div>` : "";

  const csvCard = `<div class="card">
<h2>Import file CSV (nhiều đơn cùng lúc)</h2>
<p class="muted">Cột bắt buộc: subId, orderId, orderAmount, commissionAmount. Tuỳ chọn: productName, note. File mẫu: src/scripts/templates/weekly-conversions.example.csv</p>
${csvErrorBlock}
<form method="POST" action="/admin/record-orders/csv" enctype="multipart/form-data" class="payment-form" ${confirmOnSubmit("Xác nhận import file CSV này? Sẽ ghi nhận nhiều đơn hàng cùng lúc vào hệ thống.")}>
  <div>
    <label for="file">File CSV</label>
    <input type="file" id="file" name="file" accept=".csv,text/csv" required>
  </div>
  <div><button type="submit" class="primary">Import</button></div>
</form>
${csvResultsBlock}
</div>`;

  return adminShell("record-orders", "Ghi nhận đơn hàng", `${singleCard}\n${csvCard}`);
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
