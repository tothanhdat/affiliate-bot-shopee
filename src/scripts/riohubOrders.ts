/**
 * Doc don TikTok tu RioHub va in ra man hinh - CHI DOC, khong ghi vao ledger, khong gui tin cho ai.
 *
 * Ly do ton tai (2026-10-09): duong doi soat don TikTok CHUA LAM, vi con 3 field chi biet duoc khi
 * co don quyet toan that (`shared_with_partner`, `pit`, `time_delivered_iso` - xem
 * docs/riohub-tiktok.md). Trong luc cho, day la cach nhin thay chung bang mat thay vi doan. Viec
 * gap nhat ma no tra loi duoc NGAY: `sub_id` 4 doan cua bot co di lot vao don khong - neu khong
 * thi MOI link bot tao deu khong quy duoc ve user nao, va phai biet som chu khong phai sau 3 tuan.
 *
 * Cach dung:
 *   npm run riohub:orders                  # 20 don gan nhat
 *   npm run riohub:orders -- --limit 50
 *   npm run riohub:orders -- --sub-id k-123  # loc theo chuoi con cua sub_id
 *   npm run riohub:orders -- --json          # JSON tho, de dan lai cho nguoi khac doc
 *
 * Doc API key tu .env (RIOHUB_API_KEY) nhu moi script khac - KHONG nhan key qua tham so dong lenh
 * de key khong nam lai trong lich su shell.
 */
import { env } from "../config/env.js";
import { RIOHUB_TIKTOK_PATH_PREFIX, RiohubClient } from "../core/providers/riohubClient.js";
import { looksLikeBotSubId } from "../core/subId.js";

interface RiohubOrder {
  order_id?: string;
  product_name?: string;
  sub_id?: string | null;
  trace_id?: string | null;
  trace_type?: string | null;
  status?: number;
  settlement_status?: string | null;
  content_type?: string | null;
  est_commission?: string | null;
  actual_commission?: string | null;
  shared_with_partner?: string | null;
  pit?: string | null;
  time_created_iso?: string | null;
  time_delivered_iso?: string | null;
  settled_at_iso?: string | null;
}

interface OrdersResponse {
  data?: RiohubOrder[];
  orders?: RiohubOrder[];
  total?: number;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Field chua co gia tri in ra "—" de phan biet ro voi so 0 (0 la gia tri THAT). */
function show(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

async function main(): Promise<void> {
  if (env.tiktok.apiKey === "") {
    console.error("Thieu RIOHUB_API_KEY trong .env. Lay key tai riohub.vn/tiktok-shop-developer.");
    process.exitCode = 1;
    return;
  }
  if (env.tiktok.creatorUsername === "") {
    console.error("Thieu RIOHUB_CREATOR_USERNAME trong .env (username TikTok cua creator).");
    process.exitCode = 1;
    return;
  }

  const limit = Number(arg("limit") ?? 20);
  const client = new RiohubClient({
    apiKey: env.tiktok.apiKey,
    baseUrls: env.tiktok.baseUrls,
    timeoutMs: env.tiktok.timeoutMs,
  });

  const res = await client.get<OrdersResponse>(`${RIOHUB_TIKTOK_PATH_PREFIX}/orders`, {
    creator_username: env.tiktok.creatorUsername,
    page: 1,
    page_size: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 20,
    sub_id: arg("sub-id"),
  });

  const orders = res.data ?? res.orders ?? [];

  // Chua doc duoc mang don o key nao: in ra hinh dang that de sua, thay vi bao "khong co don nao"
  // (bao sai nhu vay se lam tuong sub_id khong lot, trong khi that ra chi la doc nham key).
  if (res.data === undefined && res.orders === undefined) {
    console.warn(
      "⚠️  Khong thay mang don o key `data` hay `orders`. Key co that o tang tren cung: " +
        `${Object.keys(res as Record<string, unknown>).join(", ") || "(rong)"}`
    );
  }

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(orders, null, 2));
    return;
  }

  const fromBot = orders.filter((o) => looksLikeBotSubId(o.sub_id));
  console.log(`Tong: ${show(res.total)} don · dang hien: ${orders.length} · tu link BOT tao: ${fromBot.length}`);

  if (orders.length === 0) {
    console.log("\nKhong co don nao. Don moi dat thuong len API sau khoang 17-19 phut.");
    return;
  }

  for (const o of orders) {
    const bot = looksLikeBotSubId(o.sub_id);
    console.log(`\n${"─".repeat(76)}`);
    console.log(`${bot ? "✅ LINK BOT" : "·  link ngoai"}  ${show(o.order_id)}  ${show(o.time_created_iso)}`);
    console.log(`   san pham  : ${truncate(show(o.product_name), 62)}`);
    console.log(`   sub_id    : ${show(o.sub_id)}`);
    console.log(`   trace     : ${show(o.trace_id)}  (${show(o.trace_type)})  content=${show(o.content_type)}`);
    console.log(`   trang thai: status=${show(o.status)}  settlement=${show(o.settlement_status)}`);
    console.log(`   hoa hong  : est=${show(o.est_commission)}  actual=${show(o.actual_commission)}`);
    // 3 field dang CHO: con "—" nghia la don chua quyet toan, chua tra loi duoc cau hoi nao.
    console.log(
      `   dang cho  : shared_with_partner=${show(o.shared_with_partner)}  pit=${show(o.pit)}  ` +
        `delivered=${show(o.time_delivered_iso)}  settled=${show(o.settled_at_iso)}`
    );
  }

  console.log(`\n${"─".repeat(76)}`);
  if (fromBot.length === 0) {
    console.log(
      "⚠️  Chua thay don nao mang sub_id 4 doan cua bot. Neu anh vua dat don qua link bot thi doi\n" +
        "    them vai phut roi chay lai - don len API sau khoang 17-19 phut."
    );
  } else {
    console.log("✅ sub_id cua bot da di lot vao don - quy don ve dung user duoc (rui ro 7 da go).");
  }
}

main().catch((err: unknown) => {
  console.error("Loi goi RioHub:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
