import { closeDatabasePool, runMigrations } from "@/infrastructure/database";
import { getEnvironment } from "@/infrastructure/config";

const direction = process.argv[2] === "down" ? "down" : "up";

try {
  const applied = await runMigrations(getEnvironment(), direction);
  console.info(`${direction === "up" ? "Applied" : "Reverted"} ${applied.length} migration(s).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Database migration failed.");
  process.exitCode = 1;
} finally {
  await closeDatabasePool();
}
