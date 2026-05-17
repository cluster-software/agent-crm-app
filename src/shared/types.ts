export type WorkspaceSummary = {
  path: string;
  filename: string;
  objects: SchemaObject[];
  counts: Record<string, number>;
  activeValues: number;
  recent: RecordPreview[];
};

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
};

export type RecordPreview = {
  object_slug: string;
  record_id: string;
  label: string;
  subtitle: string;
  values: RecordValue[];
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

export type AppBridge = {
  platform: string;
  openWorkspaceDialog: () => Promise<WorkspaceSummary | null>;
  createWorkspaceDialog: () => Promise<WorkspaceSummary | null>;
  openWorkspacePath: (filePath: string) => Promise<WorkspaceSummary>;
  closeWorkspace: () => Promise<void>;
  getWorkspace: () => Promise<WorkspaceSummary | null>;
  listRecords: (objectSlug: string) => Promise<RecordPreview[]>;
  importCsv: (payload: ImportCsvPayload) => Promise<ImportCsvResult>;
  importTranscript: (payload: TranscriptPayload) => Promise<TranscriptImportResult>;
  createRecord: (payload: CreateRecordPayload) => Promise<CreateRecordResult>;
  runQuery: (sql: string, params?: unknown[]) => Promise<QueryResult>;
};
