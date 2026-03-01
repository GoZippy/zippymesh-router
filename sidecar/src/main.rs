mod p2p;
mod pricing;
mod types;

use actix_web::{get, post, web, App, HttpResponse, HttpServer, Responder};
use pricing::PriceConfig;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::mpsc;
use p2p::P2PCommand;
use types::{Model, Peer, PeerAnnouncement};
use uuid::Uuid;

#[derive(Serialize)]
struct NodeInfo {
    id: String,
    version: String,
    status: String,
}

#[derive(Deserialize)]
struct RouteQuery {
    model: Option<String>,
}

#[derive(Deserialize)]
struct PaymentRequest {
    target_peer_id: String,
    amount: f64,
}

#[derive(Serialize, Clone)]
struct Transaction {
    id: String,
    timestamp: u64,
    description: String,
    amount: f64,
    r#type: String, // "credit" or "debit"
}

#[derive(Serialize)]
struct PaymentResponse {
    payment_id: String,
    status: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct ExposedProviderConfig {
    provider_ids: Vec<String>,
    models: Vec<Model>,
}

#[derive(Clone, Serialize, Deserialize)]
struct WalletEntry {
    id: String,
    address: String,
    balance: f64,
}

struct AppState {
    peers: Mutex<Vec<Peer>>,
    price_config: Mutex<PriceConfig>,
    wallet_balance: Mutex<f64>,
    wallets: Mutex<std::collections::HashMap<String, WalletEntry>>,
    active_wallet_id: Mutex<String>,
    transactions: Mutex<Vec<Transaction>>,
    tx_p2p_command: mpsc::Sender<P2PCommand>,
    exposed_config: Mutex<Option<ExposedProviderConfig>>,
}

#[get("/health")]
async fn health_check() -> impl Responder {
    "HEALTH_CHECK_V3"
}

#[get("/version")]
async fn get_version() -> impl Responder {
    HttpResponse::Ok()
        .content_type("application/json")
        .body(r#"{"version": "1.0.0", "protocol": "1.0", "chain_id": 777}"#)
}

#[get("/node/info")]
async fn get_node_info(_data: web::Data<AppState>) -> impl Responder {
    HttpResponse::Ok().json(NodeInfo {
        id: "sidecar-mock-node-id".to_string(),
        version: "0.1.0".to_string(),
        status: "online".to_string(),
    })
}

#[get("/peers")]
async fn get_peers(data: web::Data<AppState>) -> impl Responder {
    let peers = data.peers.lock().unwrap();
    HttpResponse::Ok().json(&*peers)
}

#[get("/routes")]
async fn get_routes(query: web::Query<RouteQuery>, data: web::Data<AppState>) -> impl Responder {
    let peers = data.peers.lock().unwrap();
    let routes: Vec<&Peer> = if let Some(model) = &query.model {
        peers.iter().filter(|p| p.models.iter().any(|m| m.name == *model)).collect()
    } else {
        peers.iter().collect()
    };
    HttpResponse::Ok().json(routes)
}

#[get("/wallet/transactions")]
async fn get_transactions(data: web::Data<AppState>) -> impl Responder {
    let txs = data.transactions.lock().unwrap();
    HttpResponse::Ok().json(&*txs)
}

fn get_active_balance(data: &web::Data<AppState>) -> f64 {
    let active_id = data.active_wallet_id.lock().unwrap().clone();
    let wallets = data.wallets.lock().unwrap();
    wallets.get(&active_id).map(|w| w.balance).unwrap_or(0.0)
}

fn deduct_active_balance(data: &web::Data<AppState>, amount: f64) -> bool {
    let active_id = data.active_wallet_id.lock().unwrap().clone();
    let mut wallets = data.wallets.lock().unwrap();
    if let Some(w) = wallets.get_mut(&active_id) {
        if w.balance >= amount {
            w.balance -= amount;
            return true;
        }
    }
    false
}

#[post("/proxy/chat/completions")]
async fn proxy_chat(_req_body: String, data: web::Data<AppState>) -> impl Responder {
    let balance = get_active_balance(&data);
    let price_config = data.price_config.lock().unwrap();
    let estimated_tokens = 100.0;
    let cost = price_config.base_price_per_token * estimated_tokens; 
    
    if balance < cost {
        return HttpResponse::PaymentRequired().json(serde_json::json!({
            "error": "Insufficient funds",
            "required": cost,
            "current_balance": balance
        }));
    }
    
    if !deduct_active_balance(&data, cost) {
        return HttpResponse::PaymentRequired().json(serde_json::json!({
            "error": "Insufficient funds",
            "required": cost
        }));
    }
    
    let mut txs = data.transactions.lock().unwrap();
    txs.push(Transaction {
        id: Uuid::new_v4().to_string(),
        timestamp: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
        description: "LLM Inference Request (gpt-3.5-turbo)".to_string(),
        amount: -cost,
        r#type: "debit".to_string(),
    });

    HttpResponse::Ok()
        .content_type("application/json")
        .body(r#"{
            "id": "chatcmpl-mock-response",
            "object": "chat.completion",
            "created": 1677652288,
            "model": "gpt-3.5-turbo",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "This is a mocked response from the Zippy Sidecar! The decentralized network is working."
                },
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 20,
                "total_tokens": 30
            }
        }"#)
}

