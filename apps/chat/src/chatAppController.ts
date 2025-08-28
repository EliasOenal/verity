import { logger } from "../../../src/core/logger";
import { ChatController } from "./chatController";
import { VerityNode } from "../../../src/cci/verityNode";

/**
 * Main controller for the standalone Verity Chat application.
 * This controller manages both the chat functionality and peer management
 * in a simplified interface.
 */
export class ChatAppController {
  private chatController: ChatController;
  private node: VerityNode;

  constructor(context: any) {
    this.node = context.node as VerityNode;
    // ChatController needs:
    // - the VerityNode: to broadcast cube keys and observe network online/offline events.
    // - cubeRetriever: abstraction that can pull history & subscribe to notification streams.
    //   (For a light node this goes out to the network; for local history it falls back to cubeStore.)
    this.chatController = new ChatController(
      this.node,
      this.node.cubeRetriever
    );
  }

  /**
   * Initialize the chat app with integrated peer management
   */
  async showChatApp(): Promise<void> {
    try {
      await this.chatController.loadPersisted?.();
      this.renderChatShell();
      const persistedName = this.chatController.getUsername();
      const unameInput = document.querySelector(
        "#userPanel .verityUsernameInput"
      ) as HTMLInputElement | null;
      if (unameInput && unameInput.value !== persistedName)
        unameInput.value = persistedName;
      this.setupPeerManagement();
      this.initializeShellInteractions();
      logger.info("Chat app initialized successfully");
    } catch (error) {
      logger.error(`Failed to initialize chat app: ${error}`);
    }
  }

  /**
   * Set up peer management in the dedicated panel
   */
  private setupPeerManagement(): void {
    const panel = document.getElementById("networkPanelContent");
    if (!panel) return;
    panel.innerHTML = "";
    const list = document.createElement("ul");
    list.className = "vc-peer-list-simple";
    panel.appendChild(list);
    const details = document.createElement("div");
    details.className = "vc-peer-details";
    details.hidden = true;
    panel.appendChild(details);
    let selectedPeer: string | null = null;
    const formatPeerDetails = (p: any) => {
      const lines: string[] = [];
      lines.push(
        `<div><strong>ID</strong>: <code>${
          p.idString || "unknown"
        }</code></div>`
      );
      if (p.remoteNodeType)
        lines.push(
          `<div><strong>Remote Type</strong>: ${p.remoteNodeType}</div>`
        );
      if (p.status != null)
        lines.push(`<div><strong>Status</strong>: ${p.status}</div>`);
      if (p.stats) {
        lines.push(
          `<div><strong>Tx</strong>: ${p.stats.tx.messages} msg / ${p.stats.tx.bytes} bytes</div>`
        );
        lines.push(
          `<div><strong>Rx</strong>: ${p.stats.rx.messages} msg / ${p.stats.rx.bytes} bytes</div>`
        );
      }
      if (p.options?.extraAddresses?.length) {
        lines.push("<div><strong>Addresses</strong>:</div>");
        lines.push(
          '<ul class="vc-peer-addr-list">' +
            p.options.extraAddresses
              .map(
                (a: any) =>
                  `<li>${
                    a.toString ? a.toString() : a.multiaddr || JSON.stringify(a)
                  }</li>`
              )
              .join("") +
            "</ul>"
        );
      }
      return `<div class="vc-peer-details-inner">${lines.join("")}</div>`;
    };
    const render = () => {
      list.innerHTML = "";
      // Access networkManager to visualise currently connected peers.
      const peers = [
        ...this.node.networkManager.incomingPeers,
        ...this.node.networkManager.outgoingPeers,
      ];
      if (!peers.length) {
        const empty = document.createElement("div");
        empty.className = "vc-empty-peers";
        empty.textContent = "No connected peers.";
        list.appendChild(empty);
        details.hidden = true;
        details.innerHTML = "";
        selectedPeer = null;
        return;
      }
      let stillSelected = false;
      for (const p of peers) {
        const li = document.createElement("li");
        li.className = "vc-peer-mini";
        const pid = p.idString || "";
        li.dataset.peerId = pid;
        li.textContent = pid.slice(0, 12) || "unknown";
        if (pid === selectedPeer) {
          li.classList.add("selected");
          details.hidden = false;
          details.innerHTML = formatPeerDetails(p);
          stillSelected = true;
        }
        li.addEventListener("click", () => {
          if (selectedPeer === pid) {
            // deselect
            selectedPeer = null;
            details.hidden = true;
            details.innerHTML = "";
            render();
            return;
          }
          selectedPeer = pid;
          details.hidden = false;
          details.innerHTML = formatPeerDetails(p);
          render();
        });
        list.appendChild(li);
      }
      if (selectedPeer && !stillSelected) {
        // previously selected peer disappeared
        selectedPeer = null;
        details.hidden = true;
        details.innerHTML = "";
      }
    };
    render();
    setInterval(render, 2000);
    // online status
    const statusEl =
      document.getElementById("onlineStatusArea") ||
      document.getElementById("verityOnlineStatusArea");
    if (statusEl) {
      const upd = () => {
        // networkManager.online reflects whether at least one transport is active.
        statusEl.textContent = this.node.networkManager.online
          ? "Online"
          : "Offline";
        statusEl.style.display = "inline-flex";
      };
      this.node.networkManager.on("online", upd);
      this.node.networkManager.on("offline", upd);
      upd();
    }
  }

