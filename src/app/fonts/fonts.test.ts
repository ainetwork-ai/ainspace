import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Pinned bundled bytes (license trailing spaces normalized): detect lost/replaced assets.
test('offline font assets and OFL notices match the documented bundled hashes', () => {
    const readme = readFileSync('src/app/fonts/README.md', 'utf8');
    const entries = [...readme.matchAll(/- `([^`]+)`:.*SHA-256 `([a-f0-9]{64})`/g)];
    assert.equal(entries.length, 6);
    for (const [, file, sha] of entries) {
        const bytes = readFileSync(`src/app/fonts/${file}`);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), sha, file);
        if (file.endsWith('.ttf')) assert.equal(bytes.readUInt32BE(0), 0x00010000, file);
        else {
            assert.match(bytes.toString(), /SIL OPEN FONT LICENSE Version 1.1/);
            assert.doesNotMatch(bytes.toString(), /[ \t]+$/m, `${file}: trailing whitespace`);
            assert.deepEqual(readFileSync(`public/fonts/${file}`), bytes);
        }
    }
});

test('root font loader uses bundled assets for all existing font variables', () => {
    const layout = readFileSync('src/app/layout.tsx', 'utf8');
    assert.doesNotMatch(layout, /next\/font\/google|fonts\.googleapis|fonts\.gstatic/);
    assert.match(layout, /import localFont from 'next\/font\/local'/);
    for (const [file, weight, variable] of [
        ['Geist', '100 900', 'geist-sans'],
        ['GeistMono', '100 900', 'geist-mono'],
        ['Manrope', '200 800', 'manrope']
    ]) {
        const config = [...layout.matchAll(/localFont\(\{([\s\S]*?)\}\)/g)]
            .map((match) => match[1]).find((value) => value.includes(`--font-${variable}`));
        assert.ok(config, variable);
        assert.ok(config.includes(`./fonts/${file}-Variable.ttf`));
        assert.ok(config.includes(`weight: '${weight}'`));
        assert.ok(config.includes("display: 'swap'"));
    }
});
