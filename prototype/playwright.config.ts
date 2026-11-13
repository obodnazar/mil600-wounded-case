import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./e2e',workers:1,fullyParallel:false,timeout:30000,
  use:{baseURL:'http://127.0.0.1:4318',headless:true,viewport:{width:1440,height:1000},screenshot:'only-on-failure',
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}}:{})},
  webServer:{command:'node dist/server/e2e-main.js',url:'http://127.0.0.1:4318',reuseExistingServer:false,timeout:30000},
});
