import { query, type QueryExecutor } from "@/infrastructure/database";

import { appVersion, getVersionInformation, type VersionInformation } from "./version";

export interface LivenessStatus {
  status: "ok";
  appVersion: string;
}

export interface ReadinessStatus extends VersionInformation {
  status: "ready";
}

export function getLivenessStatus(): LivenessStatus {
  return { status: "ok", appVersion };
}

export async function getReadinessStatus(executor?: QueryExecutor): Promise<ReadinessStatus> {
  await query("SELECT 1", [], executor);
  return { status: "ready", ...(await getVersionInformation(executor)) };
}
