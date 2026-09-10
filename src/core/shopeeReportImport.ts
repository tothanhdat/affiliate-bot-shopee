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
 * DON NHIEU SAN PHAM (2026-09-10, truoc do bi SKIP): file la bao cao THEO DONG/SAN PHAM, 1 don nhieu
 * san pham se co nhieu dong cung "ID don hang". Da xac minh tren bao cao that (don 260909K72F4DAY,
 * 3 dong: 1 san pham chinh 306.540d/22.990,5d + 2 dong qua tang 0d): cot "Gia tri don hang (d)" va
 * "Tong hoa hong san pham(d)" la gia tri RIENG TUNG DONG, cong don lai dung bang cot cap don
 * "Tong hoa hong don hang(d)" (cot nay Shopee chi dien o DONG DAU cua nhom, khong lap lai moi dong -
 * nen KHONG doc truc tiep cot do, cong don tung dong moi dung). Vi vay cac dong cung 1 ma don gio
 * duoc GOP thanh 1 entry qua mergeOrderRows() - xem quy tac gop ngay tren ham do.
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
  /** So don duoc GOP tu >=2 dong (don nhieu san pham) - xem mergeOrderRows(). */
  mergedMultiItem: number;
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
/**
 * User tu huy don -> Shopee ghi "Đã hủy" (KHAC "Không hợp lệ" - do la don bi Shopee tu choi vi vi
 * pham chinh sach). Ca 2 deu dan toi cung ket qua noi bo: khong duoc tinh hoa hong (reversed).
 * Tieng Viet co 2 cach dat dau cho tu nay (hủy / huỷ) va Shopee khong cam ket giu nguyen cach viet,
 * nen chap nhan ca 2 - xem normalizeStatus().
 */
const STATUS_CANCELLED = ["Đã hủy", "Đã huỷ"];
/**
 * Don COD - user da dat nhung chua tra tien (2026-09-10, phat hien khi quet 14 bao cao that: don
 * 260908GH4GRXP4 di "Chua thanh toan" o bao cao 09/09 -> "Da huy" o bao cao 10/09). Ve ban chat
 * giong "Dang cho xu ly": don co that, chua chac chan, chua duoc tinh vao so du kha dung cua user.
 */
const STATUS_UNPAID = "Chưa thanh toán";

/** Chi dung de in canh bao khi gap gia tri la - giu dong bo voi classifyRowStatus(). */
const KNOWN_STATUS_LABELS = [STATUS_COMPLETED, STATUS_PENDING, STATUS_UNPAID, STATUS_INVALID, ...STATUS_CANCELLED];

type RowStatus = "confirmed" | "pending" | "reversed" | "unknown";

/** So khop ten trang thai khong phu thuoc cach encode dau tieng Viet trong file (NFC vs NFD). */
function normalizeStatus(raw: string): string {
  return raw.normalize("NFC");
}

function classifyRowStatus(raw: string): RowStatus {
  const value = normalizeStatus(raw);
  if (value === normalizeStatus(STATUS_COMPLETED)) return "confirmed";
  if (value === normalizeStatus(STATUS_PENDING)) return "pending";
  if (value === normalizeStatus(STATUS_UNPAID)) return "pending";
  if (value === normalizeStatus(STATUS_INVALID)) return "reversed";
  if (STATUS_CANCELLED.some((s) => value === normalizeStatus(s))) return "reversed";
  return "unknown";
}

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

interface MergedOrder {
  orderId: string;
  subId: string | null;
  productName: string;
  orderAmount: number;
  commissionAmount: number;
  status: "confirmed" | "pending" | "reversed";
  /** Gia tri GOC cot "Trang thai san pham lien ket" dai dien cho don - chi dung cho canh bao/ly do. */
  rawStatusLabel: string;
  warnings: string[];
}

type MergeOutcome = { kind: "unknown-status"; rawStatus: string } | { kind: "ok"; order: MergedOrder };

/**
 * Gop N dong cung 1 "ID don hang" thanh 1 don (cung y tuong voi groupTransactionsByOrderId cua
 * accesstradeSync.ts). Quy tac chot voi user 2026-09-10:
 *  - Bat ky dong nao co trang thai LA -> bo qua CA DON (khong ghi mot phan, khong doan mo).
 *  - subId cua don = subId khac rong DAU TIEN. Dong nao co subId rong/khac bi LOAI khoi tong kem
 *    canh bao - giu dung quyet dinh 2026-08-23: hoa hong cua dong khong di qua link nao cua bot
 *    khong duoc gan cho user nao.
 *  - TAT CA dong deu huy -> ca don "reversed".
 *  - Nguoc lai: loai cac dong huy ra khoi tong (tra hang 1 phan), cong don "Gia tri don hang (d)" +
 *    "Tong hoa hong san pham(d)" cac dong con lai. Con dong "Dang cho xu ly" -> ca don pending;
 *    tat ca "Hoan thanh" -> confirmed (nguyen tac "chua chac chan het thi van pending").
 *  - Ten san pham = ten dong hoa hong CAO NHAT, them hau to "(+N san pham khac)" neu con nhieu dong.
 */
