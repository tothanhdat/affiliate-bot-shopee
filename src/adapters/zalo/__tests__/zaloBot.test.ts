import { test } from "node:test";
import assert from "node:assert/strict";
import { ThreadType, type API, type Message } from "zca-js";
import { ZaloGroupBot } from "../bot.js";
import { LedgerStore } from "../../../core/ledgerStore.js";
import { LogStore } from "../../../core/logStore.js";
import { LinkResolverService } from "../../../core/linkResolverService.js";
import { RateLimiter } from "../../../core/rateLimiter.js";
import { MockAffiliateProvider } from "../../../core/providers/mockProvider.js";
import { FaqService } from "../../../core/faq/faqService.js";
import { faqAnswerKey } from "../../../core/settingsKeys.js";

const PRODUCT_URL = "https://shopee.vn/giay-cau-long-i.123.456";

interface SentMessage {
  payload: string | { msg: string; mentions?: unknown[] };
  threadId: string;
  type: ThreadType;
}

/**
 * api gia - handleMessage chi dung sendMessage (getOwnId chi can cho group_event, khong dung o day).
 * Khong the dung zca-js that trong test: no mo websocket toi Zalo va can session dang nhap.
 */
function setup() {
  const sent: SentMessage[] = [];
  const groupInfoCalls: string[] = [];
  // Ten group gia lap tra ve boi getGroupInfo - test ghi vao day de kiem soat ket qua.
  const groupNames = new Map<string, string>([["group-1", "Group Hoàn Tiền"]]);
  let allGroupIds: string[] = [];
  const api = {
    sendMessage: async (payload: SentMessage["payload"], threadId: string, type: ThreadType) => {
      sent.push({ payload, threadId, type });
      return {};
    },
    getAllGroups: async () => ({
      version: "1",
      gridVerMap: Object.fromEntries(allGroupIds.map((id) => [id, "1"])),
    }),
    getGroupInfo: async (groupId: string | string[]) => {
      const ids = Array.isArray(groupId) ? groupId : [groupId];
      groupInfoCalls.push(...ids);
      return {
        removedsGroup: [],
        unchangedsGroup: [],
        gridInfoMap: Object.fromEntries(ids.map((id) => [id, { name: groupNames.get(id) ?? "" }])),
      };
    },
  } as unknown as API;

  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  const rateLimiter = new RateLimiter(100, 60_000);
  const resolver = new LinkResolverService(new MockAffiliateProvider(), logStore, rateLimiter);
  const bot = new ZaloGroupBot(resolver, {
    sessionPath: "/tmp/khong-dung-toi.json",
    qrPath: "/tmp/khong-dung-toi.png",
    maxLinksPerMessage: 3,
    promotionsLimit: 0,
    ledgerStore,
    dashboardBaseUrl: "http://localhost:3002",
    commissionUserSharePercent: 90,
    withdrawalThresholdVnd: 50_000,
  });

  // handleMessage la private (chi duoc goi tu listener that) - test goi truc tiep qua cast de
  // kiem tra duoc logic dinh tuyen DM/group ma khong phai mo ket noi Zalo.
  const handleMessage = (message: Message): Promise<void> =>
    (bot as unknown as { handleMessage(api: API, message: Message): Promise<void> }).handleMessage(api, message);

  function cleanup() {
    rateLimiter.stop();
    faqRateLimiter.stop();
    logStore.close();
    ledgerStore.close();
  }

  const syncKnownGroups = (): Promise<void> =>
    (bot as unknown as { syncKnownGroups(api: API): Promise<void> }).syncKnownGroups(api);

  /** Gia lap trang thai "da dang nhap" de goi duoc sendGroupMessage ma khong mo ket noi that. */
  const setLoggedIn = () => {
    (bot as unknown as { api: API | null }).api = api;
  };

  // RateLimiter da duoc import san o dau file nay (dung cho LinkResolverService).
  const faqRateLimiter = new RateLimiter(100, 60_000);
  /** Gan FaqService vao bot sau khi tao (giong index.ts) - truyen ham classify gia de khoi goi API. */
  const attachFaq = (classify: (question: string) => Promise<string[]>) => {
    (bot as unknown as { options: { faqService?: FaqService } }).options.faqService = new FaqService({
      classifier: { classify: (question: string) => classify(question) },
      store: ledgerStore,
      rateLimiter: faqRateLimiter,
      notifyAdmin: async () => {},
      defaultUserSharePercent: 90,
      defaultWithdrawalThresholdVnd: 20_000,
    });
  };

  return {
    api,
    sent,
    ledgerStore,
    handleMessage,
    attachFaq,
    bot,
    groupInfoCalls,
    groupNames,
    setAllGroupIds: (ids: string[]) => {
      allGroupIds = ids;
    },
    syncKnownGroups,
    setLoggedIn,
    cleanup,
  };
}

