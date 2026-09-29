import type { Pool, PoolClient } from "pg";
import { buildCounterType, formatStableId, type IdentifierFamily } from "../../shared/identifiers";
import { DatabaseError, toDatabaseError } from "./errors";

// Allocates the next stable ID for a project namespace. The upsert is a
// single statement — atomic under concurrency — and monotonic, so an
// allocated code is never handed out twice or reused after removal.
// Regeneration paths must look up existing codes, never call this again for
// a surviving concept (tasks.md TASK-004 acceptance: IDs survive
// regeneration).
export async function allocateStableId(
  poolOrClient: Pool | PoolClient,
  projectId: string,
  family: IdentifierFamily,
  category?: string,
): Promise<string> {
  // Validate before touching the database: malformed requests must not
  // advance the counter or create rows.
  const counterType = buildCounterType(family, category);
  if (projectId.trim() === "") {
    throw new DatabaseError("query", "Cannot allocate a stable ID without a project ID.");
  }
  try {
    const result = await poolOrClient.query(
      `INSERT INTO project_counters (id, project_id, counter_type, current_value, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 1, now())
       ON CONFLICT (project_id, counter_type)
       DO UPDATE SET current_value = project_counters.current_value + 1, updated_at = now()
       RETURNING current_value`,
      [projectId, counterType],
    );
    const row = result.rows[0] as { current_value: number } | undefined;
    if (!row) {
      throw new DatabaseError("query", "Stable ID counter returned no sequence.");
    }
    return formatStableId(family, Number(row.current_value), category);
  } catch (cause) {
    if (cause instanceof DatabaseError) throw cause;
    throw toDatabaseError("query", cause);
  }
}
