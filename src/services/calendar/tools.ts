/**
 * Calendar tool definitions.
 * 5 tools: list_events, create_event, update_event, delete_event, find_next_meeting
 */

import type { ResolvedWorkspaceConfig } from "../../config/schema.js";
import { createAuthService } from "../../auth/google-auth.js";
import { createCalendarClient } from "./client.js";
import {
  textResult,
  errorResult,
  formatEventDetails,
  formatEventList,
  type ToolResult,
} from "../../shared/formatting.js";
import { ReadOnlyModeError } from "../../shared/errors.js";
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

async function getCalendarClient(
  config: ResolvedWorkspaceConfig,
  account?: string,
) {
  const auth = createAuthService(config);
  const oauth = await auth.createAuthenticatedClient(account);
  return createCalendarClient(oauth);
}

export function buildCalendarTools(
  config: ResolvedWorkspaceConfig,
): ToolDefinition[] {
  const calConfig = config.services.calendar;

  return [
    {
      name: "google_calendar_list_events",
      label: "List Calendar Events",
      description:
        "List upcoming Google Calendar events within a time window. Defaults to the next 7 days.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          calendarId: {
            type: "string",
            description:
              "Calendar ID to query. Defaults to 'primary'.",
          },
          windowDays: {
            type: "integer",
            minimum: 1,
            maximum: 90,
            description:
              "Number of days from now to look ahead. Defaults to plugin config value.",
          },
          maxResults: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            default: 25,
            description: "Maximum events to return.",
          },
          account: accountProperty,
        },
      },
      execute: async (_id, params) => {
        try {
          const client = await getCalendarClient(config, params.account as string | undefined);
          const calId = (params.calendarId as string) ?? calConfig.defaultCalendarId;
          const days = (params.windowDays as number) ?? calConfig.upcomingWindowDays;
          const maxResults = (params.maxResults as number) ?? 25;

          const now = new Date();
          const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

          const events = await client.listEvents(
            calId,
            now.toISOString(),
            end.toISOString(),
            maxResults,
          );
          return textResult(
            `**Upcoming events (next ${days} days):**\n\n${formatEventList(events)}`,
          );
        } catch (error) {
          return errorResult(normalizeGoogleError(error, "Calendar", "list events"));
        }
      },
    },

    {
      name: "google_calendar_create_event",
      label: "Create Calendar Event",
      description:
        "Create a new Google Calendar event. Requires confirmation — set confirmed to true after the user confirms. Blocked in read-only mode.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["summary", "start"],
        properties: {
          summary: {
            type: "string",
            description: "Event title.",
          },
          start: {
            type: "string",
            description:
              "Start time as ISO 8601 datetime (e.g., '2026-04-15T10:00:00-04:00') or date for all-day events (e.g., '2026-04-15').",
          },
          end: {
            type: "string",
            description:
              "End time as ISO 8601 datetime or date. Defaults to start if omitted.",
          },
          timeZone: {
            type: "string",
            description:
              "IANA time zone (e.g., 'America/New_York'). Uses calendar default if omitted.",
          },
          location: {
            type: "string",
            description: "Event location.",
          },
          description: {
            type: "string",
            description: "Event description.",
          },
          attendees: {
            type: "array",
            items: { type: "string" },
            description: "List of attendee email addresses.",
          },
          confirmed: {
            type: "boolean",
            default: false,
            description:
              "Set to true after the user has confirmed the event details. Do not set to true on the first call.",
          },
          account: accountProperty,
        },
      },
      execute: async (_id, params) => {
        if (calConfig.readOnly) {
          return errorResult(new ReadOnlyModeError("calendar", "create event"));
        }

        const confirmed = params.confirmed as boolean | undefined;
        const summary = params.summary as string;
        const startStr = params.start as string;
        const endStr = params.end as string | undefined;
        const timeZone = (params.timeZone as string | undefined) ?? calConfig.defaultTimeZone;

        if (!confirmed) {
          const lines = [
            "**Ready to create event:**",
            "",
            `Title: ${summary}`,
            `Start: ${startStr}`,
          ];
          if (endStr) lines.push(`End: ${endStr}`);
          if (params.location) lines.push(`Location: ${params.location as string}`);
          if (params.description) lines.push(`Description: ${params.description as string}`);
          if (params.attendees) lines.push(`Attendees: ${(params.attendees as string[]).join(", ")}`);
          lines.push("");
          lines.push("Please confirm to create this event (set confirmed: true).");
          return textResult(lines.join("\n"));
        }

        try {
          const client = await getCalendarClient(config, params.account as string | undefined);
          const calId = calConfig.defaultCalendarId;

          const isAllDay = /^\d{4}-\d{2}-\d{2}$/.test(startStr);
          const start = isAllDay
            ? { date: startStr }
            : { dateTime: startStr, timeZone };
          const end = endStr
            ? isAllDay
              ? { date: endStr }
              : { dateTime: endStr, timeZone }
            : undefined;

          const event = await client.createEvent(calId, {
            summary,
            start,
            end,
            location: params.location as string | undefined,
            description: params.description as string | undefined,
            attendees: params.attendees as string[] | undefined,
          });

          return textResult(
            `**Event created successfully!**\n\n${formatEventDetails(event)}`,
          );
        } catch (error) {
          return errorResult(normalizeGoogleError(error, "Calendar", "create event"));
        }
      },
    },

    {
      name: "google_calendar_update_event",
      label: "Update Calendar Event",
      description:
        "Update an existing Google Calendar event. Requires confirmation. Blocked in read-only mode.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["eventId"],
        properties: {
          eventId: {
            type: "string",
            description: "The event ID to update.",
          },
          summary: {
            type: "string",
            description: "New event title.",
          },
          start: {
            type: "string",
            description: "New start time (ISO 8601 datetime or date).",
          },
          end: {
            type: "string",
            description: "New end time (ISO 8601 datetime or date).",
          },
          timeZone: {
            type: "string",
            description: "IANA time zone for the new times.",
          },
          location: {
            type: "string",
            description: "New event location.",
          },
          description: {
            type: "string",
            description: "New event description.",
          },
          confirmed: {
            type: "boolean",
            default: false,
            description:
              "Set to true after the user has confirmed the changes.",
          },
          account: accountProperty,
        },
      },
      execute: async (_id, params) => {
        if (calConfig.readOnly) {
          return errorResult(new ReadOnlyModeError("calendar", "update event"));
        }

        const confirmed = params.confirmed as boolean | undefined;
        if (!confirmed) {
          const changes: string[] = [];
          if (params.summary) changes.push(`Title → ${params.summary as string}`);
          if (params.start) changes.push(`Start → ${params.start as string}`);
          if (params.end) changes.push(`End → ${params.end as string}`);
          if (params.location) changes.push(`Location → ${params.location as string}`);
          if (params.description) changes.push(`Description → ${params.description as string}`);

          return textResult(
            `**Ready to update event ${params.eventId as string}:**\n\n` +
              changes.join("\n") +
              "\n\nPlease confirm to apply these changes (set confirmed: true).",
          );
        }

        try {
          const client = await getCalendarClient(config, params.account as string | undefined);
          const calId = calConfig.defaultCalendarId;
          const timeZone = (params.timeZone as string | undefined) ?? calConfig.defaultTimeZone;

          const updateParams: {
            eventId: string;
            summary?: string;
            start?: { dateTime?: string; date?: string; timeZone?: string };
            end?: { dateTime?: string; date?: string; timeZone?: string };
            location?: string;
            description?: string;
          } = { eventId: params.eventId as string };

          if (params.summary) updateParams.summary = params.summary as string;
          if (params.location) updateParams.location = params.location as string;
          if (params.description) updateParams.description = params.description as string;

          if (params.start) {
            const s = params.start as string;
            updateParams.start = /^\d{4}-\d{2}-\d{2}$/.test(s)
              ? { date: s }
              : { dateTime: s, timeZone };
          }
          if (params.end) {
            const e = params.end as string;
            updateParams.end = /^\d{4}-\d{2}-\d{2}$/.test(e)
              ? { date: e }
              : { dateTime: e, timeZone };
          }

          const event = await client.updateEvent(calId, updateParams);
          return textResult(
            `**Event updated successfully!**\n\n${formatEventDetails(event)}`,
          );
        } catch (error) {
          return errorResult(normalizeGoogleError(error, "Calendar", "update event"));
        }
      },
    },

    {
      name: "google_calendar_delete_event",
      label: "Delete Calendar Event",
      description:
        "Delete a Google Calendar event. Requires confirmation. Blocked in read-only mode.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["eventId"],
        properties: {
          eventId: {
            type: "string",
            description: "The event ID to delete.",
          },
          confirmed: {
            type: "boolean",
            default: false,
            description:
              "Set to true after the user has confirmed deletion.",
          },
          account: accountProperty,
        },
      },
      execute: async (_id, params) => {
        if (calConfig.readOnly) {
          return errorResult(new ReadOnlyModeError("calendar", "delete event"));
        }

        const confirmed = params.confirmed as boolean | undefined;
        if (!confirmed) {
          return textResult(
            `**Ready to delete event ${params.eventId as string}.**\n\n` +
              "This action cannot be undone. Please confirm (set confirmed: true).",
          );
        }

        try {
          const client = await getCalendarClient(config, params.account as string | undefined);
          const calId = calConfig.defaultCalendarId;
          await client.deleteEvent(calId, params.eventId as string);
          return textResult(`Event ${params.eventId as string} deleted successfully.`);
        } catch (error) {
          return errorResult(normalizeGoogleError(error, "Calendar", "delete event"));
        }
      },
    },

    {
      name: "google_calendar_find_next_meeting",
      label: "Find Next Meeting",
      description:
        "Find the next upcoming meeting on the Google Calendar for today.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          calendarId: {
            type: "string",
            description: "Calendar ID. Defaults to 'primary'.",
          },
          account: accountProperty,
        },
      },
      execute: async (_id, params) => {
        try {
          const client = await getCalendarClient(config, params.account as string | undefined);
          const calId = (params.calendarId as string) ?? calConfig.defaultCalendarId;
          const event = await client.findNextMeeting(calId);

          if (!event) {
            return textResult("No more meetings scheduled for today.");
          }

          return textResult(
            `**Next meeting:**\n\n${formatEventDetails(event)}`,
          );
        } catch (error) {
          return errorResult(normalizeGoogleError(error, "Calendar", "find next meeting"));
        }
      },
    },
  ];
}
