/**
 * Gop canh bao admin trong mot cua so thoi gian, theo tung key.
 *
 * Ly do ton tai: su co RioHub 09/10/2026 keo dai ~7 phut. Khong co lop nay thi 20 user gui link
 * trong luc do = 20 tin canh bao giong het nhau. Tin DAU TIEN luon gui ngay - gop khong duoc lam
 * cham thoi diem admin biet co su co.
 *
 * Trong bo nho, mat khi restart - chap nhan duoc: restart xong canh bao lai la dung, vi luc do
 * admin can biet su co van con.
 */
export class AlertThrottle {
  private readonly lastSentAt = new Map<string, number>();

  constructor(private readonly windowMs: number) {}

  shouldSend(key: string, nowMs: number = Date.now()): boolean {
    const last = this.lastSentAt.get(key);
    if (last !== undefined && nowMs - last < this.windowMs) return false;
    this.lastSentAt.set(key, nowMs);
    return true;
  }
}
