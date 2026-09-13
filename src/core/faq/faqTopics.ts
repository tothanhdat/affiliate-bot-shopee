/**
 * Bo chu de FAQ bot tu tra loi trong Zalo DM (2026-09-13).
 *
 * `description` KHONG gui cho user - day la text LLM doc de phan loai cau hoi.
 * `defaultAnswer` la text gui cho user khi admin chua tuy chinh; admin sua lai qua /admin/settings
 * (key `faq_answer_<id>`, xem settingsRegistry.ts) - noi dung sua se GHI DE defaultAnswer.
 *
 * Them chu de moi = them 1 entry o day; form /admin/settings tu sinh them 1 o textarea tuong ung.
 */
export interface FaqTopic {
  /** Chi dung [a-z0-9_] - parseTopicIds() do id trong text model tra ve bang regex nay. */
  id: string;
  /** Nhan hien thi tren form /admin/settings. */
  label: string;
  /** Mo ta cho LLM phan loai - viet theo kieu "user hoi ve X, Y, Z". */
  description: string;
  defaultAnswer: string;
}

/** Placeholder duoc phep dung trong defaultAnswer/cau tra loi admin sua - xem faqService.answerFor(). */
export const FAQ_ANSWER_PLACEHOLDERS = [
  "userSharePercent",
  "botSharePercent",
  "withdrawalThreshold",
  "dashboardUrl",
];

/** So phut khoa FAQ mac dinh sau khi admin go tay trong thread (admin doi duoc tren /admin/settings). */
export const FAQ_MUTE_MINUTES_DEFAULT = 30;

