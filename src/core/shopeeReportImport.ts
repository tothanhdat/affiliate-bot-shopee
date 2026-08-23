import { parseCsv } from "./csv.js";
import { AppError, DuplicateConversionError } from "./errors.js";
import type { LedgerStore } from "./ledgerStore.js";
import type { LogStore } from "./logStore.js";
import { summarizeOrderResultsByUser, type OrderRowResult, type RecordOrderConfig, type UserOrderSummary } from "./orderIngest.js";
import type { StatusTransition } from "./types.js";

/**
 * Import file bao cao GOC cua Shopee Affiliate (vd "AffiliateCommissionReport_*.csv" xuat tu
 * affiliate.shopee.vn/report/conversion_report) - khac han record-conversions-csv (doi format don
 * gian subId/orderId/orderAmount/commissionAmount da chuan hoa san). File nay giu NGUYEN ten cot
 * tieng Viet goc cua Shopee, khong yeu cau admin tu bien doi/doi ten cot truoc khi upload.
 *
 * Quyet dinh mapping trang thai (chot voi user 2026-08-22, dung cot "Trang thai san pham lien ket"
 * theo dung yeu cau - KHONG dung "Trang thai dat hang" cap don, vi 2 cot nay co the khac nhau khi
 * don co nhieu san pham voi trang thai khac nhau):
 *   "Hoan thanh"        -> confirmed (Kha dung)
 *   "Dang cho xu ly"    -> pending (Cho xac nhan)
 *   "Khong hop le"      -> reversed (Huy - CHI ap dung neu entry dang la "pending", giong dung rule
 *                          hien tai cua accesstradeSync.ts/admin web, khong tu huy don da "confirmed")
 *   gia tri khac 3 gia tri tren -> SKIP + canh bao (khong doan mo, chua xac minh Shopee co dung
 *   the them trang thai nao khac hay khong)
 *
 * GIOI HAN CO CHU DICH (backlog, cho user tu test them - 2026-08-22): file la bao cao THEO DONG/SAN
 * PHAM, 1 don nhieu san pham se co nhieu dong cung "ID don hang". Chua xac minh duoc cot "Gia tri
 * don hang (d)"/"Tong hoa hong san pham(d)" la gia tri RIENG tung san pham (cong don dung) hay gia
 * tri CA DON lap lai moi dong (cong don se sai/nhan doi) - file mau hien co CHI co don 1 san pham.
 * Vi vay: don nhieu dong (nhieu san pham) SE BI SKIP kem canh bao ro rang de admin tu xu ly tay,
 * KHONG tu doan cach cong don. Khi user test xong case nay se cap nhat lai.
 */
export interface ShopeeReportImportConfig {
  recordOrderConfig: RecordOrderConfig;
}

export interface ShopeeReportImportResult {
  ordersScanned: number;
  confirmedNew: number;
  confirmedDuplicate: number;
  pendingNew: number;
  /** Entry "pending" da co san duoc cap nhat lai so lieu (khong doi status) - xem updatePendingEntry. */
  pendingUpdated: number;
  reversedCount: number;
  /** Don nhieu dong (nhieu san pham) - chua ho tro, xem comment dau file. */
  skippedMultiItem: number;
  /** Khong tach duoc subId tu Sub_id1..Sub_id5 (tat ca deu rong). */
  skippedNoSubId: number;
  /** subId tach duoc nhung khong khop request nao trong requests.db. */
  skippedSubIdNotFound: number;
  /** Gia tri cot "Trang thai san pham lien ket" khong khop 1 trong 3 gia tri da biet. */
  skippedUnknownStatus: number;
  errors: string[];
  /** Dung de gui thong bao gop cho user (giong accesstradeSync.ts). CHI cho don MOI "confirmed". */
  confirmedByUser: UserOrderSummary[];
  /** Ma don duoc ghi MOI trong lan nay (confirmed hoac pending) - dung cho lich su hien tren /admin/record-orders. */
  newOrderIds: string[];
  /** Don doi trang thai THAT SU (vd pending->confirmed) - KHONG gom pendingUpdated (van la "pending", chi refresh so lieu). */
  statusTransitions: StatusTransition[];
}

const STATUS_COMPLETED = "Hoàn thành";
const STATUS_PENDING = "Đang chờ xử lý";
const STATUS_INVALID = "Không hợp lệ";

