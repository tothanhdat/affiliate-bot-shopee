import { getMerchantConfig } from "../core/merchants.js";
import type { CommissionEntry, Platform, WithdrawalRequest } from "../core/types.js";
import { VIETNAM_BANKS } from "../core/vietnamBanks.js";
import { formatVnDateDdMm } from "../core/vietnamDate.js";
import { confirmOnSubmit, copyButton, escapeHtml, formatDateTime, formatVnd, statusBadge } from "./htmlHelpers.js";

/**
 * Trang dashboard viet tay bang HTML thuan (khong dung templating lib, giong cach
 * replyText.ts viet tay message chat). Khong co input tu do nao cua user duoc render
 * (merchant/status la enum, so tien la number, ngay thang duoc format server-side) nen
 * khong can them buoc escape HTML - NGOAI TRU productName, do admin tu go tay nen co the
 * chua ky tu dac biet, luon di qua escapeHtml() truoc khi render.
 * Theme toi/tim tham khao 1 template artifact user cung cap (2026-08-17); lam lai 2026-10-07 theo
 * anh tham chieu cua user: the so du to mau theo tong + "Kha dung" phat sang, hop thong bao co icon,
 * the don chia cot co duong ke giua, "Ban nhan" vang am lam diem nhan (2026-10-07: bo ngoi sao trang tri goc the theo yeu cau user).
 */

function receivedPercent(entry: CommissionEntry): string {
  // Ty le DA CHOT cua don (2026-10-01) - chinh xac tuyet doi. Suy nguoc chi la duong lui cho entry
  // ghi truoc khi co cot nay, xem taxFeePercents().
  if (entry.userSharePercent !== null) return `${entry.userSharePercent}%`;
  if (entry.afterTaxAmount <= 0) return "—";
  return `${Math.round((entry.userShareAmount / entry.afterTaxAmount) * 100)}%`;
}

/**
 * % thue/phi cua don, uu tien ty le DA CHOT trong DB (2026-10-01). Chi suy nguoc tu so tien cho
 * entry cu chua co 3 cot % - va suy nguoc thi SAI khi hoa hong nho: thue 10% cua 7d lam tron con 1d,
 * suy nguoc ra 14%. Do la ly do uu tien so chot chu khong phai chi de cho gon.
 */
