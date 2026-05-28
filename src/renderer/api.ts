import type {
  AppBridge,
  CloudIntegrationsStatus,
  CreateRecordPayload,
  ImportCsvPayload,
  RecordListOptions,
  RecordListResult,
  RecordPreview,
  RecentWorkspaceSummary,
  SignalDefinitionSummary,
  SignalRunRequest,
  TranscriptPayload,
  UpdateRecordPayload,
  WorkspaceSummary
} from "../shared/types";

const sampleRecords: RecordPreview[] = [
  {
    object_slug: "people",
    record_id: "preview-person",
    label: "Maya Chen",
    subtitle: "VP Sales · lumin.ai",
    values: [
      {
        attribute_slug: "email_addresses",
        title: "Email addresses",
        type: "email-address",
        display: "maya@lumin.ai",
        raw: "maya@lumin.ai",
        values: ["maya@lumin.ai"]
      },
      {
        attribute_slug: "linkedin_url",
        title: "LinkedIn",
        type: "url",
        display: "linkedin.com/in/mayachen",
        raw: "linkedin.com/in/mayachen",
        values: ["linkedin.com/in/mayachen"]
      }
    ]
  },
  {
    object_slug: "people",
    record_id: "preview-person-2",
    label: "Andres Soto",
    subtitle: "Founder · orbitops.io",
    values: [
      {
        attribute_slug: "email_addresses",
        title: "Email addresses",
        type: "email-address",
        display: "andres@orbitops.io",
        raw: "andres@orbitops.io",
        values: ["andres@orbitops.io"]
      }
    ]
  }
];

const sampleRecordsByObject: Record<string, RecordPreview[]> = {
  companies: [
    {
      object_slug: "companies",
      record_id: "preview-company",
      label: "Lumin AI",
      subtitle: "lumin.ai",
      values: [
        {
          attribute_slug: "domains",
          title: "Domains",
          type: "domain",
          display: "lumin.ai",
          raw: "lumin.ai",
          values: ["lumin.ai"]
        },
        {
          attribute_slug: "linkedin_url",
          title: "LinkedIn",
          type: "url",
          display: "linkedin.com/company/lumin-ai",
          raw: "linkedin.com/company/lumin-ai",
          values: ["linkedin.com/company/lumin-ai"]
        }
      ]
    },
    {
      object_slug: "companies",
      record_id: "preview-company-2",
      label: "OrbitOps",
      subtitle: "orbitops.io",
      values: [
        {
          attribute_slug: "domains",
          title: "Domains",
          type: "domain",
          display: "orbitops.io",
          raw: "orbitops.io",
          values: ["orbitops.io"]
        }
      ]
    }
  ],
  people: sampleRecords,
  deals: [
    {
      object_slug: "deals",
      record_id: "preview-deal",
      label: "Expansion",
      subtitle: "In Progress · 24000",
      values: [
        {
          attribute_slug: "stage",
          title: "Stage",
          type: "status",
          display: "In Progress",
          raw: "in_progress",
          values: ["in_progress"]
        },
        {
          attribute_slug: "value",
          title: "Value",
          type: "currency",
          display: "24000",
          raw: 24000,
          values: [24000]
        }
      ]
    }
  ],
  communication_threads: [
    {
      object_slug: "communication_threads",
      record_id: "preview-thread",
      label: "Platform team rollout - pricing + SOC2",
      subtitle: "Email · May 25, 2026",
      values: [
        {
          attribute_slug: "subject",
          title: "Subject",
          type: "text",
          display: "Platform team rollout - pricing + SOC2",
          raw: "Platform team rollout - pricing + SOC2",
          values: ["Platform team rollout - pricing + SOC2"]
        }
      ]
    }
  ],
  communication_messages: [
    {
      object_slug: "communication_messages",
      record_id: "preview-message",
      label: "Thanks for sending these over.",
      subtitle: "Email · inbound",
      values: [
        {
          attribute_slug: "snippet",
          title: "Snippet",
          type: "text",
          display: "Thanks for sending these over.",
          raw: "Thanks for sending these over.",
          values: ["Thanks for sending these over."]
        }
      ]
    }
  ],
  posts: [
    {
      object_slug: "posts",
      record_id: "preview-post",
      label: "Launch announcement",
      subtitle: "LinkedIn",
      values: [
        {
          attribute_slug: "platform",
          title: "Platform",
          type: "status",
          display: "LinkedIn",
          raw: "linkedin",
          values: ["linkedin"]
        },
        {
          attribute_slug: "url",
          title: "URL",
          type: "url",
          display: "linkedin.com/posts/lumin-ai",
          raw: "linkedin.com/posts/lumin-ai",
          values: ["linkedin.com/posts/lumin-ai"]
        }
      ]
    }
  ],
  transcripts: [
    {
      object_slug: "transcripts",
      record_id: "preview-transcript",
      label: "Discovery call",
      subtitle: "Manual · 30 minutes",
      values: [
        {
          attribute_slug: "source",
          title: "Source",
          type: "status",
          display: "Manual",
          raw: "manual",
          values: ["manual"]
        },
        {
          attribute_slug: "source_id",
          title: "Source ID",
          type: "text",
          display: "manual-preview",
          raw: "manual-preview",
          values: ["manual-preview"]
        }
      ]
    }
  ]
};

