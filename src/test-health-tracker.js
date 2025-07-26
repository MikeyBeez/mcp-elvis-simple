
const ModelHealthTracker = require('./model-health.js');

console.log('Testing Model Health Tracker...');

const tracker = new ModelHealthTracker();

// Test success recording
tracker.recordSuccess('llama3.2');
console.assert(tracker.health['llama3.2'].successes === 1, 'Success count failed');

// Test failure recording
tracker.recordFailure('deepseek-r1');
tracker.recordFailure('deepseek-r1');
console.assert(tracker.health['deepseek-r1'].failures === 2, 'Failure count failed');

// Test circuit breaker
tracker.recordFailure('deepseek-r1');
console.assert(tracker.health['deepseek-r1'].status === 'disabled', 'Circuit breaker failed');

// Test health check
console.assert(tracker.isHealthy('llama3.2') === true, 'Healthy check failed');
console.assert(tracker.isHealthy('deepseek-r1') === false, 'Unhealthy check failed');

// Test best model selection
const best = tracker.getBestModel();
console.assert(best === 'llama3.2', 'Best model selection failed');

console.log('✅ All tests passed!');
