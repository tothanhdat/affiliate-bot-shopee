import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../../ledgerStore.js";
import { RateLimiter } from "../../rateLimiter.js";
import { FaqService } from "../faqService.js";
import { FAQ_TOPICS, FAQ_OUT_OF_SCOPE_REPLY_DEFAULT } from "../faqTopics.js";
import { SETTINGS_KEYS, faqAnswerKey } from "../../settingsKeys.js";
import type { FaqClassifier } from "../faqClassifier.js";

/** Classifier gia - tra ve ket qua dinh san hoac throw, de test moi nhanh ma khong goi API that. */
function fakeClassifier(result: string[] | Error): FaqClassifier {
  return {
    classify: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

function setup(classifier: FaqClassifier) {
  const ledgerStore = new LedgerStore(":memory:");
  const rateLimiter = new RateLimiter(5, 600_000);
  const adminMessages: string[] = [];
  const service = new FaqService({
    classifier,
    store: ledgerStore,
    rateLimiter,
    notifyAdmin: async (message: string) => {
      adminMessages.push(message);
    },
    defaultUserSharePercent: 90,
    defaultWithdrawalThresholdVnd: 20_000,
  });
  const input = {
    platform: "zalo",
    userId: "user-1",
    threadId: "user-1",
    question: "hoàn tiền như thế nào vậy ad",
    userDisplayName: "Nguyen Van A",
    dashboardUrl: "http://localhost:3002/d/token-abc",
  };
  return {
    service,
    ledgerStore,
    adminMessages,
    input,
    cleanup: () => {
      rateLimiter.stop();
      ledgerStore.close();
    },
  };
}

test("resolve: khop 1 chu de -> tra dung cau tra loi cua chu de do", async () => {
  const { service, input, cleanup } = setup(fakeClassifier(["san_ho_tro"]));
  try {
    const answer = await service.resolve(input);
    const topic = FAQ_TOPICS.find((t) => t.id === "san_ho_tro");
    assert.equal(answer, topic?.defaultAnswer);
  } finally {
    cleanup();
  }
});

test("resolve: admin sua cau tra loi tren /admin/settings -> gui ban da sua", async () => {
  const { service, ledgerStore, input, cleanup } = setup(fakeClassifier(["san_ho_tro"]));
  try {
    ledgerStore.setSetting(faqAnswerKey("san_ho_tro"), "Chỉ Shopee thôi nha");
    assert.equal(await service.resolve(input), "Chỉ Shopee thôi nha");
  } finally {
    cleanup();
  }
});

test("resolve: placeholder duoc render (khong con {{...}} trong tin gui user)", async () => {
  const { service, ledgerStore, input, cleanup } = setup(fakeClassifier(["ty_le_hoa_hong"]));
  try {
    ledgerStore.setSetting(
      faqAnswerKey("ty_le_hoa_hong"),
      "Bạn nhận {{userSharePercent}}%, em giữ {{botSharePercent}}%. Rút từ {{withdrawalThreshold}}. Xem: {{dashboardUrl}}"
    );
    const answer = await service.resolve(input);
    assert.equal(
      answer,
      "Bạn nhận 90%, em giữ 10%. Rút từ 20.000đ. Xem: http://localhost:3002/d/token-abc"
    );
  } finally {
    cleanup();
  }
});

test("resolve: % lay tu settings hien hanh, khong phai gia tri env luc khoi dong", async () => {
  const { service, ledgerStore, input, cleanup } = setup(fakeClassifier(["ty_le_hoa_hong"]));
  try {
    ledgerStore.setSetting("commission_user_share_percent", "80");
    ledgerStore.setSetting(faqAnswerKey("ty_le_hoa_hong"), "{{userSharePercent}}/{{botSharePercent}}");
    assert.equal(await service.resolve(input), "80/20");
  } finally {
    cleanup();
  }
});

test("resolve: khop 2 chu de -> ghep 2 cau tra loi bang dong trong", async () => {
  const { service, ledgerStore, input, cleanup } = setup(
    fakeClassifier(["san_ho_tro", "cach_rut_tien"])
  );
  try {
    ledgerStore.setSetting(faqAnswerKey("san_ho_tro"), "A");
    ledgerStore.setSetting(faqAnswerKey("cach_rut_tien"), "B");
    assert.equal(await service.resolve(input), "A\n\nB");
  } finally {
    cleanup();
  }
});

// 2026-09-13: KHONG duoc tu khoa thread chi vi khong nhan ra 1 cau hoi - se lam im ca cau FAQ hop
// le hoi NGAY SAU DO, dung khi admin chua he can thiep gi. Khoa thread CHI xay ra khi admin THAT SU
// go tay (muteByAdminTyping) hoac go lenh /im (muteByAdminCommand).
//
// 2026-09-13 (sau, theo yeu cau truc tiep cua user): thay vi im lang hoan toan, bot tra loi 1 cau
// co dinh bao user cho admin - tranh cam giac bot "khong phan hoi gi ca" nhu bi loi. Cau nay VAN
// khong ap dung khi thread dang bi khoa (admin dang go tay / lenh /im) - da tu dong dung nho thu tu
// check isFaqThreadMuted() luon chay TRUOC buoc classify trong resolve(), xem test rieng ben duoi.
test("resolve: khong biet -> tra loi cau co dinh bao doi admin, VAN bao admin, KHONG khoa thread", async () => {
  const { service, ledgerStore, adminMessages, input, cleanup } = setup(fakeClassifier([]));
  try {
    const answer = await service.resolve(input);
    assert.equal(answer, FAQ_OUT_OF_SCOPE_REPLY_DEFAULT);
    assert.equal(adminMessages.length, 1);
    assert.match(adminMessages[0], /hoàn tiền như thế nào vậy ad/);
    assert.equal(ledgerStore.isFaqThreadMuted("zalo", "user-1", Date.now()), false);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 2026-10-01 (yeu cau truc tiep cua user): classifier LOI (het han muc API / 500 / mang / 401 key
// het han) KHAC HAN "classifier chay xong va khong khop chu de nao". Truoc do 2 nhanh nay bi gop:
// API sap thi MOI cau hoi deu nhan "Cau hoi nay ngoai pham vi..." du bot chua he doc duoc cau hoi,
// tuc la noi SAI voi khach. Gio loi -> IM LANG voi khach + bao admin kem ly do de admin tra loi tay.
// ---------------------------------------------------------------------------

test("resolve: classifier throw (API loi) -> IM LANG voi khach, KHONG gui cau ngoai pham vi", async () => {
  const { service, ledgerStore, adminMessages, input, cleanup } = setup(
    fakeClassifier(new Error("API 500"))
  );
  try {
    const answer = await service.resolve(input);
    assert.equal(answer, null, "loi API thi khong duoc noi gi voi khach");
    assert.notEqual(answer, FAQ_OUT_OF_SCOPE_REPLY_DEFAULT);
    assert.equal(adminMessages.length, 1, "van phai bao admin - khach dang cho tra loi tay");
    assert.equal(ledgerStore.isFaqThreadMuted("zalo", "user-1", Date.now()), false);
  } finally {
    cleanup();
  }
});

test("resolve: tin bao admin khi classifier loi phai NOI RO la loi he thong, kem ly do", async () => {
  const { service, adminMessages, input, cleanup } = setup(
    fakeClassifier(new Error("429 rate_limit_error"))
  );
  try {
    await service.resolve(input);

    const message = adminMessages[0];
    assert.match(message, /429 rate_limit_error/, "phai kem ly do that de admin biet dang bi gi");
    assert.match(message, /hoàn tiền như thế nào vậy ad/, "phai kem cau hoi de admin tra loi tay");
    // Phan biet voi tin "cau hoi khong hieu": admin doc 1 dong phai biet day la bot LOI, khong
    // phai khach hoi cau la - 2 viec can 2 hanh dong khac nhau (sua API vs soan cau tra loi moi).
    assert.ok(!message.includes("không hiểu"), "khong duoc dung chung cau voi nhanh 'khong hieu'");
  } finally {
    cleanup();
  }
});

test("resolve: classifier chay xong + mang RONG -> VAN gui cau ngoai pham vi (khong tron 2 nhanh)", async () => {
  const { service, adminMessages, input, cleanup } = setup(fakeClassifier([]));
  try {
    assert.equal(await service.resolve(input), FAQ_OUT_OF_SCOPE_REPLY_DEFAULT);
    assert.match(adminMessages[0], /không hiểu/, "nhanh nay van dung tin 'cau hoi khong hieu' cu");
  } finally {
    cleanup();
  }
});

test("resolve: admin sua cau tra loi ngoai pham vi tren /admin/settings -> gui ban da sua", async () => {
  const { service, ledgerStore, input, cleanup } = setup(fakeClassifier([]));
  try {
    ledgerStore.setSetting(SETTINGS_KEYS.faqOutOfScopeReply, "Chờ admin xíu nha");
    assert.equal(await service.resolve(input), "Chờ admin xíu nha");
  } finally {
    cleanup();
  }
});

// Tai hien dung kich ban bug that (bao cao 2026-09-13): cau hoi ngoai kich ban truoc do KHONG
// duoc lam im cau hoi FAQ hop le hoi NGAY SAU - admin chua he go tay, nen bot van phai tra loi.
test("resolve: sau 1 cau khong nhan ra, cau FAQ hop le tiep theo VAN duoc tra loi (khong bi khoa lay)", async () => {
  const { service, ledgerStore, input, cleanup } = setup({
    classify: async (question: string) => (question.includes("sàn nào") ? ["san_ho_tro"] : []),
  });
  try {
    assert.equal(
      await service.resolve({ ...input, question: "câu gì đó lạ hoắc" }),
      FAQ_OUT_OF_SCOPE_REPLY_DEFAULT
    );
    const answer = await service.resolve({ ...input, question: "bot hỗ trợ sàn nào" });
    const topic = FAQ_TOPICS.find((t) => t.id === "san_ho_tro");
    assert.equal(answer, topic?.defaultAnswer);
  } finally {
    cleanup();
  }
});

// Yeu cau truc tiep cua user: cau tra loi co dinh nay KHONG ap dung khi thread dang bi khoa (admin
// dang go tay / lenh /im) - resolve() phai IM LANG (null) dung nhu truoc gio, khong phai gui cau
// "doi admin" lan 2. Dung nho isFaqThreadMuted() la buoc kiem tra DAU TIEN trong resolve(), truoc
// ca buoc goi classifier.
test("resolve: thread dang bi khoa -> IM LANG (khong gui cau cho doi admin), du cau hoi ngoai pham vi", async () => {
  const { service, ledgerStore, input, cleanup } = setup(fakeClassifier([]));
  try {
    ledgerStore.muteFaqThread("zalo", "user-1", null, "admin_command");
    assert.equal(await service.resolve(input), null);
  } finally {
    cleanup();
  }
});

test("resolve: thread dang khoa -> im lang, KHONG goi classifier", async () => {
  let called = 0;
  const classifier: FaqClassifier = {
    classify: async () => {
      called += 1;
      return ["san_ho_tro"];
    },
  };
  const { service, ledgerStore, input, cleanup } = setup(classifier);
  try {
    ledgerStore.muteFaqThread("zalo", "user-1", null, "admin_command");
    assert.equal(await service.resolve(input), null);
    assert.equal(called, 0);
  } finally {
    cleanup();
  }
});

test("resolve: qua rate limit -> im lang, khong goi classifier them", async () => {
  let called = 0;
  const classifier: FaqClassifier = {
    classify: async () => {
      called += 1;
      return ["san_ho_tro"];
    },
  };
  const { service, input, cleanup } = setup(classifier);
  try {
    for (let i = 0; i < 5; i += 1) {
      assert.notEqual(await service.resolve(input), null);
    }
    assert.equal(await service.resolve(input), null);
    assert.equal(called, 5);
  } finally {
    cleanup();
  }
});

test("muteByAdminTyping: khoa theo so phut trong settings", async () => {
  const { service, ledgerStore, cleanup } = setup(fakeClassifier([]));
  try {
    ledgerStore.setSetting("faq_mute_minutes", "10");
    service.muteByAdminTyping("zalo", "user-1");
    assert.equal(ledgerStore.isFaqThreadMuted("zalo", "user-1", Date.now() + 9 * 60_000), true);
    assert.equal(ledgerStore.isFaqThreadMuted("zalo", "user-1", Date.now() + 11 * 60_000), false);
  } finally {
    cleanup();
  }
});

test("muteByAdminCommand (/im) khoa vo thoi han, unmute (/noi) mo lai", async () => {
  const { service, ledgerStore, cleanup } = setup(fakeClassifier([]));
  try {
    service.muteByAdminCommand("zalo", "user-1");
    assert.equal(ledgerStore.isFaqThreadMuted("zalo", "user-1", Date.now() + 365 * 24 * 3600_000), true);
    service.unmute("zalo", "user-1");
    assert.equal(ledgerStore.isFaqThreadMuted("zalo", "user-1", Date.now()), false);
  } finally {
    cleanup();
  }
});

test("notifyAdmin that bai -> khong lam hong resolve (best-effort)", async () => {
  const ledgerStore = new LedgerStore(":memory:");
  const rateLimiter = new RateLimiter(5, 600_000);
  try {
    const service = new FaqService({
      classifier: fakeClassifier([]),
      store: ledgerStore,
      rateLimiter,
      notifyAdmin: async () => {
        throw new Error("Telegram 429");
      },
      defaultUserSharePercent: 90,
      defaultWithdrawalThresholdVnd: 20_000,
    });
    assert.equal(
      await service.resolve({
        platform: "zalo",
        userId: "user-1",
        threadId: "user-1",
        question: "abc",
        userDisplayName: "A",
        dashboardUrl: "http://x/d/t",
      }),
      FAQ_OUT_OF_SCOPE_REPLY_DEFAULT
    );
  } finally {
    rateLimiter.stop();
    ledgerStore.close();
  }
});

// ---------------------------------------------------------------------------
// 2026-10-01 (bug that tren instance "sanhoantien"): khach CHAP NHAN loi moi ket ban -> Zalo day
// vao thread DM mot tin nhan NOI DUNG RONG. Bot coi do la cau hoi, goi classifier voi chuoi rong,
// Anthropic tra 400 "user messages must have non-empty content" -> nhanh catch coi nhu "khong nhan
// ra chu de" -> bot gui "Cau hoi nay ngoai pham vi..." cho mot nguoi chua he hoi gi.
// Chuoi rong KHONG PHAI cau hoi: phai im lang truoc ca buoc goi classifier.
// ---------------------------------------------------------------------------

test("FAQ: cau hoi rong -> IM LANG, khong goi classifier, khong bao admin", async () => {
  let classifyCalls = 0;
  const classifier: FaqClassifier = {
    classify: async () => {
      classifyCalls += 1;
      return [];
    },
  };
  const { service, input, adminMessages, cleanup } = setup(classifier);
  try {
    assert.equal(await service.resolve({ ...input, question: "" }), null);
    assert.equal(classifyCalls, 0, "khong duoc ton 1 luot goi API cho chuoi rong");
    assert.equal(adminMessages.length, 0, "khong phai cau hoi thi khong bao admin");
  } finally {
    cleanup();
  }
});

test("FAQ: cau hoi chi co khoang trang/xuong dong -> IM LANG", async () => {
  const { service, input, adminMessages, cleanup } = setup(fakeClassifier([]));
  try {
    assert.equal(await service.resolve({ ...input, question: "   \n  " }), null);
    assert.equal(adminMessages.length, 0);
  } finally {
    cleanup();
  }
});
