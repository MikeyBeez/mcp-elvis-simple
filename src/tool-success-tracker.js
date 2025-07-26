// tool-success-tracker.js - Track tool usage patterns and success indicators

class ToolSuccessTracker {
  constructor() {
    this.sequences = [];
    this.currentSequence = {
      id: `seq_${Date.now()}`,
      tools: [],
      startTime: Date.now(),
      userIntent: null
    };
    this.toolStats = {};
  }

  // Record a tool call
  recordToolCall(toolName, params, result) {
    const toolCall = {
      tool: toolName,
      params: params,
      timestamp: Date.now(),
      hasResults: this.evaluateHasResults(toolName, result),
      resultSize: this.getResultSize(result),
      resultUsed: false // Will be updated if result appears in response
    };
    
    this.currentSequence.tools.push(toolCall);
    
    // Update stats
    if (!this.toolStats[toolName]) {
      this.toolStats[toolName] = {
        calls: 0,
        sequences: 0,
        emptyResults: 0,
        resultsUsed: 0,
        avgSequencePosition: 0,
        commonPatterns: {}
      };
    }
    this.toolStats[toolName].calls++;
    if (!toolCall.hasResults) {
      this.toolStats[toolName].emptyResults++;
    }
  }

  // Evaluate if tool returned useful results
  evaluateHasResults(toolName, result) {
    if (!result) return false;
    
    // Tool-specific evaluation
    switch (toolName) {
      case 'filesystem:search_files':
        return result.matches && result.matches.length > 0;
      case 'brain:brain_recall':
        return result.memories && result.memories.length > 0;
      case 'elvis:elvis_result':
        return result.status === 'completed' && result.result;
      default:
        return !!result;
    }
  }

  // Get size metric for results
  getResultSize(result) {
    if (!result) return 0;
    if (typeof result === 'string') return result.length;
    if (Array.isArray(result)) return result.length;
    if (result.matches) return result.matches.length;
    if (result.memories) return result.memories.length;
    return 1;
  }

  // Mark that a result was used in the response
  markResultUsed(toolIndex) {
    if (this.currentSequence.tools[toolIndex]) {
      this.currentSequence.tools[toolIndex].resultUsed = true;
    }
  }

  // Complete a sequence and analyze it
  completeSequence(userSatisfied = null) {
    this.currentSequence.endTime = Date.now();
    this.currentSequence.duration = this.currentSequence.endTime - this.currentSequence.startTime;
    this.currentSequence.userSatisfied = userSatisfied;
    
    // Analyze patterns
    this.analyzeSequence(this.currentSequence);
    
    // Store sequence
    this.sequences.push(this.currentSequence);
    
    // Start new sequence
    this.currentSequence = {
      id: `seq_${Date.now()}`,
      tools: [],
      startTime: Date.now(),
      userIntent: null
    };
  }

  // Analyze a completed sequence for patterns
  analyzeSequence(sequence) {
    // Pattern: Multiple searches in a row (likely failing to find)
    let consecutiveSearches = 0;
    let searchFailureChain = false;
    
    for (let i = 0; i < sequence.tools.length; i++) {
      const tool = sequence.tools[i];
      
      if (tool.tool.includes('search')) {
        consecutiveSearches++;
        if (!tool.hasResults) searchFailureChain = true;
      } else {
        if (consecutiveSearches > 1 && searchFailureChain) {
          this.recordPattern('multiple_failed_searches', consecutiveSearches);
        }
        consecutiveSearches = 0;
        searchFailureChain = false;
      }
      
      // Pattern: Search followed by brain_recall (should have checked brain first)
      if (i > 0 && 
          sequence.tools[i-1].tool.includes('search') && 
          tool.tool === 'brain:brain_recall' && 
          tool.hasResults) {
        this.recordPattern('search_then_brain_success');
      }
      
      // Pattern: Tool result not used
      if (tool.hasResults && !tool.resultUsed) {
        this.recordPattern('unused_results', tool.tool);
      }
    }
  }

