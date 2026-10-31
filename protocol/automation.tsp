// Local Automation contracts. The Host owns admission, scheduling and execution.
import "@typespec/json-schema";
using JsonSchema;
@jsonSchema
namespace Pero.Automation;
@minValue(0) scalar AutomationCounter extends safeint;
model AutomationClosed { ...Record<never>; }
model AutomationLimits {
  max_events:uint32; max_requests:uint32; max_snapshots:uint32; max_definitions:uint32;
  max_fanout:uint32; max_event_bytes:uint32; max_active:uint32; max_dispatches:AutomationCounter; ...AutomationClosed;
}
model AutomationSourceBinding { id:string; owner:string; authority:string; event_kinds:string[]; ...AutomationClosed; }
model AutomationManualTrigger { kind:"manual"; ...AutomationClosed; }
model AutomationEventTrigger { kind:"event"; binding_id:string; event_kind:string; ...AutomationClosed; }
model AutomationTimeTrigger { kind:"time"; subject:string; exact:AutomationExactRef|null; anchor:AutomationCounter; interval_seconds:AutomationCounter; max_lateness_seconds:AutomationCounter; ...AutomationClosed; }
model CalendarSchedule { rule:string; timezone:string; first_slot:AutomationCounter; max_lateness_seconds:AutomationCounter; ...AutomationClosed; }
model AutomationCalendarTrigger { kind:"calendar"; schedule:CalendarSchedule; subject:string; exact:AutomationExactRef|null; ...AutomationClosed; }
@oneOf union AutomationTrigger { AutomationManualTrigger,AutomationEventTrigger,AutomationTimeTrigger,AutomationCalendarTrigger }
union AutomationInputContract { "process_exact","recheck_latest" }
model AutomationAgentMethod { kind:"agent"; agent_id:string; workspace:string; prompt:string; ...AutomationClosed; }
model AutomationLocalTarget { kind:"local_host"; owner:string; ...AutomationClosed; }
model AutomationUnsupportedTarget { kind:"shared"|"worker"; ...AutomationClosed; }
@oneOf union AutomationTarget { AutomationLocalTarget,AutomationUnsupportedTarget }
model AutomationDefinition {
  id:string; revision:AutomationCounter; owner:string; trigger:AutomationTrigger; input:AutomationInputContract;
  input_binding_id:string; method:AutomationAgentMethod; target:AutomationTarget; ...AutomationClosed;
}
model AutomationControl { paused:boolean; revoked:boolean; ...AutomationClosed; }
model AutomationControls is Record<AutomationControl>;
model AutomationCalendarSlots is Record<AutomationCounter>;
model AutomationExactRef { revision:string; digest:string; ...AutomationClosed; }
model AutomationCandidateRef { binding_id:string; subject:string; revision:string; digest:string; content_ref:string; ...AutomationClosed; }
model AutomationEventInput { binding_id:string; producer_id:string; event_kind:string; subject:string; exact:AutomationExactRef|null; digest:string; ...AutomationClosed; }
model AutomationAcceptedEvent { id:string; input:AutomationEventInput; position:AutomationCounter; accepted_at:AutomationCounter; ...AutomationClosed; }
model AutomationDecision { acceptance_id:string; definition_id:string; revision:AutomationCounter; request_id:string; ...AutomationClosed; }
model AutomationEventIntent { kind:"event"; ...AutomationClosed; }
model AutomationManualIntent { kind:"manual"; id:string; ...AutomationClosed; }
model AutomationTimeIntent { kind:"time"; slot:AutomationCounter; ...AutomationClosed; }
@oneOf union AutomationIntent { AutomationEventIntent,AutomationManualIntent,AutomationTimeIntent }
model AutomationSimpleRequestStatus { kind:"pending"|"input_unavailable"|"definition_changed"|"reserved"|"running"|"cancel_requested"|"reconcile"|"completed"|"failed"|"cancelled"|"expired"|"reconciled"|"not_started"; ...AutomationClosed; }
model AutomationCoveredRequestStatus { kind:"covered"; request_id:string; ...AutomationClosed; }
@oneOf union AutomationRequestStatus { AutomationSimpleRequestStatus,AutomationCoveredRequestStatus }
union AutomationReconciliationDisposition { "not_started","completed","failed","cancelled" }
model AutomationOperatorReconciliation {
  execution_id:string; disposition:AutomationReconciliationDisposition; evidence:string; recorded_at:AutomationCounter;
  previous_status:AutomationRequestStatus; authority:"local_operator"; ...AutomationClosed;
}
model AutomationRunRequest {
  id:string; definition:AutomationDefinition; intent:AutomationIntent; subject:string; exact:AutomationExactRef|null;
  created_at:AutomationCounter; through_position:AutomationCounter; snapshot:AutomationCandidateRef|null;
  execution_id:string|null; reprocess_of:string|null; operator_reconciliation:AutomationOperatorReconciliation|null; status:AutomationRequestStatus; continued_revision:boolean; cancel_requested:boolean; ...AutomationClosed;
}
model AutomationState {
  owner:string; limits:AutomationLimits; bindings:AutomationSourceBinding[]; definitions:AutomationDefinition[];
  controls:AutomationControls; revoked_bindings:string[]; snapshots:AutomationCandidateRef[]; latest:AutomationCandidateRef[];
  events:AutomationAcceptedEvent[]; decisions:AutomationDecision[]; requests:AutomationRunRequest[]; dispatch_count:AutomationCounter; calendar_slots?:AutomationCalendarSlots; ...AutomationClosed;
}
model AutomationUpdatedReceipt { kind:"updated"; ...AutomationClosed; }
model AutomationAcceptanceReceipt { kind:"acceptance"; id:string; duplicate:boolean; matched:uint32; ...AutomationClosed; }
model AutomationRequestReceipt { kind:"request"; id:string; duplicate:boolean; ...AutomationClosed; }
@oneOf union AutomationReceipt { AutomationUpdatedReceipt,AutomationAcceptanceReceipt,AutomationRequestReceipt }

