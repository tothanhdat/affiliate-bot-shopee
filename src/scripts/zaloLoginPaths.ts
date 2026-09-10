import { resolve } from "node:path";

/**
 * Logic chon/kiem tra duong dan file session cho script zaloLogin.ts - tach rieng khoi script
 * chay that de unit-test duoc (ban than viec quet QR thi khong test tu dong duoc).
 */

/** File session cua bot DANG CHAY - script dang nhap KHONG bao gio duoc ghi vao day. */
export const PROTECTED_SESSION_PATH = "./data/zalo-session.json";

/** Dich mac dinh cho tai khoan Zalo MOI - co tinh khac PROTECTED_SESSION_PATH. */
export const DEFAULT_NEW_SESSION_PATH = "./data/zalo-session-bot2.json";

export interface ResolveSessionOutputPathInput {
  /** Gia tri co --out. Khong truyen = dung DEFAULT_NEW_SESSION_PATH. */
  requestedPath?: string;
  /** Co --force: cho ghi de file dich da ton tai. KHONG mo duong cho PROTECTED_SESSION_PATH. */
  force: boolean;
  /** Inject de test duoc, that thi la existsSync. */
  fileExists: (path: string) => boolean;
}

/**
 * Tra ve duong dan se ghi session, hoac throw voi thong bao ro rang.
 *
 * Hai chot an toan, deu co chu dich:
 * 1. Chan TUYET DOI viec ghi vao file session cua bot dang chay - ke ca co --force. Ghi de file do
 *    bang credentials cua tai khoan khac se lam bot that doi tai khoan luc restart ke tiep, hoac
 *    da tai khoan cu ra ngoai (zca-js chi cho 1 phien/tai khoan). Khong co ly do chinh dang nao can
 *    lam viec nay qua script nay - muon doi session cua bot that thi dung chinh bot do.
 * 2. Khong ghi de file da ton tai neu thieu --force: file session la thu KHONG lay lai duoc neu mat
 *    (phai quet QR lai bang dien thoai).
 */
export function resolveSessionOutputPath(input: ResolveSessionOutputPathInput): string {
  const path = input.requestedPath ?? DEFAULT_NEW_SESSION_PATH;

  // So sanh sau khi resolve: chan duoc ca "data/zalo-session.json" (thieu "./") lan duong dan tuyet doi.
  if (resolve(path) === resolve(PROTECTED_SESSION_PATH)) {
    throw new Error(
      `Tu choi: "${path}" la file session cua bot dang chay. Ghi de file nay bang tai khoan khac se ` +
        `lam bot that doi tai khoan hoac bi da phien ra ngoai. Dung duong dan khac (mac dinh ${DEFAULT_NEW_SESSION_PATH}).`
    );
  }

  if (input.fileExists(path) && !input.force) {
    throw new Error(
      `Tu choi: "${path}" da ton tai. File session mat la phai quet QR lai - neu chac chan muon ghi de, ` +
        `chay lai kem --force.`
    );
  }

  return path;
}
