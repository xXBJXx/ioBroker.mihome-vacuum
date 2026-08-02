'use strict';

function parseRoomMapping(response) {
    if (response.result && response.result !== 'unknown_method' && response.result.length) {
        return response.result;
    }
    return null;
}

module.exports = {
    parseRoomMapping,
};
