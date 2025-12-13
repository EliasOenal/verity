import { LevelBackend, LevelBackendOptions, Sublevels } from "../../core/cube/levelBackend";
import { logger } from "../../core/logger";
import { Buffer } from "buffer";
import { NotificationKey } from "../../core/cube/coreCube.definitions";

export interface StoredChatRoom {
    id: string;
    name: string;
    notificationKey: string; // hex string for storage
}

export interface ChatSettings {
    username: string;
    joinedRooms: StoredChatRoom[];
}

export class ChatStorage {
    private backend: LevelBackend;
    private ready: Promise<void>;

    constructor() {
        const options: LevelBackendOptions = {
            dbName: 'verity-chat',
            dbVersion: 1,
            inMemoryLevelDB: false
        };

        this.backend = new LevelBackend(options);
        this.ready = this.backend.ready;
    }

    async waitForReady(): Promise<void> {
        await this.ready;
    }

    async saveSettings(settings: ChatSettings): Promise<void> {
        try {
            await this.ready;
            const settingsKey = Buffer.from('chat-settings', 'utf-8');
            const settingsData = Buffer.from(JSON.stringify(settings), 'utf-8');
            await this.backend.store(Sublevels.BASE_DB, settingsKey, settingsData);
            logger.trace('ChatStorage: Settings saved');
        } catch (error) {
            logger.error(`ChatStorage: Error saving settings: ${error}`);
            throw error;
        }
    }

    async loadSettings(): Promise<ChatSettings> {
        try {
            await this.ready;
            const settingsKey = Buffer.from('chat-settings', 'utf-8');
            const settingsData = await this.backend.get(Sublevels.BASE_DB, settingsKey);
            const settings = JSON.parse(settingsData.toString('utf-8')) as ChatSettings;
            logger.trace('ChatStorage: Settings loaded');
            return settings;
        } catch (error) {
            // Return default settings if not found or error
            logger.trace('ChatStorage: No saved settings found, using defaults');
            return {
                username: 'Anonymous',
                joinedRooms: []
            };
        }
    }

    async saveJoinedRooms(rooms: StoredChatRoom[]): Promise<void> {
        try {
            const settings = await this.loadSettings();
            settings.joinedRooms = rooms;
            await this.saveSettings(settings);
        } catch (error) {
            logger.error(`ChatStorage: Error saving joined rooms: ${error}`);
            throw error;
        }
    }

    async saveUsername(username: string): Promise<void> {
        try {
            const settings = await this.loadSettings();
            settings.username = username;
            await this.saveSettings(settings);
        } catch (error) {
            logger.error(`ChatStorage: Error saving username: ${error}`);
            throw error;
        }
    }

    static notificationKeyToHex(key: NotificationKey): string {
        return key.toString('hex');
    }

    static hexToNotificationKey(hex: string): NotificationKey {
        return Buffer.from(hex, 'hex') as NotificationKey;
    }
}