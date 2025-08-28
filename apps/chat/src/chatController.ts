import { VerityNode } from "../../../src/cci/verityNode";
import { cciCube } from "../../../src/cci/cube/cciCube";
import { createChatCube, parseChatCube } from "./chatHelpers";
import { RetrievalFormat } from "../../../src/cci/veritum/veritum.definitions";
import { Cube } from "../../../src/core/cube/cube";
import { CubeRetriever } from "../../../src/core/networking/cubeRetrieval/cubeRetriever";
import {
  mergeAsyncGenerators,
  MergedAsyncGenerator,
} from "../../../src/core/helpers/asyncGenerators";
import { NotificationKey } from "../../../src/core/cube/cube.definitions";
import { ChatStorage, StoredChatRoom } from "./chatStorage";
import { Buffer } from "buffer";
import { logger } from "../../../src/core/logger";

// LocalChatRoom keeps all UI‑relevant state for a room in one object so the
// controller stays simple and the view can diff easily.
export interface ChatRoom {
  id: string;
  name: string;
  notificationKey: NotificationKey;
  messages: Array<{
    username: string;
    message: string;
    timestamp: Date;
    cubeKey?: string;
  }>;
  unreadCount: number;
  subscription: MergedAsyncGenerator<Cube> | null;
  isProcessingMessages: boolean;
  processedCubeKeys: Set<string>; // guards against duplicate cubes
  seenCubeKeys: Set<string>; // cubes already considered "read"
  lastSeenTimestamp: number; // used for unread calculation
  hasLoadedLocalHistory: boolean; // ensures we only hydrate once per room
  subscriptionStartedAt?: number; // for periodic renewal
}

