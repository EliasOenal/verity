import { VerityNode } from '../../../../src/cci/verityNode';
import { ChatApplication } from '../../../../src/app/chatApplication';
import { cciCube } from '../../../../src/cci/cube/cciCube';
import { RetrievalFormat } from '../../../../src/cci/veritum/veritum.definitions';
import { Cube } from '../../../../src/core/cube/cube';
import { CubeRetriever } from '../../../../src/core/networking/cubeRetrieval/cubeRetriever';
import { mergeAsyncGenerators, MergedAsyncGenerator } from '../../../../src/core/helpers/asyncGenerators';
import { NotificationKey } from '../../../../src/core/cube/cube.definitions';
import { ChatStorage, StoredChatRoom } from './chatStorage';
import { Buffer } from 'buffer';
import { logger } from '../../../../src/core/logger';

export interface LocalChatRoom { id:string; name:string; notificationKey:NotificationKey; messages:Array<{username:string;message:string;timestamp:Date;cubeKey?:string}>; unreadCount:number; subscription: MergedAsyncGenerator<Cube>|null; isProcessingMessages:boolean; processedCubeKeys:Set<string>; seenCubeKeys:Set<string>; lastSeenTimestamp:number; hasLoadedLocalHistory:boolean; subscriptionStartedAt?:number; }

