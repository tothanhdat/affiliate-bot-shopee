/**
 * Dang nhap QR cho 1 TAI KHOAN ZALO MOI va ghi file session ra dia - dung khi chuan bi mot
 * instance bot moi (vi du service thu 2 tren Railway), nguoi quet QR chi can chay 1 lenh:
 *
 *   npm run zalo:login
 *   npm run zalo:login -- --out=./data/zalo-session-bot3.json   (doi duong dan)
 *   npm run zalo:login -- --force                               (cho ghi de file da ton tai)
 *
 * TAI SAO LA SCRIPT RIENG, KHONG DUNG `npm run dev`:
 *
 * 1. File nay **KHONG import src/config/env.ts**, nen `dotenv` khong chay va `.env` KHONG duoc doc
 *    mot dong nao. Do do khong the nao nap TELEGRAM_BOT_TOKEN -> khong the sinh them 1 poller
 *    Telegram tranh voi bot dang chay that (2 poller cung token = production bat dau nhan loi 409).
 *    Day la chan o goc, khong phai nhac nguoi dung tu xoa token truoc khi chay.
 * 2. Khong khoi dong Express/LogStore/LedgerStore/listener Zalo - chi login, ghi file, thoat.
 * 3. Ghi ra duong dan RIENG (mac dinh ./data/zalo-session-bot2.json) va chan tuyet doi viec ghi vao
 *    ./data/zalo-session.json cua bot dang chay - xem resolveSessionOutputPath trong zaloLoginPaths.ts.
 *
 * Sau khi xong: upload file session vua tao len volume cua service moi, dat ten dung bang gia tri
 * ZALO_SESSION_PATH cua service do (mac dinh la ./data/zalo-session.json tren volume), roi bat
 * ZALO_GROUP_ENABLED=true.
 */
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { Zalo, LoginQRCallbackEventType } from "zca-js";
import { saveZaloCredentials } from "../adapters/zalo/session.js";
import { DEFAULT_NEW_SESSION_PATH, resolveSessionOutputPath } from "./zaloLoginPaths.js";

const DEFAULT_QR_PATH = "./data/zalo-qr-bot2.png";

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Mo anh QR bang app mac dinh cua he dieu hanh - tien cho nguoi quet, loi thi bo qua im lang. */
function openQrImage(path: string): void {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    const child = spawn(opener, [path], { detached: true, stdio: "ignore", shell: process.platform === "win32" });
    child.on("error", () => {
      /* khong mo duoc thi thoi, da in duong dan file ra console */
    });
    child.unref();
  } catch {
    /* tuong tu */
  }
}

async function main(): Promise<void> {
  const sessionPath = resolveSessionOutputPath({
    requestedPath: readFlag("out"),
    force: hasFlag("force"),
    fileExists: existsSync,
  });
  const qrPath = readFlag("qr") ?? DEFAULT_QR_PATH;

  console.log("=".repeat(72));
  console.log("DANG NHAP ZALO CHO TAI KHOAN BOT MOI");
  console.log("=".repeat(72));
  console.log(`File session se ghi vao : ${sessionPath}`);
  console.log(`Anh QR se luu tai       : ${qrPath}`);
  console.log("");
  console.log("LUU Y: quet bang dien thoai cua TAI KHOAN ZALO DUNG CHO BOT (tai khoan phu),");
  console.log("       KHONG phai tai khoan Zalo ca nhan nhan thong bao admin.");
  console.log("");

  let savedTo: string | null = null;

  // Khong truyen credentials -> luon di duong QR. selfListen khong can o day vi script nay
  // khong gan listener nao (khac bot that, xem src/adapters/zalo/bot.ts).
  const zalo = new Zalo({});
  await zalo.loginQR({}, (event) => {
    switch (event.type) {
      case LoginQRCallbackEventType.QRCodeGenerated:
        event.actions
          .saveToFile(qrPath)
          .then(() => {
            console.log(`[qr] Da tao QR -> ${qrPath} (dang mo anh...)`);
            openQrImage(qrPath);
          })
          .catch((err: unknown) => console.warn("[qr] Khong luu duoc anh QR ra file:", err));
        break;
      case LoginQRCallbackEventType.QRCodeScanned:
        console.log(`[qr] Da duoc quet boi: ${event.data.display_name}`);
        break;
      case LoginQRCallbackEventType.QRCodeExpired:
        console.warn("[qr] QR het han - dang tao lai, khong can chay lai lenh.");
        event.actions.retry();
        break;
      case LoginQRCallbackEventType.QRCodeDeclined:
        console.warn("[qr] Dang nhap bi tu choi tren dien thoai.");
        break;
      case LoginQRCallbackEventType.GotLoginInfo:
        saveZaloCredentials(sessionPath, {
          imei: event.data.imei,
          cookie: event.data.cookie,
          userAgent: event.data.userAgent,
        });
        savedTo = sessionPath;
        console.log(`[session] Da ghi session vao ${sessionPath}`);
        break;
    }
  });

  console.log("");
  if (savedTo === null) {
    // Login "xong" ma khong co GotLoginInfo la bat thuong - noi ro thay vi bao thanh cong sai.
    console.error("KHONG ghi duoc file session (khong nhan duoc thong tin dang nhap). Thu chay lai.");
    process.exit(1);
  }

  console.log("=".repeat(72));
  console.log("XONG. Buoc tiep theo:");
  console.log(`  1. Upload "${savedTo}" len volume cua service moi (mount /app/data).`);
  console.log("  2. Dat ten file tren volume dung bang ZALO_SESSION_PATH cua service do");
  console.log("     (mac dinh ./data/zalo-session.json, tuc /app/data/zalo-session.json).");
  console.log("  3. Bat ZALO_GROUP_ENABLED=true roi restart service.");
  console.log("");
  console.log("KHONG commit file session vao git (da co trong .gitignore) - no la quyen truy cap");
  console.log("vao tai khoan Zalo do.");
  console.log("=".repeat(72));
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error("");
    console.error((err as Error).message);
    process.exit(1);
  }
);
