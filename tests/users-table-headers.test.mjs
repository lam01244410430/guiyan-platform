// Users-table + headers round (2026-11-17, Lam duyet plan "lam theo mac dinh"):
// Q1 .col-account 148px -> 104px de 认证/渠道 hien du;
// Q2 删除 doi tu hang vao trong popup 编辑 (mo popup xac nhan hien co);
// Q3 ten cot (th) can giua o TAT CA bang admin, o du lieu giu nguyen.
// Source-grep assertions only, no server and no database needed.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dashboardJsx = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "js", "AdminDashboard.jsx"),
  "utf-8",
);
const css = fs.readFileSync(
  path.join(repoDir, "admin", "assets", "css", "admin.css"),
  "utf-8",
);
const serverPkg = JSON.parse(
  fs.readFileSync(path.join(repoDir, "server", "package.json"), "utf-8"),
);

test("users-table Q1: .col-account is 104px (was 148px), ellipsis + title kept", () => {
  assert.ok(
    css.includes(".tbl-wrap table th.col-account{width:104px}"),
    "admin.css missing: .col-account 104px",
  );
  assert.ok(!css.includes(".col-account{width:148px}"), "old 148px width must be gone");
  // The account cell keeps ellipsis + title tooltip so a long username
  // is still readable on hover after the shrink.
  assert.ok(
    dashboardJsx.includes('<td className="cell-ellipsis" title={usr.username}>{usr.username}</td>'),
    "account cell must keep .cell-ellipsis + title",
  );
  // Column order and labels are untouched.
  assert.ok(dashboardJsx.includes('>账号<SortButton'), "账号 header must stay");
  assert.ok(dashboardJsx.includes('>认证</th>'), "认证 header must stay");
  assert.ok(dashboardJsx.includes('className="col-shop">渠道</th>'), "渠道 header must stay");
});

test("users-table Q2: the row has no 删除 button; only 编辑 remains for users", () => {
  assert.ok(
    !dashboardJsx.includes("onClick={() => setUserDeleteTarget(usr)}"),
    "the row must not open the delete confirm directly any more",
  );
  assert.ok(
    dashboardJsx.includes('<button type="button" className="btn-view" disabled={userCrudBusyId !== null} onClick={() => openUserEditForm(usr)}>编辑</button>'),
    "the row must keep its single 编辑 button",
  );
  // Role buttons are untouched.
  assert.ok(dashboardJsx.includes('>收回管理</button>'), "收回管理 must stay");
  assert.ok(dashboardJsx.includes('>授予管理</button>'), "授予管理 must stay");
  assert.ok(dashboardJsx.includes('doToggleUserStatus(usr)'), "启用/停用 must stay");
});

test("users-table Q2: the edit popup gains a danger 删除 button opening the existing confirm", () => {
  const editStart = dashboardJsx.indexOf("<h3>编辑用户</h3>");
  assert.ok(editStart !== -1, "编辑用户 popup not found");
  const editPopup = dashboardJsx.slice(editStart, editStart + 2200);
  assert.ok(
    editPopup.includes(">删除</button>"),
    "the edit popup must hold a 删除 button",
  );
  assert.ok(
    editPopup.includes("users.find((u) => u.id === userEditForm.id)"),
    "删除 must target the stored user by id",
  );
  assert.ok(
    editPopup.includes("setUserDeleteTarget(t)"),
    "删除 must open the existing delete confirmation",
  );
  // The existing delete confirmation popup and its logic are unchanged.
  assert.ok(dashboardJsx.includes("<h3>删除用户</h3>"), "删除用户 confirm popup must stay");
  assert.ok(
    dashboardJsx.includes('onClick={() => doDeleteUser(userDeleteTarget)}'),
    "确认删除 must still call doDeleteUser",
  );
});

test("users-table Q2: the 操作 column width is scoped to the users table only", () => {
  assert.equal(
    dashboardJsx.split('className="users-table"').length - 1,
    1,
    "exactly one users-table class (the 全部用户 table)",
  );
  // Measured worst case (root viewing a non-admin user: 编辑 54 +
  // 授予管理 78 + 启用 54 + 2x8 gap = 202px content + 28px cell padding
  // = 230px; +2px margin). The plan's ~90px assumed one button, but the
  // role buttons stay and .row-actions is nowrap flex — 90px would
  // overflow the 3-button rows.
  assert.ok(
    css.includes(".tbl-wrap > table.users-table th.col-actions-wide{width:232px}"),
    "admin.css missing: users-table scoped 操作 width 232px",
  );
  // The shared class still serves the other tables that use it.
  assert.ok(
    css.includes(".tbl-wrap > table th.col-actions-wide{width:250px}"),
    "shared .col-actions-wide must stay 250px for the other tables",
  );
});

test("users-table Q3: every admin table header (th) is centred, cells unchanged", () => {
  assert.ok(
    css.includes(".tbl-wrap table th{text-align:center}"),
    "admin.css missing: centred th rule for all admin tables",
  );
  // Data cells keep their alignment: left by default, right for .num.
  assert.ok(
    css.includes("td.num,th.num{text-align:right;"),
    "td.num must stay right-aligned",
  );
  assert.ok(!css.includes(".tbl-wrap table td{text-align:center}"), "no td centring rule");
  // The 最近订单 table stays fully centred via its own .ov-recent rule.
  assert.ok(
    css.includes(".tbl-wrap.ov-recent table th,.tbl-wrap.ov-recent table td{text-align:center}"),
    ".ov-recent rule must stay",
  );
  assert.equal(
    dashboardJsx.split("tbl-wrap ov-recent").length - 1,
    1,
    "exactly one .ov-recent wrap (the 最近订单 table)",
  );
});

test("users-table test file is wired into the npm test chain", () => {
  assert.ok(
    String(serverPkg.scripts.test).includes("../tests/users-table-headers.test.mjs"),
    "server/package.json test script must run tests/users-table-headers.test.mjs",
  );
});
