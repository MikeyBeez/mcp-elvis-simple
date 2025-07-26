#!/usr/bin/env node
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const execAsync = promisify(exec);

// Import working memory
const WorkingMemory = require('./working-memory.js');

// Import screen control
const ScreenControl = require('./screen-control.js');

// Simple in-memory task tracking
const tasks = new Map();

// Initialize working memory (7 slots)
const workingMemory = new WorkingMemory(7);

// Initialize screen control
const screenControl = new ScreenControl();
screenControl.init().catch(console.error);

const server = new Server(
  {
    name: 'mcp-elvis-simple',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Helper to generate task ID
function generateTaskId() {
  return `task_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

// Helper to call Ollama
async function callOllama(prompt, model = 'llama3.2', images = []) {
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
    
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    
    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.response;
  } catch (error) {
    throw new Error(`Failed to call Ollama: ${error.message}`);
  }
}

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'elvis_delegate',
        description: 'Delegate a task to Ollama for asynchronous processing',
        inputSchema: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'The task or question to delegate',
            },
            model: {
              type: 'string',
              description: 'Ollama model to use (default: llama3.2)',
              enum: ['llama3.2', 'deepseek-r1', 'mixtral', 'gemma:2b', 'phi3:mini']
            },
            context: {
              type: 'string',
              description: 'Additional context for the task'
            }
          },
          required: ['task'],
        },
      },
      {
        name: 'elvis_status',
        description: 'Check the status of a delegated task',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description: 'The task ID to check',
            },
          },
          required: ['task_id'],
        },
      },
      {
        name: 'elvis_result',
        description: 'Get the result of a completed task',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description: 'The task ID to retrieve results for',
            },
          },
          required: ['task_id'],
        },
      },
      {
        name: 'elvis_list',
        description: 'List all tasks and their statuses',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'elvis_help',
        description: 'Get help on using ELVIS tools',
        inputSchema: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'Specific command to get help for (or "all" for overview)',
              enum: ['all', 'delegate', 'status', 'result', 'list', 'examples', 'memory']
            }
          },
        },
      },
      {
        name: 'elvis_memory',
        description: 'Manage working memory for ELVIS tasks',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              description: 'Memory action to perform',
              enum: ['list', 'add', 'access', 'clear', 'summary']
            },
            content: {
              type: 'string',
              description: 'Content to store (for add action)'
            },
            category: {
              type: 'string',
              description: 'Memory category',
              enum: ['decision', 'insight', 'pattern', 'reference', 'task', 'result']
            },
            priority: {
              type: 'number',
              description: 'Priority 1-7 (higher = more important)'
            },
            memory_id: {
              type: 'string',
              description: 'Memory ID (for access action)'
            }
          },
          required: ['action'],
        },
      },
      {
        name: 'elvis_screenshot',
        description: 'Take a screenshot of the entire screen',
        inputSchema: {
          type: 'object',
          properties: {
            filename: {
              type: 'string',
              description: 'Optional filename for the screenshot'
            }
          },
        },
      },
      {
        name: 'elvis_capture_region',
        description: 'Capture a specific region of the screen',
        inputSchema: {
          type: 'object',
          properties: {
            x: {
              type: 'number',
              description: 'X coordinate of the region'
            },
            y: {
              type: 'number',
              description: 'Y coordinate of the region'
            },
            width: {
              type: 'number',
              description: 'Width of the region'
            },
            height: {
              type: 'number',
              description: 'Height of the region'
            },
            filename: {
              type: 'string',
              description: 'Optional filename'
            }
          },
          required: ['x', 'y', 'width', 'height'],
        },
      },
      {
        name: 'elvis_analyze_screen',
        description: 'Take a screenshot and analyze it with a vision model',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'What to analyze or look for (default: "What do you see on the screen?")'
            },
            model: {
              type: 'string',
              description: 'Vision model to use (default: llava)',
              enum: ['llava']
            }
          },
        },
      },
      {
        name: 'elvis_screen_info',
        description: 'Get information about the display(s)',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'elvis_cleanup_screenshots',
        description: 'Clean up temporary screenshot files',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  switch (name) {
    case 'elvis_delegate': {
      const { task, model = 'llama3.2', context = '' } = args;
      const taskId = generateTaskId();
      
      // Create task record
      const taskRecord = {
        id: taskId,
        task,
        model,
        context,
        status: 'pending',
        created: new Date().toISOString(),
        result: null,
        error: null
      };
      
      tasks.set(taskId, taskRecord);
      
      // Process asynchronously
      (async () => {
        try {
          taskRecord.status = 'processing';
          taskRecord.started = new Date().toISOString();
          
          // Build prompt
          const prompt = context 
            ? `Context: ${context}\n\nTask: ${task}\n\nPlease provide a comprehensive response:`
            : `Task: ${task}\n\nPlease provide a comprehensive response:`;
          
          // Call Ollama
          const result = await callOllama(prompt, model);
          
          taskRecord.status = 'completed';
          taskRecord.completed = new Date().toISOString();
          taskRecord.result = result;
          
          // Calculate duration
          const duration = new Date(taskRecord.completed) - new Date(taskRecord.started);
          taskRecord.duration_ms = duration;
          
        } catch (error) {
          taskRecord.status = 'failed';
          taskRecord.error = error.message;
          taskRecord.completed = new Date().toISOString();
        }
      })();
      
      return {
        content: [
          {
            type: 'text',
            text: `Task delegated successfully!\n\nTask ID: ${taskId}\nModel: ${model}\nStatus: pending\n\nUse elvis_status with this task ID to check progress.`,
          },
        ],
      };
    }
    
    case 'elvis_status': {
      const { task_id } = args;
      const task = tasks.get(task_id);
      
      if (!task) {
        return {
          content: [
            {
              type: 'text',
              text: `Task not found: ${task_id}`,
            },
          ],
        };
      }
      
      let statusText = `Task ID: ${task_id}\nStatus: ${task.status}\nModel: ${task.model}\nCreated: ${task.created}`;
      
      if (task.started) {
        statusText += `\nStarted: ${task.started}`;
      }
      
      if (task.completed) {
        statusText += `\nCompleted: ${task.completed}`;
        if (task.duration_ms) {
          statusText += `\nDuration: ${(task.duration_ms / 1000).toFixed(1)} seconds`;
        }
      }
      
      if (task.error) {
        statusText += `\nError: ${task.error}`;
      }
      
      return {
        content: [
          {
            type: 'text',
            text: statusText,
          },
        ],
      };
    }
    
    case 'elvis_result': {
      const { task_id } = args;
      const task = tasks.get(task_id);
      
      if (!task) {
        return {
          content: [
            {
              type: 'text',
              text: `Task not found: ${task_id}`,
            },
          ],
        };
      }
      
      if (task.status !== 'completed') {
        return {
          content: [
            {
              type: 'text',
              text: `Task ${task_id} is not completed yet. Status: ${task.status}`,
            },
          ],
        };
      }
      
      // Auto-store in working memory
      const summary = `${task.task.substring(0, 100)} → ${task.result.substring(0, 50)}...`;
      const memory = workingMemory.add(
        summary,
        'result',
        3, // Low-medium priority for results
        [task.model, 'elvis', `duration:${(task.duration_ms / 1000).toFixed(1)}s`]
      );
      
      return {
        content: [
          {
            type: 'text',
            text: `Task: ${task.task}\n\nResult:\n${task.result}\n\n---\nCompleted in ${(task.duration_ms / 1000).toFixed(1)} seconds using ${task.model}\n\n💾 Stored in working memory (slot ${workingMemory.slots.length}/${workingMemory.maxSlots})`,
          },
        ],
      };
    }
    
    case 'elvis_list': {
      if (tasks.size === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No tasks have been delegated yet.',
            },
          ],
        };
      }
      
      let listText = 'ELVIS Task List:\n\n';
      
      for (const [id, task] of tasks) {
        listText += `ID: ${id}\n`;
        listText += `  Task: ${task.task.substring(0, 50)}${task.task.length > 50 ? '...' : ''}\n`;
        listText += `  Status: ${task.status}\n`;
        listText += `  Model: ${task.model}\n`;
        if (task.duration_ms) {
          listText += `  Duration: ${(task.duration_ms / 1000).toFixed(1)}s\n`;
        }
        listText += '\n';
      }
      
      return {
        content: [
          {
            type: 'text',
            text: listText,
          },
        ],
      };
    }
    
    case 'elvis_help': {
      const { command = 'all' } = args;
      
      const helpTexts = {
        all: `# ELVIS Help - Task Delegation & Screen Control

ELVIS (Employee-Like Virtual Intelligence System) delegates tasks to Ollama models and can analyze your screen using vision models.

${workingMemory.slots.length > 0 ? workingMemory.getSummary() + '\n\n' : ''}## Available Commands:

### Task Delegation:
1. **elvis_delegate** - Delegate a task to Ollama
2. **elvis_status** - Check task status
3. **elvis_result** - Get completed results
4. **elvis_list** - List all tasks

### Screen Control:
5. **elvis_screenshot** - Take a full screenshot
6. **elvis_capture_region** - Capture a specific area
7. **elvis_analyze_screen** - Screenshot + AI analysis
8. **elvis_screen_info** - Get display information
9. **elvis_cleanup_screenshots** - Clean temp files

### Memory & Help:
10. **elvis_memory** - Manage working memory (7 slots)
11. **elvis_help** - This help system

## Quick Start:

1. Delegate a task: elvis_delegate({ task: "Your question here" })
2. Note the returned task_id
3. Check status: elvis_status({ task_id: "task_xxx" })
4. Get result when complete: elvis_result({ task_id: "task_xxx" })

For detailed help on any command, use: elvis_help({ command: "delegate" })`,
        
        delegate: `# elvis_delegate - Delegate Tasks to Ollama

## Purpose:
Delegates a task or question to an Ollama model for asynchronous processing.

## Parameters:
- **task** (required): The task or question to delegate
- **model** (optional): Ollama model to use
  - Options: llama3.2 (default), deepseek-r1, mixtral, gemma:2b, phi3:mini
- **context** (optional): Additional context for the task

## Returns:
- Task ID for tracking
- Model being used
- Initial status (pending)

## Examples:

// Simple question
elvis_delegate({ task: "Why is the sky blue?" })

// With specific model
elvis_delegate({ 
  task: "Analyze this code for bugs",
  model: "deepseek-r1"
})

// With context
elvis_delegate({
  task: "Summarize the key points",
  context: "Focus on technical aspects only",
  model: "mixtral"
})`,
        
        status: `# elvis_status - Check Task Status

## Purpose:
Check the current status of a delegated task.

## Parameters:
- **task_id** (required): The task ID returned by elvis_delegate

## Returns:
- Task ID
- Current status: pending, processing, completed, or failed
- Model used
- Timestamps (created, started, completed)
- Duration (if completed)
- Error message (if failed)

## Example:
elvis_status({ task_id: "task_1234567_abc123" })

## Status Flow:
1. **pending** - Task queued, waiting to start
2. **processing** - Ollama is working on the task
3. **completed** - Task finished successfully
4. **failed** - Task encountered an error`,
        
        result: `# elvis_result - Get Task Results

## Purpose:
Retrieve the result of a completed task.

## Parameters:
- **task_id** (required): The task ID to get results for

## Returns:
- Original task description
- Complete result from Ollama
- Processing duration
- Model used

## Example:
elvis_result({ task_id: "task_1234567_abc123" })

## Notes:
- Only works for tasks with status "completed"
- For pending/processing tasks, use elvis_status instead
- Results are kept in memory until server restart`,
        
        list: `# elvis_list - List All Tasks

## Purpose:
Display a summary of all delegated tasks.

## Parameters:
None required

## Returns:
For each task:
- Task ID
- First 50 characters of the task
- Current status
- Model used
- Duration (if completed)

## Example:
elvis_list()

## Notes:
- Tasks are listed in order of creation
- Only shows tasks from current session
- Useful for finding lost task IDs`,
        
        examples: `# ELVIS Usage Examples

## Basic Question Answering:
elvis_delegate({ task: "Why is the sky blue?" })
// Returns: task_1234567_abc123

elvis_status({ task_id: "task_1234567_abc123" })
// Check if ready

elvis_result({ task_id: "task_1234567_abc123" })
// Get the answer

## Code Analysis with Deep Model:
elvis_delegate({
  task: "Review this function for potential bugs and optimizations",
  model: "deepseek-r1",
  context: "Focus on performance and error handling"
})

## Creative Writing:
elvis_delegate({
  task: "Write a short story about a robot learning to paint",
  model: "mixtral"
})

## Research Task:
elvis_delegate({
  task: "Explain the differences between TCP and UDP protocols",
  context: "Include use cases and performance characteristics"
})

## Batch Processing Example:
// Delegate multiple related tasks
const tasks = [
  "What is machine learning?",
  "What is deep learning?",
  "What is reinforcement learning?"
];

const taskIds = [];
for (const task of tasks) {
  const result = await elvis_delegate({ task });
  taskIds.push(result.task_id);
}

// Check all statuses
elvis_list()

## Model Selection Guide:
- **llama3.2**: Fast, general purpose (default)
- **deepseek-r1**: Best for reasoning and analysis
- **mixtral**: Good balance of speed and quality
- **gemma:2b**: Very fast, lightweight
- **phi3:mini**: Efficient for simple tasks`,
        
        memory: `# elvis_memory - Working Memory Management

## Purpose:
Manage a 7-slot working memory that persists across ELVIS operations.

## Parameters:
- **action** (required): Operation to perform
  - list: Show all memories
  - add: Store new memory
  - access: Retrieve and update access count
  - clear: Remove all memories
  - summary: Get formatted summary
- **content** (for add): Text to store
- **category** (for add): Type of memory
  - decision: Important choices (kept longest)
  - insight: Discoveries and learnings
  - pattern: Recurring themes
  - reference: File paths, IDs
  - task: Task-related info
  - result: Task results (lowest priority)
- **priority** (for add): 1-7, higher = more important
- **memory_id** (for access): ID to retrieve

## Examples:

// View current memories
elvis_memory({ action: "summary" })

// Store a decision
elvis_memory({
  action: "add",
  content: "Use deepseek-r1 for complex analysis tasks",
  category: "decision",
  priority: 7
})

// List detailed memory info
elvis_memory({ action: "list" })

## Memory Management:
- When all 7 slots are full, lowest value memory is evicted
- Value based on: age, access count, priority, category
- Important memories (decisions, insights) are archived before deletion`,
        
        screenshot: `# elvis_screenshot - Take Full Screenshot

## Purpose:
Capture the entire screen as a PNG image.

## Parameters:
- **filename** (optional): Custom filename for the screenshot

## Returns:
- File path where screenshot was saved
- File size
- Timestamp

## Example:
elvis_screenshot()
elvis_screenshot({ filename: "my-screen.png" })`,
        
        analyze_screen: `# elvis_analyze_screen - AI Screen Analysis

## Purpose:
Take a screenshot and analyze it using Ollama's vision model (llava).

## Parameters:
- **prompt** (optional): What to look for or analyze
  - Default: "What do you see on the screen?"
- **model** (optional): Vision model to use
  - Currently only supports: llava

## Returns:
- AI analysis of the screen content
- Screenshot metadata
- Results stored in working memory

## Examples:

// Basic analysis
elvis_analyze_screen()

// Specific question
elvis_analyze_screen({ 
  prompt: "What application is currently open?" 
})

// Code analysis
elvis_analyze_screen({ 
  prompt: "Analyze the code visible on screen for errors" 
})

## Use Cases:
- Debugging UI issues
- Reading error messages
- Analyzing code or text on screen
- Getting context about current work
- Documenting application state`,
        
        screen: `# Screen Control Commands

## elvis_screenshot
Take a full screenshot of your main display.

## elvis_capture_region
Capture a specific rectangular area:
- x, y: Top-left corner coordinates
- width, height: Size of the region

## elvis_analyze_screen
Combines screenshot + AI analysis in one step.
Perfect for:
- "What error is showing?"
- "What's in this terminal?"
- "Describe the current UI"

## elvis_screen_info
Get display resolution and count.

## elvis_cleanup_screenshots
Remove temporary screenshot files.

## Integration with Tasks:
Screen analysis results are automatically stored in working memory and can be used as context for delegated tasks:

1. Analyze screen: elvis_analyze_screen({ prompt: "What code is visible?" })
2. Delegate related task: elvis_delegate({ 
     task: "Fix the error in the code",
     context: "Based on the screen analysis"
   })`
      };
      
      return {
        content: [
          {
            type: 'text',
            text: helpTexts[command] || helpTexts.all,
          },
        ],
      };
    }
    
    case 'elvis_memory': {
      const { action, content, category, priority, memory_id } = args;
      
      switch (action) {
        case 'list':
          const memories = workingMemory.list(true);
          if (memories.length === 0) {
            return {
              content: [{
                type: 'text',
                text: 'No memories stored yet.'
              }]
            };
          }
          
          let listText = 'Working Memory Contents:\n\n';
          memories.forEach((m, i) => {
            listText += `${i + 1}. [${m.metaTags.category}] ${m.content}\n`;
            listText += `   ID: ${m.id}\n`;
            listText += `   Priority: ${m.priority}/7, Value: ${m.value}, Accessed: ${m.metadata.accessCount}x\n\n`;
          });
          
          return {
            content: [{
              type: 'text',
              text: listText
            }]
          };
          
        case 'add':
          if (!content || !category) {
            return {
              content: [{
                type: 'text',
                text: 'Error: content and category are required for add action'
              }]
            };
          }
          
          const evicted = workingMemory.slots.length >= workingMemory.maxSlots ? 
            workingMemory.slots.map(m => ({ m, v: workingMemory.calculateValue(m) }))
              .sort((a, b) => a.v - b.v)[0].m : null;
          
          const memory = workingMemory.add(content, category, priority || 5, ['manual']);
          
          let response = `✅ Added to working memory:\nID: ${memory.id}\nCategory: ${category}\nPriority: ${memory.priority}`;
          
          if (evicted) {
            response += `\n\n🗑️ Evicted: [${evicted.metaTags.category}] ${evicted.content.substring(0, 50)}...`;
          }
          
          return {
            content: [{
              type: 'text',
              text: response
            }]
          };
          
        case 'access':
          if (!memory_id) {
            return {
              content: [{
                type: 'text',
                text: 'Error: memory_id required for access action'
              }]
            };
          }
          
          const accessed = workingMemory.access(memory_id);
          if (!accessed) {
            return {
              content: [{
                type: 'text',
                text: `Memory not found: ${memory_id}`
              }]
            };
          }
          
          return {
            content: [{
              type: 'text',
              text: `Accessed memory:\n${accessed.content}\n\nAccess count: ${accessed.metadata.accessCount}`
            }]
          };
          
        case 'clear':
          const count = workingMemory.slots.length;
          workingMemory.slots = [];
          return {
            content: [{
              type: 'text',
              text: `Cleared ${count} memories from working memory.`
            }]
          };
          
        case 'summary':
        default:
          return {
            content: [{
              type: 'text',
              text: workingMemory.getSummary()
            }]
          };
      }
    }
    
    case 'elvis_screenshot': {
      const { filename } = args;
      const result = await screenControl.takeScreenshot(filename);
      
      if (!result.success) {
        return {
          content: [{
            type: 'text',
            text: `Failed to take screenshot: ${result.error}`
          }]
        };
      }
      
      return {
        content: [{
          type: 'text',
          text: `📸 Screenshot saved!
\nPath: ${result.path}\nSize: ${(result.size / 1024).toFixed(1)} KB\nTimestamp: ${result.timestamp}`
        }]
      };
    }
    
    case 'elvis_capture_region': {
      const { x, y, width, height, filename } = args;
      const result = await screenControl.takeRegionScreenshot(x, y, width, height, filename);
      
      if (!result.success) {
        return {
          content: [{
            type: 'text',
            text: `Failed to capture region: ${result.error}`
          }]
        };
      }
      
      return {
        content: [{
          type: 'text',
          text: `📸 Region captured!\n\nPath: ${result.path}\nRegion: ${width}x${height} at (${x},${y})\nSize: ${(result.size / 1024).toFixed(1)} KB`
        }]
      };
    }
    
    case 'elvis_analyze_screen': {
      const { prompt = "What do you see on the screen?", model = 'llava' } = args;
      
      // Store intent in working memory
      workingMemory.add(
        `Screen analysis: ${prompt}`,
        'task',
        6,
        ['screen', 'vision', model]
      );
      
      const result = await screenControl.captureAndAnalyze(prompt, model);
      
      if (!result.success) {
        return {
          content: [{
            type: 'text',
            text: `Failed to analyze screen: ${result.error}`
          }]
        };
      }
      
      // Store result in working memory
      const summary = result.analysis.substring(0, 200) + '...';
      workingMemory.add(
        `Screen analysis result: ${summary}`,
        'result',
        4,
        ['screen', 'vision', model, 'analysis']
      );
      
      return {
        content: [{
          type: 'text',
          text: `🔍 Screen Analysis\n\nPrompt: ${prompt}\nModel: ${model}\n\nAnalysis:\n${result.analysis}\n\n---\nScreenshot size: ${(result.screenshot.size / 1024).toFixed(1)} KB\n\n💾 Analysis stored in working memory`
        }]
      };
    }
    
    case 'elvis_screen_info': {
      const result = await screenControl.getScreenInfo();
      
      if (!result.success) {
        return {
          content: [{
            type: 'text',
            text: `Failed to get screen info: ${result.error}`
          }]
        };
      }
      
      return {
        content: [{
          type: 'text',
          text: `🖥️ Display Information\n\nResolution: ${result.resolution}\nNumber of displays: ${result.displays}`
        }]
      };
    }
    
    case 'elvis_cleanup_screenshots': {
      const result = await screenControl.cleanup();
      
      if (!result.success) {
        return {
          content: [{
            type: 'text',
            text: `Failed to cleanup: ${result.error}`
          }]
        };
      }
      
      return {
        content: [{
          type: 'text',
          text: `🧹 Cleanup complete!\n\nRemoved ${result.cleaned} screenshot files.`
        }]
      };
    }
    
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Start the server
const transport = new StdioServerTransport();
server.connect(transport);
console.error('mcp-elvis-simple MCP server running on stdio');
