import { ControllerContext, VerityController } from "../verityController";
import { ChatView } from "./chatView";
import { ChatApplication } from "../../app/chatApplication";
import { logger } from "../../core/logger";
import { cciCube, cciFamily } from "../../cci/cube/cciCube";
import { Buffer } from "buffer";
import { NotificationKey } from "../../core/cube/cube.definitions";
import { mergeAsyncGenerators, MergedAsyncGenerator } from "../../core/helpers/asyncGenerators";
import { RetrievalFormat } from "../../cci/veritum/veritum.definitions";
import { Cube } from "../../core/cube/cube";
import { CubeRetriever } from "../../core/networking/cubeRetrieval/cubeRetriever";

export class ChatController extends VerityController {
    declare public contentAreaView: ChatView;
    private notificationKey: NotificationKey | null = null;
    private username: string = '';
    private cubeSubscription: MergedAsyncGenerator<Cube> | null = null;
    private isProcessingMessages: boolean = false;

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
                await this.startNotificationSubscription();
            }
        } else {
            logger.error('Chat: Content area not found');
        }
    }

    async setNotificationKey(key: string): Promise<void> {
        try {
            this.notificationKey = Buffer.alloc(32) as NotificationKey;
            this.notificationKey.write(key, 'utf-8');
            await this.startNotificationSubscription();
        } catch (error) {
            logger.error(`Chat: Invalid notification key: ${error}`);
            this.contentAreaView.showError("Invalid notification key. Please enter up to 32 bytes.");
            this.stopNotificationSubscription();
        }
    }

    private async startNotificationSubscription(): Promise<void> {
        if (!this.notificationKey || this.cubeSubscription || this.isProcessingMessages) {
            return;
        }

        logger.trace('Chat: Starting notification subscription for key: ' + this.notificationKey.toString('hex'));
        
        try {
            // Get existing cubes from local store
            const existingCubes: AsyncGenerator<Cube> = 
                this.cubeStore.getNotifications(this.notificationKey, { format: RetrievalFormat.Cube }) as AsyncGenerator<Cube>;
            
            // Subscribe to future cubes via network (with proper type checking)
            if ('subscribeNotifications' in this.cubeRetriever) {
                const futureCubes: AsyncGenerator<Cube> = 
                    (this.cubeRetriever as CubeRetriever).subscribeNotifications(this.notificationKey, { format: RetrievalFormat.Cube });
                
                // Merge both streams
                this.cubeSubscription = mergeAsyncGenerators(existingCubes, futureCubes);
            } else {
                // Fallback to existing cubes only if subscription is not available
                this.cubeSubscription = mergeAsyncGenerators(existingCubes);
            }
            
            // Start processing messages
            this.processMessageStream();
        } catch (error) {
            logger.error(`Chat: Error starting notification subscription: ${error}`);
            this.contentAreaView.showError("Failed to start real-time chat updates.");
        }
    }

    private stopNotificationSubscription(): void {
        if (this.cubeSubscription) {
            logger.trace('Chat: Stopping notification subscription');
            this.cubeSubscription.return(undefined);
            this.cubeSubscription = null;
        }
        this.isProcessingMessages = false;
    }

    private async processMessageStream(): Promise<void> {
        if (!this.cubeSubscription || this.isProcessingMessages) {
            return;
        }

        this.isProcessingMessages = true;
        const messages: Array<{ username: string, message: string, timestamp: Date }> = [];

        try {
            for await (const cube of this.cubeSubscription) {
                try {
                    if (!cube) continue;
                    
                    const cciCube: cciCube = cube as cciCube;
                    const { username, message } = ChatApplication.parseChatCube(cciCube);
                    const newMessage = { 
                        username, 
                        message, 
                        timestamp: new Date(cciCube.getDate() * 1000) 
                    };
                    
                    // Add to messages array (keeping sorted by timestamp)
                    messages.push(newMessage);
                    messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
                    
                    // Update the UI immediately
                    this.contentAreaView.updateMessages([...messages]);
                } catch (error) {
                    logger.warn(`Chat: Error parsing chat cube: ${error}`);
                }
            }
        } catch (error) {
            logger.error(`Chat: Error processing message stream: ${error}`);
        } finally {
            this.isProcessingMessages = false;
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
            // No need to manually update messages - the subscription will handle it automatically
        } catch (error) {
            logger.error(`Chat: Error sending message: ${error}`);
            this.contentAreaView.showError("Failed to send message. Please try again.");
        }
    }

    async close(unshow?: boolean, callback?: boolean): Promise<void> {
        this.stopNotificationSubscription();
        return super.close(unshow, callback);
    }
}

