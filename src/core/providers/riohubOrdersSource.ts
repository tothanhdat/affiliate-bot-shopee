/**
 * Keo toan bo don TikTok tu RioHub (GET /orders). Day la CHO DUY NHAT cua duong doi soat goi mang -
 * tiktokOrderImport.ts nhan mot mang va khong biet gi ve HTTP.
 *
 * KHONG loc theo ngay (spec 3.2): tham so sai ten/sai dinh dang bi API nuot im lang va tra ve toan
 * bo lich su, nen code buoc phai chiu duoc ca quet toan bo. Voi vai tram don thi quet het la du.
 *
 * Chinh bai hoc "tham so bi nuot" cung ap cho `page`: neu API bo qua no, trang sau se tra Y HET trang
 * truoc va vong lap chay den het MAX_PAGES voi du lieu nhan doi. Nen moi trang phai co it nhat mot don
 * MOI so voi cac trang truoc, khong thi nem loi.
 */
import type { RiohubOrderRecord } from "../tiktokOrderImport.js";
import { RIOHUB_TIKTOK_PATH_PREFIX, RiohubApiError, RiohubClient, RiohubUnreachableError } from "./riohubClient.js";

const ORDERS_PATH = `${RIOHUB_TIKTOK_PATH_PREFIX}/orders`;
const PAGE_SIZE = 200;
const MAX_PAGES = 50;

interface OrdersResponse {
  data?: RiohubOrderRecord[];
  orders?: RiohubOrderRecord[];
}

export async function fetchTiktokOrders(
  client: Pick<RiohubClient, "get">,
  creatorUsername: string
): Promise<RiohubOrderRecord[]> {
  const all: RiohubOrderRecord[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await client.get<OrdersResponse>(ORDERS_PATH, {
      creator_username: creatorUsername,
      page,
      page_size: PAGE_SIZE,
    });
    const rows = res.data ?? res.orders;
    if (rows === undefined) {
      throw new Error(
        "RioHub /orders tra ve khong co `data` lan `orders` - dinh dang da doi. Dung dong bo de khong ghi sai tien."
      );
    }

    let fresh = 0;
    for (const r of rows) {
      const key = `${r.order_id ?? ""}|${r.sku_id ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(r);
      fresh += 1;
    }
    if (rows.length > 0 && fresh === 0) {
      throw new Error(
        `RioHub /orders trang ${page} tra ve toan don da thay o trang truoc - tham so phan trang co the dang bi bo qua. Dung dong bo.`
      );
    }
    if (rows.length < PAGE_SIZE) return all;
  }
  throw new Error(`RioHub /orders vuot ${MAX_PAGES} trang (${MAX_PAGES * PAGE_SIZE} don) - can them bo loc ngay (xem spec 3.2).`);
}

/**
 * Tra ve ham keo don, hoac `null` khi TikTok tat / thieu cau hinh - null nghia la duong doi soat TRO
 * HOAN TOAN (khong the, khong route). Giong cach createTiktokProvider() tu tat khi thieu key.
 */
export function createTiktokOrdersFetcher(cfg: {
  enabled: boolean;
  apiKey: string;
  creatorUsername: string;
  baseUrls: readonly string[];
  timeoutMs: number;
}): (() => Promise<RiohubOrderRecord[]>) | null {
  if (!cfg.enabled || cfg.apiKey === "" || cfg.creatorUsername === "") return null;
  const client = new RiohubClient({ apiKey: cfg.apiKey, baseUrls: cfg.baseUrls, timeoutMs: cfg.timeoutMs });
  return () => fetchTiktokOrders(client, cfg.creatorUsername);
}

/**
 * Cau bao loi cho ADMIN khi keo don that bai. Tach 404 va 401 vi nhin giong nhau ma nguyen nhan khac
 * han: 404 = sai DUONG DAN (thieu tien to /partner/tiktok/affiliate), 401 = sai KEY (da dinh that 2026-10-10).
 * Luon nhac Shopee khong bi anh huong - day la thong diep cach ly cho nguoi dang hoang.
 */
export function describeRiohubSyncError(err: unknown): string {
  if (err instanceof RiohubApiError) {
    const hint =
      err.httpStatus === 401
        ? " — API key sai hoặc hết hạn."
        : err.httpStatus === 404
          ? " — sai đường dẫn endpoint, KHÔNG phải sai key."
          : ".";
    return `RioHub từ chối: HTTP ${err.httpStatus} ${err.code}${hint} Đơn Shopee không bị ảnh hưởng.`;
  }
  if (err instanceof RiohubUnreachableError) {
    return "Không với tới được RioHub ở cả 3 tên miền — thử lại sau vài phút. Đơn Shopee không bị ảnh hưởng.";
  }
  return `Lỗi khi đồng bộ đơn TikTok: ${(err as Error).message} Đơn Shopee không bị ảnh hưởng.`;
}
