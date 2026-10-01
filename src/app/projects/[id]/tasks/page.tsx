// Task Plan Workspace (SCREEN-019/020 per design.md; TASK-095).
//
// Read-only view over the implementation plan (TASK-090/091/093):
// milestone view plus all-task view, task status, dependencies with an
// understandable blocked reason, requirement references, acceptance
// criteria, and Definition of Done. No mutations here — planning changes
// go through the planner and dependency APIs, so this page cannot
// silently reshape the plan.
//
// Server component, no client JS — same convention as Decisions. Detail
// renders inline via ?code= rather than a separate route (design.md §92:
// SCREEN-* are concepts, not mandatory URLs).
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/infrastructure/auth/identity";
import { getDb } from "@/infrastructure/database/db";
import { getProject } from "@/modules/projects/repository";
import { ProjectNotFoundError } from "@/modules/projects/errors";
import { listMilestones, type MilestoneRow } from "@/modules/tasks/milestones";
import { getUserTaskByCode, listUserTasks, type UserTaskRow } from "@/modules/tasks/user-tasks";
import {
  listTaskDependents,
  listTaskPrerequisites,
  listUserTaskDependencies,
} from "@/modules/tasks/dependencies";
import { UserTaskNotFoundError } from "@/modules/tasks/errors";
import { TASK_STATUS_FILTERS, filterToStatus, taskStatusLabel } from "./labels";

type View = "milestones" | "all";

function activeView(raw: string | undefined): View {
  return raw === "all" ? "all" : "milestones";
}

function blockedReason(
  task: UserTaskRow,
  prerequisites: string[],
  statusByCode: Map<string, string>,
): string | null {
  if (task.status !== "BLOCKED" || prerequisites.length === 0) return null;
  const waiting = prerequisites.filter((code) => statusByCode.get(code) !== "DONE");
  if (waiting.length === 0) return null;
  return `Waiting on ${waiting.map((code) => `${code} (${statusByCode.get(code) ?? "?"})`).join(", ")}`;
}

