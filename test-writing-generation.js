/**
 * Test Writing Test HTML Generation
 * 
 * This script tests if the writing test HTML is generated correctly
 * after the fix.
 */

const { generateHTMLFromTest } = require('./utils/htmlExporter');

// Sample writing test data
const sampleWritingTest = {
    _id: '507f1f77bcf86cd799439011',
    title: 'Test Writing Generation',
    type: 'writing',
    createdBy: '507f1f77bcf86cd799439012',
    teacherName: 'Test Teacher',
    readingPassage: JSON.stringify({
        timeLimit: 60,
        task1: {
            prompt: 'The chart below shows the percentage of households in owned and rented accommodation in England and Wales between 1918 and 2011.\n\nSummarise the information by selecting and reporting the main features, and make comparisons where relevant.',
            image: 'https://example.com/chart.png',
            modelAnswer: 'The bar chart illustrates the proportion of households that owned or rented their accommodation in England and Wales from 1918 to 2011.'
        },
        task2: {
            prompt: 'Some people believe that unpaid community service should be a compulsory part of high school programmes.\n\nTo what extent do you agree or disagree?',
            modelAnswer: 'Community service is an excellent way for young people to contribute to society and develop important life skills.'
        }
    })
};

console.log('🧪 Testing Writing Test HTML Generation...\n');

try {
    console.log('📝 Generating HTML for writing test...');
    const html = generateHTMLFromTest(sampleWritingTest, {
        deepseekApiKey: 'test-key',
        studentName: 'Test Student'
    });
    
    console.log('✅ HTML generated successfully!\n');
    
    // Check for critical elements
    const checks = [
        { name: 'DOCTYPE', test: html.includes('<!DOCTYPE html>') },
        { name: 'Timer element', test: html.includes('id="timerDisplay"') },
        { name: 'Task 1 input', test: html.includes('id="input_task1"') },
        { name: 'Task 2 input', test: html.includes('id="input_task2"') },
        { name: 'Submit button', test: html.includes('onclick="submitTest()"') },
        { name: 'Switch task function', test: html.includes('function switchTask(') },
        { name: 'Update count function', test: html.includes('function updateCount(') },
        { name: 'Timer interval', test: html.includes('setInterval(') },
        { name: 'Window exports', test: html.includes('window.submitTest') },
        { name: 'Dark mode toggle', test: html.includes('toggleDarkMode') },
        { name: 'Platform theme', test: html.includes('platform-theme') },
        { name: 'Session ID', test: html.includes('SESSION_ID') },
        { name: 'Task 1 prompt', test: html.includes('chart below shows') },
        { name: 'Task 2 prompt', test: html.includes('unpaid community service') }
    ];
    
    console.log('🔍 Verification Checks:\n');
    let passedChecks = 0;
    checks.forEach(check => {
        const status = check.test ? '✅' : '❌';
        console.log(`${status} ${check.name}`);
        if (check.test) passedChecks++;
    });
    
    console.log(`\n📊 Results: ${passedChecks}/${checks.length} checks passed\n`);
    
    if (passedChecks === checks.length) {
        console.log('🎉 All checks passed! Writing test generation is working correctly.\n');
        
        // Save sample HTML for inspection
        const fs = require('fs');
        const outputPath = './test-writing-output.html';
        fs.writeFileSync(outputPath, html);
        console.log(`💾 Sample HTML saved to: ${outputPath}`);
        console.log('   You can open this file in a browser to test manually.\n');
        
        process.exit(0);
    } else {
        console.log('⚠️  Some checks failed. Review the generated HTML.\n');
        process.exit(1);
    }
    
} catch (error) {
    console.error('❌ Error generating HTML:', error.message);
    console.error('\nStack trace:');
    console.error(error.stack);
    process.exit(1);
}
