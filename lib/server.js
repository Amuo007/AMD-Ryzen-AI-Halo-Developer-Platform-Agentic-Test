import { createServer as httpCreateServer } from 'node:http';
import { stat, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const PUBLIC_DIR = resolve('./public');
const execPromise = promisify(exec);

// In-memory session store for SSE connections and workspace
const sessions = new Map(); // key: sessionId -> { res, lastPing, workspace, messages }

// Environment configuration with fallbacks
function getEnvOrDefault(envVar, defaultVal) {
  const val = process.env[envVar];
  return val !== undefined ? val : defaultVal;
}
const DEFAULT_BASE_URL = getEnvOrDefault('FORGE_BASE_URL', 'http://192.168.1.252:13305/v1');
const DEFAULT_API_KEY = getEnvOrDefault('FORGE_API_KEY', 'local');
const DEFAULT_MODEL = getEnvOrDefault('FORGE_MODEL', '<MODEL_ID>');

// Helper to ensure path is within workspace
function ensureInWorkspace(requestedPath, workspace) {
  let absolutePath;
  if (isAbsolute(requestedPath)) {
    absolutePath = resolve(requestedPath);
  } else {
    absolutePath = resolve(workspace, requestedPath);
  }
  const workspaceAbsolute = resolve(workspace);
  if (!absolutePath.startsWith(workspaceAbsolute)) {
    throw new Error(`Access denied: ${requestedPath} is outside workspace`);
  }
  return absolutePath;
}

// Tool implementations
async function readFileTool({ path, lineStart, lineEnd }, workspace) {
  try {
    const absolutePath = ensureInWorkspace(path, workspace);
    const data = await readFile(absolutePath, 'utf8');
    const lines = data.split('\n');
    let start = 0;
    let end = lines.length;
    if (typeof lineStart === 'number') {
      start = Math.max(0, lineStart - 1);
    }
    if (typeof lineEnd === 'number') {
      end = Math.min(lines.length, lineEnd);
    }
    const selected = lines.slice(start, end);
    const numbered = selected.map((line, idx) => {
      const lineNum = start + idx + 1;
      return `${lineNum}:${line}`;
    }).join('\n');
    return { text: numbered };
  } catch (err) {
    return { error: `Failed to read file: ${err.message}` };
  }
}

async function writeFileTool({ path, content }, workspace) {
  try {
    const absolutePath = ensureInWorkspace(path, workspace);
    await writeFile(absolutePath, content, 'utf8');
    return { success: true };
  } catch (err) {
    return { error: `Failed to write file: ${err.message}` };
  }
}

async function editFileTool({ path, oldString, newString }, workspace) {
  try {
    const absolutePath = ensureInWorkspace(path, workspace);
    let data = await readFile(absolutePath, 'utf8');
    const escaped = oldString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'g');
    const matches = data.match(regex);
    if (!matches) {
      return { error: `String not found in file` };
    }
    if (matches.length > 1) {
      return { error: `Multiple matches found (${matches.length}). Please provide more context.` };
    }
    const newData = data.replace(oldString, newString);
    await writeFile(absolutePath, newData, 'utf8');
    return { success: true };
  } catch (err) {
    return { error: `Failed to edit file: ${err.message}` };
  }
}

async function listDirTool({ path }, workspace) {
  try {
    const absolutePath = ensureInWorkspace(path || '.', workspace);
    const entries = await readdir(absolutePath, { withFileTypes: true });
    const files = [];
    const dirs = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        dirs.push(entry.name);
      } else {
        files.push(entry.name);
      }
    }
    return { files, dirs };
  } catch (err) {
    return { error: `Failed to list directory: ${err.message}` };
  }
}

