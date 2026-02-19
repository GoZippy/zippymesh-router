use crate::types::{PeerAnnouncement};
use libp2p::{
    gossipsub, mdns, noise, swarm::NetworkBehaviour, swarm::SwarmEvent, tcp, yamux, PeerId, SwarmBuilder,
};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::time::Duration;
use tokio::sync::mpsc;
use tracing::{info, error};

#[derive(NetworkBehaviour)]
pub struct ZippyBehaviour {
    pub gossipsub: gossipsub::Behaviour,
    pub mdns: mdns::tokio::Behaviour,
}

pub enum P2PCommand {
    Publish(PeerAnnouncement),
}

pub async fn start_p2p_node(
    topic_name: String,
    tx_peer_update: mpsc::Sender<PeerAnnouncement>,
    mut rx_command: mpsc::Receiver<P2PCommand>,
) -> Result<(), Box<dyn std::error::Error>> {
    let id_keys = libp2p::identity::Keypair::generate_ed25519();
    let peer_id = PeerId::from(id_keys.public());
    info!("Local peer id: {peer_id}");

    let transport = tcp::tokio::Transport::new(tcp::Config::default().nodelay(true))
        .upgrade(libp2p::core::upgrade::Version::V1)
        .authenticate(noise::Config::new(&id_keys).unwrap())
        .multiplex(yamux::Config::default())
        .boxed();

    // Gossipsub config
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
        .expect("Valid config");

    let mut gossipsub = gossipsub::Behaviour::new(
        gossipsub::MessageAuthenticity::Signed(id_keys),
        gossipsub_config,
    )
    .expect("Correct config");

    let topic = gossipsub::IdentTopic::new(topic_name.clone());
    gossipsub.subscribe(&topic)?;

    let mdns = mdns::tokio::Behaviour::new(mdns::Config::default(), peer_id)?;

    let behaviour = ZippyBehaviour { gossipsub, mdns };

    let mut swarm = SwarmBuilder::with_existing_identity(peer_id)
        .with_tokio()
        .with_other_transport(|_key| transport)?
        .with_behaviour(|_| behaviour)?
        .build();

    swarm.listen_on("/ip4/0.0.0.0/tcp/0".parse()?)?;

    loop {
        tokio::select! {
            command = rx_command.recv() => match command {
                Some(P2PCommand::Publish(announcement)) => {
                    if let Ok(data) = serde_json::to_vec(&announcement) {
                         if let Err(e) = swarm.behaviour_mut().gossipsub.publish(topic.clone(), data) {
                             error!("Gossipsub publish error: {}", e);
                         } else {
                             info!("Broadcasted announcement for {}", announcement.id);
                         }
                    }
                }
                None => break,
            },
            event = swarm.select_next_some() => match event {
                SwarmEvent::Behaviour(ZippyBehaviourEvent::Mdns(mdns::Event::Discovered(list))) => {
                    for (peer_id, _multiaddr) in list {
                        info!("mDNS discovered a new peer: {peer_id}");
                        swarm.behaviour_mut().gossipsub.add_explicit_peer(&peer_id);
                    }
                },
                SwarmEvent::Behaviour(ZippyBehaviourEvent::Mdns(mdns::Event::Expired(list))) => {
                    for (peer_id, _multiaddr) in list {
                        info!("mDNS discover peer has expired: {peer_id}");
                        swarm.behaviour_mut().gossipsub.remove_explicit_peer(&peer_id);
                    }
                },
                SwarmEvent::Behaviour(ZippyBehaviourEvent::Gossipsub(gossipsub::Event::Message {
                    propagation_source: peer_id,
                    message_id: _id,
                    message,
                })) => {
                    if let Ok(announcement) = serde_json::from_slice::<PeerAnnouncement>(&message.data) {
                        info!("Received Announcement from {}: {:?}", announcement.id, announcement);
                        if let Err(e) = tx_peer_update.send(announcement).await {
                             error!("Failed to send peer update: {}", e);
                        }
                    }
                },
                _ => {}
            }
        }
    }
    Ok(())
}