function refList(label: string, values: string[] | undefined): string | null {
  if (!values || values.length === 0) return null;
  return `${label}: ${values.join(", ")}`;
}

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ view?: string; filter?: string; code?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id: projectId } = await params;
  const query = (await searchParams) ?? {};
  const db = getDb();

  try {
    await getProject(db, user.id, projectId);
  } catch (error) {
    if (error instanceof ProjectNotFoundError) notFound();
    throw error;
  }

  const view = activeView(query.view);
  const activeFilter = query.filter ?? "All";
  const statusFilter = filterToStatus(activeFilter);
  const [milestones, tasks, dependencies] = await Promise.all([
    listMilestones(db, user.id, projectId),
    listUserTasks(db, user.id, projectId),
    listUserTaskDependencies(db, user.id, projectId),
  ]);

  const statusByCode = new Map(tasks.map((task) => [task.taskCode, task.status]));
  const milestoneById = new Map(milestones.map((milestone) => [milestone.id, milestone]));
  const prereqsByCode = new Map<string, string[]>();
  for (const dep of dependencies) {
    const list = prereqsByCode.get(dep.taskCode) ?? [];
    list.push(dep.dependsOnCode);
    prereqsByCode.set(dep.taskCode, list);
  }
  for (const list of prereqsByCode.values()) list.sort();

  const visible =
    statusFilter === undefined ? tasks : tasks.filter((task) => task.status === statusFilter);
  const unassigned = visible.filter((task) => task.milestoneId === null);
  const grouped = new Map<string, { milestone: MilestoneRow; rows: UserTaskRow[] }>();
  for (const milestone of milestones) grouped.set(milestone.id, { milestone, rows: [] });
  for (const task of visible) {
    if (task.milestoneId === null) continue;
    grouped.get(task.milestoneId)?.rows.push(task);
  }

  let detail: {
    row: UserTaskRow;
    milestone: MilestoneRow | null;
    prerequisites: { code: string; status: string }[];
    dependents: string[];
  } | null = null;
  if (query.code) {
    try {
      const row = await getUserTaskByCode(db, user.id, projectId, query.code);
      const [prerequisites, dependents] = await Promise.all([
        listTaskPrerequisites(db, user.id, projectId, row.taskCode),
        listTaskDependents(db, user.id, projectId, row.taskCode),
      ]);
      detail = {
        row,
        milestone: row.milestoneId === null ? null : (milestoneById.get(row.milestoneId) ?? null),
        prerequisites: prerequisites.map((dep) => ({
          code: dep.dependsOnCode,
          status: statusByCode.get(dep.dependsOnCode) ?? "?",
        })),
        dependents: dependents.map((dep) => dep.taskCode).sort(),
      };
    } catch (error) {
      if (!(error instanceof UserTaskNotFoundError)) throw error;
    }
  }

  const base = `/projects/${projectId}/tasks`;
  const withQuery = (viewParam: View, filter: string) =>
    `${base}?view=${viewParam}${filter === "All" ? "" : `&filter=${encodeURIComponent(filter)}`}`;
  const detailHref = (code: string) =>
    `${base}?view=${view}${activeFilter === "All" ? "" : `&filter=${encodeURIComponent(activeFilter)}`}&code=${code}`;

  const renderRow = (task: UserTaskRow) => {
    const badge = taskStatusLabel(task.status);
    const reason = blockedReason(task, prereqsByCode.get(task.taskCode) ?? [], statusByCode);
    const milestone = task.milestoneId === null ? null : milestoneById.get(task.milestoneId)?.title;
    return (
      <li
        key={task.taskCode}
        className="flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-200 p-3"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium">
            <span className="mr-2 font-mono text-xs text-zinc-500">{task.taskCode}</span>
            {task.title}
          </p>
          <p className="mt-1 text-sm text-zinc-600">
            {badge.glyph} {badge.label} · {task.priority}
            {milestone ? ` · ${milestone}` : ""}
          </p>
          {reason && <p className="mt-1 text-sm text-amber-800">{reason}</p>}
        </div>
        <a
          href={detailHref(task.taskCode)}
          className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50"
        >
          View
        </a>
      </li>
    );
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-8">
      <div>
        <Link href="/projects" className="text-sm text-zinc-500 hover:underline">
          ← Projects
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Implementation plan</h1>
        <p className="mt-1 text-sm text-zinc-600">
          {tasks.length} tasks · {milestones.length} milestones
        </p>
      </div>

      <nav aria-label="Plan view" className="flex flex-wrap gap-2">
        {(["milestones", "all"] as const).map((option) => (
          <a
            key={option}
            href={withQuery(option, activeFilter)}
            aria-current={view === option ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${
              view === option
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-300 hover:bg-zinc-50"
            }`}
          >
            {option === "milestones" ? "Milestones" : "All tasks"}
          </a>
        ))}
      </nav>

      <nav aria-label="Filter tasks" className="flex flex-wrap gap-2">
        {TASK_STATUS_FILTERS.map((filter) => (
          <a
            key={filter}
            href={withQuery(view, filter)}
            aria-current={activeFilter === filter ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${
              activeFilter === filter
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-300 hover:bg-zinc-50"
            }`}
          >
            {filter}
          </a>
        ))}
      </nav>

      {visible.length === 0 ? (
        <p className="rounded border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
          No tasks match. Generate an implementation plan and it appears here.
        </p>
      ) : view === "all" ? (
        <ul className="flex flex-col gap-2">{visible.map(renderRow)}</ul>
      ) : (
        [...grouped.values()].map(({ milestone, rows }) => (
          <section key={milestone.id} aria-label={milestone.title}>
            <h2 className="text-sm font-medium text-zinc-500">
              {milestone.milestoneCode} · {milestone.title} · {milestone.status}
            </h2>
            {rows.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-400">No tasks in this milestone.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">{rows.map(renderRow)}</ul>
            )}
          </section>
        ))
      )}
      {view === "milestones" && unassigned.length > 0 && (
        <section aria-label="Unassigned tasks">
          <h2 className="text-sm font-medium text-zinc-500">Unassigned</h2>
          <ul className="mt-2 flex flex-col gap-2">{unassigned.map(renderRow)}</ul>
        </section>
      )}

      {detail && (
        <section aria-label="Task detail" className="rounded border border-zinc-900 p-4">
          <h2 className="text-lg font-semibold">{detail.row.title}</h2>
          <p className="font-mono text-xs text-zinc-500">{detail.row.taskCode}</p>
          <dl className="mt-3 grid gap-2 text-sm">
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-zinc-500">Status</dt>
              <dd>
                {taskStatusLabel(detail.row.status).glyph}{" "}
                {taskStatusLabel(detail.row.status).label}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-zinc-500">Priority</dt>
              <dd>{detail.row.priority}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-zinc-500">Milestone</dt>
              <dd>{detail.milestone ? detail.milestone.title : "Unassigned"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-zinc-500">Objective</dt>
              <dd>{detail.row.objective}</dd>
            </div>
            {detail.row.implementationNotes && (
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-zinc-500">Notes</dt>
                <dd>{detail.row.implementationNotes}</dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-zinc-500">Depends on</dt>
              <dd>
                {detail.prerequisites.length === 0
                  ? "No dependencies."
                  : detail.prerequisites.map((dep) => `${dep.code} (${dep.status})`).join(", ")}
              </dd>
            </div>
            {detail.dependents.length > 0 && (
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-zinc-500">Required by</dt>
                <dd>{detail.dependents.join(", ")}</dd>
              </div>
            )}
            {[
              refList("Requirements", detail.row.references?.requirements),
              refList("Architecture", detail.row.references?.architecture),
              refList("Entities", detail.row.references?.entities),
              refList("Screens", detail.row.references?.screens),
            ].map(
              (line) =>
                line && (
                  <div key={line} className="flex gap-2">
                    <dt className="w-24 shrink-0 text-zinc-500">References</dt>
                    <dd>{line}</dd>
                  </div>
                ),
            )}
          </dl>

          <h3 className="mt-4 text-sm font-medium">Acceptance criteria</h3>
          <ul className="mt-1 list-disc pl-5 text-sm text-zinc-700">
            {detail.row.acceptanceCriteria.map((criterion) => (
              <li key={criterion}>{criterion}</li>
            ))}
          </ul>
          <h3 className="mt-4 text-sm font-medium">Definition of done</h3>
          <ul className="mt-1 list-disc pl-5 text-sm text-zinc-700">
            {detail.row.definitionOfDone.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
