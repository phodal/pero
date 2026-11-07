// Explicit conversation deliveries. This catalog does not imply scientific verification.
import "@typespec/json-schema";
using JsonSchema;
@jsonSchema
namespace Pero.Host;

model ArtifactTextSource { kind:"text"; ...Closed }
model ArtifactFileSource { kind:"file"; path:string; ...Closed }
model ResearchArtifactSource { program_id:string; checkpoint_id:string; slot:string; export_digest:string; ...Closed }
model ArtifactResearchSource { kind:"research"; provenance:ResearchArtifactSource; ...Closed }
@oneOf union ArtifactSource { ArtifactTextSource, ArtifactFileSource, ArtifactResearchSource }
model ArtifactDocumentMedia { kind:"document"; format:ContentFormat; ...Closed }
model ArtifactSimpleMedia { kind:"csv"|"tsv"|"pdf"|"html"|"notebook"; ...Closed }
union ArtifactImageType { "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml" }
model ArtifactImageMedia { kind:"image"; mime_type:ArtifactImageType; ...Closed }
@oneOf union ArtifactMedia { ArtifactDocumentMedia, ArtifactSimpleMedia, ArtifactImageMedia }
union ArtifactRelationRole { "input", "code", "execution_log", "environment", "review" }
model ArtifactRelation {
  @minLength(1) @maxLength(128) artifact_id:string;
  @minValue(1) version:safeint;
  role:ArtifactRelationRole;
  ...Closed;
}
model SessionArtifactVersion {
  @minValue(1) version:safeint;
  @pattern("^[a-f0-9]{64}$") sha256:string;
  @minValue(0) @maxValue(10485760) bytes:safeint;
  format:ContentFormat;
  media?:ArtifactMedia;
  @minLength(1) @maxLength(255) filename?:string;
  source:ArtifactSource;
  @minLength(1) @maxLength(512) source_message_id?:string;
  @minLength(1) @maxLength(512) source_tool_call_id?:string;
  @maxItems(16) related?:ArtifactRelation[];
  @minValue(0) created_at:safeint;
  ...Closed;
}
/** Shell-private verified snapshot. The local path never enters the App or Wasm event stream. */
model ArtifactSnapshot {
  thread_id:ThreadId;
  artifact_id:string;
  @minValue(1) version:safeint;
  filename:string;
  media:ArtifactMedia;
  @pattern("^[a-f0-9]{64}$") sha256:string;
  @minValue(0) @maxValue(10485760) bytes:safeint;
  path:string;
  ...Closed;
}
model ArtifactPreviewTarget { thread_id:ThreadId; artifact_id:string; @minValue(1) version:safeint; ...Closed }
union ArtifactPresentation { "side", "expanded" }
/** Public UI state, not a second artifact catalog or Host persistence owner. */
model ArtifactBrowserState { thread_id:ThreadId; artifacts:SessionArtifact[]; selected:ArtifactPreviewTarget|null; view:ArtifactView; @minValue(1) preview_request?:safeint; shell_document_bar?:boolean; ...Closed }
model SessionArtifact {
  @minLength(1) @maxLength(128) id:string;
  thread_id:ThreadId;
  @minLength(1) @maxLength(200) title:string;
  @minItems(1) versions:SessionArtifactVersion[];
  ...Closed;
}
model ArtifactRequestBase {
  method:"artifacts";
  @minLength(1) @maxLength(128) request_id:string;
  thread_id:ThreadId;
}
model ArtifactRegistration {
  @minLength(1) @maxLength(128) artifact_id?:string|null;
  @minLength(1) @maxLength(512) source_message_id?:string|null;
  @minLength(1) @maxLength(512) source_tool_call_id?:string|null;
}
model ListArtifacts { action:"list"; ...ArtifactRequestBase; ...Closed }
model RegisterTextArtifact {
  action:"register_text";
  ...ArtifactRequestBase;
  ...ArtifactRegistration;
  @minLength(1) @maxLength(200) title:string;
  text:string;
  format?:ContentFormat|null;
  ...Closed;
}
model RegisterFileArtifact {
  action:"register_file";
  ...ArtifactRequestBase;
  ...ArtifactRegistration;
  @minLength(1) @maxLength(200) title?:string|null;
  path:string;
  presentation?:ArtifactPresentation;
  @maxItems(16) related?:ArtifactRelation[];
  ...Closed;
}
model ReadArtifact {
  action:"read";
  ...ArtifactRequestBase;
  @minLength(1) @maxLength(128) artifact_id:string;
  @minValue(1) version?:safeint|null;
  ...Closed;
}
model ResolveArtifactSnapshot {
  action:"resolve_snapshot";
  ...ArtifactRequestBase;
  artifact_id:string;
  @minValue(1) version:safeint;
  ...Closed;
}
model ArtifactContextRequest {
  action:"context";
  ...ArtifactRequestBase;
  artifact_id:string;
  @minValue(1) version:safeint;
  ...Closed;
}
@oneOf union ArtifactRequest { ListArtifacts, RegisterTextArtifact, RegisterFileArtifact, ReadArtifact, ResolveArtifactSnapshot, ArtifactContextRequest }

model ArtifactCatalogEvent { kind:"artifact_catalog"; ...ThreadEventBase; data:{artifacts:SessionArtifact[]; ...Closed} }
model ArtifactRegisteredEvent { kind:"artifact_registered"; ...ThreadEventBase; data:{artifact:SessionArtifact; presentation?:ArtifactPresentation; ...Closed} }
model ArtifactDocumentEvent { kind:"artifact_document"; ...ThreadEventBase; data:DocumentHeader }
model ArtifactContextEvent { kind:"artifact_context"; ...ThreadEventBase; data:ContextReference }
model ArtifactSnapshotSuccess { ok:true; value:ArtifactSnapshot; ...Closed }
model ArtifactSnapshotFailure { ok:false; error:string; ...Closed }
@oneOf union ArtifactSnapshotResult { ArtifactSnapshotSuccess, ArtifactSnapshotFailure }
/** Main/Native-only descriptor response. Shells consume it before forwarding public events. */
model ArtifactSnapshotResultEvent {
  kind:"artifact_snapshot_result"; ...EventBase; thread_id?:string; data:ArtifactSnapshotResult;
}
model ArtifactErrorEvent {
  kind:"artifact_error";
  ...EventBase;
  thread_id?:string;
  data:{thread_id:string|null; artifact_id:string|null; reason:"invalid"|"integrity"|"unavailable"|"unsupported"|"outside_workspace"|"read_write"; ...Closed};
}
