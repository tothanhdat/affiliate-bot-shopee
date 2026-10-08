import { parseCsv } from "./csv.js";
import { AppError, DuplicateConversionError } from "./errors.js";
import type { LedgerStore } from "./ledgerStore.js";
import type { LogStore } from "./logStore.js";
import { summarizeOrderResultsByUser, type OrderRowResult, type RecordOrderConfig, type UserOrderSummary } from "./orderIngest.js";
import type { Platform, StatusTransition } from "./types.js";
import { formatVnDateIso, todayVnIso } from "./vietnamDate.js";

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
 *                          hien tai cua admin web, khong tu huy don da "confirmed")
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
  /** Dung de gui thong bao gop cho user. CHI cho don MOI "confirmed". */
  confirmedByUser: UserOrderSummary[];
  /** Ma don duoc ghi MOI trong lan nay (confirmed hoac pending) - dung cho lich su hien tren /admin/record-orders. */
  newOrderIds: string[];
  /** Don doi trang thai THAT SU (vd pending->confirmed) - KHONG gom pendingUpdated (van la "pending", chi refresh so lieu). */
  statusTransitions: StatusTransition[];
  /** Don MOI bi giam vi user_share >= nguong (2026-10-08) - xem payoutHold.ts. */
  heldCount: number;
  /**
   * Don phat sinh NO hoan tra trong lan import nay: bao cao ghi da huy nhung tien DA ra khoi tay
   * (entry 'paid', hoac entry dang nam trong 1 yeu cau rut cho duyet).
   */
  debtCreatedCount: number;
  /** Chi tiet no vua sinh - route web dung de DM user. */
  debtsByUser: Array<{ platform: Platform; userId: string; orderId: string; amount: number }>;
  /**
   * Yeu cau rut bi TU DONG huy vi mot don trong do bao "Da huy" (2026-10-08, yeu cau truc tiep cua
   * user - DAO NGUOC quyet dinh "canh bao admin, admin tu quyet" ban dau). amount la so NET da huy
   * (tien user se thay lai trong Kha dung). Route web dung de DM user ngay.
   *
   * RUI RO DA DUOC NGUOI DUNG CHAP NHAN: neu admin DA chuyen khoan tay cho yeu cau nay nhung CHUA
   * bam "Danh dau da tra" tren he thong truoc khi import chay, tien se bi tinh la "chua chuyen" va
   * quay lai Kha dung cua user - tao ra lech so voi thuc te admin da chuyen. Khong co cach nao phat
   * hien tu phia he thong (khong biet admin da chuyen khoan that ngoai doi hay chua).
   */
  cancelledWithdrawals: Array<{
    platform: Platform;
    userId: string;
    withdrawalId: string;
    amount: number;
    orderId: string;
  }>;
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

/**
 * Doc 1 cot ngay cua bao cao Shopee (dinh dang "YYYY-MM-DD HH:mm:ss", gio VN) -> chi
 * giu phan ngay. Tra null khi thieu/sai dinh dang: day la cot THONG KE, khong duoc quyen lam hong
 * viec ghi nhan hoa hong (bang tien). KHONG doan dinh dang khac ("30/09/2026" co the la dd/mm hoac
 * mm/dd tuy locale may xuat file - doan sai se lech ngay am tham ca thang).
 *
 * Ham nay phuc vu CA 2 cot ngay dang doc: "Thời Gian Đặt Hàng" (-> order_date) va "Thời gian hoàn
 * thành" (-> completed_at, 2026-10-08). Do la ly do ten ham khong con la ...OrderDate.
 *
 * Luu y ten cot: Shopee viet hoa "G"/"H" giua cau o rieng cot ngay dat ("Thời Gian Đặt Hàng") trong khi
 * 2 cot ngay ke ben viet thuong ("Thời gian hoàn thành", "Thời gian Click") - da doi chieu file
 * that, dung "sua lai cho dong nhat".
 */
export function parseShopeeReportDay(raw: string | undefined): string | null {
  const text = raw?.trim();
  if (!text) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]|$)/.exec(text);
  if (!match) return null;

  const [, year, month, day] = match;
  const monthNum = Number(month);
  const dayNum = Number(day);
  if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) return null;

  // Chan ngay khong ton tai that (vd 2026-02-30): dung ngay UTC de khong dinh mui gio may chay.
  const probe = new Date(`${year}-${month}-${day}T12:00:00Z`);
  if (Number.isNaN(probe.getTime()) || probe.getUTCDate() !== dayNum) return null;

  return `${year}-${month}-${day}`;
}

