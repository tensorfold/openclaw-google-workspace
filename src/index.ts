/**
 * OpenClaw Google Workspace Plugin — Entry Point
 *
 * Registers auth tools (always) and service-specific tools (conditionally)
 * based on which services are enabled in the plugin config.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import { resolvePluginConfig } from "./config/schema.js";
import { buildAuthTools } from "./auth/tools.js";
import { buildGmailTools } from "./services/gmail/tools.js";
import { buildCalendarTools } from "./services/calendar/tools.js";
import { buildDriveTools } from "./services/drive/tools.js";
import { buildContactsTools } from "./services/contacts/tools.js";
import { buildTasksTools } from "./services/tasks/tools.js";
import { buildSheetsTools } from "./services/sheets/tools.js";

/**
 * Static tool catalogue for OpenClaw 2026.5+ plugin contracts.
 * The runtime validates `contracts.tools` before agent tools may register.
 */
const GOOGLE_WORKSPACE_TOOL_NAMES = [
  "google_workspace_begin_auth",
  "google_workspace_complete_auth",
  "google_workspace_auth_status",
  "google_gmail_search",
  "google_gmail_read",
  "google_gmail_list_unread",
  "google_gmail_list_by_label",
  "google_gmail_send",
  "google_calendar_list_events",
  "google_calendar_create_event",
  "google_calendar_update_event",
  "google_calendar_delete_event",
  "google_calendar_find_next_meeting",
  "google_drive_list_files",
  "google_drive_read_file",
  "google_drive_search",
  "google_drive_create_file",
  "google_contacts_search",
  "google_contacts_get",
  "google_tasks_list",
  "google_tasks_create",
  "google_tasks_complete",
  "google_sheets_read",
  "google_sheets_write",
] as const;

export default definePluginEntry({
  id: "openclaw-google-workspace",
  name: "OpenClaw Google Workspace",
  description:
    "All-in-one Google Workspace integration with shared OAuth. Gmail, Calendar, Drive, Contacts, Tasks, Sheets.",
  contracts: { tools: [...GOOGLE_WORKSPACE_TOOL_NAMES] },
  register(api) {
    if (!api.registerTool) return;

    const config = resolvePluginConfig(api);

    // Auth tools — always registered, never optional
    for (const tool of buildAuthTools(config)) {
      api.registerTool(tool);
    }

    // Service tools — registered conditionally based on config, as optional tools
    const serviceBuilders = [
      { key: "gmail" as const, build: buildGmailTools },
      { key: "calendar" as const, build: buildCalendarTools },
      { key: "drive" as const, build: buildDriveTools },
      { key: "contacts" as const, build: buildContactsTools },
      { key: "tasks" as const, build: buildTasksTools },
      { key: "sheets" as const, build: buildSheetsTools },
    ];

    for (const { key, build } of serviceBuilders) {
      const serviceConfig = config.services[key];
      if (serviceConfig?.enabled) {
        for (const tool of build(config)) {
          api.registerTool(tool, { optional: true });
        }
      }
    }
  },
});
