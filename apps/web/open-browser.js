const { chromium } = require('@playwright/test');

(async () => {
  console.log('正在启动浏览器...');
  const browser = await chromium.launch({
    headless: false, // 显示浏览器窗口
    slowMo: 100 // 减慢操作速度，便于观察
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });

  const page = await context.newPage();

  console.log('正在打开 localhost:6006...');
  await page.goto('http://localhost:6006', {
    waitUntil: 'networkidle' // 等待网络空闲
  });

  console.log('页面已打开，浏览器将保持打开状态');
  console.log('按 Ctrl+C 关闭浏览器');

  // 保持浏览器打开，直到手动关闭
  // 如果需要自动关闭，可以取消下面的注释
  // await page.waitForTimeout(30000); // 等待 30 秒
  // await browser.close();
})();
