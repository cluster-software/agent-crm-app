export type WorkspaceSummary = {
  path: string;
  databaseUrl?: string;
  filename: string;
  workspaceId?: string;
  orgId?: string;
  cloudWorkspaceId?: string;
  user?: {
    userId: string;
    email?: string | null;
  };
  org?: {
    orgId: string;
    name?: string | null;
  };
  objects: SchemaObject[];
  counts: Record<string, number>;
};

export type AuthSessionSummary = {
  expiresAt: string;
  user: {
    userId: string;
    email?: string | null;
  };
  workspace: {
    workspaceId: string;
    orgId: string;
    name: string;
  };
};

export type RecentWorkspaceSummary = {
  path: string;
  databaseUrl: string;
  filename: string;
  lastOpenedAt: string;
  timestampSource: "opened" | "modified";
  counts?: Record<string, number>;
};

export type CloudSyncProvider = "gmail" | "linkedin";

export type GmailSyncProgress = {
  backfillStatus?: string;
  listedThreads?: number;
  fetchedThreads?: number;
  filteredThreads?: number;
  writtenThreads?: number;
  writtenMessages?: number;
  pageCount?: number;
  resultSizeEstimate?: number;
  resumeAfter?: string;
};

export type CloudSyncStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "disconnected" }
  | {
      state: "syncing";
      providers?: CloudSyncProvider[];
      showInEmptyState?: boolean;
      progress?: GmailSyncProgress;
    }
  | {
      state: "synced";
      lastSyncedAt: string;
      stats?: {
        people_created: number;
        communication_threads_created: number;
        communication_messages_created: number;
      };
    }
  | { state: "error"; message: string };

export type IntegrationAccountSummary = {
  id?: string;
  providerAccountId?: string;
  accountEmail?: string;
  displayName?: string;
  status?: string;
  lastSyncedAt?: string;
};

export type IntegrationSyncStatus = {
  state: "idle" | "pending" | "running" | "succeeded" | "failed";
  startedAt?: string;
  finishedAt?: string;
  errorMessage?: string;
  peopleSeen?: number;
  communicationThreadsSeen?: number;
  communicationMessagesSeen?: number;
  backfillStatus?: string;
  listedThreads?: number;
  fetchedThreads?: number;
  filteredThreads?: number;
  writtenThreads?: number;
  writtenMessages?: number;
  pageCount?: number;
  resultSizeEstimate?: number;
  resumeAfter?: string;
};

export type IntegrationProviderStatus = {
  connected: boolean;
  accountEmail?: string;
  displayName?: string;
  providerAccountId?: string;
  lastSyncedAt?: string;
  accounts?: IntegrationAccountSummary[];
  sync?: IntegrationSyncStatus;
};

export type CloudIntegrationsStatus =
  | { state: "no_workspace" }
  | {
      state: "ready";
      workspaceId: string;
      integrations: {
        gmail: IntegrationProviderStatus;
        linkedin: IntegrationProviderStatus;
        granola: IntegrationProviderStatus;
      };
    }
  | { state: "error"; message: string };

export type SchemaAttribute = {
  attribute_slug: string;
  title: string;
  attribute_type: string;
  is_multivalued: boolean;
  is_unique: boolean;
  config?: unknown;
};

export type SchemaObject = {
  object_slug: string;
  singular_name: string;
  plural_name: string;
  attributes: SchemaAttribute[];
};

export type RecordValue = {
  attribute_slug: string;
  title: string;
  type: string;
  display: string;
  raw: unknown;
  values: unknown[];
  source?: string | null;
  provenance?: Record<string, unknown> | null;
};

export type RecordPreview = {
  object_slug: string;
  record_id: string;
  label: string;
  subtitle: string;
  values: RecordValue[];
};

export type RecordListOptions = {
  limit?: number;
  cursor?: string | null;
  valueAttributes?: string[];
  includeSecondaryLabels?: boolean;
  searchQuery?: string | null;
};

export type RecordListResult = {
  objectSlug: string;
  records: RecordPreview[];
  limit: number;
  cursor: string | null;
  nextCursor: string | null;
  hasMore: boolean;
  totalMatches?: number;
};

export type QueryResult = {
  rows: Record<string, unknown>[];
  rowsAffected: number;
};

export type ImportCsvPayload = {
  csvText: string;
  source: string;
};

export type ImportCsvResult = {
  stats: {
    rows: number;
    companies_created: number;
    people_created: number;
    deals_created: number;
    people_skipped_no_identifier: number;
    warnings?: string[];
  };
  warnings: string[];
  pending_at_final_flush: number;
  touched_records?: Array<{ object_slug: "people" | "companies"; record_id: string }>;
};

export type ParticipantInput = {
  email?: string;
  linkedin_url?: string;
  twitter_url?: string;
};

export type TranscriptPayload = {
  source: string;
  source_id: string;
  title?: string;
  started_at?: string;
  ended_at?: string;
  duration_seconds?: number;
  summary?: string;
  content?: string;
  participants: ParticipantInput[];
};

export type TranscriptImportResult = {
  transcript_record_id: string;
  created: boolean;
  source: string;
  source_id: string;
  participants: {
    resolved: Array<{
      person_record_id: string;
      matched_by: string;
      matched_key: string;
      identifiers: ParticipantInput;
      backfilled: string[];
      created: boolean;
    }>;
    unresolved: Array<{
      identifiers: ParticipantInput;
      reason: string;
      tried: string[];
    }>;
  };
};

