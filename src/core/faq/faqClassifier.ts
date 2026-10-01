import type { FaqTopic } from "./faqTopics.js";

/**
 * Diem noi de doi nha cung cap LLM (Claude, Gemini...) ma khong dung toi logic nghiep vu.
 * classify() tra ve danh sach topic id KHOP (toi da 2), TUYET DOI khong doan bua mot chu de gan dung.
 * Mang RONG nghia la "da doc cau hoi nhung khong khop chu de nao" -> FaqService gui cau "ngoai pham
 * vi" + bao admin (KHONG phai im lang - doc comment cu noi "im lang" da sai tu 2026-09-13).
 * **Khong doc duoc cau hoi thi phai THROW**, dung tra mang rong: 2 tinh huong nay duoc xu ly khac
 * nhau han (throw -> im lang voi khach + bao admin kem ly do, xem faqService.ts). Vi vay cung
 * KHONG con class "off" nao implement interface nay - FAQ tat thi createFaqClassifier tra `null`
 * va FaqService khong duoc tao.
 */
export interface FaqClassifier {
  classify(question: string, topics: FaqTopic[]): Promise<string[]>;
}
