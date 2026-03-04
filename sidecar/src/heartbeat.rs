//! Lightweight metrics for trust score. ServiceRegistry integration is optional (feature flag).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

#[derive(Default)]
pub struct HeartbeatMetrics {
    pub requests_processed: AtomicU64,
    pub avg_latency_ms: AtomicU64,
    pub error_count: AtomicU64,
    total_latency_ms: AtomicU64,
    avg_mutex: Mutex<()>,
}

impl HeartbeatMetrics {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record_request(&self, latency_ms: u64, success: bool) {
        // Update error count first if needed
        if !success {
            self.error_count.fetch_add(1, Ordering::SeqCst);
        }

        // Accumulate total latency and get previous value atomically
        let prev_total = self.total_latency_ms.fetch_add(latency_ms, Ordering::SeqCst);
        let prev_count = self.requests_processed.fetch_add(1, Ordering::SeqCst);

        // Calculate new average using a mutex to prevent race conditions
        let _lock = self.avg_mutex.lock().unwrap();
        let new_total = prev_total + latency_ms;
        let new_count = prev_count + 1;
        let new_avg = new_total / new_count;
        self.avg_latency_ms.store(new_avg, Ordering::SeqCst);
    }

    pub fn get_requests_processed(&self) -> u64 {
        self.requests_processed.load(Ordering::Relaxed)
    }

    pub fn get_avg_latency_ms(&self) -> u64 {
        self.avg_latency_ms.load(Ordering::Relaxed)
    }

    pub fn get_error_count(&self) -> u64 {
        self.error_count.load(Ordering::Relaxed)
    }

    fn get_success_rate(&self) -> f32 {
        let total = self.requests_processed.load(Ordering::Relaxed);
        if total == 0 {
            return 1.0;
        }
        let errors = self.error_count.load(Ordering::Relaxed);
        ((total - errors) as f32 / total as f32).max(0.0).min(1.0)
    }

    /// Trust score 0-100 from success rate and latency (lower latency = higher score component)
    pub fn calculate_trust_score(&self) -> u32 {
        let success_rate = self.get_success_rate();
        let avg_ms = self.avg_latency_ms.load(Ordering::Relaxed);
        // Latency component: 0-50, better when < 500ms
        let latency_score = if avg_ms == 0 {
            50
        } else {
            (50.0 * (1.0 - (avg_ms as f32 / 2000.0).min(1.0))) as u32
        };
        ((success_rate * 50.0) as u32) + latency_score
    }
}