export class ChatController {
  private rooms = new Map<string, ChatRoom>();
  private activeRoomId: string | null = null;
  private username = "Anonymous";
  private storage = new ChatStorage();
  private onlineListenerBound = false;
  private renewalTimer: NodeJS.Timeout | null = null;
  // UI callbacks (set by host UI controller)
  public onRoomsChanged: (() => void) | null = null;
  public onMessagesChanged: ((roomId: string) => void) | null = null;
  constructor(
    private node: VerityNode,
    private cubeRetriever: CubeRetriever,
    // cubeStore (from VerityNode) persists and indexes cubes locally. We rely on it for:
    // - adding newly authored chat message cubes to be cached until they can enter the network
    // - enumerating historical message cubes without network when cached
    private cubeStore = node.cubeStore
  ) {
    this.startRenewalScheduler();
  }
  getActiveRoom() {
    return this.activeRoomId ? this.rooms.get(this.activeRoomId) : null;
  }
  setUsername(name: string) {
    this.username = name || "Anonymous";
    this.storage.saveUsername(this.username).catch(() => {});
  }
  // Join (or switch to) a room. We intentionally start the live subscription
  // BEFORE loading local history (when online) to reduce potential gaps.
  async joinRoom(roomName: string) {
    const roomId = roomName === "" ? "__empty__" : roomName.toLowerCase();
    if (this.rooms.has(roomId)) {
      this.switchToRoom(roomId);
      return;
    }

    // Derive a notification key (32 bytes) from the room name.
    const notificationKey = Buffer.alloc(32) as NotificationKey;
    notificationKey.write(roomName, "utf-8");

    const room: ChatRoom = {
      id: roomId,
      name: roomName,
      notificationKey,
      messages: [],
      unreadCount: 0,
      subscription: null,
      isProcessingMessages: false,
      processedCubeKeys: new Set(),
      seenCubeKeys: new Set(),
      lastSeenTimestamp: Date.now(),
      hasLoadedLocalHistory: false,
      subscriptionStartedAt: undefined,
    };
    this.rooms.set(roomId, room);
    this.switchToRoom(roomId);
    this.onRoomsChanged?.();

    if (this.node.networkManager.online) {
      this.startRoomSubscription(roomId).catch((err) =>
        logger.error("Chat: subscription error " + err)
      );
      await this.loadHistoricalMessages(roomId);
    } else {
      await this.loadHistoricalMessages(roomId); // safe offline first
      this.bindOnlineListener();
    }
    await this.saveRooms();
  }
  leaveRoom(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.stopRoomSubscription(roomId);
    this.rooms.delete(roomId);
    if (this.activeRoomId === roomId) {
      const ids = [...this.rooms.keys()];
      this.activeRoomId = ids.length ? ids[0] : null;
    }
    this.saveRooms().catch((err) =>
      logger.error("Chat: failed to persist rooms after leave " + err)
    );
    this.onRoomsChanged?.();
    this.onMessagesChanged?.(this.activeRoomId || "");
  }
  switchToRoom(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.activeRoomId = roomId;
    room.unreadCount = 0; // user viewed room, reset unread
    room.lastSeenTimestamp = Date.now();
    // Mark all currently loaded messages as seen
    for (const m of room.messages)
      if (m.cubeKey) room.seenCubeKeys.add(m.cubeKey);
  }
  async sendMessage(username: string, message: string) {
    const active = this.getActiveRoom();
    if (!active || !message.trim()) return;
    // Build a cciCube representing the chat message.
    // createChatCube sets: NOTIFY field (room key), APPLICATION ("chat"), USERNAME, PAYLOAD.
    // The cube is FROZEN_NOTIFY so it's immutable and carries a notification indexable by network peers.
    const chatCube = await createChatCube(
      username,
      message.trim(),
      active.notificationKey
    );
    // Persist locally (returns once the cube is stored & indexed). If already present it's idempotent.
    await this.cubeStore.addCube(chatCube);
    const cubeInfo = await chatCube.getCubeInfo();
    // Broadcast cube key so connected peers know a new cube exists and can fetch it if they want.
    this.node.networkManager.broadcastKey([cubeInfo]);
  }
  private async startRoomSubscription(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room || room.subscription || room.isProcessingMessages) return;
    // "future" = live push stream (network subscription) for notification key.
    let future: AsyncGenerator<Cube> | undefined;
    if ("subscribeNotifications" in this.cubeRetriever) {
      future = (this.cubeRetriever as CubeRetriever).subscribeNotifications(
        room.notificationKey,
        { format: RetrievalFormat.Cube }
      );
    }
    // "history" = on-demand pull of already existing notification cubes (locally cached or fetched from peers).
    const history = (this.cubeRetriever as CubeRetriever).getNotifications(
      room.notificationKey,
      { format: RetrievalFormat.Cube }
    ) as AsyncGenerator<Cube>;
    // Merge history and future subscriptions
    room.subscription = future
      ? mergeAsyncGenerators(future, history)
      : mergeAsyncGenerators(history);
    room.subscriptionStartedAt = Date.now();
    this.processRoomMessageStream(roomId);
  }
  private stopRoomSubscription(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    if (room.subscription) {
      room.subscription.return(undefined);
      room.subscription = null;
    }
    room.isProcessingMessages = false;
  }
  private renewRoomSubscription(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.stopRoomSubscription(roomId);
    if (this.node.networkManager.online) {
      this.startRoomSubscription(roomId).catch(() => {});
    }
  }
  private async processRoomMessageStream(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room || !room.subscription || room.isProcessingMessages) return;
    room.isProcessingMessages = true;
    try {
      for await (const cube of room.subscription) {
        if (!cube) continue;
        const added = await this.tryAddCubeToRoom(room, cube, true);
        if (added) {
          if (this.activeRoomId === roomId) this.onMessagesChanged?.(roomId);
          else this.onRoomsChanged?.();
        }
      }
    } catch (e) {
      logger.error("Chat stream error " + e);
    }
    room.isProcessingMessages = false;
  }
  // Attempt to parse and add a cube to room, returns true if message list changed
  private async tryAddCubeToRoom(room: ChatRoom, cube: Cube, live: boolean) {
    try {
      const cubeKey = await cube.getKeyString();
      if (room.processedCubeKeys.has(cubeKey)) return false;
      const parsed = cube as cciCube;
      // parseChatCube validates cube type + application field and extracts username/message.
      // If validation fails we silently skip (prevents foreign or malformed cubes from polluting UI).
      const { username, message } = parseChatCube(parsed);
      const msg = {
        username,
        message,
        timestamp: new Date(parsed.getDate() * 1000),
        cubeKey,
      };
      room.processedCubeKeys.add(cubeKey);
      if (!live) room.seenCubeKeys.add(cubeKey);
      room.messages.push(msg);
      // insertion sort swap backwards (messages usually near-sorted)
      let i = room.messages.length - 1;
      while (
        i > 0 &&
        room.messages[i - 1].timestamp.getTime() > msg.timestamp.getTime()
      ) {
        const tmp = room.messages[i - 1];
        room.messages[i - 1] = room.messages[i];
        room.messages[i] = tmp;
        i--;
      }
      const isNew =
        live &&
        msg.timestamp.getTime() > room.lastSeenTimestamp &&
        !room.seenCubeKeys.has(cubeKey);
      if (isNew && this.activeRoomId !== room.id) room.unreadCount++;
      return true;
    } catch (e) {
      logger.warn("Chat: failed to add cube " + e);
      return false;
    }
  }
  private async loadHistoricalMessages(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room || room.hasLoadedLocalHistory) return;
    try {
      const gen = this.cubeStore.getNotifications(room.notificationKey, {
        format: RetrievalFormat.Cube,
      }) as AsyncGenerator<Cube>;
      for await (const cube of gen) {
        if (!cube) continue;
        await this.tryAddCubeToRoom(room, cube, false);
      }
      room.hasLoadedLocalHistory = true;
      if (this.activeRoomId === roomId) this.onMessagesChanged?.(roomId);
    } catch (e) {
      logger.error("Chat history error " + e);
    }
  }
  // Load persisted username + room list, hydrate local history, then (if online)
  // start live subscriptions. Also handles first‑run default room creation.
  async loadPersisted() {
    await this.storage.waitForReady();
    const settings = await this.storage.loadSettings();
    this.username = settings.username;
    for (const stored of settings.joinedRooms) {
      const notificationKey = ChatStorage.hexToNotificationKey(
        stored.notificationKey
      );
      const room: ChatRoom = {
        id: stored.id,
        name: stored.name,
        notificationKey,
        messages: [],
        unreadCount: 0,
        subscription: null,
        isProcessingMessages: false,
        processedCubeKeys: new Set(),
        seenCubeKeys: new Set(),
        lastSeenTimestamp: Date.now(),
        hasLoadedLocalHistory: false,
      };
      this.rooms.set(stored.id, room);
    }
    if (this.rooms.size) this.activeRoomId = [...this.rooms.keys()][0];
    for (const id of this.rooms.keys()) await this.loadHistoricalMessages(id);
    if (this.node.networkManager.online)
      for (const id of this.rooms.keys())
        this.startRoomSubscription(id).catch(() => {});
    else this.bindOnlineListener();
    if (!settings.firstRunDone && this.rooms.size === 0) {
      await this.joinRoom("Verity Chat");
      try {
        const updated = {
          ...settings,
          firstRunDone: true,
          joinedRooms: [...this.rooms.values()].map((r) => ({
            id: r.id,
            name: r.name,
            notificationKey: ChatStorage.notificationKeyToHex(
              r.notificationKey
            ),
          })),
        };
        await this.storage.saveSettings(updated);
      } catch {}
    }
    this.onRoomsChanged?.();
    if (this.activeRoomId) this.onMessagesChanged?.(this.activeRoomId);
  }
  private bindOnlineListener() {
    if (this.onlineListenerBound) return;
    this.onlineListenerBound = true;
    // One‑time full hydration when we first come online
    this.node.networkManager.once?.("online", () => {
      (async () => {
        for (const id of this.rooms.keys()) {
          this.startRoomSubscription(id).catch(() => {});
          await this.loadHistoricalMessages(id);
        }
        this.onRoomsChanged?.();
        if (this.activeRoomId) this.onMessagesChanged?.(this.activeRoomId);
      })().catch((e) => logger.error("Chat: online refresh error " + e));
    });
    // Lightweight debounce for peer events to (re)hydrate missing subs/history
    let scheduled = false;
    const hydrate = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(async () => {
        scheduled = false;
        if (!this.node.networkManager.online) return;
        for (const [id, room] of this.rooms) {
          if (!room.subscription)
            this.startRoomSubscription(id).catch(() => {});
          await this.loadHistoricalMessages(id);
        }
        this.onRoomsChanged?.();
        if (this.activeRoomId) this.onMessagesChanged?.(this.activeRoomId);
      }, 500);
    };
    this.node.networkManager.on?.("newpeer", hydrate);
  }
  private startRenewalScheduler() {
    if (this.renewalTimer) return;
    const CHECK_INTERVAL = 60_000; // check every minute
    const RENEW_AFTER = 3 * 60_000; // renew after 3 minutes
    this.renewalTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, room] of this.rooms) {
        if (
          room.subscription &&
          room.subscriptionStartedAt &&
          now - room.subscriptionStartedAt >= RENEW_AFTER
        ) {
          this.renewRoomSubscription(id);
        }
      }
    }, CHECK_INTERVAL);
  }
  private async saveRooms() {
    const stored: StoredChatRoom[] = [...this.rooms.values()].map((r) => ({
      id: r.id,
      name: r.name,
      notificationKey: ChatStorage.notificationKeyToHex(r.notificationKey),
    }));
    await this.storage.saveJoinedRooms(stored);
  }
  getRooms() {
    return [...this.rooms.values()];
  }
  getUsername() {
    return this.username;
  }
}
