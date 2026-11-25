//! fnOS / 浏览器模式：把 Tauri 命令通过 HTTP 暴露出来。
//!
//! 复用桌面端完全相同的 `#[tauri::command]` 注册表，用 Tauri 的 MockRuntime
//! 承载无窗口 App，HTTP 请求转换为一次 IPC 调用。

use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use axum::body::{Body, Bytes};
use axum::extract::{Path as AxPath, State as AxState};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::Manager;

use crate::infrastructure::database::Database;
use crate::infrastructure::diagnostics::Diagnostics;
use crate::infrastructure::media_proxy::MediaProxy;
use crate::infrastructure::providers::bilibili::BilibiliProvider;
use crate::infrastructure::providers::lrclib::LrclibProvider;
use crate::infrastructure::providers::music_catalog::MusicCatalogProvider;
use crate::infrastructure::repositories::auth::AuthRepository;
use crate::infrastructure::update_install::UpdateState;

type Mock = tauri::test::MockRuntime;

pub struct ServerState {
    app: tauri::AppHandle<Mock>,
    web_dir: PathBuf,
    http: reqwest::Client,
}

impl ServerState {
    /// MediaProxy 可能在播放时重建监听端口，这里每次按当前地址取值。
    async fn proxy_base(&self) -> String {
        self.app.state::<MediaProxy>().base_url().await
    }
}

/// 启动 HTTP 服务（阻塞直到进程退出）。
pub async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = data_dir();
    std::fs::create_dir_all(&data_dir)?;
    let web_dir = web_dir();
    let host = std::env::var("BILIMUSIC_HOST").unwrap_or_else(|_| "0.0.0.0".into());
    let port: u16 = std::env::var("BILIMUSIC_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(8899);

    crate::infrastructure::providers::bilibili::initialize_requests(&data_dir);
    let database = Database::open_at(data_dir.clone())?;
    let media_proxy = MediaProxy::start_at(&data_dir).await?;
    let bilibili = BilibiliProvider::new()?;
    let saved_cookie = database
        .0
        .lock()
        .ok()
        .and_then(|connection| AuthRepository::get_cookie(&connection, "bilibili").ok().flatten());
    bilibili.set_session_cookie(saved_cookie).await;

    let builder = tauri::test::mock_builder().manage(UpdateState::default());
    let app = crate::register_commands(builder)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))?;
    app.manage(Diagnostics::open(data_dir.join("diagnostics-v1")));
    app.manage(database);
    app.manage(media_proxy);
    app.manage(bilibili);
    app.manage(LrclibProvider::new()?);
    app.manage(MusicCatalogProvider::new()?);
    app.manage(crate::sync::SyncState::default());

    tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build()?;

    let state = Arc::new(ServerState {
        app: app.handle().clone(),
        web_dir: web_dir.clone(),
        http: reqwest::Client::builder()
            .no_proxy()
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .build()?,
    });

    let router = Router::new()
        .route("/api/health", get(health))
        .route("/api/invoke/{command}", post(invoke))
        .route("/media/{*path}", get(media).head(media))
        .fallback(static_file)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind((host.as_str(), port)).await?;
    eprintln!(
        "BiliMusic web server listening on http://{host}:{port} (data: {}, web: {})",
        data_dir.display(),
        web_dir.display()
    );
    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

fn data_dir() -> PathBuf {
    std::env::var_os("BILIMUSIC_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .or_else(|| std::env::var_os("USERPROFILE"))
                .map(|home| PathBuf::from(home).join(".bilimusic"))
        })
        .unwrap_or_else(|| PathBuf::from(".bilimusic"))
}

fn web_dir() -> PathBuf {
    std::env::var_os("BILIMUSIC_WEB_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|exe| exe.parent().map(|dir| dir.join("web")))
        })
        .unwrap_or_else(|| PathBuf::from("web"))
}

async fn shutdown_signal() {
    let mut terminate = match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
    {
        Ok(signal) => signal,
        Err(_) => return std::future::pending::<()>().await,
    };
    tokio::select! {
        _ = terminate.recv() => {}
        _ = tokio::signal::ctrl_c() => {}
    }
    eprintln!("BiliMusic web server shutting down");
}

async fn health(AxState(state): AxState<Arc<ServerState>>) -> Response {
    let value = dispatch(&state, "app_health", json!({}))
        .unwrap_or_else(|_| json!({ "status": "ok" }));
    json_response(StatusCode::OK, &value)
}

async fn invoke(
    AxState(state): AxState<Arc<ServerState>>,
    AxPath(command): AxPath<String>,
    body: Bytes,
) -> Response {
    let args: Value = if body.is_empty() {
        json!({})
    } else {
        match serde_json::from_slice(&body) {
            Ok(value) => value,
            Err(error) => {
                return json_response(
                    StatusCode::BAD_REQUEST,
                    &json!({
                        "code": "BAD_REQUEST",
                        "message": format!("参数不是合法 JSON: {error}"),
                        "retryable": false,
                    }),
                );
            }
        }
    };

    match dispatch(&state, &command, args) {
        Ok(value) => {
            let text = serde_json::to_string(&value).unwrap_or_else(|_| "null".into());
            let proxy_base = state.proxy_base().await;
            let text = if proxy_base.is_empty() {
                text
            } else {
                text.replace(&proxy_base, "/media")
            };
            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
                text,
            )
                .into_response()
        }
        Err(error) => json_response(StatusCode::BAD_REQUEST, &normalize_error(error)),
    }
}