interface ShopeeReportRow {
  orderId: string;
  productName: string;
  orderAmount: number;
  commissionAmount: number;
  linkedProductStatus: string;
  subId: string | null;
}

function parseShopeeReportRows(csvText: string): ShopeeReportRow[] {
  const rows = parseCsv(csvText);
  return rows.map((row) => {
    const subIdParts = [row.Sub_id1, row.Sub_id2, row.Sub_id3, row.Sub_id4, row.Sub_id5]
      .map((p) => p?.trim())
      .filter((p): p is string => !!p);

    return {
      orderId: row["ID đơn hàng"]?.trim() ?? "",
      productName: row["Tên Item"]?.trim() ?? "",
      orderAmount: Number(row["Giá trị đơn hàng (₫)"]),
      commissionAmount: Number(row["Tổng hoa hồng sản phẩm(₫)"]),
      linkedProductStatus: row["Trạng thái sản phẩm liên kết"]?.trim() ?? "",
      subId: subIdParts.length > 0 ? subIdParts.join("-") : null,
    };
  });
}

function groupRowsByOrderId(rows: ShopeeReportRow[]): Map<string, ShopeeReportRow[]> {
  const map = new Map<string, ShopeeReportRow[]>();
  for (const row of rows) {
    const existing = map.get(row.orderId);
    if (existing) {
      existing.push(row);
    } else {
      map.set(row.orderId, [row]);
    }
  }
  return map;
}

