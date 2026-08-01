'use strict';

//const Miio = require("iobroker.mihome-vacuum/lib/miio");

const objects = require('./objects');

class ViomiManager {
    constructor(adapterInstance, Miio) {
        this.Miio = Miio;
        this.adapter = adapterInstance;
        this.lastProps = {};
        this.adapter.log.debug('select viomi protocol....');

        this.globalTimeouts = {};
        this.closed = false;

        this.ViomiDevices = [
            'dreame.vacuum.mc1808',
            'viomi.vacuum.v6',
            'viomi.vacuum.v7',
            'viomi.vacuum.v8',
            'viomi.vacuum.v19',
        ];

        // result is for "get_prop" with PARAMS is:
        // [5,3,0,2105,100,0,"0",0,0,10,"0",0,1,1,12,1,1,0,0,0,0,1]
        this.PARAMS = [
            'run_state',
            'suction_grade',
            'mode',
            'err_state',
            'battary_life',
            'start_time',
            'order_time',
            's_time',
            's_area',
            'v_state',
            'zone_data',
            'repeat_state',
            'remember_map',
            'has_map',
            'water_grade',
            'box_type',
            'mop _type',
            'is_mop',
            'light_state',
            'has_newmap',
            'is_charge',
            'is_work',
        ];

        this.ERROR_CODES = {
            500: 'Radar timed out',
            501: 'Wheels stuck',
            502: 'Low battery',
            503: 'Dust bin missing',
            508: 'Uneven ground',
            509: 'Cliff sensor error',
            510: 'Collision sensor error',
            511: 'Could not return to dock',
            512: 'Could not return to dock',
            513: 'Could not navigate',
            514: 'Vacuum stuck',
            515: 'Charging error',
            516: 'Mop temperature error',
            521: 'Water tank is not installed',
            522: 'Mop is not installed',
            525: 'Insufficient water in water tank',
            527: 'Remove mop',
            528: 'Dust bin missing',
            529: 'Mop and water tank missing',
            530: 'Mop and water tank missing',
            531: 'Water tank is not installed',
            2101: 'Unsufficient battery, continuing cleaning after recharge',
            2105: 'No Error',
        };

        this.STATES = {
            '-1': 'Unknown',
            0: 'IdleNotDocked ',
            1: 'Idle',
            2: 'Idle 2',
            3: 'Cleaning',
            4: 'Returning ',
            5: 'Docked',
            6: 'VacuumingAndMopping',
        };

        this.FANSPEED = {
            0: 'Silent',
            1: 'Standard',
            2: 'Medium',
            3: 'Turbo',
        };

        this.MODE = {
            0: 'Vacuum',
            1: 'VacuumAndMop',
            2: 'Mop',
        };

        this.main();
    }
    async main() {
        await this.initStates();

        if (this.closed) {
            return;
        }
        this.getStates();
    }
    async getStates() {
        if (this.closed) {
            return;
        }
        clearTimeout(this.globalTimeouts['getStates']);
        let DeviceData;

        this.adapter.log.debug('get params for Viomi');
        try {
            DeviceData = await this.Miio.sendMessage('get_prop', this.PARAMS);
            this.adapter.log.debug('Received parameters for Viomi');
        } catch {
            DeviceData = null;
            if (!this.closed) {
                this.adapter.log.debug('Could not receive Viomi parameters');
            }
        }

        if (this.closed) {
            return;
        }

        if (DeviceData && Array.isArray(DeviceData.result)) {
            const answer = DeviceData.result;
            answer.slice(0, this.PARAMS.length).forEach((element, index) => {
                const objExist = objects.viomiObjects.find(
                    stateDefinition => stateDefinition._id === this.PARAMS[index],
                );

                this.lastProps[this.PARAMS[index]] = element;

                if (typeof objExist !== 'undefined') {
                    if (objExist.common.type === 'boolean') {
                        this.adapter.setStateAsync(`control.${this.PARAMS[index]}`, {
                            val: !!element,
                            ack: true,
                        });
                    } else {
                        this.adapter.setStateAsync(`control.${this.PARAMS[index]}`, {
                            val: element,
                            ack: true,
                        });
                    }
                }
            });
        }
        if (!this.closed) {
            this.globalTimeouts['getStates'] = setTimeout(this.getStates.bind(this), this.adapter.config.pingInterval);
        }
    }

    /** Parses the answer of get_room_mapping */
    async initStates() {
        objects.viomiObjects.map(o => this.adapter.setObjectNotExistsAsync(`control${o._id ? `.${o._id}` : ''}`, o));
    }

