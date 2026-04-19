/**
 * Sheets tool definitions.
 * 2 tools: read, write
 */

import type { ResolvedWorkspaceConfig } from "../../config/schema.js";
import { createAuthService } from "../../auth/google-auth.js";
import { createSheetsClient } from "./client.js";
import { textResult, errorResult, type ToolResult } from "../../shared/formatting.js";
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

async function getSheetsClient(
  config: ResolvedWorkspaceConfig,
  account?: string,
) {
  const auth = createAuthService(config);
  const oauth = await auth.createAuthenticatedClient(account);
  return createSheetsClient(oauth);
}

function formatSheetData(data: {
  range: string;
  values: string[][];
}): string {
  if (data.values.length === 0) {
    return `Range: ${data.range}\n\n(empty — no data in this range)`;
  }

  const lines = [`**Range:** ${data.range}`, ""];

  // Format as a simple table
  const maxCols = Math.max(...data.values.map((row) => row.length));

  // Calculate column widths
  const widths: number[] = Array(maxCols).fill(0);
  for (const row of data.values) {
    for (let i = 0; i < maxCols; i++) {
      const cell = row[i] ?? "";
      widths[i] = Math.max(widths[i], cell.length, 3);
    }
  }

  // Cap widths to prevent huge tables
  for (let i = 0; i < widths.length; i++) {
    widths[i] = Math.min(widths[i], 30);
  }

  // Header row
  const headerRow = data.values[0];
  lines.push(
    "| " +
      headerRow
        .map((cell, i) => (cell ?? "").padEnd(widths[i]))
        .join(" | ") +
      " |",
  );
  lines.push(
    "| " + widths.map((w) => "-".repeat(w)).join(" | ") + " |",
  );

  // Data rows
  for (let r = 1; r < data.values.length; r++) {
    const row = data.values[r];
    lines.push(
      "| " +
        Array(maxCols)
          .fill("")
          .map((_, i) => {
            const cell = row[i] ?? "";
            return cell.length > widths[i]
              ? cell.slice(0, widths[i] - 1) + "…"
              : cell.padEnd(widths[i]);
          })
          .join(" | ") +
        " |",
    );
  }

  lines.push("");
  lines.push(`${data.values.length} rows × ${maxCols} columns`);

  return lines.join("\n");
}

export function buildSheetsTools(
  config: ResolvedWorkspaceConfig,
): ToolDefinition[] {
  const sheetsConfig = config.services.sheets;

  return [
    {
      name: "google_sheets_read",
      label: "Read Sheet",
      description:
        "Read data from a Google Sheets spreadsheet. Specify a range in A1 notation (e.g., 'Sheet1!A1:D10').",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["spreadsheetId", "range"],
        properties: {
          spreadsheetId: {
            type: "string",
            description:
              "The spreadsheet ID (from the URL: docs.google.com/spreadsheets/d/{ID}/...).",
          },
          range: {
            type: "string",
            description:
              "Cell range in A1 notation (e.g., 'Sheet1!A1:D10', 'A:D', 'Sheet1').",
          },
          account: accountProperty,
        },
      },
      execute: async (_id, params) => {
        try {
          const client = await getSheetsClient(config, params.account as string | undefined);
          const data = await client.readRange(
            params.spreadsheetId as string,
            params.range as string,
          );
          return textResult(formatSheetData(data));
        } catch (error) {
          return errorResult(
            normalizeGoogleError(error, "Sheets", "read spreadsheet"),
          );
        }
      },
    },

    {
      name: "google_sheets_write",
      label: "Write Sheet",
      description:
        "Write data to a Google Sheets spreadsheet. Blocked in read-only mode.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["spreadsheetId", "range", "values"],
        properties: {
          spreadsheetId: {
            type: "string",
            description: "The spreadsheet ID.",
          },
          range: {
            type: "string",
            description:
              "Target range in A1 notation (e.g., 'Sheet1!A1:C3').",
          },
          values: {
            type: "array",
            items: {
              type: "array",
              items: { type: "string" },
            },
            description:
              "2D array of values to write. Each inner array is a row.",
          },
          account: accountProperty,
        },
      },
      execute: async (_id, params) => {
        if (sheetsConfig.readOnly) {
          return errorResult(
            new ReadOnlyModeError("sheets", "write to spreadsheet"),
          );
        }

        try {
          const client = await getSheetsClient(config, params.account as string | undefined);
          const result = await client.writeRange(
            params.spreadsheetId as string,
            params.range as string,
            params.values as string[][],
          );
          return textResult(
            `**Data written successfully!**\n\n` +
              `Updated range: ${result.updatedRange}\n` +
              `Updated cells: ${result.updatedCells}`,
          );
        } catch (error) {
          return errorResult(
            normalizeGoogleError(error, "Sheets", "write to spreadsheet"),
          );
        }
      },
    },
  ];
}
