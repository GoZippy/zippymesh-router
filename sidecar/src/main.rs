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

struct AppState {
    peers: Mutex<Vec<Peer>>,
    price_config: Mutex<PriceConfig>,
    wallet_balance: Mutex<f64>,
    transactions: Mutex<Vec<Transaction>>,
    tx_p2p_command: mpsc::Sender<P2PCommand>,
}

#[get("/health")]
async fn health_check() -> impl Responder {
    "HEALTH_CHECK_V2"
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
    // Mock routing logic
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

#[post("/proxy/chat/completions")]
async fn proxy_chat(_req_body: String, data: web::Data<AppState>) -> impl Responder {
    println!("Proxying chat completion request to network...");
    
    let mut balance = data.wallet_balance.lock().unwrap();
    
    // Calculate cost based on current pricing
    let price_config = data.price_config.lock().unwrap();
    // Estimate tokens (e.g., 100 for now as a rough estimate for payment check)
    // In a real system, we'd use a pre-auth or streaming payment
    let estimated_tokens = 100.0;
    let cost = price_config.base_price_per_token * estimated_tokens; 
    
    if *balance < cost {
        return HttpResponse::PaymentRequired().json(serde_json::json!({
            "error": "Insufficient funds",
            "required": cost,
            "current_balance": *balance
        }));
    }
    
    *balance -= cost;
    
    // Record Transaction
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
    println!("Opening mock payment channel to {} for amount {}", req.target_peer_id, req.amount);
    
    let mut balance = data.wallet_balance.lock().unwrap();
    if *balance >= req.amount {
        *balance -= req.amount;
        
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
            "current_balance": *balance
        }))
    }
}

#[get("/wallet/balance")]
async fn get_balance(data: web::Data<AppState>) -> impl Responder {
    let balance = data.wallet_balance.lock().unwrap();
    HttpResponse::Ok().json(serde_json::json!({
        "balance": *balance,
        "currency": "ZIP"
    }))
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
    
    // Broadcast new pricing
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

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    println!("Starting Zippy Sidecar on port 8081...");
    
    let (tx_peer_update, mut rx_peer_update) = mpsc::channel::<PeerAnnouncement>(32);
    let (tx_p2p_command, rx_p2p_command) = mpsc::channel::<P2PCommand>(32);

    let app_state = web::Data::new(AppState {
        peers: Mutex::new(vec![]),
        price_config: Mutex::new(PriceConfig::default()),
        wallet_balance: Mutex::new(100.0),
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
            println!("Integrating announcement from: {}", announcement.id);
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

    // Spawn Heartbeat Task (Broadcast presence every 60s)
    let tx_heartbeat = tx_p2p_command.clone();
    let state_heartbeat = app_state.clone(); // Clone state for heartbeat task
    
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            println!("Broadcasting heartbeat...");
            
            // Read current pricing from state
            let price_config = {
                let config = state_heartbeat.price_config.lock().unwrap();
                config.clone()
            };

            let announcement = PeerAnnouncement {
                id: "sidecar-mock-node-id".to_string(),
                latency_ms: 15,
                models: vec![
                    Model { name: "llama3".to_string(), cost_per_token: price_config.base_price_per_token, quantization: "q4".to_string() }
                ],
                price_config: Some(price_config),
            };
             if let Err(e) = tx_heartbeat.send(P2PCommand::Publish(announcement)).await {
                eprintln!("Failed to broadcast heartbeat: {}", e);
            }
        }
    });

    HttpServer::new(move || {
        App::new()
            .app_data(app_state.clone())
            .service(health_check)
            .service(get_node_info)
            .service(get_peers)
            .service(get_routes)
            .service(proxy_chat)
            .service(open_channel)
            .service(get_balance)
            .service(get_pricing)
            .service(set_pricing)
            .service(get_transactions)
    })
    .bind(("0.0.0.0", 8081))?
    .run()
    .await
}

