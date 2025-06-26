import { ControllerContext, VerityController } from "../verityController";
import { ChatView } from "./chatView";
import { ChatApplication } from "../../app/chatApplication";
import { logger } from "../../core/logger";
import { cciCube, cciFamily } from "../../cci/cube/cciCube";
import { Buffer } from "buffer";
import { log } from "console";
import { NotificationKey } from "../../core/cube/cube.definitions";

export class ChatController extends VerityController {
    declare public contentAreaView: ChatView;
    private notificationKey: NotificationKey | null = null;
    private username: string = '';
    private refreshInterval: NodeJS.Timeout | null = null;

    constructor(parent: ControllerContext) {
        super(parent);
        this.contentAreaView = new ChatView(this);
    }

    async showChatApp(): Promise<void> {
        this.contentAreaView.render();
        const contentArea = document.getElementById('verityContentArea');
        if (contentArea) {
            contentArea.innerHTML = '';
            contentArea.appendChild(this.contentAreaView.renderedView);
            if (this.notificationKey) {
                this.startAutoRefresh();
            }
        } else {
            logger.error('Chat: Content area not found');
        }
    }

    async setNotificationKey(key: string): Promise<void> {
        try {
            this.notificationKey = Buffer.alloc(32) as NotificationKey;
            this.notificationKey.write(key, 'utf-8');
            await this.updateMessages();
            this.startAutoRefresh();
        } catch (error) {
            logger.error(`Chat: Invalid notification key: ${error}`);
            this.contentAreaView.showError("Invalid notification key. Please enter up to 32 bytes.");
            this.stopAutoRefresh();
        }
    }

    private startAutoRefresh(): void {
        if (!this.refreshInterval) {
            this.refreshInterval = setInterval(() => {
                if (this.notificationKey) {
                    this.updateMessages();
                }
            }, 3000);
        }
    }

    private stopAutoRefresh(): void {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    setUsername(username: string): void {
        this.username = username || "Anonymous";
        logger.trace(`Chat: Username set to ${this.username}`);
    }

    async sendMessage(username: string, message: string): Promise<void> {
        if (!this.notificationKey) {
            this.contentAreaView.showError("Please set a notification key first.");
            return;
        }

        try {
            const chatCube = await ChatApplication.createChatCube(username, message, this.notificationKey);
            await this.cubeStore.addCube(chatCube);
            await this.updateMessages();
        } catch (error) {
            logger.error(`Chat: Error sending message: ${error}`);
            this.contentAreaView.showError("Failed to send message. Please try again.");
        }
    }

    private async updateMessages(): Promise<void> {
        logger.trace('Chat: Updating messages: ' + this.notificationKey.toString('hex'));
        if (!this.notificationKey) return;

        const messages = [];
        for await (const cubeInfo of this.cubeStore.getNotificationCubesInTimeRange(this.notificationKey, 0, (Date.now() / 1000) + 100000, 200, true)) {
            try {
                let cciCube: cciCube = cubeInfo.getCube({family: cciFamily}) as cciCube;
                const { username, message } = ChatApplication.parseChatCube(cciCube);
                messages.push({ username, message, timestamp: new Date(cciCube.getDate() * 1000) });
            } catch (error) {
                logger.warn(`Chat: Error parsing chat cube: ${error}`);
            }
        }

        this.contentAreaView.updateMessages(messages);
    }

    async close(unshow?: boolean, callback?: boolean): Promise<void> {
        this.stopAutoRefresh();
        return super.close(unshow, callback);
    }
}

