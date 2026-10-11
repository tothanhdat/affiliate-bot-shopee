/**
 * Ap trang thai cua MOT don vao ledger - phan DUNG CHUNG giua moi nguon don (bao cao Shopee, RioHub
 * TikTok). Tach tu importShopeeReport() 2026-10-11 theo spec 2026-10-11-doi-soat-don-tiktok-design.md.
 *
 * MODULE NAY KHONG BIET SAN NAO. Moi thu "khac nhau giua cac san" (doc dinh dang nguon, gop dong,
 * phan loai trang thai, cau chu) nam o CALLER va di vao qua `OrderStatusApplyInput`. Day la module
 * cua DUONG TIEN LEDGER, khong phai cua TikTok: bo han TikTok sau nay thi file nay O LAI, Shopee van
 * goi no.
 *
 * KHONG DOI HANH VI so voi ban tung nam trong shopeeReportImport.ts - bo test Shopee la bang chung,
 * phai xanh khong sua dong nao. Sua logic o day = sua tien cua CA HAI san.
 *
 * Tra ve MANG outcome (khong phai 1): mot don co the sinh hai viec lien tiep (huy yeu cau rut roi
 * reverse). Thu tu trong mang la thu tu viec xay ra.
 */
import { AppError, DuplicateConversionError } from "./errors.js";
import type { LedgerStore } from "./ledgerStore.js";
import type { MerchantId } from "./merchants.js";
import { formatVnd } from "./money.js";
import type { RecordOrderConfig } from "./orderIngest.js";
import type { CommissionEntry, Platform } from "./types.js";
import { formatVnDateIso, todayVnIso } from "./vietnamDate.js";

export type OrderStatusOutcome =
  | { kind: "confirmed-new"; entry: CommissionEntry; wasPending: boolean; newOrder: boolean; held: boolean }
  | { kind: "confirmed-duplicate" }
  /** Don nho phai cho them vai ngay o "Cho xac nhan" (payoutHold.ts). newOrder: don vua duoc ghi moi. */
  | { kind: "small-hold-deferred"; newOrder: boolean }
  | { kind: "pending-new" }
  | { kind: "pending-updated" }
  | { kind: "reversed"; from: "pending" | "confirmed" }
  /** Huy don chua tung ghi nhan: khong co tien de thu hoi, chi dem vao chart. */
  | { kind: "reversed-unseen" }
  | { kind: "debt-created"; platform: Platform; userId: string; orderId: string; amount: number }
  | {
      kind: "withdrawal-cancelled";
      platform: Platform;
      userId: string;
      withdrawalId: string;
      /** So user DA YEU CAU rut (W = so net + no se tru), khong phai so net. */
      amount: number;
      orderId: string;
    }
  | { kind: "warning"; message: string }
  | { kind: "error"; message: string };

export interface OrderStatusApplyInput {
  orderId: string;
  targetStatus: "confirmed" | "pending" | "reversed";
  subId: string;
  requestEntry: { platform: Platform; userId: string; merchant: MerchantId };
  orderAmount: number;
  /** BI BO QUA khi targetStatus = "reversed": nhanh do thu hoi theo existing.userShareAmount da luu. */
  commissionAmount: number;
  productName: string | null;
  orderDate: string | null;
  orderTime: string | null;
  completedAt: string | null;
  /** Cau ghi vao lich su khi reverse / ghi no - moi nguon tu dien dat theo nhan cua no. */
  reverseReason: string;
  /** `note` cua entry moi, tach theo trang thai vi hai nhanh tung ghi hai cau khac nhau. */
  notes: { confirmed: string; pending: string };
  /** Ten nguon trong cau canh bao hoa hong bi khoa. Vd "Shopee". */
  sourceLabel: string;
  /** Cum "nguon noi don da hoan tat" trong canh bao entry reversed. Vd 'Bao cao Shopee ghi "Hoan thanh"'. */
  confirmedClaim: string;
}

function errorMessage(err: unknown): string {
  return err instanceof AppError ? err.userMessage : (err as Error).message;
}