// Simple search that skips node_modules and .git
async function searchTool({ pattern, pathInclude, pathExclude }, workspace) {
  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const workspaceResolved = resolve(workspace);
    let searchPath = pathInclude ? resolve(workspace, pathInclude) : workspaceResolved;
    if (!isAbsolute(searchPath)) {
      searchPath = resolve(workspace, searchPath);
    }
    const excludePatterns = (pathExclude || []).map(p => {
      if (!isAbsolute(p)) {
        return resolve(workspace, p);
      }
      return resolve(p);
    });
    excludePatterns.push(resolve(workspace, 'node_modules'));
    excludePatterns.push(resolve(workspace, '.git'));
    const regex = new RegExp(pattern, 'gm');
    const results = [];
    async function searchFile(filePath) {
      try {
        const content = await fs.readFile(filePath, 'utf8');
        let match;
        while ((match = regex.exec(content)) !== null) {
          const beforeMatch = content.substring(0, match.index);
          const linesBefore = beforeMatch.split('\n');
          const lineNum = linesBefore.length; // 0-index line number
          results.push({
            file: path.relative(workspaceResolved, filePath),
            line: lineNum + 1,
            match: match[0]
          });
        }
      } catch (err) {
        // Ignore
      }
    }
    async function traverse(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const skip = excludePatterns.some(exclude => fullPath.startsWith(exclude));
          if (skip) continue;
          await traverse(fullPath);
        } else {
          await searchFile(fullPath);
        }
      }
    }
    await traverse(searchPath);
    return { results };
  } catch (err) {
    return { error: `Search failed: ${err.message}` };
  }
}

async function runShellTool({ command, timeout = 5000 }, workspace) {
  // Simple deny list
  const denyList = [
    /^rm\s+-rf\s+\//,
    /^sudo\s+/,
    /^mkfs/,
    /^>/,
  ];
  if (denyList.some(re => re.test(command.trim()))) {
    return { error: `Dangerous command blocked: ${command}` };
  }
  try {
    const { stdout, stderr } = await execPromise(command, {
      cwd: workspace,
      timeout: timeout,
      maxBuffer: 1024 * 1024 // 1MB
    });
    return { 
      exitCode: 0, 
      stdout: stdout.toString(), 
      stderr: stderr.toString() 
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { error: `Command not found: ${command}` };
    }
    if (err.code === 'ETIMEDOUT') {
      return { error: `Command timed out after ${timeout}ms` };
    }
    return { 
      exitCode: err.code || 1, 
      stdout: err.stdout ? err.stdout.toString() : '', 
      stderr: err.stderr ? err.stderr.toString() : '' 
    };
  }
}

// Helper to send SSE data to a session
function sendEventToSession(sessionId, data, event = null) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  let msg = '';
  if (event) {
    msg += `event: ${event}\\n`;
  }
  msg += `data: ${JSON.stringify(data)}\\n\\n`;
  try {
    session.res.write(msg);
    return true;
  } catch (err) {
    sessions.delete(sessionId);
    return false;
  }
}

// Parse JSON body middleware
async function parseJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : null);
      } catch (err) {
        reject(err);
      }
    });
    request.on('error', reject);
  });
}

