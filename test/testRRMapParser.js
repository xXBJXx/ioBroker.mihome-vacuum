const assert = require('node:assert/strict');
const RRMapParser = require('../lib/RRMapParser');

describe('RR map header parser', () => {
    it('parses the stable RR map header fields', () => {
        const map = Buffer.alloc(0x14);
        map.write('rr', 0, 'ascii');
        map.writeUInt16LE(0x14, 0x02);
        map.writeUInt16LE(128, 0x04);
        map.writeUInt16LE(2, 0x08);
        map.writeUInt16LE(7, 0x0a);
        map.writeUInt16LE(42, 0x0c);
        map.writeUInt16LE(9, 0x10);

        assert.deepEqual(RRMapParser.PARSE(map), {
            header_length: 0x14,
            data_length: 128,
            version: { major: 2, minor: 7 },
            map_index: 42,
            map_sequence: 9,
        });
    });

    it('rejects data without an RR map signature', () => {
        assert.deepEqual(RRMapParser.PARSE(Buffer.alloc(0x14)), {});
        assert.equal(RRMapParser.PARSEDATA(Buffer.alloc(0x14)), null);
    });
});
