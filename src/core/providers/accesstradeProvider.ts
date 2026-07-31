import { AffiliateApiError, AffiliateApiTimeoutError } from "../errors.js";
import type {
  AffiliateProvider,
  CreateAffiliateLinkInput,
  CreateAffiliateLinkOutput,
} from "../affiliateProvider.js";

export interface AccesstradeProviderConfig {
  apiKey: string;
  apiBase: string;
  endpointPath: string;
  timeoutMs: number;
}

/**
 * QUAN TRONG: endpoint/field response duoi day dua theo tai lieu cong khai cua
 * Accesstrade Product Link Generator API tai thoi diem viet code nay. Truoc khi
 * chay that (sau khi hoan tat T0.1), doi chieu lai voi tai lieu API chinh thuc
 * trong dashboard Accesstrade cua ban - version/field co the da thay doi.
 *
 * Ham parse response co chu y nhieu ten field co the co (short_link / aff_link /
 * shortLink) de giam rui ro vo hieu neu ten field thuc te khac mot chut, nhung
 * neu response hoan toan khac cau truc du kien se nem AffiliateApiError ro rang
 * thay vi crash (dung theo T1.1/T1.5).
 */
export class AccesstradeProvider implements AffiliateProvider {
  constructor(private readonly config: AccesstradeProviderConfig) {}

  async createAffiliateLink(
    input: CreateAffiliateLinkInput
  ): Promise<CreateAffiliateLinkOutput> {
    const endpoint = new URL(this.config.endpointPath, this.config.apiBase);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          url: input.productUrl,
          utm_source: "bot-shopee",
          utm_content: input.subId,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new AffiliateApiTimeoutError();
      }
      throw new AffiliateApiError(`network error: ${(err as Error).message}`, err);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new AffiliateApiError(`HTTP ${response.status}: ${bodyText.slice(0, 300)}`);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      throw new AffiliateApiError("response khong phai JSON hop le", err);
    }

    const affiliateUrl = extractAffiliateUrl(json);
    if (!affiliateUrl) {
      throw new AffiliateApiError(
        `khong tim thay short link trong response: ${JSON.stringify(json).slice(0, 300)}`
      );
    }

    return { affiliateUrl };
  }
}

function extractAffiliateUrl(json: unknown): string | null {
  if (typeof json !== "object" || json === null) return null;
  const root = json as Record<string, unknown>;
  const data =
    typeof root.data === "object" && root.data !== null
      ? (root.data as Record<string, unknown>)
      : root;

  const candidateFields = ["short_link", "shortLink", "aff_link", "affLink", "url"];
  for (const field of candidateFields) {
    const value = data[field];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}
