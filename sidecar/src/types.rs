use crate::pricing::PriceConfig;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Model {
    pub name: String,
    pub cost_per_token: f64,
    pub quantization: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Peer {
    pub id: String,
    pub latency_ms: u32,
    pub models: Vec<Model>,
    pub price_config: Option<PriceConfig>, 
}

// Alias Peer as PeerAnnouncement to keep p2p naming consistent but avoid dupe code
pub type PeerAnnouncement = Peer;