function taxFeePercents(entry: CommissionEntry): { taxPercent: number; feePercent: number } {
  const afterTaxOnly = entry.commissionAmount - entry.taxAmount;
  const taxPercent =
    entry.taxPercent ??
    (entry.commissionAmount > 0 ? Math.round((entry.taxAmount / entry.commissionAmount) * 100) : 0);
  const feePercent =
    entry.platformFeePercent ??
    (afterTaxOnly > 0 ? Math.round((entry.platformFeeAmount / afterTaxOnly) * 100) : 0);
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
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>${title}</title>
<style>
  :root {
    --bg: oklch(0.13 0.02 285);
    /* "Kinh" (glass) card dung chung cho .card/.order-card/.withdraw-form - nen mo + backdrop-filter
       blur. Ban 2026-10-07 (feedback UI cua user) sang + day hon ban cu de the noi ro khoi nen. */
    --card-bg: oklch(0.27 0.035 290 / 0.55);
    --card-border: oklch(1 0 0 / 0.12);
    --card-shadow: 0 10px 30px oklch(0 0 0 / 0.3), inset 0 1px 0 oklch(1 0 0 / 0.06);
    --text: oklch(0.95 0.01 280);
    --text-soft: oklch(0.86 0.01 280);
    --text-muted: oklch(0.74 0.015 280);
    --text-dim: oklch(0.66 0.015 280);
    --divider: oklch(1 0 0 / 0.1);
    --accent: oklch(0.76 0.16 310);
    --accent-soft: oklch(1 0 0 / 0.08);
    --success: oklch(0.8 0.15 150);
    --success-soft: oklch(0.45 0.12 150 / 0.28);
    --warning: oklch(0.8 0.14 65);
    --warning-soft: oklch(0.45 0.11 65 / 0.28);
    --info: oklch(0.88 0.04 250);
    --danger: oklch(0.8 0.14 25);
    --danger-soft: oklch(0.45 0.11 25 / 0.28);
    /* "Ban nhan" - ket qua cuoi cung cua moi don, mau vang am de la diem nhan mat dung dau tien. */
    --highlight: oklch(0.86 0.14 85);
    --shopee: #ee4d2d;
  }
  * { box-sizing: border-box; }
  html { background: var(--bg); }
  body {
    margin: 0;
    font-family: -apple-system, "Inter", system-ui, sans-serif;
    /* Nen gradient tim (tren) -> den sau (duoi) thay vi mau phang, cac khoi glow ben duoi phu len. */
    background: linear-gradient(180deg, oklch(0.22 0.07 295) 0%, oklch(0.15 0.035 288) 40%, var(--bg) 100%);
    color: var(--text);
    position: relative;
    min-height: 100vh;
    /* chi chan ngang (cac khoi glow tran ra ngoai canh trai/phai) - de nguyen cuon doc binh
       thuong, tranh loi cuon tren mobile Safari neu dung overflow:hidden ca 2 chieu tren body. */
    overflow-x: hidden;
  }
  /* Vung sang mo phia sau noi dung - 3 khoi tron blur + 1 lop hat sang, deu position:absolute so
     voi body nen khong choan layout. */
  .bg-glow { position: absolute; border-radius: 50%; pointer-events: none; }
  .bg-glow-1 {
    top: -200px; left: -150px; width: 600px; height: 600px;
    background: radial-gradient(circle, oklch(0.58 0.17 300 / 0.5), transparent 70%);
    filter: blur(40px); animation: glow1 6s ease-in-out infinite;
  }
  .bg-glow-2 {
    top: 20%; right: -200px; width: 650px; height: 650px;
    background: radial-gradient(circle, oklch(0.68 0.17 70 / 0.32), transparent 70%);
    filter: blur(50px); animation: glow2 7s ease-in-out infinite;
  }
  .bg-glow-3 {
    bottom: -250px; left: 20%; width: 700px; height: 700px;
    background: radial-gradient(circle, oklch(0.52 0.16 260 / 0.42), transparent 70%);
    filter: blur(50px); animation: glow1 8s ease-in-out infinite reverse;
  }
  /* "Hat min" tao do sau: 3 lop cham voi kich thuoc/khoang cach/do sang khac nhau, luoi lech nhau
     nen khong ra hoa van deu tap nhu 1 lop cham duy nhat. */
  .bg-dots {
    position: absolute; inset: 0; pointer-events: none;
    background-image:
      radial-gradient(oklch(1 0 0 / 0.05) 1px, transparent 1.5px),
      radial-gradient(oklch(0.9 0.08 300 / 0.35) 1px, transparent 1.6px),
      radial-gradient(oklch(1 0 0 / 0.45) 1.2px, transparent 2px);
    background-size: 26px 26px, 113px 97px, 241px 263px;
    background-position: 0 0, 37px 59px, 151px 23px;
  }
  @keyframes glow1 { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(70px, -55px) scale(1.25); } }
  @keyframes glow2 { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(-80px, 65px) scale(1.2); } }
  .page-content {
    position: relative;
    z-index: 1;
    max-width: 780px;
    margin: 0 auto;
    padding: 2rem 1rem 4rem;
  }
  h1 { font-size: 1.75rem; font-weight: 700; margin: 0; color: #fff; }
  .subtitle { color: var(--text-muted); font-size: 0.9375rem; margin: 0.35rem 0 0.3rem; }
  .identity-line { color: var(--text-dim); font-size: 0.8125rem; margin: 0.5rem 0 1.75rem; }
  .card, .order-card, .withdraw-form {
    background: var(--card-bg);
    -webkit-backdrop-filter: blur(16px);
    backdrop-filter: blur(16px);
    border: 1px solid var(--card-border);
    box-shadow: var(--card-shadow);
  }
  .card {
    border-radius: 18px;
    padding: 1.25rem;
    margin-bottom: 1.25rem;
  }
  /* 4 the so du: moi the 1 tong mau rieng (nen pha mau + vien + so cung tong) de phan biet ngay ca
     khi chua doc nhan. "Kha dung" la the DUY NHAT phat sang (vien sang + glow + so phat sang) - day
     la con so user can thay dau tien khi mo trang. */
  .totals { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.875rem; margin-bottom: 1.25rem; }
  @media (max-width: 560px) { .totals { grid-template-columns: repeat(2, 1fr); } }
  .stat {
    --tone: oklch(1 0 0);
    border-radius: 18px; padding: 1.125rem 1.125rem 1.25rem; min-width: 0;
    background: linear-gradient(160deg, color-mix(in oklch, var(--tone) 16%, transparent), color-mix(in oklch, var(--tone) 5%, transparent)), oklch(0.18 0.03 285 / 0.6);
    -webkit-backdrop-filter: blur(16px);
    backdrop-filter: blur(16px);
    border: 1px solid color-mix(in oklch, var(--tone) 38%, transparent);
    box-shadow: 0 8px 24px oklch(0 0 0 / 0.25);
  }
  .stat .label {
    font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;
    color: var(--text-muted); margin-bottom: 0.625rem;
  }
  .stat .value { font-size: 1.625rem; font-weight: 800; color: var(--tone); overflow-wrap: anywhere; }
  .stat.accent { --tone: var(--accent); }
  .stat.warning { --tone: var(--warning); }
  .stat.info { --tone: var(--info); }
  .stat.success { --tone: var(--success); }
  .stat.danger { --tone: var(--danger); }
  /* Dong phu duoi con so - giai thich ngay mo khoa / li do bi tru, chu nho va mo hon gia tri. */
  .stat .hint { font-size: 0.75rem; color: var(--text-dim); margin-top: 0.3125rem; line-height: 1.45; }
  .stat.accent {
    border: 1.5px solid color-mix(in oklch, var(--accent) 85%, white);
    box-shadow: 0 0 0 1px oklch(0.76 0.16 310 / 0.25), 0 0 22px oklch(0.7 0.2 310 / 0.45), inset 0 0 18px oklch(0.7 0.2 310 / 0.18);
  }
  .stat.accent .value { color: oklch(0.82 0.15 320); text-shadow: 0 0 14px oklch(0.7 0.22 315 / 0.7); }
  .order-list { display: flex; flex-direction: column; gap: 1rem; }
  .order-card { border-radius: 20px; padding: 1.25rem 1.375rem 1.375rem; }
  .order-card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.875rem; flex-wrap: wrap; }
  .order-meta { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; color: var(--text-dim); font-size: 0.8125rem; margin-top: 0.375rem; }
  /* Badge + ngay mo khoa xep doc, canh phai - doi xung voi khoi order-id/order-meta ben trai. */
  .badge-wrap { display: flex; flex-direction: column; align-items: flex-end; gap: 0.3125rem; }
  .unlock-date { font-size: 0.75rem; color: var(--text-dim); white-space: nowrap; }
  .merchant { display: inline-flex; align-items: center; gap: 0.25rem; color: var(--text-muted); font-weight: 600; }
  .merchant-shopee { color: var(--shopee); }
  .merchant svg { width: 14px; height: 14px; flex-shrink: 0; }
  .order-card-product { color: var(--text); font-size: 0.9375rem; font-weight: 500; line-height: 1.45; margin: 0 0 1.125rem; }
  .cancel-reason { color: var(--danger); font-size: 0.8125rem; margin-top: 0.875rem; }
  .debt-note { color: var(--warning); font-size: 0.875rem; margin: 0 0 1rem; line-height: 1.5; }
  /* 4 cot tren man rong, 2 cot duoi 560px. Duong ke mo GIUA cac cot (khong bao quanh) de doc
     ngang "Gia tri don | Hoa hong" nhu 1 cap doi chieu - padding-left chi cho o khong dung dau hang. */
  .order-stats { display: grid; grid-template-columns: repeat(4, 1fr); row-gap: 0.875rem; }
  .order-stats > div { min-width: 0; padding: 0 1rem; }
  .order-stats > div:nth-child(4n + 1) { padding-left: 0; }
  .order-stats > div:not(:nth-child(4n + 1)) { border-left: 1px solid var(--divider); }
  @media (max-width: 560px) {
    .order-stats { grid-template-columns: repeat(2, 1fr); }
    .order-stats > div:nth-child(n) { padding-left: 1rem; border-left: 1px solid var(--divider); }
    .order-stats > div:nth-child(2n + 1) { padding-left: 0; border-left: none; }
  }
  .order-stats .label {
    font-size: 0.75rem; font-weight: 500; color: var(--text-muted);
    margin-bottom: 0.25rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .order-stats .value { font-size: 1rem; font-weight: 700; color: var(--text); }
  .order-stats .value.amount-highlight { font-size: 1.25rem; font-weight: 800; color: var(--highlight); }
  /* Don da huy: van hien so de doi chieu nhung gach ngang + mo - to vang "ket qua" se doc nham
     thanh tien da nhan (cung quy tac voi /admin/orders). */
  .order-stats .value.amount-void { font-size: 1.25rem; color: var(--text-dim); text-decoration: line-through; }
  .order-id { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; color: var(--accent); font-weight: 700; font-size: 1rem; letter-spacing: 0.01em; }
  .order-id-label { color: var(--text-muted); font-weight: 400; font-size: 0.9375rem; letter-spacing: 0; }
  /* Icon copy ve bang mask (khong nhoi SVG vao markup): copyButton() doi textContent thanh "Da copy"
     sau khi bam - neu icon la phan tu con thi se bi xoa mat theo. */
  .copy-btn {
    display: inline-flex; align-items: center; gap: 0.3125rem;
    background: oklch(1 0 0 / 0.07); color: var(--text-soft); border: 1px solid oklch(1 0 0 / 0.16);
    border-radius: 8px; padding: 0.25rem 0.625rem; font-size: 0.8125rem; font-weight: 500;
    font-family: inherit; cursor: pointer; box-shadow: none; line-height: 1.3;
  }
  .copy-btn::before {
    content: ""; width: 14px; height: 14px; flex-shrink: 0; background: currentColor;
    -webkit-mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect width='14' height='14' x='8' y='8' rx='2'/><path d='M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'/></svg>") center / contain no-repeat;
    mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect width='14' height='14' x='8' y='8' rx='2'/><path d='M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'/></svg>") center / contain no-repeat;
  }
  .copy-btn:hover { background: oklch(1 0 0 / 0.12); filter: none; }
  .proof-link { color: var(--accent); font-weight: 600; text-decoration: none; }
  .proof-link:hover { text-decoration: underline; }
  .withdraw-form {
    display: flex; flex-direction: column; gap: 0.875rem; align-items: stretch;
    border-radius: 18px; padding: 1.25rem; margin-bottom: 1.25rem;
  }
  .form-field { display: flex; flex-direction: column; gap: 0.375rem; }
  .form-field label {
    font-size: 0.75rem; font-weight: 600; letter-spacing: 0.02em; color: var(--text-muted);
  }
  .form-field input, .form-field select {
    background: oklch(0.2 0.02 280 / 0.6); color: var(--text); border: 1px solid var(--card-border);
    border-radius: 10px; padding: 0.625rem 0.75rem; font-size: 1rem; font-family: inherit;
  }
  .form-field input:focus, .form-field select:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .withdraw-form button { align-self: flex-end; }
  .muted { color: var(--text-dim); font-size: 0.8125rem; margin-top: 0.25rem; }
  .badge {
    display: inline-block;
    padding: 0.3125rem 0.875rem;
    border-radius: 999px;
    font-size: 0.8125rem;
    font-weight: 600;
    white-space: nowrap;
    border: 1px solid transparent;
  }
  .badge-success { background: var(--success-soft); color: var(--success); border-color: oklch(0.8 0.15 150 / 0.3); }
  .badge-warning { background: var(--warning-soft); color: var(--warning); border-color: oklch(0.8 0.14 65 / 0.3); }
  .badge-danger { background: var(--danger-soft); color: var(--danger); border-color: oklch(0.8 0.14 25 / 0.3); }
  /* Hop thong bao (tich luy them / dang cho rut / loi): icon tron dac + chu, cung 1 cong thuc
     nen mo + vien theo tone, chi doi hue. */
  .notice {
    --tone: var(--warning);
    display: flex; align-items: flex-start; gap: 0.75rem;
    background: color-mix(in oklch, var(--tone) 10%, oklch(0.18 0.03 285 / 0.6));
    -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
    color: color-mix(in oklch, var(--tone) 35%, white);
    border: 1px solid color-mix(in oklch, var(--tone) 45%, transparent);
    border-radius: 14px; padding: 0.875rem 1.125rem; margin: 0 0 1.5rem; font-size: 0.9375rem; line-height: 1.45;
  }
  .notice-danger { --tone: var(--danger); }
  .notice-icon {
    flex-shrink: 0; width: 20px; height: 20px; margin-top: 0.0625rem; border-radius: 50%;
    background: var(--tone); color: oklch(0.2 0.03 60);
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 0.8125rem; font-weight: 800; line-height: 1;
  }
  .warning-note { color: var(--text-dim); font-size: 0.8125rem; margin: 0 0 1.25rem; }
  .empty { color: var(--text-muted); font-size: 0.9375rem; padding: 1rem 0; text-align: center; }
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
<p class="subtitle">Vui lòng nhắn lại "xemhh" cho bot để lấy link mới.</p>`
  );
}

/** Tui mua sam (icon chung, khong phai logo thuong hieu) - chi to cam cho Shopee, xem merchantTag(). */
const BAG_ICON =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 7V6a5 5 0 0 1 10 0v1h2.2a1 1 0 0 1 1 .92l.96 12A2 2 0 0 1 19.17 22H4.83a2 2 0 0 1-1.99-2.08l.96-12A1 1 0 0 1 4.8 7H7Zm2 0h6V6a3 3 0 0 0-6 0v1Z"/></svg>';

/** Ten san kem icon tui. Chi Shopee (san DANG ho tro) to cam; san da ngung (don cu) giu mau trung tinh. */
function merchantTag(merchant: CommissionEntry["merchant"]): string {
  const name = getMerchantConfig(merchant).displayName;
  const cls = merchant === "shopee" ? "merchant merchant-shopee" : "merchant";
  return `<span class="${cls}">${BAG_ICON}${escapeHtml(name)}</span>`;
}

function notice(content: string, icon = "!", tone: "warning" | "danger" = "warning"): string {
  const cls = tone === "danger" ? "notice notice-danger" : "notice";
  return `<div class="${cls}"><span class="notice-icon" aria-hidden="true">${icon}</span><div>${content}</div></div>`;
}

const PLATFORM_LABELS: Record<Platform, string> = {
  telegram: "Telegram",
  zalo: "Zalo",
  http: "HTTP",
};

export function renderDashboardPage(input: {
  entries: CommissionEntry[];
  /** KHONG tru no (mo hinh no 2026-10-08) - no chi bi tru luc yeu cau rut duoc duyet. */
  availableBalance: number;
  /** Tien da duoc Shopee duyet nhung con bi giam (2026-10-08, xem payoutHold.ts). */
  heldBalance: number;
  /** Tung don dang bi giam - moi don hien ngay mo khoa cua CHINH no. */
  /**
   * (2026-10-08) KHONG con duoc DOC o file nay - ngay mo khoa hien truc tiep tu `e.availableFrom`
   * cua tung phan tu trong `entries` (vong lap render tung don ben duoi), khong can gop qua day
   * nua. Van giu field nay trong signature de khop voi UserLedgerSummary (server.ts truyen qua
   * `...summary`), tranh phai sua ca 2 noi goi renderDashboardPage() chi vi 1 field khong dung toi.
   */
  heldEntries: CommissionEntry[];
  /** No hoan tra con phai tru. */
  debtRemaining: number;
  /** Tung khoan no - de noi RO don nao bi tra hang, user doi chieu duoc. */
  debts: Array<{ orderId: string; remaining: number }>;
  pendingBalance: number;
  paidTotal: number;
  pendingWithdrawal: WithdrawalRequest | null;
  /**
   * Yeu cau rut VUA duoc tu dong xac nhan de tru no (W <= no) - chi co ngay sau khi user bam rut,
   * de trang noi ro chuyen gi vua xay ra thay vi Kha dung tu nhien ve 0 khong ly do.
   */
  settledWithdrawal?: WithdrawalRequest | null;
  thresholdVnd: number;
  token: string;
  platform: Platform;
  userId: string;
  /** Ten hien thi lay tu profile Telegram/Zalo (user_profiles) - null neu chua co du lieu. */
  displayName: string | null;
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
      <div class="order-meta"><span>${formatDateTime(e.createdAt)}</span>${merchantTag(e.merchant)}</div>
    </div>
    <div class="badge-wrap">
      <span class="badge badge-${badge.tone}">${badge.label}</span>
      ${
        badge.label === "Đang tạm giữ" && e.availableFrom
          ? `<div class="unlock-date">mở khoá ${formatVnDateDdMm(new Date(`${e.availableFrom}T12:00:00Z`))}</div>`
          : ""
      }
    </div>
  </div>
  ${product ? `<div class="order-card-product">${product}</div>` : ""}
  <div class="order-stats">
    <div><div class="label">Giá trị đơn</div><div class="value">${formatVnd(e.orderAmount)}</div></div>
    <div><div class="label">Hoa hồng</div><div class="value">${formatVnd(e.commissionAmount)}</div></div>
    <div><div class="label">Thuế ${taxPercent}%</div><div class="value">${formatVnd(e.taxAmount)}</div></div>
    <div><div class="label">Phí sàn ${feePercent}%</div><div class="value">${formatVnd(e.platformFeeAmount)}</div></div>
    <div><div class="label">HH sau thuế</div><div class="value">${formatVnd(e.afterTaxAmount)}</div></div>
    <div><div class="label">% nhận</div><div class="value">${receivedPercent(e)}</div></div>
    <div><div class="label">Bạn nhận</div><div class="value ${e.status === "reversed" ? "amount-void" : "amount-highlight"}">${formatVnd(e.userShareAmount)}</div></div>
    ${proofCell}
  </div>
  ${reasonLine}
</div>`;
    })
    .join("\n");

  // empty state nay hien khi user CHUA CO DON NAO (moi trang thai, ke ca pending) - khong phai
  // "chua co don hoan thanh": bang don o duoi liet ke ca don dang cho xac nhan. Text cu noi
  // "chua co don o trang thai hoan thanh" gay hieu nham la don pending khong duoc tinh (sua 2026-09-10).
  const table =
    input.entries.length > 0
      ? `<div class="order-list">${cards}</div>`
      : `<div class="card"><p class="empty">Đơn hàng của bạn sẽ hiển thị tại đây. Hiện tại bạn chưa phát sinh đơn hàng nào.<br>Khi có đơn hoàn thành, Admin sẽ chủ động nhắn tin cho bạn để xem hoa hồng nhé.</p></div>`;

  const errorBlock = input.errorMessage ? notice(escapeHtml(input.errorMessage), "!", "danger") : "";

  // phan-hoi-cai-thien-trai-nghiem-nguoi-dung.md muc 9 (2026-08-20): bat buoc nhap thong tin
  // ngan hang ngay luc gui yeu cau rut (thay vi admin tu lien he hoi sau) - admin van tu doi
  // chieu/xac nhan lai qua tin nhan rieng truoc khi chuyen khoan that, KHONG tu dong xac thuc.
  const bankOptions = VIETNAM_BANKS.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join(
    "\n"
  );

  // 2026-08-20 (yeu cau truc tiep cua user): the rieng cho tong hoa hong cac don dang "pending"
  // (bao cao Shopee con ghi "Dang cho xu ly") - CHI de hien thi, KHONG cong vao
  // availableBalance/pendingBalance nao ca, tranh nham lan voi "Dang cho rut" (tien da confirmed,
  // dang bi giu boi 1 yeu cau rut tien). Khai bao truoc withdrawBlock vi progress-hint ben duoi
  // can dung gia tri nay (2026-09-16: tich luy con thieu tinh tren "Cho xac nhan", KHONG phai
  // "Kha dung" - nut Rut tien van giu nguyen logic cu dung availableBalance).
  const pendingConfirmationTotal = input.entries
    .filter((e) => e.status === "pending")
    .reduce((sum, e) => sum + e.userShareAmount, 0);

  // Mo hinh no 2026-10-08 (yeu cau truc tiep cua user): Kha dung va no la HAI so tach bach, no chi
  // bi tru LUC yeu cau rut duoc duyet. Dieu kien rut = Kha dung >= nguong VA Kha dung >= no (chan ca
  // o ledgerStore.requestWithdrawal). Moc that su dang chan la so LON hon trong 2 so nay.
  // Phai noi ro TRUOC KHI user bam gui Admin se tru bao nhieu, neu khong ho gui yeu cau roi moi biet
  // nhan it hon. KHONG nhac lai "ban dang no X" - debtNotice ngay phia tren form da noi.
  const withdrawTargetVnd = Math.max(input.thresholdVnd, input.debtRemaining);
  // No >= nguong thi cau goi y noi theo NO va KHONG kem "(toi thieu ...)" - yeu cau truc tiep cua
  // user: luc do nguong khong phai thu dang chan, nhac no chi gay roi.
  const debtIsBinding = input.debtRemaining > 0 && input.debtRemaining >= input.thresholdVnd;
  const transferAfterDebt = input.availableBalance - input.debtRemaining;
  const debtDeductionNote =
    input.debtRemaining <= 0
      ? ""
      : transferAfterDebt > 0
        ? `<p class="debt-note">Khi yêu cầu được duyệt, Admin sẽ trừ ${formatVnd(input.debtRemaining)} nợ và chuyển cho bạn <strong>${formatVnd(transferAfterDebt)}</strong>.</p>`
        : // Kha dung DUNG BANG no: tru vua het no, khong co dong nao de chuyen (tu dong xac nhan).
          `<p class="debt-note">Số dư khả dụng vừa bằng số nợ, nên gửi yêu cầu thì toàn bộ ${formatVnd(input.availableBalance)} sẽ được dùng để trả hết nợ — lần này bạn sẽ <strong>không nhận tiền chuyển khoản</strong>.</p>`;
  const withdrawConfirmText =
    input.debtRemaining <= 0
      ? `Xác nhận gửi yêu cầu rút toàn bộ ${formatVnd(input.availableBalance)}?`
      : transferAfterDebt > 0
        ? `Xác nhận gửi yêu cầu rút ${formatVnd(input.availableBalance)}? Admin sẽ trừ nợ ${formatVnd(input.debtRemaining)} và chuyển cho bạn ${formatVnd(transferAfterDebt)}.`
        : `Xác nhận dùng ${formatVnd(input.availableBalance)} để trả hết nợ? Lần này bạn sẽ không nhận tiền chuyển khoản.`;

  const pending = input.pendingWithdrawal;
  const pendingDebtLine =
    pending && pending.debtApplied > 0
      ? ` Admin sẽ trừ ${formatVnd(pending.debtApplied)} nợ hoàn trả và chuyển cho bạn <strong>${formatVnd(pending.amount)}</strong>.`
      : "";

  const withdrawBlock = input.pendingWithdrawal
    ? notice(`Yêu cầu rút ${formatVnd(input.pendingWithdrawal.amount + input.pendingWithdrawal.debtApplied)} đang chờ xử lý (gửi lúc ${formatDateTime(input.pendingWithdrawal.createdAt)}) tới tài khoản ${escapeHtml(input.pendingWithdrawal.bankAccountNumber)} - ${escapeHtml(input.pendingWithdrawal.bankAccountHolder)} (${escapeHtml(input.pendingWithdrawal.bankName)}).${pendingDebtLine} Thông tin này sẽ được Admin xác nhận lại qua tin nhắn riêng. Vui lòng chờ Admin liên hệ bạn.`, "i")
    : input.availableBalance >= withdrawTargetVnd
      ? `<form method="POST" action="/d/${input.token}/withdraw" class="withdraw-form" ${confirmOnSubmit(withdrawConfirmText)}>
  ${debtDeductionNote}
  <div class="form-field">
    <label for="bankName">Ngân hàng / Ví điện tử</label>
    <select id="bankName" name="bankName" required>
      <option value="" disabled selected>-- Chọn ngân hàng / ví điện tử --</option>
      ${bankOptions}
    </select>
  </div>
  <div class="form-field">
    <label for="bankAccountNumber">Số tài khoản / Số điện thoại</label>
    <input type="text" id="bankAccountNumber" name="bankAccountNumber" required autocomplete="off">
  </div>
  <div class="form-field">
    <label for="bankAccountHolder">Tên chủ tài khoản</label>
    <input type="text" id="bankAccountHolder" name="bankAccountHolder" required autocomplete="off">
  </div>
  <button type="submit">Yêu cầu rút ${formatVnd(input.availableBalance)}</button>
</form>`
      : // 2026-10-08 (bug that, user bao cao kem anh chup): Kha dung 0d + Cho xac nhan 48.114d,
        // nguong 20.000d -> trang hien "Tich luy them 0d nua". Gio chia dung tinh huong, va "con
        // thieu" tru CA BA tui tien user da co:
        //   - bi giam (Dang tam giu) -> cho toi ngay mo khoa, khong can mua them gi
        //   - cho xac nhan            -> cho Shopee duyet
        //   - chua du                 -> moi noi con thieu bao nhieu (luon > 0, co test chan "them 0d")
        // Moc so sanh la withdrawTargetVnd = max(nguong, no) (yeu cau truc tiep cua user 2026-10-08):
        // Kha dung < no thi chua rut duoc, so con thieu = no - Kha dung (tru them tien dang cho/giu).
        // KHONG cong no VAO nguong (ban truoc ra "Tich luy them 48.512d" = no + nguong - Kha dung,
        // user thay "nghe sai sai") - lay so LON hon, khong phai TONG.
        input.availableBalance + input.heldBalance >= withdrawTargetVnd && input.heldBalance > 0
        ? notice(
            // (2026-10-08, yeu cau truc tiep cua user) KHONG con cau "xem ngay mo khoa o dau" -
            // ngay mo khoa da hien san duoi badge cua TUNG don trong phan chi tiet ben duoi.
            `Bạn đang có ${formatVnd(input.heldBalance)} được giữ thêm vài ngày. Tới ngày đó là bạn rút được, không cần mua thêm gì.`,
            "i"
          )
        : input.availableBalance + pendingConfirmationTotal + input.heldBalance >= withdrawTargetVnd
        ? notice(
            `Bạn đang có ${formatVnd(pendingConfirmationTotal)} chờ Shopee xác nhận. Khi đơn được duyệt và chuyển sang "Khả dụng"${
              debtIsBinding ? "" : ` (tối thiểu ${formatVnd(input.thresholdVnd)})`
            } là bạn rút được ngay.`,
            "i"
          )
        : notice(
            `Tích luỹ thêm ${formatVnd(withdrawTargetVnd - input.availableBalance - pendingConfirmationTotal - input.heldBalance)} nữa để đủ điều kiện rút tiền${
              debtIsBinding ? "." : ` (tối thiểu ${formatVnd(input.thresholdVnd)}).`
            }`
          );

  const platformLabel = PLATFORM_LABELS[input.platform];
  const identityLine = input.displayName
    ? `👤 ${escapeHtml(input.displayName)} · ${platformLabel} · ID: ${escapeHtml(input.userId)}`
    : `👤 ${platformLabel} · ID: ${escapeHtml(input.userId)}`;

  // phan-hoi-cai-thien-trai-nghiem-nguoi-dung.md muc 5 (2026-08-20, SUA LAI cung ngay sau khi chot
  // lai voi user): canh bao chi con dung neu con dang "pending" - "confirmed"/"paid" gio la trang
  // thai CUOI CUNG, khong con bi huy nguoc duoc nua (don da "Hoan thanh" tren bao cao Shopee la so
  // lieu dung de thanh toan, chi don con "Dang cho xu ly" - tuong duong pending - moi con rui ro
  // bi huy sau doi soat). reverseCommissionEntry() cung da tu choi huy don khong con "pending".
  const hasPendingEntry = input.entries.some((e) => e.status === "pending");
  const reversalWarning = hasPendingEntry
    ? `<p class="warning-note">⚠️ Đơn đang "Chờ xác nhận" có thể bị huỷ nếu không đạt yêu cầu đối soát của sàn.</p>`
    : "";

  // Ca 2 dong CHI hien khi > 0: hien "0d" cho user chua bao gio bi giam/bi tru la tao lo lang ve mot
  // luat khong ap dung cho ho.
  const heldRow =
    input.heldBalance > 0
      ? `<div class="stat info"><div class="label">Đang tạm giữ</div><div class="value">${formatVnd(input.heldBalance)}</div></div>`
      : "";
  // No KHONG phai 1 the trong hang nay: hang nay la "tien ban co", con no la mot khoan SE BI TRU -
  // dat chung vao nhau thi user doc ra nhu mot loai so du nua (feedback that cua user 2026-10-08).
  // Cau chu lay NGUYEN VAN theo yeu cau cua user (2026-10-08) - Kha dung o tren KHONG tru no, nen
  // cau nay phai noi ro no se bi tru o dau (lan rut sau), khong phai "da tru roi".
  //
  // Phan no DA nam trong yeu cau rut dang cho duyet (debtApplied) thi khong nhac lai o day - thong
  // bao yeu cau rut da noi so do se bi tru, nhac 2 lan doc ra thanh bi tru 2 lan.
  const uncoveredDebt = Math.max(0, input.debtRemaining - (pending?.debtApplied ?? 0));
  const debtNotice =
    uncoveredDebt > 0
      ? notice(
          `${
            input.debts.length === 1
              ? `Đơn <code>${escapeHtml(input.debts[0].orderId)}</code> đã được trả hàng`
              : `${input.debts.length} đơn (${input.debts
                  .map((d) => `<code>${escapeHtml(d.orderId)}</code>`)
                  .join(", ")}) đã được trả hàng`
          } sau khi bạn đã nhận tiền, nên Shopee thu lại hoa hồng của ${
            input.debts.length === 1 ? "đơn đó" : "những đơn đó"
          }. Hiện bạn đang nợ <strong>${formatVnd(uncoveredDebt)}</strong>, số tiền này sẽ được Admin tự trừ khi bạn gửi yêu cầu Rút tiền lần sau.`,
          "↩"
        )
      : "";

  // Ngay sau khi 1 yeu cau rut duoc TU DONG xac nhan de tru no: Kha dung ve 0 ma khong co tien nao
  // vao tai khoan - khong noi ra thi user tuong tien bien mat.
  const settled = input.settledWithdrawal;
  const settledNotice = settled
    ? notice(
        // So no CON LAI khong nhac o day - debtNotice ngay ben duoi da noi, nhac 2 lan la thua.
        `Đã dùng ${formatVnd(settled.debtApplied)} số dư khả dụng để trừ nợ hoàn trả, lần này không có tiền chuyển khoản.${
          input.debtRemaining > 0 ? "" : " Bạn đã trả hết nợ."
        }`,
        "✓"
      )
    : "";

  const body = `<h1>💰 Hoa hồng của bạn</h1>
<p class="identity-line">${identityLine}</p>
${errorBlock}
${settledNotice}
<div class="totals">
  <div class="stat warning"><div class="label">Chờ xác nhận</div><div class="value">${formatVnd(pendingConfirmationTotal)}</div></div>
  ${heldRow}
  <div class="stat accent"><div class="label">Khả dụng</div><div class="value">${formatVnd(input.availableBalance)}</div></div>
  <div class="stat info"><div class="label">Đang chờ rút</div><div class="value">${formatVnd(input.pendingBalance)}</div></div>
  <div class="stat success"><div class="label">Đã nhận</div><div class="value">${formatVnd(input.paidTotal)}</div></div>
</div>
${debtNotice}
${reversalWarning}
${withdrawBlock}
${table}`;

  return pageShell("Hoa hồng của bạn", body);
}
