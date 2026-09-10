import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  DEFAULT_NEW_SESSION_PATH,
  PROTECTED_SESSION_PATH,
  resolveSessionOutputPath,
} from "../zaloLoginPaths.js";

const neverExists = () => false;
const alwaysExists = () => true;

test("khong truyen --out -> dung duong dan rieng mac dinh, KHONG phai file session cua bot dang chay", () => {
  const result = resolveSessionOutputPath({ force: false, fileExists: neverExists });

  assert.equal(result, DEFAULT_NEW_SESSION_PATH);
  assert.notEqual(resolve(result), resolve(PROTECTED_SESSION_PATH));
});

test("truyen --out tro dung vao file session cua bot dang chay -> TU CHOI", () => {
  assert.throws(
    () => resolveSessionOutputPath({ requestedPath: PROTECTED_SESSION_PATH, force: false, fileExists: neverExists }),
    /session cua bot dang chay/i
  );
});

test("tu choi file session cua bot dang chay du viet duong dan kieu khac (khong co './', hoac duong dan tuyet doi)", () => {
  for (const variant of ["data/zalo-session.json", resolve(PROTECTED_SESSION_PATH)]) {
    assert.throws(
      () => resolveSessionOutputPath({ requestedPath: variant, force: false, fileExists: neverExists }),
      /session cua bot dang chay/i,
      `phai tu choi: ${variant}`
    );
  }
});

test("--force KHONG mo duong cho file session cua bot dang chay (chan tuyet doi)", () => {
  assert.throws(
    () => resolveSessionOutputPath({ requestedPath: PROTECTED_SESSION_PATH, force: true, fileExists: alwaysExists }),
    /session cua bot dang chay/i
  );
});

test("file dich da ton tai + khong --force -> TU CHOI kem huong dan", () => {
  assert.throws(
    () => resolveSessionOutputPath({ force: false, fileExists: alwaysExists }),
    /--force/
  );
});

test("file dich da ton tai + co --force -> cho ghi de", () => {
  const result = resolveSessionOutputPath({ force: true, fileExists: alwaysExists });

  assert.equal(result, DEFAULT_NEW_SESSION_PATH);
});

test("duong dan tuy chon khac -> dung nguyen gia tri truyen vao", () => {
  const result = resolveSessionOutputPath({
    requestedPath: "./data/zalo-session-bot3.json",
    force: false,
    fileExists: neverExists,
  });

  assert.equal(result, "./data/zalo-session-bot3.json");
});
