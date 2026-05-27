import type {
  AppBridge,
  CloudIntegrationsStatus,
  CreateRecordPayload,
  ImportCsvPayload,
  RecordListOptions,
  RecordListResult,
  RecordPreview,
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
          attribute_slug: "company",
          title: "Company",
          type: "text",
          display: "Lumin AI",
          raw: "Lumin AI",
          values: ["Lumin AI"]
        },
        {
          attribute_slug: "domain",
          title: "Domain",
          type: "domain",
          display: "lumin.ai",
          raw: "lumin.ai",
          values: ["lumin.ai"]
        },
        {
          attribute_slug: "value",
          title: "Value",
          type: "currency",
          display: "24000",
          raw: 24000,
          values: [24000]
        },
        {
          attribute_slug: "close_date",
          title: "Close date",
          type: "date",
          display: "2026-06-18",
          raw: "2026-06-18",
          values: ["2026-06-18"]
        },
        {
          attribute_slug: "next_step",
          title: "Next step",
          type: "text",
          display: "Send updated rollout plan",
          raw: "Send updated rollout plan",
          values: ["Send updated rollout plan"]
        },
        {
          attribute_slug: "owner",
          title: "Owner",
          type: "text",
          display: "Enrique",
          raw: "Enrique",
          values: ["Enrique"]
        },
        {
          attribute_slug: "tags",
          title: "Tags",
          type: "text",
          display: "Expansion, Champion",
          raw: ["Expansion", "Champion"],
          values: ["Expansion", "Champion"]
        },
        {
          attribute_slug: "last_touch",
          title: "Last touch",
          type: "date",
          display: "2026-05-26",
          raw: "2026-05-26",
          values: ["2026-05-26"]
        }
      ]
    },
    {
      object_slug: "deals",
      record_id: "preview-deal-2",
      label: "Security review",
      subtitle: "Evaluation · 18000",
      values: [
        {
          attribute_slug: "stage",
          title: "Stage",
          type: "status",
          display: "Evaluation",
          raw: "evaluation",
          values: ["evaluation"]
        },
        {
          attribute_slug: "company",
          title: "Company",
          type: "text",
          display: "OrbitOps",
          raw: "OrbitOps",
          values: ["OrbitOps"]
        },
        {
          attribute_slug: "domain",
          title: "Domain",
          type: "domain",
          display: "orbitops.io",
          raw: "orbitops.io",
          values: ["orbitops.io"]
        },
        {
          attribute_slug: "value",
          title: "Value",
          type: "currency",
          display: "18000",
          raw: 18000,
          values: [18000]
        },
        {
          attribute_slug: "next_step",
          title: "Next step",
          type: "text",
          display: "Confirm SOC2 subprocessors",
          raw: "Confirm SOC2 subprocessors",
          values: ["Confirm SOC2 subprocessors"]
        },
        {
          attribute_slug: "owner",
          title: "Owner",
          type: "text",
          display: "Maya Chen",
          raw: "Maya Chen",
          values: ["Maya Chen"]
        },
        {
          attribute_slug: "tags",
          title: "Tags",
          type: "text",
          display: "Security, Enterprise",
          raw: ["Security", "Enterprise"],
          values: ["Security", "Enterprise"]
        },
        {
          attribute_slug: "last_touch",
          title: "Last touch",
          type: "date",
          display: "2026-05-24",
          raw: "2026-05-24",
          values: ["2026-05-24"]
        }
      ]
    },
    {
      object_slug: "deals",
      record_id: "preview-deal-3",
      label: "Team plan pilot",
      subtitle: "Trial · 12000",
      values: [
        {
          attribute_slug: "stage",
          title: "Stage",
          type: "status",
          display: "Trial",
          raw: "trial",
          values: ["trial"]
        },
        {
          attribute_slug: "company",
          title: "Company",
          type: "text",
          display: "Northstar Studio",
          raw: "Northstar Studio",
          values: ["Northstar Studio"]
        },
        {
          attribute_slug: "domain",
          title: "Domain",
          type: "domain",
          display: "northstar.studio",
          raw: "northstar.studio",
          values: ["northstar.studio"]
        },
        {
          attribute_slug: "value",
          title: "Value",
          type: "currency",
          display: "12000",
          raw: 12000,
          values: [12000]
        },
        {
          attribute_slug: "close_date",
          title: "Close date",
          type: "date",
          display: "2026-06-05",
          raw: "2026-06-05",
          values: ["2026-06-05"]
        },
        {
          attribute_slug: "owner",
          title: "Owner",
          type: "text",
          display: "Sam Rivera",
          raw: "Sam Rivera",
          values: ["Sam Rivera"]
        },
        {
          attribute_slug: "tags",
          title: "Tags",
          type: "text",
          display: "Pilot",
          raw: ["Pilot"],
          values: ["Pilot"]
        },
        {
          attribute_slug: "last_touch",
          title: "Last touch",
          type: "date",
          display: "2026-05-23",
          raw: "2026-05-23",
          values: ["2026-05-23"]
        }
      ]
    },
    {
      object_slug: "deals",
      record_id: "preview-deal-4",
      label: "Renewal",
      subtitle: "Won · 32000",
      values: [
        {
          attribute_slug: "stage",
          title: "Stage",
          type: "status",
          display: "Won",
          raw: "won",
          values: ["won"]
        },
        {
          attribute_slug: "company",
          title: "Company",
          type: "text",
          display: "Atlas Labs",
          raw: "Atlas Labs",
          values: ["Atlas Labs"]
        },
        {
          attribute_slug: "domain",
          title: "Domain",
          type: "domain",
          display: "atlaslabs.com",
          raw: "atlaslabs.com",
          values: ["atlaslabs.com"]
        },
        {
          attribute_slug: "value",
          title: "Value",
          type: "currency",
          display: "32000",
          raw: 32000,
          values: [32000]
        },
        {
          attribute_slug: "owner",
          title: "Owner",
          type: "text",
          display: "Priya Shah",
          raw: "Priya Shah",
          values: ["Priya Shah"]
        },
        {
          attribute_slug: "tags",
          title: "Tags",
          type: "text",
          display: "Renewal, Champion",
          raw: ["Renewal", "Champion"],
          values: ["Renewal", "Champion"]
        },
        {
          attribute_slug: "last_touch",
          title: "Last touch",
          type: "date",
          display: "2026-05-20",
          raw: "2026-05-20",
          values: ["2026-05-20"]
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
    deals: 4,
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
          is_unique: false,
          config: {
            options: [
              { id: "evaluation", title: "Evaluation" },
              { id: "in_progress", title: "In Progress" },
              { id: "trial", title: "Trial" },
              { id: "won", title: "Won" }
            ]
          }
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

function listPreviewRecords(
  objectSlug: string,
  options: RecordListOptions = {}
): RecordListResult {
  const limit = Math.min(250, Math.max(1, Math.floor(options.limit ?? 100)));
  const allRecords = sampleRecordsByObject[objectSlug] ?? [];
  const cursorIndex =
    typeof options.cursor === "string"
      ? allRecords.findIndex((record) => record.record_id === options.cursor)
      : -1;
  const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const page = allRecords.slice(start, start + limit);
  const hasMore = start + limit < allRecords.length;
  return {
    objectSlug,
    records: page,
    limit,
    cursor: options.cursor ?? null,
    nextCursor: hasMore ? page[page.length - 1]?.record_id ?? null : null,
    hasMore
  };
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
  getWorkspace: async () => previewWorkspace,
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
      linkedin: { connected: false }
    }
  }),
  onWorkspaceChanged: () => () => undefined,
  onCloudSyncStatus: () => () => undefined,
  onUpdateStatus: () => () => undefined,
  installUpdate: async () => undefined
};

export const api = window.crm ?? browserPreview;
export const isPreviewMode = !window.crm;
