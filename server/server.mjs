// Guiyan server entry — PostgreSQL only, no SQLite fallback.
//
//   DATABASE_URL=postgres://guiyan:guiyan@localhost:5432/guiyan npm start
//
// DATABASE_URL is required and the process fails fast with instructions
// when it is missing. Demo accounts are seeded on first boot from
// DEMO_PASSWORD / ADMIN_PASSWORD (see server/README.md).

// Check the environment BEFORE importing postgres.mjs, so the fail-fast
// message works even when dependencies are not installed yet.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    "DATABASE_URL is required.\n" +
      "  本地开发：cd server && docker compose up -d && cp .env.example .env && npm ci && npm start\n" +
      "  (DATABASE_URL=postgres://guiyan:guiyan@localhost:5432/guiyan)",
  );
  process.exit(1);
}

const { openPostgresStore } = await import("./postgres.mjs");
const { createApp } = await import("./app.mjs");

const database = await openPostgresStore(connectionString);
const server = await createApp({ database });
const port = Number(process.env.PORT || 3001);
server.listen(port, process.env.HOST || "0.0.0.0", () =>
  console.log(
    `桂演 API (PostgreSQL)：http://localhost:${port}  /  Web：http://localhost:${port}/  /  健康检查：http://localhost:${port}/api/health`,
  ),
);
