import type {
  AppBridge,
  CreateRecordPayload,
  ImportCsvPayload,
  RecordPreview,
  TranscriptPayload,
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
  activeValues: 184,
  counts: {
    companies: 18,
    people: 42,
    deals: 9,
    posts: 27,
    transcripts: 6
  },
  recent: sampleRecords,
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

const browserPreview: AppBridge = {
  platform: "browser",
  openWorkspaceDialog: async () => previewWorkspace,
  createWorkspace: async (_name: string) => previewWorkspace,
  openWorkspacePath: async () => previewWorkspace,
  closeWorkspace: async () => undefined,
  getWorkspace: async () => previewWorkspace,
  listRecords: async (objectSlug: string) => sampleRecordsByObject[objectSlug] ?? [],
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
  runQuery: async () => ({
    rows: [
      { object_slug: "people", count: 42 },
      { object_slug: "companies", count: 18 }
    ],
    rowsAffected: 0
  }),
  onWorkspaceChanged: () => () => undefined,
  onUpdateStatus: () => () => undefined,
  installUpdate: async () => undefined
};

export const api = window.crm ?? browserPreview;
export const isPreviewMode = !window.crm;
