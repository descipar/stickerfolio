export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnvironmentOrExit } = await import("@/infrastructure/config/startup");
    validateEnvironmentOrExit();
    const { getEnvironment } = await import("@/infrastructure/config");
    const { appVersion, writeAuditEvent, writeLog } = await import("@/infrastructure/observability");
    writeLog("info", "application.configured", { appVersion });
    const { isClientAddressPreloadActive } = await import("@/infrastructure/http");
    if (!getEnvironment().auth.trustedIpHeader && !isClientAddressPreloadActive()) {
      // Without a per-client key, every client shares one rate-limit bucket and
      // a single client can throttle sign-ins for everyone (#124).
      writeLog("warn", "security.rate_limit_shared_client_key", {
        hint: "Load scripts/client-address-preload.mjs with node --import (the Docker image does), or set AUTH_TRUSTED_IP_HEADER behind a trusted proxy.",
      });
    }
    const registrationMode = getEnvironment().registrationMode;
    writeAuditEvent(
      "registration_mode.configured",
      { type: "system" },
      { type: "registration_mode", id: "application" },
      { mode: registrationMode },
    );
  }
}
