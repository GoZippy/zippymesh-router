use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PriceConfig {
    pub base_price_per_token: f64,
    pub min_price_per_token: f64,
    pub congestion_multiplier: f64,
}

impl Default for PriceConfig {
    fn default() -> Self {
        Self {
            base_price_per_token: 0.0001,
            min_price_per_token: 0.00005,
            congestion_multiplier: 1.0,
        }
    }
}

pub fn calculate_spot_price(config: &PriceConfig, active_requests: usize) -> f64 {
    // Simple linear congestion pricing: Price increases by 10% for every 10 active requests
    let congestion_factor = 1.0 + (active_requests as f64 / 100.0);
    let spot_price = config.base_price_per_token * config.congestion_multiplier * congestion_factor;
    
    // Ensure we never go below min price
    f64::max(spot_price, config.min_price_per_token)
}
