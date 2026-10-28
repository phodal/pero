import "@typespec/json-schema";
using JsonSchema;
@jsonSchema namespace Pero.Contributions;
model ContributionClosed { ...Record<never>; }
model ContributionBase {
  method: "contribution";
  @minLength(1) @maxLength(128) id: string;
  @minLength(1) @maxLength(128) task_id: string;
}
model ContributionPrepare {
  ...ContributionBase;
  operation: "prepare";
  repository: string;
  parent: string;
  title: string;
  source_url: string;
  source_revision: string;
  ...ContributionClosed;
}
model ContributionReview { ...ContributionBase; operation: "review" | "status"; workspace: string; ...ContributionClosed; }
model ContributionPublish { ...ContributionBase; operation: "publish"; workspace: string; review_token: string; ...ContributionClosed; }
@oneOf union ContributionRequest { ContributionPrepare, ContributionReview, ContributionPublish }
model ContributionSnapshot {
  task_id: string;
  repository: string;
  workspace: string;
  branch: string;
  base: string;
  base_head: string;
  title: string;
  source_url: string;
  source_revision: string;
  pr_url: string | null;
  head: string;
  review_token: string;
  diff: string;
  changed_files: string[];
  status: string;
  gh_available: boolean;
  gh_authenticated: boolean;
  ...ContributionClosed;
}
model ContributionResultEvent { version: 1; kind: "contribution_result"; request_id: string | null; text: string; data: ContributionSnapshot; ...ContributionClosed; }
model ContributionErrorData { code: string; message: string; task_id: string; ...ContributionClosed; }
model ContributionErrorEvent { version: 1; kind: "contribution_error"; request_id: string | null; text: string; data: ContributionErrorData; ...ContributionClosed; }
