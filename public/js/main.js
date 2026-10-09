// Client-side logic for Forge UI
class ForgeUI {
    constructor() {
        this.isDark = true;
        this.init();
    }
    
    init() {
        this.bindEvents();
        this.applyTheme();
    }
    
    bindEvents() {
        // Theme toggle (placeholder)
        // const themeToggle = document.getElementById('theme-toggle');
        // if (themeToggle) {
        //     themeToggle.addEventListener('click', () => this.toggleTheme());
        // }
        
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
    
    sendMessage() {
        const input = document.getElementById('input');
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;
        
        // Add message to chat
        this.addMessage(text, 'user');
        input.value = '';
        
        // TODO: send to server via fetch and handle response
        // For now, just echo
        setTimeout(() => {
            this.addMessage(`Echo: ${text}`, 'assistant');
        }, 500);
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
        // TODO: implement
        console.log('New chat');
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
