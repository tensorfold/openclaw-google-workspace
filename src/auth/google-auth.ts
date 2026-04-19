/**
 * Shared OAuth2 authentication service for all Google Workspace services.
 * Single credential file, single token file, scopes computed from enabled services.
 *
 * Adapted from the Calendar plugin's google-calendar-auth.ts, generalized for multi-service use.
 */

import { google } from "googleapis";
import type { OAuth2Client, Credentials } from "google-auth-library";
import { readFile, writeFile, rename, chmod, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { resolve, dirname } from "node:path";
import { randomBytes } from "node:crypto";

import {
  getConfiguredAccountIds,
  resolveAccountConfig,
  type ResolvedWorkspaceAccount,
  type ResolvedWorkspaceConfig,
} from "../config/schema.js";
import {
  AuthenticationRequiredError,
  PluginConfigurationError,
} from "../shared/errors.js";

// ---------------------------------------------------------------------------
// Scope mapping
// ---------------------------------------------------------------------------

const SCOPE_BASE = "https://www.googleapis.com/auth/";

export function getRequiredScopes(config: ResolvedWorkspaceConfig): string[] {
  const scopes: string[] = [];
  const s = config.services;

  if (s.gmail.enabled) {
    if (s.gmail.readOnly) {
      scopes.push(`${SCOPE_BASE}gmail.readonly`);
    } else {
      scopes.push(`${SCOPE_BASE}gmail.modify`);
      scopes.push(`${SCOPE_BASE}gmail.send`);
    }
  }

  if (s.calendar.enabled) {
    scopes.push(
      s.calendar.readOnly
        ? `${SCOPE_BASE}calendar.events.readonly`
        : `${SCOPE_BASE}calendar.events`,
    );
  }

  if (s.drive.enabled) {
    scopes.push(
      s.drive.readOnly
        ? `${SCOPE_BASE}drive.readonly`
        : `${SCOPE_BASE}drive.file`,
    );
  }

  if (s.contacts.enabled) {
    scopes.push(`${SCOPE_BASE}contacts.readonly`);
  }

  if (s.tasks.enabled) {
    scopes.push(`${SCOPE_BASE}tasks`);
  }

  if (s.sheets.enabled) {
    scopes.push(
      s.sheets.readOnly
        ? `${SCOPE_BASE}spreadsheets.readonly`
        : `${SCOPE_BASE}spreadsheets`,
    );
  }

  return scopes;
}

// ---------------------------------------------------------------------------
// Credential file loading
// ---------------------------------------------------------------------------

interface OAuthClientCredentials {
  client_id: string;
  client_secret: string;
  redirect_uris?: string[];
}

async function loadCredentials(
  credentialsPath: string,
): Promise<OAuthClientCredentials> {
  let raw: string;
  try {
    raw = await readFile(credentialsPath, "utf-8");
  } catch {
    throw new PluginConfigurationError(
      `Cannot read OAuth credentials file at: ${credentialsPath}\n` +
        `Download the OAuth Desktop Client JSON from your Google Cloud Console ` +
        `and place it at the configured credentialsPath.`,
    );
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new PluginConfigurationError(
      `Invalid JSON in credentials file at: ${credentialsPath}`,
    );
  }

  // Google credential files have "installed" or "web" wrapper
  const inner =
    (json.installed as OAuthClientCredentials | undefined) ??
    (json.web as OAuthClientCredentials | undefined);

  if (!inner?.client_id || !inner?.client_secret) {
    throw new PluginConfigurationError(
      `Credentials file at ${credentialsPath} is missing client_id or client_secret. ` +
        `Ensure you downloaded the OAuth 2.0 Client ID JSON (not a service account key).`,
    );
  }

  return inner;
}

// ---------------------------------------------------------------------------
// Token persistence
// ---------------------------------------------------------------------------

async function readStoredTokens(
  tokenPath: string,
): Promise<Credentials | null> {
  try {
    const raw = await readFile(tokenPath, "utf-8");
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

async function writeTokens(
  tokenPath: string,
  tokens: Credentials,
): Promise<void> {
  const absPath = resolve(tokenPath);
  const tmpPath = `${absPath}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmpPath, JSON.stringify(tokens, null, 2), "utf-8");
  try {
    await chmod(tmpPath, 0o600);
  } catch {
    // chmod may fail on Windows — non-fatal
  }
  await rename(tmpPath, absPath);
}

async function tokenFileExists(tokenPath: string): Promise<boolean> {
  try {
    await access(tokenPath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Auth service
// ---------------------------------------------------------------------------

export interface AuthorizationRequest {
  url: string;
  scopes: string[];
  enabledServices: string[];
  accountId: string;
  email?: string;
}

export interface GoogleWorkspaceAuthService {
  createAuthorizationUrl(accountId?: string): Promise<AuthorizationRequest>;
  exchangeCodeForToken(code: string, accountId?: string): Promise<void>;
  hasStoredToken(accountId?: string): Promise<boolean>;
  createAuthenticatedClient(accountId?: string): Promise<OAuth2Client>;
  getRequiredScopes(): string[];
  getEnabledServices(): string[];
  getAccountIds(): string[];
  getDefaultAccountId(): string;
  checkScopeGaps(accountId?: string): Promise<{ authorized: string[]; missing: string[] } | null>;
}

export function createAuthService(
  config: ResolvedWorkspaceConfig,
): GoogleWorkspaceAuthService {
  const scopes = getRequiredScopes(config);

  const enabledServices = Object.entries(config.services)
    .filter(([, svc]) => svc.enabled)
    .map(([name]) => name);

  const cachedClients = new Map<string, OAuth2Client>();

  function getAccount(accountId?: string): ResolvedWorkspaceAccount {
    const requestedId = accountId ?? config.defaultAccount;
    const accountIds = getConfiguredAccountIds(config);
    if (accountIds.length > 0 && !config.accounts[requestedId]) {
      throw new PluginConfigurationError(
        `Unknown Google Workspace account "${requestedId}". Configured accounts: ${accountIds.join(", ")}.`,
      );
    }

    const account = resolveAccountConfig(config, requestedId);
    if (!account.credentialsPath) {
      throw new PluginConfigurationError(
        `credentialsPath is required for Google Workspace account "${account.id}". ` +
          "Set it in plugin config, account config, or via GOOGLE_WORKSPACE_CREDENTIALS_PATH.",
      );
    }
    if (!account.tokenPath) {
      throw new PluginConfigurationError(
        `tokenPath is required for Google Workspace account "${account.id}". ` +
          "Set it in plugin config, account config, or via GOOGLE_WORKSPACE_TOKEN_PATH.",
      );
    }
    return account;
  }

  async function getOAuth2Client(account: ResolvedWorkspaceAccount): Promise<OAuth2Client> {
    const creds = await loadCredentials(account.credentialsPath!);
    const redirectUri =
      account.oauthRedirectUri ??
      creds.redirect_uris?.[0] ??
      "http://127.0.0.1:3000/oauth2callback";

    return new google.auth.OAuth2(
      creds.client_id,
      creds.client_secret,
      redirectUri,
    );
  }

  return {
    getRequiredScopes() {
      return scopes;
    },

    getEnabledServices() {
      return enabledServices;
    },

    getAccountIds() {
      return getConfiguredAccountIds(config);
    },

    getDefaultAccountId() {
      return config.defaultAccount;
    },

    async createAuthorizationUrl(accountId?: string): Promise<AuthorizationRequest> {
      const account = getAccount(accountId);
      const client = await getOAuth2Client(account);
      const url = client.generateAuthUrl({
        access_type: "offline",
        scope: scopes,
        prompt: "consent",
        include_granted_scopes: true,
      });
      return { url, scopes, enabledServices, accountId: account.id, email: account.email };
    },

    async exchangeCodeForToken(code: string, accountId?: string): Promise<void> {
      const account = getAccount(accountId);
      const client = await getOAuth2Client(account);
      const { tokens } = await client.getToken(code);

      // Merge with existing tokens to preserve refresh_token if Google only returns access_token
      const existing = await readStoredTokens(account.tokenPath!);
      const merged: Credentials = {
        ...existing,
        ...tokens,
      };
      // Preserve existing refresh_token if the new response doesn't include one
      if (!merged.refresh_token && existing?.refresh_token) {
        merged.refresh_token = existing.refresh_token;
      }

      await writeTokens(account.tokenPath!, merged);
      cachedClients.delete(account.id);
    },

    async hasStoredToken(accountId?: string): Promise<boolean> {
      const account = getAccount(accountId);
      return tokenFileExists(account.tokenPath!);
    },

    async createAuthenticatedClient(accountId?: string): Promise<OAuth2Client> {
      const account = getAccount(accountId);
      const cachedClient = cachedClients.get(account.id);
      if (cachedClient) return cachedClient;

      const tokens = await readStoredTokens(account.tokenPath!);
      if (!tokens) {
        throw new AuthenticationRequiredError(
          `No stored OAuth tokens found for Google Workspace account "${account.id}". ` +
            "Run google_workspace_begin_auth to authorize.",
        );
      }

      const client = await getOAuth2Client(account);
      client.setCredentials(tokens);

      // Auto-refresh: persist new tokens when Google refreshes them
      client.on("tokens", (newTokens) => {
        const merged: Credentials = { ...tokens, ...newTokens };
        if (!merged.refresh_token && tokens.refresh_token) {
          merged.refresh_token = tokens.refresh_token;
        }
        writeTokens(account.tokenPath!, merged).catch(() => {
          // Token write failure is non-fatal — next call will re-refresh
        });
      });

      cachedClients.set(account.id, client);
      return client;
    },

    async checkScopeGaps(accountId?: string): Promise<{
      authorized: string[];
      missing: string[];
    } | null> {
      const account = getAccount(accountId);
      const tokens = await readStoredTokens(account.tokenPath!);
      if (!tokens) return null;

      const granted = tokens.scope?.split(" ") ?? [];
      const authorized = scopes.filter((s) => granted.includes(s));
      const missing = scopes.filter((s) => !granted.includes(s));
      return { authorized, missing };
    },
  };
}
