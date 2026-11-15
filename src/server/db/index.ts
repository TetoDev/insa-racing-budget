import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "../env";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  __pgSql?: ReturnType<typeof postgres>;
  __db?: ReturnType<typeof drizzle<typeof schema>>;
};

export function getSql() {
  if (!globalForDb.__pgSql) {
    const { databaseUrl } = getEnv();
    globalForDb.__pgSql = postgres(databaseUrl, {
      max: 15,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: notice => {
        if (notice.code !== "42P07") {
          console.info(`[postgres] ${notice.message}`);
        }
      }
    });
  }
  return globalForDb.__pgSql;
}

export function getDb() {
  if (!globalForDb.__db) {
    globalForDb.__db = drizzle(getSql(), { schema });
  }
  return globalForDb.__db;
}
