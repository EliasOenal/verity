import { VerityView } from "../verityView";
import { ChatController } from "./chatController";

export class ChatView extends VerityView {
    declare readonly controller: ChatController;
    private chatContainer: HTMLElement;
    private messageList: HTMLElement;
    private notificationKeyInput: HTMLInputElement;
    private notificationKeySetButton: HTMLButtonElement;
    private usernameInput: HTMLInputElement;
    private usernameSetButton: HTMLButtonElement;
    private messageInput: HTMLInputElement;
    private sendButton: HTMLButtonElement;

    constructor(controller: ChatController, htmlTemplate: HTMLTemplateElement = document.getElementById(
        "verityChatAppTemplate") as HTMLTemplateElement,) {
        super(controller, htmlTemplate);
        this.chatContainer = document.createElement('div');
        this.renderedView = document.createElement('div');
    }

    render(): void {
        const template = document.getElementById('verityChatAppTemplate') as HTMLTemplateElement;
        if (!template) {
            console.error('Chat app template not found');
            return;
        }
        const content = template.content.cloneNode(true) as HTMLElement;
        this.chatContainer = content.querySelector('.verityChatApp') as HTMLElement;
        
        this.messageList = this.chatContainer.querySelector('.verityChatMessages') as HTMLElement;
        this.notificationKeyInput = this.chatContainer.querySelector('.verityNotificationKeyInput') as HTMLInputElement;
        this.notificationKeySetButton = this.chatContainer.querySelector('.verityNotificationKeySet') as HTMLButtonElement;
        this.usernameInput = this.chatContainer.querySelector('.verityUsernameInput') as HTMLInputElement;
        this.usernameSetButton = this.chatContainer.querySelector('.verityUsernameSet') as HTMLButtonElement;
        this.messageInput = this.chatContainer.querySelector('.verityMessageInput') as HTMLInputElement;
        this.sendButton = this.chatContainer.querySelector('button[type="submit"]') as HTMLButtonElement;

        // Set default username to "Anonymous"
        this.usernameInput.value = "Anonymous";

        const setNotificationKey = () => this.controller.setNotificationKey(this.notificationKeyInput.value);
        const setUsername = () => this.controller.setUsername(this.usernameInput.value || "Anonymous");

        this.notificationKeySetButton.addEventListener('click', setNotificationKey);
        this.usernameSetButton.addEventListener('click', setUsername);

        this.notificationKeyInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                setNotificationKey();
            }
        });

        this.usernameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                setUsername();
            }
        });
        
        const form = this.chatContainer.querySelector('.verityChatForm') as HTMLFormElement;
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.controller.sendMessage(this.usernameInput.value || "Anonymous", this.messageInput.value);
            this.messageInput.value = '';
        });

        this.renderedView.appendChild(this.chatContainer);
    }

    updateMessages(messages: Array<{ username: string, message: string, timestamp: Date }>): void {
        const isScrolledToBottom = this.isScrolledToBottom();
        const scrollTop = this.messageList.scrollTop;

        this.messageList.innerHTML = '';
        for (const { username, message, timestamp } of messages) {
            const messageElement = document.createElement('div');
            messageElement.className = 'verityChatMessage';
            messageElement.innerHTML = `
                <span class="verityMessageTimestamp">${timestamp.toLocaleString()}</span>
                <span class="verityMessageUsername">${username}:</span>
                <span class="verityMessageContent">${message}</span>
            `;
            this.messageList.appendChild(messageElement);
        }

        if (isScrolledToBottom) {
            this.scrollToBottom();
        } else {
            this.messageList.scrollTop = scrollTop;
        }
    }

    private isScrolledToBottom(): boolean {
        const threshold = 1;
        const position = this.messageList.scrollHeight - this.messageList.scrollTop - this.messageList.clientHeight;
        return position <= threshold;
    }

    private scrollToBottom(): void {
        this.messageList.scrollTop = this.messageList.scrollHeight;
    }

    showError(message: string): void {
        const errorElement = this.chatContainer.querySelector('.verityChatError') as HTMLElement;
        errorElement.textContent = message;
        errorElement.style.display = 'block';
        setTimeout(() => {
            errorElement.style.display = 'none';
        }, 5000);
    }
}
