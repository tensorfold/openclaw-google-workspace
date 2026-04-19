/**
 * Drive tool definitions.
 * 4 tools: list_files, read_file, search, create_file
 */

import type { ResolvedWorkspaceConfig } from "../../config/schema.js";
import { createAuthService } from "../../auth/google-auth.js";
import { createDriveClient } from "./client.js";
import {
  textResult,
  errorResult,
  formatFileInfo,
  formatFileList,
  truncateBody,
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

async function getDriveClient(
  config: ResolvedWorkspaceConfig,
  account?: string,
) {
  const auth = createAuthService(config);
  const oauth = await auth.createAuthenticatedClient(account);
  return createDriveClient(oauth);
}

export function buildDriveTools(
  config: ResolvedWorkspaceConfig,
): ToolDefinition[] {
  const driveConfig = config.services.drive;

  return [
    {
      name: "google_drive_list_files",
      label: "List Drive Files",
      description:
        "List files in Google Drive, optionally filtered to a specific folder. Returns file name, type, modified date, and ID.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          folderId: {
            type: "string",
            description: "Folder ID to list files from. Lists root if omitted.",
          },
          query: {
            type: "string",
            description:
              "Optional Drive API query filter (e.g., \"mimeType='application/pdf'\").",
          },
          maxResults: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            default: 20,
            description: "Maximum number of files to return.",
          },
          account: accountProperty,
        },
      },
      execute: async (_id, params) => {
        try {
          const client = await getDriveClient(config, params.account as string | undefined);
          const files = await client.listFiles({
            folderId: params.folderId as string | undefined,
            query: params.query as string | undefined,
            maxResults: (params.maxResults as number) ?? driveConfig.maxSearchResults,
          });
          return textResult(formatFileList(files));
        } catch (error) {
          return errorResult(normalizeGoogleError(error, "Drive", "list files"));
        }
      },
    },

    {
      name: "google_drive_read_file",
      label: "Read Drive File",
      description:
        "Read the content of a Google Drive file. Google Docs are exported as plain text, Google Sheets as CSV. Binary files return metadata only.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["fileId"],
        properties: {
          fileId: {
            type: "string",
            description: "The Drive file ID to read.",
          },
          exportMimeType: {
            type: "string",
            description:
              "Override export format for Google Workspace files (e.g., 'text/html', 'application/pdf').",
          },
          account: accountProperty,
        },
      },
      execute: async (_id, params) => {
        try {
          const client = await getDriveClient(config, params.account as string | undefined);
          const fileId = params.fileId as string;

          // Get metadata first
          const fileMeta = await client.getFile(fileId);
          const content = await client.readFileContent(
            fileId,
            params.exportMimeType as string | undefined,
          );

          const header = formatFileInfo(fileMeta);
          return textResult(
            `${header}\n\n---\n\n${truncateBody(content, 8000)}`,
          );
        } catch (error) {
          return errorResult(normalizeGoogleError(error, "Drive", "read file"));
        }
      },
    },

    {
      name: "google_drive_search",
      label: "Search Drive",
      description:
        "Search Google Drive files by name or content. Uses full-text search across all accessible files.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: {
            type: "string",
            description: "Search query (searches file names and content).",
          },
          maxResults: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            default: 20,
            description: "Maximum number of results.",
          },
          account: accountProperty,
        },
      },
      execute: async (_id, params) => {
        try {
          const client = await getDriveClient(config, params.account as string | undefined);
          const files = await client.searchFiles(
            params.query as string,
            (params.maxResults as number) ?? driveConfig.maxSearchResults,
          );
          return textResult(formatFileList(files));
        } catch (error) {
          return errorResult(normalizeGoogleError(error, "Drive", "search files"));
        }
      },
    },

    {
      name: "google_drive_create_file",
      label: "Create Drive File",
      description:
        "Create a new file in Google Drive. Blocked in read-only mode.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["name", "content"],
        properties: {
          name: {
            type: "string",
            description: "File name (including extension, e.g., 'report.txt').",
          },
          content: {
            type: "string",
            description: "File content (text).",
          },
          mimeType: {
            type: "string",
            description:
              "MIME type (defaults to 'text/plain'). Use 'application/vnd.google-apps.document' to create a Google Doc.",
          },
          parentFolderId: {
            type: "string",
            description: "Parent folder ID. Creates in root if omitted.",
          },
          account: accountProperty,
        },
      },
      execute: async (_id, params) => {
        if (driveConfig.readOnly) {
          return errorResult(new ReadOnlyModeError("drive", "create file"));
        }

        try {
          const client = await getDriveClient(config, params.account as string | undefined);
          const file = await client.createFile({
            name: params.name as string,
            content: params.content as string,
            mimeType: params.mimeType as string | undefined,
            parentFolderId: params.parentFolderId as string | undefined,
          });
          return textResult(
            `**File created successfully!**\n\n${formatFileInfo(file)}`,
          );
        } catch (error) {
          return errorResult(normalizeGoogleError(error, "Drive", "create file"));
        }
      },
    },
  ];
}
