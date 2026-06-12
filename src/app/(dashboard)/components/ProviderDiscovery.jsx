'use client';

/**
 * Provider Discovery & Selection Component
 * Displays available mesh network providers and allows selection
 */

import React, { useState, useEffect } from 'react';
import { MapPin, Zap, Shield, DollarSign, RefreshCw } from 'lucide-react';

export default function ProviderDiscovery() {
    const [providers, setProviders] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [selectedProvider, setSelectedProvider] = useState(null);
    const [estimatedTokens, setEstimatedTokens] = useState(100);
    const [estimatedCost, setEstimatedCost] = useState(null);

    // Load providers on component mount
    useEffect(() => {
        discoverProviders();
    }, []);

    const discoverProviders = async () => {
        try {
            setLoading(true);
            setError(null);

            const response = await fetch('/api/mesh/providers?action=list');
            const data = await response.json();

            if (data.success) {
                setProviders(data.providers);
                if (data.providers.length > 0) {
                    setSelectedProvider(data.providers[0]);
                }
            } else {
                setError(data.error || 'Failed to discover providers');
            }
        } catch (err) {
            console.error('Failed to discover providers:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSelectProvider = (provider) => {
        setSelectedProvider(provider);
        estimateCostForProvider(provider);
    };

    const estimateCostForProvider = async (provider) => {
        try {
            const idx = providers.indexOf(provider);
            const response = await fetch(
                `/api/mesh/providers?action=estimate-cost&providerId=${idx}&tokens=${estimatedTokens}`
            );
            const data = await response.json();

            if (data.success) {
                setEstimatedCost(data.cost);
            }
        } catch (err) {
            console.error('Failed to estimate cost:', err);
        }
    };

    const handleTokensChange = (e) => {
        const tokens = parseInt(e.target.value);
        setEstimatedTokens(tokens);
        if (selectedProvider) {
            estimateCostForProvider(selectedProvider);
        }
    };

    if (loading && providers.length === 0) {
        return (
            <div className="flex items-center justify-center p-8">
                <div className="text-center">
                    <div className="animate-spin h-8 w-8 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-2"></div>
                    <p>Discovering providers...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full max-w-4xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-gray-800">Available Providers</h2>
                    <p className="text-gray-600 mt-1">Select an edge node to route your inference requests</p>
                </div>
                <button
                    onClick={discoverProviders}
                    disabled={loading}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                    title="Refresh provider list"
                >
                    <RefreshCw size={24} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-red-700">{error}</p>
                </div>
            )}

            {providers.length === 0 ? (
                <div className="text-center p-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                    <Zap size={48} className="mx-auto text-gray-400 mb-4" />
                    <p className="text-gray-600 mb-4">No providers available at this time</p>
                    <button
                        onClick={discoverProviders}
                        disabled={loading}
                        className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400"
                    >
                        Try Again
                    </button>
                </div>
            ) : (
                <>
                    {/* Provider Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {providers.map((provider, idx) => (
                            <div
                                key={idx}
                                onClick={() => handleSelectProvider(provider)}
                                className={`p-6 border-2 rounded-lg cursor-pointer transition-all ${
                                    selectedProvider === provider
                                        ? 'border-purple-600 bg-purple-50 shadow-lg'
                                        : 'border-gray-200 hover:border-purple-300 hover:shadow'
                                }`}
                            >
                                {/* Header */}
                                <div className="flex items-start justify-between mb-4">
                                    <div>
                                        <h3 className="font-semibold text-lg text-gray-800">
                                            {provider.nodeName}
                                        </h3>
                                        <p className="text-sm text-gray-600">{provider.nodeId}</p>
                                    </div>
                                    <div className="text-right">
                                        <div className="flex items-center gap-1 mb-1">
                                            <Shield size={14} className="text-green-600" />
                                            <span className="font-semibold text-green-600">{provider.trustScore}</span>
                                        </div>
                                        <p className="text-xs text-gray-500">Trust Score</p>
                                    </div>
                                </div>

                                {/* Location & Latency */}
                                <div className="grid grid-cols-2 gap-3 mb-4 p-3 bg-white rounded text-sm">
                                    <div>
                                        <MapPin size={14} className="inline mr-1 text-gray-500" />
                                        <span className="text-gray-700">{provider.region}</span>
                                    </div>
                                    <div>
                                        <Zap size={14} className="inline mr-1 text-orange-500" />
                                        <span className="text-gray-700">{provider.latency}ms</span>
                                    </div>
                                </div>

                                {/* Models */}
                                <div className="mb-4">
                                    <p className="text-xs font-semibold text-gray-600 mb-2">Available Models</p>
                                    <div className="flex flex-wrap gap-1">
                                        {provider.models.map((model, midx) => (
                                            <span key={midx} className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">
                                                {model.name}
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                {/* Pricing */}
                                <div className="text-xs text-gray-600 p-2 bg-gray-50 rounded">
                                    <DollarSign size={12} className="inline mr-1" />
                                    {provider.pricing.perToken} Wei/token
                                </div>

                                {selectedProvider === provider && (
                                    <div className="mt-3 text-center text-purple-600 font-semibold text-sm">
                                        ✓ Selected
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Cost Estimation */}
                    {selectedProvider && (
                        <div className="p-6 bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-lg">
                            <h3 className="font-semibold text-gray-800 mb-4">Estimated Cost</h3>
                            
                            <div className="space-y-3">
                                <div className="flex items-center gap-3">
                                    <label className="text-gray-700 font-medium">Token Estimate:</label>
                                    <input
                                        type="number"
                                        value={estimatedTokens}
                                        onChange={handleTokensChange}
                                        min="1"
                                        max="10000"
                                        className="p-2 border rounded w-32 text-right"
                                    />
                                    <span className="text-gray-600">tokens</span>
                                </div>

                                {estimatedCost && (
                                    <div className="grid grid-cols-3 gap-4 mt-4 p-4 bg-white rounded">
                                        <div>
                                            <p className="text-xs text-gray-600">Token Cost</p>
                                            <p className="font-semibold text-lg text-gray-800">
                                                {estimatedCost.tokenCostZip} ZIP
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-gray-600">Network Fee</p>
                                            <p className="font-semibold text-lg text-orange-600">
                                                {estimatedCost.networkFeeWei} Wei
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-gray-600">Total</p>
                                            <p className="font-semibold text-lg text-purple-600">
                                                {estimatedCost.totalCostZip} ZIP
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <button className="w-full mt-4 px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-semibold">
                                Submit Inference Request
                            </button>
                        </div>
                    )}

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-4 text-center">
                        <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                            <p className="text-2xl font-bold text-blue-600">{providers.length}</p>
                            <p className="text-sm text-gray-600">Available Providers</p>
                        </div>
                        <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                            <p className="text-2xl font-bold text-green-600">
                                {Math.min(...providers.map(p => p.latency))}ms
                            </p>
                            <p className="text-sm text-gray-600">Fastest Latency</p>
                        </div>
                        <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                            <p className="text-2xl font-bold text-purple-600">
                                {Math.max(...providers.map(p => p.trustScore))}
                            </p>
                            <p className="text-sm text-gray-600">Max Trust Score</p>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
