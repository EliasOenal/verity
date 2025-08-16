/**
 * Basic Verity Usage Example
 * 
 * This example demonstrates the fundamental concepts of Verity:
 * - Creating a node
 * - Creating cubes
 * - Storing and retrieving data
 */

import { VerityNode, cciCube, VerityField, FieldType, MediaTypes } from '../src/index.js';

async function basicUsageExample(): Promise<void> {
  console.log('🚀 Starting Verity Basic Usage Example\n');

  // Step 1: Create a Verity node
  console.log('1. Creating Verity node...');
  const node = await VerityNode.Create({
    inMemory: true,           // Use memory storage for this example
    lightNode: true,          // Run as light node (don't replicate all data)
    announceToTorrentTrackers: false  // Don't try to connect to external trackers
  });
  console.log('✅ Node created successfully\n');

  try {
    // Step 2: Create a simple cube with content
    console.log('2. Creating a simple cube...');
    const cube = cciCube.Frozen({
      fields: [
        VerityField.Application('basic-example'),
        VerityField.ContentName('My First Cube'),
        VerityField.MediaType(MediaTypes.TEXT),
        VerityField.Payload('Hello, Verity! This is my first cube.'),
        VerityField.Date(1, Math.floor(Date.now() / 1000)) // Creation timestamp
      ]
    });

    // Get the cube's unique key (derived from content)
    const cubeKey = await cube.getKey();
    const cubeKeyString = cubeKey.toString('hex');
    console.log('✅ Cube created with key:', cubeKeyString);
    console.log('   Cube size:', cube.size, 'bytes\n');

    // Step 3: Store the cube
    console.log('3. Storing cube in node...');
    await node.cubeStore.addCube(cube);
    console.log('✅ Cube stored successfully\n');

    // Step 4: Verify storage and retrieve the cube
    console.log('4. Retrieving cube from storage...');
    const exists = await node.cubeStore.hasCube(cubeKey);
    console.log('   Cube exists in storage:', exists);

    if (exists) {
      const retrievedCube = await node.cubeStore.getCube(cubeKey);
      
      // Extract and display the content
      const payloadField = retrievedCube.getFirstField(FieldType.PAYLOAD);
      const contentField = retrievedCube.getFirstField(FieldType.CONTENT_NAME);
      const appField = retrievedCube.getFirstField(FieldType.APPLICATION);
      
      console.log('✅ Retrieved cube content:');
      console.log('   Application:', appField?.value.toString());
      console.log('   Title:', contentField?.value.toString());
      console.log('   Payload:', payloadField?.value.toString());
      console.log('   Type:', retrievedCube.cubeType, '(Frozen cube)\n');
    }

    // Step 5: Create multiple cubes and demonstrate iteration
    console.log('5. Creating multiple cubes...');
    const cubes = [];
    
    for (let i = 1; i <= 3; i++) {
      const multipleCube = cciCube.Frozen({
        fields: [
          VerityField.Application('basic-example'),
          VerityField.ContentName(`Example Cube #${i}`),
          VerityField.MediaType(MediaTypes.TEXT),
          VerityField.Payload(`This is example cube number ${i}`),
        ]
      });
      
      await node.cubeStore.addCube(multipleCube);
      cubes.push(multipleCube);
      console.log(`   Created cube #${i}:`, (await multipleCube.getKey()).toString('hex').substring(0, 16) + '...');
    }

    // Step 6: Iterate through all stored cubes
    console.log('\n6. Listing all cubes in storage:');
    let cubeCount = 0;
    
    for await (const cubeInfo of node.cubeStore.getAllCubes()) {
      cubeCount++;
      const cube = cubeInfo.getCube();
      const appField = cube.getFirstField(FieldType.APPLICATION);
      
      // Only show cubes from our example application
      if (appField?.value.toString() === 'basic-example') {
        const titleField = cube.getFirstField(FieldType.CONTENT_NAME);
        console.log(`   📦 ${titleField?.value.toString() || 'Untitled'}`);
        console.log(`      Key: ${cubeInfo.keyString.substring(0, 16)}...`);
        console.log(`      Size: ${cube.size} bytes`);
      }
    }
    
    console.log(`\n✅ Total cubes in storage: ${cubeCount}`);

    // Step 7: Demonstrate cube validation
    console.log('\n7. Demonstrating cube validation...');
    console.log('   Original cube is valid:', cube.isValid);
    
    // Show cube structure
    console.log('\n8. Cube structure:');
    console.log('   Fields in cube:', cube.fields.size);
    console.log('   Bytes remaining in cube:', cube.fields.bytesRemaining());
    console.log('   Cube type:', cube.cubeType);

  } catch (error) {
    console.error('❌ Error during example:', error.message);
  } finally {
    // Step 9: Cleanup
    console.log('\n9. Cleaning up...');
    await node.shutdown();
    console.log('✅ Node shutdown complete');
  }

  console.log('\n🎉 Basic usage example completed successfully!');
  console.log('\nKey takeaways:');
  console.log('- Cubes are 1kB containers for data');
  console.log('- Each cube has a unique key derived from its content');
  console.log('- CCI provides standardized fields for interoperability');
  console.log('- Nodes can store and retrieve cubes efficiently');
  console.log('- Always remember to shutdown nodes when done');
}

// Run the example
if (require.main === module) {
  basicUsageExample().catch(console.error);
}

export { basicUsageExample };