// LLM API call function
async function callLLMApi(baseUrl, apiKey, model, messages, tools = null, stream = true) {
  const fetch = await import('node:fetch');
  const url = `${baseUrl}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };
  const body = {
    model,
    messages,
    stream,
  };
  if (tools) {
    body.tools = tools;
  }
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
  }
  if (!stream) {
    return await response.json();
  }
  // For streaming, we return the response body as a readable stream
  return response.body;
}

// Agent loop implementation
async function runAgent(sessionId, userMessage) {
  const session = sessions.get(sessionId);
  if (!session) {
    sendEventToSession(sessionId, { type: 'error', payload: { message: 'Session not found' } });
    return;
  }
  
  // Add user message to history
  session.messages.push({ role: 'user', content: userMessage });
  
  // Get LLM configuration
  const baseUrl = getEnvOrDefault('FORGE_BASE_URL', DEFAULT_BASE_URL);
  const apiKey = getEnvOrDefault('FORGE_API_KEY', DEFAULT_API_KEY);
  const model = getEnvOrDefault('FORGE_MODEL', DEFAULT_MODEL);
  
  // Define tools for LLM
  const tools = [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file from the workspace',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file, relative to workspace' },
            lineStart: { type: 'number', description: 'Optional starting line number (1-indexed)' },
            lineEnd: { type: 'number', description: 'Optional ending line number (inclusive)' }
          },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      name: 'write_file',
      description: 'Write content to a file in the workspace',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file, relative to workspace' },
          content: { type: 'string', description: 'Content to write' }
        },
        required: ['path', 'content']
      }
    },
    {
      type: 'function',
      name: 'edit_file',
      description: 'Edit a file by replacing exact string',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file, relative to workspace' },
          oldString: { type: 'string', description: 'Exact string to replace' },
          newString: { type: 'string', description: 'New string to replace with' }
        },
        required: ['path', 'oldString', 'newString']
      }
    },
    {
      type: 'function',
      name: 'list_dir',
      description: 'List directory contents',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path relative to workspace (optional)' }
        }
      }
    },
    {
      type: 'function',
      name: 'search',
      description: 'Search for regex pattern in files',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search for' },
          pathInclude: { type: 'string', description: 'Path to include in search (relative to workspace, optional)' },
          pathExclude: { type: 'string', description: 'Path to exclude from search (relative to workspace, optional)' }
        },
        required: ['pattern']
      }
    },
    {
      type: 'function',
      name: 'run_shell',
      description: 'Run a shell command',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          timeout: { type: 'number', description: 'Timeout in milliseconds (default 5000)' }
        },
        required: ['command']
      }
    }
  ];
  
  let steps = 0;
  const maxSteps = 50;
  
  while (steps < maxSteps) {
    steps++;
    
     // Signal start of agent turn
     sendEventToSession(sessionId, { type: 'agent-start', payload: {} });
     // Call LLM API with streaming
     try {
       const llmStream = await callLLMApi(baseUrl, apiKey, model, session.messages, tools, true);
      
      // Process the streaming response
      let toolCalls = [];
      let currentToolCallIndex = -1;
      let currentToolCallId = null;
      let currentFunctionName = '';
      let currentArguments = '';
      let inToolCall = false;
      let textBuffer = '';
      
      const reader = llmStream.getReader();
      const decoder = new TextDecoder('utf-8');
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          // Parse SSE lines
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.slice(5);
              if (dataStr === '[DONE]') {
                break;
              }
              try {
                const data = JSON.parse(dataStr);
                // Extract delta
                const delta = data.choices?.[0]?.delta;
                if (!delta) continue;
                
                 // Forward text deltas to client as agent chunk
                 if (delta.content) {
                   sendEventToSession(sessionId, { 
                     type: 'agent-chunk', 
                     payload: { text: delta.content } 
                   });
                   textBuffer += delta.content;
                 }
                
                // Handle tool calls in delta
                if (delta.tool_calls) {
                  for (const toolCall of delta.tool_calls) {
                    if (toolCall.index !== undefined && toolCall.index !== currentToolCallIndex) {
                      // Starting a new tool call
                      if (currentToolCallIndex !== -1) {
                        // Push previous tool call
                        toolCalls.push({
                          id: currentToolCallId,
                          type: 'function',
                          function: {
                            name: currentFunctionName,
                            arguments: currentArguments
                          }
                        });
                      }
                      currentToolCallIndex = toolCall.index;
                      currentToolCallId = toolCall.id;
                      currentFunctionName = toolCall.function?.name || '';
                      currentArguments = toolCall.function?.arguments || '';
                      inToolCall = true;
                    } else if (inToolCall) {
                      // Accumulate arguments
                      if (toolCall.function?.arguments) {
                        currentArguments += toolCall.function.arguments;
                      }
                    }
                  }
                }
              } catch (e) {
                // Ignore malformed JSON
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      
      // Push any remaining tool call
      if (inToolCall && currentToolCallIndex !== -1) {
        toolCalls.push({
          id: currentToolCallId,
          type: 'function',
          function: {
            name: currentFunctionName,
            arguments: currentArguments
          }
        });
      }
      
      // If we have tool calls, execute them
      if (toolCalls.length > 0) {
        // Add assistant message with tool calls to history
        session.messages.push({
          role: 'assistant',
          content: null, // or empty string
          tool_calls: toolCalls
        });
        
        // Execute each tool call
        for (const toolCall of toolCalls) {
          const { id, function: { name, arguments: argsStr } } = toolCall;
          let toolResult;
          try {
            const args = JSON.parse(argsStr);
            switch (name) {
              case 'read_file':
                toolResult = await readFileTool(args, session.workspace);
                break;
              case 'write_file':
                toolResult = await writeFileTool(args, session.workspace);
                break;
              case 'edit_file':
                toolResult = await editFileTool(args, session.workspace);
                break;
              case 'list_dir':
                toolResult = await listDirTool(args, session.workspace);
                break;
              case 'search':
                toolResult = await searchTool(args, session.workspace);
                break;
              case 'run_shell':
                toolResult = await runShellTool(args, session.workspace);
                break;
              default:
                toolResult = { error: `Unknown tool: ${name}` };
            }
          } catch (err) {
            toolResult = { error: `Tool execution failed: ${err.message}` };
          }
          
          // Send tool result event to client
          sendEventToSession(sessionId, {
            type: 'tool-result',
            payload: {
              toolCallId: id,
              result: toolResult
            }
          });
          
          // Add tool result to messages as a tool message
          session.messages.push({
            role: 'tool',
            tool_call_id: id,
            name,
            content: JSON.stringify(toolResult)
          });
        }
        
        // Continue loop to let LLM process tool results
        continue;
      }
      
       // No tool calls, we have a final text response
       // Extract the accumulated text from textBuffer (or we could have collected deltas)
       const assistantText = textBuffer.trim();
       // Add assistant message to history
       if (assistantText) {
         session.messages.push({ role: 'assistant', content: assistantText });
       }
       // Signal end of agent turn
       sendEventToSession(sessionId, { type: 'agent-end', payload: {} });
      // Agent finished
      return;
    } catch (err) {
      console.error('LLM API error:', err);
      sendEventToSession(sessionId, { 
        type: 'error', 
        payload: { message: `LLM API error: ${err.message}` } 
      });
      return;
    }
  }
  
  // Max steps exceeded
  sendEventToSession(sessionId, { 
    type: 'error', 
    payload: { message: 'Agent exceeded maximum steps' } 
  });
}

// Create the HTTP server
function createForgeServer() {
  return httpCreateServer(async (request, response) => {
    // Parse JSON body for POST requests
    let body = null;
    if (request.method === 'POST' && request.headers['content-type'] === 'application/json') {
      try {
        body = await parseJsonBody(request);
      } catch (err) {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }
    }
    
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathname = url.pathname;
    const searchParams = url.searchParams;

    // Serve static files from public directory
    if (!pathname.startsWith('/api/')) {
      // Remove leading slash and resolve relative to public
      let requestedPath = pathname.startsWith('/') ? pathname.slice(1) : pathname;
      // If requestedPath ends with '/', append 'index.html'
      if (requestedPath.endsWith('/')) {
        requestedPath += 'index.html';
      }
      // If requestedPath is empty, treat as index.html
      if (requestedPath === '') {
        requestedPath = 'index.html';
      }
      const filePath = join(PUBLIC_DIR, requestedPath);
      try {
        await stat(filePath);
        const buffer = await readFile(filePath);
        // Determine content type based on extension
        let contentType = 'application/octet-stream';
        if (filePath.endsWith('.html')) contentType = 'text/html';
        else if (filePath.endsWith('.css')) contentType = 'text/css';
        else if (filePath.endsWith('.js')) contentType = 'application/javascript';
        else if (filePath.endsWith('.json')) contentType = 'application/json';
        else if (filePath.endsWith('.png')) contentType = 'image/png';
        else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) contentType = 'image/jpeg';
        else if (filePath.endsWith('.svg')) contentType = 'image/svg+xml';
        response.writeHead(200, { 'Content-Type': contentType });
        response.end(buffer);
        return;
      } catch (err) {
        // If file not found, fall through to 404
      }
    }

    // SSE endpoint for live streaming
    if (pathname === '/api/events') {
      return handleEvents(request, response);
    }

    // Set workspace endpoint
    if (pathname === '/api/workspace' && request.method === 'POST') {
      return handleSetWorkspace(request, response, body);
    }

    // Agent endpoint
    if (pathname === '/api/agent' && request.method === 'POST') {
      return handleAgent(request, response, body);
    }

    // Not found
    response.writeHead(404);
    response.end('Not Found');
  });
}

async function handleEvents(request, response) {
  const sessionId = request.headers['x-session-id'] || 
                   request.url.includes('session=') ? new URL(request.url, `http://${request.headers.host}`).searchParams.get('session') :
                   null;
  
  // Generate a session ID if not provided
  if (!sessionId) {
    const newId = Math.random().toString(36).substr(2, 9);
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Session-Id': newId,
    });
    // Send the session ID as an event
    response.write(`data: ${JSON.stringify({ type: 'session-id', payload: { sessionId: newId } })}\\n\\n`);
    // Store the session
    sessions.set(newId, { res: response, lastPing: Date.now(), workspace: null, messages: [] });
  } else {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    sessions.set(sessionId, { res: response, lastPing: Date.now(), workspace: null, messages: [] });
  }
  
  // Send initial connected event
  response.write(`data: ${JSON.stringify({ type: 'connected', payload: { message: 'Connected to Forge SSE' } })}\\n\\n`);
  
  // Heartbeat interval
  const heartbeatInterval = setInterval(() => {
    const session = sessions.get(sessionId);
    if (!session) {
      clearInterval(heartbeatInterval);
      return;
    }
    try {
      session.res.write(':heartbeat\\n\\n');
      session.lastPing = Date.now();
    } catch (err) {
      clearInterval(heartbeatInterval);
      sessions.delete(sessionId);
    }
  }, 30000);
  
  // Cleanup when client closes
  const onClose = () => {
    clearInterval(heartbeatInterval);
    sessions.delete(sessionId);
    response.end();
  };
  
  request.on('close', onClose);
  request.on('end', onClose);
}

