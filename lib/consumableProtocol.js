'use strict';

function detectConsumables(consumable, definitions, commands) {
    const detected = [];
    for (const id in definitions) {
        const valueParameter = commands[`${id}_reset`]?.params;
        if (valueParameter && consumable[valueParameter] != undefined) {
            const definition = definitions[id];
            detected.push({
                id,
                name: valueParameter,
                calc: definition.calc,
                state: definition.state,
                button: definition.button,
            });
        }
    }
    return detected;
}

function calculateConsumableValue(consumable, feature) {
    const value = consumable[feature.name];
    return feature.calc ? 100 - Math.round(value / feature.calc) : value;
}

module.exports = {
    calculateConsumableValue,
    detectConsumables,
};
