import { createServer } from 'node:http';

function createMockLLMServer(port) {
  return createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === '/v1/chat/completions' && request.method === 'POST') {
      // Read body
      let body = '';
      for await (const chunk of request) {
        body += chunk;
      }
      // We'll ignore the body for now
      // Set headers for streaming
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      
      // Send a series of chunks to simulate LLM response with tool calls
      // First chunk: start of assistant message
      response.write(`data: ${JSON.stringify({
        id: 'chatcmpl-mock',
        object: 'chat.completion.chunk',
        model: 'mock-model',
        choices: [{
          index: 0,
          delta: { role: 'assistant', content: '' }
        }]
      })}\\n\\n`);
      
      // Small delay
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Second chunk: tool call for write_file
      response.write(`data: ${JSON.stringify({
        id: 'chatcmpl-mock',
        object: 'chat.completion.chunk',
        model: 'mock-model',
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_mock_1',
              type: 'function',
              function: {
                name: 'write_file',
                arguments: '{\"path\":\"hello.txt\",\"content\":\"hello\"}'
              }
            }]
          }
        }]
      })}\\n\\n`);
      
      // Small delay
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Third chunk: tool call for read_file
      response.write(`data: ${JSON.stringify({
        id: 'chatcmpl-mock',
        object: 'chat.completion.chunk',
        model: 'mock-model',
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 1,
              id: 'call_mock_2',
              type: 'function',
              function: {
                name: 'read_file',
                arguments: '{\"path\":\"hello.txt\"}'
              }
            }]
          }
        }]
      })}\\n\\n`);
      
      // Small delay
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Fourth chunk: final text
      response.write(`data: ${JSON.stringify({
        id: 'chatcmpl-mock',
        object: 'chat.completion.chunk',
        model: 'mock-model',
        choices: [{
          index: 0,
          delta: { content: 'I have created the file and read it back. The file contains \"hello\".' }
        }]
      })}\\n\\n`);
      
      // Final chunk to end stream
      response.write(`data: ${JSON.stringify({
        id: 'chatcmpl-mock',
        object: 'chat.completion.chunk',
        model: 'mock-model',
        choices: [{
          index: 0,
          delta: {}
        }]
      })}\\n\\n`);
      
      // Send the final [DONE] marker
      response.write('data: [DONE]\\n\\n');
      
      response.end();
      return;
    }
    
    // Not found
    response.writeHead(404);
    response.end('Not Found');
  });
}

export { createMockLLMServer };
