import { chromium } from 'playwright';

const USERNAME = 'mathbymoves';
const PASSWORD = 'abcdef';
const BASE_URL = 'https://chesstournamentmanager.onrender.com';

async function run() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log('Navigating to login...');
    await page.goto(`${BASE_URL}/login`);
    await page.waitForTimeout(3000);

    console.log('Entering credentials...');
    await page.fill('input[name="username"], input[type="text"]', USERNAME);
    await page.fill('input[name="password"], input[type="password"]', PASSWORD);
    
    console.log('Clicking Sign In...');
    await page.click('button[type="submit"]');
    
    await page.waitForTimeout(5000);
    
    console.log('Final URL:', page.url());
    
    // Check if there are any toast elements on the screen
    const toasts = await page.locator('[role="status"], [class*="toast"]').allTextContents();
    console.log('Toast messages found on screen:', toasts);
    
    const bodyText = await page.innerText('body');
    console.log('Page body text extract:');
    console.log(bodyText.substring(0, 1500));

    await browser.close();
  } catch (err) {
    console.error('Test error:', err);
    await browser.close();
  }
}

run();
