
// ELVIS Health Monitor Integration
// Add this to ELVIS to track model reliability

class ModelHealthTracker {
  constructor() {
    this.health = {
      'llama3.2': { failures: 0, successes: 0, status: 'active' },
      'deepseek-r1': { failures: 0, successes: 0, status: 'active' },
      'mixtral': { failures: 0, successes: 0, status: 'disabled' }, // Known to be unavailable
      'gemma:2b': { failures: 0, successes: 0, status: 'limited' },
      'phi3:mini': { failures: 0, successes: 0, status: 'active' }
    };
    this.circuitBreaker = { threshold: 3, window: 86400000 }; // 24 hours
  }
  
  recordSuccess(model) {
    if (this.health[model]) {
      this.health[model].successes++;
      this.health[model].failures = 0;
      this.health[model].status = 'active';
      this.health[model].lastCheck = new Date();
    }
  }
  
  recordFailure(model) {
    if (this.health[model]) {
      this.health[model].failures++;
      this.health[model].lastCheck = new Date();
      
      if (this.health[model].failures >= this.circuitBreaker.threshold) {
        this.health[model].status = 'disabled';
        console.error(`Model ${model} disabled after ${this.health[model].failures} failures`);
      }
    }
  }
  
  isHealthy(model) {
    return !this.health[model] || this.health[model].status === 'active';
  }
  
  getBestModel() {
    const active = Object.entries(this.health)
      .filter(([_, h]) => h.status === 'active')
      .sort(([_, a], [__, b]) => {
        const aRate = a.successes / (a.successes + a.failures || 1);
        const bRate = b.successes / (b.successes + b.failures || 1);
        return bRate - aRate;
      });
    
    return active.length > 0 ? active[0][0] : 'llama3.2';
  }
  
  getStatus() {
    return Object.entries(this.health).map(([model, h]) => ({
      model,
      ...h,
      successRate: h.successes / (h.successes + h.failures || 1)
    }));
  }
}

// Export for use in ELVIS
module.exports = ModelHealthTracker;