fn dispatch(state: &ServerState, command: &str, args: Value) -> Result<Value, Value> {
    let webview = state.app.get_webview_window("main").ok_or_else(|| {
        json!({ "code": "NO_WEBVIEW", "message": "webview 尚未初始化", "retryable": true })
    })?;
    let body = if args.is_object() {
        InvokeBody::Json(args)
    } else {
        InvokeBody::default()
    };
    let request = tauri::webview::InvokeRequest {
        cmd: command.to_string(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: "tauri://localhost"
            .parse()
            .unwrap_or_else(|_| "tauri://localhost".parse().expect("valid url")),
        body,
        headers: HeaderMap::new(),
        invoke_key: tauri::test::INVOKE_KEY.to_string(),
    };
    match tauri::test::get_ipc_response(&webview, request) {
        Ok(InvokeResponseBody::Json(text)) => Ok(serde_json::from_str(&text).unwrap_or(Value::Null)),
        Ok(InvokeResponseBody::Raw(bytes)) => {
            use base64::Engine;
            Ok(Value::String(
                base64::engine::general_purpose::STANDARD.encode(bytes),
            ))
        }
        Err(error) => Err(error),
    }
}

fn normalize_error(error: Value) -> Value {
    match error {
        Value::Object(mut map) if map.contains_key("message") => {
            map.entry("code")
                .or_insert_with(|| Value::String("INVOKE_ERROR".into()));
            map.entry("retryable").or_insert(Value::Bool(false));
            Value::Object(map)
        }
        Value::String(message) => json!({
            "code": "INVOKE_ERROR",
            "message": message,
            "retryable": false,
        }),
        other => json!({
            "code": "INVOKE_ERROR",
            "message": other.to_string(),
            "retryable": false,
        }),
    }
}

fn json_response(status: StatusCode, value: &Value) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
        serde_json::to_string(value).unwrap_or_else(|_| "null".into()),
    )
        .into_response()
}

/// 反向代理到进程内 MediaProxy，保留 Range / 206，保证拖动进度可用。
async fn media(
    AxState(state): AxState<Arc<ServerState>>,
    AxPath(path): AxPath<String>,
    headers: HeaderMap,
) -> Response {
    let proxy_base = state.proxy_base().await;
    let upstream = format!("{}/{}", proxy_base, path.trim_start_matches('/'));
    let mut request = state.http.get(&upstream);
    if let Some(range) = headers.get(header::RANGE) {
        request = request.header(header::RANGE, range.clone());
    }
    let response = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            return (
                StatusCode::BAD_GATEWAY,
                [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
                format!("media proxy error: {error}"),
            )
                .into_response();
        }
    };

    let status = response.status();
    let mut builder = Response::builder().status(status);
    for name in [
        header::CONTENT_TYPE,
        header::CONTENT_LENGTH,
        header::CONTENT_RANGE,
        header::ACCEPT_RANGES,
        header::ETAG,
        header::LAST_MODIFIED,
        header::CACHE_CONTROL,
    ] {
        if let Some(value) = response.headers().get(&name) {
            builder = builder.header(name, value);
        }
    }
    let stream = response.bytes_stream();
    builder
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

const MIME_CSS: &str = "text/css; charset=utf-8";
const MIME_HTML: &str = "text/html; charset=utf-8";
const MIME_JS: &str = "text/javascript; charset=utf-8";
const MIME_JSON: &str = "application/json; charset=utf-8";

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|value| value.to_str()) {
        Some("html") => MIME_HTML,
        Some("js") | Some("mjs") => MIME_JS,
        Some("css") => MIME_CSS,
        Some("json") | Some("map") => MIME_JSON,
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("wasm") => "application/wasm",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

async fn static_file(AxState(state): AxState<Arc<ServerState>>, uri: Uri) -> Response {
    let raw = uri.path().trim_start_matches('/');
    let relative = Path::new(raw);
    let safe = !relative.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    });
    let candidate = if raw.is_empty() || !safe {
        None
    } else {
        let path = state.web_dir.join(relative);
        tokio::fs::metadata(&path)
            .await
            .ok()
            .filter(|meta| meta.is_file())
            .map(|_| path)
    };

    if let Some(path) = candidate {
        return serve_file(&path).await;
    }
    // SPA fallback
    let index = state.web_dir.join("index.html");
    if tokio::fs::metadata(&index).await.is_ok() {
        return serve_file(&index).await;
    }
    (
        StatusCode::NOT_FOUND,
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        "BiliMusic web assets not found",
    )
        .into_response()
}

async fn serve_file(path: &Path) -> Response {
    match tokio::fs::read(path).await {
        Ok(bytes) => {
            let cache = if path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name == "index.html")
            {
                "no-cache"
            } else {
                "public, max-age=3600"
            };
            let mut headers = HeaderMap::new();
            headers.insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static(content_type(path)),
            );
            headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
            (headers, bytes).into_response()
        }
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("read {} failed: {error}", path.display()),
        )
            .into_response(),
    }
}
