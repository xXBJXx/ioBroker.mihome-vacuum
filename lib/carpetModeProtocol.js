'use strict';

function isCarpetModeSupported(response) {
    return !!response.result && response.result !== 'unknown_method';
}

function parseCarpetMode(response) {
    if (response.result && (response.result[0].enable === 0 || response.result[0].enable === 1)) {
        return {
            enabled: response.result[0].enable === 1,
            settings: response.result[0],
        };
    }
    return null;
}

module.exports = {
    isCarpetModeSupported,
    parseCarpetMode,
};