const previewWorkspace: WorkspaceSummary = {
  path: "/Users/preview/workspace.acrm",
  filename: "workspace.acrm",
  counts: {
    companies: 18,
    people: 42,
    deals: 9,
    communication_threads: 7,
    communication_messages: 24,
    posts: 27,
    transcripts: 6
  },
  objects: [
    {
      object_slug: "companies",
      singular_name: "Company",
      plural_name: "Companies",
      attributes: [
        {
          attribute_slug: "name",
          title: "Name",
          attribute_type: "text",
          is_multivalued: false,
          is_unique: false
        },
        {
          attribute_slug: "domains",
          title: "Domains",
          attribute_type: "domain",
          is_multivalued: true,
          is_unique: true
        }
      ]
    },
    {
      object_slug: "people",
      singular_name: "Person",
      plural_name: "People",
      attributes: [
        {
          attribute_slug: "name",
          title: "Name",
          attribute_type: "personal-name",
          is_multivalued: false,
          is_unique: false
        },
        {
          attribute_slug: "email_addresses",
          title: "Email addresses",
          attribute_type: "email-address",
          is_multivalued: true,
          is_unique: true
        },
        {
          attribute_slug: "job_title",
          title: "Job title",
          attribute_type: "text",
          is_multivalued: false,
          is_unique: false
        },
        {
          attribute_slug: "communication_threads",
          title: "Communication threads",
          attribute_type: "record-reference",
          is_multivalued: true,
          is_unique: false,
          config: { target_object: "communication_threads", inverse: "participants" }
        }
      ]
    },
    {
      object_slug: "deals",
      singular_name: "Deal",
      plural_name: "Deals",
      attributes: [
        {
          attribute_slug: "name",
          title: "Name",
          attribute_type: "text",
          is_multivalued: false,
          is_unique: false
        },
        {
          attribute_slug: "stage",
          title: "Stage",
          attribute_type: "status",
          is_multivalued: false,
          is_unique: false
        }
      ]
    },
    {
      object_slug: "communication_threads",
      singular_name: "Communication thread",
      plural_name: "Communication threads",
      attributes: [
        {
          attribute_slug: "subject",
          title: "Subject",
          attribute_type: "text",
          is_multivalued: false,
          is_unique: false
        },
        {
          attribute_slug: "channel",
          title: "Channel",
          attribute_type: "status",
          is_multivalued: false,
          is_unique: false
        },
        {
          attribute_slug: "last_message_at",
          title: "Last message at",
          attribute_type: "timestamp",
          is_multivalued: false,
          is_unique: false
        }
      ]
    },
    {
      object_slug: "communication_messages",
      singular_name: "Communication message",
      plural_name: "Communication messages",
      attributes: [
        {
          attribute_slug: "body_text",
          title: "Body text",
          attribute_type: "text",
          is_multivalued: false,
          is_unique: false
        },
        {
          attribute_slug: "sent_at",
          title: "Sent at",
          attribute_type: "timestamp",
          is_multivalued: false,
          is_unique: false
        },
        {
          attribute_slug: "thread",
          title: "Thread",
          attribute_type: "record-reference",
          is_multivalued: false,
          is_unique: false,
          config: { target_object: "communication_threads", inverse: "messages" }
        }
      ]
    },
    {
      object_slug: "posts",
      singular_name: "Post",
      plural_name: "Posts",
      attributes: [
        {
          attribute_slug: "url",
          title: "URL",
          attribute_type: "url",
          is_multivalued: false,
          is_unique: true
        },
        {
          attribute_slug: "platform",
          title: "Platform",
          attribute_type: "status",
          is_multivalued: false,
          is_unique: false
        },
        {
          attribute_slug: "content",
          title: "Content",
          attribute_type: "text",
          is_multivalued: false,
          is_unique: false
        }
      ]
    },
    {
      object_slug: "transcripts",
      singular_name: "Transcript",
      plural_name: "Transcripts",
      attributes: [
        {
          attribute_slug: "title",
          title: "Title",
          attribute_type: "text",
          is_multivalued: false,
          is_unique: false
        }
      ]
    }
  ]
};

