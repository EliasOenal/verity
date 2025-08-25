import { LevelBackend, LevelBackendOptions, Sublevels } from '../../../../src/core/cube/levelBackend';
import { logger } from '../../../../src/core/logger';
import { Buffer } from 'buffer';
import { NotificationKey } from '../../../../src/core/cube/cube.definitions';

export interface StoredChatRoom { id:string; name:string; notificationKey:string; }
export interface ChatSettings { username:string; joinedRooms:StoredChatRoom[]; firstRunDone?:boolean; }

export class ChatStorage {
  private backend: LevelBackend;
  private ready: Promise<void>;
  constructor(){
    const options: LevelBackendOptions = { dbName:'verity-chat', dbVersion:1, inMemoryLevelDB:false };
    this.backend = new LevelBackend(options); this.ready = this.backend.ready; }
  async waitForReady(){ await this.ready; }
  async saveSettings(settings:ChatSettings){ await this.ready; const key=Buffer.from('chat-settings','utf-8'); const data=Buffer.from(JSON.stringify(settings),'utf-8'); await this.backend.store(Sublevels.BASE_DB,key,data); }
  async loadSettings():Promise<ChatSettings>{
    try {
      await this.ready; const key=Buffer.from('chat-settings','utf-8'); const data=await this.backend.get(Sublevels.BASE_DB,key);
      const parsed = JSON.parse(data.toString('utf-8')) as ChatSettings;
      return parsed;
    } catch {
      return {username:'Anonymous',joinedRooms:[],firstRunDone:false};
    }
  }
  async saveJoinedRooms(rooms:StoredChatRoom[]){ const s=await this.loadSettings(); s.joinedRooms=rooms; await this.saveSettings(s); }
  async saveUsername(username:string){ const s=await this.loadSettings(); s.username=username; await this.saveSettings(s); }
  static notificationKeyToHex(key:NotificationKey){ return key.toString('hex'); }
  static hexToNotificationKey(hex:string){ return Buffer.from(hex,'hex') as NotificationKey; }
}
