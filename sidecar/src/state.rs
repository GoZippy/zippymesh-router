use std::collections::HashMap;
use std::sync::{Arc, RwLock}; 
use serde::{Serialize, Deserialize};
use tokio::sync::mpsc;
use crate::commands::P2PCommand;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerInfo {
    pub peer_id: String,
    pub service_type: String,
    pub models: Vec<crate::models::ModelInfo>,
    pub last_seen: u64,
}

#[derive(Clone)]
pub struct AppState {
    pub peers: Arc<RwLock<HashMap<String, PeerInfo>>>,
    pub model_index: Arc<RwLock<HashMap<String, Vec<String>>>>,
    pub p2p_client: mpsc::Sender<P2PCommand>,
}

impl AppState {
    pub fn new(p2p_client: mpsc::Sender<P2PCommand>) -> Self {
        Self {
            peers: Arc::new(RwLock::new(HashMap::new())),
            model_index: Arc::new(RwLock::new(HashMap::new())),
            p2p_client,
        }
    }
}