export type CreateRecordPayload = {
  object_slug: string;
  fields: string[];
  source?: string;
};

export type CreateRecordResult = {
  created: true;
  object_slug: string;
  record_id: string;
  values_inserted: number;
};

export type UpdateRecordPayload = {
  object_slug: string;
  record_id: string;
  fields: string[];
  source?: string;
};

export type UpdateRecordResult = {
  updated: true;
  object_slug: string;
  record_id: string;
  values_changed: number;
};

export type SignalOutputDefinition = {
  key: string;
  attribute: string;
  title: string;
  type: string;
  options?: Array<{ id: string; title: string }>;
};

export type SignalDefinitionSummary = {
  slug: string;
  title: string;
  object_slug: "people" | "companies";
  outputs: SignalOutputDefinition[];
};

export type SignalSyncResult = {
  definitions: number;
  attributes_created: number;
  attributes_updated: number;
};

export type SignalRunRequest = {
  mode?: "missing" | "force";
  signalSlugs?: string[];
  object_slug?: "people" | "companies";
  record_ids?: string[];
  limit?: number;
  concurrency?: number;
};

export type SignalRunJob = {
  id: string;
  object_slug?: "people" | "companies";
  record_ids: string[];
  signalSlugs: string[];
  log_path: string;
  started_at: string;
};

export type SignalRunStartResult = {
  started: true;
  job: SignalRunJob;
};

export type SignalRunResult = {
  definitions: number;
  records_considered: number;
  runs_attempted: number;
  runs_succeeded: number;
  runs_failed: number;
  values_written: number;
  skipped: number;
  failures: Array<{
    object_slug: "people" | "companies";
    record_id: string;
    signal_slug: string;
    message: string;
    stdout_excerpt?: string;
    stderr_excerpt?: string;
  }>;
  statuses: Array<{
    object_slug: "people" | "companies";
    record_id: string;
    signal_slug: string;
    status: "succeeded" | "failed" | "skipped";
    values_written?: number;
  }>;
};

export type SignalRunFailureSummary = {
  object_slug: "people" | "companies";
  record_id: string;
  signal_slug: string;
  message: string;
  stdout_excerpt?: string;
  stderr_excerpt?: string;
  log_path: string;
};

export type TerminalExit = { exitCode: number; signal?: number };

export type AgentCliPreflightStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "updating"; currentVersion?: string; latestVersion?: string }
  | { state: "ready"; version?: string; updated: boolean }
  | { state: "error"; message: string };

export type TerminalDroppedFilePayload = {
  bytes: Uint8Array;
  name: string;
  mimeType: string;
};

export type TerminalBridge = {
  subscribe: (id: string, cols: number, rows: number, cwd?: string) => Promise<string>;
  send: (id: string, data: string) => void;
  getPathForFile: (file: File) => string;
  persistDroppedFile: (payload: TerminalDroppedFilePayload) => Promise<string>;
  resize: (id: string, cols: number, rows: number) => void;
  kill: (id: string) => void;
  getAgentCliPreflightStatus: () => Promise<AgentCliPreflightStatus>;
  onAgentCliPreflightStatus: (handler: (status: AgentCliPreflightStatus) => void) => () => void;
  onData: (id: string, handler: (data: string) => void) => () => void;
  onExit: (id: string, handler: (info: TerminalExit) => void) => () => void;
};

export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "downloading"; version: string; percent: number }
  | { state: "ready"; version: string }
  | { state: "error"; message: string };

export type AppBridge = {
  platform: string;
  startAuth: (mode: "sign-in" | "sign-up") => Promise<AuthSessionSummary>;
  getAuthSession: () => Promise<AuthSessionSummary | null>;
  signOut: () => Promise<void>;
  closeWorkspace: () => Promise<void>;
  getWorkspace: () => Promise<WorkspaceSummary | null>;
  listRecords: (objectSlug: string, options?: RecordListOptions) => Promise<RecordListResult>;
  importCsv: (payload: ImportCsvPayload) => Promise<ImportCsvResult>;
  importTranscript: (payload: TranscriptPayload) => Promise<TranscriptImportResult>;
  createRecord: (payload: CreateRecordPayload) => Promise<CreateRecordResult>;
  updateRecord: (payload: UpdateRecordPayload) => Promise<UpdateRecordResult>;
  runQuery: (sql: string, params?: unknown[]) => Promise<QueryResult>;
  listSignals: () => Promise<SignalDefinitionSummary[]>;
  listSignalFailures: () => Promise<SignalRunFailureSummary[]>;
  listSignalRuns: () => Promise<SignalRunJob[]>;
  syncSignals: () => Promise<SignalSyncResult>;
  runSignals: (request?: SignalRunRequest) => Promise<SignalRunStartResult>;
  getCloudSyncStatus: () => Promise<CloudSyncStatus>;
  triggerCloudSync: () => Promise<CloudSyncStatus>;
  getCloudIntegrations: () => Promise<CloudIntegrationsStatus>;
  onWorkspaceChanged: (handler: () => void) => () => void;
  onCloudSyncStatus: (handler: (status: CloudSyncStatus) => void) => () => void;
  onUpdateStatus: (handler: (status: UpdateStatus) => void) => () => void;
  installUpdate: () => Promise<void>;
};
