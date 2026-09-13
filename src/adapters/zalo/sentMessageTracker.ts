interface SentEntry {
  msgId: string | null;
  text: string;
  sentAt: number;
}

/**
 * Nho cac tin bot VUA TU GUI de phan biet voi tin ADMIN GO TAY.
 *
 * Ly do ton tai: bot chay voi `selfListen: true` nen nhan duoc CA tin do chinh tai khoan nay gui di
 * (xem zca-js listen.js - message co isSelf=true van duoc emit). Tin do co 2 nguon: bot tu gui, hoac
 * chu bot mo Zalo go tay tra loi user. Nguon thu 2 la tin hieu "admin dang tu van, bot im di".
 *
 * api.sendMessage() tra ve { message: { msgId } | null } nen thuong doi chieu duoc bang msgId. Truong
 * hop message la null thi roi xuong so khop noi dung trong 60s. Neu ca 2 deu truot, bot se tuong tin
 * cua CHINH MINH la admin go tay va tu khoa minh - huong hong AN TOAN (im lang, khong noi bay).
 */
export class SentMessageTracker {
  private entries: SentEntry[] = [];
  private readonly ttlMs: number;
  private readonly textMatchWindowMs: number;
  private readonly now: () => number;

  constructor(options: { ttlMs?: number; textMatchWindowMs?: number; now?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? 5 * 60_000;
    this.textMatchWindowMs = options.textMatchWindowMs ?? 60_000;
    this.now = options.now ?? (() => Date.now());
  }

  get size(): number {
    return this.entries.length;
  }

  record(msgId: number | string | null | undefined, text: string): void {
    this.prune();
    this.entries.push({
      msgId: msgId === null || msgId === undefined ? null : String(msgId),
      text,
      sentAt: this.now(),
    });
  }

  isOwn(msgId: string, text: string): boolean {
    this.prune();
    const now = this.now();
    return this.entries.some((entry) => {
      if (entry.msgId !== null && msgId !== "" && entry.msgId === msgId) return true;
      return entry.text === text && now - entry.sentAt <= this.textMatchWindowMs;
    });
  }

  private prune(): void {
    const cutoff = this.now() - this.ttlMs;
    this.entries = this.entries.filter((entry) => entry.sentAt > cutoff);
  }
}
