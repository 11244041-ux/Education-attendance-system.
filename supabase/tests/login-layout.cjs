// Responsive presentation checks; external services are intercepted, never called.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startStaticServer } = require('./static-server.cjs');

(async () => {
  const { server, baseURL } = await startStaticServer();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  let checks = 0;
  const screenshots = process.env.SCREENSHOT_DIR;
  if (screenshots) fs.mkdirSync(screenshots, { recursive: true });
  try {
    for (const [name, width, height] of [
      ['desktop', 1920, 1080], ['laptop', 1366, 768], ['ultrawide', 2560, 1080],
      ['tablet-landscape', 1024, 768], ['tablet-portrait', 768, 1024],
      ['mobile', 390, 844], ['small-mobile', 320, 568], ['mobile-landscape', 844, 390]
    ]) {
      const page = await browser.newPage({ viewport: { width, height } });
      const failures = [];
      page.on('pageerror', error => failures.push(error.message));
      page.on('response', response => { if (response.status() >= 400) failures.push(response.url()); });
      await page.route('https://stzxapveaocuzbidpfng.supabase.co/**', route => route.fulfill({ status: 200,
        contentType: 'application/json', body: JSON.stringify({ id: 'fictional-user' }) }));
      await page.goto(baseURL);
      await page.locator('.auth-backdrop img').evaluate(image => image.decode());
      const layout = await page.evaluate(() => {
        const image = document.querySelector('.auth-backdrop img'), card = document.querySelector('#login-section');
        const backdrop = image.getBoundingClientRect(), rect = card.getBoundingClientRect();
        const style = getComputedStyle(image);
        return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
          card: { x: rect.x, y: rect.y, width: rect.width, right: rect.right },
          background: { x: backdrop.x, y: backdrop.y, width: backdrop.width, height: backdrop.height },
          fit: style.objectFit, position: style.objectPosition, source: image.currentSrc,
          inputFont: getComputedStyle(document.querySelector('#email')).fontSize };
      });
      assert.equal(layout.scrollWidth, width, name + ': horizontal overflow'); checks++;
      assert.equal(layout.fit, 'cover'); checks++;
      assert.equal(layout.background.x, 0); assert.equal(layout.background.y, 0); checks++;
      assert.equal(layout.background.width, width); assert.ok(layout.background.height >= height); checks++;
      assert.ok(layout.card.x >= 16 && layout.card.right <= width - 16); checks++;
      assert.ok(layout.source.endsWith('.avif')); checks++;
      assert.equal(layout.inputFont, '16px'); checks++;
      if (width > 700 && !(width <= 950 && height <= 500)) { assert.ok(layout.card.x + layout.card.width / 2 > width * .6); checks++; }
      else { assert.ok(Math.abs(layout.card.x + layout.card.width / 2 - width / 2) < 1); checks++; }
      // Browser validation still blocks an empty sign-in form.
      assert.equal(await page.locator('#login-form').evaluate(form => form.checkValidity()), false); checks++;
      if (screenshots) await page.screenshot({ path: screenshots + '/' + name + '.png', fullPage: true });
      // Simulate reduced available height while a mobile keyboard is open.
      if (name === 'mobile') {
        await page.fill('#email', 'fictional@example.test');
        await page.setViewportSize({ width, height: 360 });
        await page.locator('#password').focus();
        await page.locator('#login-submit').scrollIntoViewIfNeeded();
        const button = await page.locator('#login-submit').boundingBox();
        assert.ok(button.y >= 0 && button.y + button.height <= 360); checks++;
        const backgroundAfterScroll = await page.locator('.auth-backdrop img').boundingBox();
        assert.equal(backgroundAfterScroll.y, 0);
        assert.ok(backgroundAfterScroll.height >= 360); checks++;
        assert.equal(await page.locator('#password').inputValue(), ''); checks++;
        await page.fill('#password', 'Fictional-password');
        assert.equal(await page.locator('#login-form').evaluate(form => form.checkValidity()), true); checks++;
        if (screenshots) await page.screenshot({ path: screenshots + '/mobile-keyboard.png', fullPage: true });
      }
      // Recovery uses the same readable card and scrolls on short viewports.
      await page.goto(baseURL + '/#access_token=mock-recovery&type=recovery');
      await page.getByText('Recovery link verified. Enter your new password.', { exact: true }).waitFor();
      await page.locator('#recovery-submit').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('#recovery-section').isVisible(), true); checks++;
      assert.equal(await page.locator('#login-section').isVisible(), false); checks++;
      if (screenshots && name === 'mobile') await page.screenshot({ path: screenshots + '/mobile-recovery.png', fullPage: true });
      assert.deepEqual(failures, []); checks++;
      await page.close();
    }
    // Image-format fallback: browsers without AVIF still receive the original art as WebP.
    const page = await browser.newPage();
    await page.goto(baseURL);
    await page.locator('.auth-backdrop source').evaluate(source => source.remove());
    await page.locator('.auth-backdrop img').evaluate(image => image.decode());
    assert.match(await page.locator('.auth-backdrop img').evaluate(image => image.currentSrc), /\.webp$/); checks++;
    await page.close();
    console.log(`${checks} responsive login checks passed across 8 viewports, reduced keyboard height, recovery, and WebP fallback.`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
