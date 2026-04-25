const fs = require('fs');
const path = require('path');

const builderSourcePaths = {
    reading: path.join(__dirname, '..', 'builder_sources', 'Builder_v70.html'),
    listening: path.join(__dirname, '..', 'builder_sources', 'Listening_Builder_v42.html'),
    writing: path.join(__dirname, '..', 'builder_sources', 'Experimental_Writing_Builder_v17.html')
};

const sourceCache = new Map();
const templateCache = new Map();

function getBuilderSourcePath(type) {
    const normalizedType = String(type || '').toLowerCase();
    const sourcePath = builderSourcePaths[normalizedType];

    if (!sourcePath) {
        throw new Error(`Unsupported builder type: ${type}`);
    }

    return sourcePath;
}

function readBuilderSource(type) {
    const normalizedType = String(type || '').toLowerCase();

    if (!sourceCache.has(normalizedType)) {
        const sourcePath = getBuilderSourcePath(normalizedType);
        sourceCache.set(normalizedType, fs.readFileSync(sourcePath, 'utf8'));
    }

    return sourceCache.get(normalizedType);
}

function readBuilderFinalTemplate(type) {
    const normalizedType = String(type || '').toLowerCase();

    if (!templateCache.has(normalizedType)) {
        const source = readBuilderSource(normalizedType);
        const match = source.match(/const template = `([\s\S]*?)`;\s*const blob/);

        if (!match) {
            throw new Error(`Could not extract final template from ${normalizedType} builder source`);
        }

        templateCache.set(normalizedType, match[1]);
    }

    return templateCache.get(normalizedType);
}

module.exports = {
    getBuilderSourcePath,
    readBuilderSource,
    readBuilderFinalTemplate
};
