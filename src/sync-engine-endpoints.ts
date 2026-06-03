export type CloudCommunicationExportProvider = "gmail" | "linkedin";

export type SessionWorkspaceRecordListEndpointOptions = {
  objectSlug: string;
  limit?: number;
  cursor?: string | null;
  valueAttributes?: readonly string[];
  includeSecondaryLabels?: boolean;
  searchQuery?: string | null;
};

export type PersonRelatedObjectEndpoint = "transcripts" | "posts" | "communication_threads";

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function withSearch(pathname: string, params: URLSearchParams): string {
  const search = params.toString();
  return search ? `${pathname}?${search}` : pathname;
}

export const syncEngineEndpoints = {
  sessionWorkspace(): string {
    return "/app/workspace";
  },

  sessionWorkspaceRecords(options: SessionWorkspaceRecordListEndpointOptions): string {
    const params = new URLSearchParams();
    params.set("object_slug", options.objectSlug);
    if (options.limit != null) params.set("limit", String(options.limit));
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.valueAttributes?.length) {
      params.set("value_attributes", options.valueAttributes.join(","));
    }
    if (options.includeSecondaryLabels != null) {
      params.set("include_secondary_labels", String(options.includeSecondaryLabels));
    }
    if (options.searchQuery) params.set("search_query", options.searchQuery);
    return withSearch("/app/workspace/records", params);
  },

  sessionWorkspaceRecord(objectSlug: string, recordId: string): string {
    return `/app/workspace/records/${encodePathSegment(objectSlug)}/${encodePathSegment(recordId)}`;
  },

  sessionWorkspaceDeal(recordId: string): string {
    return `/app/workspace/deals/${encodePathSegment(recordId)}`;
  },

  workspaceIntegrationsStatus(workspaceId: string): string {
    return `/workspaces/${encodePathSegment(workspaceId)}/integrations/status`;
  },

  workspaceIntegrationExport(
    workspaceId: string,
    provider: CloudCommunicationExportProvider,
    options: { partial?: boolean } = {}
  ): string {
    const pathname = `/workspaces/${encodePathSegment(workspaceId)}/integrations/${provider}/export`;
    if (!options.partial) return pathname;
    const params = new URLSearchParams({ mode: "partial" });
    return withSearch(pathname, params);
  },

  personRelated(personRecordId: string, object: PersonRelatedObjectEndpoint): string {
    const pathname = `/v1/people/${encodePathSegment(personRecordId)}/related`;
    return withSearch(pathname, new URLSearchParams({ object }));
  },

  personCompany(personRecordId: string): string {
    return `/v1/people/${encodePathSegment(personRecordId)}/company`;
  },

  companyTeam(companyRecordId: string): string {
    return `/v1/companies/${encodePathSegment(companyRecordId)}/team`;
  },

  communicationThreadMessages(threadRecordId: string): string {
    return `/v1/communication-threads/${encodePathSegment(threadRecordId)}/messages`;
  },

  recordLabels(): string {
    return "/v1/records/labels";
  }
};
