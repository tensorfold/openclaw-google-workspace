/**
 * Plugin configuration types, defaults, and resolution with environment variable overrides.
 * Follows the pattern from the Calendar plugin's runtime-config.ts.
 */

// ---------------------------------------------------------------------------
// Service config interfaces
// ---------------------------------------------------------------------------

export interface GmailServiceConfig {
  enabled: boolean;
  readOnly: boolean;
  maxSearchResults: number;
}

export interface CalendarServiceConfig {
  enabled: boolean;
  readOnly: boolean;
  defaultCalendarId: string;
  defaultTimeZone?: string;
  upcomingWindowDays: number;
}

export interface DriveServiceConfig {
  enabled: boolean;
  readOnly: boolean;
  maxSearchResults: number;
}

export interface ContactsServiceConfig {
  enabled: boolean;
  maxSearchResults: number;
}

export interface TasksServiceConfig {
  enabled: boolean;
}

export interface SheetsServiceConfig {
  enabled: boolean;
  readOnly: boolean;
}

export interface ServiceConfigMap {
  gmail: GmailServiceConfig;
  calendar: CalendarServiceConfig;
  drive: DriveServiceConfig;
  contacts: ContactsServiceConfig;
  tasks: TasksServiceConfig;
  sheets: SheetsServiceConfig;
}

// ---------------------------------------------------------------------------
// Plugin config (raw + resolved)
// ---------------------------------------------------------------------------

export interface WorkspacePluginConfig {
  credentialsPath?: string;
  tokenPath?: string;
  oauthRedirectUri?: string;
  defaultAccount?: string;
  accounts?: Record<string, WorkspaceAccountConfig>;
  services?: {
    gmail?: Partial<GmailServiceConfig>;
    calendar?: Partial<CalendarServiceConfig>;
    drive?: Partial<DriveServiceConfig>;
    contacts?: Partial<ContactsServiceConfig>;
    tasks?: Partial<TasksServiceConfig>;
    sheets?: Partial<SheetsServiceConfig>;
  };
}

export interface WorkspaceAccountConfig {
  email?: string;
  credentialsPath?: string;
  tokenPath?: string;
  oauthRedirectUri?: string;
}

export interface ResolvedWorkspaceConfig {
  credentialsPath?: string;
  tokenPath?: string;
  oauthRedirectUri?: string;
  defaultAccount: string;
  accounts: Record<string, ResolvedWorkspaceAccount>;
  services: ServiceConfigMap;
}