  private renderChatShell(): void {
    const template = document.getElementById(
      "verityChatAppTemplate"
    ) as HTMLTemplateElement;
    if (!template) {
      logger.error("Chat template missing");
      return;
    }
    const content = template.content.cloneNode(true) as HTMLElement;
    const container = document.getElementById("verityContentArea");
    if (!container) {
      logger.error("Content area missing");
      return;
    }
    container.innerHTML = "";
    container.appendChild(content);
    // Wire inputs
    // Inputs may now reside in top fly panels; fall back to in-template versions
    const usernameInput = (document.querySelector(
      "#userPanel .verityUsernameInput"
    ) || container.querySelector(".verityUsernameInput")) as HTMLInputElement;
    const usernameSet = (document.querySelector(
      "#userPanel .verityUsernameSet"
    ) || container.querySelector(".verityUsernameSet")) as HTMLButtonElement;
    const roomInput = (document.querySelector(
      "#roomPanel .verityRoomNameInput"
    ) || container.querySelector(".verityRoomNameInput")) as HTMLInputElement;
    const joinBtn = (document.querySelector("#roomPanel .verityJoinRoom") ||
      container.querySelector(".verityJoinRoom")) as HTMLButtonElement;
    const form = container.querySelector(".verityChatForm") as HTMLFormElement;
    const msgInput = container.querySelector(
      ".verityMessageInput"
    ) as HTMLInputElement;
    usernameInput.value = this.chatController.getUsername();
    usernameSet.addEventListener("click", () =>
      this.chatController.setUsername(usernameInput.value)
    );
    usernameInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.chatController.setUsername(usernameInput.value);
      }
    });
    const join = async () => {
      const newRoomName = roomInput.value;
      if (!newRoomName) return;
      await this.chatController.joinRoom(newRoomName);
      roomInput.value = "";
      this.refreshRooms();
      // Attempt auto-scroll after initial render & any async history load.
      // We try a few animation frames plus a short timeout to catch late messages.
      const msgList = document.querySelector(
        ".verityChatMessages"
      ) as HTMLElement | null;
      if (msgList) {
        const scrollBottom = () => {
          msgList.scrollTop = msgList.scrollHeight;
        };
        // Immediate
        scrollBottom();
        // Next frame
        requestAnimationFrame(scrollBottom);
        // After short delay (captures async history population)
        setTimeout(scrollBottom, 120);
      }
    };
    joinBtn.addEventListener("click", join);
    roomInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        join();
      }
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (msgInput.value.trim()) {
        this.chatController.sendMessage(
          this.chatController.getUsername(),
          msgInput.value.trim()
        );
        msgInput.value = "";
      }
    });
    // Hook controller events for incremental UI updates
    this.chatController.onRoomsChanged = () => this.refreshRooms();
    this.chatController.onMessagesChanged = () => this.refreshMessages();
    this.refreshRooms();
  }
  private refreshRooms(): void {
    const container = document.getElementById("verityContentArea");
    if (!container) return;
    const tabs = container.querySelector(".verityChatRoomTabs");
    if (!tabs) return;
    const rooms = this.chatController.getRooms();
    const active = this.chatController.getActiveRoom();
    // Build a map of existing
    const existing = new Map<string, HTMLButtonElement>();
    for (const btn of Array.from(
      tabs.querySelectorAll(".verityChatRoomTab")
    ) as HTMLButtonElement[]) {
      const id = btn.dataset.roomId;
      if (id) existing.set(id, btn);
    }
    // Update / create
    for (const r of rooms) {
      let btn = existing.get(r.id);
      const label = r.name || "(global)";
      const html = `${
        r.unreadCount > 0
          ? `<span class="roomName">${label}</span><span class="unreadBadge">${r.unreadCount}</span>`
          : `<span class="roomName">${label}</span>`
      }<button class="closeRoom" title="Leave" aria-label="Leave room">×</button>`;
      if (!btn) {
        btn = document.createElement("button");
        btn.className = "verityChatRoomTab";
        btn.dataset.roomId = r.id;
        btn.addEventListener("click", () => {
          this.chatController.switchToRoom(r.id);
          this.refreshMessages();
          this.refreshRooms();
        });
        tabs.appendChild(btn);
      }
      if (btn.innerHTML !== html) btn.innerHTML = html;
      // wire close (delegated inside button content)
      const closeBtn = btn.querySelector(".closeRoom") as HTMLButtonElement;
      if (closeBtn && !closeBtn.dataset.bound) {
        closeBtn.dataset.bound = "1";
        closeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.chatController.leaveRoom(r.id);
        });
      }
      if (r.id === active?.id) btn.classList.add("active");
      else btn.classList.remove("active");
      existing.delete(r.id);
    }
    // Remove stale
    for (const leftover of existing.values()) leftover.remove();
    this.refreshMessages();
  }
  private refreshMessages(): void {
    const container = document.getElementById("verityContentArea");
    if (!container) return;
    const msgList = container.querySelector(".verityChatMessages");
    if (!msgList) return;
    const active = this.chatController.getActiveRoom();
    if (!active) {
      (msgList as HTMLElement).innerHTML = "";
      return;
    }
    const listEl = msgList as HTMLElement;
    const shouldStick =
      listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 4;
    // Incremental DOM update keyed by cubeKey+timestamp
    const existing = Array.from(listEl.children) as HTMLElement[];
    const neededKeys = new Set(
      active.messages.map((m) => (m.cubeKey || "") + m.timestamp.getTime())
    );
    // Remove extras
    for (const el of existing) {
      const k = el.getAttribute("data-k");
      if (k && !neededKeys.has(k)) el.remove();
    }
    // Append missing in chronological order
    for (const m of active.messages) {
      const key = (m.cubeKey || "") + m.timestamp.getTime();
      if (listEl.querySelector(`.verityChatMessage[data-k="${key}"]`)) continue;
      const el = document.createElement("div");
      el.className = "verityChatMessage";
      el.setAttribute("data-k", key);
      const timeShort = m.timestamp.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      // Tooltip: full cube key and full timestamp (ISO) for precision
      const fullKey = m.cubeKey || "(no cube key)";
      el.title = `Cube: ${fullKey}\nTime: ${m.timestamp.toISOString()}`;
      const header = document.createElement("div");
      header.className = "verityMessageHeader";
      const userSpan = document.createElement("span");
      userSpan.className = "verityMessageUsername";
      userSpan.textContent = m.username;
      const timeSpan = document.createElement("span");
      timeSpan.className = "verityMessageTimestamp";
      timeSpan.textContent = timeShort;
      header.appendChild(userSpan);
      header.appendChild(timeSpan);
      const contentDiv = document.createElement("div");
      contentDiv.className = "verityMessageContent";
      const lines = (m.message || "").split(/\n/);
      lines.forEach((line, idx) => {
        if (idx > 0) contentDiv.appendChild(document.createElement("br"));
        contentDiv.appendChild(document.createTextNode(line));
      });
      el.appendChild(header);
      el.appendChild(contentDiv);
      listEl.appendChild(el);
    }
    if (shouldStick) listEl.scrollTop = listEl.scrollHeight;
  }

  /**
   * Bind high-level shell UI interactions (theme + network panel toggling)
   */
  private initializeShellInteractions(): void {
    // Theme toggle
    const themeBtn = document.getElementById("themeToggleBtn");
    if (themeBtn) {
      themeBtn.addEventListener("click", () => {
        const html = document.documentElement;
        const cur =
          html.getAttribute("data-theme") === "dark" ? "dark" : "light";
        const next = cur === "dark" ? "light" : "dark";
        html.setAttribute("data-theme", next);
        try {
          localStorage.setItem("vc-theme", next);
        } catch {}
      });
    }

    // Unified panel toggle logic (allows multiple open)
    const panelButtons: Array<{ btn: HTMLElement | null; panelId: string }> = [
      {
        btn: document.getElementById("networkToggleBtn"),
        panelId: "networkPanel",
      },
      { btn: document.getElementById("userPanelBtn"), panelId: "userPanel" },
      { btn: document.getElementById("roomPanelBtn"), panelId: "roomPanel" },
    ];
    const updateAria = () => {
      for (const { btn, panelId } of panelButtons) {
        if (!btn) continue;
        const panelEl = document.getElementById(panelId);
        if (!panelEl) continue;
        btn.setAttribute(
          "aria-expanded",
          panelEl.getAttribute("data-open") === "true" ? "true" : "false"
        );
      }
    };
    const openPanel = (panelId: string) => {
      const el = document.getElementById(panelId);
      if (!el) return;
      el.setAttribute("data-open", "true");
      el.setAttribute("aria-hidden", "false");
      updateAria();
    };
    const closePanel = (panelId: string) => {
      const el = document.getElementById(panelId);
      if (!el) return;
      el.removeAttribute("data-open");
      el.setAttribute("aria-hidden", "true");
      updateAria();
    };
    const togglePanel = (panelId: string) => {
      const el = document.getElementById(panelId);
      if (!el) return;
      if (el.getAttribute("data-open") === "true") closePanel(panelId);
      else openPanel(panelId);
    };
    panelButtons.forEach(({ btn, panelId }) =>
      btn?.addEventListener("click", () => togglePanel(panelId))
    );
    document.querySelectorAll("[data-close-panel]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = (btn as HTMLElement).getAttribute("data-close-panel");
        if (id) closePanel(id);
      })
    );
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        document
          .querySelectorAll('.vc-fly-panel[data-open="true"]')
          .forEach((p) => {
            p.removeAttribute("data-open");
            p.setAttribute("aria-hidden", "true");
          });
        updateAria();
      }
    });
  }

  /**
   * Get the chat controller for external access
   */
  getChatController(): ChatController {
    return this.chatController;
  }
}
