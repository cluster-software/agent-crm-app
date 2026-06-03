import assert from "node:assert/strict";
import test from "node:test";
import { syncEngineEndpoints } from "../dist/electron/sync-engine-endpoints.js";

test("sync engine endpoint builders target session workspace and v1 API routes", () => {
  assert.equal(syncEngineEndpoints.sessionWorkspace(), "/app/workspace");
  assert.equal(
    syncEngineEndpoints.sessionWorkspaceRecords({
      objectSlug: "people",
      limit: 50,
      cursor: "cursor-1",
      valueAttributes: ["email_addresses", "linkedin_url"],
      includeSecondaryLabels: false,
      searchQuery: "maya chen"
    }),
    "/app/workspace/records?object_slug=people&limit=50&cursor=cursor-1&value_attributes=email_addresses%2Clinkedin_url&include_secondary_labels=false&search_query=maya+chen"
  );
  assert.equal(
    syncEngineEndpoints.sessionWorkspaceRecord("communication/messages", "record id/1"),
    "/app/workspace/records/communication%2Fmessages/record%20id%2F1"
  );
  assert.equal(
    syncEngineEndpoints.sessionWorkspaceDeal("deal id/1"),
    "/app/workspace/deals/deal%20id%2F1"
  );
  assert.equal(
    syncEngineEndpoints.workspaceIntegrationsStatus("workspace/1"),
    "/workspaces/workspace%2F1/integrations/status"
  );
  assert.equal(
    syncEngineEndpoints.workspaceIntegrationExport("workspace/1", "gmail", { partial: true }),
    "/workspaces/workspace%2F1/integrations/gmail/export?mode=partial"
  );
  assert.equal(
    syncEngineEndpoints.workspaceIntegrationExport("workspace/1", "linkedin"),
    "/workspaces/workspace%2F1/integrations/linkedin/export"
  );
  assert.equal(
    syncEngineEndpoints.personRelated("person/1", "communication_threads"),
    "/v1/people/person%2F1/related?object=communication_threads"
  );
  assert.equal(syncEngineEndpoints.personCompany("person/1"), "/v1/people/person%2F1/company");
  assert.equal(syncEngineEndpoints.companyTeam("company/1"), "/v1/companies/company%2F1/team");
  assert.equal(
    syncEngineEndpoints.communicationThreadMessages("thread/1"),
    "/v1/communication-threads/thread%2F1/messages"
  );
  assert.equal(syncEngineEndpoints.recordLabels(), "/v1/records/labels");
});
