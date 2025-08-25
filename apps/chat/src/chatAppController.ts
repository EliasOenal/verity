import { ChatController } from "../../../src/webui/chatApp/chatController";
import { PeerController } from "../../../src/webui/peer/peerController";
import { logger } from "../../../src/core/logger";

/**
 * Main controller for the standalone Verity Chat application.
 * This controller manages both the chat functionality and peer management
 * in a simplified interface.
 */
export class ChatAppController {
    private chatController: ChatController;
    private peerController: PeerController;
    private context: any;

    constructor(context: any) {
        this.context = context;
        
        // Initialize sub-controllers
        this.chatController = new ChatController(context);
        this.peerController = new PeerController(context);
    }

    /**
     * Initialize the chat app with integrated peer management
     */
    async showChatApp(): Promise<void> {
        try {
            // Set up the chat in the main content area
            await this.chatController.showChatApp();
            
            // Set up peer management in the minimized panel
            await this.setupPeerManagement();
            
            logger.info("Chat app initialized successfully");
        } catch (error) {
            logger.error(`Failed to initialize chat app: ${error}`);
        }
    }

    /**
     * Set up peer management in the dedicated panel
     */
    private async setupPeerManagement(): Promise<void> {
        // The peer view is already rendered on construction
        const peersPanelContent = document.getElementById('verityPeersPanelContent');
        if (peersPanelContent) {
            peersPanelContent.innerHTML = '';
            peersPanelContent.appendChild(this.peerController.contentAreaView.renderedView);
        }
        
        // Set up the online status indicator
        const onlineStatusArea = document.getElementById('verityOnlineStatusArea');
        if (onlineStatusArea) {
            // Replace the default content with the actual online view
            onlineStatusArea.innerHTML = '';
            onlineStatusArea.appendChild(this.peerController.onlineView.renderedView);
            this.peerController.onlineView.show();
        }
        
        // Start peer redisplay (which is the main operation for peer management)
        this.peerController.redisplayPeers();
    }

    /**
     * Clean shutdown of both controllers
     */
    async shutdown(): Promise<void> {
        if (this.chatController?.shutdown) {
            await this.chatController.shutdown();
        }
        if (this.peerController?.shutdown) {
            await this.peerController.shutdown();
        }
    }

    /**
     * Get the chat controller for external access
     */
    getChatController(): ChatController {
        return this.chatController;
    }

    /**
     * Get the peer controller for external access
     */
    getPeerController(): PeerController {
        return this.peerController;
    }
}