const { chromium } = require('@playwright/test');
const path = require('path');

(async () => {
  console.log('正在启动浏览器...');
  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });

  const page = await context.newPage();

  console.log('正在打开 localhost:6006...');
  await page.goto('http://localhost:6006', {
    waitUntil: 'networkidle',
    timeout: 30000
  });

  // 等待页面完全加载
  await page.waitForTimeout(2000);

  const screenshotPath = path.join(__dirname, 'screenshot.png');
  await page.screenshot({
    path: screenshotPath,
    fullPage: true
  });

  console.log(`截图已保存到: ${screenshotPath}`);

  await browser.close();
})();
