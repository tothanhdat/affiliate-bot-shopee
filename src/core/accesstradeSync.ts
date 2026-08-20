import { AppError, DuplicateConversionError } from "./errors.js";
import type { LedgerStore } from "./ledgerStore.js";
import type { LogStore } from "./logStore.js";
import { summarizeOrderResultsByUser, type OrderRowResult, type RecordOrderConfig, type UserOrderSummary } from "./orderIngest.js";

/**
 * T2.1 tu dong hoa (2026-08-20, rui-ro-can-giai-quyet.md muc 8, da live-verify API that voi
 * key that cua du an): dinh ky goi GET /v1/transactions cua Accesstrade thay cho quy trinh CSV/CLI
 * thu cong hang tuan. CHI ap dung cho merchant di qua Accesstrade (TikTok Shop/Lazada) - Shopee di
 * thang qua co che an_redir (ShopeeAffiliateProvider), KHONG BAO GIO xuat hien o day, van can doi
 * soat thu cong rieng (khong co API nao khac cho Shopee, da xac nhan khong cap Open API).
 *
 * Mapping trang thai (chot voi user 2026-08-20, giu nguyen 4 trang thai CommissionStatus hien co,
 * KHONG them trang thai moi):
 *   status=1 (approved) VA is_confirmed=1 (da chot so lieu)  -> "confirmed" (ghi/chuyen tu pending)
 *   status=2 (rejected)                                       -> "reversed" (huy entry da co, ke
 *     ca dang "pending" - don chua duoc duyet ma bi tu choi thi cung khong con gi de theo doi nua)
 *   status=0 (hold) HOAC is_confirmed=0 (chua chot)           -> "pending" (2026-08-20, doi theo
 *     yeu cau user sau khi thay Accesstrade hien "2 don cho xu ly" ma he thong lai khong hien gi -
 *     TRUOC DAY bo qua hoan toan, gio ghi nhan de user thay don dang duoc xu ly). Entry "pending"
 *     KHONG tinh vao so du kha dung/rut duoc (getAvailableBalance chi cong status='confirmed'),
 *     KHONG gui DM thong bao (chi gui khi that su "confirmed", xem confirmedByUser).
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
  pendingNew: number;
  reversedCount: number;
  /** Giao dich khong tach duoc subId tu ca utm_content lan _extra.sub_params.sub1. */
  skippedNoSubId: number;
  /** subId tach duoc nhung khong khop request nao trong requests.db (findBySubId tra null). */
  skippedSubIdNotFound: number;
  errors: string[];
  /** Dung de gui thong bao gop cho user (giong record-conversions-csv, xem formatOrdersConfirmedReply). CHI cho don MOI "confirmed" - khong bao gom pending. */
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
    pendingNew: 0,
    reversedCount: 0,
    skippedNoSubId: 0,
    skippedSubIdNotFound: 0,
    errors: [],
    confirmedByUser: [],
  };

  const confirmedRows: OrderRowResult[] = [];
  const { recordOrderConfig } = config;

  for (const tx of transactions) {
    const isConfirmedApproved = tx.status === 1 && tx.is_confirmed === 1;
    const isRejected = tx.status === 2;
    const isPending = !isConfirmedApproved && !isRejected; // status=0, hoac status=1 & is_confirmed=0

    const subId = extractSubId(tx);
    if (!subId) {
      result.skippedNoSubId += 1;
      continue;
    }

    const requestEntry = logStore.findBySubId(subId);
    if (!requestEntry || !requestEntry.merchant) {
      result.skippedSubIdNotFound += 1;
      continue;
    }

    const existing = ledgerStore.getEntryByOrderId(requestEntry.merchant, tx.transaction_id);

    if (isConfirmedApproved) {
      if (existing?.status === "confirmed") {
        result.confirmedDuplicate += 1;
        continue;
      }
      if (existing?.status === "reversed" || existing?.status === "paid") {
        // Accesstrade "lat keo": tra ve confirmed sau khi truoc do da reversed/paid o phia bot -
        // khong tu dong ghi de (UNIQUE constraint cung se chan INSERT moi), can admin tu xem lai.
        result.errors.push(
          `[confirm ${tx.transaction_id}] Accesstrade bao da duyet nhung entry noi bo dang o trang thai "${existing.status}" - can admin kiem tra tay, khong tu dong ghi de.`
        );
        continue;
      }

      try {
        let entry;
        if (existing?.status === "pending") {
          entry = ledgerStore.confirmPendingEntry(existing.id, {
            orderAmount: tx.transaction_value,
            commissionAmount: tx.commission,
            productName: tx.product_name,
            taxPercent: recordOrderConfig.taxPercent,
            platformFeePercent: recordOrderConfig.platformFeePercent,
            userSharePercent: recordOrderConfig.userSharePercent,
            maxCommissionRatioPercent: recordOrderConfig.maxCommissionRatioPercent,
          });
        } else {
          entry = ledgerStore.recordConversion({
            subId,
            platform: requestEntry.platform,
            userId: requestEntry.userId,
            merchant: requestEntry.merchant,
            orderId: tx.transaction_id,
            productName: tx.product_name,
            orderAmount: tx.transaction_value,
            commissionAmount: tx.commission,
            taxPercent: recordOrderConfig.taxPercent,
            platformFeePercent: recordOrderConfig.platformFeePercent,
            userSharePercent: recordOrderConfig.userSharePercent,
            maxCommissionRatioPercent: recordOrderConfig.maxCommissionRatioPercent,
            note: "Tu dong dong bo tu Accesstrade (/v1/transactions)",
          });
        }
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
        } else {
          const msg = err instanceof AppError ? err.userMessage : (err as Error).message;
          result.errors.push(`[confirm ${tx.transaction_id}] ${msg}`);
        }
      }
      continue;
    }

    if (isRejected) {
      // CHI reverse duoc entry dang "pending" (2026-08-20, quyet dinh chot lai voi user - khop FAQ
      // chinh thuc Accesstrade: "hoa hong tam duyet" - tuong duong pending ben minh - co the bi
      // huy sau doi soat, nhung "hoa hong duoc duyet" - tuong duong confirmed, is_confirmed=1 - la
      // so lieu CUOI CUNG dung de thanh toan, khong con thay doi nua).
      if (!existing) continue; // chua tung ghi nhan - khong co gi de xu ly, im lang la dung.

      if (existing.status !== "pending") {
        // 2026-08-20 (tu ra soat lai, phat hien comment cu o day claim sai): TRUOC DAY code chi
        // "continue" im lang cho moi truong hop khong phai pending, ke ca khi entry da "confirmed"
        // hoac "paid" - tuc la neu Accesstrade THAT SU dao nguoc 1 don da chot (rui ro da duoc user
        // chap nhan CO Y THUC, nhung van can biet KHI NAO no that su xay ra), admin se KHONG BAO GIO
        // duoc bao - khong log, khong loi, khong gi ca. Gio ghi ro vao result.errors cho 2 truong hop
        // dang chu y (confirmed/paid) de admin it nhat con thay duoc trong ket qua chay/thong bao,
        // du he thong KHONG tu dong huy nua (dung quyet dinh da chot).
        if (existing.status === "confirmed" || existing.status === "paid") {
          result.errors.push(
            `[reverse ${tx.transaction_id}] Accesstrade báo rejected nhưng entry nội bộ đang "${existing.status}" - KHÔNG tự huỷ (đơn đã ${existing.status === "paid" ? "trả cho user rồi" : "\"Khả dụng\", coi là final"}), cần admin tự kiểm tra tay (dùng reverse-entry CLI nếu thật sự cần huỷ).`
          );
        }
        continue;
      }

      try {
        ledgerStore.reverseCommissionEntry(existing.id, "Accesstrade tra ve status=rejected qua dong bo tu dong");
        result.reversedCount += 1;
      } catch (err) {
        const msg = err instanceof AppError ? err.userMessage : (err as Error).message;
        result.errors.push(`[reverse ${tx.transaction_id}] ${msg}`);
      }
      continue;
    }

    // isPending: chi tao moi neu CHUA co entry nao (moi trang thai khac deu da "vuot qua" pending
    // roi, khong lui lai - vd don da confirmed truoc do ma lan quet nay Accesstrade tra ve du lieu
    // hold cu do phan trang/cache thi cung khong duoc ghi de nguoc ve pending).
    if (existing) continue;
    try {
      ledgerStore.recordConversion({
        subId,
        platform: requestEntry.platform,
        userId: requestEntry.userId,
        merchant: requestEntry.merchant,
        orderId: tx.transaction_id,
        productName: tx.product_name,
        orderAmount: tx.transaction_value,
        commissionAmount: tx.commission,
        taxPercent: recordOrderConfig.taxPercent,
        platformFeePercent: recordOrderConfig.platformFeePercent,
        userSharePercent: recordOrderConfig.userSharePercent,
        maxCommissionRatioPercent: recordOrderConfig.maxCommissionRatioPercent,
        status: "pending",
        note: "Tu dong dong bo tu Accesstrade - dang cho Accesstrade duyet",
      });
      result.pendingNew += 1;
    } catch (err) {
      if (!(err instanceof DuplicateConversionError)) {
        // DuplicateConversionError o day la race hiem (2 lan chay chong nhau) - bo qua im lang.
        const msg = err instanceof AppError ? err.userMessage : (err as Error).message;
        result.errors.push(`[pending ${tx.transaction_id}] ${msg}`);
      }
    }
  }

  result.confirmedByUser = summarizeOrderResultsByUser(confirmedRows);
  return result;
}
