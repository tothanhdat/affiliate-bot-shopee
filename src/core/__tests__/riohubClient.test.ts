import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RiohubClient,
  RiohubApiError,
  RiohubUnreachableError,
  type RiohubFetchLike,
} from "../providers/riohubClient.js";

const BASES = ["https://a.test/api/v1", "https://b.test/api/v1", "https://c.test/api/v1"];

function connErr(code: string): Error {
  const e = new Error("connection failed");
  (e as unknown as { cause: { code: string } }).cause = { code };
  return e;
}

function okResponse(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload };
}

function errResponse(status: number, code: string, message: string) {
  return { ok: false, status, json: async () => ({ error: { code, message } }) };
}

test("loi DNS o mien dau -> thu mien ke tiep", async () => {
  const seen: string[] = [];
  const fetchImpl: RiohubFetchLike = async (url) => {
    seen.push(url);
    if (url.startsWith("https://a.test")) throw connErr("ENOTFOUND");
    return okResponse({ affiliate_link: "https://x" });
  };
  const client = new RiohubClient({ apiKey: "k", baseUrls: BASES, fetchImpl });
  const res = await client.post<{ affiliate_link: string }>("/p", {});
  assert.equal(res.affiliate_link, "https://x");
  assert.equal(seen.length, 2);
  assert.ok(seen[1].startsWith("https://b.test"));
});

test("loi TLS sai ten mien cung phai nhay mien - bai hoc su co 29/09/2026", async () => {
  const seen: string[] = [];
  const fetchImpl: RiohubFetchLike = async (url) => {
    seen.push(url);
    if (url.startsWith("https://a.test")) throw connErr("ERR_TLS_CERT_ALTNAME_INVALID");
    return okResponse({ ok: 1 });
  };
  const client = new RiohubClient({ apiKey: "k", baseUrls: BASES, fetchImpl });
  await client.post("/p", {});
  assert.equal(seen.length, 2, "phai thu mien thu hai");
});

test("HTTP 500 -> DUNG LAI, KHONG thu mien khac", async () => {
  const seen: string[] = [];
  const fetchImpl: RiohubFetchLike = async (url) => {
    seen.push(url);
    return errResponse(500, "server_error", "Internal server error");
  };
  const client = new RiohubClient({ apiKey: "k", baseUrls: BASES, fetchImpl });
  await assert.rejects(
    () => client.post("/p", {}),
    (err: unknown) => {
      assert.ok(err instanceof RiohubApiError);
      assert.equal(err.code, "server_error");
      assert.equal(err.httpStatus, 500);
      return true;
    }
  );
  assert.equal(seen.length, 1, "5xx la he thong DA nhan request - doi mien chi ton quota");
});

test("422 cung khong doi mien, giu nguyen error.code", async () => {
  const fetchImpl: RiohubFetchLike = async () =>
    errResponse(422, "product_not_promotable", "no commission");
  const client = new RiohubClient({ apiKey: "k", baseUrls: BASES, fetchImpl });
  await assert.rejects(
    () => client.post("/p", {}),
    (err: unknown) => err instanceof RiohubApiError && err.code === "product_not_promotable"
  );
});

test("ghim mien da chay duoc cho cac lan goi sau", async () => {
  const seen: string[] = [];
  const fetchImpl: RiohubFetchLike = async (url) => {
    seen.push(url);
    if (url.startsWith("https://a.test")) throw connErr("ETIMEDOUT");
    return okResponse({ ok: 1 });
  };
  const client = new RiohubClient({ apiKey: "k", baseUrls: BASES, fetchImpl });
  await client.post("/p", {});
  seen.length = 0;
  await client.post("/p", {});
  assert.equal(seen.length, 1, "khong duoc cho moi request lai cho timeout o mien dau");
  assert.ok(seen[0].startsWith("https://b.test"));
});

