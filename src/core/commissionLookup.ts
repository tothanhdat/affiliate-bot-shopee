/**
 * Tra so tien hoa hong uoc tinh cua 1 san pham Shopee theo item_id, de bot bao truoc cho user
 * ngay luc tra link thay vi bat ho doi den luc don duoc xac nhan.
 *
 * VI SAO DI QUA BEN THU BA (quyet dinh 2026-10-01, da verify ky - dung "don gian hoa" ve
 * goi thang Shopee):
 * - Shopee tu choi cap Open API cho tai khoan KOC ca nhan (2026-08-17, hoi lai 2026-09-30 van
 *   tu choi). Trang /open_api cua tai khoan hien "khong co quyen truy cap", nut "Ap dung" bi
 *   disabled -> khong tu dang ky duoc.
 * - API noi bo cua portal affiliate (`/api/v3/offer/product?item_id=`) doi 5 header chong bot
 *   (`x-sap-sec`, `x-sap-ri`, `af-ac-enc-dat`, `af-ac-enc-sz-token`, `x-sz-sdk-version`). Da test
 *   that 2026-09-30: bo header -> `{"is_login":true,"error":90309999}` (cookie hop le van bi tu
 *   choi); giu du header va CHI doi item_id -> cung loi. Tuc la chu ky gan theo TUNG request,
 *   replay tu server la bat kha thi. Chi tiet trong CLAUDE.md.
 *
 * Doi lai, thiet ke o day phai chiu duoc viec nguon co the bien mat bat cu luc nao: MOI duong
 * that bai deu tra `null` (xem lookupOrNull) va bot giu nguyen tin nhan cu, user khong thay gi
 * bat thuong. KHONG BAO GIO throw - ham nay nam tren duong gui tin cho user.
 */

export interface ProductCommission {
  /**
   * So tien hoa hong GOC (truoc thue/phi san/chia % cho user), don vi VND - lay THANG tu API.
   * DA bao gom ca hoa hong san lan hoa hong seller Xtra, va DA ap tran neu don cham tran.
   */
  commissionAmount: number;
  /**
   * Tong % hoa hong (san + Xtra). CHI dung de log/chan doan.
   * TUYET DOI khong nhan lai voi `price` de ra tien: don cham tran se sai rat lon (xem isCapped).
   */
  ratePercent: number;
  /** Gia niem yet luc tra - KHONG phai gia thuc tra sau voucher/xu cua user. */
  price: number;
  /** true = hoa hong da cham tran, nen commissionAmount NHO HON ratePercent x price. */
  isCapped: boolean;
}

export interface CommissionLookup {
  /** Tra ve `null` khi khong tra duoc vi bat ky ly do gi - caller chi can bo qua phan uoc tinh. */
  lookup(itemId: string): Promise<ProductCommission | null>;
}

/** Phan be mat cua `fetch` ma module nay dung - khai bao rieng de test khong can mock ca Response. */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export const ADDLIVETAG_DEFAULT_ENDPOINT =
  "https://data.addlivetag.com/product-data/product-data.php";

export interface AddlivetagCommissionLookupConfig {
  apiKey: string;
  timeoutMs: number;
  endpoint?: string;
  /**
   * % hoa hong san co ban cua tai khoan, CHI truyen khi tier cua minh khac mac dinh cua ben
   * cung cap. Bo trong thi API tu lay rate that (`shopeeRateSource: "api_or_db"`) - da doi chieu
   * 2026-09-30 tren 3 san pham that, khop chinh xac portal nen mac dinh la bo trong.
   */
  baseRatePercent?: number | null;
  /** Tran hoa hong san theo VND cua tai khoan. Bo trong thi dung mac dinh cua ben cung cap (40.000d). */
  capVnd?: number | null;
  fetchImpl?: FetchLike;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export class AddlivetagCommissionLookup implements CommissionLookup {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly config: AddlivetagCommissionLookupConfig) {
    this.fetchImpl = config.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  async lookup(itemId: string): Promise<ProductCommission | null> {
    try {
      return await this.fetchCommission(itemId);
    } catch (err) {
      // Giu dung quy tac 2026-09-02: log chi tiet chan doan truoc khi nuot loi, neu khong thi
      // moi su co cua nguon nay deu khong de lai dau vet nao trong log Railway.
      const detail = err instanceof Error ? err.message : String(err);
      console.warn(`[commissionLookup] tra hoa hong that bai cho item ${itemId}: ${detail}`);
      return null;
    }
  }

  private async fetchCommission(itemId: string): Promise<ProductCommission | null> {
    const url = new URL(this.config.endpoint ?? ADDLIVETAG_DEFAULT_ENDPOINT);
    url.searchParams.set("item_id", itemId);
    if (this.config.baseRatePercent != null) {
      url.searchParams.set("base_rate", String(this.config.baseRatePercent));
    }
    if (this.config.capVnd != null) {
      url.searchParams.set("cap", String(this.config.capVnd));
    }

    const res = await this.fetchImpl(url.toString(), {
      // Key di bang header chu KHONG phai query string - tranh lot vao log may chu trung gian.
      headers: { "X-API-Key": this.config.apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!res.ok) {
      // 401 = thieu/sai API key, 429 = vuot han muc (150 req/phut khi co key).
      console.warn(`[commissionLookup] item ${itemId}: HTTP ${res.status}`);
      return null;
    }

    const body = (await res.json()) as Record<string, unknown> | null;
    if (!body || body.status !== "success") {
      console.warn(`[commissionLookup] item ${itemId}: status=${String(body?.status)}`);
      return null;
    }

    const info = body.productInfo as Record<string, unknown> | undefined;
    if (!info) {
      console.warn(`[commissionLookup] item ${itemId}: thieu productInfo`);
      return null;
    }

    const commissionAmount = readFiniteNumber(info.commission);
    // commission <= 0 nghia la nganh hang nay khong co hoa hong - tra null de bot giu nguyen tin
    // nhan cu, thay vi khoe voi user con so "0d" vua vo nghia vua phan tac dung.
    if (commissionAmount == null || commissionAmount <= 0) {
      console.warn(`[commissionLookup] item ${itemId}: commission khong dung (${String(info.commission)})`);
      return null;
    }

    return {
      commissionAmount: Math.round(commissionAmount),
      ratePercent: readFiniteNumber(info.totalRatePercent) ?? 0,
      price: readFiniteNumber(info.price) ?? 0,
      isCapped: info.isCapped === true,
    };
  }
}