const previewRecentWorkspaces: RecentWorkspaceSummary[] = [
  {
    path: "/Users/example/workspaces/cluster.acrm",
    filename: "cluster.acrm",
    lastOpenedAt: new Date(Date.now() - 14 * 60 * 1000).toISOString(),
    timestampSource: "opened"
  },
  {
    path: "/Users/example/workspaces/anthropic-design.acrm",
    filename: "anthropic-design.acrm",
    lastOpenedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    timestampSource: "opened"
  },
  {
    path: "/Users/example/Downloads/yc-w26-leads.acrm",
    filename: "yc-w26-leads.acrm",
    lastOpenedAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    timestampSource: "opened"
  }
];
const forceWelcomePreview =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("welcome");

function listPreviewRecords(
  objectSlug: string,
  options: RecordListOptions = {}
): RecordListResult {
  const limit = Math.min(250, Math.max(1, Math.floor(options.limit ?? 100)));
  const allRecords = sampleRecordsByObject[objectSlug] ?? [];
  const searchTerms = normalizePreviewSearchTerms(options.searchQuery);
  const matchingRecords =
    searchTerms.length > 0
      ? allRecords.filter((record) => previewRecordMatchesSearch(record, searchTerms))
      : allRecords;
  const cursorIndex =
    typeof options.cursor === "string"
      ? matchingRecords.findIndex((record) => record.record_id === options.cursor)
      : -1;
  const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const page = matchingRecords.slice(start, start + limit);
  const hasMore = start + limit < matchingRecords.length;
  return {
    objectSlug,
    records: page,
    limit,
    cursor: options.cursor ?? null,
    nextCursor: hasMore ? page[page.length - 1]?.record_id ?? null : null,
    hasMore,
    ...(searchTerms.length > 0 ? { totalMatches: matchingRecords.length } : {})
  };
}

function normalizePreviewSearchTerms(query: unknown): string[] {
  if (typeof query !== "string") return [];
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
}

function previewRecordMatchesSearch(record: RecordPreview, terms: string[]): boolean {
  const haystack = [
    record.label,
    record.subtitle,
    ...record.values.flatMap((value) => [
      value.title,
      value.display,
      ...value.values.map((item) => previewDisplayUnknown(item))
    ])
  ]
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function previewDisplayUnknown(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(previewDisplayUnknown).filter(Boolean).join(" ");
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    const candidate =
      item.full_name ??
      item.value ??
      item.title ??
      item.email_address ??
      item.domain ??
      item.root_domain ??
      item.date ??
      item.timestamp;
    if (candidate != null) return String(candidate);
  }
  return "";
}

