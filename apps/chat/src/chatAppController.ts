import { ControllerContext, VerityController } from "../../../src/webui/verityController";
import { ChatController } from "../../../src/webui/chatApp/chatController";
import { PeerController } from "../../../src/webui/peer/peerController";
import { logger } from "../../../src/core/logger";

/**
 * Main controller for the standalone Verity Chat application.
 * This controller manages both the chat functionality and peer management
 * in a simplified interface.
 */
export class ChatAppController extends VerityController {
    private chatController: ChatController;
    private peerController: PeerController;

    constructor(parent: ControllerContext) {
        super(parent);
        
        // Initialize sub-controllers
        this.chatController = new ChatController(parent);
        this.peerController = new PeerController(parent);
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
    async shutdown(unshow: boolean = true, callback: boolean = true): Promise<void> {
        await this.chatController.shutdown(unshow, callback);
        await this.peerController.shutdown(unshow, callback);
        await super.shutdown(unshow, callback);
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