#[post("/payment/open_channel")]
async fn open_channel(req: web::Json<PaymentRequest>, data: web::Data<AppState>) -> impl Responder {
    let balance = get_active_balance(&data);
    if balance >= req.amount && deduct_active_balance(&data, req.amount) {
        
        let mut txs = data.transactions.lock().unwrap();
        txs.push(Transaction {
            id: Uuid::new_v4().to_string(),
            timestamp: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
            description: format!("Open Payment Channel to {}", req.target_peer_id),
            amount: -req.amount,
            r#type: "debit".to_string(),
        });

        HttpResponse::Ok().json(PaymentResponse {
            payment_id: Uuid::new_v4().to_string(),
            status: "success".to_string(),
        })
    } else {
        HttpResponse::BadRequest().json(serde_json::json!({
            "error": "Insufficient funds",
            "current_balance": balance
        }))
    }
}

#[get("/wallet/balance")]
async fn get_balance(data: web::Data<AppState>) -> impl Responder {
    let balance = get_active_balance(&data);
    HttpResponse::Ok().json(serde_json::json!({
        "balance": balance,
        "currency": "ZIP"
    }))
}

#[get("/wallet/list")]
async fn get_wallet_list(data: web::Data<AppState>) -> impl Responder {
    let wallets = data.wallets.lock().unwrap();
    let active_id = data.active_wallet_id.lock().unwrap().clone();
    let list: Vec<serde_json::Value> = wallets.values().map(|w| {
        serde_json::json!({
            "id": w.id,
            "address": w.address,
            "balance": w.balance,
            "isActive": w.id == active_id
        })
    }).collect();
    HttpResponse::Ok().json(list)
}

#[get("/node/pricing")]
async fn get_pricing(data: web::Data<AppState>) -> impl Responder {
    let config = data.price_config.lock().unwrap();
    HttpResponse::Ok().json(&*config)
}

#[post("/node/pricing")]
async fn set_pricing(req: web::Json<PriceConfig>, data: web::Data<AppState>) -> impl Responder {
    let mut config = data.price_config.lock().unwrap();
    *config = req.clone();
    
    let announcement = PeerAnnouncement {
        id: "sidecar-mock-node-id".to_string(),
        latency_ms: 10,
        models: vec![
            Model { name: "llama3".to_string(), cost_per_token: 0.0001, quantization: "q4".to_string() }
        ],
        price_config: Some(req.into_inner()),
    };
    
    if let Err(e) = data.tx_p2p_command.send(P2PCommand::Publish(announcement)).await {
        eprintln!("Failed to broadcast pricing update: {}", e);
    }

    HttpResponse::Ok().json(&*config)
}

#[get("/wallet/transactions")]
async fn get_transactions_list(data: web::Data<AppState>) -> impl Responder {
    let txs = data.transactions.lock().unwrap();
    HttpResponse::Ok().json(&*txs)
}

#[derive(Deserialize)]
struct ExposedProvidersRequest {
    provider_ids: Option<Vec<String>>,
    models: Option<Vec<Model>>,
}

