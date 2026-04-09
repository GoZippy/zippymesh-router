import http from 'http';

/**
 * Basic smoke test for observability headers and error contracts
 */
async function testEndpoint(path, method = 'GET', body = null) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 20128,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const requestId = res.headers['x-request-id'];
        console.log(`[${method}] ${path} -> Status: ${res.statusCode}`);
        console.log(`  X-Request-ID: ${requestId || 'MISSING'}`);
        
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) {
            const hasStandardError = json.error && json.error.message && json.error.request_id;
            console.log(`  Error Contract: ${hasStandardError ? 'VALID' : 'INVALID'}`);
          }
          resolve({ status: res.statusCode, requestId, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, requestId, data: null });
        }
      });
    });

    req.on('error', (e) => {
      console.error(`Problem with request: ${e.message}`);
      resolve(null);
    });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  const v1Only = process.argv.includes('--v1-only');
  console.log('--- Phase 6 Observability Verification ---\n');
  
  if (v1Only) {
    await testEndpoint('/api/v1');
    return;
  }

  // 0. Test Health (General Availability)
  await testEndpoint('/api/health');

  // 1. Test Providers List (Success)
  await testEndpoint('/api/providers');
  
  // 2. Test Invalid Provider (Error Contract & ID)
  await testEndpoint('/api/providers', 'POST', { provider: 'invalid' });
  
  // 3. Test Usage Events (New Endpoint)
  const eventsRes = await testEndpoint('/api/usage/events');
  if (eventsRes && eventsRes.data && Array.isArray(eventsRes.data.events)) {
    console.log(`  Events found: ${eventsRes.data.events.length}`);
  }

  // 4. Test Chat Completions (Should have Request ID)
  // Note: This might return 401/404 if no models are configured, but should still have X-Request-ID
  await testEndpoint('/api/v1/chat/completions', 'POST', { model: 'gpt-4o', messages: [] });

  console.log('\n--- Verification Complete ---');
}

runTests();
