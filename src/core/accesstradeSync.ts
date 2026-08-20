import { AppError, DuplicateConversionError, SubIdNotFoundError } from "./errors.js";
import type { LedgerStore } from "./ledgerStore.js";
import type { LogStore } from "./logStore.js";
import {
  recordOrderFromAccesstrade,
  summarizeOrderResultsByUser,
  type OrderRowResult,
  type RecordOrderConfig,
  type UserOrderSummary,
} from "./orderIngest.js";

/**
 * T2.1 tu dong hoa (2026-08-20, rui-ro-can-giai-quyet.md muc 8, da live-verify API that voi
 * key that cua du an): dinh ky goi GET /v1/transactions cua Accesstrade thay cho quy trinh CSV/CLI
 * thu cong hang tuan. CHI ap dung cho merchant di qua Accesstrade (TikTok Shop/Lazada) - Shopee di
 * thang qua co che an_redir (ShopeeAffiliateProvider), KHONG BAO GIO xuat hien o day, van can doi
 * soat thu cong rieng (khong co API nao khac cho Shopee, da xac nhan khong cap Open API).
 *
 * Mapping trang thai (chot voi user 2026-08-20, giu nguyen 4 trang thai CommissionStatus hien co,
 * KHONG them trang thai moi):
 *   Accesstrade status=1 (approved) VA is_confirmed=1 (da chot so lieu)  -> "confirmed" (ghi entry)
 *   Accesstrade status=2 (rejected)                                      -> "reversed" (huy entry da co)
 *   Accesstrade status=0 (hold) HOAC is_confirmed=0 (chua chot)          -> BO QUA, khong sync
 *   "paid" khong bao gio sync tu Accesstrade - chi admin tu danh dau qua /admin/withdrawals.
 */
export interface AccesstradeSyncConfig {
  apiKey: string;
  apiBase: string;
  timeoutMs: number;
  /** So ngay nhin lai tinh tu luc chay - du dai de bat don duyet tre, khong chi "hom qua". */
  lookbackDays: number;
  recordOrderConfig: RecordOrderConfig;
}

export interface AccesstradeSyncResult {
  windowSince: string;
  windowUntil: string;
  transactionsScanned: number;
  confirmedNew: number;
  confirmedDuplicate: number;
  reversedCount: number;
  /** Giao dich khong tach duoc subId tu ca utm_content lan _extra.sub_params.sub1. */
  skippedNoSubId: number;
  /** subId tach duoc nhung khong khop request nao trong requests.db (findBySubId tra null). */
  skippedSubIdNotFound: number;
  errors: string[];
  /** Dung de gui thong bao gop cho user (giong record-conversions-csv, xem formatOrdersConfirmedReply). */
  confirmedByUser: UserOrderSummary[];
}

interface AccesstradeTransactionRaw {
  status: number;
  is_confirmed: number;
  transaction_id: string;
  transaction_value: number;
  commission: number;
  product_name?: string;
  utm_content?: string;
  _extra?: { sub_params?: { sub1?: string } };
}

/**
 * Da live-verify (2026-08-20): giao dich TikTok Shop luon co utm_content RONG, subId that nam o
 * _extra.sub_params.sub1 (khop dung field "sub1" ma AccesstradeProvider.createAffiliateLink gui
 * luc tao link cho TikTok Shop). Uu tien utm_content (Shopee/Lazada kieu Custom Link cu), fallback
 * sub1 - khong can bang map ten merchant rieng, tu suy ra field dung theo du lieu thuc te co.
 */
function extractSubId(tx: AccesstradeTransactionRaw): string | null {
  const utmContent = tx.utm_content?.trim();
  if (utmContent) return utmContent;
  const sub1 = tx._extra?.sub_params?.sub1?.trim();
  if (sub1) return sub1;
  return null;
}

