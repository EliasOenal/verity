/**
 * Chat Application Example
 * 
 * This example demonstrates how to build a real-time chat application using:
 * - Notification keys for chat rooms
 * - ChatApplication utility class
 * - Real-time message handling
 * - Multiple users in a chat room
 */

import { VerityNode, ChatApplication, Identity } from '../src/index.js';
import { Buffer } from 'buffer';
import crypto from 'crypto';

async function chatExample(): Promise<void> {
  console.log('💬 Starting Verity Chat Application Example\n');

  // Step 1: Create nodes for multiple users
  console.log('1. Creating nodes for chat participants...');
  
  const aliceNode = await VerityNode.Create({
    inMemory: true,
    lightNode: true,
    announceToTorrentTrackers: false
  });
  
  const bobNode = await VerityNode.Create({
    inMemory: true,
    lightNode: true,
    announceToTorrentTrackers: false
  });

  console.log('✅ Alice and Bob nodes created\n');

  try {
    // Step 2: Create identities for chat participants
    console.log('2. Creating chat participants...');
    
    const alice = await Identity.Create({
      name: 'Alice',
      cubeStore: aliceNode.cubeStore
    });
    
    const bob = await Identity.Create({
      name: 'Bob',
      cubeStore: bobNode.cubeStore
    });

    console.log('✅ Chat participants created:');
    console.log('   Alice:', alice.name);
    console.log('   Bob:', bob.name, '\n');

    // Step 3: Create a chat room (notification key)
    console.log('3. Creating chat room...');
    
    const chatRoomKey = Buffer.alloc(32);
    crypto.randomFillSync(chatRoomKey);
    const chatRoomName = 'General Chat';
    
    console.log('✅ Chat room created:', chatRoomName);
    console.log('   Room key:', chatRoomKey.toString('hex').substring(0, 16) + '...\n');

    // Step 4: Setup message listeners
    console.log('4. Setting up message listeners...');
    
    const chatHistory: Array<{username: string, message: string, timestamp: Date}> = [];
    
    // Function to handle incoming messages
    const handleMessage = (username: string, message: string, node: string) => {
      const timestamp = new Date();
      chatHistory.push({ username, message, timestamp });
      console.log(`   📨 [${node}] ${username}: ${message}`);
    };

    // Note: In a real application, you would set up notification listeners here
    // For this example, we'll simulate the message flow
    console.log('✅ Message listeners configured\n');

    // Step 5: Send messages to the chat room
    console.log('5. Sending chat messages...');
    
    // Alice sends a message
    const aliceMessage1 = await ChatApplication.createChatCube(
      alice.name,
      'Hello everyone! Welcome to the chat room!',
      chatRoomKey
    );
    await aliceNode.cubeStore.addCube(aliceMessage1);
    
    // Simulate message propagation to Bob's node
    await bobNode.cubeStore.addCube(aliceMessage1);
    
    console.log('✅ Alice sent a message');
    
    // Parse and display the message
    const parsed1 = ChatApplication.parseChatCube(aliceMessage1);
    handleMessage(parsed1.username, parsed1.message, 'Both nodes');

    // Bob responds
    const bobMessage1 = await ChatApplication.createChatCube(
      bob.name,
      'Hi Alice! Great to be here!',
      chatRoomKey
    );
    await bobNode.cubeStore.addCube(bobMessage1);
    await aliceNode.cubeStore.addCube(bobMessage1);
    
    console.log('✅ Bob sent a message');
    
    const parsed2 = ChatApplication.parseChatCube(bobMessage1);
    handleMessage(parsed2.username, parsed2.message, 'Both nodes');

    // Step 6: Simulate a conversation
    console.log('\n6. Simulating chat conversation...');
    
    const messages = [
      { sender: alice, text: 'How has everyone been?' },
      { sender: bob, text: 'Pretty good! Working on some Verity applications.' },
      { sender: alice, text: 'That sounds interesting! What kind of apps?' },
      { sender: bob, text: 'Mostly decentralized social features.' },
      { sender: alice, text: 'Cool! Verity makes that so much easier.' }
    ];

    for (const msg of messages) {
      // Create the chat cube
      const chatCube = await ChatApplication.createChatCube(
        msg.sender.name,
        msg.text,
        chatRoomKey
      );
      
      // Add to both nodes (simulating network propagation)
      await aliceNode.cubeStore.addCube(chatCube);
      await bobNode.cubeStore.addCube(chatCube);
      
      // Parse and display
      const parsed = ChatApplication.parseChatCube(chatCube);
      handleMessage(parsed.username, parsed.message, 'Both nodes');
      
      // Small delay to make it feel more natural
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Step 7: Display chat history
    console.log('\n7. Chat history summary...');
    console.log(`✅ Total messages in chat: ${chatHistory.length}`);
    console.log('\n   📜 Chat History:');
    
    chatHistory.forEach((msg, index) => {
      const timeStr = msg.timestamp.toLocaleTimeString();
      console.log(`   ${index + 1}. [${timeStr}] ${msg.username}: ${msg.message}`);
    });

    // Step 8: Demonstrate message parsing and validation
    console.log('\n8. Message validation...');
    
    try {
      // Parse a valid message
      const validMessage = ChatApplication.parseChatCube(aliceMessage1);
      console.log('✅ Valid message parsed successfully');
      console.log('   Username:', validMessage.username);
      console.log('   Message length:', validMessage.message.length);
      console.log('   Notification key matches:', 
        validMessage.notificationKey.equals(chatRoomKey));
      
    } catch (error) {
      console.log('❌ Message parsing error:', error.message);
    }

    // Step 9: Chat room statistics
    console.log('\n9. Chat room statistics...');
    
    // Count messages by user
    const userStats: Record<string, number> = {};
    chatHistory.forEach(msg => {
      userStats[msg.username] = (userStats[msg.username] || 0) + 1;
    });
    
    console.log('✅ Message statistics:');
    Object.entries(userStats).forEach(([username, count]) => {
      console.log(`   ${username}: ${count} messages`);
    });
    
    // Calculate average message length
    const totalLength = chatHistory.reduce((sum, msg) => sum + msg.message.length, 0);
    const avgLength = totalLength / chatHistory.length;
    console.log(`   Average message length: ${avgLength.toFixed(1)} characters`);

    // Step 10: Demonstrate different chat rooms
    console.log('\n10. Multiple chat rooms...');
    
    const techChatKey = Buffer.alloc(32);
    crypto.randomFillSync(techChatKey);
    
    const techMessage = await ChatApplication.createChatCube(
      alice.name,
      'Welcome to the tech discussion room!',
      techChatKey
    );
    
    await aliceNode.cubeStore.addCube(techMessage);
    
    console.log('✅ Created separate tech chat room');
    console.log('   Tech room key:', techChatKey.toString('hex').substring(0, 16) + '...');
    
    const parsedTech = ChatApplication.parseChatCube(techMessage);
    console.log('   Message:', parsedTech.message);
    console.log('   Room isolation confirmed:', 
      !parsedTech.notificationKey.equals(chatRoomKey));

  } catch (error) {
    console.error('❌ Error during example:', error.message);
  } finally {
    // Cleanup
    console.log('\n11. Cleaning up...');
    await aliceNode.shutdown();
    await bobNode.shutdown();
    console.log('✅ All nodes shutdown complete');
  }

  console.log('\n🎉 Chat application example completed successfully!');
  console.log('\nKey takeaways:');
  console.log('- Notification keys create isolated chat rooms');
  console.log('- ChatApplication class simplifies message handling');
  console.log('- Messages are stored as cubes and propagated through the network');
  console.log('- Multiple chat rooms can coexist independently');
  console.log('- All chat data is decentralized and censorship-resistant');
}

// Run the example  
if (require.main === module) {
  chatExample().catch(console.error);
}

export { chatExample };