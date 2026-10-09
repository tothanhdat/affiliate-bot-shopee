/**
 * Tang van chuyen cho API RioHub - KHONG biet gi ve affiliate.
 *
 * Hai quy tac song con, doc ky truoc khi sua:
 *
 * 1. CHI doi ten mien khi loi o TANG KET NOI (DNS/timeout/TLS). `4xx`/`5xx` nghia la he thong DA
 *    nhan duoc request - doi mien cung loi y het va chi ton quota (quy tac cua chinh RioHub).
 * 2. PHAI bat ca loi TLS, khong chi DNS. Su co 29/09/2026: `riohub.vn` phan giai DNS binh thuong
 *    nhung tra chung chi cua `riohub.riokupon.com`, request chet TRUOC khi co HTTP status. Code
 *    chi failover khi "khong phan giai duoc DNS" se KHONG chay du phong trong ca do.
 */

export type RiohubFetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Thu lan luot theo dung thu tu nay (khuyen nghi cua RioHub). */
export const RIOHUB_DEFAULT_BASE_URLS: readonly string[] = [
  "https://riohub.vn/api/v1",
  "https://riohub.riokupon.com/api/v1",
  "https://riohub.riokupon.me/api/v1",
];

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Ma loi tang ket noi -> duoc phep doi ten mien. Nhom TLS BAT BUOC co mat (xem doc dau file);
 * tuy ban libcurl/undici ma loi sai ten mien hien ra duoi ten khac nhau nen liet ke rong.
 */
const CONNECTION_ERROR_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
]);

export function isConnectionLevelError(err: unknown): boolean {
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return true;
  }
  const direct = (err as { code?: unknown } | null)?.code;
  if (typeof direct === "string" && CONNECTION_ERROR_CODES.has(direct)) return true;
  const nested = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof nested === "string" && CONNECTION_ERROR_CODES.has(nested);
}

/** RioHub da nhan request va tu choi - KHONG duoc doi ten mien. */
export class RiohubApiError extends Error {
  constructor(
    readonly code: string,
    readonly apiMessage: string,
    readonly httpStatus: number
  ) {
    super(`RioHub ${httpStatus} ${code}: ${apiMessage}`);
    this.name = "RiohubApiError";
  }
}

/** Khong voi toi duoc BAT KY ten mien nao. */
export class RiohubUnreachableError extends Error {
  constructor(readonly attempts: number, cause?: unknown) {
    super(`RioHub: khong voi toi duoc ${attempts} ten mien`);
    this.name = "RiohubUnreachableError";
    this.cause = cause;
  }
}

export interface RiohubClientConfig {
  apiKey: string;
  /** Rong/khong truyen -> dung RIOHUB_DEFAULT_BASE_URLS. */
  baseUrls?: readonly string[];
  timeoutMs?: number;
  /** Tiem vao de test khong goi mang that - giong AddlivetagCommissionLookup. */
  fetchImpl?: RiohubFetchLike;
}

export class RiohubClient {
  private readonly baseUrls: readonly string[];
  private readonly fetchImpl: RiohubFetchLike;
  /**
   * Ten mien da tra loi duoc gan nhat. Ghim lai de cac request sau khong phai cho timeout o mien
   * dau moi lan - khuyen nghi cua RioHub.
   */
  private pinnedBaseUrl: string | null = null;

  constructor(private readonly config: RiohubClientConfig) {
    this.baseUrls =
      config.baseUrls && config.baseUrls.length > 0 ? config.baseUrls : RIOHUB_DEFAULT_BASE_URLS;
    this.fetchImpl = config.fetchImpl ?? (globalThis.fetch as unknown as RiohubFetchLike);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const order = this.pinnedBaseUrl
      ? [this.pinnedBaseUrl, ...this.baseUrls.filter((b) => b !== this.pinnedBaseUrl)]
      : [...this.baseUrls];

    let lastConnectionError: unknown;

    for (const base of order) {
      let res: Awaited<ReturnType<RiohubFetchLike>>;
      try {
        res = await this.fetchImpl(base + path, {
          method: "POST",
          headers: {
            "X-Riohub-Api-Key": this.config.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
      } catch (err) {
        // Loi KHONG phai tang ket noi (vd bug trong chinh fetchImpl) thi nem thang ra - doi ten
        // mien khong giup gi va con che mat nguyen nhan that.
        if (!isConnectionLevelError(err)) throw err;
        lastConnectionError = err;
        continue;
      }

      // Ghim NGAY khi nhan duoc phan hoi HTTP, ke ca 5xx: tang ket noi toi mien nay da chay duoc,
      // ma ca 3 mien dung chung mot backend nen doi mien khong chua duoc loi ung dung.
      this.pinnedBaseUrl = base;

      const payload = await res.json().catch(() => null);
      if (!res.ok) throw toApiError(payload, res.status);
      return payload as T;
    }

    throw new RiohubUnreachableError(order.length, lastConnectionError);
  }
}

function toApiError(payload: unknown, httpStatus: number): RiohubApiError {
  const error = (payload as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  const code = typeof error?.code === "string" ? error.code : "unknown_error";
  const message = typeof error?.message === "string" ? error.message : "";
  return new RiohubApiError(code, message, httpStatus);
}