export function applyOrderStatusToLedger(
  ledgerStore: LedgerStore,
  input: OrderStatusApplyInput,
  recordOrderConfig: RecordOrderConfig,
  importDay: string
): OrderStatusOutcome[] {
  const out: OrderStatusOutcome[] = [];
  const { orderId, targetStatus, subId, requestEntry } = input;
  const merchant = requestEntry.merchant;

  const existing = ledgerStore.getEntryByOrderId(merchant, orderId);

  // Chart "Don hang moi" tren dashboard (xem LedgerStore.migrateCreateSeenOrdersTable): ghi "don moi"
  // TRUOC moi nhanh trang thai ben duoi vi don huy ngay tu lan dau khong bao gio vao
  // commission_entries nhung van phai dem. Chi lan DAU thang nen nguon liet ke lai lich su khong
  // dem lai. Don DA CO trong he thong thi khong phai don moi hom nay - ghi theo ngay entry duoc ghi nhan.
  ledgerStore.recordSeenOrder(
    merchant,
    orderId,
    existing ? (existing.status === "paid" ? "confirmed" : existing.status) : targetStatus,
    existing ? formatVnDateIso(new Date(existing.createdAt)) : importDay
  );

  // Bu ngay dat don cho entry da ghi TRUOC khi he thong biet doc cot nay. Dat o day de ap dung cho MOI
  // nhanh trang thai ben duoi. Chi ghi khi dang trong (xem backfillOrderDate).
  if (existing && input.orderDate) {
    ledgerStore.backfillOrderDate(existing.id, input.orderDate);
    // Gio: bu SAU khi ngay da chot de dieu kien "cung ngay" trong backfillOrderTime dung.
    if (input.orderTime) ledgerStore.backfillOrderTime(existing.id, input.orderDate, input.orderTime);
  }

  // % user nhan cho RIENG don nay: uu dai % theo tung user tinh theo ngay user DAT don (khong phai
  // ngay import - xem userCommissionOverride.ts). Khong biet ngay dat thi lui ve hom nay gio VN,
  // KHONG doan nguoc. Voi updatePendingEntry/confirmPendingEntry no chi la FALLBACK cho entry chua
  // co ty le chot.
  const userSharePercent = ledgerStore.resolveUserSharePercent(
    requestEntry.platform,
    requestEntry.userId,
    input.orderDate ?? todayVnIso(),
    recordOrderConfig.userSharePercent
  );
  const fallbackPercents = {
    taxPercent: recordOrderConfig.taxPercent,
    platformFeePercent: recordOrderConfig.platformFeePercent,
    userSharePercent,
  };

  // Don pending ma admin da SUA TAY hoa hong goc (commissionOverriddenAt): ledgerStore giu so do chu
  // khong lay so cua nguon. Neu nguon bao so khac thi bao admin - day la cho DUY NHAT phat hien viec
  // tien tra cho user dang lech voi tien nguon tra. Khong return: van phai cap nhat trang thai/so
  // lieu khac o nhanh ben duoi.
  if (
    existing?.status === "pending" &&
    existing.commissionOverriddenAt !== null &&
    targetStatus !== "reversed" &&
    input.commissionAmount !== existing.commissionAmount
  ) {
    out.push({
      kind: "warning",
      message:
        `[${orderId}] ${input.sourceLabel} bao hoa hong ${formatVnd(input.commissionAmount)} nhung don dang khoa o ` +
        `${formatVnd(existing.commissionAmount)} (admin sua tay) - giu so da khoa. Vao Don hang > sua hoa hong > ` +
        `bo khoa neu muon lay lai so cua ${input.sourceLabel}.`,
    });
  }

  if (targetStatus === "confirmed") {
    if (existing?.status === "confirmed" || existing?.status === "paid") {
      // "paid" la trang thai SAU "confirmed" - nguon liet ke lai ca lich su nen don da tra tien se tiep
      // tuc hien "hoan tat" o moi lan dong bo sau: lap lai binh thuong, khong phai xung dot.
      out.push({ kind: "confirmed-duplicate" });
      return out;
    }
    if (existing?.status === "reversed") {
      out.push({
        kind: "warning",
        message: `[${orderId}] ${input.confirmedClaim} nhung entry noi bo dang o trang thai "reversed" - can admin kiem tra tay, khong tu dong ghi de.`,
      });
      return out;
    }

    try {
      let entry: CommissionEntry;
      const wasPending = existing?.status === "pending";
      let newOrder = false;
      if (existing?.status === "pending") {
        entry = ledgerStore.confirmPendingEntry(existing.id, {
          orderAmount: input.orderAmount,
          commissionAmount: input.commissionAmount,
          productName: input.productName || undefined,
          // FALLBACK: chi dung cho entry ghi truoc khi he thong chot ty le theo tung don.
          fallbackPercents,
          maxCommissionRatioPercent: recordOrderConfig.maxCommissionRatioPercent,
          completedAt: input.completedAt,
          holdConfig: recordOrderConfig.holdConfig,
        });
      } else {
        entry = ledgerStore.recordConversion({
          subId,
          platform: requestEntry.platform,
          userId: requestEntry.userId,
          merchant,
          orderId,
          productName: input.productName || undefined,
          orderAmount: input.orderAmount,
          commissionAmount: input.commissionAmount,
          orderDate: input.orderDate,
          orderTime: input.orderTime,
          taxPercent: recordOrderConfig.taxPercent,
          platformFeePercent: recordOrderConfig.platformFeePercent,
          userSharePercent,
          maxCommissionRatioPercent: recordOrderConfig.maxCommissionRatioPercent,
          completedAt: input.completedAt,
          holdConfig: recordOrderConfig.holdConfig,
          note: input.notes.confirmed,
        });
        newOrder = true;
      }

      // Don NHO con phai cho vai ngay o "Cho xac nhan" truoc khi vao Kha dung (xem payoutHold.ts):
      // chua co dong nao kha dung nen caller KHONG ghi chuyen trang thai, KHONG gui tin "don ve".
      if (entry.status !== "confirmed") {
        out.push({ kind: "small-hold-deferred", newOrder });
        return out;
      }

      ledgerStore.recordOrderStatusEvent(merchant, orderId, "confirmed", importDay);
      // PHAI so voi hom nay chu khong chi kiem `!== null`: don nho vua toi han cung co available_from
      // (ngay da qua) nhung khong con bi giam.
      const held = entry.availableFrom !== null && entry.availableFrom > importDay;
      out.push({ kind: "confirmed-new", entry, wasPending, newOrder, held });
    } catch (err) {
      if (err instanceof DuplicateConversionError) {
        out.push({ kind: "confirmed-duplicate" });
      } else {
        out.push({ kind: "error", message: `[${orderId}] ${errorMessage(err)}` });
      }
    }
    return out;
  }

  if (targetStatus === "reversed") {
    if (!existing) {
      // Chua tung ghi nhan - khong co tien de huy, nhung van dem vao cot "Da huy" cua chart dashboard
      // DUNG 1 LAN (ngay dau thay); cac lan sau van liet ke don nay se bi INSERT OR IGNORE bo qua.
      ledgerStore.recordOrderStatusEvent(merchant, orderId, "reversed", importDay);
      out.push({ kind: "reversed-unseen" });
      return out;
    }
    // BA ca khac nhau HAN nhau ve TIEN, khong duoc gop:
    //  - confirmed + chua nam trong yeu cau rut: tien con trong tay -> thu hoi TRON, khong no.
    //  - confirmed + da nam trong yeu cau rut 'requested': tien CHUA di -> TU DONG huy ca yeu cau rut,
    //    thu hoi TRON don nay, khong no (2026-10-08, yeu cau truc tiep cua user).
    //  - paid: tien da di that -> ghi no. Yeu cau DA 'paid' thi khong con gi de huy.
    if (existing.status === "reversed") return out;

    if (existing.status === "confirmed") {
      // existing la SNAPSHOT doc 1 lan dau - KHONG tu refresh sau khi cancelWithdrawal ghi DB, nen phai
      // dung 1 CO RIENG (released) de biet tien da ve tay chua, khong duoc re-check existing.withdrawalId.
      let released = existing.withdrawalId === null;
      if (!released) {
        const withdrawalId = existing.withdrawalId!;
        try {
          const cancelled = ledgerStore.cancelWithdrawal(withdrawalId, input.reverseReason);
          out.push({
            kind: "withdrawal-cancelled",
            platform: cancelled.platform,
            userId: cancelled.userId,
            withdrawalId,
            amount: cancelled.amount + cancelled.debtApplied,
            orderId,
          });
          released = true;
        } catch (err) {
          // WithdrawalNotCancellableError: yeu cau da chuyen sang 'paid' GIUA luc doc existing (hiem).
          // KHONG the reverse an toan nua - de nguyen cho lan dong bo SAU (luc do existing.status la
          // 'paid' that trong DB, se di vao nhanh ghi no).
          out.push({ kind: "error", message: `[${orderId}] Khong huy duoc yeu cau rut ${withdrawalId}: ${errorMessage(err)}` });
        }
      }

      if (released) {
        try {
          // allowNonPending: entry dang 'confirmed' nen reverseCommissionEntry mac dinh tu choi. An toan
          // vi tien chac chan dang trong tay (chua tung vao yeu cau rut, hoac vua duoc tha ra o tren).
          ledgerStore.reverseCommissionEntry(existing.id, input.reverseReason, { allowNonPending: true });
          ledgerStore.recordOrderStatusEvent(merchant, orderId, "reversed", importDay);
          out.push({ kind: "reversed", from: "confirmed" });
        } catch (err) {
          out.push({ kind: "error", message: `[${orderId}] ${errorMessage(err)}` });
        }
      }
      return out;
    }

    if (existing.status === "paid") {
      const debt = ledgerStore.recordPayoutDebt({
        platform: existing.platform,
        userId: existing.userId,
        merchant: existing.merchant,
        orderId,
        amount: existing.userShareAmount,
        note: input.reverseReason,
      });
      ledgerStore.recordOrderStatusEvent(merchant, orderId, "reversed", importDay);
      if (debt) {
        out.push({
          kind: "debt-created",
          platform: existing.platform,
          userId: existing.userId,
          orderId,
          amount: existing.userShareAmount,
        });
      }
      return out;
    }

    if (existing.status !== "pending") return out;
    try {
      ledgerStore.reverseCommissionEntry(existing.id, input.reverseReason);
      ledgerStore.recordOrderStatusEvent(merchant, orderId, "reversed", importDay);
      out.push({ kind: "reversed", from: "pending" });
    } catch (err) {
      out.push({ kind: "error", message: `[${orderId}] ${errorMessage(err)}` });
    }
    return out;
  }

  // targetStatus === "pending"
  if (existing) {
    if (existing.status === "pending") {
      try {
        ledgerStore.updatePendingEntry(existing.id, {
          orderAmount: input.orderAmount,
          commissionAmount: input.commissionAmount,
          productName: input.productName || undefined,
          fallbackPercents,
          maxCommissionRatioPercent: recordOrderConfig.maxCommissionRatioPercent,
        });
        out.push({ kind: "pending-updated" });
      } catch (err) {
        out.push({ kind: "error", message: `[${orderId}] ${errorMessage(err)}` });
      }
    }
    return out;
  }
  try {
    ledgerStore.recordConversion({
      subId,
      platform: requestEntry.platform,
      userId: requestEntry.userId,
      merchant,
      orderId,
      productName: input.productName || undefined,
      orderAmount: input.orderAmount,
      commissionAmount: input.commissionAmount,
      taxPercent: recordOrderConfig.taxPercent,
      platformFeePercent: recordOrderConfig.platformFeePercent,
      userSharePercent,
      maxCommissionRatioPercent: recordOrderConfig.maxCommissionRatioPercent,
      completedAt: input.completedAt,
      holdConfig: recordOrderConfig.holdConfig,
      orderDate: input.orderDate,
      orderTime: input.orderTime,
      status: "pending",
      note: input.notes.pending,
    });
    out.push({ kind: "pending-new" });
  } catch (err) {
    if (!(err instanceof DuplicateConversionError)) {
      out.push({ kind: "error", message: `[${orderId}] ${errorMessage(err)}` });
    }
  }
  return out;
}
