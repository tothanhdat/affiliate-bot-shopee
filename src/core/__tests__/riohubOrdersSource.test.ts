import { test } from "node:test";
import assert from "node:assert/strict";
import { createTiktokOrdersFetcher, fetchTiktokOrders } from "../providers/riohubOrdersSource.js";
import type { RiohubOrderRecord } from "../tiktokOrderImport.js";

type Query = Record<string, string | number | undefined>;

function fakeClient(pages: Array<RiohubOrderRecord[] | object>, calls: Query[] = []) {
  return {
    get: async <T>(_path: string, query: Query): Promise<T> => {
      calls.push(query);
      const page = Number(query.page);
      const body = pages[page - 1] ?? [];
      return (Array.isArray(body) ? { data: body } : body) as T;
    },
  };
}

const row = (i: number): RiohubOrderRecord => ({ order_id: `O${i}`, sku_id: `S${i}` });
const rows = (from: number, n: number) => Array.from({ length: n }, (_, k) => row(from + k));

test("1 trang chua day -> tra het, goi dung 1 lan, gui creator_username va page_size", async () => {
  const calls: Query[] = [];
  const out = await fetchTiktokOrders(fakeClient([rows(0, 3)], calls) as never, "creator1");
  assert.equal(out.length, 3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].creator_username, "creator1");
  assert.equal(calls[0].page_size, 200);
});

test("trang day 200 -> lay tiep trang sau, gop lai", async () => {
  const calls: Query[] = [];
  const out = await fetchTiktokOrders(fakeClient([rows(0, 200), rows(200, 3)], calls) as never, "c");
  assert.equal(out.length, 203);
  assert.deepEqual(calls.map((c) => c.page), [1, 2]);
});

test("tham so `page` bi API nuot (trang sau tra y het trang truoc) -> NEM LOI, khong lap vo han", async () => {
  const same = rows(0, 200);
  await assert.rejects(
    () => fetchTiktokOrders(fakeClient([same, same, same]) as never, "c"),
    /phan trang/i
  );
});

test("phan hoi khong co `data` lan `orders` -> nem loi, KHONG coi la 0 don", async () => {
  await assert.rejects(() => fetchTiktokOrders(fakeClient([{ total: 5 }]) as never, "c"), /dinh dang/i);
});

test("createTiktokOrdersFetcher: tat hoac thieu cau hinh -> null", () => {
  const base = { enabled: true, apiKey: "k", creatorUsername: "u", baseUrls: [], timeoutMs: 1000 };
  assert.equal(createTiktokOrdersFetcher({ ...base, enabled: false }), null);
  assert.equal(createTiktokOrdersFetcher({ ...base, apiKey: "" }), null);
  assert.equal(createTiktokOrdersFetcher({ ...base, creatorUsername: "" }), null);
  assert.equal(typeof createTiktokOrdersFetcher(base), "function");
});
