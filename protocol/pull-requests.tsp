import "@typespec/json-schema";
using JsonSchema;
@jsonSchema namespace Pero.Host;
model PullRequestLoad {method:"pull_requests";action:"load";request_id:string;reference:string;...Closed}
model PullRequestDiscover {method:"pull_requests";action:"discover";request_id:string;thread_id:ThreadId;...Closed}
@oneOf union PullRequestRequest {PullRequestLoad,PullRequestDiscover}
model PullRequestFile {filename:string;previous_filename:string|null;status:string;additions:safeint;deletions:safeint;patch:string|null;...Closed}
model PullRequestCommit {sha:string;message:string;author:string;...Closed}
model PullRequestCheck {name:string;status:string;conclusion:string|null;url:string|null;...Closed}
model PullRequestReview {author:string;state:string;body:string;...Closed}
model PullRequestSection<T> {items:T[];error:string|null;...Closed}
model PullRequestSnapshot {
 reference:string;title:string;body:string;status:"open"|"draft"|"closed"|"merged";
 author:string;base:string;head:string;head_sha:string;additions:safeint;deletions:safeint;changed_files:safeint;
 files:PullRequestSection<PullRequestFile>;commits:PullRequestSection<PullRequestCommit>;
 checks:PullRequestSection<PullRequestCheck>;reviews:PullRequestSection<PullRequestReview>;...Closed
}
model PullRequestLoadedEvent {kind:"pull_request_loaded";...EventBase;data:PullRequestSnapshot}
model PullRequestErrorEvent {kind:"pull_request_error";...EventBase;thread_id?:string;}
model PullRequestDiscoveredEvent {kind:"pull_request_discovered";...ThreadEventBase;data:{reference:string;...Closed}}
