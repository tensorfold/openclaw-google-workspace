/**
 * Contacts tool definitions.
 * 2 tools: search, get
 */

import type { ResolvedWorkspaceConfig } from "../../config/schema.js";
import { createAuthService } from "../../auth/google-auth.js";
import { createContactsClient } from "./client.js";
import {
  textResult,
  errorResult,
  formatContactInfo,
  type ToolResult,
} from "../../shared/formatting.js";
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

async function getContactsClient(
  config: ResolvedWorkspaceConfig,
  account?: string,
) {
  const auth = createAuthService(config);
  const oauth = await auth.createAuthenticatedClient(account);
  return createContactsClient(oauth);
}

export function buildContactsTools(
  config: ResolvedWorkspaceConfig,
): ToolDefinition[] {
  const contactsConfig = config.services.contacts;

  return [
    {
      name: "google_contacts_search",
      label: "Search Contacts",
      description:
        "Search Google Contacts by name, email, or phone number.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: {
            type: "string",
            description: "Search query (name, email, or phone number).",
          },
          maxResults: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            default: 10,
            description: "Maximum number of contacts to return.",
          },
          account: accountProperty,
        },
      },
      execute: async (_id, params) => {
        try {
          const client = await getContactsClient(config, params.account as string | undefined);
          const contacts = await client.searchContacts(
            params.query as string,
            (params.maxResults as number) ?? contactsConfig.maxSearchResults,
          );

          if (contacts.length === 0) {
            return textResult("No contacts found matching your query.");
          }

          const formatted = contacts
            .map((c, i) => `${i + 1}. ${formatContactInfo(c)}`)
            .join("\n\n");
          return textResult(formatted);
        } catch (error) {
          return errorResult(
            normalizeGoogleError(error, "Contacts", "search contacts"),
          );
        }
      },
    },

    {
      name: "google_contacts_get",
      label: "Get Contact",
      description:
        "Get a specific Google Contact by their resource name (e.g., 'people/c1234567890').",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["resourceName"],
        properties: {
          resourceName: {
            type: "string",
            description:
              "The contact's resource name (e.g., 'people/c1234567890').",
          },
          account: accountProperty,
        },
      },
      execute: async (_id, params) => {
        try {
          const client = await getContactsClient(config, params.account as string | undefined);
          const contact = await client.getContact(
            params.resourceName as string,
          );
          return textResult(formatContactInfo(contact));
        } catch (error) {
          return errorResult(
            normalizeGoogleError(error, "Contacts", "get contact"),
          );
        }
      },
    },
  ];
}
