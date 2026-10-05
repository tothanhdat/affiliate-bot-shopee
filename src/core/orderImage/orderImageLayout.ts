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
  };
}