function makeMessage(type: ThreadType, text: string, uid = "user-1"): Message {
  return {
    type,
    threadId: type === ThreadType.User ? uid : "group-1",
    isSelf: false,
    data: { uidFrom: uid, dName: "Nguyen Van A", content: text },
  } as unknown as Message;
}

/** Tin do CHINH tai khoan bot gui ra (admin go tay hoac bot tu gui) - zca-js emit khi selfListen=true. */
function makeSelfMessage(text: string, msgId: string, threadId = "user-1"): Message {
  return {
    type: ThreadType.User,
    threadId,
    isSelf: true,
    data: { uidFrom: "bot-uid", dName: "Admin", content: text, msgId },
  } as unknown as Message;
}

function bodyOf(sent: SentMessage): string {
  return typeof sent.payload === "string" ? sent.payload : sent.payload.msg;
}

// Tinh nang 2026-09-10 (feedback that tu user: ngai gui link trong group vi so nguoi khac biet minh
// mua gi): DM gui link san pham cung duoc tra link hoan tien y het trong group.
test("Zalo DM: gui link san pham -> tra link affiliate (khong kem mention)", async () => {
  const { sent, ledgerStore, handleMessage, cleanup } = setup();
  try {
    // Da chao mung tu truoc -> tin duy nhat gui ra phai la reply link, khong lan voi DM chao mung.
    ledgerStore.tryClaimWelcomeMessage("zalo", "user-1");

    await handleMessage(makeMessage(ThreadType.User, PRODUCT_URL));

    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, ThreadType.User);
    assert.equal(sent[0].threadId, "user-1");
    // Trong DM khong tag @ten (mention chi co y nghia trong group) -> payload la string thuan.
    assert.equal(typeof sent[0].payload, "string");
    assert.match(bodyOf(sent[0]), /https:\/\/mock-aff\.local\//);
  } finally {
    cleanup();
  }
});

