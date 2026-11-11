// Guiyan Redis cache tests — unit level, no Postgres, no HTTP server.
//
//   npm --prefix server test            # runs the disabled + dead-URL
//                                       # tests; live-redis tests skip
//   REDIS_URL=redis://127.0.0.1:6380 npm --prefix server test
//                                       # also runs live hit/miss/TTL/
//                                       # bust + post-disconnect tests
//
// The HTTP-level cache tests (X-Cache HIT/MISS, invalidation after a
// write, fail-open with redis stopped) live in tests/api-pg.test.mjs,
// which talks to the real server.
import test from "node:test";
import assert from "node:assert/strict";
import { createCache, CACHE_KEYS, CACHE_TTLS } from "../server/lib/cache.mjs";

const LIVE_URL = process.env.REDIS_URL;
const live = { skip: !LIVE_URL, todo: false };

test("cache keys and TTLs are the documented map", () => {
  assert.equal(CACHE_KEYS.resourcesList, "guiyan:resources:list");
  assert.equal(CACHE_KEYS.resourcesHot, "guiyan:resources:hot");
  assert.equal(CACHE_KEYS.adminStatsTotal, "guiyan:admin:stats:total");
  assert.equal(CACHE_KEYS.adminStats("day"), "guiyan:admin:stats:day");
  assert.equal(CACHE_KEYS.adminAnalysis("week"), "guiyan:admin:analysis:week");
  assert.equal(CACHE_TTLS.resourcesList, 300);
  assert.equal(CACHE_TTLS.resourcesHot, 300);
  assert.equal(CACHE_TTLS.adminStats, 60);
  assert.equal(CACHE_TTLS.adminAnalysis, 60);
});

test("disabled cache (no env) never throws and always misses", async () => {
  const cache = await createCache({});
  assert.equal(cache.enabled, false);
  assert.equal(cache.driver, "disabled");
  assert.equal(await cache.get("guiyan:resources:list"), null);
  assert.equal(await cache.set("guiyan:resources:list", { a: 1 }, 60), false);
  assert.equal(await cache.del("guiyan:resources:list"), 0);
  assert.equal(await cache.bustStats(), 0);
  assert.equal(await cache.bustAnalysis(), 0);
  assert.equal(await cache.bustResources(), 0);
  assert.equal(await cache.bustAdmin(), 0);
  assert.equal(await cache.bustAll(), 0);
  await cache.close();
});

test("dead REDIS_URL fails open fast and never throws", async () => {
  const start = Date.now();
  const cache = await createCache({ REDIS_URL: "redis://127.0.0.1:6399" });
  assert.equal(cache.enabled, false);
  assert.equal(cache.driver, "disabled");
  assert.equal(await cache.get("guiyan:resources:list"), null);
  assert.equal(await cache.set("guiyan:resources:list", { a: 1 }, 60), false);
  assert.equal(await cache.del("guiyan:resources:list"), 0);
  await cache.close();
  // Connect must not hang: dead host fails in well under 5s.
  assert.ok(Date.now() - start < 5000, `took ${Date.now() - start}ms`);
});

test("Upstash vars take priority over REDIS_URL (driver selection)", async () => {
  // No live Upstash endpoint is needed: the constructor does not
  // connect, and the per-op timeout makes the failed REST call return
  // null instead of hanging. This only proves priority, not Upstash.
  const cache = await createCache({
    UPSTASH_REDIS_REST_URL: "https://127.0.0.1:9",
    UPSTASH_REDIS_REST_TOKEN: "dead-token-for-priority-test",
    REDIS_URL: LIVE_URL || "redis://127.0.0.1:6399",
  });
  assert.equal(cache.driver, "upstash");
  assert.equal(cache.enabled, true);
  assert.equal(await cache.get("guiyan:resources:list"), null);
  await cache.close();
});

