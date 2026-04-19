/**
 * Tasks tool definitions.
 * 3 tools: list, create, complete
 */

import type { ResolvedWorkspaceConfig } from "../../config/schema.js";
import { createAuthService } from "../../auth/google-auth.js";
import { createTasksClient } from "./client.js";
import { textResult, errorResult, type ToolResult } from "../../shared/formatting.js";
import { normalizeGoogleError } from "../../shared/google-error.js";

interface ToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
  ) => Promise<ToolResult>;
}

const accountProperty = {
  type: "string",
  description:
    "Optional configured Google account name. Omit to use the default account.",
};

async function getTasksClient(
  config: ResolvedWorkspaceConfig,
  account?: string,
) {
  const auth = createAuthService(config);
  const oauth = await auth.createAuthenticatedClient(account);
  return createTasksClient(oauth);
}

function formatTask(t: {
  id?: string;
  title?: string;
  notes?: string;
  due?: string;
  status?: string;
  completed?: string;
}): string {
  const check = t.status === "completed" ? "[x]" : "[ ]";
  const lines = [`${check} **${t.title ?? "(untitled)"}**`];
  if (t.due) lines.push(`  Due: ${t.due}`);
  if (t.notes) lines.push(`  Notes: ${t.notes}`);
  if (t.id) lines.push(`  ID: ${t.id}`);
  return lines.join("\n");
}

export function buildTasksTools(
  config: ResolvedWorkspaceConfig,
): ToolDefinition[] {
  return [
    {
      name: "google_tasks_list",
      label: "List Tasks",
      description:
        "List tasks from a Google Tasks list. Defaults to the primary task list.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          taskListId: {
            type: "string",
            description:
              "Task list ID. Uses the first/default task list if omitted.",
          },
          showCompleted: {
            type: "boolean",
            default: false,
            description: "Whether to include completed tasks.",
          },
          account: accountProperty,
        },
      },
      execute: async (_id, params) => {
        try {
          const client = await getTasksClient(config, params.account as string | undefined);

          let taskListId = params.taskListId as string | undefined;
          if (!taskListId) {
            const lists = await client.listTaskLists();
            taskListId = lists[0]?.id ?? "@default";
          }

          const showCompleted = (params.showCompleted as boolean) ?? false;
          const tasks = await client.listTasks(taskListId, showCompleted);

          if (tasks.length === 0) {
            return textResult("No tasks found.");
          }

          const formatted = tasks
            .map((t, i) => `${i + 1}. ${formatTask(t)}`)
            .join("\n\n");
          return textResult(formatted);
        } catch (error) {
          return errorResult(normalizeGoogleError(error, "Tasks", "list tasks"));
        }
      },
    },

    {
      name: "google_tasks_create",
      label: "Create Task",
      description: "Create a new task in a Google Tasks list.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["title"],
        properties: {
          title: {
            type: "string",
            description: "Task title.",
          },
          notes: {
            type: "string",
            description: "Task notes or description.",
          },
          due: {
            type: "string",
            description:
              "Due date as ISO 8601 datetime (e.g., '2026-04-15T00:00:00Z').",
          },
          taskListId: {
            type: "string",
            description: "Task list ID. Uses default list if omitted.",
          },
          account: accountProperty,
        },
      },
      execute: async (_id, params) => {
        try {
          const client = await getTasksClient(config, params.account as string | undefined);

          let taskListId = params.taskListId as string | undefined;
          if (!taskListId) {
            const lists = await client.listTaskLists();
            taskListId = lists[0]?.id ?? "@default";
          }

          const task = await client.createTask(taskListId, {
            title: params.title as string,
            notes: params.notes as string | undefined,
            due: params.due as string | undefined,
          });

          return textResult(
            `**Task created!**\n\n${formatTask(task)}`,
          );
        } catch (error) {
          return errorResult(normalizeGoogleError(error, "Tasks", "create task"));
        }
      },
    },

    {
      name: "google_tasks_complete",
      label: "Complete Task",
      description: "Mark a Google Task as completed.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["taskId"],
        properties: {
          taskId: {
            type: "string",
            description: "The task ID to mark as completed.",
          },
          taskListId: {
            type: "string",
            description: "Task list ID. Uses default list if omitted.",
          },
          account: accountProperty,
        },
      },
      execute: async (_id, params) => {
        try {
          const client = await getTasksClient(config, params.account as string | undefined);

          let taskListId = params.taskListId as string | undefined;
          if (!taskListId) {
            const lists = await client.listTaskLists();
            taskListId = lists[0]?.id ?? "@default";
          }

          const task = await client.completeTask(
            taskListId,
            params.taskId as string,
          );

          return textResult(
            `**Task completed!**\n\n${formatTask(task)}`,
          );
        } catch (error) {
          return errorResult(normalizeGoogleError(error, "Tasks", "complete task"));
        }
      },
    },
  ];
}
