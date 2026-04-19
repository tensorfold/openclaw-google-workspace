/**
 * Auth tools — always registered, never optional.
 * Provides: begin_auth, complete_auth, auth_status
 */

import type { ResolvedWorkspaceConfig } from "../config/schema.js";
import {
  createAuthService,
  type GoogleWorkspaceAuthService,
} from "./google-auth.js";
import { textResult, errorResult, type ToolResult } from "../shared/formatting.js";
import { PluginConfigurationError } from "../shared/errors.js";

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
  type: "string" as const,
  description:
    "Optional configured Google account name. Omit to use the default account.",
};

const accountSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    account: accountProperty,
  },
};

const completeAuthSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["authorizationCode"],
  properties: {
    authorizationCode: {
      type: "string" as const,
      description:
        "The authorization code from the Google OAuth redirect URL.",
    },
    account: accountProperty,
  },
};

function getAuthService(
  config: ResolvedWorkspaceConfig,
): GoogleWorkspaceAuthService {
  return createAuthService(config);
}

export function buildAuthTools(
  config: ResolvedWorkspaceConfig,
): ToolDefinition[] {
  return [
    // ----- begin_auth -----
    {
      name: "google_workspace_begin_auth",
      label: "Begin Google Workspace Auth",
      description:
        "Generate a Google OAuth authorization URL for all enabled Workspace services. " +
        "The user should visit this URL, sign in with their Google account, grant consent, " +
        "and then provide the authorization code back.",
      parameters: accountSchema,
      execute: async (_toolCallId, params) => {
        try {
          const auth = getAuthService(config);
          const account = params.account as string | undefined;
          const request = await auth.createAuthorizationUrl(account);

          const lines = [
            "**Google Workspace Authorization**",
            "",
            `**Account:** ${request.accountId}${request.email ? ` (${request.email})` : ""}`,
            "",
            `Visit the following URL to authorize access:`,
            "",
            request.url,
            "",
            `**Enabled services:** ${request.enabledServices.join(", ")}`,
            `**Requested scopes:** ${request.scopes.length}`,
            "",
            "After granting access, Google will show an authorization code. " +
              "Copy that code and run `google_workspace_complete_auth` with it.",
          ];

          return textResult(lines.join("\n"));
        } catch (error) {
          if (error instanceof PluginConfigurationError) {
            return textResult(
              `Configuration error: ${error.message}\n\n` +
                "Ensure credentialsPath and tokenPath are set in the plugin config.",
            );
          }
          return errorResult(error);
        }
      },
    },

    // ----- complete_auth -----
    {
      name: "google_workspace_complete_auth",
      label: "Complete Google Workspace Auth",
      description:
        "Exchange a Google OAuth authorization code for access and refresh tokens. " +
        "Use this after the user has visited the authorization URL and received a code.",
      parameters: completeAuthSchema,
      execute: async (_toolCallId, params) => {
        const code = params.authorizationCode as string;
        const account = params.account as string | undefined;
        if (!code || code.trim().length === 0) {
          return textResult(
            "Error: authorizationCode is required. " +
              "The user must provide the code from the Google OAuth redirect.",
          );
        }

        try {
          const auth = getAuthService(config);
          await auth.exchangeCodeForToken(code.trim(), account);

          const enabledServices = auth.getEnabledServices();
          const accountId = account ?? auth.getDefaultAccountId();
          return textResult(
            "**Authorization successful!**\n\n" +
              `Account: ${accountId}\n\n` +
              `Tokens saved securely. The following services are now authorized:\n` +
              enabledServices.map((s) => `- ${s}`).join("\n") +
              "\n\nYou can now use any of the enabled Google Workspace tools.",
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (
            message.includes("invalid_grant") ||
            message.includes("expired")
          ) {
            return textResult(
              "Error: The authorization code has expired or was already used. " +
                "Run `google_workspace_begin_auth` to generate a new URL and try again.",
            );
          }
          return errorResult(error);
        }
      },
    },

    // ----- auth_status -----
    {
      name: "google_workspace_auth_status",
      label: "Google Workspace Auth Status",
      description:
        "Check the current Google Workspace authorization status. " +
        "Reports which services are enabled, whether tokens exist, and any scope gaps.",
      parameters: accountSchema,
      execute: async (_toolCallId, params) => {
        try {
          const auth = getAuthService(config);
          const enabledServices = auth.getEnabledServices();
          const requiredScopes = auth.getRequiredScopes();
          const requestedAccount = params.account as string | undefined;
          const accountIds = requestedAccount
            ? [requestedAccount]
            : auth.getAccountIds();

          const lines = [
            "**Google Workspace Auth Status**",
            "",
            `**Default account:** ${auth.getDefaultAccountId()}`,
            `**Configured accounts:** ${accountIds.join(", ") || "none"}`,
            `**Enabled services:** ${enabledServices.join(", ") || "none"}`,
            `**Required scopes:** ${requiredScopes.length}`,
          ];

          for (const accountId of accountIds) {
            const hasToken = await auth.hasStoredToken(accountId);
            lines.push("");
            lines.push(`**Account:** ${accountId}`);
            lines.push(`**Token stored:** ${hasToken ? "Yes" : "No"}`);

            if (!hasToken) {
              lines.push(
                "No tokens found. Run `google_workspace_begin_auth` for this account.",
              );
              continue;
            }

            const gaps = await auth.checkScopeGaps(accountId);
            if (gaps) {
              if (gaps.missing.length === 0) {
                lines.push(`**Scope status:** All required scopes authorized`);
              } else {
                lines.push(`**Scope status:** Missing ${gaps.missing.length} scope(s)`);
                lines.push("");
                lines.push("Missing scopes (re-auth required):");
                for (const scope of gaps.missing) {
                  lines.push(`- ${scope}`);
                }
                lines.push("");
                lines.push(
                  "Run `google_workspace_begin_auth` for this account to authorize the missing scopes.",
                );
              }
            }
          }

          // Show per-service readOnly status
          lines.push("");
          lines.push("**Service configuration:**");
          const svc = config.services;
          const serviceDetails = [
            { name: "Gmail", cfg: svc.gmail, ro: "readOnly" in svc.gmail ? svc.gmail.readOnly : undefined },
            { name: "Calendar", cfg: svc.calendar, ro: svc.calendar.readOnly },
            { name: "Drive", cfg: svc.drive, ro: svc.drive.readOnly },
            { name: "Contacts", cfg: svc.contacts, ro: undefined },
            { name: "Tasks", cfg: svc.tasks, ro: undefined },
            { name: "Sheets", cfg: svc.sheets, ro: "readOnly" in svc.sheets ? svc.sheets.readOnly : undefined },
          ];
          for (const { name, cfg, ro } of serviceDetails) {
            const status = cfg.enabled ? "enabled" : "disabled";
            const mode = ro !== undefined ? (ro ? " (read-only)" : " (read-write)") : "";
            lines.push(`- ${name}: ${status}${mode}`);
          }

          return textResult(lines.join("\n"));
        } catch (error) {
          if (error instanceof PluginConfigurationError) {
            return textResult(
              `Configuration error: ${error.message}\n\n` +
                "Ensure credentialsPath and tokenPath are set in the plugin config.",
            );
          }
          return errorResult(error);
        }
      },
    },
  ];
}
