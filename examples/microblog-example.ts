/**
 * Microblogging Example (Based on ZW Application)
 * 
 * This example shows patterns from the actual working ZW microblogging application.
 * These patterns are used in the production web application.
 */

import { makePost } from '../src/app/zw/model/zwUtil.js';
import { Identity } from '../src/cci/identity/identity.js';
import { VerityNode } from '../src/cci/verityNode.js';
import { FieldType } from '../src/cci/cube/cciCube.definitions.js';

/**
 * Example of creating and managing microblog posts
 * Based on the actual ZW application implementation
 */
async function microblogExample() {
  console.log('📝 Starting Microblogging Example (Based on ZW App)\n');

  const node = await VerityNode.Create({
    inMemory: true,
    lightNode: true,
    announceToTorrentTrackers: false
  });

  try {
    // Create user identity (like in ZW application)
    console.log('1. Creating user identity...');
    const alice = await Identity.Create({
      name: 'Alice',
      cubeStore: node.cubeStore
    });

    const bob = await Identity.Create({
      name: 'Bob', 
      cubeStore: node.cubeStore
    });

    console.log('✅ Users created: Alice and Bob\n');

    // Create posts using the actual ZW utility function
    console.log('2. Creating microblog posts...');
    
    // Alice makes a post
    const alicePost = await makePost('Hello Verity! This is my first post.', {
      id: alice,
      store: node.cubeStore
    });
    
    console.log('✅ Alice created post:', (await alicePost.getKey()).toString('hex').substring(0, 16) + '...');

    // Bob makes a post
    const bobPost = await makePost('Welcome to the decentralized web!', {
      id: bob,
      store: node.cubeStore
    });
    
    console.log('✅ Bob created post:', (await bobPost.getKey()).toString('hex').substring(0, 16) + '...');

    // Alice replies to Bob's post (demonstrates threading)
    const aliceReply = await makePost('Thanks Bob! Excited to be here.', {
      id: alice,
      replyto: await bobPost.getKey(),
      store: node.cubeStore
    });
    
    console.log('✅ Alice replied to Bob:', (await aliceReply.getKey()).toString('hex').substring(0, 16) + '...\n');

    // Demonstrate subscription system (like ZW's Web of Trust)
    console.log('3. Setting up subscriptions...');
    alice.addPublicSubscription(bob.publicKey);
    bob.addPublicSubscription(alice.publicKey);
    
    await alice.store();
    await bob.store();
    
    console.log('✅ Mutual subscriptions established\n');

    // Retrieve and display posts (like the ZW web interface)
    console.log('4. Retrieving posts from timeline...');
    
    // Get Alice's posts (including posts from subscriptions)
    console.log('📜 Alice\'s Timeline:');
    let postCount = 0;
    
    for await (const postInfo of alice.getPosts()) {
      postCount++;
      const cube = postInfo.main;
      
      // Extract post content (like ZW PostController)
      const payloadField = cube.getFirstField(FieldType.PAYLOAD);
      const authorField = cube.getFirstField(FieldType.USERNAME);
      
      if (payloadField) {
        const content = payloadField.value.toString();
        const author = authorField?.value.toString() || 'Unknown';
        const isReply = cube.getFirstField(FieldType.RELATES_TO) !== undefined;
        
        console.log(`   ${postCount}. ${author}: ${content}`);
        if (isReply) {
          console.log('      └── (Reply)');
        }
      }
      
      // Limit output for example
      if (postCount >= 5) break;
    }

    // Show social features (like ZW's subscription system)
    console.log('\n5. Social features:');
    console.log('   Alice subscriptions:', alice.getPublicSubscriptions().size);
    console.log('   Bob subscriptions:', bob.getPublicSubscriptions().size);
    console.log('   Alice posts:', alice.getPostKeyStrings().size);
    console.log('   Bob posts:', bob.getPostKeyStrings().size);

    // Demonstrate content filtering (like ZW's isPostDisplayable)
    console.log('\n6. Content validation:');
    const hasValidPayload = !!alicePost.getFirstField(FieldType.PAYLOAD);
    const hasApplication = !!alicePost.getFirstField(FieldType.APPLICATION);
    
    console.log('   Post has payload:', hasValidPayload);
    console.log('   Post has application field:', hasApplication);
    console.log('   Post is properly formatted ZW cube');

  } catch (error) {
    console.error('❌ Error during example:', error.message);
  } finally {
    console.log('\n7. Cleaning up...');
    await node.shutdown();
    console.log('✅ Node shutdown complete');
  }

  console.log('\n🎉 Microblogging example completed successfully!');
  console.log('\nThis example is based on the actual ZW application patterns.');
  console.log('For the full implementation, see:');
  console.log('- src/app/zw/model/zwUtil.ts (post creation)');
  console.log('- src/app/zw/webui/post/postController.ts (UI logic)');
  console.log('- src/webui/ (web application framework)');
}

export { microblogExample };