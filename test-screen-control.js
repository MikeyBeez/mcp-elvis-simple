#!/usr/bin/env node

const ScreenControl = require('./src/screen-control.js');

async function testScreenControl() {
  console.log('🧪 Testing ELVIS Screen Control...\n');
  
  const screen = new ScreenControl();
  await screen.init();
  
  // Test 1: Get screen info
  console.log('1. Testing screen info...');
  const info = await screen.getScreenInfo();
  console.log(info);
  console.log();
  
  // Test 2: Take a screenshot
  console.log('2. Taking screenshot...');
  const screenshot = await screen.takeScreenshot('test-full.png');
  console.log(screenshot);
  console.log();
  
  // Test 3: Analyze screen with AI
  console.log('3. Analyzing screen with AI (this may take a moment)...');
  const analysis = await screen.captureAndAnalyze(
    "What applications or windows are visible on the screen?",
    'llava'
  );
  console.log('Analysis result:');
  console.log(analysis.analysis);
  console.log();
  
  // Test 4: Cleanup
  console.log('4. Cleaning up screenshots...');
  const cleanup = await screen.cleanup();
  console.log(cleanup);
}

// Run tests
testScreenControl().catch(console.error);
