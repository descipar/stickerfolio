export type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

const sensitiveKey = /(?:authorization|cookie|password|secret|token|email|holdings?|database.?url|connection.?string)/i;
const connectionUrl = /\b(postgres(?:ql)?):\/\/[^\s"']+/gi;

function redactString(value: string): string {
  return value.replace(connectionUrl, "$1://<redacted>");
}

function redact(value: unknown, key?: string): unknown {
  if (key && sensitiveKey.test(key)) return "<redacted>";
  if (typeof value === "string") return redactString(value);
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entry]) => [entryKey, redact(entry, entryKey)]));
  }
  return value;
}

export function writeLog(level: LogLevel, event: string, context: LogContext = {}): void {
  const safeContext = redact(context) as LogContext;
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...safeContext,
    }),
  );
}
