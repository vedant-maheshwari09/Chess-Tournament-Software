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
    // 1. Log in first so we have the session
    console.log('Navigating to login page...');
    await page.goto(`${BASE_URL}/login`);
    await page.waitForTimeout(2000);
    
    console.log('Entering login credentials...');
    await page.fill('input[name="username"], input[type="text"]', USERNAME);
    await page.fill('input[name="password"], input[type="password"]', PASSWORD);
    
    console.log('Submitting login form...');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(4000);
    console.log('Logged in successfully. Current URL:', page.url());

    // 2. Navigate to tournament registration page
    const regUrl = `${BASE_URL}/tournaments/${TOURNAMENT_SLUG}/register`;
    console.log(`Navigating to registration page: ${regUrl}`);
    await page.goto(regUrl);
    await page.waitForTimeout(4000);
    
    await page.screenshot({ path: `${ARTIFACT_DIR}/reg_step1_before.png` });
    console.log('Saved Step 1 screenshot.');

    // 3. Select Manual entry mode
    console.log('Selecting "Manual entry" option...');
    await page.click('text="Manual entry"');
    await page.waitForTimeout(1000);

    // 4. Fill in identity details
    console.log('Filling identity details...');
    await page.fill('input[name="firstName"]', 'Jane');
    await page.fill('input[name="lastName"]', 'Doe');
    await page.fill('input[name="email"]', 'janedoe@example.com');
    await page.fill('input[name="uscfRating"]', '1600');
    
    // Select Preferred section if visible / available
    console.log('Checking Preferred section...');
    const sectionTrigger = page.locator('button:has-text("Choose a section"), button:has-text("Premier"), button:has-text("Championship"), button:has-text("Under")');
    if (await sectionTrigger.count() > 0) {
      console.log('Clicking preferred section dropdown...');
      await sectionTrigger.click();
      await page.waitForTimeout(500);
      // Click the first select item
      await page.click('role=option >> nth=0');
      await page.waitForTimeout(500);
    }
    
    await page.screenshot({ path: `${ARTIFACT_DIR}/reg_step1_filled.png` });
    console.log('Saved Step 1 filled screenshot.');

    // 5. Click Continue to go to Step 2
    console.log('Clicking Continue to Step 2...');
    await page.click('button:has-text("Continue")');
    await page.waitForTimeout(2000);
    
    await page.screenshot({ path: `${ARTIFACT_DIR}/reg_step2_before.png` });
    console.log('Saved Step 2 screenshot.');

    // 6. Click Continue to go to Step 3
    console.log('Clicking Continue to Step 3 (Summary)...');
    await page.click('button:has-text("Continue")');
    await page.waitForTimeout(2000);
    
    await page.screenshot({ path: `${ARTIFACT_DIR}/reg_step3_before.png` });
    console.log('Saved Step 3 screenshot.');

    // 7. Check the payment acknowledgement box
    console.log('Checking the payment acknowledgement box...');
    const ackCheckbox = page.locator('button[role="checkbox"], input[type="checkbox"]');
    if (await ackCheckbox.count() > 0) {
      await ackCheckbox.click();
      await page.waitForTimeout(500);
    }

    await page.screenshot({ path: `${ARTIFACT_DIR}/reg_step3_checked.png` });
    console.log('Saved Step 3 checked screenshot.');

    // 8. Click Submit registration
    console.log('Clicking Submit registration...');
    await page.click('button:has-text("Submit Registration"), button:has-text("Pay & Submit")');
    
    // Wait for submission response
    await page.waitForTimeout(6000);
    
    await page.screenshot({ path: `${ARTIFACT_DIR}/reg_after_submit.png` });
    console.log('Saved post-submission screenshot.');
    console.log('Final URL after submission:', page.url());

    await browser.close();
    console.log('Browser closed. Test finished.');
  } catch (err) {
    console.error('Exception during test:', err);
    await browser.close();
  }
}

run();
