export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnvironmentOrExit } = await import("@/infrastructure/config/startup");
    validateEnvironmentOrExit();
    const { getEnvironment } = await import("@/infrastructure/config");
    const { appVersion, writeAuditEvent, writeLog } = await import("@/infrastructure/observability");
    writeLog("info", "application.configured", { appVersion });
    const registrationMode = getEnvironment().registrationMode;
    writeAuditEvent(
      "registration_mode.configured",
      { type: "system" },
      { type: "registration_mode", id: "application" },
      { mode: registrationMode },
    );
  }
}