function mergeOrderRows(orderId: string, rows: ShopeeReportRow[]): MergeOutcome {
  const classified = rows.map((row) => ({ row, status: classifyRowStatus(row.linkedProductStatus) }));

  const unknown = classified.find((c) => c.status === "unknown");
  if (unknown) return { kind: "unknown-status", rawStatus: unknown.row.linkedProductStatus };

  const warnings: string[] = [];
  const subId = rows.find((r) => r.subId)?.subId ?? null;
  const counted = classified.filter((c) => c.row.subId === subId);
  const excludedCount = classified.length - counted.length;
  if (excludedCount > 0) {
    warnings.push(
      `[${orderId}] ${excludedCount}/${classified.length} dong co Sub_id rong hoac khac Sub_id cua don ("${subId}") - da loai khoi tong, khong gan hoa hong cua dong do cho user nao.`
    );
  }

  const active = counted.filter((c) => c.status !== "reversed");
  const status: MergedOrder["status"] =
    active.length === 0 ? "reversed" : active.some((c) => c.status === "pending") ? "pending" : "confirmed";

  // Dong bi huy khong duoc cong vao tong (tra hang 1 phan). Don huy toan bo thi khong ghi so lieu nao.
  const summed = active.length > 0 ? active : [];
  const orderAmount = summed.reduce((sum, c) => sum + c.row.orderAmount, 0);
  const commissionAmount = summed.reduce((sum, c) => sum + c.row.commissionAmount, 0);

  const nameSource = summed.length > 0 ? summed : counted;
  const mainRow = [...nameSource].sort((a, b) => b.row.commissionAmount - a.row.commissionAmount)[0];
  let productName = mainRow?.row.productName ?? "";
  if (productName && summed.length > 1) {
    productName = `${productName} (+${summed.length - 1} sản phẩm khác)`;
  }

  const labelSource = status === "reversed" ? counted : active;
  const rawStatusLabel = labelSource.find((c) => c.status === status)?.row.linkedProductStatus ?? "";

  return {
    kind: "ok",
    order: { orderId, subId, productName, orderAmount, commissionAmount, status, rawStatusLabel, warnings },
  };
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
    mergedMultiItem: 0,
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
    const merged = mergeOrderRows(orderId, group);
    if (merged.kind === "unknown-status") {
      result.skippedUnknownStatus += 1;
      result.errors.push(
        `[${orderId}] Gia tri cot "Trang thai san pham lien ket" la "${merged.rawStatus}" - khong khop gia tri nao da biet (${KNOWN_STATUS_LABELS.map((s) => `"${s}"`).join(", ")}), bo qua ca don de tranh doan sai.`
      );
      continue;
    }

    const order = merged.order;
    if (group.length > 1) result.mergedMultiItem += 1;
    result.errors.push(...order.warnings);

    const targetStatus = order.status;
    const subId = order.subId;

    if (!subId) {
      result.skippedNoSubId += 1;
      continue;
    }

    const requestEntry = logStore.findBySubId(subId);
    if (!requestEntry || !requestEntry.merchant) {
      result.skippedSubIdNotFound += 1;
      continue;
    }

    const existing = ledgerStore.getEntryByOrderId(requestEntry.merchant, orderId);

    if (targetStatus === "confirmed") {
      if (existing?.status === "confirmed" || existing?.status === "paid") {
        // "paid" la trang thai SAU "confirmed" (chi dat duoc qua markWithdrawalPaid, xem ledgerStore.ts)
        // - bao cao Shopee liet ke lai CA LICH SU nen don da tra tien se tiep tuc hien "Hoan thanh"
        // o moi lan import sau, day la lap lai binh thuong chu khong phai xung dot, coi nhu duplicate.
        result.confirmedDuplicate += 1;
        continue;
      }
      if (existing?.status === "reversed") {
        result.errors.push(
          `[${orderId}] Bao cao Shopee ghi "Hoan thanh" nhung entry noi bo dang o trang thai "reversed" - can admin kiem tra tay, khong tu dong ghi de.`
        );
        continue;
      }

      try {
        let entry;
        if (existing?.status === "pending") {
          entry = ledgerStore.confirmPendingEntry(existing.id, {
            orderAmount: order.orderAmount,
            commissionAmount: order.commissionAmount,
            productName: order.productName || undefined,
            taxPercent: recordOrderConfig.taxPercent,
            platformFeePercent: recordOrderConfig.platformFeePercent,
            userSharePercent: recordOrderConfig.userSharePercent,
            maxCommissionRatioPercent: recordOrderConfig.maxCommissionRatioPercent,
          });
          result.statusTransitions.push({ orderId, from: "pending", to: "confirmed" });
        } else {
          entry = ledgerStore.recordConversion({
            subId,
            platform: requestEntry.platform,
            userId: requestEntry.userId,
            merchant: requestEntry.merchant,
            orderId,
            productName: order.productName || undefined,
            orderAmount: order.orderAmount,
            commissionAmount: order.commissionAmount,
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
          subId,
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
            `[${orderId}] Bao cao Shopee ghi "${order.rawStatusLabel}" nhung entry noi bo dang "${existing.status}" - KHONG tu huy (coi la final), can admin tu kiem tra (dung reverse-entry CLI neu that su can huy).`
          );
        }
        continue;
      }
      try {
        ledgerStore.reverseCommissionEntry(
          existing.id,
          `Bao cao Shopee ghi trang thai san pham lien ket = "${order.rawStatusLabel}"`
        );
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
            orderAmount: order.orderAmount,
            commissionAmount: order.commissionAmount,
            productName: order.productName || undefined,
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
        subId,
        platform: requestEntry.platform,
        userId: requestEntry.userId,
        merchant: requestEntry.merchant,
        orderId,
        productName: order.productName || undefined,
        orderAmount: order.orderAmount,
        commissionAmount: order.commissionAmount,
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
