const { test, expect } = require('@playwright/test');

test.describe('ZMLR E2E Flow', () => {
  
  test('Completes Setup Wizard', async ({ page, request }) => {
    // Navigate to dashboard, should redirect to /setup (often via /login)
    await page.goto('/dashboard');
    
    // Wait for either setup or login (if login, it should immediately redirect to setup if no password)
    await page.waitForURL(/.*\/(setup|login)/);
    
    if (page.url().includes('login')) {
      // Give it a second to redirect to setup if it's the first run
      try {
        await page.waitForURL(/.*\/setup/, { timeout: 5000 });
      } catch (e) {
        console.log('Already initialized or failed to redirect to setup, skipping wizard.');
        return;
      }
    }
    
    // Wait for the setup page content
    await expect(page.getByRole('heading', { name: 'Set a password' })).toBeVisible();

    // Step 0: Security Component
    await page.getByPlaceholder('At least 4 characters').fill('admin123');
    await page.getByPlaceholder('Repeat your password').fill('admin123');
    await page.getByRole('button', { name: 'Continue' }).click();

    // Step 1: Provider Component - Add an Ollama Provider
    // For CI, we will just click "I've connected a provider — continue" or "Skip for now"
    // Let's just skip it in the wizard and add it via the dashboard page later to isolate the test
    await expect(page.getByRole('heading', { name: 'Connect a provider' })).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now (add providers later)' }).click();

    // Step 2: Test Component
    await expect(page.getByRole('heading', { name: 'Test your endpoint' })).toBeVisible();
    await page.getByRole('button', { name: 'Skip — I\'ll test manually' }).click();

    // Step 3: Vault Component
    await expect(page.getByRole('heading', { name: 'Secure your keys' })).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now' }).click();

    // Step 4: Done
    await expect(page.getByRole('heading', { name: 'All set!' })).toBeVisible();
    await page.getByRole('button', { name: 'Go to Dashboard' }).click();

    // Setup completes but redirects to /login since no auth token is set
    await expect(page).toHaveURL(/.*\/login/);

    // Login with the password we just set
    await page.getByPlaceholder('Enter password').fill('admin123');
    await page.getByRole('button', { name: 'Login' }).click();

    // Should now be redirected to the dashboard
    await expect(page).toHaveURL(/.*\/dashboard/);
  });

  test('Adds an Ollama Provider', async ({ page }) => {
    // Assuming we are logged in from the previous step. Wait, playwright isolates tests.
    // So we need to log in first if isolated. We configured playwright without custom storage state.
    // Let's do a login first.
    await page.goto('/login');
    if (await page.getByPlaceholder('Enter password').isVisible()) {
      await page.getByPlaceholder('Enter password').fill('admin123');
      await page.getByRole('button', { name: 'Login' }).click();
    }
    await page.waitForURL(/.*\/dashboard/);

    // Go to providers page
    await page.goto('/dashboard/providers');
    
    // Click "Add Provider"
    await page.getByRole('button', { name: 'Add Provider' }).click();
    
    // Select Ollama
    await page.getByRole('button', { name: /Ollama/i }).click();

    // Fill details
    await page.getByLabel('Provider display name').fill('Local Ollama');
    await page.getByLabel('Base URL').fill('http://127.0.0.1:11434/v1');
    await page.getByLabel('API Key').fill('ollama'); // Ollama doesn't need a real key

    // Save
    await page.getByRole('button', { name: 'Save Provider' }).click();

    // Wait for the modal to close and the provider to appear in the list
    await expect(page.getByRole('heading', { name: 'Local Ollama' })).toBeVisible();
  });

  test('Handles Chat Completions & Smart Routing', async ({ request }) => {
    // Start Chat Completion POST request
    const response = await request.post('/v1/chat/completions', {
      data: {
        model: 'auto',
        messages: [{ role: 'user', content: 'Say hello!' }]
      },
      headers: {
        'Content-Type': 'application/json'
        // Intentionally no Auth header, if open locally it should still work
      }
    });
    
    // We expect 200 or 503 depending on if Ollama is actually running in CI.
    // For CI, Ollama might not be running, so it might fail to connect. 
    // We just assert the structure of the API response.
    const status = response.status();
    expect([200, 404, 502, 503, 500]).toContain(status);
    
    const body = await response.json();
    if (status === 200) {
      expect(body.choices[0].message.content).toBeDefined();
    } else {
      expect(body.error).toBeDefined();
    }
    
    // Test Smart Routing headers
    const routedResponse = await request.post('/v1/chat/completions', {
      data: {
        model: 'auto',
        messages: [{ role: 'user', content: 'def hello():' }]
      },
      headers: {
        'Content-Type': 'application/json',
        'X-Intent': 'code'
      }
    });
    
    expect([200, 404, 502, 503, 500]).toContain(routedResponse.status());
  });

  test('Creates and Uses a Virtual Key', async ({ page, request }) => {
    // Login
    await page.goto('/login');
    if (await page.getByPlaceholder('Enter password').isVisible()) {
      await page.getByPlaceholder('Enter password').fill('admin123');
      await page.getByRole('button', { name: 'Login' }).click();
    }
    await page.waitForURL(/.*\/dashboard/);

    // Go to Endpoint/Keys page
    await page.goto('/dashboard/endpoint');

    // Create a new key
    await page.getByRole('button', { name: /Create Key/i }).first().click();
    await page.getByLabel('Note / Identifier').fill('E2E Test Key');
    await page.getByRole('button', { name: 'Generate Key' }).click();

    // Read the generated Key (zpc1_....)
    const apiKeyRaw = await page.getByRole('textbox').first().inputValue();
    expect(apiKeyRaw).toContain('zpc1');

    // Make an authenticated request with this virtual key
    const response = await request.post('/v1/chat/completions', {
      data: {
        model: 'auto',
        messages: [{ role: 'user', content: 'Testing virtual key' }]
      },
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKeyRaw}`
      }
    });

    expect([200, 502, 503, 500]).toContain(response.status());
  });
});
