import { test } from "node:test";
import assert from "node:assert/strict";
import { ThreadType, GroupEventType, type API, type Message, type GroupEvent } from "zca-js";
import { ZaloGroupBot } from "../bot.js";
import { LedgerStore } from "../../../core/ledgerStore.js";
import { LogStore } from "../../../core/logStore.js";
import { LinkResolverService } from "../../../core/linkResolverService.js";
import { RateLimiter } from "../../../core/rateLimiter.js";
import { MockAffiliateProvider } from "../../../core/providers/mockProvider.js";
import { FaqService } from "../../../core/faq/faqService.js";
import { GROUP_JOIN_WELCOME_TEMPLATE_DEFAULT } from "../../shared/replyText.js";
import { faqAnswerKey } from "../../../core/settingsKeys.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  const friendRequests: { msg: string; userId: string }[] = [];
  // Loi gia lap cho sendFriendRequest - that bai pho bien nhat: nguoi do DA LA BAN cua tai khoan bot.
  let friendRequestError: Error | null = null;
  const reactions: { icon: unknown; msgId: string; threadId: string; type: ThreadType }[] = [];
  // Thu tu tuong doi giua "tha tim" va "gui tin" - dung de khang dinh tim duoc tha TRUOC khi
  // tra link (yeu cau cua user: user phai thay phan hoi ngay trong luc cho tao link).
  const timeline: string[] = [];
  // Loi gia lap cho DM (ThreadType.User): dung de tai hien case Zalo tu choi vi user chan nguoi la.
  let directMessageError: Error | null = null;
  // Loi gia lap RIENG tung user - can cho case "1 nguoi loi khong duoc chan 2 nguoi con lai".
  const directMessageErrorByUser = new Map<string, Error>();
  // Ten group gia lap tra ve boi getGroupInfo - test ghi vao day de kiem soat ket qua.
  const groupNames = new Map<string, string>([["group-1", "Group Hoàn Tiền"]]);
  let allGroupIds: string[] = [];
  // Roster gia lap cua tung group: memberIds (danh sach DAY DU) va currentMems (ho so kem san ten +
  // avatar, Zalo chi tra ve cho MOT PHAN thanh vien o group lon).
  const groupMembers = new Map<
    string,
    { memberIds: string[]; currentMems: { id: string; dName: string; avatar: string }[]; memVerList?: string[] }
  >();
  // Cac lo uid ma getGroupMembersInfo duoc goi voi - de khang dinh so lenh goi mang (chia lo <=50).
  const membersInfoCalls: string[][] = [];
  let membersInfoError: Error | null = null;
  const api = {
    sendMessage: async (payload: SentMessage["payload"], threadId: string, type: ThreadType) => {
      if (type === ThreadType.User) {
        const err = directMessageErrorByUser.get(threadId) ?? directMessageError;
        if (err !== null && err !== undefined) throw err;
      }
      sent.push({ payload, threadId, type });
      timeline.push("message");
      return {};
    },
    getOwnId: () => "bot-uid",
    sendFriendRequest: async (msg: string, userId: string) => {
      if (friendRequestError !== null) throw friendRequestError;
      friendRequests.push({ msg, userId });
      timeline.push("friend_request");
      return "";
    },
    addReaction: async (
      icon: unknown,
      dest: { data: { msgId: string }; threadId: string; type: ThreadType }
    ) => {
      reactions.push({ icon, msgId: dest.data.msgId, threadId: dest.threadId, type: dest.type });
      timeline.push("reaction");
      return { msgIds: [] };
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
        gridInfoMap: Object.fromEntries(
          ids.map((id) => [
            id,
            {
              name: groupNames.get(id) ?? "",
              memberIds: groupMembers.get(id)?.memberIds,
              currentMems: groupMembers.get(id)?.currentMems,
              memVerList: groupMembers.get(id)?.memVerList,
            },
          ])
        ),
      };
    },
    getGroupMembersInfo: async (memberId: string | string[]) => {
      const ids = Array.isArray(memberId) ? memberId : [memberId];
      membersInfoCalls.push(ids);
      if (membersInfoError !== null) throw membersInfoError;
      return {
        profiles: Object.fromEntries(
          ids.map((id) => [id, { displayName: `Ten ${id}`, avatar: `https://ava/${id}.jpg` }])
        ),
        unchangeds_profile: [],
      };
    },
    // connect() gan listener roi start() ngay - fake vua du de khong no, test khong dung toi event.
    listener: { on: () => {}, start: () => {}, stop: () => {} },
  } as unknown as API;

  // connect() chi thu dang nhap bang session khi doc duoc file session - phai co file that.
  const sessionDir = mkdtempSync(join(tmpdir(), "zalo-bot-test-"));
  const sessionPath = join(sessionDir, "session.json");
  writeFileSync(sessionPath, JSON.stringify({ imei: "x", cookie: "y", userAgent: "z" }), "utf-8");

  const logStore = new LogStore(":memory:");
  const ledgerStore = new LedgerStore(":memory:");
  const rateLimiter = new RateLimiter(100, 60_000);
  const resolver = new LinkResolverService(new MockAffiliateProvider(), logStore, rateLimiter);
  const bot = new ZaloGroupBot(resolver, {
    sessionPath,
    qrPath: join(sessionDir, "qr.png"),
    maxLinksPerMessage: 3,
  commissionTaxPercent: 10,
  commissionPlatformFeePercent: 1,
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
    rmSync(sessionDir, { recursive: true, force: true });
  }

  /**
   * Chay connect() that voi 1 Zalo gia - dong thoi vo hieu hoa delay giua cac lan retry de test
   * khong phai cho that ~1 phut.
   */
  const connectWithZalo = async (fakeZalo: unknown): Promise<void> => {
    const internals = bot as unknown as {
      createZalo(): unknown;
      delay(ms: number): Promise<void>;
      connect(): Promise<void>;
    };
    internals.createZalo = () => fakeZalo;
    internals.delay = async () => {};
    await internals.connect();
  };

  const syncKnownGroups = (): Promise<void> =>
    (bot as unknown as { syncKnownGroups(api: API): Promise<void> }).syncKnownGroups(api);

  const handleGroupEvent = (event: GroupEvent): Promise<void> =>
    (bot as unknown as { handleGroupEvent(api: API, event: GroupEvent): Promise<void> }).handleGroupEvent(api, event);

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
    logStore,
    handleMessage,
    attachFaq,
    bot,
    groupInfoCalls,
    groupNames,
    setAllGroupIds: (ids: string[]) => {
      allGroupIds = ids;
    },
    setGroupMembers: (
      groupId: string,
      members: {
        memberIds?: string[];
        currentMems?: { id: string; dName: string; avatar: string }[];
        memVerList?: string[];
      }
    ) => {
      groupMembers.set(groupId, {
        memberIds: members.memberIds ?? [],
        currentMems: members.currentMems ?? [],
        memVerList: members.memVerList,
      });
    },
    membersInfoCalls,
    setMembersInfoError: (err: Error | null) => {
      membersInfoError = err;
    },
    syncKnownGroups,
    handleGroupEvent,
    connectWithZalo,
    friendRequests,
    reactions,
    timeline,
    setDirectMessageError: (err: Error | null) => {
      directMessageError = err;
    },
    setDirectMessageErrorFor: (userId: string, err: Error) => {
      directMessageErrorByUser.set(userId, err);
    },
    setFriendRequestError: (err: Error | null) => {
      friendRequestError = err;
    },
    setLoggedIn,
    cleanup,
  };
}

