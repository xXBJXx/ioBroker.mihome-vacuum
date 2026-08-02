'use strict';

function parseWifiSignal(response) {
    if (!response.result || response.result === 'unknown_method' || !response.result.rssi) {
        return null;
    }
    return response.result.rssi;
}

module.exports = {
    parseWifiSignal,
};
