mod p2p;
mod state;
mod models;
mod commands;
mod inference;

use axum::{
    routing::{get, post},
    Json, Router, Extension,
    http::StatusCode,
    response::IntoResponse,
};
use std::net::SocketAddr;
use tracing::{info, error, Level};
use tokio::sync::{mpsc, oneshot};
use crate::state::AppState;
use crate::commands::P2PCommand;
use crate::models::{ChatRequest, ChatResponse};

#[tokio::main]
async fn main() {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_max_level(Level::INFO)
        .init();

    info!("ZippyMesh Sidecar Starting...");

    // Create Command Channel
    let (p2p_tx, p2p_rx) = mpsc::channel(32);

    // Initialize Shared State
    let state = AppState::new(p2p_tx);

    // Start P2P Node
    let p2p_state = state.clone();
    tokio::spawn(async move {
        if let Err(e) = p2p::start_p2p_node(p2p_state, p2p_rx).await {
            error!("P2P Node Error: {:?}", e);
        }
    });

    // Start Internal API
    // Increase body limit? Default is usually fine for small chat requests
    let app = Router::new()
        .route("/health", get(|| async { "OK" }))
        .route("/peers", get(get_peers))
        .route("/routes", get(get_routes))
        .route("/proxy/chat/completions", post(proxy_chat_completions))
        .layer(Extension(state)); // Inject state

    let addr = SocketAddr::from(([0, 0, 0, 0], 9000));
    info!("Internal API listening on {}", addr);
    
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

use axum::extract::Query;
use serde::Deserialize;

#[derive(Deserialize)]
struct RouteQuery {
    model: Option<String>,
}

// Handler for /peers
async fn get_peers(Extension(state): Extension<AppState>) -> Json<Vec<crate::state::PeerInfo>> {
    let peers = state.peers.read().unwrap();
    let peer_list: Vec<_> = peers.values().cloned().collect();
    Json(peer_list)
}

// Handler for /routes?model=...
async fn get_routes(
    Extension(state): Extension<AppState>,
    Query(params): Query<RouteQuery>,
) -> Json<Vec<crate::state::PeerInfo>> {
    let peers = state.peers.read().unwrap();
    
    if let Some(model_name) = params.model {
        let index = state.model_index.read().unwrap();
        if let Some(peer_ids) = index.get(&model_name) {
            let mut result = Vec::new();
            for pid in peer_ids {
                if let Some(peer) = peers.get(pid) {
                    result.push(peer.clone());
                }
            }
            return Json(result);
        }
        return Json(vec![]);
    }
    
    let peer_list: Vec<_> = peers.values().cloned().collect();
    Json(peer_list)
}

// Proxy Chat Completions
async fn proxy_chat_completions(
    Extension(state): Extension<AppState>,
    Json(payload): Json<ChatRequest>,
) -> impl IntoResponse {
    // 1. Find Peer for Model
    let target_peer = {
        let index = state.model_index.read().unwrap();
        match index.get(&payload.model) {
            Some(peers) if !peers.is_empty() => peers[0].clone(), // Pick first one for now
            _ => return (StatusCode::NOT_FOUND, "Model not available in network").into_response(),
        }
    };

    // 2. Send Command to P2P Loop
    let (tx, rx) = oneshot::channel();
    if let Err(_) = state.p2p_client.send(P2PCommand::SendChatRequest {
        peer_id: target_peer,
        request: payload,
        response_channel: tx,
    }).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, "P2P Loop not responding").into_response();
    }

    // 3. Await Response
    match rx.await {
        Ok(Ok(response)) => Json(response).into_response(),
        Ok(Err(e)) => (StatusCode::BAD_GATEWAY, format!("P2P Request Failed: {}", e)).into_response(),
        Err(_) => (StatusCode::GATEWAY_TIMEOUT, "P2P Request Timed Out").into_response(),
    }
}
