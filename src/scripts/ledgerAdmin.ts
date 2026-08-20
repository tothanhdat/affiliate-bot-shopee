/**
 * Script quan tri ledger chay tay tren server - GIAI PHAP TAM THOI thay the T2.1 (dong bo don
 * hang/hoa hong tu dong tu nguon affiliate qua subId). Dung khi ban tu mat thay 1 don hang that
 * thanh cong tren dashboard Accesstrade/Shopee Affiliate va muon ghi vao ledger de user nhan duoc
 * phan hoa hong cua ho (COMMISSION_USER_SHARE_PERCENT trong .env). Khi T2.1 tu dong hoa xong, script nay van con dung duoc cho cac truong hop can
 * sua tay (reverse-entry, mark-withdrawal-paid).
 *
 * Chay: npx tsx src/scripts/ledgerAdmin.ts <subcommand> --flag=value
 *
 * Subcommands:
 *   record-conversion --subId= --orderId= --orderAmount= --commissionAmount= [--productName=] [--note=]
 *   record-conversions-csv --file=<duong dan file .csv>   (xem quy-trinh-van-hanh-cashback.md, quy trinh hang tuan)
 *   mark-withdrawal-paid --id= --proofImagePath=<duong dan anh chup man hinh da chuyen khoan>
 *     (anh se duoc COPY vao WITHDRAWAL_PROOF_DIR, ban chi can tro toi 1 file da co san tren may -
 *     bat buoc, xem rui ro so 7 trong rui-ro-can-giai-quyet.md)
 *   reverse-entry --id= --reason=
 *   list-pending-withdrawals
 *   record-accesstrade-payment --amount= [--note=]   (Accesstrade CHUYEN KHOAN THAT cho chu bot, doi chieu dong tien)
 *   reconciliation-summary                            (da nhan that vs da tra that cho user, canh bao neu am)
 *   sync-accesstrade [--lookbackDays=30]              (T2.1, 2026-08-20: goi that GET /v1/transactions, tu ghi nhan
 *     don da duoc Accesstrade duyet (status=1 + is_confirmed=1) va tu huy don bi tra ve rejected (status=2).
 *     CHI ap dung merchant di qua Accesstrade (TikTok Shop/Lazada) - Shopee KHONG xuat hien o day, van
 *     phai doi soat thu cong nhu cu. Server production tu chay lenh nay dinh ky (ACCESSTRADE_SYNC_ENABLED=true,
 *     xem src/index.ts) - subcommand nay dung de chay tay/test thu, khong bat buoc dung thuong xuyen.)
 */
import { parseArgs } from "node:util";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { env } from "../config/env.js";
import { parseCsv } from "../core/csv.js";
import { AppError } from "../core/errors.js";
import { LedgerStore } from "../core/ledgerStore.js";
import { LogStore } from "../core/logStore.js";
import { syncAccesstradeTransactions } from "../core/accesstradeSync.js";
import {
  recordOrderFromAccesstrade,
  recordOrdersFromCsv,
  summarizeOrderResultsByUser,
  type RecordOrderConfig,
  type UserOrderSummary,
} from "../core/orderIngest.js";
import type { Platform } from "../core/types.js";
import { formatOrdersConfirmedReply } from "../adapters/shared/replyText.js";

function fail(message: string): never {
  console.error(`Loi: ${message}`);
  process.exit(1);
}

function requireFlag(values: Record<string, string | boolean | undefined>, name: string): string {
  const v = values[name];
  if (typeof v !== "string" || v === "") {
    fail(`Thieu tham so --${name}`);
  }
  return v as string;
}

function requireNumberFlag(values: Record<string, string | boolean | undefined>, name: string): number {
  const raw = requireFlag(values, name);
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    fail(`--${name} phai la so, nhan duoc "${raw}"`);
  }
  return n;
}

/**
 * phan-hoi-cai-thien-trai-nghiem-nguoi-dung.md muc 1: bao user khi don duoc ghi nhan qua CLI.
 * Chi ho tro Telegram (goi thang Telegram Bot API bang fetch - stateless, KHONG can Telegraf/long
 * polling nen an toan chay song song voi bot dang chay tren server, khac voi Zalo). Zalo (zca-js)
 * can 1 session dang nhap con song - dang nhap lai tu CLI co the day session cua bot dang chay
 * tren server ra ngoai (CloseReason.DuplicateConnection, da gap that trong qua trinh trien khai
 * Railway) nen KHONG tu dong gui, chi in nhac de admin tu nhan tay hoac dung /admin/record-orders
 * tren web (chay trong cung process voi bot dang dang nhap, an toan).
 */
