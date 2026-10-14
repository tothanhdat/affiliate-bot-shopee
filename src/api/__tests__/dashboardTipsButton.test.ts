import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDashboardPage } from "../dashboardHtml.js";

const BASE = {
  entries: [],
  availableBalance: 0,
  heldBalance: 0,
  heldEntries: [],
  debtRemaining: 0,
  debts: [],
  pendingBalance: 0,
  paidTotal: 0,
  pendingWithdrawal: null,
  thresholdVnd: 20_000,
  token: "tok123",
  platform: "zalo" as const,
  userId: "u1",
  displayName: "An",
};

// Kiem tra MARKUP, khong kiem tra stylesheet: bang CSS luon co dinh nghia .tips-pill du nut co hien hay khong.
test("co Tip dang bat: nut 💡 Tips tro dung /d/<token>/tips, nam cung hang voi tieu de", () => {
  const html = renderDashboardPage({ ...BASE, hasTips: true });
  assert.match(html, /<a class="tips-pill" href="\/d\/tok123\/tips">/);
  assert.match(html, /💡/);
  assert.match(html, /<div class="page-head"><h1>💰 Hoa hồng của bạn<\/h1><a class="tips-pill"/);
});

test("khong co Tip (hasTips false hoac vang mat): KHONG co dau vet nao cua nut trong markup", () => {
  for (const html of [renderDashboardPage(BASE), renderDashboardPage({ ...BASE, hasTips: false })]) {
    assert.doesNotMatch(html, /class="tips-pill"/);
    assert.doesNotMatch(html, /href="[^"]*\/tips"/);
    assert.doesNotMatch(html, /💡/);
    assert.match(html, /<h1>💰 Hoa hồng của bạn<\/h1>/); // tieu de van y nhu cu
  }
});

test("token duoc encode trong link", () => {
  const html = renderDashboardPage({ ...BASE, token: "a/b c", hasTips: true });
  assert.match(html, /href="\/d\/a%2Fb%20c\/tips"/);
});

test("nut Tips cho phep xuong dong tren man hinh hep va co vung bam >= 44px", () => {
  const html = renderDashboardPage({ ...BASE, hasTips: true });
  assert.match(html, /\.page-head \{[^}]*flex-wrap: wrap/);
  assert.match(html, /\.tips-pill \{[^}]*min-height: 44px/);
});
