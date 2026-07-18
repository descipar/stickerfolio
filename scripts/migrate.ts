import { closeDatabasePool } from "@/infrastructure/database";
import { getEnvironment } from "@/infrastructure/config";
import { runMigrations } from "@/infrastructure/database/migrations";
import { bootstrapInitialAdmin } from "@/modules/identity";

const direction = process.argv[2] === "down" ? "down" : "up";

async function main(): Promise<void> {
  try {
    const applied = await runMigrations(getEnvironment(), direction);
    if (direction === "up") await bootstrapInitialAdmin();
    console.info(`${direction === "up" ? "Applied" : "Reverted"} ${applied.length} migration(s).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Database migration failed.");
    process.exitCode = 1;
  } finally {
    await closeDatabasePool();
  }
}

void main();
