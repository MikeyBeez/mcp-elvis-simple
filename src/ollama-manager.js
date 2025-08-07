// ollama-manager.js - Auto-start and health check for Ollama

const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class OllamaManager {
  constructor() {
    this.host = 'localhost';
    this.port = 11434;
    this.baseUrl = `http://${this.host}:${this.port}`;
    this.plistPath = '/Users/bard/Library/LaunchAgents/com.ollama.server.plist';
    this.maxStartupTime = 30000; // 30 seconds
  }

  // Check if Ollama is running and responding
  async isRunning() {
    try {
      const response = await fetch(`${this.baseUrl}/api/version`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });
      
      if (response.ok) {
        const data = await response.json();
        return { running: true, version: data.version };
      }
      return { running: false, error: `HTTP ${response.status}` };
    } catch (error) {
      return { running: false, error: error.message };
    }
  }

  // Check if launchd service is loaded
  async isServiceLoaded() {
    try {
      const { stdout } = await execAsync('launchctl list | grep ollama');
      return stdout.includes('com.ollama.server');
    } catch (error) {
      // grep returns exit code 1 if no matches found
      return false;
    }
  }

  // Load the launchd service
  async loadService() {
    try {
      await execAsync(`launchctl load "${this.plistPath}"`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Start Ollama if not running
  async ensureRunning() {
    const status = await this.isRunning();
    
    if (status.running) {
      return { 
        success: true, 
        action: 'already_running',
        version: status.version,
        message: `Ollama is running (v${status.version})`
      };
    }

    console.error(`Ollama not responding: ${status.error}`);
    console.error('Attempting to start Ollama service...');

    // Check if service is loaded
    const isLoaded = await this.isServiceLoaded();
    
    if (!isLoaded) {
      console.error('Loading Ollama launchd service...');
      const loadResult = await this.loadService();
      
      if (!loadResult.success) {
        return {
          success: false,
          error: `Failed to load service: ${loadResult.error}`,
          action: 'load_failed'
        };
      }
    }

    // Wait for Ollama to start
    console.error('Waiting for Ollama to start...');
    const startTime = Date.now();
    
    while (Date.now() - startTime < this.maxStartupTime) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const checkStatus = await this.isRunning();
      if (checkStatus.running) {
        const startupTime = ((Date.now() - startTime) / 1000).toFixed(1);
        return {
          success: true,
          action: 'started',
          version: checkStatus.version,
          startupTime,
          message: `Ollama started successfully in ${startupTime}s (v${checkStatus.version})`
        };
      }
    }

    return {
      success: false,
      error: 'Ollama failed to start within timeout period',
      action: 'timeout'
    };
  }

  // Enhanced call to Ollama with auto-start
  async callOllama(prompt, model = 'llama3.2', images = []) {
    // Ensure Ollama is running
    const startupResult = await this.ensureRunning();
    if (!startupResult.success) {
      throw new Error(`Cannot start Ollama: ${startupResult.error}`);
    }

    // Log if we had to start it
    if (startupResult.action === 'started') {
      console.error(`Auto-started Ollama: ${startupResult.message}`);
    }

    try {
      const body = {
        model,
        prompt,
        stream: false
      };
      
      // Add images if provided (for vision models)
      if (images && images.length > 0) {
        body.images = images;
      }
      
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      if (!response.ok) {
        throw new Error(`Ollama error: ${response.statusText}`);
      }
      
      const data = await response.json();
      return {
        response: data.response,
        startup: startupResult.action !== 'already_running' ? startupResult : null
      };
    } catch (error) {
      throw new Error(`Failed to call Ollama: ${error.message}`);
    }
  }

  // Get health status for diagnostics
  async getHealthStatus() {
    const running = await this.isRunning();
    const serviceLoaded = await this.isServiceLoaded();
    
    return {
      timestamp: new Date().toISOString(),
      running: running.running,
      version: running.version || null,
      error: running.error || null,
      serviceLoaded,
      baseUrl: this.baseUrl,
      plistPath: this.plistPath
    };
  }
}

module.exports = OllamaManager;