function updatePreviewRecord(payload: UpdateRecordPayload) {
  const records = sampleRecordsByObject[payload.object_slug] ?? [];
  const record = records.find((item) => item.record_id === payload.record_id);
  if (!record) {
    throw new Error(`record not found: ${payload.object_slug}/${payload.record_id}`);
  }

  let changed = 0;
  for (const field of payload.fields) {
    const index = field.indexOf("=");
    if (index <= 0) continue;
    const attributeSlug = field.slice(0, index).trim();
    const rawValue = field.slice(index + 1).trim();
    const display = previewDisplayValue(payload.object_slug, attributeSlug, rawValue);
    const existing = record.values.find((value) => value.attribute_slug === attributeSlug);
    const next = {
      attribute_slug: attributeSlug,
      title: previewAttributeTitle(payload.object_slug, attributeSlug),
      type: previewAttributeType(payload.object_slug, attributeSlug),
      display,
      raw: rawValue,
      values: [rawValue]
    };
    if (existing) {
      Object.assign(existing, next);
    } else {
      record.values.push(next);
    }
    changed += 1;
  }

  return {
    updated: true as const,
    object_slug: payload.object_slug,
    record_id: payload.record_id,
    values_changed: changed
  };
}

function previewAttribute(objectSlug: string, attributeSlug: string) {
  return previewWorkspace.objects
    .find((object) => object.object_slug === objectSlug)
    ?.attributes.find((attribute) => attribute.attribute_slug === attributeSlug);
}

function previewAttributeTitle(objectSlug: string, attributeSlug: string) {
  return previewAttribute(objectSlug, attributeSlug)?.title ?? attributeSlug;
}

function previewAttributeType(objectSlug: string, attributeSlug: string) {
  return previewAttribute(objectSlug, attributeSlug)?.attribute_type ?? "text";
}

function previewDisplayValue(objectSlug: string, attributeSlug: string, rawValue: string) {
  const config = previewAttribute(objectSlug, attributeSlug)?.config;
  if (!config || typeof config !== "object" || Array.isArray(config)) return rawValue;
  const options = (config as { options?: unknown }).options;
  if (!Array.isArray(options)) return rawValue;
  const needle = rawValue.trim().toLowerCase();
  for (const option of options) {
    if (!option || typeof option !== "object" || Array.isArray(option)) continue;
    const item = option as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id : "";
    const title = typeof item.title === "string" ? item.title : "";
    if (id.toLowerCase() === needle || title.toLowerCase() === needle) {
      return title || id || rawValue;
    }
  }
  return rawValue;
}