async function notifyUserFromCli(platform: Platform, userId: string, message: string): Promise<void> {
  if (platform === "telegram") {
    if (env.telegramBotToken === "") {
      console.warn(`[user-notify] khong the gui (thieu TELEGRAM_BOT_TOKEN) toi ${platform}/${userId}`);
      return;
    }
    try {
      const res = await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: userId, text: message }),
      });
      if (!res.ok) {
        console.warn(`[user-notify] Telegram API loi (${res.status}) khi gui toi ${userId}:`, await res.text());
      }
    } catch (err) {
      console.warn(`[user-notify] gui Telegram toi ${userId} that bai:`, (err as Error).message);
    }
    return;
  }

  if (platform === "zalo") {
    console.log(
      `[user-notify] User zalo/${userId} co don moi duoc xac nhan nhung CLI khong tu gui duoc qua Zalo ` +
        `(tranh rui ro dang nhap trung lam gian doan bot dang chay). Dung /admin/record-orders tren web ` +
        `de gui tu dong, hoac tu nhan tay cho user nay.`
    );
    return;
  }

  console.warn(`[user-notify] platform "${platform}" (${userId}) khong co kenh chat de gui thong bao.`);
}

async function main(): Promise<void> {
  const [subcommand, ...rest] = process.argv.slice(2);
  if (!subcommand) {
    fail(
      "Thieu subcommand. Cac subcommand ho tro: record-conversion, record-conversions-csv, mark-withdrawal-paid, reverse-entry, list-pending-withdrawals, record-accesstrade-payment, reconciliation-summary, sync-accesstrade"
    );
  }

  const { values } = parseArgs({
    args: rest,
    options: {
      subId: { type: "string" },
      orderId: { type: "string" },
      productName: { type: "string" },
      orderAmount: { type: "string" },
      commissionAmount: { type: "string" },
      note: { type: "string" },
      id: { type: "string" },
      reason: { type: "string" },
      file: { type: "string" },
      amount: { type: "string" },
      proofImagePath: { type: "string" },
      lookbackDays: { type: "string" },
    },
    strict: true,
  });

  const logStore = new LogStore(env.databasePath);
  const ledgerStore = new LedgerStore(env.ledgerDatabasePath);
  const orderConfig: RecordOrderConfig = {
    taxPercent: env.commission.taxPercent,
    platformFeePercent: env.commission.platformFeePercent,
    userSharePercent: env.commission.userSharePercent,
    maxCommissionRatioPercent: env.commission.maxRatioPercent,
  };

  try {
    switch (subcommand) {
      case "record-conversion": {
        const subId = requireFlag(values, "subId");
        const orderId = requireFlag(values, "orderId");
        const productName = typeof values.productName === "string" ? values.productName : undefined;
        const orderAmount = requireNumberFlag(values, "orderAmount");
        const commissionAmount = requireNumberFlag(values, "commissionAmount");
        const note = typeof values.note === "string" ? values.note : undefined;

        const entry = recordOrderFromAccesstrade(logStore, ledgerStore, orderConfig, {
          subId,
          orderId,
          productName,
          orderAmount,
          commissionAmount,
          note,
        });
        console.log(JSON.stringify(entry, null, 2));

        const { token } = ledgerStore.findOrCreateDashboardToken(entry.platform, entry.userId);
        await notifyUserFromCli(
          entry.platform,
          entry.userId,
          formatOrdersConfirmedReply(
            [{ orderId: entry.orderId, productName: entry.productName, userShareAmount: entry.userShareAmount }],
            `${env.dashboard.baseUrl}/d/${token}`
          )
        );
        break;
      }

      case "record-conversions-csv": {
        const filePath = requireFlag(values, "file");
        let raw: string;
        try {
          raw = readFileSync(filePath, "utf8");
        } catch (err) {
          fail(`Khong doc duoc file "${filePath}": ${(err as Error).message}`);
        }

        const rows = parseCsv(raw!);
        if (rows.length === 0) {
          fail(`File "${filePath}" khong co dong du lieu nao (chi co header hoac rong).`);
        }

        // Header bat buoc: subId,orderId,orderAmount,commissionAmount. productName,note tuy chon.
        // Xem file mau: src/scripts/templates/weekly-conversions.example.csv
        const results = recordOrdersFromCsv(logStore, ledgerStore, orderConfig, rows);
        const okCount = results.filter((r) => r.ok).length;
        for (const r of results) {
          console.log(`[dong ${r.line}] ${r.ok ? "OK" : "LOI"} - orderId=${r.orderId} subId=${r.subId} - ${r.detail}`);
        }
        console.log(`\nTong: ${results.length} dong, ${okCount} thanh cong, ${results.length - okCount} loi.`);

        const summaries: UserOrderSummary[] = summarizeOrderResultsByUser(results);
        for (const summary of summaries) {
          const { token } = ledgerStore.findOrCreateDashboardToken(summary.platform, summary.userId);
          await notifyUserFromCli(
            summary.platform,
            summary.userId,
            formatOrdersConfirmedReply(summary.items, `${env.dashboard.baseUrl}/d/${token}`)
          );
        }
        break;
      }

      case "mark-withdrawal-paid": {
        const id = requireFlag(values, "id");
        const proofImagePath = requireFlag(values, "proofImagePath");
        if (!existsSync(proofImagePath)) {
          fail(`Khong tim thay file anh "${proofImagePath}"`);
        }
        mkdirSync(env.withdrawal.proofDir, { recursive: true });
        const ext = extname(proofImagePath) || ".png";
        const storedFilename = `${id}-${Date.now()}${ext}`;
        copyFileSync(proofImagePath, join(env.withdrawal.proofDir, storedFilename));
        const result = ledgerStore.markWithdrawalPaid(id, storedFilename);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "reverse-entry": {
        const id = requireFlag(values, "id");
        const reason = requireFlag(values, "reason");
        const result = ledgerStore.reverseCommissionEntry(id, reason);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "list-pending-withdrawals": {
        const result = ledgerStore.listPendingWithdrawals();
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "record-accesstrade-payment": {
        const amount = requireNumberFlag(values, "amount");
        const note = typeof values.note === "string" ? values.note : undefined;
        const result = ledgerStore.recordAccesstradePayment({ amountVnd: amount, note });
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "reconciliation-summary": {
        const result = ledgerStore.getReconciliationSummary();
        console.log(JSON.stringify(result, null, 2));
        if (result.remainingVnd < 0) {
          console.warn(
            `\nCANH BAO: dang tra user vuot qua so tien da nhan tu Accesstrade (am ${Math.abs(result.remainingVnd).toLocaleString("vi-VN")}d).`
          );
        }
        break;
      }

      case "sync-accesstrade": {
        if (env.accesstrade.apiKey === "") {
          fail("Thieu ACCESSTRADE_API_KEY - can co API key that de goi GET /v1/transactions.");
        }
        const lookbackDays =
          typeof values.lookbackDays === "string" ? Number(values.lookbackDays) : env.accesstradeSync.lookbackDays;
        if (!Number.isFinite(lookbackDays) || lookbackDays <= 0) {
          fail(`--lookbackDays phai la so nguyen duong, nhan duoc "${values.lookbackDays}"`);
        }

        const result = await syncAccesstradeTransactions(logStore, ledgerStore, {
          apiKey: env.accesstrade.apiKey,
          apiBase: env.accesstrade.apiBase,
          timeoutMs: env.accesstrade.timeoutMs,
          lookbackDays,
          recordOrderConfig: orderConfig,
        });
        console.log(JSON.stringify(result, null, 2));

        for (const summary of result.confirmedByUser) {
          const { token } = ledgerStore.findOrCreateDashboardToken(summary.platform, summary.userId);
          await notifyUserFromCli(
            summary.platform,
            summary.userId,
            formatOrdersConfirmedReply(summary.items, `${env.dashboard.baseUrl}/d/${token}`)
          );
        }
        break;
      }

      default:
        fail(
          `Subcommand "${subcommand}" khong ton tai. Cac subcommand ho tro: record-conversion, record-conversions-csv, mark-withdrawal-paid, reverse-entry, list-pending-withdrawals, record-accesstrade-payment, reconciliation-summary, sync-accesstrade`
        );
    }
  } catch (err) {
    if (err instanceof AppError) {
      fail(err.userMessage);
    }
    fail(err instanceof Error ? err.message : String(err));
  } finally {
    logStore.close();
    ledgerStore.close();
  }
}

main();
