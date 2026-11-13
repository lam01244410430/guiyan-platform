// Guiyan API — customer routes and an admin dashboard.
//
// A focused subset of the original group demo API (guiyan-demo/server/
// index.mjs). Admin dashboard added 2026-11-10, read-only; Wave 4 #16
// (2026-11-12) adds admin resource management
// (server/routes/admin-resources.mjs) — the only admin writes to
// resources; everything else admin stays read-only except demand
// review, alert handling, tag rules and CSV export.
// JSON only; Chinese canonical data (UI translation
// stays client-side); all money in INTEGER cents; parameterised queries
// only; every write runs inside a transaction (see createRequestHandler).
//
// Differences from the original, deliberate for this customer-facing
// backend (also noted in server/README.md):
// - Order confirm is done by the order owner (demo simplification: there
//   is no operator UI in this redesign; in production confirm/reject is
//   the operator's job).
// - Refund goes paid -> refund_requested and waits for an admin decision
//   (Wave 4 #13); approveRefund moves it to refunded, escrow "已模拟退款".
//   The original had the same intermediate state, approved by an operator.
// - Registration (POST /api/auth/register, phase 3) creates a fixed-role
//   user and auto-logs them in. No email verification in this phase:
//   there is no email provider, and email is optional.

import http from "node:http";
import { categories } from "./seed.mjs";
import { assert, time, yuan } from "./lib/http.mjs";
import { createContext } from "./lib/context.mjs";
import { createCache } from "./lib/cache.mjs";
import { serveStatic } from "./static.mjs";
import { health, listCategories } from "./routes/misc.mjs";
import { listResources, getResource, getAvailability, viewResource } from "./routes/resources.mjs";
import { login, logout, register, changePassword } from "./routes/auth.mjs";
import { wechatMini } from "./routes/oauth.mjs";
import { patchProfile, uploadAvatar, sendOtp, verifyOtp, patchEmail, patchPhone, patchSocial } from "./routes/account.mjs";
import { listOrders, createOrder, transitionOrder, getOrderContract } from "./routes/orders.mjs";
import { listDemands, createDemand } from "./routes/demands.mjs";
import { listMessages, markMessageRead, markAllMessagesRead } from "./routes/messages.mjs";
import { listFavorites, toggleFavorite, deleteFavorite } from "./routes/favorites.mjs";
import { ANSWERS, assistant } from "./routes/assistant.mjs";
import { getProfile, getRecommendations } from "./routes/profile.mjs";
import { aiCopy } from "./routes/ai-copy.mjs";
import { storageHealth, storageUpload, storageUrl, storageDelete } from "./routes/storage.mjs";
import { adminStats, adminOrders, adminUsers, adminDemands } from "./routes/admin.mjs";
import { adminStatsSeries, adminAnalysis, adminAlerts, adminOrdersCsv, adminReviewDemand, adminAuditLogs } from "./routes/admin-insights.mjs";
import { adminTagRules } from "./routes/tag-rules.mjs";
import { createAdminResource, editAdminResource, listAdminResources, syncAdminResource } from "./routes/admin-resources.mjs";
import { listAdminShops, createAdminShop, patchAdminShop, getShopTheme, patchShopTheme } from "./routes/shops.mjs";
import { createShow, listShows, getShow, listAdminShows, reviewShow, createPerformance, patchPerformance } from "./routes/shows.mjs";
import { createTicketType, listTicketTypes, patchTicketType } from "./routes/ticket-types.mjs";
import { patchAdminProfile, patchAdminUserStatus, adminChangePassword } from "./routes/admin-account.mjs";

