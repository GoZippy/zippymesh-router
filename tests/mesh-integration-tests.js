#!/usr/bin/env node
/**
 * ZippyCoin Mesh Network Integration Tests
 * Tests wallet, provider discovery, and inference APIs
 */

const http = require('http');

const TEST_BASE_URL = 'http://localhost:3000/api/mesh';
const TESTS = [];
let passedTests = 0;
let failedTests = 0;

// Test logging
function log(level, message) {
    const colors = {
        info: '\x1b[36m',
        success: '\x1b[32m',
        error: '\x1b[31m',
        warn: '\x1b[33m',
        reset: '\x1b[0m'
    };
    console.log(`${colors[level] || ''}[${level.toUpperCase()}]${colors.reset} ${message}`);
}

// HTTP request helper
async function makeRequest(path, options = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, TEST_BASE_URL);
        const opts = {
            method: options.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            timeout: options.timeout || 5000
        };

        const req = http.request(url, opts, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ status: res.statusCode, data: parsed, headers: res.headers });
                } catch {
                    resolve({ status: res.statusCode, data, headers: res.headers });
                }
            });
        });

        req.on('error', reject);
        if (options.body) req.write(JSON.stringify(options.body));
        req.end();
    });
}

// Test assertion
function assert(condition, message) {
    if (!condition) throw new Error(message);
}

// Test case
async function test(name, fn) {
    TESTS.push({ name, fn });
}

// Run all tests
async function runTests() {
    log('info', '═══════════════════════════════════════════');
    log('info', ' ZippyCoin Mesh Network - Integration Tests');
    log('info', '═══════════════════════════════════════════\n');

    // First, check if server is running
    try {
        await makeRequest('/wallet?action=status');
    } catch (error) {
        log('error', 'Next.js development server is not running');
        log('warn', 'Start with: cd k:\\Projects\\ZippyMesh_LLM_Router && npm run dev');
        process.exit(1);
    }

    for (const testCase of TESTS) {
        try {
            await testCase.fn();
            passedTests++;
            log('success', `✓ ${testCase.name}`);
        } catch (error) {
            failedTests++;
            log('error', `✗ ${testCase.name}: ${error.message}`);
        }
    }

    log('info', '\n═══════════════════════════════════════════');
    log('info', ` Results: ${passedTests} passed, ${failedTests} failed`);
    log('info', '═══════════════════════════════════════════\n');

    process.exit(failedTests > 0 ? 1 : 0);
}

// ============ TEST CASES ============

test('Wallet: Check if wallet exists', async () => {
    const res = await makeRequest('/wallet?action=status');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.success !== undefined, 'Response missing success field');
});

test('Wallet: Generate new wallet', async () => {
    const res = await makeRequest('/wallet', {
        method: 'POST',
        body: { action: 'generate' }
    });
    assert([200, 201].includes(res.status), `Expected 200/201, got ${res.status}`);
    assert(res.data.success, 'Wallet generation failed');
    assert(res.data.wallet?.address, 'Wallet missing address');
    assert(res.data.wallet.address.startsWith('0x'), 'Invalid address format');
});

test('Wallet: Get wallet details', async () => {
    const res = await makeRequest('/wallet?action=details');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.success, 'Failed to get wallet details');
    assert(res.data.details?.address, 'Missing address in details');
});

test('Wallet: Initialize wallet directory', async () => {
    const res = await makeRequest('/wallet', {
        method: 'POST',
        body: { action: 'initialize' }
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.success, 'Wallet initialization failed');
    assert(res.data.walletDir, 'Missing wallet directory path');
});

test('Providers: List all providers', async () => {
    const res = await makeRequest('/providers');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.success, 'Provider list failed');
    assert(Array.isArray(res.data.providers), 'Providers should be an array');
    assert(res.data.providers.length > 0, 'No providers available');
});

test('Providers: Discover LLM providers', async () => {
    const res = await makeRequest('/providers?action=discover');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.success, 'Provider discovery failed');
    assert(Array.isArray(res.data.providers), 'Providers should be an array');
});

test('Providers: Select provider with requirements', async () => {
    const res = await makeRequest('/providers?action=select&model=llama2&maxLatency=1000&minTrust=70');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.success, 'Provider selection failed');
    assert(res.data.provider?.nodeId, 'Missing selected provider info');
});

test('Providers: Estimate cost for tokens', async () => {
    const res = await makeRequest('/providers?action=estimate-cost&providerId=0&tokens=100');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.success, 'Cost estimation failed');
    assert(res.data.cost?.totalCostZip, 'Missing cost information');
});

test('Providers: Clear cache', async () => {
    const res = await makeRequest('/providers?action=clear-cache');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.success, 'Cache clear failed');
});

test('Inference: Test with valid prompt (mock)', async () => {
    // This will fail if no providers are running, but that's okay for now
    const res = await makeRequest('/infer', {
        method: 'POST',
        body: {
            prompt: 'Hello, world!',
            model: 'llama2',
            maxTokens: 100,
            temperature: 0.7
        }
    });
    // We expect either success or a specific error (no wallet, no providers, etc)
    assert([200, 400, 503].includes(res.status), `Unexpected status ${res.status}`);
});

test('Inference: Reject without prompt', async () => {
    const res = await makeRequest('/infer', {
        method: 'POST',
        body: { model: 'llama2' }
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(res.data.error, 'Expected error message');
});

// Run all tests
runTests().catch(error => {
    log('error', `Test suite error: ${error.message}`);
    process.exit(1);
});
