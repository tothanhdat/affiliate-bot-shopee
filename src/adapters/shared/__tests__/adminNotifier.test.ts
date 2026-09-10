import { test } from "node:test";
import assert from "node:assert/strict";
import { createAdminNotifier } from "../adminNotifier.js";

type Sender = (message: string) => Promise<void>;

/** Tao 1 sender ghi lai moi message da gui, de assert duoc kenh nao thuc su duoc dung. */
function recordingSender(): { send: Sender; sent: string[] } {
  const sent: string[] = [];
  return {
    send: async (message: string) => {
      sent.push(message);
    },
    sent,
  };
}

test("createAdminNotifier: co Telegram thi gui qua Telegram, khong dung Zalo", async () => {
  const telegram = recordingSender();
  const zalo = recordingSender();
  const unavailable: string[] = [];

  const notifyAdmin = createAdminNotifier({
    resolveTelegramSender: () => telegram.send,
    resolveZaloSender: () => zalo.send,
    logUnavailable: (message) => unavailable.push(message),
  });

  await notifyAdmin("co yeu cau rut tien moi");

  assert.deepEqual(telegram.sent, ["co yeu cau rut tien moi"]);
  assert.deepEqual(zalo.sent, []);
  assert.deepEqual(unavailable, []);
});

test("createAdminNotifier: khong co Telegram thi rot xuong Zalo DM (instance Zalo-only)", async () => {
  const zalo = recordingSender();
  const unavailable: string[] = [];

  const notifyAdmin = createAdminNotifier({
    resolveTelegramSender: () => null,
    resolveZaloSender: () => zalo.send,
    logUnavailable: (message) => unavailable.push(message),
  });

  await notifyAdmin("co yeu cau rut tien moi");

  assert.deepEqual(zalo.sent, ["co yeu cau rut tien moi"]);
  assert.deepEqual(unavailable, []);
});

test("createAdminNotifier: co ca 2 kenh thi UU TIEN Telegram (giu nguyen hanh vi instance hien tai)", async () => {
  const telegram = recordingSender();
  const zalo = recordingSender();

  const notifyAdmin = createAdminNotifier({
    resolveTelegramSender: () => telegram.send,
    resolveZaloSender: () => zalo.send,
  });

  await notifyAdmin("don moi");

  assert.deepEqual(telegram.sent, ["don moi"]);
  assert.deepEqual(zalo.sent, []);
});

test("createAdminNotifier: khong co kenh nao thi log canh bao, KHONG throw", async () => {
  const unavailable: string[] = [];

  const notifyAdmin = createAdminNotifier({
    resolveTelegramSender: () => null,
    resolveZaloSender: () => null,
    logUnavailable: (message) => unavailable.push(message),
  });

  await notifyAdmin("co yeu cau rut tien moi");

  assert.deepEqual(unavailable, ["co yeu cau rut tien moi"]);
});

test("createAdminNotifier: doc sender LUC GOI, khong phai luc tao (zaloBot khoi dong sau createServer)", async () => {
  const zalo = recordingSender();
  let zaloSender: Sender | null = null;

  const notifyAdmin = createAdminNotifier({
    resolveTelegramSender: () => null,
    resolveZaloSender: () => zaloSender,
  });

  // Luc nay zaloBot chua khoi dong xong - giong dung thu tu trong src/index.ts
  zaloSender = zalo.send;

  await notifyAdmin("don moi");

  assert.deepEqual(zalo.sent, ["don moi"]);
});

test("createAdminNotifier: loi gui duoc nem ra cho caller (.catch() o call site), khong am tham doi kenh", async () => {
  const zalo = recordingSender();

  const notifyAdmin = createAdminNotifier({
    resolveTelegramSender: () => async () => {
      throw new Error("Telegram API 429");
    },
    resolveZaloSender: () => zalo.send,
  });

  await assert.rejects(() => notifyAdmin("don moi"), /Telegram API 429/);
  assert.deepEqual(zalo.sent, []);
});
