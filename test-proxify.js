/**
 * Test proxification logic
 */

require('dotenv').config();

// Simulate the proxifyListeningAudioUrl function
function proxifyListeningAudioUrl(value, options = {}) {
    console.log('[Proxify Audio] Input:', value);
    console.log('[Proxify Audio] Options:', options);
    
    if (options.useAudioProxy === false || !value || typeof value !== 'string') {
        console.log('[Proxify Audio] Skipped - useAudioProxy=false or invalid value');
        return value;
    }
    if (value.startsWith('/audio-files/')) {
        console.log('[Proxify Audio] Already proxified');
        return value;
    }
    if (value.startsWith('data:') || value.startsWith('/')) {
        console.log('[Proxify Audio] Data URI or local path');
        return value;
    }

    const publicBase = String(process.env.B2_PUBLIC_URL || '').replace(/\/+$/, '');
    console.log('[Proxify Audio] B2_PUBLIC_URL:', publicBase);
    
    if (!publicBase || !value.startsWith(`${publicBase}/`)) {
        console.log('[Proxify Audio] URL does not match B2_PUBLIC_URL');
        console.log('[Proxify Audio] Expected prefix:', `${publicBase}/`);
        return value;
    }

    const filename = value.slice(publicBase.length + 1).split(/[?#]/)[0];
    console.log('[Proxify Audio] Extracted filename:', filename);
    
    if (!/^listening-[a-zA-Z0-9_-]+-\d+\.[a-zA-Z0-9]+$/.test(filename)) {
        console.log('[Proxify Audio] Filename does not match pattern');
        return value;
    }
    
    const proxified = `/audio-files/${encodeURIComponent(filename)}`;
    console.log('[Proxify Audio] Proxified to:', proxified);
    return proxified;
}

// Test with actual URL from database
const testUrl = 'https://f004.backblazeb2.com/file/ielts-audio/listening-part1-1778432184310.mp3';

console.log('='.repeat(60));
console.log('Testing proxification with URL from database:');
console.log('='.repeat(60));

const result = proxifyListeningAudioUrl(testUrl, {});

console.log('\n' + '='.repeat(60));
console.log('RESULT:', result);
console.log('='.repeat(60));
