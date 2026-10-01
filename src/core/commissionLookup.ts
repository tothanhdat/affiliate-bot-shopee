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
   *
   * CO THE BANG 0, va 0 o day la mot cau tra loi THAT: "san pham nay chua bat hoa hong" (da xac
   * minh tu nguon, khong phai tu cache - xem fetchCommission). Khac han voi lookup() tra `null`
   * nghia la "khong biet". Hai cai nay dan toi hai cau tra loi khac nhau cho user nen TUYET DOI
   * khong duoc gop lai.
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
  /**
   * `null` = KHONG BIET (tat tinh nang, mang loi, timeout, 429, du lieu hong) -> bot giu cau hen.
   * Object voi `commissionAmount = 0` = BIET CHAC la khong co hoa hong -> bot bao thang cho user.
   */
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

/** So lieu tho doc tu 1 lan goi API, truoc khi quyet dinh co chap nhan hay khong. */
interface RawProductInfo {
  commissionAmount: number;
  ratePercent: number;
  price: number;
  isCapped: boolean;
  /** true = ben cung cap tra tu cache cua ho (`dataSource: "db"`) chu khong goi lai nguon. */
  fromCache: boolean;
}

/** Duoi nguong nay thi khong con du thoi gian de thu lai cho co y nghia - bo qua luon. */
const MIN_RETRY_BUDGET_MS = 400;

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

  /**
   * Doc hoa hong, kem MOT lan thu lai khi nghi ngo cache cua ben cung cap bi hong.
   *
   * VI SAO CAN THU LAI (do that 2026-10-01, dung xoa buoc nay):
   * Cung mot item, cung mot phut, ben cung cap tra HAI ket qua khac nhau - ban cache
   * (`dataSource: "db"`) noi `commission: 0`, con ban ep goi nguon (`clear_cache=1`,
   * `dataSource: "api"`) noi `commission: 40000`. Tuc la cache cua ho co the giu mot gia tri 0
   * SAI trong toi 3 tieng. Neu tin ngay so 0 do thi bot bo qua uoc tinh cua san pham CO hoa hong
   * that - va neu sau nay them tinh nang "bao thang la san pham khong du dieu kien hoan tien"
   * thi con noi SAI han ve san pham do.
   *
   * Chi thu lai dung truong hop dang nghi: commission <= 0 VA den tu cache. San pham co hoa hong
   * binh thuong khong ton them request nao. Han muc 150 req/phut nen chi phi nay khong dang ke.
   */
  private async fetchCommission(itemId: string): Promise<ProductCommission | null> {
    const startedAt = Date.now();
    let info = await this.fetchOnce(itemId, false, this.config.timeoutMs);

    if (info && info.commissionAmount <= 0 && info.fromCache) {
      // Ngan sach thoi gian la TONG cho ca luot tra, khong phai moi request - user dang cho tin
      // nhan, khong duoc phep doi 2 lan timeout. Con qua it thoi gian thi bo qua lan thu lai.
      const remaining = this.config.timeoutMs - (Date.now() - startedAt);
      if (remaining >= MIN_RETRY_BUDGET_MS) {
        const fresh = await this.fetchOnce(itemId, true, remaining);
        if (fresh) info = fresh;
      }
    }

    if (!info) return null;

    // So am la du lieu hong, khong phai cau tra lon "khong co hoa hong" - coi nhu khong biet.
    if (info.commissionAmount < 0) {
      console.warn(`[commissionLookup] item ${itemId}: commission am (${info.commissionAmount}) - bo qua`);
      return null;
    }

    // Den day commission = 0 (va da ep goi nguon neu so 0 do den tu cache) thi day la so 0 THAT.
    // Tra ve nguyen chu KHONG gop thanh null: caller can phan biet "chua bat hoa hong" voi
    // "khong tra duoc", vi hai ca nay noi hai cau khac nhau voi user.
    if (info.commissionAmount === 0) {
      console.warn(`[commissionLookup] item ${itemId}: san pham chua bat hoa hong (xac minh tu nguon)`);
    }

    return {
      commissionAmount: Math.round(info.commissionAmount),
      ratePercent: info.ratePercent,
      price: info.price,
      isCapped: info.isCapped,
    };
  }

  /** Mot lan goi API. Tra `null` khi loi truyen tai/sai dinh dang; con so lieu (ke ca commission = 0) thi tra nguyen. */
  private async fetchOnce(
    itemId: string,
    clearCache: boolean,
    timeoutMs: number
  ): Promise<RawProductInfo | null> {
    const url = new URL(this.config.endpoint ?? ADDLIVETAG_DEFAULT_ENDPOINT);
    url.searchParams.set("item_id", itemId);
    if (this.config.baseRatePercent != null) {
      url.searchParams.set("base_rate", String(this.config.baseRatePercent));
    }
    if (this.config.capVnd != null) {
      url.searchParams.set("cap", String(this.config.capVnd));
    }
    if (clearCache) {
      url.searchParams.set("clear_cache", "1");
    }

    const res = await this.fetchImpl(url.toString(), {
      // Key di bang header chu KHONG phai query string - tranh lot vao log may chu trung gian.
      headers: { "X-API-Key": this.config.apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
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
    if (commissionAmount == null) {
      console.warn(`[commissionLookup] item ${itemId}: commission khong phai so (${String(info.commission)})`);
      return null;
    }

    return {
      commissionAmount,
      ratePercent: readFiniteNumber(info.totalRatePercent) ?? 0,
      price: readFiniteNumber(info.price) ?? 0,
      isCapped: info.isCapped === true,
      fromCache: info.dataSource === "db",
    };
  }
}
