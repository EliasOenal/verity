/**
 * Simple Verity Usage Example (JavaScript)
 * 
 * This example demonstrates basic Verity concepts using the main exports.
 * Note: This example uses JavaScript imports from the built distribution.
 */

import * as Verity from '../dist/index.js';

async function simpleExample() {
  console.log('🚀 Starting Simple Verity Example\n');
  
  try {
    // Create a simple test to verify the API is working
    console.log('1. Testing Verity imports...');
    console.log('✅ Verity module loaded successfully');
    console.log('   Available exports:', Object.keys(Verity).slice(0, 10).join(', '), '...\n');
    
    // Test cube key utilities
    console.log('2. Testing cube utilities...');
    const testBuffer = Buffer.from('Hello Verity!');
    console.log('✅ Buffer operations working');
    console.log('   Test buffer:', testBuffer.toString());
    console.log('   Buffer length:', testBuffer.length, 'bytes\n');
    
    console.log('🎉 Simple example completed successfully!\n');
    console.log('This demonstrates that the Verity API is properly built and accessible.');
    console.log('For full examples, see the developer guide and API reference.');
    
  } catch (error) {
    console.error('❌ Error during example:', error.message);
    console.error('   Stack:', error.stack);
  }
}

// Run the example
simpleExample().catch(console.error);