    async stateChange(id, state) {
        if (!state || state.ack) {
            return;
        }
        const terms = id.split('.');
        const command = terms.pop();
        let data;
        let actionMode, method, params;

        try {
            switch (command) {
                case 'suction_grade':
                    data = await this.Miio.sendMessage('set_suction', [state.val]);

                    this.adapter.log.debug('change suction_grade');
                    if (data) {
                        this.adapter.setStateAsync(id, {
                            val: state.val,
                            ack: true,
                        });
                    }
                    break;
                case 'water_grade':
                    data = await this.Miio.sendMessage('set_suction', [state.val]);

                    this.adapter.log.debug('change water_grade');
                    if (data) {
                        this.adapter.setStateAsync(id, {
                            val: state.val,
                            ack: true,
                        });
                    }
                    break;
                case 'is_mop':
                    data = await this.Miio.sendMessage('set_mop', [state.val]);

                    this.adapter.log.debug('change mop');
                    if (data) {
                        this.adapter.setStateAsync(id, {
                            val: state.val,
                            ack: true,
                        });
                    }
                    break;
                case 'light_state':
                    data = await this.Miio.sendMessage('set_light', [state.val ? 1 : 0]);

                    this.adapter.log.debug('change light_state');
                    if (data) {
                        this.adapter.setStateAsync(id, {
                            val: state.val,
                            ack: true,
                        });
                    }
                    break;
                case 'start':
                    if (this.lastProps.mode === 4) {
                        //i dont know now
                        return;
                    }
                    if (this.lastProps.mode === 2) {
                        actionMode = 2;
                    } else {
                        if (this.lastProps.is_mop === 2) {
                            actionMode = 3;
                        } else {
                            actionMode = this.lastProps.is_mop;
                        }
                    }
                    if (this.lastProps.mode === 3) {
                        method = 'set_mode';
                        params = [3, 1];
                    } else {
                        method = 'set_mode_withroom';
                        params = [actionMode, 1, 0];
                    }

                    data = await this.Miio.sendMessage(method, params);

                    this.adapter.log.debug(`start with: ${method}`);

                    if (data) {
                        this.adapter.setStateAsync(id, {
                            val: state.val,
                            ack: true,
                        });
                    }
                    break;
                case 'pause':
                    if (this.lastProps.mode === 4) {
                        //i dont know now
                        return;
                    }
                    if (this.lastProps.mode === 2) {
                        actionMode = 2;
                    } else {
                        if (this.lastProps.is_mop === 2) {
                            actionMode = 3;
                        } else {
                            actionMode = this.lastProps.is_mop;
                        }
                    }
                    if (this.lastProps.mode === 3) {
                        method = 'set_mode';
                        params = [3, 3];
                    } else {
                        method = 'set_mode_withroom';
                        params = [actionMode, 3, 0];
                    }

                    data = await this.Miio.sendMessage(method, params);

                    this.adapter.log.debug(`pause with: ${method}`);

                    if (data) {
                        this.adapter.setStateAsync(id, {
                            val: state.val,
                            ack: true,
                        });
                    }
                    break;
                case 'stop':
                    if (this.lastProps.mode === 3) {
                        method = 'set_mode';
                        params = [3, 0];
                    } else if (this.lastProps.is_mop === 4) {
                        method = 'set_pointclean';
                        params = [0, 0, 0];
                    } else {
                        method = 'set_mode';
                        params = [0];
                    }
                    data = await this.Miio.sendMessage(method, params);

                    this.adapter.log.debug(`stop with: ${method}`);

                    if (data) {
                        this.adapter.setStateAsync(id, {
                            val: state.val,
                            ack: true,
                        });
                    }
                    break;
                case 'return_dock':
                    data = await this.Miio.sendMessage('set_charge', [1]);

                    this.adapter.log.debug('change mop');
                    if (data) {
                        this.adapter.setStateAsync(id, {
                            val: state.val,
                            ack: true,
                        });
                    }
                    break;
                default:
                    break;
            }
        } catch {
            this.adapter.log.warn(`Cannot send Viomi command ${command}; please try again`);
        }
    }

    startClean() {
        //return 'set_mode_withroom', [0, 1, 0];
    }

    async close() {
        if (this.closed) {
            return;
        }
        this.closed = true;
        Object.keys(this.globalTimeouts).forEach(
            id => this.globalTimeouts[id] && clearTimeout(this.globalTimeouts[id]),
        );
        this.globalTimeouts = {};
    }
}
module.exports = ViomiManager;
