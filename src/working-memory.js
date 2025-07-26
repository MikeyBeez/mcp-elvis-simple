// working-memory.js - Simple working memory implementation for testing

class WorkingMemory {
  constructor(maxSlots = 7) {
    this.maxSlots = maxSlots;
    this.slots = [];
  }

  // Calculate value score for eviction
  calculateValue(memory) {
    const now = Date.now();
    const age = now - new Date(memory.metadata.lastAccessed).getTime();
    const ageDecay = Math.exp(-age / (1000 * 60 * 60)); // 1hr half-life
    const accessBonus = Math.log(memory.metadata.accessCount + 1);
    const priorityWeight = memory.priority / 7;
    const categoryWeight = {
      'decision': 1.0,
      'insight': 0.9,
      'pattern': 0.8,
      'reference': 0.6,
      'task': 0.5,
      'result': 0.4
    }[memory.metaTags.category] || 0.5;
    
    return (ageDecay * 0.3) + (accessBonus * 0.2) + 
           (priorityWeight * 0.3) + (categoryWeight * 0.2);
  }

  // Add a new memory
  add(content, category, priority = 5, tags = []) {
    const memory = {
      id: `wm_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      priority: Math.min(Math.max(priority, 1), 7),
      content: content.substring(0, 200), // Limit content size
      metaTags: {
        layer: 'working_memory',
        persistence: 'session',
        visibility: 'on_demand',
        category: category,
        status: 'active',
        contextWeight: 0.2
      },
      systemTags: tags,
      metadata: {
        created: new Date().toISOString(),
        lastAccessed: new Date().toISOString(),
        accessCount: 0,
        source: 'manual'
      }
    };

    // Check if we need to evict
    if (this.slots.length >= this.maxSlots) {
      this.evictLowestValue();
    }

    this.slots.push(memory);
    return memory;
  }

  // Evict the lowest value memory
  evictLowestValue() {
    if (this.slots.length === 0) return null;

    // Calculate values for all memories
    const scored = this.slots.map(m => ({
      memory: m,
      score: this.calculateValue(m)
    })).sort((a, b) => a.score - b.score);

    const evicted = scored[0].memory;
    
    // Archive important memories before eviction
    if (evicted.metaTags.category === 'decision' || 
        evicted.metaTags.category === 'insight') {
      console.log(`📦 Archiving important memory: ${evicted.id}`);
    }

    // Remove from slots
    this.slots = this.slots.filter(m => m.id !== evicted.id);
    
    return evicted;
  }

  // Access a memory (updates metadata)
  access(memoryId) {
    const memory = this.slots.find(m => m.id === memoryId);
    if (memory) {
      memory.metadata.lastAccessed = new Date().toISOString();
      memory.metadata.accessCount++;
    }
    return memory;
  }

  // List all memories
  list(verbose = false) {
    if (verbose) {
      return this.slots.map(m => ({
        ...m,
        value: this.calculateValue(m).toFixed(3)
      }));
    }
    return this.slots;
  }

  // Get summary for display
  getSummary() {
    const summary = [`🧠 Working Memory (${this.slots.length}/${this.maxSlots} slots):`];
    
    this.slots.forEach((memory, index) => {
      const icon = {
        'decision': '🎯',
        'insight': '💡',
        'pattern': '🔄',
        'reference': '📎',
        'task': '✓',
        'result': '📊'
      }[memory.metaTags.category] || '📝';
      
      summary.push(`${index + 1}. ${icon} [${memory.metaTags.category.toUpperCase()}] ${memory.content.substring(0, 50)}... (accessed ${memory.metadata.accessCount}x)`);
    });
    
    return summary.join('\n');
  }
}

module.exports = WorkingMemory;
