use futures::stream::StreamExt;
use libp2p::{
    gossipsub, mdns, noise, swarm::NetworkBehaviour, swarm::SwarmEvent, tcp, yamux, request_response, Multiaddr, PeerId
};
use tracing::{info, error};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::hash::{Hash, Hasher};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use tokio::io;
use tokio::select;
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, oneshot};

use crate::state::{AppState, PeerInfo};
use crate::models::{ModelInfo, ServiceAnnouncement, ChatRequest, ChatResponse};
use crate::commands::P2PCommand;
use crate::inference;

#[derive(NetworkBehaviour)]
pub struct ZippyMeshBehaviour {
    pub gossipsub: gossipsub::Behaviour,
    pub mdns: mdns::tokio::Behaviour,
    pub request_response: request_response::cbor::Behaviour<ChatRequest, ChatResponse>,
}

pub async fn start_p2p_node(
    state: AppState,
    mut command_receiver: mpsc::Receiver<P2PCommand>
) -> Result<(), Box<dyn std::error::Error>> {
    let mut swarm = libp2p::SwarmBuilder::with_new_identity()
        .with_tokio()
        .with_tcp(
            tcp::Config::default(),
            noise::Config::new,
            yamux::Config::default,
        )?
        .with_behaviour(|key| {
             // GossipSub Config
            let message_id_fn = |message: &gossipsub::Message| {
                let mut s = DefaultHasher::new();
                message.data.hash(&mut s);
                gossipsub::MessageId::from(s.finish().to_string())
            };
            let gossipsub_config = gossipsub::ConfigBuilder::default()
                .heartbeat_interval(Duration::from_secs(10)) 
                .validation_mode(gossipsub::ValidationMode::Strict) 
                .message_id_fn(message_id_fn) 
                .build()
                .map_err(|msg| io::Error::new(io::ErrorKind::Other, msg))?; 

            let gossipsub = gossipsub::Behaviour::new(
                gossipsub::MessageAuthenticity::Signed(key.clone()),
                gossipsub_config,
            )?;
            
            // mDNS Config
            let mdns = mdns::tokio::Behaviour::new(
                mdns::Config::default(),
                key.public().to_peer_id(),
            )?;

            // Request-Response Config (CBOR)
            let request_response = request_response::cbor::Behaviour::new(
                [(
                    libp2p::StreamProtocol::new("/zippy/1/chat"), 
                    request_response::ProtocolSupport::Full
                )],
                request_response::Config::default(),
            );
            
            Ok(ZippyMeshBehaviour { gossipsub, mdns, request_response })
        })?
        .with_swarm_config(|c| c.with_idle_connection_timeout(Duration::from_secs(60)))
        .build();

    // Subscribe to Topics
    let topic = gossipsub::IdentTopic::new("/zippy/1/discovery/global");
    swarm.behaviour_mut().gossipsub.subscribe(&topic)?;

    // Listen on TCP
    swarm.listen_on("/ip4/0.0.0.0/tcp/4001".parse()?)?;

    info!("P2P Node started. Local PeerId: {}", swarm.local_peer_id());

    // Broadcast Loop Setup
    let mut broadcast_interval = tokio::time::interval(Duration::from_secs(30));
    let my_peer_id = swarm.local_peer_id().to_string();
    let topic_clone = topic.clone();

    // Pending Requests Map
    let mut pending_requests = HashMap::new();

    // Event Loop
    loop {
        select! {
             // Handle Commands from API
             command = command_receiver.recv() => {
                 match command {
                     Some(P2PCommand::SendChatRequest { peer_id, request, response_channel }) => {
                        if let Ok(peer) = peer_id.parse::<PeerId>() {
                            let request_id = swarm.behaviour_mut().request_response.send_request(&peer, request);
                            pending_requests.insert(request_id, response_channel);
                            info!("Sent P2P Request {} to {}", request_id, peer);
                        } else {
                            let _ = response_channel.send(Err("Invalid Peer ID".to_string()));
                        }
                     }
                     Some(P2PCommand::SendChatResponse { channel, response }) => {
                         if let Err(e) = swarm.behaviour_mut().request_response.send_response(channel, response) {
                             error!("Failed to send P2P response: {:?}", e);
                         }
                     }
                     None => {
                         return Ok(()); // Channel closed
                     }
                 }
             }

             // Handle Periodic Broadcast
             _ = broadcast_interval.tick() => {
                // Mock Models for now (simulating what this node provides)
                let models = vec![
                    ModelInfo {
                        name: "llama-3-8b-instruct".to_string(),
                        cost_per_token: 0.0,
                        quantization: "int8".to_string(),
                    }
                ];

                let announcement = ServiceAnnouncement {
                    peer_id: my_peer_id.clone(),
                    service_type: "sidecar".to_string(),
                    models,
                    timestamp: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
                };
                
                if let Ok(json) = serde_json::to_vec(&announcement) {
                     if let Err(e) = swarm.behaviour_mut().gossipsub.publish(topic_clone.clone(), json) {
                        error!("Failed to broadcast announcement: {:?}", e);
                     } else {
                        info!("Broadcasted ServiceAnnouncement");
                     }
                }
            }

            // Handle Swarm Events
            event = swarm.select_next_some() => match event {
                SwarmEvent::NewListenAddr { address, .. } => {
                    info!("Listening on {:?}", address);
                }
                SwarmEvent::Behaviour(ZippyMeshBehaviourEvent::Mdns(mdns::Event::Discovered(list))) => {
                    for (peer_id, _multiaddr) in list {
                        info!("mDNS Discovered: {:?}", peer_id);
                        swarm.behaviour_mut().gossipsub.add_explicit_peer(&peer_id); // Optimization for local mesh
                        swarm.behaviour_mut().request_response.add_address(&peer_id, _multiaddr); // Ensure we have address for RR
                    }
                }
                SwarmEvent::Behaviour(ZippyMeshBehaviourEvent::Mdns(mdns::Event::Expired(list))) => {
                    for (peer_id, _multiaddr) in list {
                        // info!("mDNS Expired: {:?}", peer_id);
                        swarm.behaviour_mut().gossipsub.remove_explicit_peer(&peer_id);
                        swarm.behaviour_mut().request_response.remove_address(&peer_id, &_multiaddr);
                    }
                }
                SwarmEvent::Behaviour(ZippyMeshBehaviourEvent::Gossipsub(gossipsub::Event::Message {
                    propagation_source: peer_id,
                    message_id: _id,
                    message,
                })) => {
                     // Deserialize
                     if let Ok(announcement) = serde_json::from_slice::<ServiceAnnouncement>(&message.data) {
                        info!("Received Announcement from {}: {:?}", peer_id, announcement);
                        
                        // Update Peers Store
                        if let Ok(mut peers) = state.peers.write() {
                            peers.insert(announcement.peer_id.clone(), PeerInfo {
                                peer_id: announcement.peer_id.clone(),
                                service_type: announcement.service_type,
                                models: announcement.models.clone(),
                                last_seen: announcement.timestamp,
                            });
                        }
                        
                        // Update Model Index
                        if let Ok(mut index) = state.model_index.write() {
                            for model in &announcement.models {
                                index.entry(model.name.clone())
                                    .or_insert_with(Vec::new)
                                    .push(announcement.peer_id.clone());
                            }
                        }
                     }
                }
                SwarmEvent::Behaviour(ZippyMeshBehaviourEvent::RequestResponse(
                    request_response::Event::Message { message, .. }
                )) => {
                    match message {
                        request_response::Message::Request { request, channel, .. } => {
                             info!("Received P2P Chat Request. Spawning inference task.");
                             let tx = state.p2p_client.clone();
                             tokio::spawn(async move {
                                 let response = crate::inference::perform_inference(request).await;
                                 if let Err(e) = tx.send(P2PCommand::SendChatResponse { channel, response }).await {
                                     error!("Failed to send chat response back to main loop: {:?}", e);
                                 }
                             });
                        }
                        request_response::Message::Response { request_id, response } => {
                            if let Some(sender) = pending_requests.remove(&request_id) {
                                let _ = sender.send(Ok(response));
                            }
                        }
                    }
                }
                SwarmEvent::Behaviour(ZippyMeshBehaviourEvent::RequestResponse(
                    request_response::Event::OutboundFailure { request_id, error, .. }
                )) => {
                    error!("P2P Request failed: {:?}", error);
                    if let Some(sender) = pending_requests.remove(&request_id) {
                         let _ = sender.send(Err(format!("Request failed: {:?}", error)));
                    }
                }
                _ => {}
            }
        }
    }
}
