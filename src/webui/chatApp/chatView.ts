import { VerityView } from "../verityView";
import { ChatController, ChatRoom } from "./chatController";

export class ChatView extends VerityView {
    declare readonly controller: ChatController;
    private chatContainer: HTMLElement;
    private roomTabs: HTMLElement;
    private messageList: HTMLElement;
    private usernameInput: HTMLInputElement;
    private usernameSetButton: HTMLButtonElement;
    private roomNameInput: HTMLInputElement;
    private joinRoomButton: HTMLButtonElement;
    private messageInput: HTMLInputElement;
    private sendButton: HTMLButtonElement;
    private activeRoomName: HTMLElement;

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
        
        this.roomTabs = this.chatContainer.querySelector('.verityChatRoomTabs') as HTMLElement;
        this.messageList = this.chatContainer.querySelector('.verityChatMessages') as HTMLElement;
        this.usernameInput = this.chatContainer.querySelector('.verityUsernameInput') as HTMLInputElement;
        this.usernameSetButton = this.chatContainer.querySelector('.verityUsernameSet') as HTMLButtonElement;
        this.roomNameInput = this.chatContainer.querySelector('.verityRoomNameInput') as HTMLInputElement;
        this.joinRoomButton = this.chatContainer.querySelector('.verityJoinRoom') as HTMLButtonElement;
        this.messageInput = this.chatContainer.querySelector('.verityMessageInput') as HTMLInputElement;
        this.sendButton = this.chatContainer.querySelector('button[type="submit"]') as HTMLButtonElement;
        this.activeRoomName = this.chatContainer.querySelector('.verityActiveRoomName') as HTMLElement;

        // Set default username to "Anonymous"
        this.usernameInput.value = "Anonymous";

        const setUsername = () => this.controller.setUsername(this.usernameInput.value || "Anonymous");
        const joinRoom = () => {
            // Allow any room name including empty strings and whitespace
            this.controller.joinRoom(this.roomNameInput.value);
            this.roomNameInput.value = '';
        };

        this.usernameSetButton.addEventListener('click', setUsername);
        this.joinRoomButton.addEventListener('click', joinRoom);

        this.usernameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                setUsername();
            }
        });

        this.roomNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                joinRoom();
            }
        });
        
        const form = this.chatContainer.querySelector('.verityChatForm') as HTMLFormElement;
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const message = this.messageInput.value.trim();
            if (message) {
                this.controller.sendMessage(this.usernameInput.value || "Anonymous", message);
                this.messageInput.value = '';
            }
        });

        this.renderedView.appendChild(this.chatContainer);
    }

    updateMessages(messages: Array<{ username: string, message: string, timestamp: Date, cubeKey?: string }>): void {
        const isScrolledToBottom = this.isScrolledToBottom();
        const scrollTop = this.messageList.scrollTop;

        this.messageList.innerHTML = '';
        for (const { username, message, timestamp } of messages) {
            const messageElement = document.createElement('div');
            messageElement.className = 'verityChatMessage';
            
            // Create a more structured message layout
            const timeString = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            messageElement.innerHTML = `
                <div class="verityMessageHeader">
                    <span class="verityMessageUsername">${this.escapeHtml(username)}</span>
                    <span class="verityMessageTimestamp">${timeString}</span>
                </div>
                <div class="verityMessageContent">${this.escapeHtml(message)}</div>
            `;
            this.messageList.appendChild(messageElement);
        }

        if (isScrolledToBottom) {
            this.scrollToBottom();
        } else {
            this.messageList.scrollTop = scrollTop;
        }
    }

    updateRoomList(rooms: ChatRoom[]): void {
        this.roomTabs.innerHTML = '';
        
        if (rooms.length === 0) {
            this.activeRoomName.textContent = 'No rooms joined';
            return;
        }

        rooms.forEach(room => {
            const tab = document.createElement('button');
            tab.className = 'verityChatRoomTab';
            tab.dataset.roomId = room.id;
            
            if (room.unreadCount > 0) {
                tab.classList.add('hasUnread');
            }
            
            tab.innerHTML = `
                <span class="roomName">${this.escapeHtml(room.name)}</span>
                ${room.unreadCount > 0 ? `<span class="unreadBadge">${room.unreadCount}</span>` : ''}
                <button class="closeRoom" data-room-id="${room.id}" title="Leave room">×</button>
            `;
            
            // Add click handler for tab switching
            tab.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                if (target.classList.contains('closeRoom')) {
                    e.stopPropagation();
                    this.controller.leaveRoom(room.id);
                } else {
                    this.controller.switchToRoom(room.id);
                }
            });
            
            this.roomTabs.appendChild(tab);
        });
    }

    updateActiveRoom(roomId: string): void {
        // Update active tab styling
        const tabs = this.roomTabs.querySelectorAll('.verityChatRoomTab');
        tabs.forEach(tab => {
            const tabElement = tab as HTMLElement;
            if (tabElement.dataset.roomId === roomId) {
                tabElement.classList.add('active');
                const roomName = tabElement.querySelector('.roomName')?.textContent || 'Unknown Room';
                this.activeRoomName.textContent = roomName;
            } else {
                tabElement.classList.remove('active');
            }
        });
    }

    private escapeHtml(unsafe: string): string {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
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

    setUsername(username: string): void {
        this.usernameInput.value = username;
    }
}
