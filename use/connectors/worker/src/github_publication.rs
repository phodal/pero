//! Explicitly selected Factory publication tools. No force/update/delete-ref,
//! merge, arbitrary URL or caller-controlled author/credential operation exists.
use super::*;

pub const TOOLS: [&str; 7] = ["github_factory_blob_create", "github_factory_tree_create", "github_factory_commit_create", "github_factory_branch_create", "github_factory_draft_create", "github_factory_pull_lookup", "github_factory_branch_advance"];
fn string<'a>(args: &'a Map<String, Value>, key: &str, max: usize) -> Result<&'a str> {
    args.get(key).and_then(Value::as_str).filter(|v| v.len() <= max && !v.contains('\0')).ok_or("MCP_ARGUMENT")
}
fn operation(args: &Map<String, Value>) -> Result<String> {
    let value = string(args, "operationId", 128)?;
    let suffix = value.strip_prefix("factory-").filter(|v| !v.is_empty() && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')).ok_or("MCP_ARGUMENT")?;
    Ok(format!("point/factory/factory-{suffix}"))
}
fn ordinary_path(value: &str) -> bool {
    !value.is_empty() && value.len() <= 1024 && !value.chars().any(|c| c.is_control() || c == '\\') &&
        value.split('/').all(|p| !p.is_empty() && p != "." && p != ".." && !p.eq_ignore_ascii_case(".git"))
}
pub fn request(api: &Url, name: &str, input: &Value) -> Result<(Url, Option<Value>)> {
    let fields: &[&str] = match name {
        "github_factory_blob_create" => &["owner", "repo", "content"],
        "github_factory_tree_create" => &["owner", "repo", "baseTree", "entries"],
        "github_factory_commit_create" => &["owner", "repo", "treeSha", "parentSha", "message", "timestamp"],
        "github_factory_branch_create" | "github_factory_branch_advance" => &["owner", "repo", "operationId", "headSha"],
        "github_factory_draft_create" => &["owner", "repo", "operationId", "baseRef", "title", "body"],
        "github_factory_pull_lookup" => &["owner", "repo", "operationId"],
        _ => return Err("MCP_TOOL_DENIED"),
    };
    let args = exact_object(input, fields, fields)?;
    let owner = candidate_identifier(args, "owner")?;
    let repo = candidate_identifier(args, "repo")?;
    let mut url = api.clone();
    url.path_segments_mut().map_err(|_| "MCP_CONFIG")?.extend(["repos", owner, repo]);
    let body = match name {
        "github_factory_pull_lookup" => {
            let branch = operation(args)?;
            url.path_segments_mut().map_err(|_| "MCP_CONFIG")?.push("pulls");
            url.query_pairs_mut().append_pair("state", "all").append_pair("head", &format!("{owner}:{branch}")).append_pair("per_page", "2");
            return Ok((url, None));
        }
        "github_factory_blob_create" => {
            let content = string(args, "content", 512 * 1024)?;
            url.path_segments_mut().map_err(|_| "MCP_CONFIG")?.extend(["git", "blobs"]);
            json!({"content": content, "encoding": "utf-8"})
        }
        "github_factory_tree_create" => {
            let base = git_oid(args, "baseTree")?;
            let entries = args.get("entries").and_then(Value::as_array).filter(|v| !v.is_empty() && v.len() <= 200).ok_or("MCP_ARGUMENT")?;
            let mut paths = BTreeSet::new(); let mut output = Vec::new();
            for entry in entries {
                let row = exact_object(entry, &["path", "mode", "sha"], &["path", "mode", "sha"])?;
                let path = string(row, "path", 1024)?;
                let mode = string(row, "mode", 6)?;
                if !ordinary_path(path) || !paths.insert(path) || !matches!(mode, "100644" | "100755") { return Err("MCP_ARGUMENT"); }
                let sha = if row.get("sha").is_some_and(Value::is_null) { Value::Null } else { json!(git_oid(row, "sha")?) };
                output.push(json!({"path": path, "mode": mode, "type": "blob", "sha": sha}));
            }
            url.path_segments_mut().map_err(|_| "MCP_CONFIG")?.extend(["git", "trees"]);
            json!({"base_tree": base, "tree": output})
        }
        "github_factory_commit_create" => {
            let tree = git_oid(args, "treeSha")?; let parent = git_oid(args, "parentSha")?;
            let message = string(args, "message", 1024)?;
            let run = message.strip_prefix("Factory candidate ").and_then(|v| v.strip_suffix('\n')).filter(|v| !v.is_empty() && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')).ok_or("MCP_ARGUMENT")?;
            let date = string(args, "timestamp", 20)?;
            if date.len() != 20 || date.bytes().enumerate().any(|(i,b)| match i {4|7=>b!=b'-',10=>b!=b'T',13|16=>b!=b':',19=>b!=b'Z',_=>!b.is_ascii_digit()}) { return Err("MCP_ARGUMENT"); }
            let identity = json!({"name": "Point Factory", "email": "factory@point.invalid", "date": date});
            url.path_segments_mut().map_err(|_| "MCP_CONFIG")?.extend(["git", "commits"]);
            json!({"tree": tree, "parents": [parent], "message": format!("Factory candidate {run}\n"), "author": identity, "committer": identity})
        }
        "github_factory_branch_advance" => {
            let branch = operation(args)?; let head = git_oid(args, "headSha")?;
            url.path_segments_mut().map_err(|_| "MCP_CONFIG")?.extend(["git", "refs", "heads", &branch]);
            json!({"sha": head, "force": false})
        }
        "github_factory_branch_create" => {
            let branch = operation(args)?; let head = git_oid(args, "headSha")?;
            url.path_segments_mut().map_err(|_| "MCP_CONFIG")?.extend(["git", "refs"]);
            json!({"ref": format!("refs/heads/{branch}"), "sha": head})
        }
        "github_factory_draft_create" => {
            let branch = operation(args)?;
            let base = string(args, "baseRef", 255)?;
            let mut branch_args = Map::new(); branch_args.insert("branch".into(), json!(base)); branch_name(&branch_args)?;
            let title = string(args, "title", 256)?; if title.trim().is_empty() {return Err("MCP_ARGUMENT");}
            let body = string(args, "body", 16000)?;
            url.path_segments_mut().map_err(|_| "MCP_CONFIG")?.push("pulls");
            json!({"head": branch, "base": base, "title": title, "body": body, "draft": true, "maintainer_can_modify": false})
        }
        _ => return Err("MCP_TOOL_DENIED"),
    };
    Ok((url, Some(body)))
}

pub fn schema(name: &str) -> Option<Value> {
    if !TOOLS.contains(&name) { return None; }
    let mut properties = json!({"owner":{"type":"string","minLength":1,"maxLength":100},"repo":{"type":"string","minLength":1,"maxLength":100}}).as_object()?.clone();
    let mut required = vec!["owner", "repo"];
    let fields: &[&str] = match name {
        "github_factory_blob_create" => &["content"], "github_factory_tree_create" => &["baseTree","entries"],
        "github_factory_commit_create" => &["treeSha","parentSha","message","timestamp"],
        "github_factory_branch_create" | "github_factory_branch_advance" => &["operationId","headSha"],
        "github_factory_draft_create" => &["operationId","baseRef","title","body"], _=> &["operationId"],
    };
    for field in fields {
        let schema = if *field == "entries" { json!({"type":"array","minItems":1,"maxItems":200,"items":{"type":"object","properties":{"path":{"type":"string"},"mode":{"enum":["100644","100755"]},"sha":{"type":["string","null"]}},"required":["path","mode","sha"],"additionalProperties":false}}) }
            else { json!({"type":"string","maxLength":if *field=="content" {512*1024} else if *field=="body" {16000} else {1024}}) };
        properties.insert((*field).into(), schema); required.push(field);
    }
    Some(json!({"name":name,"description":"Explicitly selected native Factory publication operation. It cannot merge, force-push, or replace an existing branch.","annotations":{"readOnlyHint":name=="github_factory_pull_lookup","destructiveHint":false,"idempotentHint":false},"inputSchema":{"type":"object","properties":properties,"required":required,"additionalProperties":false}}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn draft_is_fixed_and_never_ready_or_merge() {
        let api=Url::parse(API_ROOT).unwrap();
        let input=json!({"owner":"example","repo":"project","operationId":"factory-run1","baseRef":"main","title":"Change","body":"Evidence"});
        let (url,body)=request(&api,"github_factory_draft_create",&input).unwrap();
        assert_eq!(url.path(),"/repos/example/project/pulls");let body=body.unwrap();assert_eq!(body["draft"],true);assert_eq!(body["head"],"point/factory/factory-run1");assert_eq!(body["maintainer_can_modify"],false);
        let mut altered=input.clone();altered["draft"]=json!(false);assert!(request(&api,"github_factory_draft_create",&altered).is_err());
    }
    #[test] fn write_schema_and_paths_do_not_expand_read_grants() {
        assert_eq!(schema("github_factory_blob_create").unwrap()["annotations"]["readOnlyHint"],false);
        assert_eq!(schema("github_factory_pull_lookup").unwrap()["annotations"]["readOnlyHint"],true);
        let api=Url::parse(API_ROOT).unwrap();let input=json!({"owner":"example","repo":"project","baseTree":"a".repeat(40),"entries":[{"path":"../escape","mode":"100644","sha":"b".repeat(40)}]});
        assert!(request(&api,"github_factory_tree_create",&input).is_err());
        assert!(request(&api,"github_factory_ref_update",&json!({})).is_err());
    }
}