interface ShopeeReportRow {
  orderId: string;
  /** "YYYY-MM-DD" gio VN, null khi bao cao khong co cot ngay hoac gia tri hong. */
  orderDate: string | null;
  /**
   * Ngay Shopee ghi don "Hoan thanh" = ngay giao hang, tu cot "Thời gian hoàn thành" (2026-10-08).
   * CHI dong "Hoàn thành" moi co gia tri nay - dong pending va dong huy deu de trong (da doi chieu
   * file bao cao that: 26 dong hoan thanh co, 8 dong pending va 12 dong huy khong co).
   */
  completedAt: string | null;
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
      orderDate: parseShopeeReportDay(row["Thời Gian Đặt Hàng"]),
      completedAt: parseShopeeReportDay(row["Thời gian hoàn thành"]),
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
  /** Ngay dat SOM NHAT trong cac dong cua don - don gop nhieu san pham co the lech gio nhau. */
  orderDate: string | null;
  /**
   * Ngay Shopee ghi don "Hoan thanh" = ngay giao hang, tu cot "Thời gian hoàn thành" (2026-10-08).
   * CHI dong "Hoàn thành" moi co gia tri nay - dong pending va dong huy deu de trong (da doi chieu
   * file bao cao that: 26 dong hoan thanh co, 8 dong pending va 12 dong huy khong co).
   */
  completedAt: string | null;
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
 * Gop N dong cung 1 "ID don hang" thanh 1 don. Quy tac chot voi user 2026-09-10:
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
/** Ghi chu dinh kem khi huy/ghi no 1 don - dung chung cho ca 3 nhanh de admin doc log thong nhat. */
function reverseReason(rawStatusLabel: string): string {
  return `Bao cao Shopee ghi trang thai san pham lien ket = "${rawStatusLabel}"`;
}

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

  // Ngay dat cua ca don = ngay SOM NHAT trong cac dong doc duoc (dong qua tang/mua kem co the ghi
  // gio khac). Lay tu TAT CA cac dong cua don, ke ca dong bi huy - don van duoc dat vao ngay do.
  const orderDate = rows
    .map((r) => r.orderDate)
    .filter((d): d is string => d !== null)
    .sort()[0] ?? null;

  const active = counted.filter((c) => c.status !== "reversed");

  // Ngay giao hang cua ca don = MUON NHAT trong cac dong KHONG bi huy. Nguoc voi orderDate (lay som
  // nhat) va co chu dich: cua so tra hang cua ca don chi dong khi mon giao CUOI CUNG da het han tra.
  // Dong bi huy luon trong cot nay nen khong anh huong, nhung loc ra cho ro y.
  const completedAt =
    active
      .map((c) => c.row.completedAt)
      .filter((d): d is string => d !== null)
      .sort()
      .at(-1) ?? null;
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
    order: {
      orderId,
      orderDate,
      completedAt,
      subId,
      productName,
      orderAmount,
      commissionAmount,
      status,
      rawStatusLabel,
      warnings,
    },
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
    heldCount: 0,
    debtCreatedCount: 0,
    debtsByUser: [],
    cancelledWithdrawals: [],
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
    const importDay = todayVnIso();

    // Chart "Don hang moi" tren dashboard (xem LedgerStore.migrateCreateSeenOrdersTable): ghi "don moi"
    // TRUOC moi nhanh trang thai ben duoi vi don huy ngay tu lan dau khong bao gio vao
    // commission_entries nhung van phai dem. Chi lan DAU thang nen bao cao liet ke lai lich su khong
    // dem lai. Don DA CO trong he thong (ghi qua CLI/form/import cu) thi khong phai don moi hom nay -
    // ghi theo ngay entry duoc ghi nhan.
    ledgerStore.recordSeenOrder(
      requestEntry.merchant,
      orderId,
      existing ? (existing.status === "paid" ? "confirmed" : existing.status) : targetStatus,
      existing ? formatVnDateIso(new Date(existing.createdAt)) : importDay
    );

