// Agent Kit download route (TASK-114, FR-122).
//
// Streams the assembled ZIP for the authorized project and records the
// export afterwards (history.ts). Assembly and zipping are read-only and
// in-memory: a failure throws before any bytes or history rows exist, so
// canonical state can never be half-exported. Foreign project ids fail at
// getProject as NotFound (TASK-014), never revealing ownership.
import { getSessionUser } from "@/infrastructure/auth/identity";
import { getDb } from "@/infrastructure/database/db";
import { getProject } from "@/modules/projects/repository";
import { ProjectNotFoundError } from "@/modules/projects/errors";
import { exportAgentKitZip } from "@/modules/agent-kit/archive";
import { recordExport } from "@/modules/agent-kit/history";
import { supportedTargets, GENERIC_TARGET } from "@/modules/agent-kit/adapters";
import { AgentKitValidationError } from "@/modules/agent-kit/errors";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized.", { status: 401 });
  const { id: projectId } = await params;
  const db = getDb();

  try {
    await getProject(db, user.id, projectId);
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return new Response("Project not found.", { status: 404 });
    }
    throw error;
  }

  const rawTarget = new URL(request.url).searchParams.get("target") ?? GENERIC_TARGET;
  const target = supportedTargets().includes(rawTarget) ? rawTarget : null;
  if (target === null) {
    return new Response(`Unknown target. Supported: ${supportedTargets().join(", ")}.`, {
      status: 400,
    });
  }

  try {
    const archive = await exportAgentKitZip(db, user.id, projectId, { target });
    await recordExport(db, user.id, projectId, {
      target,
      sourceStateVersion: archive.sourceStateVersion,
      artifactCount: archive.fileCount,
    });
    return new Response(new Blob([archive.bytes as BlobPart]), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${archive.filename}"`,
        "Content-Length": String(archive.bytes.length),
      },
    });
  } catch (error) {
    if (error instanceof AgentKitValidationError) {
      return new Response(error.message, { status: 422 });
    }
    throw error;
  }
}