export function importShopeeReport(
  logStore: LogStore,
  ledgerStore: LedgerStore,
  config: ShopeeReportImportConfig,
  csvText: string
): ShopeeReportImportResult {
  const rows = parseShopeeReportRows(csvText);
  const grouped = groupRowsByOrderId(rows);

  const result: ShopeeReportImportResult = {
    ordersScanned: grouped.size,
    confirmedNew: 0,
    confirmedDuplicate: 0,
    pendingNew: 0,
    pendingUpdated: 0,
    reversedCount: 0,
    skippedMultiItem: 0,
    skippedNoSubId: 0,
    skippedSubIdNotFound: 0,
    skippedUnknownStatus: 0,
    errors: [],
    confirmedByUser: [],
    newOrderIds: [],
    statusTransitions: [],
  };

  const confirmedRows: OrderRowResult[] = [];
  const { recordOrderConfig } = config;

  for (const [orderId, group] of grouped) {
    if (group.length > 1) {
      result.skippedMultiItem += 1;
      result.errors.push(
        `[${orderId}] Don co ${group.length} san pham - chua ho tro tu dong gop don nhieu san pham (xem comment dau shopeeReportImport.ts), can admin ghi tay qua ledgerAdmin.ts record-conversion.`
      );
      continue;
    }

    const row = group[0];

    let targetStatus: "confirmed" | "pending" | "reversed";
    if (row.linkedProductStatus === STATUS_COMPLETED) {
      targetStatus = "confirmed";
    } else if (row.linkedProductStatus === STATUS_PENDING) {
      targetStatus = "pending";
    } else if (row.linkedProductStatus === STATUS_INVALID) {
      targetStatus = "reversed";
    } else {
      result.skippedUnknownStatus += 1;
      result.errors.push(
        `[${orderId}] Gia tri cot "Trang thai san pham lien ket" la "${row.linkedProductStatus}" - khong khop "${STATUS_COMPLETED}"/"${STATUS_PENDING}"/"${STATUS_INVALID}" da biet, bo qua de tranh doan sai.`
      );
      continue;
    }

    if (!row.subId) {
      result.skippedNoSubId += 1;
      continue;
    }

    const requestEntry = logStore.findBySubId(row.subId);
    if (!requestEntry || !requestEntry.merchant) {
      result.skippedSubIdNotFound += 1;
      continue;
    }

    const existing = ledgerStore.getEntryByOrderId(requestEntry.merchant, orderId);

    if (targetStatus === "confirmed") {
      if (existing?.status === "confirmed") {
        result.confirmedDuplicate += 1;
        continue;
      }
      if (existing?.status === "reversed" || existing?.status === "paid") {
        result.errors.push(
          `[${orderId}] Bao cao Shopee ghi "Hoan thanh" nhung entry noi bo dang o trang thai "${existing.status}" - can admin kiem tra tay, khong tu dong ghi de.`
        );
        continue;
      }

      try {
        let entry;
        if (existing?.status === "pending") {
          entry = ledgerStore.confirmPendingEntry(existing.id, {
            orderAmount: row.orderAmount,
            commissionAmount: row.commissionAmount,
            productName: row.productName || undefined,
            taxPercent: recordOrderConfig.taxPercent,
            platformFeePercent: recordOrderConfig.platformFeePercent,
            userSharePercent: recordOrderConfig.userSharePercent,
            maxCommissionRatioPercent: recordOrderConfig.maxCommissionRatioPercent,
          });
          result.statusTransitions.push({ orderId, from: "pending", to: "confirmed" });
        } else {
          entry = ledgerStore.recordConversion({
            subId: row.subId,
            platform: requestEntry.platform,
            userId: requestEntry.userId,
            merchant: requestEntry.merchant,
            orderId,
            productName: row.productName || undefined,
            orderAmount: row.orderAmount,
            commissionAmount: row.commissionAmount,
            taxPercent: recordOrderConfig.taxPercent,
            platformFeePercent: recordOrderConfig.platformFeePercent,
            userSharePercent: recordOrderConfig.userSharePercent,
            maxCommissionRatioPercent: recordOrderConfig.maxCommissionRatioPercent,
            note: "Nhap tu bao cao Shopee (file CSV admin upload)",
          });
          result.newOrderIds.push(orderId);
        }
        result.confirmedNew += 1;
        confirmedRows.push({
          line: 0,
          subId: row.subId,
          orderId,
          ok: true,
          detail: "shopee-report-import",
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
          result.errors.push(`[${orderId}] ${msg}`);
        }
      }
      continue;
    }

    if (targetStatus === "reversed") {
      if (!existing) continue; // chua tung ghi nhan - khong co gi de xu ly.
      if (existing.status !== "pending") {
        if (existing.status === "confirmed" || existing.status === "paid") {
          result.errors.push(
            `[${orderId}] Bao cao Shopee ghi "Khong hop le" nhung entry noi bo dang "${existing.status}" - KHONG tu huy (coi la final), can admin tu kiem tra (dung reverse-entry CLI neu that su can huy).`
          );
        }
        continue;
      }
      try {
        ledgerStore.reverseCommissionEntry(existing.id, "Bao cao Shopee ghi trang thai san pham lien ket = Khong hop le");
        result.reversedCount += 1;
        result.statusTransitions.push({ orderId, from: "pending", to: "reversed" });
      } catch (err) {
        const msg = err instanceof AppError ? err.userMessage : (err as Error).message;
        result.errors.push(`[${orderId}] ${msg}`);
      }
      continue;
    }

    // targetStatus === "pending"
    if (existing) {
      if (existing.status === "pending") {
        try {
          ledgerStore.updatePendingEntry(existing.id, {
            orderAmount: row.orderAmount,
            commissionAmount: row.commissionAmount,
            productName: row.productName || undefined,
            taxPercent: recordOrderConfig.taxPercent,
            platformFeePercent: recordOrderConfig.platformFeePercent,
            userSharePercent: recordOrderConfig.userSharePercent,
            maxCommissionRatioPercent: recordOrderConfig.maxCommissionRatioPercent,
          });
          result.pendingUpdated += 1;
        } catch (err) {
          const msg = err instanceof AppError ? err.userMessage : (err as Error).message;
          result.errors.push(`[${orderId}] ${msg}`);
        }
      }
      continue;
    }
    try {
      ledgerStore.recordConversion({
        subId: row.subId,
        platform: requestEntry.platform,
        userId: requestEntry.userId,
        merchant: requestEntry.merchant,
        orderId,
        productName: row.productName || undefined,
        orderAmount: row.orderAmount,
        commissionAmount: row.commissionAmount,
        taxPercent: recordOrderConfig.taxPercent,
        platformFeePercent: recordOrderConfig.platformFeePercent,
        userSharePercent: recordOrderConfig.userSharePercent,
        maxCommissionRatioPercent: recordOrderConfig.maxCommissionRatioPercent,
        status: "pending",
        note: "Nhap tu bao cao Shopee - dang cho xu ly",
      });
      result.pendingNew += 1;
      result.newOrderIds.push(orderId);
    } catch (err) {
      if (!(err instanceof DuplicateConversionError)) {
        const msg = err instanceof AppError ? err.userMessage : (err as Error).message;
        result.errors.push(`[${orderId}] ${msg}`);
      }
    }
  }

  result.confirmedByUser = summarizeOrderResultsByUser(confirmedRows);
  return result;
}
