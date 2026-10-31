impl State {
    fn new(spec: Connector, r: &Request) -> Result<Self> {
        if spec.transport == "sse" {
            return Err("MCP_TRANSPORT_UNSUPPORTED");
        }
        if spec.tools.len() > 128
            || !(1..=45000).contains(&spec.call_timeout_ms)
            || !(1..=45000).contains(&spec.initialize_timeout_ms)
        {
            return Err("MCP_CONFIG");
        }
        let environment = bindings(&spec.env, &r.secrets, false)?;
        let mut headers = reqwest::header::HeaderMap::new();
        for (key, mut value) in bindings(&spec.headers, &r.secrets, true)? {
            // GitHub tokens are issued bare; accept them without a typed "Bearer " prefix.
            if spec.transport == "github"
                && key.eq_ignore_ascii_case("authorization")
                && !value.is_empty()
                && !value.starts_with("Bearer ")
            {
                value = format!("Bearer {}", value.trim());
            }
            headers.insert(
                reqwest::header::HeaderName::from_bytes(key.as_bytes())
                    .map_err(|_| "MCP_CONFIG")?,
                reqwest::header::HeaderValue::from_str(&value).map_err(|_| "MCP_CONFIG")?,
            );
        }
        if spec.oauth.is_some() && headers.contains_key("authorization") {
            return Err("MCP_CONFIG");
        }
        if spec.transport == "github" {
            if spec.oauth.is_some()
                || spec.allow_loopback_http
                || !spec.env.is_empty()
                || spec.command.is_some()
                || spec.sha256.is_some()
                || spec.cwd.is_some()
                || !spec.args.is_empty()
                || !spec.files.is_empty()
                || spec.headers.len() != 1
                || !spec.headers.iter().any(|(name, binding)| {
                    name.eq_ignore_ascii_case("authorization")
                        && matches!(binding, Binding::Secret(_))
                })
            {
                return Err("MCP_CONFIG");
            }
            let authorization = headers
                .get(header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
                .ok_or("MCP_SECRET_REQUIRED")?;
            if !authorization.strip_prefix("Bearer ").is_some_and(|token| {
                !token.is_empty() && !token.bytes().any(|byte| byte.is_ascii_whitespace())
            }) {
                return Err("MCP_SECRET_REQUIRED");
            }
        }
        if spec.transport == "gitlab" {
            if spec.oauth.is_some()
                || spec.allow_loopback_http
                || !spec.env.is_empty()
                || spec.command.is_some()
                || spec.sha256.is_some()
                || spec.cwd.is_some()
                || !spec.args.is_empty()
                || !spec.files.is_empty()
                || spec.headers.len() != 1
                || !spec.headers.iter().any(|(name, binding)| {
                    (name.eq_ignore_ascii_case("private-token")
                        || name.eq_ignore_ascii_case("authorization"))
                        && matches!(binding, Binding::Secret(_))
                })
            {
                return Err("MCP_CONFIG");
            }
            if let Some(value) = headers.get("private-token") {
                let token = value.to_str().map_err(|_| "MCP_SECRET_REQUIRED")?;
                if token.is_empty() || token.bytes().any(|byte| byte.is_ascii_whitespace()) {
                    return Err("MCP_SECRET_REQUIRED");
                }
            } else {
                let authorization = headers
                    .get(header::AUTHORIZATION)
                    .and_then(|value| value.to_str().ok())
                    .ok_or("MCP_SECRET_REQUIRED")?;
                if !authorization.strip_prefix("Bearer ").is_some_and(|token| {
                    !token.is_empty() && !token.bytes().any(|byte| byte.is_ascii_whitespace())
                }) {
                    return Err("MCP_SECRET_REQUIRED");
                }
            }
        }
        if spec.transport == "linear" {
            if spec.oauth.is_some()
                || spec.allow_loopback_http
                || !spec.env.is_empty()
                || spec.command.is_some()
                || spec.sha256.is_some()
                || spec.cwd.is_some()
                || !spec.args.is_empty()
                || !spec.files.is_empty()
                || spec.headers.len() != 1
                || !spec.headers.iter().any(|(name, binding)| {
                    name.eq_ignore_ascii_case("authorization")
                        && matches!(binding, Binding::Secret(_))
                })
            {
                return Err("MCP_CONFIG");
            }
            let authorization = headers
                .get(header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
                .ok_or("MCP_SECRET_REQUIRED")?;
            let token = authorization
                .strip_prefix("Bearer ")
                .unwrap_or(authorization);
            if token.is_empty() || token.bytes().any(|byte| byte.is_ascii_whitespace()) {
                return Err("MCP_SECRET_REQUIRED");
            }
        }
        let http = reqwest::Client::builder()
            .default_headers(headers)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(3))
            .build()
            .map_err(|_| "MCP_CONFIG")?;
        let credentials = crate::credentials::Mirror::default();
        let gitlab = if spec.transport == "gitlab" {
            Some(crate::gitlab::GitLabClient::new(
                spec.url.as_deref().ok_or("MCP_CONFIG")?,
                spec.tools.clone(),
                http.clone(),
            )?)
        } else {
            None
        };
        let github = if spec.transport == "github" {
            Some(crate::github::GitHubClient::new(
                spec.url.as_deref().ok_or("MCP_CONFIG")?,
                spec.tools.clone(),
                http.clone(),
            )?)
        } else {
            None
        };
        let linear = if spec.transport == "linear" {
            Some(crate::linear::LinearClient::new(
                spec.url.as_deref().ok_or("MCP_CONFIG")?,
                spec.tools.clone(),
                http.clone(),
            )?)
        } else {
            None
        };
        let gmail = if spec.transport == "gmail" {
            let oauth = spec.oauth.as_ref().ok_or("MCP_CONFIG")?;
            if !oauth.persist
                || oauth.registration != "preregistered"
                || spec.allow_loopback_http
                || !spec.env.is_empty()
                || !spec.headers.is_empty()
                || spec.command.is_some()
                || spec.sha256.is_some()
                || spec.cwd.is_some()
                || !spec.args.is_empty()
                || !spec.files.is_empty()
            {
                return Err("MCP_CONFIG");
            }
            let reference = &spec.app_secret.as_ref().ok_or("MCP_CONFIG")?.secret_ref;
            let secret = r.secrets.get(reference).ok_or("MCP_SECRET_REQUIRED")?;
            Some(crate::gmail::GmailClient::new(
                spec.url.as_deref().ok_or("MCP_CONFIG")?,
                &oauth.issuer,
                &oauth.client_id,
                secret,
                &oauth.redirect_uri,
                oauth.scopes.clone(),
                spec.tools.clone(),
                r.credentials.clone(),
                http.clone(),
            )?)
        } else {
            if spec.app_secret.is_some() {
                return Err("MCP_CONFIG");
            }
            None
        };
        let m365 = if spec.transport == "microsoft365" {
            let oauth = spec.oauth.as_ref().ok_or("MCP_CONFIG")?;
            if !oauth.persist
                || spec.allow_loopback_http
                || !spec.env.is_empty()
                || !spec.headers.is_empty()
                || spec.command.is_some()
                || spec.sha256.is_some()
                || spec.cwd.is_some()
                || !spec.args.is_empty()
                || !spec.files.is_empty()
            {
                return Err("MCP_CONFIG");
            }
            Some(crate::m365::Microsoft365Client::new(
                spec.url.as_deref().ok_or("MCP_CONFIG")?,
                &oauth.issuer,
                &oauth.client_id,
                &oauth.redirect_uri,
                oauth.scopes.clone(),
                spec.tools.clone(),
                r.credentials.clone(),
                http.clone(),
            )?)
        } else {
            if let Some(value) = r.credentials.as_ref().filter(|_| gmail.is_none()) {
                *credentials.0.lock().unwrap() =
                    Some(serde_json::from_value(value.clone()).map_err(|_| "MCP_AUTH_STORE")?);
            }
            None
        };
        Ok(Self {
            spec,
            connector: r.connector_id.clone(),
            id: r.session_id.clone(),
            peer: None,
            apps: r.apps,
            child: None,
            bounded_reader: None,
            http,
            auth: None,
            gitlab,
            github,
            linear,
            m365,
            gmail,
            tools: vec![],
            catalog: vec![],
            credentials,
            environment,
        })
    }
    async fn auth(&mut self) -> Result<AuthClient<reqwest::Client>> {
        if let Some(auth) = &self.auth {
            return Ok(auth.clone());
        }
        let cfg = self.spec.oauth.as_ref().ok_or("MCP_AUTH_NOT_CONFIGURED")?;
        if !matches!(cfg.registration.as_str(), "preregistered" | "dcr")
            || (cfg.registration == "preregistered" && cfg.client_id.is_empty())
            || (cfg.registration == "dcr" && !cfg.client_id.is_empty())
        {
            return Err("MCP_CONFIG");
        }
        let resource = endpoint(
            self.spec.url.as_deref().ok_or("MCP_CONFIG")?,
            self.spec.allow_loopback_http,
        )?;
        let issuer = endpoint(&cfg.issuer, self.spec.allow_loopback_http)?;
        // Connector headers belong to the resource server, not its OAuth issuer.
        let auth_http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(3))
            .build()
            .map_err(|_| "MCP_CONFIG")?;
        // Explicit pinned issuer, no discovery of arbitrary authorization servers or DCR.
        let metadata_url = format!(
            "{}/.well-known/oauth-authorization-server{}",
            issuer.origin().ascii_serialization(),
            issuer.path().trim_end_matches('/')
        );
        let mut response = auth_http
            .get(metadata_url)
            .send()
            .await
            .map_err(|_| "MCP_AUTH_METADATA")?;
        if !response.status().is_success() {
            return Err("MCP_AUTH_METADATA");
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "MCP_AUTH_METADATA")? {
            if bytes.len() + chunk.len() > LIMIT {
                return Err("MCP_AUTH_METADATA");
            }
            bytes.extend(chunk);
        }
        let metadata: AuthorizationMetadata =
            serde_json::from_slice(&bytes).map_err(|_| "MCP_AUTH_METADATA")?;
        if metadata.issuer.as_deref() != Some(&cfg.issuer)
            || !metadata
                .code_challenge_methods_supported
                .as_ref()
                .is_some_and(|v| v.iter().any(|x| x == "S256"))
        {
            return Err("MCP_AUTH_METADATA");
        }
        // The authorization page is the user-visible trust boundary and must
        // stay on the pinned issuer. Back-channel token and registration
        // endpoints are taken only from the issuer's HTTPS metadata document;
        // OAuth providers such as Vercel legitimately host them on a separate
        // API origin.
        if endpoint(
            &metadata.authorization_endpoint,
            self.spec.allow_loopback_http,
        )?
        .origin()
            != issuer.origin()
        {
            return Err("MCP_AUTH_ORIGIN");
        }
        endpoint(&metadata.token_endpoint, self.spec.allow_loopback_http)?;
        if cfg.registration == "dcr" {
            let registration = metadata
                .registration_endpoint
                .as_ref()
                .ok_or("MCP_AUTH_REGISTRATION")?;
            endpoint(registration, self.spec.allow_loopback_http)?;
        }
        let redirect = Url::parse(&cfg.redirect_uri).map_err(|_| "MCP_CONFIG")?;
        if redirect.scheme() != "http"
            || redirect.host_str() != Some("127.0.0.1")
            || redirect.port().is_none()
            || redirect.query().is_some()
            || redirect.fragment().is_some()
            || !redirect.username().is_empty()
            || redirect.password().is_some()
        {
            return Err("MCP_CONFIG");
        }
        let mut manager = AuthorizationManager::new(resource.as_str())
            .await
            .map_err(|_| "MCP_AUTH")?;
        manager.with_client(auth_http).map_err(|_| "MCP_AUTH")?;
        manager.set_metadata(metadata);
        manager.set_credential_store(self.credentials.clone());
        let initialized = manager
            .initialize_from_store()
            .await
            .map_err(|_| "MCP_AUTH_STORE")?;
        if !initialized {
            if cfg.registration == "dcr" {
                let stored_client_id = self
                    .credentials
                    .0
                    .lock()
                    .unwrap()
                    .as_ref()
                    .filter(|stored| stored.issuer.as_deref() == Some(cfg.issuer.as_str()))
                    .map(|stored| stored.client_id.clone())
                    .filter(|client_id| !client_id.is_empty());
                if let Some(client_id) = stored_client_id {
                    manager
                        .configure_client(
                            OAuthClientConfig::new(client_id, &cfg.redirect_uri)
                                .with_scopes(cfg.scopes.clone()),
                        )
                        .map_err(|_| "MCP_AUTH")?;
                } else {
                    let scopes: Vec<&str> = cfg.scopes.iter().map(String::as_str).collect();
                    let registered = manager
                        .register_client("Point", &cfg.redirect_uri, &scopes)
                        .await
                        .map_err(|_| "MCP_AUTH_REGISTRATION")?;
                    // DCR happens before the user grant. Persist the public
                    // client identity immediately so a failed probe or a
                    // cancelled consent window does not register duplicates.
                    *self.credentials.0.lock().unwrap() = Some(
                        StoredCredentials::new(registered.client_id, None, vec![], None)
                            .with_issuer(Some(cfg.issuer.clone())),
                    );
                }
            } else {
                manager
                    .configure_client(
                        OAuthClientConfig::new(&cfg.client_id, &cfg.redirect_uri)
                            .with_scopes(cfg.scopes.clone()),
                    )
                    .map_err(|_| "MCP_AUTH")?;
            }
        }
        let auth = AuthClient::new(self.http.clone(), manager);
        self.auth = Some(auth.clone());
        Ok(auth)
    }
    async fn connect(&mut self) -> Result<()> {
        if let Some(client) = &self.gitlab {
            client.ensure_authorized().await?;
            let offered = client.list_tools()["tools"]
                .as_array()
                .cloned()
                .ok_or("MCP_CATALOG")?;
            self.catalog = crate::gitlab::GitLabClient::known_tools();
            self.tools = offered;
            return Ok(());
        }
        if let Some(client) = &self.github {
            client.ensure_authorized().await?;
            let offered = client.list_tools()["tools"]
                .as_array()
                .cloned()
                .ok_or("MCP_CATALOG")?;
            self.catalog = crate::github::GitHubClient::known_tools();
            self.tools = offered;
            return Ok(());
        }
        if let Some(client) = &self.linear {
            client.ensure_authorized().await?;
            let offered = client.list_tools()["tools"]
                .as_array()
                .cloned()
                .ok_or("MCP_CATALOG")?;
            self.catalog = crate::linear::LinearClient::known_tools();
            self.tools = offered;
            return Ok(());
        }
        if let Some(client) = &mut self.gmail {
            client.ensure_authorized().await?;
            let offered = client.list_tools()["tools"]
                .as_array()
                .cloned()
                .ok_or("MCP_CATALOG")?;
            self.catalog = offered
                .iter()
                .filter_map(|tool| tool["name"].as_str().map(str::to_owned))
                .collect();
            self.tools = offered;
            return Ok(());
        }
        if let Some(client) = &mut self.m365 {
            client.ensure_authorized().await?;
            let offered = client.list_tools()["tools"]
                .as_array()
                .cloned()
                .ok_or("MCP_CATALOG")?;
            self.catalog = offered
                .iter()
                .filter_map(|tool| tool["name"].as_str().map(str::to_owned))
                .collect();
            self.tools = offered;
            return Ok(());
        }
        if self.peer.is_some() {
            return Ok(());
        }
        let info: rmcp::model::ClientInfo = serde_json::from_value(json!({
            "protocolVersion":rmcp::model::ProtocolVersion::default(), "clientInfo":{"name":"point-mcp","version":"0.1.0"},
            "capabilities": if self.apps { json!({"extensions":{"io.modelcontextprotocol/ui":{"mimeTypes":["text/html;profile=mcp-app"]}}}) } else { json!({}) }
        })).map_err(|_| "MCP_CONFIG")?;
        let peer = match self.spec.transport.as_str() {
            "builtin" | "stdio" => {
                let builtin = self.spec.transport == "builtin";
                let command = if builtin {
                    std::env::current_exe().map_err(|_| "MCP_CONFIG")?
                } else {
                    self.spec.command.clone().ok_or("MCP_CONFIG")?
                };
                if !builtin {
                    verify_file(&command, self.spec.sha256.as_deref().ok_or("MCP_CONFIG")?)?;
                    for file in &self.spec.files {
                        verify_file(&file.path, &file.sha256)?;
                    }
                }
                let default_cwd =
                    crate::platform::default_working_directory().map_err(|_| "MCP_CONFIG")?;
                let cwd = self.spec.cwd.as_deref().unwrap_or(&default_cwd);
                if !cwd.is_absolute() || !cwd.is_dir() {
                    return Err("MCP_CONFIG");
                }
                let mut cmd = tokio::process::Command::new(command);
                cmd.args(if builtin {
                    vec!["--server".to_owned()]
                } else {
                    self.spec.args.clone()
                })
                .env_clear()
                .envs(&self.environment)
                .current_dir(cwd)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .kill_on_drop(true);
                crate::platform::prepare_async_command(&mut cmd).map_err(|_| "MCP_SPAWN")?;
                let mut child = cmd.spawn().map_err(|_| "MCP_SPAWN")?;
                let input = child.stdin.take().ok_or("MCP_IO")?;
                let mut output = BufReader::new(child.stdout.take().ok_or("MCP_IO")?);
                let (read, mut write) = tokio::io::duplex(65536);
                self.bounded_reader = Some(tokio::spawn(async move {
                    while let Ok(frame) = line(&mut output, 1048576).await {
                        if write.write_all(&frame).await.is_err() {
                            break;
                        }
                    }
                }));
                self.child = Some(child);
                info.serve((read, input)).await.map_err(|_| "MCP_CONNECT")?
            }
            "http" => {
                let url = endpoint(
                    self.spec.url.as_deref().ok_or("MCP_CONFIG")?,
                    self.spec.allow_loopback_http,
                )?;
                let config = StreamableHttpClientTransportConfig::with_uri(url.to_string())
                    .max_concurrent_requests(1)
                    .max_sse_event_size(1048576)
                    .reinit_on_expired_session(false);
                if self.spec.oauth.is_some() {
                    let auth = self.auth().await?;
                    auth.get_access_token()
                        .await
                        .map_err(|_| "MCP_AUTH_REQUIRED")?;
                    info.serve(StreamableHttpClientTransport::with_client(auth, config))
                        .await
                        .map_err(|_| "MCP_CONNECT")?
                } else {
                    info.serve(StreamableHttpClientTransport::with_client(
                        self.http.clone(),
                        config,
                    ))
                    .await
                    .map_err(|_| "MCP_CONNECT")?
                }
            }
            _ => return Err("MCP_CONFIG"),
        };
        self.peer = Some(peer);
        // Bounded pagination; remote tool descriptions are untrusted data, not grants.
        let mut cursor = None;
        let mut tools = Vec::new();
        let mut catalog: Vec<String> = Vec::new();
        for page in 0..8 {
            let result = self
                .peer
                .as_ref()
                .unwrap()
                .list_tools(cursor.clone().map(|cursor| {
                    rmcp::model::PaginatedRequestParams::default().with_cursor(Some(cursor))
                }))
                .await
                .map_err(|_| "MCP_CATALOG")?;
            for tool in result.tools {
                let name = tool.name.to_string();
                // Bound what an untrusted server can make the host hold and
                // forward; the allowlist itself is still the only thing that
                // admits a call.
                if name.len() <= 128 && catalog.len() < 512 && !catalog.contains(&name) {
                    catalog.push(name.clone());
                }
                if self.spec.tools.contains(&name) {
                    tools.push(serde_json::to_value(tool).map_err(|_| "MCP_CATALOG")?);
                }
                if tools.len() > 128 {
                    return Err("MCP_CATALOG");
                }
            }
            cursor = result.next_cursor;
            if cursor.is_none() {
                break;
            }
            if page == 7 {
                return Err("MCP_CATALOG");
            }
        }
        // A server that offers nothing is a broken connection. A server whose
        // tools the allowlist does not admit yet is a connection waiting to be
        // configured, which is exactly the state discovery exists to resolve.
        if catalog.is_empty() {
            return Err("MCP_CATALOG");
        }
        self.tools = tools;
        self.catalog = catalog;
        Ok(())
    }
    async fn dispatch(&mut self, r: &Request) -> Result<Value> {
        if self.gitlab.is_some() {
            return self.dispatch_gitlab(r).await;
        }
        if self.github.is_some() {
            return self.dispatch_github(r).await;
        }
        if self.linear.is_some() {
            return self.dispatch_linear(r).await;
        }
        if self.gmail.is_some() {
            return self.dispatch_gmail(r).await;
        }
        if self.m365.is_some() {
            return self.dispatch_m365(r).await;
        }
        match r.method.as_str() {
            "mcp.session.open" => Ok(
                json!({"status":"open","transport":self.spec.transport,"callTimeoutMs":self.spec.call_timeout_ms,"initializeTimeoutMs":self.spec.initialize_timeout_ms}),
            ),
            "mcp.session.renew" => Ok(json!({"renewed":true})),
            "mcp.oauth.begin" => {
                if self.peer.is_some() {
                    return Err("MCP_ALREADY_CONNECTED");
                }
                // Replace the pending manager, but retain the last usable grant.
                // Cancelling a reauthorization must not log the user out.
                self.auth = None;
                let auth = self.auth().await?;
                let cfg = self.spec.oauth.as_ref().unwrap();
                let scopes: Vec<&str> = cfg.scopes.iter().map(String::as_str).collect();
                let mut manager = auth.auth_manager.lock().await;
                let (authorization_client_id, _) =
                    manager.get_credentials().await.map_err(|_| "MCP_AUTH")?;
                // initialize_from_store configures a restored client for token
                // use. Reconfigure it with the pinned loopback redirect before
                // minting a fresh authorization URL.
                manager
                    .configure_client(
                        OAuthClientConfig::new(&authorization_client_id, &cfg.redirect_uri)
                            .with_scopes(cfg.scopes.clone()),
                    )
                    .map_err(|_| "MCP_AUTH")?;
                let url = manager
                    .get_authorization_url(&scopes)
                    .await
                    .map_err(|_| "MCP_AUTH")?;
                Ok(
                    json!({"authorizationUrl":url,"redirectUri":cfg.redirect_uri,"authorizationClientId":authorization_client_id}),
                )
            }
            "mcp.oauth.complete" => {
                let callback = r.callback.as_ref().ok_or("MCP_AUTH_CALLBACK")?;
                let auth = self.auth.as_ref().ok_or("MCP_AUTH_REQUIRED")?;
                auth.auth_manager
                    .lock()
                    .await
                    .exchange_code_for_token_with_issuer(
                        &callback.code,
                        &callback.state,
                        callback.iss.as_deref(),
                    )
                    .await
                    .map_err(|_| "MCP_AUTH_CALLBACK")?;
                Ok(json!({"authorized":true}))
            }
            "mcp.tools.list" => {
                self.connect().await?;
                Ok(json!({
                    "tools": self.tools.iter().filter(|t| visible(t, "model")).collect::<Vec<_>>(),
                    "available": self.catalog,
                }))
            }
            "mcp.resources.read" => {
                self.connect().await?;
                let uri = r
                    .arguments
                    .as_ref()
                    .and_then(|a| a["uri"].as_str())
                    .ok_or("MCP_ARGUMENT")?;
                if !self.apps
                    || !uri.starts_with("ui://")
                    || !self.tools.iter().any(|t| {
                        t.pointer("/_meta/ui/resourceUri").and_then(Value::as_str) == Some(uri)
                    })
                {
                    return Err("MCP_TOOL_DENIED");
                }
                let value = self
                    .peer
                    .as_ref()
                    .unwrap()
                    .read_resource_once(rmcp::model::ReadResourceRequestParams::new(uri))
                    .await
                    .map_err(|_| "MCP_RESOURCE")?;
                let value = match value {
                    rmcp::model::ReadResourceResponse::Complete(value) => {
                        serde_json::to_value(value).map_err(|_| "MCP_REPLY")?
                    }
                    _ => return Err("MCP_UNSUPPORTED_INTERACTION_NO_REPLAY"),
                };
                let contents = value["contents"].as_array().ok_or("MCP_RESOURCE")?;
                if contents.len() != 1
                    || contents[0]["uri"] != uri
                    || contents[0]["mimeType"] != "text/html;profile=mcp-app"
                    || value.to_string().len() > 1048576
                {
                    return Err("MCP_RESOURCE");
                }
                Ok(value)
            }
            "mcp.tools.call" | "mcp.apps.call" => {
                self.connect().await?;
                let name = r.name.as_ref().ok_or("MCP_TOOL_DENIED")?;
                let app = r.method == "mcp.apps.call";
                if (app && !self.apps)
                    || !self.tools.iter().any(|t| {
                        t["name"] == *name && visible(t, if app { "app" } else { "model" })
                    })
                {
                    return Err("MCP_TOOL_DENIED");
                }
                let args = r
                    .arguments
                    .as_ref()
                    .and_then(Value::as_object)
                    .ok_or("MCP_ARGUMENT")?
                    .clone();
                let result = self
                    .peer
                    .as_ref()
                    .unwrap()
                    .call_tool_once(CallToolRequestParams::new(name.clone()).with_arguments(args))
                    .await
                    .map_err(|_| "MCP_CALL_FAILED_NO_REPLAY")?;
                match result {
                    rmcp::model::CallToolResponse::Complete(value) => {
                        serde_json::to_value(value).map_err(|_| "MCP_REPLY")
                    }
                    _ => Err("MCP_UNSUPPORTED_INTERACTION_NO_REPLAY"),
                }
            }
            _ => Err("MCP_METHOD_DENIED"),
        }
    }
    async fn dispatch_gitlab(&mut self, r: &Request) -> Result<Value> {
        match r.method.as_str() {
            "mcp.session.open" => Ok(
                json!({"status":"open","transport":"gitlab","callTimeoutMs":self.spec.call_timeout_ms,"initializeTimeoutMs":self.spec.initialize_timeout_ms}),
            ),
            "mcp.session.renew" => Ok(json!({"renewed":true})),
            "mcp.tools.list" => {
                self.connect().await?;
                Ok(self.gitlab.as_ref().ok_or("MCP_CONFIG")?.list_tools())
            }
            "mcp.tools.call" => {
                self.gitlab
                    .as_ref()
                    .ok_or("MCP_CONFIG")?
                    .call(
                        r.name.as_deref().ok_or("MCP_TOOL_DENIED")?,
                        r.arguments.as_ref().ok_or("MCP_ARGUMENT")?,
                    )
                    .await
            }
            "mcp.oauth.begin" | "mcp.oauth.complete" | "mcp.resources.read" | "mcp.apps.call" => {
                Err("MCP_TOOL_DENIED")
            }
            _ => Err("MCP_METHOD_DENIED"),
        }
    }
    async fn dispatch_github(&mut self, r: &Request) -> Result<Value> {
        match r.method.as_str() {
            "mcp.session.open" => Ok(
                json!({"status":"open","transport":"github","callTimeoutMs":self.spec.call_timeout_ms,"initializeTimeoutMs":self.spec.initialize_timeout_ms}),
            ),
            "mcp.session.renew" => Ok(json!({"renewed":true})),
            "mcp.tools.list" => {
                self.connect().await?;
                Ok(self.github.as_ref().ok_or("MCP_CONFIG")?.list_tools())
            }
            "mcp.tools.call" => {
                let name = r.name.as_deref().ok_or("MCP_TOOL_DENIED")?;
                let arguments = r.arguments.as_ref().ok_or("MCP_ARGUMENT")?;
                self.github
                    .as_ref()
                    .ok_or("MCP_CONFIG")?
                    .call(name, arguments)
                    .await
            }
            "mcp.oauth.begin" | "mcp.oauth.complete" | "mcp.resources.read" | "mcp.apps.call" => {
                Err("MCP_TOOL_DENIED")
            }
            _ => Err("MCP_METHOD_DENIED"),
        }
    }
    async fn dispatch_linear(&mut self, r: &Request) -> Result<Value> {
        match r.method.as_str() {
            "mcp.session.open" => Ok(
                json!({"status":"open","transport":"linear","callTimeoutMs":self.spec.call_timeout_ms,"initializeTimeoutMs":self.spec.initialize_timeout_ms}),
            ),
            "mcp.session.renew" => Ok(json!({"renewed":true})),
            "mcp.tools.list" => {
                self.connect().await?;
                Ok(self.linear.as_ref().ok_or("MCP_CONFIG")?.list_tools())
            }
            "mcp.tools.call" => {
                self.linear
                    .as_ref()
                    .ok_or("MCP_CONFIG")?
                    .call(
                        r.name.as_deref().ok_or("MCP_TOOL_DENIED")?,
                        r.arguments.as_ref().ok_or("MCP_ARGUMENT")?,
                    )
                    .await
            }
            "mcp.oauth.begin" | "mcp.oauth.complete" | "mcp.resources.read" | "mcp.apps.call" => {
                Err("MCP_TOOL_DENIED")
            }
            _ => Err("MCP_METHOD_DENIED"),
        }
    }
    async fn dispatch_gmail(&mut self, r: &Request) -> Result<Value> {
        let client = self.gmail.as_mut().ok_or("MCP_CONFIG")?;
        match r.method.as_str() {
            "mcp.session.open" => Ok(
                json!({"status":"open","transport":"gmail","callTimeoutMs":self.spec.call_timeout_ms,"initializeTimeoutMs":self.spec.initialize_timeout_ms}),
            ),
            "mcp.session.renew" => Ok(json!({"renewed":true})),
            "mcp.oauth.begin" => client.begin_authorization(),
            "mcp.oauth.complete" => {
                let callback = r.callback.as_ref().ok_or("MCP_AUTH_CALLBACK")?;
                client
                    .complete_authorization(
                        &callback.code,
                        &callback.state,
                        callback.iss.as_deref(),
                    )
                    .await
            }
            "mcp.tools.list" => {
                client.ensure_authorized().await?;
                Ok(client.list_tools())
            }
            "mcp.tools.call" => {
                let name = r.name.as_deref().ok_or("MCP_TOOL_DENIED")?;
                let arguments = r.arguments.as_ref().ok_or("MCP_ARGUMENT")?;
                client.call(name, arguments).await
            }
            "mcp.resources.read" | "mcp.apps.call" => Err("MCP_TOOL_DENIED"),
            _ => Err("MCP_METHOD_DENIED"),
        }
    }
    async fn dispatch_m365(&mut self, r: &Request) -> Result<Value> {
        let client = self.m365.as_mut().ok_or("MCP_CONFIG")?;
        match r.method.as_str() {
            "mcp.session.open" => Ok(
                json!({"status":"open","transport":"microsoft365","callTimeoutMs":self.spec.call_timeout_ms,"initializeTimeoutMs":self.spec.initialize_timeout_ms}),
            ),
            "mcp.session.renew" => Ok(json!({"renewed":true})),
            "mcp.oauth.begin" => client.begin_authorization(),
            "mcp.oauth.complete" => {
                let callback = r.callback.as_ref().ok_or("MCP_AUTH_CALLBACK")?;
                client
                    .complete_authorization(
                        &callback.code,
                        &callback.state,
                        callback.iss.as_deref(),
                    )
                    .await
            }
            "mcp.tools.list" => {
                client.ensure_authorized().await?;
                Ok(client.list_tools())
            }
            "mcp.tools.call" => {
                let name = r.name.as_deref().ok_or("MCP_TOOL_DENIED")?;
                let arguments = r.arguments.as_ref().ok_or("MCP_ARGUMENT")?;
                client.call(name, arguments).await
            }
            "mcp.resources.read" | "mcp.apps.call" => Err("MCP_TOOL_DENIED"),
            _ => Err("MCP_METHOD_DENIED"),
        }
    }
    async fn close(&mut self) {
        if let Some(peer) = self.peer.take() {
            let _ = tokio::time::timeout(Duration::from_millis(150), peer.cancel()).await;
        }
        if let Some(mut child) = self.child.take() {
            if let Some(pid) = child.id() {
                crate::platform::kill_owned_group(pid);
            }
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        if let Some(task) = self.bounded_reader.take() {
            task.abort();
            let _ = task.await;
        }
        self.auth = None;
    }
}
