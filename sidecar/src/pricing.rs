use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModelPriceOverride {
    /// Price per token (USD) for this model
    pub base: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PriceConfig {
    pub base_price_per_token: f64,
    pub min_price_per_token: f64,
    pub congestion_multiplier: f64,
    #[serde(default)]
    pub pricing_mode: Option<String>,
    #[serde(default)]
    pub margin_percent: Option<f64>,
    #[serde(default)]
    pub zip_usd_rate: Option<f64>,
    #[serde(default)]
    pub model_overrides: Option<HashMap<String, ModelPriceOverride>>,
}

impl Default for PriceConfig {
    fn default() -> Self {
        Self {
            base_price_per_token: 0.0001,
            min_price_per_token: 0.00005,
            congestion_multiplier: 1.0,
            pricing_mode: None,
            margin_percent: None,
            zip_usd_rate: None,
            model_overrides: None,
        }
    }
}

impl PriceConfig {
    /// Price per token for a given model: model_overrides lookup or base.
    pub fn price_per_token_for_model(&self, model: &str) -> f64 {
        if let Some(ref overrides) = self.model_overrides {
            if let Some(mo) = overrides.get(model) {
                return mo.base;
            }
            let canonical = model
                .split('/')
                .last()
                .unwrap_or(model)
                .to_lowercase()
                .replace(|c: char| !c.is_ascii_alphanumeric(), "-");
            if let Some(mo) = overrides.get(&canonical) {
                return mo.base;
            }
        }
        self.base_price_per_token
    }
}

pub fn calculate_spot_price(config: &PriceConfig, active_requests: usize) -> f64 {
    // Simple linear congestion pricing: Price increases by 10% for every 10 active requests
    let congestion_factor = 1.0 + (active_requests as f64 / 100.0);
    let spot_price = config.base_price_per_token * config.congestion_multiplier * congestion_factor;
    
    // Ensure we never go below min price
    f64::max(spot_price, config.min_price_per_token)
}
