import { parseEnvironment, type AppEnvironment } from "@/infrastructure/config";

export function createTestEnvironment(databaseUrl: string): AppEnvironment {
  return parseEnvironment({
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    APP_BASE_URL: "http://localhost:3500",
    BETTER_AUTH_SECRET: "integration-test-secret-with-at-least-32-characters",
    REGISTRATION_MODE: "closed",
  });
}
