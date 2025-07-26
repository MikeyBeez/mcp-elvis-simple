#!/usr/bin/env node
// test-working-memory.js - Test the working memory implementation

const WorkingMemory = require('./src/working-memory.js');

console.log('🧪 Testing Working Memory System\n');

// Create working memory instance
const wm = new WorkingMemory(7);

console.log('1. Starting with empty memory:');
console.log(wm.getSummary());
console.log('\n---\n');

// Add some memories
console.log('2. Adding memories:');

wm.add('Use llama3.2 for quick responses', 'decision', 7, ['model-selection']);
console.log('Added decision (priority 7)');

wm.add('Sky is blue due to Rayleigh scattering', 'insight', 6, ['physics']);
console.log('Added insight (priority 6)');

wm.add('ELVIS tasks average 30-40 seconds', 'pattern', 5, ['performance']);
console.log('Added pattern (priority 5)');

wm.add('task_1753413017366_5cwza', 'reference', 3, ['task-id']);
console.log('Added reference (priority 3)');

console.log('\n' + wm.getSummary());
console.log('\n---\n');

// Access a memory (increases access count)
console.log('3. Accessing first memory:');
const firstId = wm.slots[0].id;
wm.access(firstId);
wm.access(firstId);
console.log('Accessed decision memory 2 times');
console.log('\n---\n');

// Fill up the slots
console.log('4. Filling all 7 slots:');
wm.add('Result from task 2', 'result', 2, ['test']);
wm.add('Another pattern observed', 'pattern', 4, ['test']);
wm.add('Task 3 completed', 'task', 3, ['test']);

console.log('\n' + wm.getSummary());
console.log('\n---\n');

// Add 8th memory to trigger eviction
console.log('5. Adding 8th memory (triggers eviction):');
console.log('Current lowest value memories:');
const scored = wm.slots.map(m => ({
  id: m.id,
  category: m.metaTags.category,
  value: wm.calculateValue(m).toFixed(3),
  content: m.content.substring(0, 30) + '...'
})).sort((a, b) => parseFloat(a.value) - parseFloat(b.value));

console.table(scored.slice(0, 3));

wm.add('New important decision: Use deepseek for analysis', 'decision', 6, ['model-selection']);
console.log('\nAdded new decision memory');

console.log('\n' + wm.getSummary());
console.log('\n---\n');

// Show detailed list
console.log('6. Detailed memory list:');
const detailed = wm.list(true);
detailed.forEach((m, i) => {
  console.log(`\nSlot ${i + 1}:`);
  console.log(`  Category: ${m.metaTags.category}`);
  console.log(`  Priority: ${m.priority}`);
  console.log(`  Value Score: ${m.value}`);
  console.log(`  Access Count: ${m.metadata.accessCount}`);
  console.log(`  Content: ${m.content.substring(0, 50)}...`);
});

console.log('\n✅ Working Memory Test Complete!');
