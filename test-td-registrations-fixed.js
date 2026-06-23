import { chromium } from 'playwright';

const USERNAME = 'mathbymoves';
const PASSWORD = 'abcdef';
const BASE_URL = 'http://localhost:5010';
const ARTIFACT_DIR = 'C:/Users/howdy/.gemini/antigravity/brain/3aa34858-d1ee-4495-88f7-118421db852c';
const TOURNAMENT_SLUG = 'local-test-1782245883816';

async function run() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 1. Log in
    console.log('Navigating to login page...');
    await page.goto(`${BASE_URL}/login`);
    await page.waitForTimeout(2000);
    
    console.log('Entering login credentials...');
    await page.fill('input[name="username"], input[type="text"]', USERNAME);
    await page.fill('input[name="password"], input[type="password"]', PASSWORD);
    
    console.log('Submitting login form...');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(4000);

    // 2. Navigate to tournament registrations management tab
    const manageUrl = `${BASE_URL}/tournaments/${TOURNAMENT_SLUG}/manage/registrations`;
    console.log(`Navigating to manage registrations: ${manageUrl}`);
    await page.goto(manageUrl);
    
    // Wait for "Loading registrations..." to disappear
    console.log('Waiting for registrations to load...');
    await page.waitForSelector('text="Loading registrations..."', { state: 'detached', timeout: 15000 });
    await page.waitForTimeout(2000); // extra wait for rendering
    
    await page.screenshot({ path: `${ARTIFACT_DIR}/td_registrations_list_loaded.png` });
    console.log('Saved loaded registrations list screenshot.');

    // 3. Find and click Approve/Decline or verify Jane Doe is listed
    const janeDoeLocator = page.locator('text="Jane Doe"');
    const count = await janeDoeLocator.count();
    console.log(`Jane Doe found count: ${count}`);
    if (count > 0) {
      console.log('Jane Doe pending registration successfully verified on TD dashboard!');
      
      // Let's approve the registration!
      // In the registrations table, look for "Approve" button
      console.log('Attempting to approve Jane Doe...');
      const approveButton = page.locator('button:has-text("Approve")').first();
      if (await approveButton.count() > 0) {
        await approveButton.click();
        console.log('Clicked Approve button.');
        await page.waitForTimeout(4000);
        
        await page.screenshot({ path: `${ARTIFACT_DIR}/td_registrations_after_approve.png` });
        console.log('Saved registrations after approve screenshot.');
      } else {
        console.warn('Approve button not found.');
      }
    } else {
      console.error('Jane Doe not found on registrations list.');
    }

    await browser.close();
    console.log('Browser closed. Test finished.');
  } catch (err) {
    console.error('Exception during test:', err);
    await browser.close();
  }
}

run();
