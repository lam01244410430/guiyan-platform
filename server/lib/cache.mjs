// Guiyan Redis cache — fail-open, same fail-soft pattern as
// server/storage.mjs (createStorage() returns null when unconfigured;
// here the cache object is always returned but reports disabled).
//
// Driver priority (first match wins; the order is deliberate):
//   1. Upstash REST — when BOTH UPSTASH_REDIS_REST_URL and
//      UPSTASH_REDIS_REST_TOKEN are set. Stateless HTTP (@upstash/redis),
//      safe for Vercel serverless (no persistent connection to hold).
//   2. node-redis RESP — when REDIS_URL is set (docker redis for local
//      dev/test on the EC2, e.g. REDIS_URL=redis://127.0.0.1:6380).
//   3. Disabled — neither is set. Every method becomes a no-op that
//      returns null/false; the API serves Postgres directly.
// A later deploy picks up Upstash vars automatically: no code change is
// needed when UPSTASH_* appear in the Vercel environment.
//
// FAIL-OPEN, absolute: no cache method ever throws into a request path.
// A dead/unreachable Redis, a timeout, or a missing dependency is logged
// (key name + error code only — never a value, URL, or token) and the
// caller falls back to Postgres. Per-op timeout is 1s; the node-redis
// client runs with disableOfflineQueue + no reconnect, so commands fail
// fast instead of queueing while Redis is down.
//
// Key / TTL / invalidation map (namespace `guiyan:*`):
//   guiyan:resources:list          TTL 300s  unfiltered resource list
//                                  (GET /api/resources, no filters,
//                                  sort=hot). Filtered queries bypass
//                                  the cache — the key cannot encode
//                                  every filter combination.
//   guiyan:resources:hot           TTL 300s  top-3 hot resources for the
//                                  assistant "hot" answer
//                                  (GET /api/assistant?q=...hot...).
//   guiyan:admin:stats:{period}    TTL 60s   GET /api/admin/stats?period=
//                                  day|week|month|quarter (time series).
//   guiyan:admin:stats:total       TTL 60s   GET /api/admin/stats without
//                                  ?period= (cumulative totals).
//   guiyan:admin:analysis:{period} TTL 60s   GET /api/admin/analysis.
// Invalidation (bust* helpers, called from the write handlers):
//   create/transition order -> bustStats() + bustAnalysis() +
//     bustResources() (stock changes are a resource change)
//   create demand / review demand -> bustStats()
//   trigger/resolve simulated alert -> bustAnalysis() (analysis embeds
//     the alert list, which is computed from the events table)
// Sessions stay in Postgres (DB sessions table); this phase does NOT
// move sessions to Redis.

export const CACHE_TTLS = {
  resourcesList: 300,
  resourcesHot: 300,
  adminStats: 60,
  adminAnalysis: 60,
};

export const CACHE_KEYS = {
  resourcesList: "guiyan:resources:list",
  resourcesHot: "guiyan:resources:hot",
  adminStatsTotal: "guiyan:admin:stats:total",
  adminStats: (period) => `guiyan:admin:stats:${period}`,
  adminAnalysis: (period) => `guiyan:admin:analysis:${period}`,
};

