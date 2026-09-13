import type { FaqTopic } from "./faqTopics.js";

/**
 * Diem noi de doi nha cung cap LLM (Claude, Gemini...) ma khong dung toi logic nghiep vu.
 * classify() tra ve danh sach topic id KHOP (toi da 2). Mang RONG nghia la "khong biet" - service
 * se im lang + bao admin, TUYET DOI khong doan bua mot chu de gan dung.
 */
export interface FaqClassifier {
  classify(question: string, topics: FaqTopic[]): Promise<string[]>;
}

/** Dung khi FAQ_PROVIDER=off - bot im lang y het hanh vi truoc khi co tinh nang nay. */
export class OffFaqClassifier implements FaqClassifier {
  async classify(): Promise<string[]> {
    return [];
  }
}