  // Record a pattern occurrence
  recordPattern(patternType, detail = null) {
    if (!this.patterns) this.patterns = {};
    if (!this.patterns[patternType]) {
      this.patterns[patternType] = { count: 0, details: [] };
    }
    this.patterns[patternType].count++;
    if (detail) {
      this.patterns[patternType].details.push(detail);
    }
  }

  // Calculate success metrics for each tool
  calculateSuccessMetrics() {
    const metrics = {};
    
    for (const [toolName, stats] of Object.entries(this.toolStats)) {
      const emptyRate = stats.emptyResults / stats.calls;
      const usageRate = stats.resultsUsed / (stats.calls - stats.emptyResults);
      
      // Composite success score (0-1)
      const successScore = (1 - emptyRate) * 0.5 + (usageRate || 0) * 0.5;
      
      metrics[toolName] = {
        calls: stats.calls,
        emptyRate: (emptyRate * 100).toFixed(1) + '%',
        usageRate: ((usageRate || 0) * 100).toFixed(1) + '%',
        successScore: successScore.toFixed(2),
        recommendation: this.getRecommendation(toolName, successScore)
      };
    }
    
    return metrics;
  }

  // Get recommendation based on success score
  getRecommendation(toolName, score) {
    if (score < 0.2) return 'Avoid - try alternatives first';
    if (score < 0.4) return 'Use sparingly - often fails';
    if (score < 0.6) return 'Moderate - works sometimes';
    if (score < 0.8) return 'Good - generally reliable';
    return 'Excellent - highly reliable';
  }

  // Get insights from patterns
  getInsights() {
    const insights = [];
    
    if (this.patterns?.multiple_failed_searches?.count > 3) {
      insights.push({
        type: 'inefficiency',
        message: 'Multiple failed searches detected. Consider checking brain_recall first or asking for clarification.',
        severity: 'high',
        occurrences: this.patterns.multiple_failed_searches.count
      });
    }
    
    if (this.patterns?.search_then_brain_success?.count > 2) {
      insights.push({
        type: 'order',
        message: 'Pattern detected: Searching files before checking brain. Brain often has the answer.',
        severity: 'medium',
        occurrences: this.patterns.search_then_brain_success.count
      });
    }
    
    if (this.patterns?.unused_results?.count > 5) {
      insights.push({
        type: 'waste',
        message: 'Many tool results are not being used. Consider if the tool call is necessary.',
        severity: 'medium',
        occurrences: this.patterns.unused_results.count
      });
    }
    
    return insights;
  }

  // Generate protocol update suggestions
  generateProtocolUpdates() {
    const updates = [];
    const metrics = this.calculateSuccessMetrics();
    
    // Check for tools with very low success
    for (const [tool, metric] of Object.entries(metrics)) {
      if (parseFloat(metric.successScore) < 0.3) {
        updates.push({
          tool: tool,
          currentScore: metric.successScore,
          suggestion: `Consider deprecating ${tool} or finding alternatives. Success rate: ${metric.successScore}`,
          newProtocol: `Before using ${tool}:\n1. Try brain_recall first\n2. Ask if user specifically wants this tool\n3. Explain likelihood of empty results`
        });
      }
    }
    
    // Check for specific patterns
    const insights = this.getInsights();
    insights.forEach(insight => {
      if (insight.type === 'order' && insight.severity === 'medium') {
        updates.push({
          pattern: 'tool_order',
          suggestion: 'Update tool usage order - check brain before searching files',
          newProtocol: 'Tool Order Protocol:\n1. brain_recall (fastest, 75% success)\n2. working memory check\n3. file search (only if needed)\n4. web search (only if external info needed)'
        });
      }
    });
    
    return updates;
  }

  // Get summary report
  getSummaryReport() {
    const metrics = this.calculateSuccessMetrics();
    const insights = this.getInsights();
    const updates = this.generateProtocolUpdates();
    
    return {
      totalSequences: this.sequences.length,
      metrics,
      insights,
      suggestedUpdates: updates,
      topPatterns: this.patterns ? 
        Object.entries(this.patterns)
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 5)
          .map(([pattern, data]) => ({ pattern, count: data.count })) : []
    };
  }
}

module.exports = ToolSuccessTracker;