// Commit before sending the response, so the next request sees saved changes.
function createRequestHandler(db, handle) {
  return async (req, res) => {
    const end = res.end;
    let pending;
    res.end = function (...args) {
      pending = args;
      return this;
    };
    try {
      await db.request(() => handle(req, res), {
        // GET /api/admin/orders.csv writes exactly one audit row
        // ("导出报表"), so it needs a write transaction like the POSTs.
        write:
          !["GET", "HEAD", "OPTIONS"].includes(req.method) ||
          new URL(req.url, "http://localhost").pathname ===
            "/api/admin/orders.csv",
        success: () => res.statusCode < 400,
      });
      res.end = end;
      res.end(...(pending || []));
    } catch (error) {
      res.end = end;
      console.error("Request transaction failed", {
        code: error.code || "DATABASE_UNAVAILABLE",
      });
      if (!res.headersSent)
        res.writeHead(503, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
      res.end(JSON.stringify({ error: "数据库暂时不可用，请稍后重试" }));
    }
  };
}

export async function createApp({ database }) {
  const db = database;
  const context = createContext(database);
  const { get } = context;
  // Redis cache is fail-open (see server/lib/cache.mjs): when Redis is
  // unconfigured or down this is a disabled no-op cache and every route
  // serves Postgres directly. Covers Vercel too — api/index.js reuses
  // createApp, and the Upstash REST driver holds no connection.
  const cache = await createCache();

  const handleApi = async (req, res) => {
    const send = (value, status = 200) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    const url = new URL(req.url, "http://localhost"),
      p = url.pathname;
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      });
      res.end();
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      let b = {};
      if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          assert(Buffer.byteLength(raw) < 300000, "请求内容过长", 413);
        }
        try {
          b = raw ? JSON.parse(raw) : {};
        } catch {
          assert(false, "请求数据格式错误");
        }
        assert(
          b && typeof b === "object" && !Array.isArray(b),
          "请求数据必须为对象",
        );
      }
      const token = req.headers.authorization?.replace(/^Bearer /, "");
      const session = token
        ? await get(
            // R1-2: a disabled account's sessions stop resolving at
            // once — the token is dead the moment the account is
            // disabled, without waiting for its expiry.
            "SELECT u.* FROM sessions s JOIN users u ON s.user_id=u.id WHERE token=? AND expires_at>? AND (u.status IS NULL OR u.status<>'disabled')",
            token,
            time(),
          )
        : null;
      const needUser = () => {
        assert(session, "请先登录", 401);
        return session;
      };

      const ctx = {
        ...context,
        req, res, send, url, p, b, session, needUser, categories, time, yuan, ANSWERS, cache,
      };

      // Routing table: preserve the original handleApi check order.
      if (await health(ctx)) return;
      if (await listCategories(ctx)) return;
      if (await listResources(ctx)) return;
      if (await getResource(ctx)) return;
      if (await getAvailability(ctx)) return;
      if (await viewResource(ctx)) return;
      if (await login(ctx)) return;
      if (await register(ctx)) return;
      if (await logout(ctx)) return;
      if (await changePassword(ctx)) return;
      if (await wechatMini(ctx)) return;
      if (await patchProfile(ctx)) return;
      if (await uploadAvatar(ctx)) return;
      if (await sendOtp(ctx)) return;
      if (await verifyOtp(ctx)) return;
      if (await patchEmail(ctx)) return;
      if (await patchPhone(ctx)) return;
      if (await patchSocial(ctx)) return;
      if (await listOrders(ctx)) return;
      if (await createOrder(ctx)) return;
      if (await transitionOrder(ctx)) return;
      if (await getOrderContract(ctx)) return;
      if (await listMessages(ctx)) return;
      if (await markMessageRead(ctx)) return;
      if (await markAllMessagesRead(ctx)) return;
      if (await listDemands(ctx)) return;
      if (await createDemand(ctx)) return;
      if (await listFavorites(ctx)) return;
      if (await toggleFavorite(ctx)) return;
      if (await deleteFavorite(ctx)) return;
      if (await assistant(ctx)) return;
      if (await getProfile(ctx)) return;
      if (await getRecommendations(ctx)) return;
      if (await aiCopy(ctx)) return;
      if (await storageHealth(ctx)) return;
      if (await storageUpload(ctx)) return;
      if (await storageUrl(ctx)) return;
      if (await storageDelete(ctx)) return;
      if (await adminStats(ctx)) return;
      if (await adminOrders(ctx)) return;
      if (await adminUsers(ctx)) return;
      if (await adminDemands(ctx)) return;
      if (await adminStatsSeries(ctx)) return;
      if (await adminAnalysis(ctx)) return;
      if (await adminAlerts(ctx)) return;
      if (await adminOrdersCsv(ctx)) return;
      if (await adminReviewDemand(ctx)) return;
      if (await adminAuditLogs(ctx)) return;
      if (await adminTagRules(ctx)) return;
      if (await listAdminResources(ctx)) return;
      if (await createAdminResource(ctx)) return;
      if (await editAdminResource(ctx)) return;
      if (await syncAdminResource(ctx)) return;
      if (await listAdminShops(ctx)) return;
      if (await createAdminShop(ctx)) return;
      if (await patchAdminShop(ctx)) return;
      if (await getShopTheme(ctx)) return;
      if (await patchShopTheme(ctx)) return;
      if (await createShow(ctx)) return;
      if (await listShows(ctx)) return;
      if (await getShow(ctx)) return;
      if (await listAdminShows(ctx)) return;
      if (await reviewShow(ctx)) return;
      if (await createPerformance(ctx)) return;
      if (await patchPerformance(ctx)) return;
      if (await createTicketType(ctx)) return;
      if (await listTicketTypes(ctx)) return;
      if (await patchTicketType(ctx)) return;
      if (await patchAdminProfile(ctx)) return;
      if (await patchAdminUserStatus(ctx)) return;
      if (await adminChangePassword(ctx)) return;

      send({ error: "接口不存在" }, 404);
    } catch (e) {
      if (e.code === "23505")
        Object.assign(e, { status: 409, message: "记录已存在，请刷新后重试" });
      if (!e.status)
        console.error("Business request failed", {
          code: e.code || "INTERNAL_ERROR",
        });
      send(
        { error: e.status ? e.message : "服务暂时无法处理请求" },
        e.status || 500,
      );
    }
  };

  const apiHandler = createRequestHandler(db, handleApi);
  const handler = async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/api/")) {
      return serveStatic(req, res);
    }
    return apiHandler(req, res);
  };

  const server = http.createServer(handler);
  server.handler = handler;
  server.on("close", () => {
    db.close();
    cache.close().catch(() => {});
  });
  return server;
}