#[post("/mesh/exposed-providers")]
async fn set_exposed_providers(req: web::Json<ExposedProvidersRequest>, data: web::Data<AppState>) -> impl Responder {
    let provider_ids = req.provider_ids.clone().unwrap_or_default();
    let models = req.models.clone().unwrap_or_else(|| {
        vec![Model { name: "llama3".to_string(), cost_per_token: 0.0001, quantization: "q4".to_string() }]
    });

    {
        let mut config = data.exposed_config.lock().unwrap();
        *config = Some(ExposedProviderConfig {
            provider_ids: provider_ids.clone(),
            models: models.clone(),
        });
    }

    let price_config = data.price_config.lock().unwrap().clone();
    let announcement = PeerAnnouncement {
        id: "sidecar-mock-node-id".to_string(),
        latency_ms: 10,
        models,
        price_config: Some(price_config),
    };

    if let Err(e) = data.tx_p2p_command.send(P2PCommand::Publish(announcement)).await {
        eprintln!("Failed to broadcast mesh announcement: {}", e);
    }

    HttpResponse::Ok().json(serde_json::json!({ "status": "ok", "provider_ids": provider_ids }))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let mut port = 9480;
    let args: Vec<String> = std::env::args().collect();
    for i in 0..args.len() {
        if args[i].starts_with("--api-port") {
            let p_str = if args[i].contains('=') {
                args[i].split('=').nth(1).unwrap_or("")
            } else if i + 1 < args.len() {
                &args[i+1]
            } else {
                ""
            };
            
            if let Ok(p) = p_str.parse::<u16>() {
                port = p;
            }
        }
    }

    println!("Starting Zippy Sidecar on port {}...", port);
    
    let (tx_peer_update, mut rx_peer_update) = mpsc::channel::<PeerAnnouncement>(32);
    let (tx_p2p_command, rx_p2p_command) = mpsc::channel::<P2PCommand>(32);

    let default_wallet = WalletEntry {
        id: "default".to_string(),
        address: "ZIP-MOCK-DEV-WALLET-001".to_string(),
        balance: 100.0,
    };
    let mut wallets_map = std::collections::HashMap::new();
    wallets_map.insert("default".to_string(), default_wallet);

    let app_state = web::Data::new(AppState {
        peers: Mutex::new(vec![]),
        price_config: Mutex::new(PriceConfig::default()),
        wallet_balance: Mutex::new(100.0),
        wallets: Mutex::new(wallets_map),
        active_wallet_id: Mutex::new("default".to_string()),
        exposed_config: Mutex::new(None),
        transactions: Mutex::new(vec![
            Transaction {
                id: Uuid::new_v4().to_string(),
                timestamp: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
                description: "Initial Airdrop".to_string(),
                amount: 100.0,
                r#type: "credit".to_string(),
            }
        ]),
        tx_p2p_command: tx_p2p_command.clone(),
    });

    let p2p_handle = tokio::spawn(async move {
        if let Err(e) = p2p::start_p2p_node("/zippy/1/discovery".to_string(), tx_peer_update, rx_p2p_command).await {
            eprintln!("P2P Node Error: {}", e);
        }
    });

    let state_clone = app_state.clone();
    tokio::spawn(async move {
        while let Some(announcement) = rx_peer_update.recv().await {
            let mut peers = state_clone.peers.lock().unwrap();
            if let Some(existing) = peers.iter_mut().find(|p| p.id == announcement.id) {
                existing.latency_ms = announcement.latency_ms;
                existing.models = announcement.models;
                existing.price_config = announcement.price_config;
            } else {
                peers.push(announcement);
            }
        }
    });

    // Spawn Heartbeat Task
    let tx_heartbeat = tx_p2p_command.clone();
    let state_heartbeat = app_state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            let (price_config, models) = {
                let config = state_heartbeat.price_config.lock().unwrap();
                let exposed = state_heartbeat.exposed_config.lock().unwrap();
                let price_config = config.clone();
                let models = exposed.as_ref()
                    .map(|e| e.models.clone())
                    .unwrap_or_else(|| vec![
                        Model { name: "llama3".to_string(), cost_per_token: price_config.base_price_per_token, quantization: "q4".to_string() }
                    ]);
                (price_config, models)
            };

            let announcement = PeerAnnouncement {
                id: "sidecar-mock-node-id".to_string(),
                latency_ms: 15,
                models,
                price_config: Some(price_config),
            };
            let _ = tx_heartbeat.send(P2PCommand::Publish(announcement)).await;
        }
    });

    HttpServer::new(move || {
        App::new()
            .app_data(app_state.clone())
            .service(health_check)
            .service(get_version)
            .service(get_node_info)
            .service(get_peers)
            .service(get_routes)
            .service(proxy_chat)
            .service(open_channel)
            .service(get_balance)
            .service(get_pricing)
            .service(set_pricing)
            .service(get_transactions)
            .service(set_exposed_providers)
            .service(get_wallet_list)
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}