async function handleSetWorkspace(request, response, body) {
  if (!body || !body.path) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Missing path' }));
    return;
  }
  const sessionId = body.sessionId;
  if (!sessionId) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Missing sessionId' }));
    return;
  }
  const session = sessions.get(sessionId);
  if (!session) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Invalid sessionId' }));
    return;
  }
  // Validate path exists and is a directory
  try {
    const fs = await import('node:fs/promises');
    const stats = await fs.stat(body.path);
    if (!stats.isDirectory()) {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Path is not a directory' }));
      return;
    }
    // Set workspace
    session.workspace = body.path;
    // Reset messages? optional
    session.messages = [];
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ success: true }));
  } catch (err) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: `Invalid path: ${err.message}` }));
  }
}

async function handleAgent(request, response, body) {
  if (!body || !body.message) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Missing message' }));
    return;
  }
  const sessionId = body.sessionId;
  if (!sessionId) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Missing sessionId' }));
    return;
  }
  const session = sessions.get(sessionId);
  if (!session) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Invalid sessionId' }));
    return;
  }
  
  // Acknowledge receipt
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ status: 'ok' }));
  
  // Run agent in background
  runAgent(sessionId, body.message).catch(err => {
    console.error('Agent error:', err);
    // Send error via SSE if possible
    sendEventToSession(sessionId, { 
      type: 'error', 
      payload: { message: `Agent error: ${err.message}` } 
    });
  });
}

export { createForgeServer };
export default { createForgeServer };