test("hong ca 3 mien -> RiohubUnreachableError", async () => {
  const fetchImpl: RiohubFetchLike = async () => {
    throw connErr("ECONNREFUSED");
  };
  const client = new RiohubClient({ apiKey: "k", baseUrls: BASES, fetchImpl });
  await assert.rejects(
    () => client.post("/p", {}),
    (err: unknown) => err instanceof RiohubUnreachableError && err.attempts === 3
  );
});

test("gui dung header xac thuc va body JSON", async () => {
  let captured: { headers?: Record<string, string>; body?: string } = {};
  const fetchImpl: RiohubFetchLike = async (_url, init) => {
    captured = init ?? {};
    return okResponse({ ok: 1 });
  };
  const client = new RiohubClient({ apiKey: "secret-key", baseUrls: BASES, fetchImpl });
  await client.post("/p", { sub_id: "m-1-2-3" });
  assert.equal(captured.headers?.["X-Riohub-Api-Key"], "secret-key");
  assert.equal(JSON.parse(captured.body ?? "{}").sub_id, "m-1-2-3");
});

test("body loi khong phai JSON van ra RiohubApiError co code mac dinh", async () => {
  const fetchImpl: RiohubFetchLike = async () => ({
    ok: false,
    status: 502,
    json: async () => {
      throw new Error("not json");
    },
  });
  const client = new RiohubClient({ apiKey: "k", baseUrls: BASES, fetchImpl });
  await assert.rejects(
    () => client.post("/p", {}),
    (err: unknown) => err instanceof RiohubApiError && err.code === "unknown_error"
  );
});

test("get: ghep query string, bo tham so rong", async () => {
  let seen = "";
  const fetchImpl: RiohubFetchLike = async (url) => {
    seen = url;
    return okResponse({ data: [] });
  };
  const client = new RiohubClient({ apiKey: "k", baseUrls: BASES, fetchImpl });
  await client.get("/orders", { creator_username: "c1", page_size: 20, sub_id: undefined, trace_id: "" });
  assert.ok(seen.startsWith("https://a.test/api/v1/orders?"));
  const qs = new URL(seen).searchParams;
  assert.equal(qs.get("creator_username"), "c1");
  assert.equal(qs.get("page_size"), "20");
  // RioHub NUOT im lang tham so sai - gui len tham so rong la tu lam mu mat minh (xem doc cua get).
  assert.equal(qs.has("sub_id"), false);
  assert.equal(qs.has("trace_id"), false);
});

test("get: khong co query thi KHONG de lai dau '?' thua", async () => {
  let seen = "";
  const fetchImpl: RiohubFetchLike = async (url) => {
    seen = url;
    return okResponse({});
  };
  const client = new RiohubClient({ apiKey: "k", baseUrls: BASES, fetchImpl });
  await client.get("/orders");
  assert.equal(seen, "https://a.test/api/v1/orders");
});

test("get: dung CHUNG quy tac du phong ten mien voi post", async () => {
  const seen: string[] = [];
  const fetchImpl: RiohubFetchLike = async (url) => {
    seen.push(url);
    if (url.startsWith("https://a.test")) throw connErr("ENOTFOUND");
    return okResponse({ ok: 1 });
  };
  const client = new RiohubClient({ apiKey: "k", baseUrls: BASES, fetchImpl });
  await client.get("/orders", { page: 1 });
  assert.equal(seen.length, 2);
  assert.ok(seen[1].startsWith("https://b.test"));
});

test("get: gui header xac thuc va dung method GET", async () => {
  let init: { method?: string; headers?: Record<string, string> } = {};
  const fetchImpl: RiohubFetchLike = async (_url, got) => {
    init = got ?? {};
    return okResponse({});
  };
  const client = new RiohubClient({ apiKey: "secret-key", baseUrls: BASES, fetchImpl });
  await client.get("/orders");
  assert.equal(init.method, "GET");
  assert.equal(init.headers?.["X-Riohub-Api-Key"], "secret-key");
});
