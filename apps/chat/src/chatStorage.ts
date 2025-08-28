import {
  LevelBackend,
  LevelBackendOptions,
  Sublevels,
} from "../../../src/core/cube/levelBackend";
import { Buffer } from "buffer";
import { NotificationKey } from "../../../src/core/cube/cube.definitions";

export interface StoredChatRoom {
  id: string;
  name: string;
  notificationKey: string;
}
export interface ChatSettings {
  username: string;
  joinedRooms: StoredChatRoom[];
  firstRunDone?: boolean;
}

export class ChatStorage {
  private backend: LevelBackend;
  private ready: Promise<void>;

  constructor() {
    const options: LevelBackendOptions = {
      dbName: "verity-chat",
      dbVersion: 1,
      inMemoryLevelDB: false,
    };
    // LevelBackend is the same abstraction Verity core uses for cube persistence (LevelDB in Node / IndexedDB in browser).
    // We create a dedicated logical DB for chat UI prefs so they remain separate from core cube indices.
    this.backend = new LevelBackend(options);
    this.ready = this.backend.ready;
  }

  async waitForReady() {
    await this.ready;
  }

  async saveSettings(settings: ChatSettings) {
    await this.ready;
    const key = Buffer.from("chat-settings", "utf-8");
    const data = Buffer.from(JSON.stringify(settings), "utf-8");
    await this.backend.store(Sublevels.BASE_DB, key, data);
  }

  async loadSettings(): Promise<ChatSettings> {
    try {
      await this.ready;
      const key = Buffer.from("chat-settings", "utf-8");
      const data = await this.backend.get(Sublevels.BASE_DB, key);
      return JSON.parse(data.toString("utf-8")) as ChatSettings;
    } catch {
      return { username: "Anonymous", joinedRooms: [], firstRunDone: false };
    }
  }

  async saveJoinedRooms(rooms: StoredChatRoom[]) {
    const s = await this.loadSettings();
    s.joinedRooms = rooms;
    await this.saveSettings(s);
  }

  async saveUsername(username: string) {
    const s = await this.loadSettings();
    s.username = username;
    await this.saveSettings(s);
  }

  static notificationKeyToHex(key: NotificationKey) {
    return key.toString("hex");
  }
  static hexToNotificationKey(hex: string) {
    return Buffer.from(hex, "hex") as NotificationKey;
  }
}
