import "@typespec/json-schema";
using JsonSchema;
@jsonSchema namespace Pero.Host;
model ChangedFile {path:string;old_path:string|null;added:safeint;deleted:safeint;binary:boolean;...Closed}
model WorkspaceChanges {id:string;scope:"turn"|"worktree";files:ChangedFile[];total:safeint;added:safeint;deleted:safeint;created_at:safeint;...Closed}
model ComparisonText {kind:"text";patch:string;...Closed}
model ComparisonBinary {kind:"binary";...Closed}
model ComparisonOversized {kind:"oversized";...Closed}
@oneOf union FileComparison {ComparisonText,ComparisonBinary,ComparisonOversized}
model ChangesRequestBase {method:"workspace_changes";request_id:string;thread_id:ThreadId;}
model ChangesList {action:"list";...ChangesRequestBase;...Closed}
model ChangesCurrent {action:"current";...ChangesRequestBase;...Closed}
model ChangesRead {action:"read";id:string;index:safeint;...ChangesRequestBase;...Closed}
@oneOf union ChangesRequest {ChangesList,ChangesCurrent,ChangesRead}
model WorkspaceChangesEvent {kind:"workspace_changes";...ThreadEventBase;data:{changes:WorkspaceChanges;...Closed}}
model WorkspaceChangesCatalogEvent {kind:"workspace_changes_catalog";...ThreadEventBase;data:{changes:WorkspaceChanges[];...Closed}}
model WorkspaceChangeDiffEvent {kind:"workspace_change_diff";...ThreadEventBase;data:{id:string;index:safeint;comparison:FileComparison;...Closed}}
model WorkspaceChangesErrorEvent {kind:"workspace_changes_error";...EventBase;thread_id?:string;data?:AcpPayload;}
