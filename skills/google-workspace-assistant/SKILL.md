---
name: google-workspace-assistant
description: Help OpenClaw manage Google Workspace services including Gmail, Calendar, Drive, Contacts, Tasks, and Sheets using the unified Google Workspace plugin.
metadata: {"openclaw":{"requires":{"config":["plugins.entries.openclaw-google-workspace.enabled"]}}}
---

Use this skill when the user wants to interact with any Google Workspace service.

This skill is channel-agnostic. Behave the same way regardless of where the request came from.

## Goals

- Help with Gmail search, reading, and sending
- Help with Calendar event management (create, read, update, delete, upcoming events)
- Help with Drive file listing, reading, searching, and creation
- Help with Contacts search and lookup
- Help with Tasks listing, creation, and completion
- Help with Sheets reading and writing
- Use the shared Google auth tools when authorization is needed
- Ask short follow-up questions when requests are incomplete or ambiguous

## Authentication

Services can be configured with one or more named Google accounts. If the user
does not name an account, use the configured default account.

- `google_workspace_begin_auth` — start authorization for all enabled services
- `google_workspace_complete_auth` — finish authorization with the Google code
- `google_workspace_auth_status` — check which services are authorized and token validity

For multi-account setups, pass the optional `account` argument to auth, Gmail,
and Calendar tools when the user names a specific Google account.

If any tool returns an authentication error, use the auth tools to re-authorize. Do not ask the user for raw tokens or secrets.

## Tool Map — Gmail

- `google_gmail_search` — search messages using Gmail search syntax
- `google_gmail_read` — read a specific email by message ID
- `google_gmail_list_unread` — list unread inbox messages
- `google_gmail_list_by_label` — list messages by label name
- `google_gmail_send` — compose and send an email (blocked in read-only mode)

## Tool Map — Calendar

- `google_calendar_list_events` — list upcoming events in a time window
- `google_calendar_create_event` — create a new event (requires confirmation)
- `google_calendar_update_event` — update an existing event (requires confirmation)
- `google_calendar_delete_event` — delete an event (requires confirmation)
- `google_calendar_find_next_meeting` — answer "what is my next meeting?"

## Tool Map — Drive

- `google_drive_list_files` — list files, optionally in a folder
- `google_drive_read_file` — read file content or metadata
- `google_drive_search` — search files by name or content
- `google_drive_create_file` — create a new file (blocked in read-only mode)

## Tool Map — Contacts

- `google_contacts_search` — search contacts by name or email
- `google_contacts_get` — get a specific contact by resource name

## Tool Map — Tasks

- `google_tasks_list` — list tasks from a task list
- `google_tasks_create` — create a new task
- `google_tasks_complete` — mark a task as completed

## Tool Map — Sheets

- `google_sheets_read` — read a range from a spreadsheet
- `google_sheets_write` — write values to a range (blocked in read-only mode)

## Operating Rules

1. Prefer read-only tools for informational requests.
2. For write actions, gather minimum missing details before calling a tool.
3. If a service is not enabled, explain that it is not configured rather than attempting the call.
4. If a service is in read-only mode, explain that write actions are unavailable.
5. When an operation fails because of auth, explain the blocker and offer to run the auth flow.
6. Do not expose tokens, credential payloads, or other secrets in responses.
7. For calendar write actions, respect the confirmation flow — do not set confirmed to true until the user confirms.

## Date and Time Rules

- For all-day calendar events, use date in YYYY-MM-DD format.
- For timed events, use dateTime in ISO 8601 format with timezone offset.
- Include timeZone when the user specifies one.

## Gmail Search Syntax Hints

Common Gmail search operators the user may not know:
- `is:unread` — unread messages
- `from:person@email.com` — from a specific sender
- `newer_than:2d` — within the last 2 days
- `has:attachment` — messages with attachments
- `subject:keyword` — in the subject line
- `label:name` — by label

## Response Style

- Keep clarifying questions concise and practical.
- State missing details plainly.
- Format results with clear structure (numbered lists for multiple items).
- Truncate very long email bodies or file contents and note the truncation.
