const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const EventEmitter = require('events');

/**
 * ZippyNodeManager
 * 
 * Manages the lifecycle of the ZippyCoin node binary as a sidecar process.
 * Now includes log buffering and network state monitoring.
 */
class ZippyNodeManager extends EventEmitter {
    constructor() {
        super();
        this.nodeProcess = null;
        this.status = 'idle'; // idle, starting, running, stopping
        this.logs = [];
        this.maxLogSize = 500;
        this.networkStats = {
            blockHeight: 0,
            peerCount: 0,
            trustScore: 0,
            latency: 0,
            health: 0,
            lastPoll: null
        };
        this.pollInterval = null;
        this.config = {
            binaryPath: process.env.ZIPPY_NODE_BIN || path.join(__dirname, '../bin/zippycoin-node'),
            mode: 'edge', // edge, relay, full, validator
            broadcast: false,
            apiPort: 9480,
            rpcPort: 8545
        };
    }

    _addLog(line, type = 'info') {
        const logEntry = {
            timestamp: new Date().toISOString(),
            line: line.toString().trim(),
            type
        };
        this.logs.push(logEntry);
        if (this.logs.length > this.maxLogSize) {
            this.logs.shift();
        }
        this.emit('log', logEntry);
    }

    async start(mode = 'edge', broadcast = false) {
        if (this.nodeProcess) return;

        this.status = 'starting';
        this.config.mode = mode;
        this.config.broadcast = broadcast;

        const args = [
            `--mode=${mode}`,
            `--discovery-broadcast=${broadcast}`,
            `--api-port=${this.config.apiPort}`,
            `--rpc-port=${this.config.rpcPort}`
        ];

        this._addLog(`Starting ZippyNode in ${mode} mode (broadcast: ${broadcast})...`, 'system');

        try {
            this.nodeProcess = spawn(this.config.binaryPath, args, {
                detached: true,
                stdio: 'pipe'
            });

            this.nodeProcess.stdout.on('data', (data) => {
                this._addLog(data, 'stdout');
            });

            this.nodeProcess.stderr.on('data', (data) => {
                this._addLog(data, 'stderr');
            });

            this.nodeProcess.on('close', (code) => {
                this._addLog(`ZippyNode process exited with code ${code}`, 'system');
                this.nodeProcess = null;
                this.status = 'idle';
                this.stopPolling();
                this.emit('status-update', this.getStatus());
            });

            // Wait for health check to pass
            await this.waitForHealth();
            this.status = 'running';
            this.startPolling();
            this.emit('status-update', this.getStatus());
            return true;
        } catch (error) {
            this._addLog(`Failed to start ZippyNode: ${error.message}`, 'error');
            this.status = 'idle';
            this.nodeProcess = null;
            throw error;
        }
    }

    async stop() {
        if (!this.nodeProcess) return;

        this.status = 'stopping';
        this._addLog("Stopping ZippyNode...", 'system');
        this.stopPolling();

        try {
            await axios.post(`http://localhost:${this.config.rpcPort}`, {
                jsonrpc: "2.0",
                method: "zippycoin_closeChannels",
                params: [],
                id: 1
            }, { timeout: 2000 });
        } catch (e) {
            this._addLog("Could not gracefully close channels via RPC, proceeding with termination.", 'warn');
        }

        this.nodeProcess.kill('SIGTERM');

        return new Promise((resolve) => {
            const check = setInterval(() => {
                if (!this.nodeProcess) {
                    clearInterval(check);
                    resolve();
                }
            }, 500);

            setTimeout(() => {
                if (this.nodeProcess) {
                    this.nodeProcess.kill('SIGKILL');
                }
                clearInterval(check);
                resolve();
            }, 10000);
        });
    }

    async waitForHealth(retries = 10) {
        for (let i = 0; i < retries; i++) {
            try {
                const res = await axios.get(`http://localhost:${this.config.apiPort}/version`);
                if (res.status === 200) return true;
            } catch (e) {
                // Wait
            }
            await new Promise(r => setTimeout(r, 1000));
        }
        throw new Error("ZippyNode health check timed out");
    }

    startPolling() {
        if (this.pollInterval) return;
        this.pollInterval = setInterval(() => this.pollStats(), 10000);
        this.pollStats(); // Initial poll
    }

    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }

    async pollStats() {
        if (this.status !== 'running') return;

        const startTime = Date.now();
        const rpcUrl = `http://localhost:${this.config.rpcPort}`;

        try {
            // Standard eth calls
            const [blockHex, peerHex, trustData] = await Promise.all([
                this._rpcRequest(rpcUrl, 'eth_blockNumber'),
                this._rpcRequest(rpcUrl, 'net_peerCount'),
                this._rpcRequest(rpcUrl, 'zippycoin_getTrustScore').catch(() => ({ score: 95 }))
            ]);

            this.networkStats = {
                blockHeight: parseInt(blockHex, 16),
                peerCount: parseInt(peerHex, 16),
                trustScore: trustData.score || 95,
                latency: Date.now() - startTime,
                health: this._calculateHealth(parseInt(peerHex, 16), trustData.score || 95),
                lastPoll: new Date().toISOString()
            };

            this.emit('stats-update', this.networkStats);
        } catch (error) {
            this._addLog(`Polling failed: ${error.message}`, 'warn');
        }
    }

    async _rpcRequest(url, method, params = []) {
        const res = await axios.post(url, {
            jsonrpc: "2.0",
            id: Date.now(),
            method,
            params
        }, { timeout: 3000 });
        return res.data.result;
    }

    _calculateHealth(peers, trust) {
        let score = 0;
        if (peers > 0) score += 50;
        if (peers > 5) score += 20;
        score += (trust / 100) * 30;
        return Math.min(Math.round(score), 100);
    }

    // Peer Management
    async dialPeer(multiaddr) {
        return this._rpcRequest(`http://localhost:${this.config.rpcPort}`, 'zippycoin_dialPeer', [multiaddr]);
    }

    async blockPeer(peerId) {
        return this._rpcRequest(`http://localhost:${this.config.rpcPort}`, 'zippycoin_blockPeer', [peerId]);
    }

    getLogs() {
        return this.logs;
    }

    getStatus() {
        return {
            status: this.status,
            mode: this.config.mode,
            broadcast: this.config.broadcast,
            pid: this.nodeProcess ? this.nodeProcess.pid : null,
            stats: this.networkStats
        };
    }
}

module.exports = new ZippyNodeManager();
