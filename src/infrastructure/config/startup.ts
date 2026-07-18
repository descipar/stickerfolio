import "server-only";

import { getEnvironment } from "./environment";

export function validateEnvironmentOrExit(): void {
  try {
    getEnvironment();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid Stickerfolio environment configuration";
    console.error(message);
    process.exit(1);
  }
}
