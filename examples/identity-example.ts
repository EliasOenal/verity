/**
 * Identity Management Example
 * 
 * This example demonstrates how to:
 * - Create and manage identities
 * - Sign content with identities
 * - Subscribe to other users
 * - Store and retrieve identity information
 */

import { VerityNode, Identity, IdentityStore, cciCube, VerityField, FieldType } from '../src/index.js';

async function identityExample(): Promise<void> {
  console.log('👤 Starting Verity Identity Management Example\n');

  // Step 1: Create a Verity node
  console.log('1. Creating Verity node...');
  const node = await VerityNode.Create({
    inMemory: true,
    lightNode: true,
    announceToTorrentTrackers: false
  });
  console.log('✅ Node created successfully\n');

  try {
    // Step 2: Create identities
    console.log('2. Creating identities...');
    
    const alice = await Identity.Create({
      name: 'Alice',
      cubeStore: node.cubeStore
    });
    
    const bob = await Identity.Create({
      name: 'Bob', 
      cubeStore: node.cubeStore
    });

    console.log('✅ Alice identity created');
    console.log('   Public key:', alice.publicKeyString.substring(0, 16) + '...');
    console.log('   Name:', alice.name);
    
    console.log('✅ Bob identity created');
    console.log('   Public key:', bob.publicKeyString.substring(0, 16) + '...');
    console.log('   Name:', bob.name, '\n');

    // Step 3: Create an identity store and manage identities
    console.log('3. Setting up identity store...');
    const identityStore = new IdentityStore(node.cubeStore);
    
    await identityStore.addIdentity(alice);
    await identityStore.addIdentity(bob);
    
    console.log('✅ Identities added to store\n');

    // Step 4: Create signed content
    console.log('4. Creating signed content...');
    
    const aliceContent = await alice.createMUC({
      fields: [
        VerityField.Application('identity-example'),
        VerityField.Username(alice.name),
        VerityField.ContentName('Alice\'s Profile'),
        VerityField.Description('This is Alice\'s identity cube'),
        VerityField.Payload('Hello! I am Alice and this is my signed content.'),
        VerityField.Date(1, Math.floor(Date.now() / 1000))
      ]
    });

    await node.cubeStore.addCube(aliceContent);
    console.log('✅ Alice created signed content');
    console.log('   Key:', (await aliceContent.getKey()).toString('hex').substring(0, 16) + '...');
    
    // Verify the signature
    const isValidSignature = await aliceContent.verifySignature();
    console.log('   Signature valid:', isValidSignature, '\n');

    // Step 5: Subscription management
    console.log('5. Managing subscriptions...');
    
    // Alice subscribes to Bob
    alice.addPublicSubscription(bob.publicKey);
    console.log('✅ Alice subscribed to Bob');
    
    // Check subscription status
    const aliceSubscribesToBob = alice.hasPublicSubscription(bob.publicKey);
    const bobSubscribesToAlice = bob.hasPublicSubscription(alice.publicKey);
    
    console.log('   Alice subscribes to Bob:', aliceSubscribesToBob);
    console.log('   Bob subscribes to Alice:', bobSubscribesToAlice);
    
    // Get all of Alice's subscriptions
    const aliceSubscriptions = alice.getPublicSubscriptions();
    console.log('   Alice\'s subscriptions:', aliceSubscriptions.size, '\n');

    // Step 6: Store identities persistently
    console.log('6. Storing identities...');
    await alice.store();
    await bob.store();
    console.log('✅ Identities stored to node\n');

    // Step 7: Retrieve identities from store
    console.log('7. Retrieving identities from store...');
    
    const retrievedAlice = await identityStore.getIdentity(alice.publicKeyString);
    const retrievedBob = await identityStore.getIdentity(bob.publicKey);
    
    console.log('✅ Retrieved Alice:', retrievedAlice?.name);
    console.log('✅ Retrieved Bob:', retrievedBob?.name);
    
    // List all identities
    const allIdentities = await identityStore.getAllIdentities();
    console.log('   Total identities in store:', allIdentities.length, '\n');

    // Step 8: Post management
    console.log('8. Managing posts...');
    
    // Add posts to Alice's identity
    const post1Key = await aliceContent.getKey();
    alice.addPost(post1Key);
    
    // Create another piece of content
    const alicePost2 = cciCube.Frozen({
      fields: [
        VerityField.Application('identity-example'),
        VerityField.Payload('This is Alice\'s second post!')
      ]
    });
    await node.cubeStore.addCube(alicePost2);
    const post2Key = await alicePost2.getKey();
    alice.addPost(post2Key);
    
    console.log('✅ Added posts to Alice\'s identity');
    console.log('   Post keys stored:', alice.getPostKeyStrings().size);
    
    // Retrieve posts from identity
    console.log('\n   Alice\'s posts:');
    let postCount = 0;
    for await (const postInfo of alice.getPosts()) {
      postCount++;
      const cube = postInfo.main;
      const payloadField = cube.getFirstField(FieldType.PAYLOAD);
      const contentField = cube.getFirstField(FieldType.CONTENT_NAME);
      
      console.log(`   📝 Post ${postCount}:`);
      console.log(`      Title: ${contentField?.value.toString() || 'Untitled'}`);
      console.log(`      Content: ${payloadField?.value.toString().substring(0, 50)}...`);
      console.log(`      Key: ${postInfo.main.getKeyIfAvailable()?.toString('hex').substring(0, 16)}...`);
    }

    // Step 9: Demonstrate identity relationships
    console.log('\n9. Identity relationships...');
    
    // Bob subscribes back to Alice
    bob.addPublicSubscription(alice.publicKey);
    await bob.store();
    
    console.log('✅ Bob subscribed to Alice');
    console.log('   Mutual subscription established');
    console.log('   Alice subscribers to Bob:', alice.hasPublicSubscription(bob.publicKey));
    console.log('   Bob subscribes to Alice:', bob.hasPublicSubscription(alice.publicKey));

    // Step 10: Identity key information
    console.log('\n10. Identity cryptographic information...');
    const aliceKeypair = await alice.getKeypair();
    console.log('✅ Alice keypair information:');
    console.log('   Public key length:', aliceKeypair.publicKey.length, 'bytes');
    console.log('   Private key length:', aliceKeypair.privateKey.length, 'bytes');
    console.log('   Public key (hex):', aliceKeypair.publicKey.toString('hex').substring(0, 32) + '...');

  } catch (error) {
    console.error('❌ Error during example:', error.message);
  } finally {
    // Cleanup
    console.log('\n11. Cleaning up...');
    await node.shutdown();
    console.log('✅ Node shutdown complete');
  }

  console.log('\n🎉 Identity management example completed successfully!');
  console.log('\nKey takeaways:');
  console.log('- Identities provide cryptographic authentication');
  console.log('- Content can be signed to prove authorship');
  console.log('- Subscription systems enable social relationships');
  console.log('- Identity stores manage multiple user identities');
  console.log('- All identity data is stored in cubes on the network');
}

// Run the example
if (require.main === module) {
  identityExample().catch(console.error);
}

export { identityExample };