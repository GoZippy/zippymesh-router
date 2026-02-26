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
            lastPoll: null,
            monitorData: {
                network: null,
                peers: null,
                metrics: null
            }
        };
        this.pollInterval = null;
        const isWin = process.platform === 'win32';
        const binaryName = isWin ? 'zippycoin-node.exe' : 'zippycoin-node';

        this.config = {
            binaryPath: process.env.ZIPPY_NODE_BIN || path.join(process.cwd(), 'bin', binaryName),
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

        const isValidator = mode === 'validator';
        const args = [
            `--rpc-port=${this.config.rpcPort}`,
            `--p2p-port=${this.config.apiPort + 20000}`, // Distinct P2P port
            `--data-dir=${path.join(process.cwd(), 'data', 'chain')}`,
            `--peers=10.0.97.100:30303`
        ];

        if (!isValidator) {
            args.push('--full-node');
        }

        this._addLog(`Starting ZippyNode (isValidator: ${isValidator}, peers: 10.0.97.100)...`, 'system');
        this._addLog(`Binary path: ${this.config.binaryPath}`, 'system');

        if (!fs.existsSync(this.config.binaryPath)) {
            const errorMsg = `ZippyNode binary not found at ${this.config.binaryPath}. Please ensure the sidecar is built.`;
            this._addLog(errorMsg, 'error');
            this.status = 'idle';
            throw new Error(errorMsg);
        }

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
                this._rpcRequest(rpcUrl, 'eth_blockNumber').catch(() => "0x0"),
                this._rpcRequest(rpcUrl, 'net_peerCount').catch(() => "0x0"),
                this._rpcRequest(rpcUrl, 'zippycoin_getTrustScore').catch(() => ({ score: 95 }))
            ]);

            // Try fetching monitor data
            let monitorData = { network: null, peers: null, metrics: null };
            try {
                const monitorUrl = `http://localhost:39474`;
                const [networkRes, peersRes, metricsRes] = await Promise.all([
                    axios.get(`${monitorUrl}/zippy/network`, { timeout: 2000 }).catch(() => null),
                    axios.get(`${monitorUrl}/zippy/peers`, { timeout: 2000 }).catch(() => null),
                    axios.get(`${monitorUrl}/zippy/metrics`, { timeout: 2000 }).catch(() => null)
                ]);
                monitorData = {
                    network: networkRes?.data?.network || null,
                    peers: peersRes?.data?.peers || null,
                    metrics: metricsRes?.data?.metrics || null
                };
            } catch (e) {
                // Monitor might not be available
            }

            this.networkStats = {
                blockHeight: blockHex ? parseInt(blockHex, 16) : 0,
                peerCount: peerHex ? parseInt(peerHex, 16) : 0,
                trustScore: trustData?.score || 95,
                latency: Date.now() - startTime,
                health: this._calculateHealth(peerHex ? parseInt(peerHex, 16) : 0, trustData?.score || 95),
                lastPoll: new Date().toISOString(),
                monitorData
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
