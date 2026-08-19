import { randomBytes } from "node:crypto";

/**
 * Session admin toi gian: 1 tai khoan mac dinh (mat khau co dinh trong env), token ngau nhien
 * luu trong bo nho (mat khi restart server - chap nhan duoc, dung muc do don gian da chon).
 * Khong hash/ky - khong can voi 1 admin duy nhat sau mat khau.
 */
export class AdminSessionStore {
  private readonly sessions = new Set<string>();

  constructor(private readonly expectedPassword: string) {}

  /** Tra ve token moi neu dung mat khau, null neu sai hoac chua cau hinh ADMIN_PASSWORD. */
  login(password: string): string | null {
    if (this.expectedPassword === "" || password !== this.expectedPassword) {
      return null;
    }
    const token = randomBytes(32).toString("hex");
    this.sessions.add(token);
    return token;
  }

  isValid(token: string | null | undefined): boolean {
    return typeof token === "string" && this.sessions.has(token);
  }

  logout(token: string | null | undefined): void {
    if (typeof token === "string") {
      this.sessions.delete(token);
    }
  }
}
