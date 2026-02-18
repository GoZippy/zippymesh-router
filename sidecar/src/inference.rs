use crate::models::{ChatRequest, ChatResponse, Message, Choice};
use std::env;
use tracing::{info, error};

pub async fn perform_inference(req: ChatRequest) -> ChatResponse {
    let url = env::var("INFERENCE_URL").unwrap_or_else(|_| "http://localhost:20128/api/v1/chat/completions".to_string());
    
    info!("Forwarding inference request to: {}", url);

    let client = reqwest::Client::new();
    match client.post(&url)
        .json(&req)
        .send()
        .await 
    {
        Ok(res) => {
            if res.status().is_success() {
                match res.json::<ChatResponse>().await {
                    Ok(chat_res) => chat_res,
                    Err(e) => {
                        error!("Failed to parse inference response: {:?}", e);
                        error_response("Failed to parse upstream response")
                    }
                }
            } else {
                error!("Inference endpoint returned error: {:?}", res.status());
                error_response(&format!("Upstream error: {}", res.status()))
            }
        }
        Err(e) => {
            error!("Failed to contact inference endpoint: {:?}", e);
            error_response("Failed to contact local inference engine")
        }
    }
}

fn error_response(msg: &str) -> ChatResponse {
    ChatResponse {
        choices: vec![
            Choice {
                message: Message {
                    role: "system".to_string(),
                    content: msg.to_string(),
                }
            }
        ]
    }
}