model AutomationQuery { action:"query"; ...AutomationClosed; }
model AutomationCreateLocal { action:"create_local"; id:string; trigger:AutomationTrigger; input:AutomationInputContract; agent_id:string; prompt:string; ...AutomationClosed; }
model AutomationPutDefinition { action:"put_definition"; definition:AutomationDefinition; ...AutomationClosed; }
model AutomationPutBinding { action:"put_binding"; binding:AutomationSourceBinding; ...AutomationClosed; }
model AutomationPublishInput { action:"publish_input"; binding_id:string; subject:string; revision:string; content:string; latest:boolean; ...AutomationClosed; }
model AutomationEventAssertion { binding_id:string; producer_id:string; event_kind:string; subject:string; exact:AutomationExactRef|null; ...AutomationClosed; }
model AutomationAccept { action:"accept"; event:AutomationEventAssertion; ...AutomationClosed; }
model AutomationManualInput { action:"manual_input"; definition_id:string; intent_id:string; subject:string; content:string; ...AutomationClosed; }
model AutomationReconcile {
  action:"reconcile"; request_id:string; expected_execution_id:string; disposition:AutomationReconciliationDisposition;
  @minLength(1) @maxLength(4096) evidence:string; execution_stopped:true; effects_checked:true; ...AutomationClosed;
}
model AutomationCancel { action:"cancel"; request_id:string; ...AutomationClosed; }
model AutomationSetControl { action:"control"; definition_id:string; paused:boolean; revoked:boolean; ...AutomationClosed; }
model AutomationRevokeBinding { action:"revoke_binding"; binding_id:string; ...AutomationClosed; }
model AutomationContinueOld { action:"continue_old"; request_id:string; ...AutomationClosed; }
/** Internal execution receipts, reservations and clock ticks are never client commands. */
@oneOf union AutomationCommand { AutomationQuery,AutomationCreateLocal,AutomationPutDefinition,AutomationPutBinding,AutomationPublishInput,AutomationAccept,AutomationManualInput,AutomationCancel,AutomationSetControl,AutomationRevokeBinding,AutomationContinueOld,AutomationReconcile }
model AutomationRequest { method:"automation"; id:string; command:AutomationCommand; ...AutomationClosed; }
model AutomationAgentSummary { id:string; name:string; available:boolean; ...AutomationClosed; }
model AutomationCapabilities {
  owner:string; workspace:string; agents:AutomationAgentSummary[]; supportedTargets:"local_host"[];
  supportedMethods:"agent"[]; sourceBindingId:string; sourceKind:"local_published_registry"; maxInputBytes:uint32; available:boolean; unsupported:string[]; ...AutomationClosed;
}
model AutomationAttention is Record<string>;
model AutomationAuthority { agentId:string; workspace:string; configurationDigest:string; `model`:string|null; permissionPolicy:string; appUse:boolean; ...AutomationClosed; }
model AutomationAdmission { admittedAt:AutomationCounter; authority:AutomationAuthority; candidate:AutomationCandidateRef; ...AutomationClosed; }
model AutomationObservation { kind:string; observedAt:AutomationCounter; ...AutomationClosed; }
model AutomationAdmissionFailure { admissionFailure:string; ...AutomationClosed; }
model AutomationAdmissionEntry { execution_id:string; record:AutomationAdmission; ...AutomationClosed; }
model AutomationObservationEntry { execution_id:string; record:AutomationObservation|AutomationAdmissionFailure; ...AutomationClosed; }
model AutomationEvidence { admissions:AutomationAdmissionEntry[]; observations:AutomationObservationEntry[]; ...AutomationClosed; }
union AutomationCapacityKind { "requests","events","snapshots","definitions","dispatches" }
model AutomationCapacityCount { used:AutomationCounter; limit:AutomationCounter; ...AutomationClosed; }
model AutomationCapacityStatus {
  requests:AutomationCapacityCount; events:AutomationCapacityCount; snapshots:AutomationCapacityCount;
  definitions:AutomationCapacityCount; dispatches:AutomationCapacityCount; exhausted:AutomationCapacityKind[]; ...AutomationClosed;
}
model AutomationResult { state:AutomationState; capacity:AutomationCapacityStatus; capabilities:AutomationCapabilities; receipt?:AutomationReceipt; attention:AutomationAttention; fault:string|null; evidence:AutomationEvidence; ...AutomationClosed; }