const browserPreview: AppBridge = {
  platform: "browser",
  openWorkspaceDialog: async () => previewWorkspace,
  chooseWorkspaceDirectory: async () =>
    "/Users/example/Documents/Agent CRM workspaces/enterprise-growth-pipeline-directory",
  createWorkspace: async (_name: string, _parentDir?: string) => previewWorkspace,
  openWorkspacePath: async () => previewWorkspace,
  closeWorkspace: async () => undefined,
  getWorkspace: async () => (forceWelcomePreview ? null : previewWorkspace),
  listRecentWorkspaces: async () => previewRecentWorkspaces,
  listRecords: async (objectSlug: string, options?: RecordListOptions) =>
    listPreviewRecords(objectSlug, options),
  importCsv: async (_payload: ImportCsvPayload) => ({
    stats: {
      rows: 12,
      companies_created: 3,
      people_created: 9,
      deals_created: 2,
      people_skipped_no_identifier: 0
    },
    warnings: [],
    pending_at_final_flush: 0
  }),
  importTranscript: async (_payload: TranscriptPayload) => ({
    transcript_record_id: "preview-transcript",
    created: true,
    source: "manual",
    source_id: "preview",
    participants: {
      resolved: [],
      unresolved: []
    }
  }),
  createRecord: async (_payload: CreateRecordPayload) => ({
    created: true,
    object_slug: "people",
    record_id: "preview-created",
    values_inserted: 3
  }),
  updateRecord: async (payload: UpdateRecordPayload) => updatePreviewRecord(payload),
  runQuery: async (sql: string, params?: unknown[]) => {
    if (sql.includes("v.object_slug = 'people'") && params?.[1] === "communication_threads") {
      return {
        rows: [
          { rec_id: "preview-thread", attr: "subject", val: JSON.stringify("Platform team rollout - pricing + SOC2") },
          { rec_id: "preview-thread", attr: "channel", val: JSON.stringify("email") },
          { rec_id: "preview-thread", attr: "snippet", val: JSON.stringify("Thanks for sending these over. The team-tier pricing makes sense for us.") },
          { rec_id: "preview-thread", attr: "last_message_at", val: JSON.stringify("2026-05-25T17:18:00.000Z") },
          { rec_id: "preview-thread", attr: "message_count", val: JSON.stringify(3) }
        ],
        rowsAffected: 0
      };
    }
    if (sql.includes("v.object_slug = 'communication_messages'")) {
      return {
        rows: [
          { rec_id: "preview-message-1", attr: "channel", val: JSON.stringify("email") },
          { rec_id: "preview-message-1", attr: "direction", val: JSON.stringify("outbound") },
          { rec_id: "preview-message-1", attr: "sender", ref_object: "people", ref_record_id: "preview-user" },
          { rec_id: "preview-message-1", attr: "recipients", ref_object: "people", ref_record_id: "preview-person" },
          { rec_id: "preview-message-1", attr: "sent_at", val: JSON.stringify("2026-05-15T21:10:00.000Z") },
          { rec_id: "preview-message-1", attr: "body_text", val: JSON.stringify("Great chatting yesterday. Per your ask, here's the headless CLI quickstart and the auth-token guide.") },
          { rec_id: "preview-message-2", attr: "channel", val: JSON.stringify("email") },
          { rec_id: "preview-message-2", attr: "direction", val: JSON.stringify("inbound") },
          { rec_id: "preview-message-2", attr: "sender", ref_object: "people", ref_record_id: "preview-person" },
          { rec_id: "preview-message-2", attr: "recipients", ref_object: "people", ref_record_id: "preview-user" },
          { rec_id: "preview-message-2", attr: "sent_at", val: JSON.stringify("2026-05-25T17:18:00.000Z") },
          { rec_id: "preview-message-2", attr: "body_text", val: JSON.stringify("Thanks for sending these over. The team-tier pricing makes sense for us. One question on the SOC2 doc - can you confirm whether the model API counts as a sub-processor?") }
        ],
        rowsAffected: 0
      };
    }
    if (sql.includes("object_slug = 'people'") && sql.includes("attribute_slug IN")) {
      return {
        rows: [
          { record_id: "preview-person", attribute_slug: "name", value_json: JSON.stringify({ full_name: "Maya Chen" }) },
          { record_id: "preview-user", attribute_slug: "name", value_json: JSON.stringify({ full_name: "Margaret Hamilton" }) }
        ],
        rowsAffected: 0
      };
    }
    return {
      rows: [
        { object_slug: "people", count: 42 },
        { object_slug: "companies", count: 18 }
      ],
      rowsAffected: 0
    };
  },
  listSignals: async (): Promise<SignalDefinitionSummary[]> => [],
  listSignalFailures: async () => [],
  listSignalRuns: async () => [],
  syncSignals: async () => ({
    definitions: 0,
    attributes_created: 0,
    attributes_updated: 0
  }),
  runSignals: async (_request?: SignalRunRequest) => ({
    started: true,
    job: {
      id: "preview-signal-run",
      record_ids: [],
      signalSlugs: [],
      log_path: "",
      started_at: new Date(0).toISOString()
    }
  }),
  getCloudSyncStatus: async () => ({ state: "disconnected" }),
  triggerCloudSync: async () => ({ state: "disconnected" }),
  getCloudIntegrations: async (): Promise<CloudIntegrationsStatus> => ({
    state: "ready",
    workspaceId: "preview",
    integrations: {
      gmail: { connected: false },
      linkedin: { connected: false },
      granola: { connected: false }
    }
  }),
  onWorkspaceChanged: () => () => undefined,
  onCloudSyncStatus: () => () => undefined,
  onUpdateStatus: () => () => undefined,
  installUpdate: async () => undefined
};

export const api = window.crm ?? browserPreview;
export const isPreviewMode = !window.crm;
