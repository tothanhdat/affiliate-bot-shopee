import type { FaqClassifier } from "../faqClassifier.js";
import { ClaudeFaqClassifier } from "./claudeClassifier.js";

export interface FaqClassifierConfig {
  provider: string;
  apiKey: string;
  model: string;
}

/**
 * Factory theo env.faq.provider - giong pattern createAffiliateProvider().
 * Thieu apiKey thi ROT VE null kem canh bao thay vi throw: bot van chay binh thuong (chi mat FAQ),
 * khong duoc chet ca process chi vi thieu 1 key cua tinh nang phu.
 * **Tra `null` chu KHONG tra mot classifier "rong"** (2026-10-01): truoc do tra OffFaqClassifier
 * voi classify() -> mang rong, ma mang rong lai roi dung vao nhanh "khong nhan ra chu de" cua
 * FaqService -> bot tra "Cau hoi nay ngoai pham vi..." cho MOI tin DM tren moi instance de
 * FAQ_PROVIDER=off (mac dinh!), trai han voi loi hua "bot im lang y het hanh vi truoc khi co tinh
 * nang nay". `null` buoc index.ts khong tao FaqService, va adapter da co san duong im lang khi
 * thieu faqService (co test chan o zaloBot.test.ts). Dung "tien ich hoa" lai thanh classifier rong.
 */
export function createFaqClassifier(config: FaqClassifierConfig): FaqClassifier | null {
  if (config.provider !== "claude") return null;
  if (config.apiKey === "") {
    console.warn("[faq] FAQ_PROVIDER=claude nhung thieu ANTHROPIC_API_KEY - tat FAQ, bot van chay binh thuong.");
    return null;
  }
  return new ClaudeFaqClassifier({ apiKey: config.apiKey, model: config.model });
}
