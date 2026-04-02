/**
 * @file route.js  — GET /api/graphql  (HTTP) + WebSocket upgrade (ws)
 * @description GraphQL + WebSocket block subscription gateway for ZippyCoin Network Monitor
 * (Task 1.3.1). Exposes:
 *   • POST /api/graphql — standard GraphQL query/mutation
 *   • GET  /api/graphql — GraphQL Playground (dev only)
 *   • WebSocket on the same endpoint — block subscription via graphql-ws
 *
 * Schema:
 *   Query { network: NetworkSummary, block(height: Int!): Block, validators: [Validator] }
 *   Subscription { newBlock: Block, networkUpdate: NetworkSummary }
 */

import { createYoga, createSchema } from 'graphql-yoga';

// Shared state — injected from the Network Monitor server via env or shared module
// In production this would be imported from a shared store or fetched via the REST API
const MONITOR_URL = process.env.MONITOR_URL || 'http://localhost:5657';

async function fetchMonitor(path: string) {
    const res = await fetch(`${MONITOR_URL}${path}`);
    if (!res.ok) throw new Error(`Monitor API error: ${res.status}`);
    return res.json();
}

const typeDefs = /* GraphQL */ `
  type Block {
    height: Int!
    hash: String!
    timestamp: String!
    txCount: Int!
    validator: String!
  }

  type Validator {
    id: String!
    name: String!
    status: String!
    trustScore: Float!
    blockHeight: Int!
    peerCount: Int!
    latency: Int!
    lastSeen: String!
  }

  type NetworkSummary {
    totalNodes: Int!
    onlineNodes: Int!
    offlineNodes: Int!
    activeValidators: Int!
    blockHeight: Int!
    totalPeers: Int!
    averageLatency: Float!
    averageTrustScore: Float!
    networkHealth: Float!
    lastUpdated: String!
  }

  type Query {
    network: NetworkSummary!
    block(height: Int!): Block
    validators: [Validator!]!
    blocks(page: Int, limit: Int): [Block!]!
  }

  type Subscription {
    networkUpdate: NetworkSummary!
    newBlock: Block!
  }
`;

// Server-Sent Events for subscriptions — polls Monitor API every 5s
function createNetworkStream(onData: (data: any) => void): () => void {
    let lastHeight = 0;
    const interval = setInterval(async () => {
        try {
            const summary = await fetchMonitor('/api/v1/network/summary');
            onData({ networkUpdate: summary });
            // Detect new block
            if (summary.blockHeight > lastHeight && summary.latestBlocks?.length > 0) {
                lastHeight = summary.blockHeight;
                onData({ newBlock: summary.latestBlocks[0] });
            }
        } catch { /* ignore transient errors */ }
    }, 5000);
    return () => clearInterval(interval);
}

const schema = createSchema({
    typeDefs,
    resolvers: {
        Query: {
            async network() {
                return fetchMonitor('/api/v1/network/summary');
            },
            async block(_: any, { height }: { height: number }) {
                try {
                    return fetchMonitor(`/api/v1/blocks/${height}`);
                } catch {
                    return null;
                }
            },
            async validators() {
                const data = await fetchMonitor('/api/v1/validators');
                return data.validators ?? [];
            },
            async blocks(_: any, { page = 1, limit = 20 }: { page?: number; limit?: number }) {
                const data = await fetchMonitor(`/api/v1/blocks?page=${page}&limit=${limit}`);
                return data.blocks ?? [];
            },
        },
        Subscription: {
            networkUpdate: {
                subscribe: () => ({
                    [Symbol.asyncIterator]() {
                        const queue: any[] = [];
                        let resolve: (() => void) | null = null;
                        const unsub = createNetworkStream(data => {
                            if (data.networkUpdate) {
                                queue.push(data.networkUpdate);
                                resolve?.();
                            }
                        });
                        return {
                            async next() {
                                if (queue.length === 0) {
                                    await new Promise<void>(r => { resolve = r; });
                                }
                                return { value: { networkUpdate: queue.shift() }, done: false };
                            },
                            async return() { unsub(); return { value: undefined, done: true }; },
                        };
                    },
                }),
            },
            newBlock: {
                subscribe: () => ({
                    [Symbol.asyncIterator]() {
                        const queue: any[] = [];
                        let resolve: (() => void) | null = null;
                        const unsub = createNetworkStream(data => {
                            if (data.newBlock) {
                                queue.push(data.newBlock);
                                resolve?.();
                            }
                        });
                        return {
                            async next() {
                                if (queue.length === 0) {
                                    await new Promise<void>(r => { resolve = r; });
                                }
                                return { value: { newBlock: queue.shift() }, done: false };
                            },
                            async return() { unsub(); return { value: undefined, done: true }; },
                        };
                    },
                }),
            },
        },
    },
});

const yoga = createYoga({ schema, graphqlEndpoint: '/api/graphql' });

export { yoga as GET, yoga as POST };
