use tokio::sync::oneshot;
use crate::models::{ChatRequest, ChatResponse};
use libp2p::request_response::ResponseChannel;

#[derive(Debug)]
pub enum P2PCommand {
    SendChatRequest {
        peer_id: String,
        request: ChatRequest,
        response_channel: oneshot::Sender<Result<ChatResponse, String>>,
    },
    SendChatResponse {
        channel: ResponseChannel<ChatResponse>,
        response: ChatResponse,
    },
    ConnectPeer {
        multiaddr: String,
        response_channel: oneshot::Sender<Result<(), String>>,
    },
}
