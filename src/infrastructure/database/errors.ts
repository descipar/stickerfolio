import { DatabaseError as PgDatabaseError } from "pg";

const safeMessages: Record<string, string> = {
  "23505": "A record with the same unique value already exists.",
  "23503": "The record references data that does not exist.",
  "23502": "A required database value is missing.",
  "40001": "The database operation must be retried.",
};

export class DatabaseError extends Error {
  readonly code?: string;

  constructor(message = "The database operation failed.", options?: { cause?: unknown; code?: string }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DatabaseError";
    this.code = options?.code;
  }
}

export function toDatabaseError(error: unknown): DatabaseError {
  if (error instanceof DatabaseError) return error;

  const code = error instanceof PgDatabaseError ? error.code : undefined;
  return new DatabaseError(code ? (safeMessages[code] ?? "The database operation failed.") : undefined, {
    cause: error,
    code,
  });
}
