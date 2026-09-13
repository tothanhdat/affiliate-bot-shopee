import Anthropic from "@anthropic-ai/sdk";
import type { FaqClassifier } from "../faqClassifier.js";
import type { FaqTopic } from "../faqTopics.js";

/** Toi da 2 chu de cho 1 cau hoi - nhieu hon la dau hieu model doc vet danh sach, xem parseTopicIds. */
const MAX_TOPICS = 2;

export function buildClassifierSystemPrompt(topics: FaqTopic[]): string {
  const list = topics.map((t) => `- ${t.id}: ${t.description}`).join("\n");
  return (
    `Bạn phân loại câu hỏi của khách hàng vào các chủ đề dưới đây.\n\n` +
    `Chủ đề:\n${list}\n\n` +
    `Quy tắc:\n` +
    `- CHỈ trả về id chủ đề, cách nhau bằng dấu phẩy. Không viết câu trả lời, không giải thích.\n` +
    `- Tối đa ${MAX_TOPICS} id. Nếu câu hỏi hỏi nhiều hơn ${MAX_TOPICS} thứ, chọn ${MAX_TOPICS} ý chính nhất.\n` +
    `- Nếu câu hỏi không khớp rõ ràng chủ đề nào, trả về đúng chữ KHONG_BIET. ` +
    `Thà không biết còn hơn đoán sai — người thật sẽ vào trả lời thay bạn.\n` +
    `- Câu hỏi về đơn hàng, số dư, hoặc tình trạng cụ thể của cá nhân người này ` +
    `(ví dụ "đơn hôm qua của tôi đâu", "sao tôi chưa nhận được tiền") LUÔN trả về KHONG_BIET, ` +
    `vì bạn không có dữ liệu của họ.`
  );
}

/**
 * Chi chap nhan id CO THAT trong danh sach chu de - model tra ve gi khac deu bi bo qua, nen khong
 * co duong nao de model bia ra mot chu de moi. Qua MAX_TOPICS id thi coi nhu model doc vet ca danh
 * sach thay vi chon, tra rong (im lang + bao admin) thay vi doan 2 chu de dau tien.
 */
export function parseTopicIds(raw: string, topics: FaqTopic[]): string[] {
  const valid = new Set(topics.map((t) => t.id));
  const found: string[] = [];
  for (const match of raw.matchAll(/[a-z0-9_]+/g)) {
    const token = match[0];
    if (valid.has(token) && !found.includes(token)) found.push(token);
  }
  return found.length <= MAX_TOPICS ? found : [];
}

export interface ClaudeFaqClassifierOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

/**
 * Goi Claude de PHAN LOAI cau hoi, KHONG de sinh cau tra loi - text gui user luon la chuoi admin
 * soan san (xem faqService.answerFor). Day la ly do bot khong the bia thong tin ve tien.
 */
export class ClaudeFaqClassifier implements FaqClassifier {
  private readonly client: Anthropic;

  constructor(private readonly options: ClaudeFaqClassifierOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      timeout: options.timeoutMs ?? 10_000,
    });
  }

  async classify(question: string, topics: FaqTopic[]): Promise<string[]> {
    const response = await this.client.messages.create({
      model: this.options.model,
      max_tokens: 64,
      system: buildClassifierSystemPrompt(topics),
      // Cau hoi cua user di trong messages, KHONG nhet vao system - giu ranh gioi prompt injection.
      messages: [{ role: "user", content: question }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join(" ");

    return parseTopicIds(text, topics);
  }
}
