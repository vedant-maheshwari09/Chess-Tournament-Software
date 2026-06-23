import { chromium } from 'playwright';

const USERNAME = 'mathbymoves';
const PASSWORD = 'abcdef';
const BASE_URL = 'https://chesstournamentmanager.onrender.com';
const ARTIFACT_DIR = 'C:/Users/howdy/.gemini/antigravity/brain/3aa34858-d1ee-4495-88f7-118421db852c';

async function run() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // 1. Navigate to login page
    console.log('Navigating to login page...');
    await page.goto(`${BASE_URL}/login`);
    await page.waitForTimeout(3000);
    
    // 2. Login
    console.log('Entering login credentials...');
    await page.fill('input[name="username"], input[type="text"]', USERNAME);
    await page.fill('input[name="password"], input[type="password"]', PASSWORD);
    
    console.log('Submitting login form...');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(5000);
    console.log('Current URL after login:', page.url());
    
    // 3. Navigate to create tournament page
    console.log('Navigating to new tournament page...');
    await page.goto(`${BASE_URL}/tournaments/new`);
    await page.waitForTimeout(4000);
    
    await page.screenshot({ path: `${ARTIFACT_DIR}/live_new_tournament_page_1.png` });
    console.log('Saved page step 1 screenshot.');

    // 4. Fill basic information
    const uniqueName = `Verify Test ${Date.now()}`;
    console.log('Entering tournament name:', uniqueName);
    await page.fill('#tournament-name', uniqueName);
    
    console.log('Entering City & State...');
    await page.fill('#basic-city-state', 'San Diego, CA');
    
    console.log('Selecting Start Date...');
    await page.click('button:has-text("Select start date")');
    await page.waitForSelector('td button', { state: 'visible', timeout: 5000 });
    await page.click('td button');
    await page.waitForTimeout(500);

    console.log('Selecting End Date...');
    await page.click('button:has-text("Select end date")');
    await page.waitForSelector('td button', { state: 'visible', timeout: 5000 });
    await page.click('td button');
    await page.waitForTimeout(500);
    
    await page.screenshot({ path: `${ARTIFACT_DIR}/live_new_tournament_page_filled.png` });
    console.log('Saved page filled screenshot.');

    // 5. Click Create tournament button
    console.log('Clicking Create tournament button...');
    await page.click('button:has-text("Create tournament")');
    
    // Wait for the redirect and API request to complete
    console.log('Waiting for redirect...');
    await page.waitForTimeout(12000);
    
    const finalUrl = page.url();
    console.log('Final URL:', finalUrl);
    
    await page.screenshot({ path: `${ARTIFACT_DIR}/live_final_page.png` });
    console.log('Saved final page screenshot.');

    await browser.close();
    console.log('Browser closed. Test finished.');
  } catch (err) {
    console.error('Exception during test:', err);
    await browser.close();
  }
}

run();