export interface ResolvedWorkspaceAccount {
  id: string;
  email?: string;
  credentialsPath?: string;
  tokenPath?: string;
  oauthRedirectUri?: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const SERVICE_DEFAULTS: ServiceConfigMap = {
  gmail: { enabled: true, readOnly: false, maxSearchResults: 20 },
  calendar: {
    enabled: true,
    readOnly: false,
    defaultCalendarId: "primary",
    upcomingWindowDays: 7,
  },
  drive: { enabled: true, readOnly: true, maxSearchResults: 20 },
  contacts: { enabled: false, maxSearchResults: 10 },
  tasks: { enabled: false },
  sheets: { enabled: false, readOnly: true },
};

// ---------------------------------------------------------------------------
// Environment variable mapping
// ---------------------------------------------------------------------------

function envString(key: string): string | undefined {
  const val = process.env[key];
  return val && val.length > 0 ? val : undefined;
}

function envBool(key: string): boolean | undefined {
  const val = process.env[key];
  if (val === "true" || val === "1") return true;
  if (val === "false" || val === "0") return false;
  return undefined;
}

function envInt(key: string): number | undefined {
  const val = process.env[key];
  if (!val) return undefined;
  const n = parseInt(val, 10);
  return isNaN(n) ? undefined : n;
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

/**
 * Resolve plugin config from the OpenClaw plugin API.
 * Environment variables take priority over config file values.
 */
export function resolvePluginConfig(api: {
  pluginConfig?: unknown;
}): ResolvedWorkspaceConfig {
  const raw = (api.pluginConfig ?? {}) as WorkspacePluginConfig;
  const svc = raw.services ?? {};
  const credentialsPath =
    envString("GOOGLE_WORKSPACE_CREDENTIALS_PATH") ?? raw.credentialsPath;
  const tokenPath =
    envString("GOOGLE_WORKSPACE_TOKEN_PATH") ?? raw.tokenPath;
  const oauthRedirectUri =
    envString("GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI") ?? raw.oauthRedirectUri;
  const configuredAccounts = raw.accounts ?? {};
  const defaultAccount = raw.defaultAccount ?? "default";
  const accounts: Record<string, ResolvedWorkspaceAccount> = {};

  for (const [id, account] of Object.entries(configuredAccounts)) {
    accounts[id] = {
      id,
      email: account.email,
      credentialsPath: account.credentialsPath ?? credentialsPath,
      tokenPath: account.tokenPath,
      oauthRedirectUri: account.oauthRedirectUri ?? oauthRedirectUri,
    };
  }

  if (Object.keys(accounts).length === 0 && (credentialsPath || tokenPath)) {
    accounts[defaultAccount] = {
      id: defaultAccount,
      credentialsPath,
      tokenPath,
      oauthRedirectUri,
    };
  }

  return {
    credentialsPath,
    tokenPath,
    oauthRedirectUri,
    defaultAccount,
    accounts,
    services: {
      gmail: {
        enabled:
          envBool("GOOGLE_WORKSPACE_GMAIL_ENABLED") ??
          svc.gmail?.enabled ??
          SERVICE_DEFAULTS.gmail.enabled,
        readOnly:
          envBool("GOOGLE_WORKSPACE_GMAIL_READ_ONLY") ??
          svc.gmail?.readOnly ??
          SERVICE_DEFAULTS.gmail.readOnly,
        maxSearchResults:
          envInt("GOOGLE_WORKSPACE_GMAIL_MAX_RESULTS") ??
          svc.gmail?.maxSearchResults ??
          SERVICE_DEFAULTS.gmail.maxSearchResults,
      },
      calendar: {
        enabled:
          envBool("GOOGLE_WORKSPACE_CALENDAR_ENABLED") ??
          svc.calendar?.enabled ??
          SERVICE_DEFAULTS.calendar.enabled,
        readOnly:
          envBool("GOOGLE_WORKSPACE_CALENDAR_READ_ONLY") ??
          svc.calendar?.readOnly ??
          SERVICE_DEFAULTS.calendar.readOnly,
        defaultCalendarId:
          envString("GOOGLE_WORKSPACE_CALENDAR_ID") ??
          svc.calendar?.defaultCalendarId ??
          SERVICE_DEFAULTS.calendar.defaultCalendarId,
        defaultTimeZone:
          envString("GOOGLE_WORKSPACE_CALENDAR_TIMEZONE") ??
          svc.calendar?.defaultTimeZone ??
          SERVICE_DEFAULTS.calendar.defaultTimeZone,
        upcomingWindowDays:
          envInt("GOOGLE_WORKSPACE_CALENDAR_WINDOW_DAYS") ??
          svc.calendar?.upcomingWindowDays ??
          SERVICE_DEFAULTS.calendar.upcomingWindowDays,
      },
      drive: {
        enabled:
          envBool("GOOGLE_WORKSPACE_DRIVE_ENABLED") ??
          svc.drive?.enabled ??
          SERVICE_DEFAULTS.drive.enabled,
        readOnly:
          envBool("GOOGLE_WORKSPACE_DRIVE_READ_ONLY") ??
          svc.drive?.readOnly ??
          SERVICE_DEFAULTS.drive.readOnly,
        maxSearchResults:
          envInt("GOOGLE_WORKSPACE_DRIVE_MAX_RESULTS") ??
          svc.drive?.maxSearchResults ??
          SERVICE_DEFAULTS.drive.maxSearchResults,
      },
      contacts: {
        enabled:
          envBool("GOOGLE_WORKSPACE_CONTACTS_ENABLED") ??
          svc.contacts?.enabled ??
          SERVICE_DEFAULTS.contacts.enabled,
        maxSearchResults:
          envInt("GOOGLE_WORKSPACE_CONTACTS_MAX_RESULTS") ??
          svc.contacts?.maxSearchResults ??
          SERVICE_DEFAULTS.contacts.maxSearchResults,
      },
      tasks: {
        enabled:
          envBool("GOOGLE_WORKSPACE_TASKS_ENABLED") ??
          svc.tasks?.enabled ??
          SERVICE_DEFAULTS.tasks.enabled,
      },
      sheets: {
        enabled:
          envBool("GOOGLE_WORKSPACE_SHEETS_ENABLED") ??
          svc.sheets?.enabled ??
          SERVICE_DEFAULTS.sheets.enabled,
        readOnly:
          envBool("GOOGLE_WORKSPACE_SHEETS_READ_ONLY") ??
          svc.sheets?.readOnly ??
          SERVICE_DEFAULTS.sheets.readOnly,
      },
    },
  };
}

export function getConfiguredAccountIds(config: ResolvedWorkspaceConfig): string[] {
  return Object.keys(config.accounts);
}

export function resolveAccountConfig(
  config: ResolvedWorkspaceConfig,
  accountId?: string,
): ResolvedWorkspaceAccount {
  const id = accountId ?? config.defaultAccount;
  const account = config.accounts[id];
  if (account) return account;

  return {
    id,
    credentialsPath: config.credentialsPath,
    tokenPath: config.tokenPath,
    oauthRedirectUri: config.oauthRedirectUri,
  };
}
