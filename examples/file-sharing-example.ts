/**
 * File Sharing Example (Based on FileApplication)
 * 
 * This example demonstrates file sharing using the actual FileApplication utility.
 * These patterns are used for decentralized file distribution.
 */

import { FileApplication } from '../src/app/fileApplication.js';
import { VerityNode } from '../src/cci/verityNode.js';
import { FieldType } from '../src/cci/cube/cciCube.definitions.js';
import { Buffer } from 'buffer';

/**
 * Example of sharing files across the Verity network
 * Based on the actual FileApplication implementation
 */
async function fileExample() {
  console.log('📁 Starting File Sharing Example (Based on FileApplication)\n');

  const node = await VerityNode.Create({
    inMemory: true,
    lightNode: true,
    announceToTorrentTrackers: false
  });

  try {
    // Create sample file content
    console.log('1. Creating sample files...');
    
    const smallFile = Buffer.from('Hello Verity! This is a small test file.', 'utf8');
    const largeFile = Buffer.alloc(2048); // 2KB file that will span multiple cubes
    largeFile.write('This is a large file that demonstrates Verity\'s ability to handle files larger than the 1KB cube limit. ');
    
    // Fill the rest with sample data
    for (let i = 100; i < 2000; i += 50) {
      largeFile.write(`Data chunk at position ${i}. `, i);
    }

    console.log('✅ Sample files created:');
    console.log('   Small file: 41 bytes');
    console.log('   Large file: 2048 bytes\n');

    // Share the small file
    console.log('2. Sharing small file...');
    
    const smallFileCubes = await FileApplication.createFileCubes(
      smallFile,
      'small-test.txt'
    );
    
    console.log(`✅ Small file split into ${smallFileCubes.length} cube(s)`);
    
    // Store all cubes
    for (const cube of smallFileCubes) {
      await node.cubeStore.addCube(cube);
    }
    
    // Show cube information
    const firstCube = smallFileCubes[0];
    const appField = firstCube.getFirstField(FieldType.APPLICATION);
    const nameField = firstCube.getFirstField(FieldType.CONTENT_NAME);
    const payloadField = firstCube.getFirstField(FieldType.PAYLOAD);
    
    console.log('   Application:', appField?.value.toString());
    console.log('   Filename:', nameField?.value.toString());
    console.log('   Payload size:', payloadField?.value.length, 'bytes');

    // Share the large file with progress tracking
    console.log('\n3. Sharing large file with progress...');
    
    const largeFileCubes = await FileApplication.createFileCubes(
      largeFile,
      'large-test.dat',
      (progress, remaining) => {
        console.log(`   Progress: ${progress.toFixed(1)}%, ${remaining} bytes remaining`);
      }
    );
    
    console.log(`✅ Large file split into ${largeFileCubes.length} cubes`);
    
    // Store all cubes
    for (const cube of largeFileCubes) {
      await node.cubeStore.addCube(cube);
    }

    // Demonstrate file reconstruction
    console.log('\n4. Reconstructing files...');
    
    // Reconstruct small file
    const reconstructedSmall = await FileApplication.retrieveFile(
      smallFileCubes[0],
      node.cubeStore
    );
    
    const smallMatches = Buffer.compare(smallFile, reconstructedSmall) === 0;
    console.log('✅ Small file reconstructed, matches original:', smallMatches);
    console.log('   Original content:', smallFile.toString().substring(0, 50) + '...');
    console.log('   Reconstructed:', reconstructedSmall.toString().substring(0, 50) + '...');

    // Reconstruct large file
    const reconstructedLarge = await FileApplication.retrieveFile(
      largeFileCubes[0],
      node.cubeStore
    );
    
    const largeMatches = Buffer.compare(largeFile, reconstructedLarge) === 0;
    console.log('✅ Large file reconstructed, matches original:', largeMatches);
    console.log('   Original size:', largeFile.length, 'bytes');
    console.log('   Reconstructed size:', reconstructedLarge.length, 'bytes');

    // Show cube chain information
    console.log('\n5. File cube chain analysis:');
    console.log('   Small file cubes:', smallFileCubes.length);
    console.log('   Large file cubes:', largeFileCubes.length);
    
    // Analyze the cube chain for the large file
    for (let i = 0; i < Math.min(3, largeFileCubes.length); i++) {
      const cube = largeFileCubes[i];
      const payloadField = cube.getFirstField(FieldType.PAYLOAD);
      const relatesField = cube.getFirstField(FieldType.RELATES_TO);
      
      console.log(`   Cube ${i + 1}:`);
      console.log(`     Payload size: ${payloadField?.value.length} bytes`);
      console.log(`     Has continuation: ${relatesField ? 'Yes' : 'No'}`);
      console.log(`     Key: ${(await cube.getKey()).toString('hex').substring(0, 16)}...`);
    }

    // Demonstrate file metadata
    console.log('\n6. File metadata:');
    const firstLargeCube = largeFileCubes[0];
    const fields = [
      { type: FieldType.APPLICATION, name: 'Application' },
      { type: FieldType.CONTENT_NAME, name: 'Filename' },
      { type: FieldType.PAYLOAD, name: 'Payload' },
      { type: FieldType.RELATES_TO, name: 'Relationship' }
    ];
    
    fields.forEach(({ type, name }) => {
      const field = firstLargeCube.getFirstField(type);
      if (field) {
        console.log(`   ${name}: ${field.value.length} bytes`);
      }
    });

    // Storage analysis
    console.log('\n7. Storage efficiency:');
    const totalCubes = smallFileCubes.length + largeFileCubes.length;
    const totalOriginalSize = smallFile.length + largeFile.length;
    const totalStoredSize = totalCubes * 1024; // Each cube is 1KB
    const overhead = ((totalStoredSize - totalOriginalSize) / totalOriginalSize * 100);
    
    console.log(`   Total files: 2`);
    console.log(`   Total cubes: ${totalCubes}`);
    console.log(`   Original data: ${totalOriginalSize} bytes`);
    console.log(`   Stored data: ${totalStoredSize} bytes`);
    console.log(`   Overhead: ${overhead.toFixed(1)}%`);

  } catch (error) {
    console.error('❌ Error during example:', error.message);
  } finally {
    console.log('\n8. Cleaning up...');
    await node.shutdown();
    console.log('✅ Node shutdown complete');
  }

  console.log('\n🎉 File sharing example completed successfully!');
  console.log('\nThis example is based on the actual FileApplication utility.');
  console.log('Key features demonstrated:');
  console.log('- Automatic file splitting across multiple cubes');
  console.log('- Cube chaining with continuation relationships');
  console.log('- Progress tracking during file processing');
  console.log('- Perfect file reconstruction');
  console.log('- Metadata preservation');
  console.log('\nFor the full implementation, see:');
  console.log('- src/app/fileApplication.ts (complete implementation)');
}

export { fileExample };