const STAT_PERIODS = ["day", "week", "month", "quarter"];
const OP_TIMEOUT_MS = 1000;
const CONNECT_TIMEOUT_MS = 3000;

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("CACHE_TIMEOUT")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function normalize(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function logError(op, key, error) {
  // Never log values, URLs, or tokens — key name + error code only.
  console.error("cache failed", {
    op,
    key: Array.isArray(key) ? key.join(",") : key,
    code: error?.code || error?.message || "CACHE_ERROR",
  });
}

function disabledCache() {
  return {
    enabled: false,
    driver: "disabled",
    get: async () => null,
    set: async () => false,
    del: async () => 0,
    bustStats: async () => 0,
    bustAnalysis: async () => 0,
    bustResources: async () => 0,
    bustAdmin: async () => 0,
    bustAll: async () => 0,
    close: async () => {},
  };
}

export async function createCache(env = process.env) {
  const upstashUrl = env.UPSTASH_REDIS_REST_URL;
  const upstashToken = env.UPSTASH_REDIS_REST_TOKEN;
  const redisUrl = env.REDIS_URL;

  // --- Driver 1: Upstash REST (preferred on Vercel serverless). ---
  if (upstashUrl && upstashToken) {
    try {
      const { Redis } = await import("@upstash/redis");
      const client = new Redis({ url: upstashUrl, token: upstashToken });
      console.log("cache: enabled (upstash)");
      return buildCache("upstash", {
        get: (key) => withTimeout(client.get(key), OP_TIMEOUT_MS),
        set: (key, value, ttl) =>
          withTimeout(
            client.set(key, JSON.stringify(value), { ex: ttl }),
            OP_TIMEOUT_MS,
          ),
        del: (...keys) => withTimeout(client.del(...keys), OP_TIMEOUT_MS),
        close: async () => {},
      });
    } catch (error) {
      logError("upstash-init", "upstash", error);
      return disabledCache();
    }
  }

  // --- Driver 2: node-redis RESP (docker redis for dev/test). ---
  if (redisUrl) {
    try {
      const { createClient } = await import("redis");
      const client = createClient({
        url: redisUrl,
        disableOfflineQueue: true,
        socket: {
          connectTimeout: 2000,
          // No reconnect: a dead Redis must fail fast (fail-open),
          // not queue commands until it comes back.
          reconnectStrategy: false,
        },
      });
      client.on("error", (error) => {
        logError("redis-client", "redis", error);
      });
      await withTimeout(client.connect(), CONNECT_TIMEOUT_MS);
      console.log("cache: enabled (redis)");
      return buildCache("redis", {
        get: (key) => withTimeout(client.get(key), OP_TIMEOUT_MS),
        set: (key, value, ttl) =>
          withTimeout(
            client.set(key, JSON.stringify(value), { EX: ttl }),
            OP_TIMEOUT_MS,
          ),
        del: (...keys) => withTimeout(client.del(keys), OP_TIMEOUT_MS),
        close: async () => {
          try {
            if (client.isOpen) await client.quit();
          } catch {
            try {
              client.destroy();
            } catch {
              // best-effort shutdown only
            }
          }
        },
      });
    } catch (error) {
      logError("redis-init", "redis", error);
      return disabledCache();
    }
  }

  // --- Driver 3: disabled (no cache env vars). ---
  console.log(
    "cache: disabled (no UPSTASH_REDIS_REST_URL/TOKEN or REDIS_URL)",
  );
  return disabledCache();
}

function buildCache(driver, raw) {
  async function get(key) {
    try {
      return normalize(await raw.get(key));
    } catch (error) {
      logError("get", key, error);
      return null;
    }
  }

  async function set(key, value, ttlSeconds) {
    try {
      await raw.set(key, value, ttlSeconds);
      return true;
    } catch (error) {
      logError("set", key, error);
      return false;
    }
  }

  async function del(...keys) {
    const flat = keys.flat().filter(Boolean);
    if (flat.length === 0) return 0;
    try {
      return Number(await raw.del(...flat)) || 0;
    } catch (error) {
      logError("del", flat, error);
      return 0;
    }
  }

  // Invalidation groups — exact keys only (periods are a fixed set of
  // four, so no SCAN is needed and a bust can never miss a variant).
  const statsKeys = () => [
    CACHE_KEYS.adminStatsTotal,
    ...STAT_PERIODS.map((p) => CACHE_KEYS.adminStats(p)),
  ];
  const analysisKeys = () =>
    STAT_PERIODS.map((p) => CACHE_KEYS.adminAnalysis(p));
  const resourceKeys = () => [
    CACHE_KEYS.resourcesList,
    CACHE_KEYS.resourcesHot,
  ];

  return {
    enabled: true,
    driver,
    get,
    set,
    del,
    bustStats: () => del(statsKeys()),
    bustAnalysis: () => del(analysisKeys()),
    bustResources: () => del(resourceKeys()),
    bustAdmin: () => del([...statsKeys(), ...analysisKeys()]),
    bustAll: () => del([...statsKeys(), ...analysisKeys(), ...resourceKeys()]),
    close: raw.close,
  };
}
