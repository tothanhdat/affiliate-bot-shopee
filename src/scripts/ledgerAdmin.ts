/**
 * Script quan tri ledger chay tay tren server. Tu 2026-09-29 du an chi con ho tro SHOPEE, ma
 * Shopee di thang qua an_redir (khong qua network affiliate nao) nen KHONG the tu dong hoa doi
 * soat - day la duong ghi nhan don DUY NHAT va VINH VIEN, ben canh trang web /admin/record-orders.
 * Dung khi ban tu mat thay 1 don hang that thanh cong tren dashboard affiliate.shopee.vn va muon
 * ghi vao ledger de user nhan duoc phan hoa hong cua ho (COMMISSION_USER_SHARE_PERCENT trong .env).
 *
 * Chay: npx tsx src/scripts/ledgerAdmin.ts <subcommand> --flag=value
 *
 * Subcommands:
 *   record-conversion --subId= --orderId= --orderAmount= --commissionAmount= [--productName=] [--note=]
 *   record-shopee-report --file=<duong dan file .csv>     (2026-08-22: import THANG file bao cao goc
 *     Shopee Affiliate, vd "AffiliateCommissionReport_*.csv" tu affiliate.shopee.vn/report/conversion_report
 *     - khong can doi ten cot truoc. Tu quyet dinh confirmed/pending/reversed theo cot "Trang thai san
 *     pham lien ket" trong file - xem core/shopeeReportImport.ts. Day la cong cu doi soat CHINH.)
 *   mark-withdrawal-paid --id= [--proofImagePath=<duong dan anh chup man hinh da chuyen khoan>]
 *     (anh se duoc COPY vao WITHDRAWAL_PROOF_DIR, ban chi can tro toi 1 file da co san tren may -
 *     TUY CHON tu 2026-10-01, giong form tren /admin/withdrawals; khong co anh thi don rut do khong
 *     co bang chung doi chieu, xem rui ro so 7 trong rui-ro-can-giai-quyet.md)
 *   reverse-entry --id= --reason=   (2026-08-20: huy duoc CA don "confirmed"/"Kha dung" - loi thoat
 *     rieng cho CLI, vi Shopee ghi tay khong co giai doan "pending". Tren admin web CHI huy duoc
 *     don "pending")
 *   list-pending-withdrawals
 */
import { parseArgs } from "node:util";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { env } from "../config/env.js";
import { AppError } from "../core/errors.js";
import { LedgerStore } from "../core/ledgerStore.js";
import { LogStore } from "../core/logStore.js";
import { importShopeeReport } from "../core/shopeeReportImport.js";
import { recordSingleOrder, type RecordOrderConfig } from "../core/orderIngest.js";
import type { Platform } from "../core/types.js";
import { formatOrdersConfirmedReply, ORDERS_CONFIRMED_TEMPLATE_DEFAULT } from "../adapters/shared/replyText.js";

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
      "Thieu subcommand. Cac subcommand ho tro: record-conversion, record-shopee-report, mark-withdrawal-paid, reverse-entry, list-pending-withdrawals"
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
    userSharePercent: ledgerStore.getUserSharePercent(env.commission.userSharePercent),
    maxCommissionRatioPercent: env.commission.maxRatioPercent,
    holdConfig: {
      thresholdVnd: ledgerStore.getPayoutHoldThresholdVnd(env.payoutHold.thresholdVnd),
      holdDays: ledgerStore.getPayoutHoldDays(env.payoutHold.holdDays),
      smallHoldDays: ledgerStore.getPayoutHoldSmallDays(env.payoutHold.smallHoldDays),
    },
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

        const entry = recordSingleOrder(logStore, ledgerStore, orderConfig, {
          subId,
          orderId,
          productName,
          orderAmount,
          commissionAmount,
          note,
        });
        console.log(JSON.stringify(entry, null, 2));

        const { token } = ledgerStore.findOrCreateDashboardToken(entry.platform, entry.userId);
        const ordersConfirmedTemplate = ledgerStore.getOrdersConfirmedTemplate(ORDERS_CONFIRMED_TEMPLATE_DEFAULT);
        await notifyUserFromCli(
          entry.platform,
          entry.userId,
          formatOrdersConfirmedReply(
            ordersConfirmedTemplate,
            [{ orderId: entry.orderId, productName: entry.productName, userShareAmount: entry.userShareAmount }],
            `${env.dashboard.baseUrl}/d/${token}`
          )
        );
        break;
      }

      case "record-shopee-report": {
        const filePath = requireFlag(values, "file");
        let raw: string;
        try {
          raw = readFileSync(filePath, "utf8");
        } catch (err) {
          fail(`Khong doc duoc file "${filePath}": ${(err as Error).message}`);
        }

        const result = importShopeeReport(logStore, ledgerStore, { recordOrderConfig: orderConfig }, raw!);
        console.log(JSON.stringify(result, null, 2));

        for (const summary of result.confirmedByUser) {
          const { token } = ledgerStore.findOrCreateDashboardToken(summary.platform, summary.userId);
          const ordersConfirmedTemplate = ledgerStore.getOrdersConfirmedTemplate(ORDERS_CONFIRMED_TEMPLATE_DEFAULT);
          await notifyUserFromCli(
            summary.platform,
            summary.userId,
            formatOrdersConfirmedReply(ordersConfirmedTemplate, summary.items, `${env.dashboard.baseUrl}/d/${token}`)
          );
        }
        break;
      }

      case "mark-withdrawal-paid": {
        const id = requireFlag(values, "id");
        const proofImagePath = values.proofImagePath;
        // Anh TUY CHON tu 2026-10-01 - nhung neu DA tro toi 1 duong dan thi duong dan do phai ton tai,
        // khong im lang danh dau da tra voi bang chung rong khi admin chi go sai ten file.
        let storedFilename: string | null = null;
        if (proofImagePath) {
          if (!existsSync(proofImagePath)) {
            fail(`Khong tim thay file anh "${proofImagePath}"`);
          }
          mkdirSync(env.withdrawal.proofDir, { recursive: true });
          const ext = extname(proofImagePath) || ".png";
          storedFilename = `${id}-${Date.now()}${ext}`;
          copyFileSync(proofImagePath, join(env.withdrawal.proofDir, storedFilename));
        }
        const result = ledgerStore.markWithdrawalPaid(id, storedFilename);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "reverse-entry": {
        const id = requireFlag(values, "id");
        const reason = requireFlag(values, "reason");
        // allowNonPending: true - don Shopee ghi tay khong co giai doan "pending",
        // nen CLI la loi thoat DUY NHAT de huy 1 don da "confirmed" (nhap sai, tra hang phat
        // hien tre...). Van bi chan neu entry da gan vao 1 yeu cau rut tien (EntryAlreadyWithdrawnError).
        const result = ledgerStore.reverseCommissionEntry(id, reason, { allowNonPending: true });
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "list-pending-withdrawals": {
        const result = ledgerStore.listPendingWithdrawals();
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      default:
        fail(
          `Subcommand "${subcommand}" khong ton tai. Cac subcommand ho tro: record-conversion, record-shopee-report, mark-withdrawal-paid, reverse-entry, list-pending-withdrawals`
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
