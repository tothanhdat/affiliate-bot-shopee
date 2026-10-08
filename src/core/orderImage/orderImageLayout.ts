import { formatVnd } from "../money.js";
import type { ConfirmedOrderItem } from "../orderIngest.js";

/**
 * So the toi da tren anh. Template chi du cho 3 the ngang; don du duoc gop vao dong
 * "+N don khac" chu KHONG lam anh dai ra - anh dai thi Zalo thu nho lai con kho doc hon text.
 */
export const ORDER_IMAGE_MAX_CARDS = 3;

export interface OrderImageInput {
  items: ConfirmedOrderItem[];
  /** So du kha dung, PHAI doc SAU khi da ghi nhan cac don moi vao ledger. */
  availableVnd: number;
  withdrawalThresholdVnd: number;
  /**
   * Phan tien TRONG LO NAY dang bi giam (2026-10-08, xem payoutHold.ts). 0 = lo khong co don nao bi
   * giam -> anh y nhu cu, khong doi mot pixel.
   */
  heldVnd?: number;
  /** Ngay mo khoa SOM NHAT trong lo, dang "dd/mm". null khi khong co don bi giam. */
  heldUnlockDayText?: string | null;
  /**
   * Tong no hoan tra CON LAI cua user TAI THOI DIEM gui thong bao (2026-10-08, xem payoutHold.ts/
   * payout_debts). DOC LAP voi lo don nay - khoan no co the den tu mot lan import KHAC hoan toan,
   * khong lien quan gi toi cac don dang duoc bao trong lo. 0/undefined = khong co no.
   */
  debtVnd?: number;
}

export interface OrderImageCard {
  /** 1-based, hien trong huy hieu tron o dau the. */
  index: number;
  name: string;
  amountText: string;
}

export interface OrderImageView {
  orderCount: number;
  cards: OrderImageCard[];
  extraCount: number;
  totalText: string;
  availableText: string;
  canWithdraw: boolean;
  /** null khi da rut duoc - hai trang thai nay LOAI TRU nhau tren anh. */
  missingText: string | null;
  /**
   * Dong "Trong do X mo khoa tu dd/mm" - null khi lo khong co don bi giam.
   *
   * Vi sao PHAI co dong nay: anh in "Tong cong" cua lo CANH "So du kha dung". Don bi giam vao Tong
   * cong nhung KHONG vao So du kha dung -> user soi dung mot tam anh thay hai so khong khop. Y het
   * bay thu-tu-doc-so-du da ghi trong CLAUDE.md, chi khac nguyen nhan.
   */
  heldLine: string | null;
  /**
   * Dong "Dang no X, tru khi rut tien" - null khi user khong co no. Tu mo hinh no 2026-10-08 So du
   * kha dung tren anh KHONG tru no (no chi bi tru luc yeu cau rut duoc duyet), nen dong nay bao
   * TRUOC cho user biet lan rut toi se bi tru, thay vi de ho rut roi moi thay nhan it hon. No co the
   * sinh ra tu mot lan import HOAN TOAN KHAC, khong lien quan gi toi cac don trong lo nay - nen dieu
   * kien hien dong nay CHI phu thuoc debtVnd, khong phu thuoc gi vao heldVnd/items.
   */
  debtLine: string | null;
}

/**
 * Bien danh sach don + so du thanh du lieu da format san cho renderer. Tach khoi renderer de
 * test duoc ma khong can nap font hay asset nao.
 */
export function buildOrderImageView(input: OrderImageInput): OrderImageView {
  const { items, availableVnd, withdrawalThresholdVnd } = input;

  // Tong tinh tren TAT CA don, khong phai 3 don hien tren anh - xem test chan hoi quy.
  const totalVnd = items.reduce((sum, item) => sum + item.userShareAmount, 0);

  // Copy truoc khi sort: mang items la cua caller (summarizeOrderResultsByUser), sort tai cho
  // se lam doi thu tu o moi noi khac dang dung chung mang do.
  const shown = [...items]
    .sort((a, b) => b.userShareAmount - a.userShareAmount)
    .slice(0, ORDER_IMAGE_MAX_CARDS);

  const missingVnd = withdrawalThresholdVnd - availableVnd;
  const canWithdraw = missingVnd <= 0;

  return {
    orderCount: items.length,
    cards: shown.map((item, i) => ({
      index: i + 1,
      name: item.productName ? item.productName : `Đơn ${item.orderId}`,
      amountText: formatVnd(item.userShareAmount),
    })),
    extraCount: items.length - shown.length,
    totalText: formatVnd(totalVnd),
    availableText: formatVnd(availableVnd),
    canWithdraw,
    missingText: canWithdraw ? null : formatVnd(missingVnd),
    heldLine:
      (input.heldVnd ?? 0) > 0 && input.heldUnlockDayText
        ? `Trong đó ${formatVnd(input.heldVnd ?? 0)} mở khoá từ ${input.heldUnlockDayText}`
        : null,
    debtLine: (input.debtVnd ?? 0) > 0 ? `Đang nợ ${formatVnd(input.debtVnd ?? 0)}, trừ khi rút tiền` : null,
  };
}