test("live redis: set/get round-trip, miss, TTL expiry", live, async () => {
  const cache = await createCache({ REDIS_URL: LIVE_URL });
  assert.equal(cache.enabled, true);
  assert.equal(cache.driver, "redis");
  const key = "guiyan:test:roundtrip";
  try {
    assert.equal(await cache.get(key), null);
    assert.equal(await cache.set(key, { n: 42, s: "x" }, 60), true);
    assert.deepEqual(await cache.get(key), { n: 42, s: "x" });
    assert.equal(await cache.set(key, "plain", 1), true);
    assert.equal(await cache.get(key), "plain");
    await new Promise((r) => setTimeout(r, 1300));
    assert.equal(await cache.get(key), null, "1s TTL must expire");
  } finally {
    await cache.del(key);
    await cache.close();
  }
});

test("live redis: bust helpers delete exactly their key groups", live, async () => {
  const cache = await createCache({ REDIS_URL: LIVE_URL });
  try {
    const seed = async () => {
      await cache.set(CACHE_KEYS.resourcesList, [1], 300);
      await cache.set(CACHE_KEYS.resourcesHot, [2], 300);
      await cache.set(CACHE_KEYS.adminStatsTotal, { t: 1 }, 60);
      await cache.set(CACHE_KEYS.adminStats("day"), { t: 1 }, 60);
      await cache.set(CACHE_KEYS.adminStats("week"), { t: 1 }, 60);
      await cache.set(CACHE_KEYS.adminAnalysis("day"), { t: 1 }, 60);
      await cache.set(CACHE_KEYS.adminAnalysis("month"), { t: 1 }, 60);
    };
    await seed();
    assert.ok((await cache.bustStats()) >= 3, "stats bust deletes total+periods");
    assert.equal(await cache.get(CACHE_KEYS.adminStatsTotal), null);
    assert.equal(await cache.get(CACHE_KEYS.adminStats("day")), null);
    assert.deepEqual(await cache.get(CACHE_KEYS.resourcesList), [1], "stats bust must not touch resources");
    assert.deepEqual(await cache.get(CACHE_KEYS.adminAnalysis("day")), { t: 1 }, "stats bust must not touch analysis");

    await seed();
    assert.ok((await cache.bustAnalysis()) >= 2);
    assert.equal(await cache.get(CACHE_KEYS.adminAnalysis("day")), null);
    assert.deepEqual(await cache.get(CACHE_KEYS.resourcesList), [1]);

    await seed();
    assert.ok((await cache.bustResources()) >= 2);
    assert.equal(await cache.get(CACHE_KEYS.resourcesList), null);
    assert.equal(await cache.get(CACHE_KEYS.resourcesHot), null);
    assert.deepEqual(await cache.get(CACHE_KEYS.adminStats("day")), { t: 1 });

    await seed();
    assert.ok((await cache.bustAll()) >= 7);
    assert.equal(await cache.get(CACHE_KEYS.resourcesList), null);
    assert.equal(await cache.get(CACHE_KEYS.adminStats("day")), null);
    assert.equal(await cache.get(CACHE_KEYS.adminAnalysis("day")), null);
  } finally {
    await cache.bustAll();
    await cache.close();
  }
});

test("live redis: ops after close fail open instead of throwing", live, async () => {
  const cache = await createCache({ REDIS_URL: LIVE_URL });
  assert.equal(cache.enabled, true);
  await cache.set("guiyan:test:after-close", { a: 1 }, 60);
  await cache.close();
  const start = Date.now();
  assert.equal(await cache.get("guiyan:test:after-close"), null);
  assert.equal(await cache.set("guiyan:test:after-close", { a: 2 }, 60), false);
  assert.equal(await cache.del("guiyan:test:after-close"), 0);
  assert.equal(await cache.bustAll(), 0);
  assert.ok(Date.now() - start < 5000, "post-close ops must fail fast");
  // The key may still be in redis (close does not flush); clean it with
  // a fresh client so no test key leaks.
  const fresh = await createCache({ REDIS_URL: LIVE_URL });
  await fresh.del("guiyan:test:after-close");
  await fresh.close();
});