export class LocalChatController {
  private rooms = new Map<string, LocalChatRoom>();
  private activeRoomId: string|null = null;
  private username = 'Anonymous';
  private storage = new ChatStorage();
  private onlineListenerBound = false;
  private renewalTimer: NodeJS.Timeout|null = null;
  // UI callbacks (set by host UI controller)
  public onRoomsChanged: (()=>void)|null = null;
  public onMessagesChanged: ((roomId:string)=>void)|null = null;
  constructor(private node: VerityNode, private cubeRetriever: CubeRetriever, private cubeStore = node.cubeStore){
    this.startRenewalScheduler();
  }
  getActiveRoom(){ return this.activeRoomId? this.rooms.get(this.activeRoomId):null; }
  setUsername(name:string){ this.username = name || 'Anonymous'; this.storage.saveUsername(this.username).catch(()=>{}); }
  async joinRoom(roomName: string){
    const roomId = roomName===''? '__empty__': roomName.toLowerCase();
    if (this.rooms.has(roomId)){ this.switchToRoom(roomId); return; }
    const notificationKey = Buffer.alloc(32) as NotificationKey; notificationKey.write(roomName,'utf-8');
  const room:LocalChatRoom={id:roomId,name:roomName,notificationKey,messages:[] as LocalChatRoom['messages'],unreadCount:0,subscription:null,isProcessingMessages:false,processedCubeKeys:new Set(),seenCubeKeys:new Set(),lastSeenTimestamp:Date.now(),hasLoadedLocalHistory:false,subscriptionStartedAt:undefined};
    this.rooms.set(roomId,room);
    this.switchToRoom(roomId);
    this.onRoomsChanged?.();
    // If online, start live subscription (future) first to avoid gaps, then load local history once.
    if(this.node.networkManager.online){
      this.startRoomSubscription(roomId).catch(err=>logger.error('Chat: subscription error '+err));
      await this.loadHistoricalMessages(roomId);
    } else {
      // Offline: we can load local immediately (no gap risk) then defer subscription.
      await this.loadHistoricalMessages(roomId);
      this.bindOnlineListener();
    }
    await this.saveRooms();
  }
  leaveRoom(roomId:string){
    const room=this.rooms.get(roomId); if(!room) return;
    this.stopRoomSubscription(roomId);
    this.rooms.delete(roomId);
    if(this.activeRoomId===roomId){ const ids=[...this.rooms.keys()]; this.activeRoomId=ids.length? ids[0]:null; }
    // Persist updated room list
    this.saveRooms().catch(err=>logger.error('Chat: failed to persist rooms after leave '+err));
    this.onRoomsChanged?.();
    if(this.activeRoomId) this.onMessagesChanged?.(this.activeRoomId); else this.onMessagesChanged?.('');
  }
  switchToRoom(roomId:string){ const room=this.rooms.get(roomId); if(!room) return; this.activeRoomId=roomId; room.unreadCount=0; room.lastSeenTimestamp=Date.now(); for (const m of room.messages) if (m.cubeKey) room.seenCubeKeys.add(m.cubeKey); }
  async sendMessage(username:string,message:string){ const active=this.getActiveRoom(); if(!active|| !message.trim()) return; const chatCube = await ChatApplication.createChatCube(username,message.trim(),active.notificationKey); await this.cubeStore.addCube(chatCube); const cubeInfo = await chatCube.getCubeInfo(); this.node.networkManager.broadcastKey([cubeInfo]); }
  private async startRoomSubscription(roomId:string){ const room=this.rooms.get(roomId); if(!room||room.subscription||room.isProcessingMessages) return; let future: AsyncGenerator<Cube>|undefined; if('subscribeNotifications' in this.cubeRetriever){ future=(this.cubeRetriever as CubeRetriever).subscribeNotifications(room.notificationKey,{format:RetrievalFormat.Cube}); } const history:AsyncGenerator<Cube> = (this.cubeRetriever as CubeRetriever).getNotifications(room.notificationKey,{format:RetrievalFormat.Cube}) as AsyncGenerator<Cube>; room.subscription = future? mergeAsyncGenerators(future,history): mergeAsyncGenerators(history); room.subscriptionStartedAt=Date.now(); this.processRoomMessageStream(roomId); }
  private stopRoomSubscription(roomId:string){ const room=this.rooms.get(roomId); if(!room) return; if(room.subscription){ room.subscription.return(undefined); room.subscription=null; } room.isProcessingMessages=false; }
  private renewRoomSubscription(roomId:string){ const room=this.rooms.get(roomId); if(!room) return; this.stopRoomSubscription(roomId); if(this.node.networkManager.online){ this.startRoomSubscription(roomId).catch(()=>{}); } }
  private async processRoomMessageStream(roomId:string){ const room=this.rooms.get(roomId); if(!room||!room.subscription||room.isProcessingMessages) return; room.isProcessingMessages=true; try { for await (const cube of room.subscription){ if(!cube) continue; if(await this.tryAddCubeToRoom(room,cube,true)){ if(this.activeRoomId===roomId) this.onMessagesChanged?.(roomId); else this.onRoomsChanged?.(); } } } catch(e){ logger.error('Chat stream error '+e); } finally { room.isProcessingMessages=false; }
  }
  // Attempt to parse and add a cube to room, returns true if message list changed
  private async tryAddCubeToRoom(room:LocalChatRoom,cube:Cube,live:boolean):Promise<boolean>{ try { const cubeKey=await cube.getKeyString(); if(room.processedCubeKeys.has(cubeKey)) return false; const parsed: cciCube = cube as cciCube; const {username,message}=ChatApplication.parseChatCube(parsed); const msg={username,message,timestamp:new Date(parsed.getDate()*1000),cubeKey}; room.processedCubeKeys.add(cubeKey); if(!live) room.seenCubeKeys.add(cubeKey); room.messages.push(msg); // insertion sort optimization: push then swap backwards if needed
    let i=room.messages.length-1; while(i>0 && room.messages[i-1].timestamp.getTime()>msg.timestamp.getTime()){ const tmp=room.messages[i-1]; room.messages[i-1]=room.messages[i]; room.messages[i]=tmp; i--; }
    const isNew=live && msg.timestamp.getTime()>room.lastSeenTimestamp && !room.seenCubeKeys.has(cubeKey);
    if(isNew && this.activeRoomId!==room.id) room.unreadCount++;
    return true; } catch(e){ logger.warn('Chat: failed to add cube '+e); return false; } }
  private async loadHistoricalMessages(roomId:string){ const room=this.rooms.get(roomId); if(!room || room.hasLoadedLocalHistory) return; try { const gen:AsyncGenerator<Cube>= this.cubeStore.getNotifications(room.notificationKey,{format:RetrievalFormat.Cube}) as AsyncGenerator<Cube>; for await (const cube of gen){ if(!cube) continue; await this.tryAddCubeToRoom(room,cube,false); } room.hasLoadedLocalHistory=true; if(this.activeRoomId===roomId) this.onMessagesChanged?.(roomId); } catch(e){ logger.error('Chat history error '+e); }
  }
  async loadPersisted(){ await this.storage.waitForReady(); const settings = await this.storage.loadSettings(); this.username=settings.username; for(const stored of settings.joinedRooms){ const notificationKey = ChatStorage.hexToNotificationKey(stored.notificationKey); const room:LocalChatRoom={id:stored.id,name:stored.name,notificationKey,messages:[] as LocalChatRoom['messages'],unreadCount:0,subscription:null,isProcessingMessages:false,processedCubeKeys:new Set(),seenCubeKeys:new Set(),lastSeenTimestamp:Date.now(),hasLoadedLocalHistory:false}; this.rooms.set(stored.id,room); }
  if(this.rooms.size){ this.activeRoomId=[...this.rooms.keys()][0]; }
  // Always pre-populate rooms from local store; start subscriptions only if online.
  for(const id of this.rooms.keys()){
    await this.loadHistoricalMessages(id);
  }
  if(this.node.networkManager.online){
  for(const id of this.rooms.keys()) this.startRoomSubscription(id).catch(()=>{});
  } else {
    this.bindOnlineListener();
  }
  // First-run default room logic: only if user truly has no rooms stored and flag not set
  if(!settings.firstRunDone && this.rooms.size===0){
    await this.joinRoom('Verity Chat');
    // mark first run done (avoid recursion by direct storage call)
    try {
      const updated={...settings,firstRunDone:true,joinedRooms:[...this.rooms.values()].map(r=>({id:r.id,name:r.name,notificationKey:ChatStorage.notificationKeyToHex(r.notificationKey)}))};
      await this.storage.saveSettings(updated);
    } catch{}
  }
  this.onRoomsChanged?.(); if(this.activeRoomId) this.onMessagesChanged?.(this.activeRoomId);
  }
  private bindOnlineListener(){
    if(this.onlineListenerBound) return;
    this.onlineListenerBound=true;
  this.node.networkManager.once?.('online',()=>{
      // Re-trigger historical loads + subscriptions now that network is available.
      (async()=>{
    for (const id of this.rooms.keys()) { this.startRoomSubscription(id).catch(()=>{}); await this.loadHistoricalMessages(id); }
        // Update UI after bulk refresh
        this.onRoomsChanged?.();
        if(this.activeRoomId) this.onMessagesChanged?.(this.activeRoomId);
      })().catch(e=>logger.error('Chat: online refresh error '+e));
    });
    // Also listen for newly learned peers to opportunistically hydrate rooms that may
    // have been joined while network was sparse. We do this with a lightweight throttle.
    let peerHydrateScheduled = false;
    const scheduleHydrate = () => {
      if(peerHydrateScheduled) return; peerHydrateScheduled=true;
      setTimeout(async ()=>{
        peerHydrateScheduled=false;
        if(!this.node.networkManager.online) return;
  for(const [id,room] of this.rooms){ if(!room.subscription) this.startRoomSubscription(id).catch(()=>{}); await this.loadHistoricalMessages(id); }
        this.onRoomsChanged?.(); if(this.activeRoomId) this.onMessagesChanged?.(this.activeRoomId);
      }, 500); // debounce multiple rapid newpeer events
    };
    this.node.networkManager.on?.('newpeer', scheduleHydrate);
  }
  private startRenewalScheduler(){
    if(this.renewalTimer) return;
    const CHECK_INTERVAL_MS = 60_000; // every minute
    const RENEW_AFTER_MS = 3 * 60_000; // 3 minutes
    this.renewalTimer = setInterval(()=>{
      const now=Date.now();
      for(const [id,room] of this.rooms){
        if(room.subscription && room.subscriptionStartedAt && now-room.subscriptionStartedAt>=RENEW_AFTER_MS){
          this.renewRoomSubscription(id);
        }
      }
    }, CHECK_INTERVAL_MS);
  }
  private async saveRooms(){ const stored:StoredChatRoom[]=[...this.rooms.values()].map(r=>({id:r.id,name:r.name,notificationKey:ChatStorage.notificationKeyToHex(r.notificationKey)})); await this.storage.saveJoinedRooms(stored); }
  getRooms(){ return [...this.rooms.values()]; }
  getUsername(){ return this.username; }
}
