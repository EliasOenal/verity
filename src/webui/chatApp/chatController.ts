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
import { ChatStorage, StoredChatRoom } from "./chatStorage";

export interface ChatRoom {
    id: string;
    name: string;
    notificationKey: NotificationKey;
    messages: Array<{ username: string, message: string, timestamp: Date, cubeKey?: string }>;
    unreadCount: number;
    subscription: MergedAsyncGenerator<Cube> | null;
    isProcessingMessages: boolean;
    processedCubeKeys: Set<string>; // Track processed cube keys to avoid duplicates
    seenCubeKeys: Set<string>; // Track which messages have been seen by the user
    lastSeenTimestamp: number; // Track when the room was last viewed
}

export class ChatController extends VerityController {
    declare public contentAreaView: ChatView;
    private username: string = '';
    private rooms: Map<string, ChatRoom> = new Map();
    private activeRoomId: string | null = null;
    private storage: ChatStorage;

    constructor(parent: ControllerContext) {
        super(parent);
        this.contentAreaView = new ChatView(this);
        this.storage = new ChatStorage();
    }

    async showChatApp(): Promise<void> {
        this.contentAreaView.render();
        const contentArea = document.getElementById('verityContentArea');
        if (contentArea) {
            contentArea.innerHTML = '';
            contentArea.appendChild(this.contentAreaView.renderedView);
            
            // Permanently hide the back button - it's not needed for chat navigation
            const backArea = document.getElementById("verityBackArea");
            if (backArea) {
                backArea.style.display = "none";
                backArea.style.visibility = "hidden";
            }
            
            // Load persisted data
            await this.loadPersistedData();
        } else {
            logger.error('Chat: Content area not found');
        }
    }

    async joinRoom(roomName: string): Promise<void> {
        // Allow empty strings and whitespace room names
        // Use a special identifier for empty room names to distinguish them
        const roomId = roomName === '' ? '__empty__' : roomName.toLowerCase();
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
                isProcessingMessages: false,
                processedCubeKeys: new Set<string>(),
                seenCubeKeys: new Set<string>(),
                lastSeenTimestamp: Date.now()
            };

            this.rooms.set(roomId, room);
            await this.startRoomSubscription(roomId);
            this.switchToRoom(roomId);
            this.contentAreaView.updateRoomList(Array.from(this.rooms.values()));
            
            // Save to storage
            await this.saveRoomsToStorage();
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
        