async function fetchAllTransactions(
  config: AccesstradeSyncConfig,
  since: string,
  until: string
): Promise<AccesstradeTransactionRaw[]> {
  const results: AccesstradeTransactionRaw[] = [];
  const limit = 100;
  let offset = 0;

  // Rate limit that (10 req/phut) khong dang lo voi 1 lan chay/ngay - vong lap nay chi lap khi
  // that su co >100 giao dich trong 1 cua so (hiem voi quy mo hien tai cua du an).
  for (;;) {
    const endpoint = new URL("/v1/transactions", config.apiBase);
    endpoint.searchParams.set("since", since);
    endpoint.searchParams.set("until", until);
    endpoint.searchParams.set("limit", String(limit));
    endpoint.searchParams.set("offset", String(offset));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        headers: { Authorization: `Token ${config.apiKey}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(`Accesstrade /v1/transactions HTTP ${response.status}: ${bodyText.slice(0, 300)}`);
    }

    const json = (await response.json()) as { total?: number; data?: AccesstradeTransactionRaw[] };
    const batch = json.data ?? [];
    results.push(...batch);
    offset += batch.length;

    if (batch.length < limit || batch.length === 0) break;
    if (typeof json.total === "number" && offset >= json.total) break;
  }

  return results;
}

export async function syncAccesstradeTransactions(
  logStore: LogStore,
  ledgerStore: LedgerStore,
  config: AccesstradeSyncConfig
): Promise<AccesstradeSyncResult> {
  const untilDate = new Date();
  const sinceDate = new Date(untilDate.getTime() - config.lookbackDays * 24 * 60 * 60 * 1000);
  const since = sinceDate.toISOString();
  const until = untilDate.toISOString();

  const transactions = await fetchAllTransactions(config, since, until);

  const result: AccesstradeSyncResult = {
    windowSince: since,
    windowUntil: until,
    transactionsScanned: transactions.length,
    confirmedNew: 0,
    confirmedDuplicate: 0,
    reversedCount: 0,
    skippedNoSubId: 0,
    skippedSubIdNotFound: 0,
    errors: [],
    confirmedByUser: [],
  };

  const confirmedRows: OrderRowResult[] = [];

  for (const tx of transactions) {
    const isConfirmedApproved = tx.status === 1 && tx.is_confirmed === 1;
    const isRejected = tx.status === 2;
    if (!isConfirmedApproved && !isRejected) continue; // status=0 (hold) hoac is_confirmed=0 - bo qua

    const subId = extractSubId(tx);
    if (!subId) {
      result.skippedNoSubId += 1;
      continue;
    }

    if (isConfirmedApproved) {
      try {
        const entry = recordOrderFromAccesstrade(logStore, ledgerStore, config.recordOrderConfig, {
          subId,
          orderId: tx.transaction_id,
          productName: tx.product_name,
          orderAmount: tx.transaction_value,
          commissionAmount: tx.commission,
          note: "Tu dong dong bo tu Accesstrade (/v1/transactions)",
        });
        result.confirmedNew += 1;
        confirmedRows.push({
          line: 0,
          subId,
          orderId: tx.transaction_id,
          ok: true,
          detail: "auto-sync",
          platform: entry.platform,
          userId: entry.userId,
          userShareAmount: entry.userShareAmount,
          productName: entry.productName,
        });
      } catch (err) {
        if (err instanceof DuplicateConversionError) {
          result.confirmedDuplicate += 1;
        } else if (err instanceof SubIdNotFoundError) {
          result.skippedSubIdNotFound += 1;
        } else {
          const msg = err instanceof AppError ? err.userMessage : (err as Error).message;
          result.errors.push(`[confirm ${tx.transaction_id}] ${msg}`);
        }
      }
      continue;
    }

    // isRejected: chi reverse neu TRUOC DO da ghi "confirmed" - khong lam gi neu chua tung ghi
    // (khong co gi de huy) hoac da o trang thai khac (da reversed/dang giu boi 1 withdrawal).
    const requestEntry = logStore.findBySubId(subId);
    if (!requestEntry || !requestEntry.merchant) {
      result.skippedSubIdNotFound += 1;
      continue;
    }
    const existing = ledgerStore.getEntryByOrderId(requestEntry.merchant, tx.transaction_id);
    if (!existing || existing.status !== "confirmed") continue;

    try {
      ledgerStore.reverseCommissionEntry(existing.id, "Accesstrade tra ve status=rejected qua dong bo tu dong");
      result.reversedCount += 1;
    } catch (err) {
      const msg = err instanceof AppError ? err.userMessage : (err as Error).message;
      result.errors.push(`[reverse ${tx.transaction_id}] ${msg}`);
    }
  }

  result.confirmedByUser = summarizeOrderResultsByUser(confirmedRows);
  return result;
}