test("Zalo DM: link DAU TIEN cua user -> gui DM chao mung truoc roi moi tra link", async () => {
  const { sent, handleMessage, cleanup } = setup();
  try {
    await handleMessage(makeMessage(ThreadType.User, PRODUCT_URL));

    assert.equal(sent.length, 2);
    assert.match(bodyOf(sent[0]), /hoàn tiền|hoa hồng/i);
    assert.match(bodyOf(sent[1]), /https:\/\/mock-aff\.local\//);
  } finally {
    cleanup();
  }
});

test("Zalo DM: tin nhan khong co link va khong phai 'xemhh' -> IM LANG hoan toan", async () => {
  const { sent, handleMessage, cleanup } = setup();
  try {
    await handleMessage(makeMessage(ThreadType.User, "hi shop oi cho hoi"));
    await handleMessage(makeMessage(ThreadType.User, "https://google.com/abc"));

    assert.equal(sent.length, 0);
  } finally {
    cleanup();
  }
});

test("Zalo DM: 'xemhh' van tra link dashboard nhu cu", async () => {
  const { sent, handleMessage, cleanup } = setup();
  try {
    await handleMessage(makeMessage(ThreadType.User, "xemhh"));

    assert.equal(sent.length, 1);
    assert.match(bodyOf(sent[0]), /\/d\//);
  } finally {
    cleanup();
  }
});

test("Zalo group: link trong group van reply kem mention @ten nhu cu", async () => {
  const { sent, ledgerStore, handleMessage, cleanup } = setup();
  try {
    ledgerStore.tryClaimWelcomeMessage("zalo", "user-1");

    await handleMessage(makeMessage(ThreadType.Group, PRODUCT_URL));

    assert.equal(sent.length, 1);
    assert.equal(typeof sent[0].payload, "object");
    assert.match(bodyOf(sent[0]), /^@Nguyen Van A /);
    assert.match(bodyOf(sent[0]), /https:\/\/mock-aff\.local\//);
  } finally {
    cleanup();
  }
});

// 2026-09-11: bot tu ghi nhan danh sach group dang o (bang zalo_groups) de admin tick tren
// /admin/settings group nao nhan thong bao sau moi lan import bao cao Shopee.
test("Zalo: syncKnownGroups ghi nhan moi group bot dang o kem ten", async () => {
  const { ledgerStore, setAllGroupIds, syncKnownGroups, groupNames, cleanup } = setup();
  try {
    groupNames.set("group-2", "Gia đình");
    setAllGroupIds(["group-1", "group-2"]);

    await syncKnownGroups();

    const groups = ledgerStore.listZaloGroups();
    assert.deepEqual(
      groups.map((g) => [g.groupId, g.name]),
      [
        ["group-2", "Gia đình"],
        ["group-1", "Group Hoàn Tiền"],
      ],
      "sap theo ten nen Gia đình dung truoc Group Hoàn Tiền"
    );
    // Mac dinh TAT - admin phai tu tick tren /admin/settings.
    assert.deepEqual(ledgerStore.listNotifyEnabledZaloGroups(), []);
  } finally {
    cleanup();
  }
});

test("Zalo: syncKnownGroups khong goi getGroupInfo khi bot khong o group nao", async () => {
  const { ledgerStore, setAllGroupIds, syncKnownGroups, groupInfoCalls, cleanup } = setup();
  try {
    setAllGroupIds([]);
    await syncKnownGroups();
    assert.deepEqual(groupInfoCalls, []);
    assert.deepEqual(ledgerStore.listZaloGroups(), []);
  } finally {
    cleanup();
  }
});

test("Zalo group: tin nhan tu group chua biet -> ghi nhan group; group da biet -> khong goi lai getGroupInfo", async () => {
  const { ledgerStore, handleMessage, groupInfoCalls, cleanup } = setup();
  try {
    await handleMessage(makeMessage(ThreadType.Group, PRODUCT_URL));

    assert.deepEqual(
      ledgerStore.listZaloGroups().map((g) => [g.groupId, g.name]),
      [["group-1", "Group Hoàn Tiền"]]
    );
    assert.deepEqual(groupInfoCalls, ["group-1"]);

    // Tin thu 2 cung group: khong duoc goi getGroupInfo lan nua (tiet kiem request mang moi tin nhan).
    await handleMessage(makeMessage(ThreadType.Group, PRODUCT_URL));
    assert.deepEqual(groupInfoCalls, ["group-1"]);
    assert.equal(ledgerStore.listZaloGroups().length, 1);
  } finally {
    cleanup();
  }
});

test("Zalo group: tin nhan khong co link cung ghi nhan group", async () => {
  const { ledgerStore, handleMessage, cleanup } = setup();
  try {
    await handleMessage(makeMessage(ThreadType.Group, "hello moi nguoi"));
    assert.equal(ledgerStore.hasZaloGroup("group-1"), true);
  } finally {
    cleanup();
  }
});

test("Zalo: sendGroupMessage gui vao dung thread group (ThreadType.Group)", async () => {
  const { sent, bot, setLoggedIn, cleanup } = setup();
  try {
    setLoggedIn();
    await bot.sendGroupMessage("group-1", "Đơn hàng Shopee ngày 10/09 đã được cập nhật.");

    assert.equal(sent.length, 1);
    assert.equal(sent[0].threadId, "group-1");
    assert.equal(sent[0].type, ThreadType.Group);
    assert.equal(bodyOf(sent[0]), "Đơn hàng Shopee ngày 10/09 đã được cập nhật.");
  } finally {
    cleanup();
  }
});

test("Zalo: sendGroupMessage nem loi khi bot chua dang nhap", async () => {
  const { bot, cleanup } = setup();
  try {
    await assert.rejects(() => bot.sendGroupMessage("group-1", "test"), /chua dang nhap/);
  } finally {
    cleanup();
  }
});

test("Zalo DM: cau hoi FAQ -> bot tra loi bang cau soan san", async () => {
  const { sent, ledgerStore, handleMessage, attachFaq, cleanup } = setup();
  try {
    ledgerStore.tryClaimWelcomeMessage("zalo", "user-1");
    attachFaq(async () => ["san_ho_tro"]);
    ledgerStore.setSetting(faqAnswerKey("san_ho_tro"), "Shopee và TikTok Shop nha");

    await handleMessage(makeMessage(ThreadType.User, "ad ơi bot hỗ trợ sàn nào v"));

    assert.equal(sent.length, 1);
    assert.equal(bodyOf(sent[0]), "Shopee và TikTok Shop nha");
  } finally {
    cleanup();
  }
});

test("Zalo DM: khong gan faqService -> im lang y het hanh vi cu", async () => {
  const { sent, ledgerStore, handleMessage, cleanup } = setup();
  try {
    ledgerStore.tryClaimWelcomeMessage("zalo", "user-1");
    await handleMessage(makeMessage(ThreadType.User, "hoàn tiền sao vậy ad"));
    assert.equal(sent.length, 0);
  } finally {
    cleanup();
  }
});

test("Zalo group: cau hoi khong phai link -> van tra USAGE_TEXT, KHONG dung FAQ", async () => {
  const { sent, handleMessage, attachFaq, cleanup } = setup();
  try {
    let called = 0;
    attachFaq(async () => {
      called += 1;
      return ["san_ho_tro"];
    });

    await handleMessage(makeMessage(ThreadType.Group, "hoàn tiền sao vậy ad"));

    assert.equal(called, 0, "FAQ khong duoc chay trong group");
    assert.equal(sent.length, 1);
    assert.match(bodyOf(sent[0]), /link sản phẩm/i);
  } finally {
    cleanup();
  }
});

test("Zalo DM: admin go tay -> khoa FAQ thread do", async () => {
  const { ledgerStore, handleMessage, attachFaq, cleanup } = setup();
  try {
    attachFaq(async () => ["san_ho_tro"]);
    await handleMessage(makeSelfMessage("để mình check giúp bạn nha", "msg-admin-1"));
    assert.equal(ledgerStore.isFaqThreadMuted("zalo", "user-1", Date.now()), true);
  } finally {
    cleanup();
  }
});

test("Zalo DM: tin do CHINH bot gui ra -> KHONG tu khoa minh", async () => {
  const { sent, ledgerStore, handleMessage, attachFaq, cleanup } = setup();
  try {
    ledgerStore.tryClaimWelcomeMessage("zalo", "user-1");
    attachFaq(async () => ["san_ho_tro"]);
    ledgerStore.setSetting(faqAnswerKey("san_ho_tro"), "Shopee và TikTok Shop nha");

    await handleMessage(makeMessage(ThreadType.User, "bot hỗ trợ sàn nào"));
    assert.equal(sent.length, 1);

    // zca-js phat lai chinh tin bot vua gui (selfListen) - phai duoc nhan ra qua SentMessageTracker.
    await handleMessage(makeSelfMessage("Shopee và TikTok Shop nha", "msg-bot-1"));
    assert.equal(ledgerStore.isFaqThreadMuted("zalo", "user-1", Date.now()), false);
  } finally {
    cleanup();
  }
});

test("Zalo DM: lenh /im khoa vo thoi han, /noi mo lai", async () => {
  const { ledgerStore, handleMessage, attachFaq, cleanup } = setup();
  try {
    attachFaq(async () => ["san_ho_tro"]);

    await handleMessage(makeSelfMessage("/im", "msg-admin-2"));
    assert.equal(ledgerStore.isFaqThreadMuted("zalo", "user-1", Date.now() + 365 * 24 * 3600_000), true);

    await handleMessage(makeSelfMessage("/noi", "msg-admin-3"));
    assert.equal(ledgerStore.isFaqThreadMuted("zalo", "user-1", Date.now()), false);
  } finally {
    cleanup();
  }
});

test("Zalo DM: user go /im khong kich hoat duoc lenh admin (khong phai isSelf)", async () => {
  const { ledgerStore, handleMessage, attachFaq, cleanup } = setup();
  try {
    attachFaq(async () => []);
    await handleMessage(makeMessage(ThreadType.User, "/im"));
    // "/im" cua user di vao luong FAQ binh thuong -> classifier khong khop -> bot chi tra loi cau
    // "ngoai pham vi" (khong con tu khoa thread nua, xem faqService.ts). Neu lenh admin bi kich hoat
    // nham thi khoa se la VO THOI HAN - moc 10 nam duoi day chinh la cho phan biet 2 truong hop do.
    assert.equal(
      ledgerStore.isFaqThreadMuted("zalo", "user-1", Date.now() + 10 * 365 * 24 * 3600_000),
      false,
      "user khong duoc phep khoa vo thoi han bang /im"
    );
  } finally {
    cleanup();
  }
});

test("Zalo DM: thread bi khoa -> link san pham VA xemhh van chay", async () => {
  const { sent, ledgerStore, handleMessage, attachFaq, cleanup } = setup();
  try {
    ledgerStore.tryClaimWelcomeMessage("zalo", "user-1");
    attachFaq(async () => ["san_ho_tro"]);
    ledgerStore.muteFaqThread("zalo", "user-1", null, "admin_command");

    await handleMessage(makeMessage(ThreadType.User, PRODUCT_URL));
    assert.equal(sent.length, 1, "link san pham phai duoc xu ly du thread bi khoa");
    assert.match(bodyOf(sent[0]), /https:\/\/mock-aff\.local\//);

    await handleMessage(makeMessage(ThreadType.User, "xemhh"));
    assert.equal(sent.length, 2, "xemhh phai chay du thread bi khoa");
    assert.match(bodyOf(sent[1]), /\/d\//);

    await handleMessage(makeMessage(ThreadType.User, "bot hỗ trợ sàn nào"));
    assert.equal(sent.length, 2, "cau hoi FAQ phai bi im khi thread bi khoa");
  } finally {
    cleanup();
  }
});
