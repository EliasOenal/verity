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

export interface ChatRoom {
    id: string;
    name: string;
    notificationKey: NotificationKey;
    messages: Array<{ username: string, message: string, timestamp: Date }>;
    unreadCount: number;
    subscription: MergedAsyncGenerator<Cube> | null;
    isProcessingMessages: boolean;
}

export class ChatController extends VerityController {
    declare public contentAreaView: ChatView;
    private username: string = '';
    private rooms: Map<string, ChatRoom> = new Map();
    private activeRoomId: string | null = null;

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
        } else {
            logger.error('Chat: Content area not found');
        }
    }

    async joinRoom(roomName: string): Promise<void> {
        if (!roomName.trim()) {
            this.contentAreaView.showError("Please enter a room name.");
            return;
        }

        const roomId = roomName.toLowerCase().trim();
        if (this.rooms.has(roomId)) {
            this.switchToRoom(roomId);
            return;
        }

        try {
            const notificationKey = Buffer.alloc(32) as NotificationKey;
            notificationKey.write(roomName, 'utf-8');

            const room: ChatRoom = {
                id: roomId,
                name: roomName,
                notificationKey,
                messages: [],
                unreadCount: 0,
                subscription: null,
                isProcessingMessages: false
            };

            this.rooms.set(roomId, room);
            await this.startRoomSubscription(roomId);
            this.switchToRoom(roomId);
            this.contentAreaView.updateRoomList(Array.from(this.rooms.values()));
        } catch (error) {
            logger.error(`Chat: Error joining room ${roomName}: ${error}`);
            this.contentAreaView.showError(`Failed to join room "${roomName}". Please try again.`);
        }
    }

    leaveRoom(roomId: string): void {
        const room = this.rooms.get(roomId);
        if (!room) return;

        this.stopRoomSubscription(roomId);
        this.rooms.delete(roomId);

        if (this.activeRoomId === roomId) {
            const remainingRooms = Array.from(this.rooms.keys());
            this.activeRoomId = remainingRooms.length > 0 ? remainingRooms[0] : null;
        }

        this.contentAreaView.updateRoomList(Array.from(this.rooms.values()));
        if (this.activeRoomId) {
            this.contentAreaView.updateMessages(this.rooms.get(this.activeRoomId)?.messages || []);
        } else {
            this.contentAreaView.updateMessages([]);
        }
    }

    switchToRoom(roomId: string): void {
        const room = this.rooms.get(roomId);
        if (!room) return;

        this.activeRoomId = roomId;
        room.unreadCount = 0;
        this.contentAreaView.updateMessages(room.messages);
        this.contentAreaView.updateActiveRoom(roomId);
        this.contentAreaView.updateRoomList(Array.from(this.rooms.values()));
    }

    getActiveRoom(): ChatRoom | null {
        return this.activeRoomId ? this.rooms.get(this.activeRoomId) || null : null;
    }

    private async startRoomSubscription(roomId: string): Promise<void> {
        const room = this.rooms.get(roomId);
        if (!room || room.subscription || room.isProcessingMessages) {
            return;
        }

        logger.trace(`Chat: Starting subscription for room ${roomId} with key: ${room.notificationKey.toString('hex')}`);
        
        try {
            // Get existing cubes from local store
            const existingCubes: AsyncGenerator<Cube> = 
                this.cubeStore.getNotifications(room.notificationKey, { format: RetrievalFormat.Cube }) as AsyncGenerator<Cube>;
            
            // Subscribe to future cubes via network (with proper type checking)
            if ('subscribeNotifications' in this.cubeRetriever) {
                const futureCubes: AsyncGenerator<Cube> = 
                    (this.cubeRetriever as CubeRetriever).subscribeNotifications(room.notificationKey, { format: RetrievalFormat.Cube });
                
                // Merge both streams
                room.subscription = mergeAsyncGenerators(existingCubes, futureCubes);
            } else {
                // Fallback to existing cubes only if subscription is not available
                room.subscription = mergeAsyncGenerators(existingCubes);
            }
            
            // Start processing messages for this room
            this.processRoomMessageStream(roomId);
        } catch (error) {
            logger.error(`Chat: Error starting subscription for room ${roomId}: ${error}`);
            this.contentAreaView.showError(`Failed to start real-time updates for room "${room.name}".`);
        }
    }

    private stopRoomSubscription(roomId: string): void {
        const room = this.rooms.get(roomId);
        if (!room) return;

        if (room.subscription) {
            logger.trace(`Chat: Stopping subscription for room ${roomId}`);
            room.subscription.return(undefined);
            room.subscription = null;
        }
        room.isProcessingMessages = false;
    }

    private async processRoomMessageStream(roomId: string): Promise<void> {
        const room = this.rooms.get(roomId);
        if (!room || !room.subscription || room.isProcessingMessages) {
            return;
        }

        room.isProcessingMessages = true;

        try {
            for await (const cube of room.subscription) {
                try {
                    if (!cube) continue;
                    
                    const cciCube: cciCube = cube as cciCube;
                    const { username, message } = ChatApplication.parseChatCube(cciCube);
                    const newMessage = { 
                        username, 
                        message, 
                        timestamp: new Date(cciCube.getDate() * 1000) 
                    };
                    
                    // Add to room's messages array (keeping sorted by timestamp)
                    room.messages.push(newMessage);
                    room.messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
                    
                    // Update unread count if this isn't the active room
                    if (this.activeRoomId !== roomId) {
                        room.unreadCount++;
                    }
                    
                    // Update the UI
                    if (this.activeRoomId === roomId) {
                        this.contentAreaView.updateMessages([...room.messages]);
                    }
                    this.contentAreaView.updateRoomList(Array.from(this.rooms.values()));
                } catch (error) {
                    logger.warn(`Chat: Error parsing chat cube for room ${roomId}: ${error}`);
                }
            }
        } catch (error) {
            logger.error(`Chat: Error processing message stream for room ${roomId}: ${error}`);
        } finally {
            room.isProcessingMessages = false;
        }
    }

    setUsername(username: string): void {
        this.username = username || "Anonymous";
        logger.trace(`Chat: Username set to ${this.username}`);
    }

    async sendMessage(username: string, message: string): Promise<void> {
        const activeRoom = this.getActiveRoom();
        if (!activeRoom) {
            this.contentAreaView.showError("Please join a room first.");
            return;
        }

        if (!message.trim()) {
            return;
        }

        try {
            const chatCube = await ChatApplication.createChatCube(username, message.trim(), activeRoom.notificationKey);
            await this.cubeStore.addCube(chatCube);
            // No need to manually update messages - the subscription will handle it automatically
        } catch (error) {
            logger.error(`Chat: Error sending message: ${error}`);
            this.contentAreaView.showError("Failed to send message. Please try again.");
        }
    }

    async close(unshow?: boolean, callback?: boolean): Promise<void> {
        // Stop all room subscriptions
        for (const roomId of this.rooms.keys()) {
            this.stopRoomSubscription(roomId);
        }
        this.rooms.clear();
        this.activeRoomId = null;
        return super.close(unshow, callback);
    }
}

