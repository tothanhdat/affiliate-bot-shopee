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

test("resolve: classifier throw (API loi) -> xu ly y het 'khong biet', khong nem ra ngoai, KHONG khoa thread", async () => {
  const { service, ledgerStore, adminMessages, input, cleanup } = setup(
    fakeClassifier(new Error("API 500"))
  );
  try {
    const answer = await service.resolve(input);
    assert.equal(answer, FAQ_OUT_OF_SCOPE_REPLY_DEFAULT);
    assert.equal(adminMessages.length, 1);
    assert.equal(ledgerStore.isFaqThreadMuted("zalo", "user-1", Date.now()), false);
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
