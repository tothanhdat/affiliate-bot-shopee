import { getMerchantConfig } from "../core/merchants.js";
import type { CommissionEntry, WithdrawalRequest } from "../core/types.js";
import { confirmOnSubmit, copyButton, escapeHtml, formatDateTime, formatVnd, statusBadge } from "./htmlHelpers.js";

/**
 * Trang dashboard viet tay bang HTML thuan (khong dung templating lib, giong cach
 * replyText.ts viet tay message chat). Khong co input tu do nao cua user duoc render
 * (merchant/status la enum, so tien la number, ngay thang duoc format server-side) nen
 * khong can them buoc escape HTML - NGOAI TRU productName, do admin tu go tay nen co the
 * chua ky tu dac biet, luon di qua escapeHtml() truoc khi render.
 * Theme toi/tim tham khao 1 template artifact user cung cap (2026-08-17).
 */

function receivedPercent(entry: CommissionEntry): string {
  if (entry.afterTaxAmount <= 0) return "—";
  return `${Math.round((entry.userShareAmount / entry.afterTaxAmount) * 100)}%`;
}

/**
 * % thue/phi suy nguoc tu so tien da luu (khop dung ty le da dung luc tinh o
 * ledgerStore.recordConversion) - hien kem so tien trong the thong tin don hang.
 */
function taxFeePercents(entry: CommissionEntry): { taxPercent: number; feePercent: number } {
  const afterTaxOnly = entry.commissionAmount - entry.taxAmount;
  const taxPercent = entry.commissionAmount > 0 ? Math.round((entry.taxAmount / entry.commissionAmount) * 100) : 0;
  const feePercent = afterTaxOnly > 0 ? Math.round((entry.platformFeeAmount / afterTaxOnly) * 100) : 0;
  return { taxPercent, feePercent };
}

/**
 * Tach ly do huy tu note (dang "reversed: <ly do>" hoac "<note admin cu> | reversed: <ly do>",
 * xem reverseCommissionEntry() trong ledgerStore.ts) - chi user xem duoc khi don da "reversed"
 * (rui ro so 9 trong rui-ro-can-giai-quyet.md, quyet dinh 2026-08-19 dao nguoc lai quyet dinh
 * truoc do la khong hien thi ly do huy).
 */
function cancelReason(entry: CommissionEntry): string | null {
  if (entry.status !== "reversed" || !entry.note) return null;
  const marker = "reversed: ";
  const idx = entry.note.indexOf(marker);
  return idx === -1 ? entry.note : entry.note.slice(idx + marker.length);
}

function pageShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root {
    --bg: oklch(0.16 0.02 280);
    /* "Kinh" (glass) card dung chung cho .card/.stat/.order-card - nen mo + backdrop-filter blur,
       tham khao dung file thiet ke user cung (Hoa Hong Dashboard.html), gop chung 1 cap bien thay
       vi rieng cho tung loai the vi khac biet giua chung (0.65 vs 0.7 alpha) qua nho de phan biet. */
    --card-bg: oklch(0.21 0.025 280 / 0.65);
    --card-border: oklch(1 0 0 / 0.07);
    --card-shadow: 0 6px 20px oklch(0 0 0 / 0.2);
    --text: oklch(0.92 0.01 280);
    --text-soft: oklch(0.8 0.01 280);
    --text-muted: oklch(0.7 0.01 280);
    --text-dim: oklch(0.6 0.01 280);
    --accent: oklch(0.75 0.13 300);
    --accent-soft: oklch(1 0 0 / 0.08);
    --success: oklch(0.8 0.14 150);
    --success-soft: oklch(0.4 0.11 150 / 0.3);
    --amount-positive: oklch(0.72 0.15 150);
    --warning: oklch(0.8 0.14 70);
    --warning-soft: oklch(0.4 0.11 70 / 0.3);
    --amount-warning: oklch(0.75 0.14 55);
    --danger: oklch(0.8 0.14 25);
    --danger-soft: oklch(0.4 0.11 25 / 0.3);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, "Inter", system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    position: relative;
    min-height: 100vh;
    /* chi chan ngang (cac khoi glow tran ra ngoai canh trai/phai) - de nguyen cuon doc binh
       thuong, tranh loi cuon tren mobile Safari neu dung overflow:hidden ca 2 chieu tren body. */
    overflow-x: hidden;
  }
  /* Vung sang mo phia sau noi dung, tham khao theo file thiet ke user cung (Hoa Hong Dashboard.html)
     - 3 khoi tron blur + 1 lop luoi cham mo, deu position:absolute so voi body nen khong choan
     layout, chi lam nen do bot don dieu thay vi mau phang. */
  .bg-glow { position: absolute; border-radius: 50%; pointer-events: none; }
  /* Sang hon (tang lightness/chroma/alpha) + xoay nhanh hon (22-30s -> 6-8s, bien do di chuyen
     lon hon) so voi ban dau - ban dau qua mo/qua cham, phai nhin ky moi thay dang chuyen dong. */
  .bg-glow-1 {
    top: -200px; left: -150px; width: 600px; height: 600px;
    background: radial-gradient(circle, oklch(0.58 0.17 300 / 0.55), transparent 70%);
    filter: blur(40px); animation: glow1 6s ease-in-out infinite;
  }
  .bg-glow-2 {
    top: 20%; right: -200px; width: 650px; height: 650px;
    background: radial-gradient(circle, oklch(0.68 0.17 70 / 0.42), transparent 70%);
    filter: blur(50px); animation: glow2 7s ease-in-out infinite;
  }
  .bg-glow-3 {
    bottom: -250px; left: 20%; width: 700px; height: 700px;
    background: radial-gradient(circle, oklch(0.52 0.16 260 / 0.48), transparent 70%);
    filter: blur(50px); animation: glow1 8s ease-in-out infinite reverse;
  }
  .bg-dots {
    position: absolute; inset: 0; pointer-events: none;
    background-image: radial-gradient(oklch(1 0 0 / 0.035) 1px, transparent 1px);
    background-size: 26px 26px;
  }
  @keyframes glow1 { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(70px, -55px) scale(1.25); } }
  @keyframes glow2 { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(-80px, 65px) scale(1.2); } }
  .page-content {
    position: relative;
    z-index: 1;
    max-width: 780px;
    margin: 0 auto;
    padding: 2rem 1.25rem 4rem;
  }
  h1 { font-size: 1.75rem; font-weight: 700; margin: 0; color: #fff; }
  .subtitle { color: var(--text-muted); font-size: 0.9375rem; margin: 0.35rem 0 1.75rem; }
  /* "The kinh" (glass) dung chung cho ca 3 loai the trong trang - nen mo + blur phia sau, tham
     khao dung file thiet ke user cung (Hoa Hong Dashboard.html). */
  .card, .totals .stat, .order-card {
    background: var(--card-bg);
    -webkit-backdrop-filter: blur(16px);
    backdrop-filter: blur(16px);
    border: 1px solid var(--card-border);
    box-shadow: var(--card-shadow);
  }
  .card {
    border-radius: 16px;
    padding: 1.25rem;
    margin-bottom: 1.25rem;
  }
  .totals { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 1.25rem; }
  @media (max-width: 420px) { .totals { grid-template-columns: 1fr; } }
  .totals .stat { border-radius: 16px; padding: 1.25rem; }
  .stat .label {
    font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;
    color: var(--text-dim); margin-bottom: 0.625rem;
  }
  .stat .value { font-size: 1.625rem; font-weight: 700; color: var(--text); }
  .stat.accent .value { color: var(--accent); }
  .order-list { display: flex; flex-direction: column; gap: 1rem; }
  .order-card { border-radius: 16px; padding: 1.25rem 1.375rem; }
  .order-card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
  .order-card-product { color: var(--text-soft); font-size: 0.875rem; margin: 0 0 1rem; }
  .cancel-reason { color: var(--danger); font-size: 0.8125rem; margin-top: 0.75rem; }
  /* repeat(4,1fr) khop dung bo cuc "2 hang x 4 cot" cua thiet ke tham khao (7 stat + "Bang chung"
     khi don da rut = 8 o); fallback 2 cot duoi 480px de gia tri khong bi bop met tren man hinh
     dien thoai hep (day la nguyen nhan cac lan "roi cot"/"vo dong" bao cao truoc do). */
  .order-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.875rem 1.25rem; }
  @media (max-width: 480px) { .order-stats { grid-template-columns: repeat(2, 1fr); } }
  .order-stats > div { min-width: 0; }
  .order-stats .label {
    font-size: 0.65625rem; letter-spacing: 0.05em; font-weight: 600; color: var(--text-dim);
    margin-bottom: 0.25rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .order-stats .value { font-size: 0.9375rem; font-weight: 600; color: var(--text); }
  .order-id { color: var(--accent); font-weight: 600; font-size: 0.9375rem; }
  .order-id-label { color: var(--text-muted); font-weight: 400; font-size: 0.875rem; }
  .copy-btn {
    background: var(--accent-soft); color: var(--text-soft); border: none; border-radius: 6px;
    padding: 0.1875rem 0.5625rem; font-size: 0.6875rem; font-weight: 600; cursor: pointer; vertical-align: middle;
  }
  .copy-btn:hover { filter: brightness(1.3); }
  .proof-link { color: var(--accent); font-weight: 600; text-decoration: none; }
  .proof-link:hover { text-decoration: underline; }
  .withdraw-form { display: flex; justify-content: flex-end; margin-bottom: 1.25rem; }
  .muted { color: var(--text-dim); font-size: 0.8125rem; margin-top: 0.25rem; }
  .amount-positive { color: var(--amount-positive); }
  .amount-warning { color: var(--amount-warning); }
  .badge {
    display: inline-block;
    padding: 0.3125rem 0.75rem;
    border-radius: 1.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .badge-success { background: var(--success-soft); color: var(--success); }
  .badge-warning { background: var(--warning-soft); color: var(--warning); }
  .badge-danger { background: var(--danger-soft); color: var(--danger); }
  .badge-accent { background: var(--accent-soft); color: var(--accent); }
  /* "Hop co border" cho thong bao (tich luy them / dang cho rut / loi) - cung 1 cong thuc
     mau nen mo + vien mau theo tone, chi doi hue - dung chung 1 "phong cach" trong toan trang
     thay vi chi ap dung rieng cho o "Tich luy them" nhu truoc. */
  .error {
    background: oklch(0.24 0.04 25 / 0.18); color: oklch(0.85 0.05 25); border: 1px solid oklch(0.6 0.1 25 / 0.3);
    border-radius: 12px; padding: 0.875rem 1.125rem; margin-bottom: 1.25rem; font-size: 0.875rem;
  }
  .pending-notice {
    background: oklch(0.24 0.04 70 / 0.18); color: oklch(0.85 0.05 70); border: 1px solid oklch(0.6 0.1 70 / 0.3);
    border-radius: 12px; padding: 0.875rem 1.125rem; margin-bottom: 1.75rem; font-size: 0.875rem;
  }
  .progress-hint {
    background: oklch(0.24 0.04 70 / 0.18); color: oklch(0.85 0.05 70); border: 1px solid oklch(0.6 0.1 70 / 0.3);
    border-radius: 12px; padding: 0.875rem 1.125rem; margin-bottom: 1.75rem; font-size: 0.875rem;
  }
  .empty { color: var(--text-dim); font-size: 0.9375rem; padding: 1rem 0; text-align: center; }
  button {
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 12px;
    padding: 0.75rem 1.5rem;
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 14px oklch(0.75 0.13 300 / 0.35);
  }
  button:hover { filter: brightness(1.08); }
</style>
</head>
<body>
<div class="bg-glow bg-glow-1"></div>
<div class="bg-glow bg-glow-2"></div>
<div class="bg-glow bg-glow-3"></div>
<div class="bg-dots"></div>
<div class="page-content">
${body}
</div>
</body>
</html>`;
}

export function renderInvalidTokenPage(): string {
  return pageShell(
    "Đường dẫn không hợp lệ",
    `<h1>Đường dẫn không hợp lệ hoặc đã hết hạn</h1>
<p class="subtitle">Vui lòng nhắn lại "idid" cho bot để lấy link mới.</p>`
  );
}

export function renderDashboardPage(input: {
  entries: CommissionEntry[];
  availableBalance: number;
  pendingBalance: number;
  paidTotal: number;
  pendingWithdrawal: WithdrawalRequest | null;
  thresholdVnd: number;
  token: string;
  errorMessage?: string;
}): string {
  // The dang the xep doc (khong phai bang nhieu cot) - trang nay chu yeu mo tu dien thoai qua
  // Telegram/Zalo, bang ngang co nhieu cot se bi cat mat (can cuon ngang moi thay), day la nguyen
  // nhan user 2 lan bao "khong thay cot X" (trang thai, roi den thue/phi) du du lieu van co san.
  // Grid tu dong xuong dong (auto-fill) thay vi bang giai quyet tan goc, khong con cot nao bi khuat.
  const cards = input.entries
    .map((e) => {
      const badge = statusBadge(e);
      const product = e.productName ? escapeHtml(e.productName) : null;
      const { taxPercent, feePercent } = taxFeePercents(e);
      const proofCell =
        e.status === "paid" && e.proofImagePath
          ? `<div><div class="label">Bằng chứng</div><div class="value"><a class="proof-link" href="/d/${input.token}/withdrawal-proofs/${encodeURIComponent(e.proofImagePath)}" target="_blank" rel="noopener">Xem ảnh</a></div></div>`
          : "";
      const reason = cancelReason(e);
      const reasonLine = reason
        ? `<div class="cancel-reason"><span class="order-id-label">Lý do huỷ:</span> ${escapeHtml(reason)}</div>`
        : "";
      return `<div class="order-card">
  <div class="order-card-top">
    <div>
      <div class="order-id"><span class="order-id-label">Mã đơn:</span> ${escapeHtml(e.orderId)} ${copyButton(e.orderId)}</div>
      <div class="muted">${formatDateTime(e.createdAt)} · ${getMerchantConfig(e.merchant).displayName}</div>
    </div>
    <span class="badge badge-${badge.tone}">${badge.label}</span>
  </div>
  ${product ? `<div class="order-card-product">${product}</div>` : ""}
  <div class="order-stats">
    <div><div class="label">Giá trị đơn</div><div class="value">${formatVnd(e.orderAmount)}</div></div>
    <div><div class="label">Hoa hồng</div><div class="value">${formatVnd(e.commissionAmount)}</div></div>
    <div><div class="label">Thuế ${taxPercent}%</div><div class="value amount-warning">${formatVnd(e.taxAmount)}</div></div>
    <div><div class="label">Phí sàn ${feePercent}%</div><div class="value amount-warning">${formatVnd(e.platformFeeAmount)}</div></div>
    <div><div class="label">HH sau thuế</div><div class="value">${formatVnd(e.afterTaxAmount)}</div></div>
    <div><div class="label">% nhận</div><div class="value">${receivedPercent(e)}</div></div>
    <div><div class="label">Bạn nhận</div><div class="value amount-positive">${formatVnd(e.userShareAmount)}</div></div>
    ${proofCell}
  </div>
  ${reasonLine}
</div>`;
    })
    .join("\n");

  const table =
    input.entries.length > 0
      ? `<div class="order-list">${cards}</div>`
      : `<div class="card"><p class="empty">Chưa có đơn hàng nào được ghi nhận. Đơn hàng của bạn sẽ hiển thị khi được đánh dấu trạng thái là "Đã nhận hàng"</p></div>`;

  const errorBlock = input.errorMessage ? `<div class="error">${escapeHtml(input.errorMessage)}</div>` : "";

  const withdrawBlock = input.pendingWithdrawal
    ? `<div class="pending-notice">💸 Yêu cầu rút ${formatVnd(input.pendingWithdrawal.amount)} đang chờ xử lý (gửi lúc ${formatDateTime(input.pendingWithdrawal.createdAt)}). Admin sẽ liên hệ để chuyển khoản.</div>`
    : input.availableBalance >= input.thresholdVnd
      ? `<form method="POST" action="/d/${input.token}/withdraw" class="withdraw-form" ${confirmOnSubmit(`Xác nhận gửi yêu cầu rút toàn bộ ${formatVnd(input.availableBalance)}?`)}>
  <button type="submit">Yêu cầu rút ${formatVnd(input.availableBalance)}</button>
</form>`
      : `<p class="progress-hint">Tích luỹ thêm ${formatVnd(Math.max(0, input.thresholdVnd - input.availableBalance))} nữa để đủ điều kiện rút tiền (tối thiểu ${formatVnd(input.thresholdVnd)}).</p>`;

  const body = `<h1>💰 Hoa hồng của bạn</h1>
<p class="subtitle">Đối soát hoa hồng affiliate theo từng đơn hàng</p>
${errorBlock}
<div class="totals">
  <div class="stat accent"><div class="label">Khả dụng</div><div class="value">${formatVnd(input.availableBalance)}</div></div>
  <div class="stat"><div class="label">Đang chờ rút</div><div class="value">${formatVnd(input.pendingBalance)}</div></div>
  <div class="stat"><div class="label">Đã nhận</div><div class="value">${formatVnd(input.paidTotal)}</div></div>
</div>
${withdrawBlock}
${table}`;

  return pageShell("Hoa hồng của bạn", body);
}
