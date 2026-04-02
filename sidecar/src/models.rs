use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub name: String,
    pub cost_per_token: f64,
    pub quantization: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceAnnouncement {
    pub peer_id: String,
    pub service_type: String, // "router" | "sidecar"
    pub models: Vec<ModelInfo>,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<Message>,
    pub temperature: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Choice {
    pub message: Message,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub choices: Vec<Choice>,
}
