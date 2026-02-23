"use client";

import { useEffect, useState } from 'react';
import { Card } from '@/shared/components/Card';
import { Button } from '@/shared/components/Button';
import { Input } from '@/shared/components/Input';
import { getWalletBalance, getPricingConfig, setPricingConfig } from '@/lib/sidecar';

export default function MonetizationPage() {
    const [balance, setBalance] = useState({ balance: 0, currency: 'ZIP' });
    const [config, setConfig] = useState({
        base_price_per_token: 0.0001,
        min_price_per_token: 0.00005,
        congestion_multiplier: 1.0,
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        async function fetchData() {
            try {
                const [bal, conf] = await Promise.all([
                    getWalletBalance(),
                    getPricingConfig()
                ]);
                if (bal) setBalance(bal);
                if (conf) setConfig(conf);
            } catch (e) {
                console.error("Failed to fetch monetization data", e);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            const updated = await setPricingConfig(config);
            if (updated) setConfig(updated);
            alert("Pricing updated!");
        } catch (e) {
            alert("Failed to update pricing.");
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="p-8">Loading Monetization Data...</div>;

    return (
        <div className="p-8 max-w-4xl mx-auto space-y-8">
            <h1 className="text-3xl font-bold tracking-tight">Monetization & Wallet</h1>

            {/* Wallet Section */}
            <Card className="p-6 bg-gradient-to-r from-indigo-500 to-purple-600 text-white">
                <div className="flex justify-between items-center">
                    <div>
                        <p className="text-indigo-100 font-medium">Current Balance</p>
                        <h2 className="text-4xl font-bold mt-2">
                            {balance.balance.toFixed(4)} <span className="text-xl opacity-80">{balance.currency}</span>
                        </h2>
                    </div>
                    <Button variant="secondary" className="bg-white text-indigo-600 hover:bg-gray-100">
                        Withdraw Funds
                    </Button>
                </div>
            </Card>

            {/* Pricing Config Section */}
            <Card className="p-6">
                <h3 className="text-xl font-semibold mb-4">Spot Pricing Configuration</h3>
                <p className="text-gray-500 mb-6">
                    Configure how much you charge for generic LLM inference. Prices update in real-time on the Gossip network.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Base Price (ZIP per Token)</label>
                        <Input
                            type="number"
                            step="0.00001"
                            value={config.base_price_per_token}
                            onChange={(e) => setConfig({ ...config, base_price_per_token: parseFloat(e.target.value) })}
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Congestion Multiplier (1.0 = No Surge)</label>
                        <Input
                            type="number"
                            step="0.1"
                            value={config.congestion_multiplier}
                            onChange={(e) => setConfig({ ...config, congestion_multiplier: parseFloat(e.target.value) })}
                        />
                    </div>
                </div>

                <div className="mt-6 flex justify-end">
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? "Saving..." : "Update Pricing Strategy"}
                    </Button>
                </div>
            </Card>

            {/* Recent Transactions (Placeholder) */}
            <Card className="p-6">
                <h3 className="text-xl font-semibold mb-4">Recent Transactions</h3>
                <div className="text-center py-8 text-gray-500">
                    No transactions yet. Connect to the P2P network to start earning.
                </div>
            </Card>
        </div>
    );
}
