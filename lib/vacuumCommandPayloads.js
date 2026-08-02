'use strict';

function parseGoToCoordinates(params) {
    const coordinates = params.split(',');
    if (coordinates.length !== 2) {
        return { coordinates: null, error: 'argument_count' };
    }

    const xValue = coordinates[0];
    const yValue = coordinates[1];
    if (isNaN(yValue) || isNaN(xValue)) {
        return { coordinates: null, error: 'invalid_coordinate' };
    }

    return {
        coordinates: [parseInt(xValue), parseInt(yValue)],
        error: null,
    };
}

function createRemoteMovePayload(params) {
    const move = [
        {
            omega: params.angularVelocity,
            velocity: params.velocity,
            seqnum: params.sequenceNumber,
            duration: params.duration,
        },
    ];
    return [move];
}

module.exports = {
    createRemoteMovePayload,
    parseGoToCoordinates,
};