export const FAQ_TOPICS: FaqTopic[] = [
  {
    id: "co_che_hoan_tien",
    label: "Cơ chế hoàn tiền",
    description:
      "User hoi hoan tien la gi, bot hoat dong the nao, tai sao lai duoc tien, co that khong, co mat phi khong",
    defaultAnswer:
      `Dạ để em giải thích nhanh nha 😊\n\n` +
      `Khi bạn mua hàng qua link em gửi, sàn (Shopee/TikTok Shop) trả cho em một khoản hoa hồng tiếp thị. ` +
      `Em chia lại cho bạn {{userSharePercent}}% khoản đó, em giữ {{botSharePercent}}% để vận hành.\n\n` +
      `Các bước rất đơn giản:\n` +
      `1️⃣ Bạn gửi link sản phẩm cho em\n` +
      `2️⃣ Em gửi lại link đã gắn mã hoàn tiền\n` +
      `3️⃣ Bạn mở link đó và đặt hàng ngay trong phiên\n` +
      `4️⃣ Đơn được sàn xác nhận là tiền vào số dư của bạn\n\n` +
      `Bạn không mất thêm đồng nào cả, giá vẫn y như bạn mua bình thường nha!`,
  },
  {
    id: "ty_le_hoa_hong",
    label: "Tỉ lệ hoa hồng",
    description:
      "User hoi duoc bao nhieu phan tram, chia the nao, tinh ra sao, sao tien it hon minh nghi, tru nhung gi",
    defaultAnswer:
      `Bạn nhận {{userSharePercent}}% hoa hồng mỗi đơn nha 💰\n\n` +
      `Cách tính: hoa hồng sàn trả → trừ 10% thuế → trừ 1% phí sàn → phần còn lại bạn nhận {{userSharePercent}}%, em giữ {{botSharePercent}}%.\n\n` +
      `Ví dụ hoa hồng gốc 10.000đ: trừ thuế còn 9.000đ, trừ phí sàn còn 8.910đ, bạn nhận {{userSharePercent}}% của 8.910đ.\n\n` +
      `Tỉ lệ hoa hồng gốc cao hay thấp là do từng sản phẩm và từng shop quy định, không phải em đặt nha.`,
  },
  {
    id: "khi_nao_nhan_tien",
    label: "Khi nào nhận được tiền",
    description:
      "User hoi bao lau thi co tien, don khi nao duoc xac nhan, sao doi lau qua, khi nao tien vao",
    defaultAnswer:
      `Đơn cần thời gian để sàn xác nhận, thường vài ngày đến vài tuần tuỳ sàn và tuỳ đơn ạ ⏳\n\n` +
      `Lý do là sàn phải đợi bạn nhận hàng xong và hết hạn đổi trả mới chốt hoa hồng.\n\n` +
      `Bạn không cần hỏi lại đâu nha — cứ có đơn được xác nhận là em tự nhắn báo bạn liền 🔔`,
  },
  {
    id: "xem_so_du",
    label: "Xem số dư / dashboard",
    description:
      "User hoi xem tien cua minh o dau, dashboard la gi, lam sao biet co bao nhieu don, mat link roi lay lai sao",
    defaultAnswer:
      `Bạn xem ở dashboard riêng của mình nha 📊\n\n` +
      `{{dashboardUrl}}\n\n` +
      `Ở đó có đầy đủ từng đơn, số dư khả dụng và lịch sử rút tiền. Link này cố định, lưu lại xài hoài được.\n\n` +
      `Lỡ mất link thì nhắn "xemhh" cho em là em gửi lại ngay!`,
  },
  {
    id: "cach_rut_tien",
    label: "Cách rút tiền",
    description:
      "User hoi rut tien the nao, toi thieu bao nhieu, rut ve dau, bao lau nhan duoc tien, rut mot phan duoc khong",
    defaultAnswer:
      `Rút tiền dễ lắm nha 💸\n\n` +
      `Khi số dư khả dụng đạt từ {{withdrawalThreshold}} trở lên, dashboard sẽ hiện nút yêu cầu rút:\n` +
      `{{dashboardUrl}}\n\n` +
      `Vài lưu ý:\n` +
      `• Mỗi lần rút là rút TOÀN BỘ số dư khả dụng, chưa hỗ trợ rút một phần\n` +
      `• Bạn điền ngân hàng / số tài khoản / tên chủ tài khoản\n` +
      `• Admin sẽ nhắn riêng xác nhận lại với bạn trước khi chuyển khoản thật`,
  },
  {
    id: "cach_dung_bot",
    label: "Cách dùng bot",
    description:
      "User hoi dung bot the nao, gui link o dau, gui gi cho bot, copy link kieu nao, dung trong group hay nhan rieng",
    defaultAnswer:
      `Đơn giản lắm ạ 🥳\n\n` +
      `Bạn copy link sản phẩm trên Shopee hoặc TikTok Shop rồi gửi cho em — gửi trong group hoặc nhắn riêng cho em đều được nha (nhắn riêng nếu bạn không muốn người khác thấy mình mua gì 😉).\n\n` +
      `Em sẽ gửi lại link đã gắn mã hoàn tiền. Bạn mở đúng link đó và đặt hàng luôn trong phiên là xong!\n\n` +
      `⚠️ Quan trọng: đừng xem video/livestream xen giữa lúc mở link và lúc đặt hàng, đơn sẽ không được ghi nhận đó.`,
  },
  {
    id: "don_khong_ghi_nhan",
    label: "Đơn không được ghi nhận",
    description:
      "User hoi mua roi ma khong thay don, don bi mat, bam link roi ma khong duoc tinh, sao khong co hoa hong",
    defaultAnswer:
      `Bạn kiểm tra giúp em mấy điểm này nha 🔍\n\n` +
      `• Có mở đúng link em gửi và đặt hàng ngay trong phiên đó không?\n` +
      `• Có lỡ xem video hoặc livestream xen giữa không? Đây là lý do phổ biến nhất khiến đơn không được ghi nhận\n` +
      `• Đơn mới đặt thường cần vài ngày mới hiện, không lên ngay đâu ạ\n\n` +
      `Nếu chắc chắn đã làm đúng mà vẫn không thấy, bạn nhắn em kèm mã đơn để em kiểm tra giúp nha!`,
  },
  {
    id: "san_ho_tro",
    label: "Sàn được hỗ trợ",
    description:
      "User hoi san nao duoc ho tro, co Lazada/Tiki/Dien May Xanh khong, mua o dau thi duoc tinh tien",
    defaultAnswer:
      `Hiện em hỗ trợ **Shopee** và **TikTok Shop** ạ 🛒\n\n` +
      `Các sàn khác em chưa hỗ trợ, bạn gửi link vào em sẽ báo không nhận diện được nha.\n\n` +
      `Có thêm sàn mới em sẽ báo trong group liền!`,
  },
];
