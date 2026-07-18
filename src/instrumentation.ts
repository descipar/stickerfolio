export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnvironmentOrExit } = await import("@/infrastructure/config/startup");
    validateEnvironmentOrExit();
  }
}
