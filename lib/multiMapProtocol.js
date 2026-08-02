'use strict';

function parseMultiMapList(response) {
    if (!response.result || response.result === 'unknown_method') {
        return null;
    }

    const maps = response.result[0].map_info;
    const states = {};
    maps.forEach(map => {
        states[map.mapFlag] = map.name !== '' ? map.name : `${map.mapFlag}`;
    });

    return { maps, states };
}

module.exports = {
    parseMultiMapList,
};