        // Save to storage
        this.saveRoomsToStorage().catch(error => {
            logger.error(`Chat: Error saving rooms to storage: ${error}`);
        });
    }

    switchToRoom(roomId: string): void {
        const room = this.rooms.get(roomId);
        if (!room) return;

        this.activeRoomId = roomId;
        room.unreadCount = 0;
        room.lastSeenTimestamp = Date.now();
        
        // Mark all current messages as seen
        for (const message of room.messages) {
            if (message.cubeKey) {
                room.seenCubeKeys.add(message.cubeKey);
            }
        }
        
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
            // First, load historical messages from local store
            await this.loadHistoricalMessages(roomId);
            
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
                    
                    const cubeKey = cube.getKey().toString('hex');
                    
                    // Skip if we've already processed this cube
                    if (room.processedCubeKeys.has(cubeKey)) {
                        continue;
                    }
                    
                    const cciCube: cciCube = cube as cciCube;
                    const { username, message } = ChatApplication.parseChatCube(cciCube);
                    const newMessage = { 
                        username, 
                        message, 
                        timestamp: new Date(cciCube.getDate() * 1000),
                        cubeKey
                    };
                    
                    // Mark this cube as processed
                    room.processedCubeKeys.add(cubeKey);
                    
                    // Add to room's messages array (keeping sorted by timestamp)
                    room.messages.push(newMessage);
                    room.messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
                    
                    // Only increment unread count for truly new messages (not historical ones)
                    // and only if this isn't the active room
                    const isNewMessage = newMessage.timestamp.getTime() > room.lastSeenTimestamp;
                    if (this.activeRoomId !== roomId && isNewMessage && !room.seenCubeKeys.has(cubeKey)) {
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
        
        // Save to storage
        this.storage.saveUsername(this.username).catch(error => {
            logger.error(`Chat: Error saving username to storage: ${error}`);
        });
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

    private async loadPersistedData(): Promise<void> {
        try {
            await this.storage.waitForReady();
            const settings = await this.storage.loadSettings();
            
            // Restore username
            this.username = settings.username;
            this.contentAreaView.setUsername(this.username);
            
            // Restore rooms
            for (const storedRoom of settings.joinedRooms) {
                const notificationKey = ChatStorage.hexToNotificationKey(storedRoom.notificationKey);
                const room: ChatRoom = {
                    id: storedRoom.id,
                    name: storedRoom.name,
                    notificationKey,
                    messages: [],
                    unreadCount: 0,
                    subscription: null,
                    isProcessingMessages: false,
                    processedCubeKeys: new Set<string>(),
                    seenCubeKeys: new Set<string>(),
                    lastSeenTimestamp: Date.now()
                };
                
                this.rooms.set(storedRoom.id, room);
                await this.startRoomSubscription(storedRoom.id);
            }
            
            // Switch to first room if any
            if (this.rooms.size > 0) {
                const firstRoomId = Array.from(this.rooms.keys())[0];
                this.switchToRoom(firstRoomId);
            }
            
            this.contentAreaView.updateRoomList(Array.from(this.rooms.values()));
            logger.trace('Chat: Persisted data loaded successfully');
        } catch (error) {
            logger.error(`Chat: Error loading persisted data: ${error}`);
        }
    }

    private async saveRoomsToStorage(): Promise<void> {
        try {
            const storedRooms: StoredChatRoom[] = Array.from(this.rooms.values()).map(room => ({
                id: room.id,
                name: room.name,
                notificationKey: ChatStorage.notificationKeyToHex(room.notificationKey)
            }));
            
            await this.storage.saveJoinedRooms(storedRooms);
        } catch (error) {
            logger.error(`Chat: Error saving rooms to storage: ${error}`);
        }
    }

    private async loadHistoricalMessages(roomId: string): Promise<void> {
        const room = this.rooms.get(roomId);
        if (!room) return;

        try {
            logger.trace(`Chat: Loading historical messages for room ${roomId}`);
            
            // Get recent messages from the store (limit to last 100)
            const historicalCubes: AsyncGenerator<Cube> = 
                this.cubeStore.getNotifications(room.notificationKey, { 
                    format: RetrievalFormat.Cube,
                    limit: 100 
                }) as AsyncGenerator<Cube>;
            
            const messages: Array<{ username: string, message: string, timestamp: Date, cubeKey: string }> = [];
            
            for await (const cube of historicalCubes) {
                try {
                    if (!cube) continue;
                    
                    const cubeKey = cube.getKey().toString('hex');
                    
                    // Skip if we've already processed this cube
                    if (room.processedCubeKeys.has(cubeKey)) {
                        continue;
                    }
                    
                    const cciCube: cciCube = cube as cciCube;
                    const { username, message } = ChatApplication.parseChatCube(cciCube);
                    const newMessage = { 
                        username, 
                        message, 
                        timestamp: new Date(cciCube.getDate() * 1000),
                        cubeKey
                    };
                    
                    // Mark this cube as processed to avoid future duplicates
                    room.processedCubeKeys.add(cubeKey);
                    
                    // Mark historical messages as seen (they don't count as new)
                    room.seenCubeKeys.add(cubeKey);
                    
                    messages.push(newMessage);
                } catch (error) {
                    logger.warn(`Chat: Error parsing historical chat cube for room ${roomId}: ${error}`);
                }
            }
            
            // Sort messages by timestamp
            messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
            room.messages = messages;
            
            // Clean up old seen message tracking
            this.cleanupOldSeenMessages(roomId);
            
            // Update UI if this is the active room
            if (this.activeRoomId === roomId) {
                this.contentAreaView.updateMessages([...room.messages]);
            }
            
            logger.trace(`Chat: Loaded ${messages.length} historical messages for room ${roomId}`);
        } catch (error) {
            logger.error(`Chat: Error loading historical messages for room ${roomId}: ${error}`);
        }
    }

    private cleanupOldSeenMessages(roomId: string): void {
        const room = this.rooms.get(roomId);
        if (!room) return;

        // Get cube keys from current messages
        const currentCubeKeys = new Set(
            room.messages
                .map(m => m.cubeKey)
                .filter(key => key !== undefined)
        );

        // Remove seen cube keys that are no longer in current messages
        const seenKeysToKeep = new Set<string>();
        for (const seenKey of room.seenCubeKeys) {
            if (currentCubeKeys.has(seenKey)) {
                seenKeysToKeep.add(seenKey);
            }
        }
        room.seenCubeKeys = seenKeysToKeep;

        // Also clean up processed cube keys
        const processedKeysToKeep = new Set<string>();
        for (const processedKey of room.processedCubeKeys) {
            if (currentCubeKeys.has(processedKey)) {
                processedKeysToKeep.add(processedKey);
            }
        }
        room.processedCubeKeys = processedKeysToKeep;
    }
}