    // Bu ngay dat don cho entry da ghi TRUOC khi he thong biet doc cot nay (hoac truoc 2026-10-01).
    // Dat o day de ap dung cho MOI nhanh trang thai ben duoi - khong chi don duoc confirm. Chi ghi
    // khi dang trong (xem backfillOrderDate), nen bao cao sau khong ghi de ngay da chot.
    if (existing && order.orderDate) {
      ledgerStore.backfillOrderDate(existing.id, order.orderDate);
    }

    // % user nhan cho RIENG don nay: uu dai % theo tung user tinh theo ngay user DAT don (khong phai
    // ngay import - Shopee bao cao tre vai ngay, xem userCommissionOverride.ts). Bao cao khong cho
    // biet ngay dat thi lui ve hom nay gio VN, KHONG doan nguoc. Dung cho ca 4 nhanh ben duoi; voi
    // updatePendingEntry/confirmPendingEntry no chi la FALLBACK cho entry chua co ty le chot.
    const userSharePercent = ledgerStore.resolveUserSharePercent(
      requestEntry.platform,
      requestEntry.userId,
      order.orderDate ?? todayVnIso(),
      recordOrderConfig.userSharePercent
    );

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
            // FALLBACK: chi dung cho entry ghi truoc khi he thong chot ty le theo tung don -
            // entry moi giu nguyen ty le luc duoc ghi nhan (xem effectivePercents trong ledgerStore).
            fallbackPercents: {
              taxPercent: recordOrderConfig.taxPercent,
              platformFeePercent: recordOrderConfig.platformFeePercent,
              userSharePercent,
            },
            maxCommissionRatioPercent: recordOrderConfig.maxCommissionRatioPercent,
            completedAt: order.completedAt,
            holdConfig: recordOrderConfig.holdConfig,
          });
          result.statusTransitions.push({ orderId, from: "pending", to: "confirmed" });
          ledgerStore.recordOrderStatusEvent(requestEntry.merchant, orderId, "confirmed", importDay);
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
            orderDate: order.orderDate,
            taxPercent: recordOrderConfig.taxPercent,
            platformFeePercent: recordOrderConfig.platformFeePercent,
            userSharePercent,
            maxCommissionRatioPercent: recordOrderConfig.maxCommissionRatioPercent,
            completedAt: order.completedAt,
            holdConfig: recordOrderConfig.holdConfig,
            note: "Nhap tu bao cao Shopee (file CSV admin upload)",
          });
          result.newOrderIds.push(orderId);
          // Don hoa toc: lan dau thay da "Hoan thanh" -> cung tinh vao cot "Chuyen Kha dung" hom nay.
          ledgerStore.recordOrderStatusEvent(requestEntry.merchant, orderId, "confirmed", importDay);
        }
        result.confirmedNew += 1;
        if (entry.availableFrom !== null) result.heldCount += 1;
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
      if (!existing) {
        // Chua tung ghi nhan - khong co tien de huy, nhung van dem vao cot "Da huy" cua chart dashboard
        // DUNG 1 LAN (ngay dau thay); cac lan import sau van liet ke don nay se bi INSERT OR IGNORE bo qua.
        ledgerStore.recordOrderStatusEvent(requestEntry.merchant, orderId, "reversed", importDay);
        continue;
      }
      // BA ca khac nhau HAN nhau ve TIEN, khong duoc gop (xem spec muc 4):
      //  - confirmed + chua nam trong yeu cau rut: tien con trong tay -> thu hoi TRON, khong no.
      //    Ke ca don dang bi giam: hold da lam dung viec cua no.
      //  - confirmed + da nam trong yeu cau rut 'requested': tien CHUA di (yeu cau chi la 'requested',
      //    chua 'paid') -> TU DONG huy ca yeu cau rut, thu hoi TRON don nay, khong no (2026-10-08, yeu
      //    cau truc tiep cua user - DAO NGUOC quyet dinh ban dau "canh bao admin, admin tu quyet": xem
      //    doc comment cua result.cancelledWithdrawals o dau file ve rui ro da duoc chap nhan).
      //  - paid: tien da di that -> ghi no + DM user. Yeu cau DA 'paid' thi khong con gi de huy.
      if (existing.status === "reversed") continue;

      if (existing.status === "confirmed") {
        // existing la SNAPSHOT doc 1 lan dau vong lap nay - KHONG tu refresh sau khi cancelWithdrawal
        // ghi DB, nen phai dung 1 CO RIENG (released) de biet tien da ve tay chua, khong duoc re-check
        // existing.withdrawalId (van giu gia tri CU, da dinh bug nay luc viet, xem lai truoc khi sua
        // logic nay lan nua).
        let released = existing.withdrawalId === null;
        if (!released) {
          const withdrawalId = existing.withdrawalId!;
          try {
            const cancelled = ledgerStore.cancelWithdrawal(withdrawalId, reverseReason(order.rawStatusLabel));
            result.cancelledWithdrawals.push({
              platform: cancelled.platform,
              userId: cancelled.userId,
              withdrawalId,
              amount: cancelled.amount,
              orderId,
            });
            released = true;
          } catch (err) {
            // WithdrawalNotCancellableError: yeu cau da chuyen sang 'paid' GIUA luc doc existing (hiem,
            // dua tranh voi admin bam "Danh dau da tra" cung luc). KHONG the reverse an toan nua - tien
            // CO THE da di that, de nguyen cho nhanh ben duoi xu li o lan import SAU (luc do existing.status
            // da la 'paid' that trong DB, se di dung vao nhanh ghi no).
            const msg = err instanceof AppError ? err.userMessage : (err as Error).message;
            result.errors.push(`[${orderId}] Khong huy duoc yeu cau rut ${withdrawalId}: ${msg}`);
          }
        }

        if (released) {
          try {
            // allowNonPending: entry dang 'confirmed' nen reverseCommissionEntry mac dinh tu choi. An
            // toan o day vi tien chac chan dang trong tay (chua tung vao yeu cau rut, hoac vua duoc
            // tha ra tu lenh huy o tren).
            ledgerStore.reverseCommissionEntry(existing.id, reverseReason(order.rawStatusLabel), {
              allowNonPending: true,
            });
            result.reversedCount += 1;
            result.statusTransitions.push({ orderId, from: "confirmed", to: "reversed" });
            ledgerStore.recordOrderStatusEvent(requestEntry.merchant, orderId, "reversed", importDay);
          } catch (err) {
            const msg = err instanceof AppError ? err.userMessage : (err as Error).message;
            result.errors.push(`[${orderId}] ${msg}`);
          }
        }
        continue;
      }

      if (existing.status === "paid") {
        const debt = ledgerStore.recordPayoutDebt({
          platform: existing.platform,
          userId: existing.userId,
          merchant: existing.merchant,
          orderId,
          amount: existing.userShareAmount,
          note: reverseReason(order.rawStatusLabel),
        });
        ledgerStore.recordOrderStatusEvent(requestEntry.merchant, orderId, "reversed", importDay);
        if (debt) {
          result.debtCreatedCount += 1;
          result.debtsByUser.push({
            platform: existing.platform,
            userId: existing.userId,
            orderId,
            amount: existing.userShareAmount,
          });
        }
        continue;
      }

      if (existing.status !== "pending") continue;
      try {
        ledgerStore.reverseCommissionEntry(
          existing.id,
          `Bao cao Shopee ghi trang thai san pham lien ket = "${order.rawStatusLabel}"`
        );
        result.reversedCount += 1;
        result.statusTransitions.push({ orderId, from: "pending", to: "reversed" });
        ledgerStore.recordOrderStatusEvent(requestEntry.merchant, orderId, "reversed", importDay);
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
            // FALLBACK: chi dung cho entry ghi truoc khi he thong chot ty le theo tung don -
            // entry moi giu nguyen ty le luc duoc ghi nhan (xem effectivePercents trong ledgerStore).
            fallbackPercents: {
              taxPercent: recordOrderConfig.taxPercent,
              platformFeePercent: recordOrderConfig.platformFeePercent,
              userSharePercent,
            },
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
        userSharePercent,
        maxCommissionRatioPercent: recordOrderConfig.maxCommissionRatioPercent,
        completedAt: order.completedAt,
        holdConfig: recordOrderConfig.holdConfig,
        orderDate: order.orderDate,
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
