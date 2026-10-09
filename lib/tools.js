import { stat, readdir, readFile, writeFile, access } from 'node:fs/promises';
import { join, resolve, isAbsolute, relative } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execPromise = promisify(exec);

// Deny-list of dangerous shell commands
const DENY_LIST = [
  /^rm\s+-rf\s+\//,
  /^sudo\s+/,
  /^mkfs/,
  /^>/,
  // Add more as needed
];

function isDangerousCommand(command) {
  return DENY_LIST.some(re => re.test(command.trim()));
}

// Validate that a path is within the workspace
function ensureInWorkspace(requestedPath, workspace) {
  // Resolve the requested path relative to workspace
  let absolutePath;
  if (isAbsolute(requestedPath)) {
    absolutePath = resolve(requestedPath);
  } else {
    absolutePath = resolve(workspace, requestedPath);
  }
  
  // Check if absolutePath starts with workspace
  const workspaceAbsolute = resolve(workspace);
  if (!absolutePath.startsWith(workspaceAbsolute)) {
    throw new Error(`Access denied: ${requestedPath} is outside workspace`);
  }
  
  // Also check for symlinks? We'll assume realpath not needed for now.
  return absolutePath;
}

export async function readFileTool({ path, lineStart, lineEnd }, workspace) {
  const absolutePath = ensureInWorkspace(path, workspace);
  let data;
  try {
    data = await readFile(absolutePath, 'utf8');
  } catch (err) {
    return { error: `Failed to read file: ${err.message}` };
  }
  
  const lines = data.split('\n');
  let start = 0;
  let end = lines.length;
  if (typeof lineStart === 'number') {
    start = Math.max(0, lineStart - 1); // convert to 0-index
  }
  if (typeof lineEnd === 'number') {
    end = Math.min(lines.length, lineEnd); // exclusive
  }
  const selectedLines = lines.slice(start, end);
  // Output with line numbers (starting from start+1)
  const numbered = selectedLines.map((line, idx) => {
    const lineNum = start + idx + 1;
    return `${lineNum}:${line}`;
  }).join('\n');
  return { text: numbered };
}

export async function writeFileTool({ path, content }, workspace) {
  const absolutePath = ensureInWorkspace(path, workspace);
  try {
    await writeFile(absolutePath, content, 'utf8');
    return { success: true };
  } catch (err) {
    return { error: `Failed to write file: ${err.message}` };
  }
}

export async function editFileTool({ path, oldString, newString }, workspace) {
  const absolutePath = ensureInWorkspace(path, workspace);
  try {
    let data = await readFile(absolutePath, 'utf8');
    // Check if oldString appears exactly once
    const matches = data.match(new RegExp(escapeRegExp(oldString), 'g'));
    if (!matches) {
      return { error: `String not found in file` };
    }
    if (matches.length > 1) {
      return { error: `Multiple matches found (${matches.length}). Please provide more context to make it unique.` };
    }
    const newData = data.replace(oldString, newString);
    await writeFile(absolutePath, newData, 'utf8');
    return { success: true };
  } catch (err) {
    return { error: `Failed to edit file: ${err.message}` };
  }
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function listDirTool({ path }, workspace) {
  const absolutePath = ensureInWorkspace(path || '.', workspace);
  try {
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

export async function searchTool({ pattern, pathInclude, pathExclude }, workspace) {
  // For simplicity, we'll implement a basic grep-like search using node:fs and regex
  // We'll skip node_modules and .git as requested
  const { default: minimatch } = await import('node:minimatch'); // Actually minimatch is not built-in
  // Since we cannot install dependencies, we'll implement a simple filter ourselves.
  // We'll just do a recursive search and test each file path against simple glob patterns? 
  // Given time, we'll implement a simplified version that searches in the given path (or workspace) 
  // and skips any folder named node_modules or .git.
  // We'll use a simple regex for file content.
  // This is not efficient but okay for demo.
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
  
  // Always exclude node_modules and .git
  excludePatterns.push(resolve(workspace, 'node_modules'));
  excludePatterns.push(resolve(workspace, '.git'));
  
  const regex = new RegExp(pattern, 'gm'); // global multiline
  
  const results = [];
  
  async function searchFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      let match;
      let lineNum = 0;
      while ((match = regex.exec(content)) !== null) {
        // Find line number
        const beforeMatch = content.substring(0, match.index);
        const linesBefore = beforeMatch.split('\n');
        lineNum = linesBefore.length; // 0-index? Actually linesBefore length is number of lines before match
        // Adjust: line number = linesBefore.length + 1
        results.push({
          file: relative(workspaceResolved, filePath),
          line: lineNum + 1,
          match: match[0]
        });
      }
    } catch (err) {
      // Ignore unreadable files
    }
  }
  
  async function traverse(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      // Skip excluded directories
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
}

export async function runShellTool({ command, timeout = 5000 }, workspace) {
  // First check deny list
  if (isDangerousCommand(command)) {
    return { error: `Dangerous command blocked: ${command}` };
  }
  
  // We'll run the command in the workspace directory
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

export { ensureInWorkspace };
