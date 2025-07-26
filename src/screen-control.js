const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const execAsync = promisify(exec);

class ScreenControl {
  constructor() {
    this.tempDir = path.join(os.tmpdir(), 'elvis-screenshots');
  }

  async init() {
    // Ensure temp directory exists
    await fs.mkdir(this.tempDir, { recursive: true });
  }

  async takeScreenshot(filename = null) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotPath = filename 
      ? path.join(this.tempDir, filename)
      : path.join(this.tempDir, `screenshot-${timestamp}.png`);

    try {
      // macOS screencapture command
      // -x: no sound
      // -C: capture cursor
      // -D 1: display 1 (main display)
      await execAsync(`screencapture -x -C -D 1 "${screenshotPath}"`);
      
      // Verify file was created
      const stats = await fs.stat(screenshotPath);
      
      return {
        success: true,
        path: screenshotPath,
        size: stats.size,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async takeRegionScreenshot(x, y, width, height, filename = null) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotPath = filename 
      ? path.join(this.tempDir, filename)
      : path.join(this.tempDir, `region-${timestamp}.png`);

    try {
      // macOS screencapture with region
      // -R x,y,width,height: capture specific region
      await execAsync(`screencapture -x -R${x},${y},${width},${height} "${screenshotPath}"`);
      
      const stats = await fs.stat(screenshotPath);
      
      return {
        success: true,
        path: screenshotPath,
        size: stats.size,
        region: { x, y, width, height },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async analyzeScreenshot(imagePath, prompt = "What do you see in this image?", model = 'llava') {
    try {
      // Read image as base64
      const imageBuffer = await fs.readFile(imagePath);
      const base64Image = imageBuffer.toString('base64');

      // Call Ollama with image
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          images: [base64Image],
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.statusText}`);
      }

      const data = await response.json();
      
      return {
        success: true,
        analysis: data.response,
        model,
        imagePath,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async captureAndAnalyze(prompt = "What do you see on the screen?", model = 'llava') {
    // Take screenshot
    const screenshot = await this.takeScreenshot();
    if (!screenshot.success) {
      return screenshot;
    }

    // Analyze it
    const analysis = await this.analyzeScreenshot(screenshot.path, prompt, model);
    
    // Clean up screenshot file
    try {
      await fs.unlink(screenshot.path);
    } catch (err) {
      // Ignore cleanup errors
    }

    return {
      ...analysis,
      screenshot: {
        size: screenshot.size,
        timestamp: screenshot.timestamp
      }
    };
  }

  async getScreenInfo() {
    try {
      // Get screen resolution using system_profiler
      const { stdout } = await execAsync('system_profiler SPDisplaysDataType -json');
      const data = JSON.parse(stdout);
      
      const displays = data.SPDisplaysDataType[0].spdisplays_ndrvs || [];
      const mainDisplay = displays[0] || {};
      
      return {
        success: true,
        resolution: mainDisplay._spdisplays_resolution || 'Unknown',
        displays: displays.length,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async cleanup() {
    try {
      // Clean up old screenshots
      const files = await fs.readdir(this.tempDir);
      for (const file of files) {
        if (file.startsWith('screenshot-') || file.startsWith('region-')) {
          await fs.unlink(path.join(this.tempDir, file));
        }
      }
      return { success: true, cleaned: files.length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = ScreenControl;
