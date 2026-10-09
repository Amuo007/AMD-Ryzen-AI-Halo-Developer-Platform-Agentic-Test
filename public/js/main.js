// Client-side logic for Forge UI
class ForgeUI {
    constructor() {
        this.isDark = true;
        this.eventSource = null;
        this.sessionId = null;
        this.currentAssistantMessageDiv = null;
        this.init();
    }
    
    init() {
        this.bindEvents();
        this.applyTheme();
        // Note: SSE connection will be started after we get session ID from server?
        // We'll start SSE and wait for session-id event.
    }
    
    bindEvents() {
        // Send button
        const sendBtn = document.getElementById('send');
        if (sendBtn) {
            sendBtn.addEventListener('click', () => this.sendMessage());
        }
        
        const input = document.getElementById('input');
        if (input) {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.sendMessage();
                }
            });
        }
        
        // New chat button
        const newChatBtn = document.getElementById('new-chat');
        if (newChatBtn) {
            newChatBtn.addEventListener('click', () => this.newChat());
        }
        
        // Settings button
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => this.openSettings());
        }
    }
    
    applyTheme() {
        if (this.isDark) {
            document.body.classList.add('dark');
            document.body.classList.remove('light');
        } else {
            document.body.classList.add('light');
            document.body.classList.remove('dark');
        }
    }
    
    toggleTheme() {
        this.isDark = !this.isDark;
        this.applyTheme();
        // TODO: save preference
    }
    
    connectToEvents() {
        // Close existing connection if any
        if (this.eventSource) {
            this.eventSource.close();
        }
        
        const url = new URL('/api/events', window.location.origin);
        // No session yet; we'll get it from server
        this.eventSource = new EventSource(url);
        
        this.eventSource.onopen = () => {
            console.log('SSE connection opened');
        };
        
        this.eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleEvent(data);
            } catch (e) {
                console.error('Failed to parse SSE data:', event.data, e);
            }
        };
        
        this.eventSource.onerror = (err) => {
            console.error('SSE error:', err);
            // Try to reconnect after a delay
            setTimeout(() => this.connectToEvents(), 3000);
        };
    }
    
     handleEvent(data) {
         console.log('Received event:', data);
         switch (data.type) {
             case 'session-id':
                 this.sessionId = data.payload.sessionId;
                 console.log('Assigned session ID:', this.sessionId);
                 // Now we can start sending messages
                 break;
             case 'connected':
                 // Already connected
                 break;
             case 'agent-start':
                 this.startAssistantMessage();
                 break;
             case 'agent-chunk':
                 this.appendAssistantMessage(data.payload.text);
                 break;
             case 'agent-end':
                 this.endAssistantMessage();
                 break;
             case 'tool-result':
                 // For now, log the tool result
                 console.log('Tool result:', data.payload);
                 // Optionally show a system message
                 this.addMessage(`[Tool result] ${data.payload.result.success ? 'Success' : 'Error'}`, 'system');
                 break;
             case 'error':
                 this.addMessage(`[Error] ${data.payload.message}`, 'system');
                 break;
             default:
                 // For other events, show as system message
                 const message = data.payload?.message || JSON.stringify(data);
                 this.addMessage(`[System] ${message}`, 'system');
         }
     }
    
    startAssistantMessage() {
        const messagesDiv = document.getElementById('messages');
        if (!messagesDiv) return;
        this.currentAssistantMessageDiv = document.createElement('div');
        this.currentAssistantMessageDiv.classList.add('message', 'assistant');
        messagesDiv.appendChild(this.currentAssistantMessageDiv);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
    
    appendAssistantMessage(text) {
        if (!this.currentAssistantMessageDiv) return;
        this.currentAssistantMessageDiv.textContent += text;
        const messagesDiv = document.getElementById('messages');
        if (messagesDiv) {
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }
    }
    
    endAssistantMessage() {
        this.currentAssistantMessageDiv = null;
    }
    
    sendMessage() {
        if (!this.sessionId) {
            console.warn('No session ID yet');
            return;
        }
        const input = document.getElementById('input');
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;
        
        // Add user message to chat
        this.addMessage(text, 'user');
        input.value = '';
        
        // Send to agent endpoint
        fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: text,
                sessionId: this.sessionId
            })
        })
        .then(response => response.json())
        .then(data => {
            console.log('Agent response:', data);
            // The actual streaming will come via SSE
        })
        .catch(err => {
            console.error('Failed to send message:', err);
            this.addMessage('[Error] Failed to send message to agent', 'system');
        });
    }
    
    addMessage(text, type) {
        const messagesDiv = document.getElementById('messages');
        if (!messagesDiv) return;
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', type);
        msgDiv.textContent = text;
        messagesDiv.appendChild(msgDiv);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
    
    newChat() {
        // Generate new session ID and reconnect
        this.sessionId = null;
        if (this.eventSource) {
            this.eventSource.close();
        }
        this.connectToEvents();
        // Clear chat
        const messagesDiv = document.getElementById('messages');
        if (messagesDiv) {
            messagesDiv.innerHTML = '';
        }
        this.currentAssistantMessageDiv = null;
    }
    
    openSettings() {
        // TODO: implement settings modal
        console.log('Settings');
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.forgeUI = new ForgeUI();
});
