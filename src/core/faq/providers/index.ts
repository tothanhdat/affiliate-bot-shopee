import { OffFaqClassifier, type FaqClassifier } from "../faqClassifier.js";
import { ClaudeFaqClassifier } from "./claudeClassifier.js";

export interface FaqClassifierConfig {
  provider: string;
  apiKey: string;
  model: string;
}

/**
 * Factory theo env.faq.provider - giong pattern createAffiliateProvider().
 * Thieu apiKey thi ROT VE off kem canh bao thay vi throw: bot van chay binh thuong (chi mat FAQ),
 * khong duoc chet ca process chi vi thieu 1 key cua tinh nang phu.
 */
export function createFaqClassifier(config: FaqClassifierConfig): FaqClassifier {
  if (config.provider !== "claude") return new OffFaqClassifier();
  if (config.apiKey === "") {
    console.warn("[faq] FAQ_PROVIDER=claude nhung thieu ANTHROPIC_API_KEY - tat FAQ, bot van chay binh thuong.");
    return new OffFaqClassifier();
  }
  return new ClaudeFaqClassifier({ apiKey: config.apiKey, model: config.model });
}
