const objects = require('./objects');

class FeatureManager {
    constructor(deviceState, adapterInstance) {
        this.deviceState = deviceState;
        this.adapter = adapterInstance;
        this.model = null;
        this.zoneClean = false;
        this.mop_mode = null;
        this.water_box = null;
        this.water_box_mode = null;
        this.dustCollect = null;
        this.washMop = null;
        this.roomMapping = null;
        this.NewSuctionPower = null;
        this.mop = null;
        this.dock_status = null;
        this.consumables = null;
    }

    init() {
        this.adapter.getState('info.device_model', (err, state) => state && state.val && this.setModel(state.val));
        this.adapter.setState('info.wifi_signal', null, true);
    }

    detect() {}

    async setNewSuctionValues(value) {
        if (this.NewSuctionPower === null && value > 100) {
            this.adapter.log.info('change states from State control.fan_power');
            if (['roborock.vacuum.a27'].indexOf(this.deviceState.modell) >= 0) {
                objects.newfan_power.common.max = 108;
                objects.newfan_power.common.states['105'] = 'OFF';
                objects.newfan_power.common.states['108'] = 'MAXIMUM+';
            }
            this.NewSuctionPower = true;
            this.adapter.setObjectAsync('control.fan_power', objects.newfan_power);
            this.adapter.getStates('rooms.*', (err, states) => {
                if (states) {
                    for (const stateId in states) {
                        if (stateId.endsWith('.roomFanPower')) {
                            this.adapter.log.debug(`Updating room fan-power state definition: ${stateId}`);
                            this.adapter.setObjectAsync(stateId, objects.newfan_power);
                        }
                    }
                }
            });
        } else if (this.NewSuctionPower === null && value <= 100) {
            this.NewSuctionPower = false;
        }
    }

    setModel(model) {
        if (this.model !== model) {
            this.adapter.setStateChanged('info.device_model', model, true);
            this.model = model;
        }
    }

    async setWaterBox(waterBoxStatus) {
        if (this.water_box === null) {
            this.water_box = !isNaN(waterBoxStatus);
            if (this.water_box) {
                this.adapter.log.info('create states for water box');
                await this.adapter.setObjectNotExistsAsync('info.water_box', objects.water_box);
            }
        }
    }

    async setDustCollect(dustCollectionStatus) {
        if (this.dustCollect === null) {
            this.dustCollect = !isNaN(dustCollectionStatus);
            if (this.dustCollect) {
                this.adapter.log.info('create states for dust collecting');
                await this.adapter.setObjectNotExistsAsync('control.dustCollect', objects.dustCollect);
            }
        }
    }

    async setWashMop(washMopStatus) {
        if (this.washMop === null) {
            this.washMop = !isNaN(washMopStatus);
            if (this.washMop) {
                this.adapter.log.info('create states for Mop washing');
                await this.adapter.setObjectNotExistsAsync('control.washMop', objects.washMop);
            }
        }
    }

    async setMop(mopStatus) {
        if (typeof mopStatus === 'undefined') {
            return;
        }
        if (this.mop === null) {
            this.mop = !isNaN(mopStatus);
            if (this.mop) {
                this.adapter.log.info('create states for mop');
                await this.adapter.setObjectNotExistsAsync('info.mop', objects.mop);
                objects.newfan_power.common.states['105'] = 'OFF';
            }
        }
        this.adapter.setStateAsync('info.mop', { val: !!mopStatus, ack: true });
    }

    async setWaterBoxMode(waterBoxMode, distanceOff) {
        if (this.water_box_mode === null && waterBoxMode) {
            this.water_box_mode = !isNaN(waterBoxMode);
            if (this.water_box_mode) {
                this.adapter.log.info('create states for water box mode');
                if (!isNaN(distanceOff)) {
                    this.water_box_mode = 2;
                    objects.water_box_mode.common.max = 207;
                    objects.water_box_mode.common.states[207] = 'LEVEL';
                    await this.adapter.setObjectNotExistsAsync('control.water_box_level', objects.water_box_level);
                }
                await this.adapter.setObjectAsync('control.water_box_mode', objects.water_box_mode);
            }
        }
    }

    async setMopMode(mopMode) {
        if (this.mop_mode === null && mopMode) {
            this.mop_mode = !isNaN(mopMode);
            if (this.mop_mode) {
                this.adapter.log.info('create states for mop mode');
                await this.adapter.setObjectNotExistsAsync('control.mop_mode', objects.mop_mode);
            }
        }
    }

    async setDockStatus(dockStatus) {
        if (this.dock_status === null && typeof dockStatus != 'undefined') {
            this.dock_status = !isNaN(dockStatus);
            if (this.dock_status) {
                this.adapter.log.info('create states for dock status');
                await this.adapter.setObjectNotExistsAsync('info.dock_status', objects.dock_status);
            }
        }
    }
}

module.exports = FeatureManager;