/** Event "co thanh vien moi duoc them vao group" cua zca-js. */
function makeJoinEvent(
  members: { id: string; dName: string }[],
  threadId = "group-1"
): GroupEvent {
  return {
    type: GroupEventType.JOIN,
    threadId,
    isSelf: false,
    data: { updateMembers: members },
  } as unknown as GroupEvent;
}

function makeMessage(type: ThreadType, text: string, uid = "user-1"): Message {
  return {
    type,
    threadId: type === ThreadType.User ? uid : "group-1",
    isSelf: false,
    data: { uidFrom: uid, dName: "Nguyen Van A", content: text, msgId: "msg-1", cliMsgId: "cli-1" },
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
    ledgerStore.setSetting(faqAnswerKey("san_ho_tro"), "Shopee nha");

    await handleMessage(makeMessage(ThreadType.User, "ad ơi bot hỗ trợ sàn nào v"));

    assert.equal(sent.length, 1);
    assert.equal(bodyOf(sent[0]), "Shopee nha");
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
    ledgerStore.setSetting(faqAnswerKey("san_ho_tro"), "Shopee nha");

    await handleMessage(makeMessage(ThreadType.User, "bot hỗ trợ sàn nào"));
    assert.equal(sent.length, 1);

    // zca-js phat lai chinh tin bot vua gui (selfListen) - phai duoc nhan ra qua SentMessageTracker.
    await handleMessage(makeSelfMessage("Shopee nha", "msg-bot-1"));
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

// ---------------------------------------------------------------------------
// 2026-09-24: user bat "khong nhan tin nhan tu nguoi la" -> DM chao mung bi Zalo tu choi.
// Su co that: "To Diem" join group sanhoantien2 nhung khong nhan duoc DM nao.
// ---------------------------------------------------------------------------

const BLOCKED_ERROR_MESSAGE =
  "Bạn chưa thể gửi tin nhắn đến người này vì người này chặn không nhận tin nhắn từ người lạ.";

test("Zalo group join: DM bi chan -> chao bu trong group kem mention @ten nguoi moi", async () => {
  const { sent, handleGroupEvent, setDirectMessageError, cleanup } = setup();
  try {
    setDirectMessageError(new Error(BLOCKED_ERROR_MESSAGE));

    await handleGroupEvent(makeJoinEvent([{ id: "user-9", dName: "Tô Diễm" }]));

    assert.equal(sent.length, 1, "phai co dung 1 tin gui vao group");
    assert.equal(sent[0].threadId, "group-1");
    assert.equal(sent[0].type, ThreadType.Group);
    const body = bodyOf(sent[0]);
    assert.ok(body.includes("@Tô Diễm"), "phai tag ten nguoi moi");
    assert.ok(body.includes("kết bạn"), "phai xin user chap nhan loi moi ket ban");
    // Mention phai tappable (khong phai text "@ten" thuan) -> offset/len tro dung vao "@Tô Diễm".
    const mentions = (sent[0].payload as { mentions?: { pos: number; uid: string; len: number }[] }).mentions;
    assert.ok(mentions !== undefined, "phai co mentions de tag bam duoc");
    assert.equal(mentions[0].uid, "user-9");
    assert.equal(mentions[0].pos, body.indexOf("@Tô Diễm"));
    assert.equal(mentions[0].len, "@Tô Diễm".length);
  } finally {
    cleanup();
  }
});

test("Zalo group join: DM bi chan -> gui luon loi moi ket ban toi user do", async () => {
  const { friendRequests, handleGroupEvent, setDirectMessageError, cleanup } = setup();
  try {
    setDirectMessageError(new Error(BLOCKED_ERROR_MESSAGE));

    await handleGroupEvent(makeJoinEvent([{ id: "user-9", dName: "Tô Diễm" }]));

    assert.equal(friendRequests.length, 1);
    assert.equal(friendRequests[0].userId, "user-9");
    assert.ok(friendRequests[0].msg.length > 0, "loi moi ket ban phai kem loi nhan");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 2026-10-01: su co that tren instance "sanhoantien" - 3 nguoi (Jessica, Tran Gia Bao, Nhat Huy)
// join group bang LINK NHOM, log cho thay nhan du 3 group_event join nhung 2 nguoi khong nhan
// duoc gi: Zalo tu choi DM bang MOT BIEN THE THONG BAO KHAC voi cum "nguoi la" da biet:
//   code=127 "Khong the nhan tin nhan tu ban." (co dau: "Không thể nhận tin nhắn từ bạn.")
// Vi isStrangerBlockedError chi khop "nguoi la" nen ca nhanh chao bu trong group LAN gui loi moi
// ket ban deu khong chay -> user tuong bot hong.
// ---------------------------------------------------------------------------

const BLOCKED_ERROR_MESSAGE_CODE_127 = "Không thể nhận tin nhắn từ bạn.";

/** ZaloApiError that mang theo `code` so lay tu error_code cua Zalo - gia lap dung hinh dang do. */
function zaloApiError(message: string, code: number | null): Error {
  const err = new Error(message);
  (err as Error & { code: number | null }).code = code;
  return err;
}

test("Zalo group join: DM bi tu choi code=127 (text khong co 'nguoi la') -> van chao bu + ket ban", async () => {
  const { sent, friendRequests, handleGroupEvent, setDirectMessageError, cleanup } = setup();
  try {
    setDirectMessageError(zaloApiError(BLOCKED_ERROR_MESSAGE_CODE_127, 127));

    await handleGroupEvent(makeJoinEvent([{ id: "user-9", dName: "Jessica" }]));

    assert.equal(friendRequests.length, 1, "phai gui loi moi ket ban - cach duy nhat de ve sau DM duoc");
    assert.equal(friendRequests[0].userId, "user-9");
    assert.equal(sent.length, 1, "phai chao bu trong group");
    assert.equal(sent[0].type, ThreadType.Group);
    assert.ok(bodyOf(sent[0]).includes("@Jessica"), "phai tag ten nguoi moi");
  } finally {
    cleanup();
  }
});

test("Zalo group join: nhieu nguoi join cung luc - 1 nguoi DM loi khong lam mat phan 2 nguoi con lai", async () => {
  const { sent, friendRequests, handleGroupEvent, setDirectMessageErrorFor, cleanup } = setup();
  try {
    // Nguoi giua bi Zalo tu choi; 2 nguoi con lai DM binh thuong.
    setDirectMessageErrorFor("user-b", zaloApiError(BLOCKED_ERROR_MESSAGE_CODE_127, 127));

    await handleGroupEvent(
      makeJoinEvent([
        { id: "user-a", dName: "Jessica" },
        { id: "user-b", dName: "Tran Gia Bao" },
        { id: "user-c", dName: "Nhật Huy" },
      ])
    );

    const dms = sent.filter((m) => m.type === ThreadType.User).map((m) => m.threadId);
    assert.deepEqual(dms.sort(), ["user-a", "user-c"], "2 nguoi con lai phai nhan DM chao mung");
    assert.deepEqual(
      friendRequests.map((r) => r.userId).sort(),
      ["user-a", "user-b", "user-c"],
      "ca 3 nguoi moi deu duoc gui loi moi ket ban"
    );
    const groupGreetings = sent.filter((m) => m.type === ThreadType.Group);
    assert.equal(groupGreetings.length, 1, "chi chao bu trong group cho nguoi bi tu choi");
    assert.ok(bodyOf(groupGreetings[0]).includes("@Tran Gia Bao"));
  } finally {
    cleanup();
  }
});

test("Zalo group join: DM loi KHAC (mang/timeout) -> KHONG chao trong group", async () => {
  const { sent, friendRequests, handleGroupEvent, setDirectMessageError, cleanup } = setup();
  try {
    // Noi sai "ban dang chan tin nhan cua em" khi that ra chi la loi mang thi con te hon im lang.
    setDirectMessageError(new Error("socket hang up"));

    await handleGroupEvent(makeJoinEvent([{ id: "user-9", dName: "Tô Diễm" }]));

    assert.equal(sent.length, 0, "loi mang khong duoc keo theo tin chao bu trong group");
    // Loi moi ket ban thi VAN gui (2026-10-01): no di TRUOC va khong phu thuoc DM thanh cong hay khong.
    assert.equal(friendRequests.length, 1);
  } finally {
    cleanup();
  }
});

test("Zalo group join: DM gui duoc binh thuong -> khong chao trong group (nhung VAN ket ban)", async () => {
  const { sent, friendRequests, handleGroupEvent, cleanup } = setup();
  try {
    await handleGroupEvent(makeJoinEvent([{ id: "user-9", dName: "Tô Diễm" }]));

    assert.equal(sent.length, 1, "chi co dung DM chao mung, khong chao bu trong group");
    assert.equal(sent[0].type, ThreadType.User);
    assert.equal(friendRequests.length, 1, "ket ban gui cho MOI nguoi moi, khong doi DM bi chan");
    assert.equal(friendRequests[0].userId, "user-9");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 2026-10-01 (yeu cau truc tiep cua user): gui loi moi ket ban cho MOI thanh vien moi join group,
// khong chi khi DM chao mung bi tu choi - ket ban la cach duy nhat de ve sau bot DM bao don duoc.
// ---------------------------------------------------------------------------

test("Zalo group join: loi moi ket ban gui TRUOC DM chao mung (DM co cau nhac chap nhan loi moi)", async () => {
  const { timeline, handleGroupEvent, cleanup } = setup();
  try {
    await handleGroupEvent(makeJoinEvent([{ id: "user-9", dName: "Tô Diễm" }]));

    assert.deepEqual(timeline, ["friend_request", "message"], "ket ban phai den TRUOC DM");
  } finally {
    cleanup();
  }
});

test("Zalo group join: DM bi chan -> chi gui DUNG 1 loi moi ket ban (khong gui doi)", async () => {
  const { sent, friendRequests, handleGroupEvent, setDirectMessageError, cleanup } = setup();
  try {
    setDirectMessageError(zaloApiError(BLOCKED_ERROR_MESSAGE_CODE_127, 127));

    await handleGroupEvent(makeJoinEvent([{ id: "user-9", dName: "Tô Diễm" }]));

    assert.equal(friendRequests.length, 1, "nhanh chao bu KHONG duoc gui them loi moi lan 2");
    assert.equal(sent.filter((m) => m.type === ThreadType.Group).length, 1, "van chao bu trong group");
  } finally {
    cleanup();
  }
});

test("Zalo group join: ket ban that bai (vd da la ban san) -> VAN gui DM chao mung", async () => {
  const { sent, friendRequests, handleGroupEvent, setFriendRequestError, cleanup } = setup();
  try {
    setFriendRequestError(new Error("Đã là bạn bè"));

    await handleGroupEvent(makeJoinEvent([{ id: "user-9", dName: "Tô Diễm" }]));

    assert.equal(friendRequests.length, 0);
    assert.equal(sent.length, 1, "loi ket ban khong duoc chan DM chao mung");
    assert.equal(sent[0].type, ThreadType.User);
  } finally {
    cleanup();
  }
});

test("Zalo group join: template chao mung phai nhac user chap nhan loi moi ket ban", () => {
  // Bot gui loi moi ket ban cho moi nguoi moi - DM khong nhac thi user thay loi moi tu troi roi
  // xuong, de ignore/tu choi. Day la cap doi di lien nhau, dung go 1 ben.
  assert.ok(
    GROUP_JOIN_WELCOME_TEMPLATE_DEFAULT.includes("kết bạn"),
    "GROUP_JOIN_WELCOME_TEMPLATE_DEFAULT phai nhac toi loi moi ket ban"
  );
});

test("Zalo group join: bo qua chinh bot khi bot duoc them vao group khac", async () => {
  const { sent, friendRequests, handleGroupEvent, setDirectMessageError, cleanup } = setup();
  try {
    setDirectMessageError(new Error(BLOCKED_ERROR_MESSAGE));

    await handleGroupEvent(makeJoinEvent([{ id: "bot-uid", dName: "Bot" }]));

    assert.equal(sent.length, 0, "khong chao chinh minh");
    assert.equal(friendRequests.length, 0, "khong tu gui loi moi ket ban cho chinh minh");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 2026-09-24: tha tim tin nhan user NGAY khi nhan ra co link san pham, TRUOC khi goi API tao
// link - de user thay bot da nhan duoc trong luc cho (yeu cau truc tiep cua user).
// ---------------------------------------------------------------------------

test("Zalo group: gui link san pham -> tha tim tin nhan cua user TRUOC khi tra link", async () => {
  const { reactions, timeline, ledgerStore, handleMessage, cleanup } = setup();
  try {
    ledgerStore.tryClaimWelcomeMessage("zalo", "user-1");

    await handleMessage(makeMessage(ThreadType.Group, PRODUCT_URL));

    assert.equal(reactions.length, 1);
    assert.equal(reactions[0].msgId, "msg-1");
    assert.equal(reactions[0].threadId, "group-1");
    assert.equal(reactions[0].type, ThreadType.Group);
    assert.deepEqual(timeline, ["reaction", "message"], "tim phai duoc tha truoc khi tra link");
  } finally {
    cleanup();
  }
});

test("Zalo group: link KHONG hop le van tha tim (user chap nhan, thay phan hoi ngay quan trong hon)", async () => {
  const { reactions, ledgerStore, handleMessage, cleanup } = setup();
  try {
    ledgerStore.tryClaimWelcomeMessage("zalo", "user-1");

    // Link Shopee Video - nhin nhu link san pham nhung bi tu choi khi tao link affiliate.
    await handleMessage(makeMessage(ThreadType.Group, "https://sv.shopee.vn/share-video/abc123"));

    assert.equal(reactions.length, 1);
  } finally {
    cleanup();
  }
});

test("Zalo group: tin khong co link san pham -> khong tha tim", async () => {
  const { reactions, handleMessage, cleanup } = setup();
  try {
    await handleMessage(makeMessage(ThreadType.Group, "hi moi nguoi"));

    assert.equal(reactions.length, 0);
  } finally {
    cleanup();
  }
});

test("Zalo DM: gui link san pham -> KHONG tha tim (chi lam trong group)", async () => {
  const { reactions, ledgerStore, handleMessage, cleanup } = setup();
  try {
    ledgerStore.tryClaimWelcomeMessage("zalo", "user-1");

    await handleMessage(makeMessage(ThreadType.User, PRODUCT_URL));

    assert.equal(reactions.length, 0);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 2026-09-24 (su co that tren sanhoantien2): container vua boot, mang egress chua san sang ->
// zalo.login(session) nem "fetch failed" -> code cu ket luan ngay "session het han" va rot xuong
// dang nhap QR, ma QR thi khong ai quet duoc tren server -> bot im lang cho toi khi restart tay.
// Session that ra van con tot nguyen (restart la vao lai duoc).
// ---------------------------------------------------------------------------

/** Zalo gia: login() that bai/thanh cong theo kich ban, dem so lan roi xuong loginQR(). */
function makeFakeZalo(loginOutcomes: boolean[], api: API) {
  const calls = { login: 0, loginQR: 0 };
  return {
    calls,
    zalo: {
      login: async () => {
        const ok = loginOutcomes[calls.login] ?? false;
        calls.login += 1;
        if (!ok) throw new Error("fetch failed");
        return api;
      },
      loginQR: async () => {
        calls.loginQR += 1;
        return api;
      },
    },
  };
}

test("Zalo login: session loi mang vai lan dau roi vao duoc -> dung session, KHONG dung QR", async () => {
  const { api, connectWithZalo, cleanup } = setup();
  try {
    const { zalo, calls } = makeFakeZalo([false, false, true], api);

    await connectWithZalo(zalo);

    assert.equal(calls.login, 3, "phai thu lai cho toi khi vao duoc");
    assert.equal(calls.loginQR, 0, "khong duoc dong vao QR khi session van con tot");
  } finally {
    cleanup();
  }
});

test("Zalo login: session that bai het so lan cho phep -> moi rot xuong QR", async () => {
  const { api, connectWithZalo, cleanup } = setup();
  try {
    const { zalo, calls } = makeFakeZalo([], api);

    await connectWithZalo(zalo);

    assert.ok(calls.login > 1, "phai thu lai nhieu lan truoc khi bo cuoc");
    assert.equal(calls.loginQR, 1, "het cach roi thi van phai cho setup lai bang QR");
  } finally {
    cleanup();
  }
});

test("Zalo login: session vao duoc ngay lan dau -> chi goi login 1 lan", async () => {
  const { api, connectWithZalo, cleanup } = setup();
  try {
    const { zalo, calls } = makeFakeZalo([true], api);

    await connectWithZalo(zalo);

    assert.equal(calls.login, 1);
    assert.equal(calls.loginQR, 0);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 2026-10-01 (bug that): khach chap nhan loi moi ket ban -> Zalo day vao thread DM mot tin nhan
// noi dung RONG, bot tra loi "Cau hoi nay ngoai pham vi..." cho nguoi chua he hoi gi.
// ---------------------------------------------------------------------------

test("Zalo DM: tin nhan noi dung RONG (vd khach vua chap nhan ket ban) -> im lang hoan toan", async () => {
  const { sent, handleMessage, attachFaq, cleanup } = setup();
  try {
    let classifyCalls = 0;
    attachFaq(async () => {
      classifyCalls += 1;
      return [];
    });

    await handleMessage(makeMessage(ThreadType.User, ""));

    assert.equal(sent.length, 0, "khong duoc gui gi ca");
    assert.equal(classifyCalls, 0, "khong duoc dua chuoi rong vao classifier");
  } finally {
    cleanup();
  }
});

test("Zalo DM: tin nhan chi co khoang trang -> im lang hoan toan", async () => {
  const { sent, handleMessage, attachFaq, cleanup } = setup();
  try {
    attachFaq(async () => []);

    await handleMessage(makeMessage(ThreadType.User, "   \n "));

    assert.equal(sent.length, 0);
  } finally {
    cleanup();
  }
});

test("Zalo group: tin nhan noi dung RONG -> khong tra huong dan su dung", async () => {
  const { sent, handleMessage, cleanup } = setup();
  try {
    await handleMessage(makeMessage(ThreadType.Group, ""));

    assert.equal(sent.length, 0, "tin rong khong phai 'khong biet dung bot', dung tra USAGE_TEXT");
  } finally {
    cleanup();
  }
});

// Cot "Noi gui" cua /admin/links (2026-10-08). Adapter la cho DUY NHAT biet link den tu group hay
// DM - core khong suy nguoc duoc tu `platform` (ca hai deu la "zalo").
test("Zalo GROUP: luot tao link ghi sourceContext = 'group'", async () => {
  const { logStore, handleMessage, cleanup } = setup();
  try {
    await handleMessage(makeMessage(ThreadType.Group, PRODUCT_URL));

    const [row] = logStore.listCreatedLinks();
    assert.equal(row.outcome, "success");
    assert.equal(row.sourceContext, "group");
  } finally {
    cleanup();
  }
});

test("Zalo DM: luot tao link ghi sourceContext = 'dm'", async () => {
  const { logStore, ledgerStore, handleMessage, cleanup } = setup();
  try {
    ledgerStore.tryClaimWelcomeMessage("zalo", "user-1");

    await handleMessage(makeMessage(ThreadType.User, PRODUCT_URL));

    assert.equal(logStore.listCreatedLinks()[0].sourceContext, "dm");
  } finally {
    cleanup();
  }
});

test("Zalo: link LOI trong group van ghi sourceContext = 'group'", async () => {
  // Luot loi la luot admin can soi nhat (user gui gi ma bot tu choi?) - thieu noi gui thi khong
  // biet phai di xem lai group nao.
  const { logStore, handleMessage, cleanup } = setup();
  try {
    await handleMessage(makeMessage(ThreadType.Group, "https://sv.shopee.vn/share-video/abc"));

    const [row] = logStore.listCreatedLinks();
    assert.equal(row.outcome, "error");
    assert.equal(row.sourceContext, "group");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Roster thanh vien group (2026-10-09, yeu cau truc tiep cua user): /admin/users phai hien CA user
// chua tung dat don de cau hinh duoc % hoa hong rieng cho ho truoc lan mua dau. Danh sach thanh
// vien nam SAN trong response getGroupInfo ma syncKnownGroups da goi - khong them lenh goi nao.
// ---------------------------------------------------------------------------

/** Giup doc ra danh sach user Zalo chua co don ma /admin/users se hien. */
function knownUserIds(ledgerStore: LedgerStore): string[] {
  return ledgerStore
    .listUsers()
    .map((u) => u.userId)
    .sort();
}

test("Zalo roster: chi ghi thanh vien cua group DA tick thong bao", async () => {
  const { ledgerStore, setAllGroupIds, setGroupMembers, syncKnownGroups, cleanup } = setup();
  try {
    setAllGroupIds(["group-1", "group-gia-dinh"]);
    setGroupMembers("group-1", {
      memberIds: ["khach-a"],
      currentMems: [{ id: "khach-a", dName: "Khach A", avatar: "https://ava/a.jpg" }],
    });
    setGroupMembers("group-gia-dinh", {
      memberIds: ["nguoi-than"],
      currentMems: [{ id: "nguoi-than", dName: "Me", avatar: "https://ava/me.jpg" }],
    });
    // Lan dong bo dau tien: chua group nao duoc tick -> chua ghi thanh vien nao.
    await syncKnownGroups();
    assert.deepEqual(knownUserIds(ledgerStore), [], "group chua tick thi khong lay thanh vien");

    ledgerStore.setZaloGroupNotifySelection(["group-1"]);
    await syncKnownGroups();

    assert.deepEqual(knownUserIds(ledgerStore), ["khach-a"], "group ca nhan cua chu bot khong vao danh sach");
  } finally {
    cleanup();
  }
});

test("Zalo roster: khong ghi chinh uid cua bot thanh user", async () => {
  const { ledgerStore, setAllGroupIds, setGroupMembers, syncKnownGroups, cleanup } = setup();
  try {
    setAllGroupIds(["group-1"]);
    // Phai co dong trong zalo_groups truoc khi tick: setZaloGroupNotifySelection chi UPDATE dong
    // da ton tai (xem doc comment cua ham do), con upsert group that nam trong syncKnownGroups.
    ledgerStore.upsertZaloGroup("group-1", "Group Hoàn Tiền");
    ledgerStore.setZaloGroupNotifySelection(["group-1"]);
    setGroupMembers("group-1", {
      memberIds: ["bot-uid", "khach-a"],
      currentMems: [
        { id: "bot-uid", dName: "Bot", avatar: "https://ava/bot.jpg" },
        { id: "khach-a", dName: "Khach A", avatar: "https://ava/a.jpg" },
      ],
    });

    await syncKnownGroups();

    assert.deepEqual(knownUserIds(ledgerStore), ["khach-a"]);
  } finally {
    cleanup();
  }
});

test("Zalo roster: luu ten + avatar tu currentMems", async () => {
  const { ledgerStore, setAllGroupIds, setGroupMembers, syncKnownGroups, cleanup } = setup();
  try {
    setAllGroupIds(["group-1"]);
    // Phai co dong trong zalo_groups truoc khi tick: setZaloGroupNotifySelection chi UPDATE dong
    // da ton tai (xem doc comment cua ham do), con upsert group that nam trong syncKnownGroups.
    ledgerStore.upsertZaloGroup("group-1", "Group Hoàn Tiền");
    ledgerStore.setZaloGroupNotifySelection(["group-1"]);
    setGroupMembers("group-1", {
      memberIds: ["khach-a"],
      currentMems: [{ id: "khach-a", dName: "Khách A", avatar: "https://ava/a.jpg" }],
    });

    await syncKnownGroups();

    const row = ledgerStore.listUsers().find((u) => u.userId === "khach-a");
    assert.equal(row?.displayName, "Khách A");
    assert.equal(row?.avatarUrl, "https://ava/a.jpg");
  } finally {
    cleanup();
  }
});

test("Zalo roster: uid khong co trong currentMems van vao danh sach, ten lay qua getGroupMembersInfo", async () => {
  const { ledgerStore, setAllGroupIds, setGroupMembers, syncKnownGroups, membersInfoCalls, cleanup } = setup();
  try {
    setAllGroupIds(["group-1"]);
    // Phai co dong trong zalo_groups truoc khi tick: setZaloGroupNotifySelection chi UPDATE dong
    // da ton tai (xem doc comment cua ham do), con upsert group that nam trong syncKnownGroups.
    ledgerStore.upsertZaloGroup("group-1", "Group Hoàn Tiền");
    ledgerStore.setZaloGroupNotifySelection(["group-1"]);
    setGroupMembers("group-1", {
      memberIds: ["khach-a", "khach-b"],
      currentMems: [{ id: "khach-a", dName: "Khach A", avatar: "https://ava/a.jpg" }],
    });

    await syncKnownGroups();

    assert.deepEqual(knownUserIds(ledgerStore), ["khach-a", "khach-b"]);
    assert.deepEqual(membersInfoCalls, [["khach-b"]], "chi goi bu cho uid chua co ten");
    const row = ledgerStore.listUsers().find((u) => u.userId === "khach-b");
    assert.equal(row?.displayName, "Ten khach-b");
    assert.equal(row?.avatarUrl, "https://ava/khach-b.jpg");
  } finally {
    cleanup();
  }
});

test("Zalo roster: moi uid da co ten -> KHONG goi getGroupMembersInfo", async () => {
  const { ledgerStore, setAllGroupIds, setGroupMembers, syncKnownGroups, membersInfoCalls, cleanup } = setup();
  try {
    setAllGroupIds(["group-1"]);
    // Phai co dong trong zalo_groups truoc khi tick: setZaloGroupNotifySelection chi UPDATE dong
    // da ton tai (xem doc comment cua ham do), con upsert group that nam trong syncKnownGroups.
    ledgerStore.upsertZaloGroup("group-1", "Group Hoàn Tiền");
    ledgerStore.setZaloGroupNotifySelection(["group-1"]);
    setGroupMembers("group-1", {
      memberIds: ["khach-a"],
      currentMems: [{ id: "khach-a", dName: "Khach A", avatar: "https://ava/a.jpg" }],
    });

    await syncKnownGroups();

    assert.deepEqual(membersInfoCalls, []);
  } finally {
    cleanup();
  }
});

/** Group lon: Zalo co the khong tra currentMems. Chia lo <=50 uid/lenh goi de khong bi tu choi ca lo. */
test("Zalo roster: chia lo toi da 50 uid moi lan goi getGroupMembersInfo", async () => {
  const { ledgerStore, setAllGroupIds, setGroupMembers, syncKnownGroups, membersInfoCalls, cleanup } = setup();
  try {
    setAllGroupIds(["group-1"]);
    // Phai co dong trong zalo_groups truoc khi tick: setZaloGroupNotifySelection chi UPDATE dong
    // da ton tai (xem doc comment cua ham do), con upsert group that nam trong syncKnownGroups.
    ledgerStore.upsertZaloGroup("group-1", "Group Hoàn Tiền");
    ledgerStore.setZaloGroupNotifySelection(["group-1"]);
    const ids = Array.from({ length: 120 }, (_, i) => `khach-${i}`);
    setGroupMembers("group-1", { memberIds: ids, currentMems: [] });

    await syncKnownGroups();

    assert.deepEqual(
      membersInfoCalls.map((batch) => batch.length),
      [50, 50, 20]
    );
    assert.equal(ledgerStore.listUsers().length, 120);
  } finally {
    cleanup();
  }
});

/** Ten chi la de admin de nhan dien - lay khong duoc thi van phai ghi nhan la user cua he thong. */
test("Zalo roster: getGroupMembersInfo loi van ghi nhan user (chi thieu ten)", async () => {
  const { ledgerStore, setAllGroupIds, setGroupMembers, syncKnownGroups, setMembersInfoError, cleanup } = setup();
  try {
    setAllGroupIds(["group-1"]);
    // Phai co dong trong zalo_groups truoc khi tick: setZaloGroupNotifySelection chi UPDATE dong
    // da ton tai (xem doc comment cua ham do), con upsert group that nam trong syncKnownGroups.
    ledgerStore.upsertZaloGroup("group-1", "Group Hoàn Tiền");
    ledgerStore.setZaloGroupNotifySelection(["group-1"]);
    setGroupMembers("group-1", { memberIds: ["khach-a"], currentMems: [] });
    setMembersInfoError(new Error("Zalo tu choi"));

    await syncKnownGroups();

    const row = ledgerStore.listUsers().find((u) => u.userId === "khach-a");
    assert.ok(row, "van phai co dong cho user nay");
    assert.equal(row.displayName, null);
  } finally {
    cleanup();
  }
});

test("Zalo roster: thanh vien moi join group da tick duoc ghi nhan ngay", async () => {
  const { ledgerStore, handleGroupEvent, cleanup } = setup();
  try {
    ledgerStore.upsertZaloGroup("group-1", "Group Hoàn Tiền");
    ledgerStore.setZaloGroupNotifySelection(["group-1"]);

    await handleGroupEvent(makeJoinEvent([{ id: "khach-moi", dName: "Khách Mới" }]));

    const row = ledgerStore.listUsers().find((u) => u.userId === "khach-moi");
    assert.ok(row, "khong phai doi restart bot moi thay user vua join");
    assert.equal(row.displayName, "Khách Mới");
    assert.equal(row.ordersCount, 0);
  } finally {
    cleanup();
  }
});

test("Zalo roster: join group CHUA tick thi khong ghi nhan", async () => {
  const { ledgerStore, handleGroupEvent, cleanup } = setup();
  try {
    ledgerStore.upsertZaloGroup("group-1", "Group Hoàn Tiền");

    await handleGroupEvent(makeJoinEvent([{ id: "khach-moi", dName: "Khách Mới" }]));

    assert.equal(ledgerStore.listUsers().length, 0);
  } finally {
    cleanup();
  }
});

// syncGroupMembers: duong do /admin/settings goi khi admin vua tick 1 group (2026-10-09).
test("Zalo roster: syncGroupMembers lay thanh vien 1 group ngay, khong cho dang nhap lai", async () => {
  const { ledgerStore, setGroupMembers, bot, setLoggedIn, groupInfoCalls, cleanup } = setup();
  try {
    setLoggedIn();
    ledgerStore.upsertZaloGroup("group-1", "Group Hoàn Tiền");
    ledgerStore.setZaloGroupNotifySelection(["group-1"]);
    setGroupMembers("group-1", {
      memberIds: ["khach-a"],
      currentMems: [{ id: "khach-a", dName: "Khách A", avatar: "https://ava/a.jpg" }],
    });

    await bot.syncGroupMembers("group-1");

    assert.deepEqual(groupInfoCalls, ["group-1"], "chi goi cho dung group vua tick");
    assert.equal(ledgerStore.listUsers().find((u) => u.userId === "khach-a")?.displayName, "Khách A");
  } finally {
    cleanup();
  }
});

test("Zalo roster: syncGroupMembers nem loi ro rang khi bot chua dang nhap", async () => {
  const { bot, cleanup } = setup();
  try {
    await assert.rejects(() => bot.syncGroupMembers("group-1"), /chua dang nhap/i);
  } finally {
    cleanup();
  }
});

/**
 * Do THAT tren production 2026-10-09: `getGroupInfo` tra ve `name` day du (ten group hien dung tren
 * /admin/settings) nhung KHONG co `memberIds`/`currentMems` - roster im lang rong, khong loi nao.
 * Thanh vien nam o `memVerList` dang "<uid>_<version>".
 */
test("Zalo roster: doc duoc thanh vien tu memVerList khi thieu memberIds/currentMems", async () => {
  const { ledgerStore, setAllGroupIds, setGroupMembers, syncKnownGroups, cleanup } = setup();
  try {
    setAllGroupIds(["group-1"]);
    ledgerStore.upsertZaloGroup("group-1", "Group Hoàn Tiền");
    ledgerStore.setZaloGroupNotifySelection(["group-1"]);
    setGroupMembers("group-1", { memVerList: ["khach-a_3", "khach-b_12"] });

    await syncKnownGroups();

    assert.deepEqual(knownUserIds(ledgerStore), ["khach-a", "khach-b"], "phai bo phan _version");
  } finally {
    cleanup();
  }
});

test("Zalo roster: memVerList khong co dau _ thi lay nguyen chuoi lam uid", async () => {
  const { ledgerStore, setAllGroupIds, setGroupMembers, syncKnownGroups, cleanup } = setup();
  try {
    setAllGroupIds(["group-1"]);
    ledgerStore.upsertZaloGroup("group-1", "Group Hoàn Tiền");
    ledgerStore.setZaloGroupNotifySelection(["group-1"]);
    setGroupMembers("group-1", { memVerList: ["khach-a", "", "  "] });

    await syncKnownGroups();

    assert.deepEqual(knownUserIds(ledgerStore), ["khach-a"], "bo qua phan tu rong");
  } finally {
    cleanup();
  }
});

test("Zalo roster: uid cua bot trong memVerList cung bi loai", async () => {
  const { ledgerStore, setAllGroupIds, setGroupMembers, syncKnownGroups, cleanup } = setup();
  try {
    setAllGroupIds(["group-1"]);
    ledgerStore.upsertZaloGroup("group-1", "Group Hoàn Tiền");
    ledgerStore.setZaloGroupNotifySelection(["group-1"]);
    setGroupMembers("group-1", { memVerList: ["bot-uid_1", "khach-a_2"] });

    await syncKnownGroups();

    assert.deepEqual(knownUserIds(ledgerStore), ["khach-a"]);
  } finally {
    cleanup();
  }
});

test("Zalo roster: 3 nguon deu rong thi khong crash, khong ghi ai", async () => {
  const { ledgerStore, setAllGroupIds, setGroupMembers, syncKnownGroups, membersInfoCalls, cleanup } = setup();
  try {
    setAllGroupIds(["group-1"]);
    ledgerStore.upsertZaloGroup("group-1", "Group Hoàn Tiền");
    ledgerStore.setZaloGroupNotifySelection(["group-1"]);
    setGroupMembers("group-1", {});

    await syncKnownGroups();

    assert.deepEqual(knownUserIds(ledgerStore), []);
    assert.deepEqual(membersInfoCalls, [], "khong goi API bu ho so cho danh sach rong");
  } finally {
    cleanup();
  }
});

test("Zalo roster: memVerList gop voi memberIds, khong nhan ban user", async () => {
  const { ledgerStore, setAllGroupIds, setGroupMembers, syncKnownGroups, cleanup } = setup();
  try {
    setAllGroupIds(["group-1"]);
    ledgerStore.upsertZaloGroup("group-1", "Group Hoàn Tiền");
    ledgerStore.setZaloGroupNotifySelection(["group-1"]);
    setGroupMembers("group-1", { memberIds: ["khach-a"], memVerList: ["khach-a_5", "khach-b_1"] });

    await syncKnownGroups();

    assert.deepEqual(knownUserIds(ledgerStore), ["khach-a", "khach-b"]);
  } finally {
    cleanup();
  }
});
