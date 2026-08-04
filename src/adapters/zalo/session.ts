import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Credentials } from "zca-js";

/**
 * Luu/doc credentials (cookie/imei/userAgent) sau khi dang nhap QR thanh cong,
 * de lan khoi dong sau khong phai quet QR lai. File nay chua thong tin dang nhap
 * tai khoan Zalo - KHONG commit vao git (da them vao .gitignore).
 */
export function loadZaloCredentials(sessionPath: string): Credentials | null {
  if (!existsSync(sessionPath)) return null;
  try {
    const raw = readFileSync(sessionPath, "utf-8");
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

export function saveZaloCredentials(sessionPath: string, credentials: Credentials): void {
  mkdirSync(dirname(sessionPath), { recursive: true });
  writeFileSync(sessionPath, JSON.stringify(credentials, null, 2), "utf-8");
}
