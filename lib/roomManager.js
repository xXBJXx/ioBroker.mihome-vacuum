'use strict';

class RoomManager {
    constructor(adapterInstance, i18nInstance) {
        this.adapter = adapterInstance;
        this.i18n = i18nInstance;
        this.stateRoomClean = {
            type: 'state',
            common: {
                name: this.i18n.cleanRoom,
                type: 'boolean',
                role: 'button',
                read: false,
                write: true,
                def: false,
                desc: 'Start Room Cleaning',
                smartName: this.i18n.cleanRooms,
            },
            native: {},
        };
        this.stateRoomStatus = {
            type: 'state',
            common: {
                name: 'info',
                type: 'string',
                role: 'info',
                read: true,
                write: false,
                def: '',
                desc: 'Status of Cleaning',
            },
            native: {},
        };
        this.stateRoomRepeat = {
            type: 'state',
            common: {
                name: 'repeat',
                type: 'number',
                role: 'level.repeat',
                read: true,
                write: true,
                min: 1,
                max: 10,
                step: 1,
                def: 1,
                desc: 'number of iterations',
            },
            native: {},
        };
        this.adapter.setObject('rooms.loadRooms', {
            type: 'state',
            common: {
                name: this.i18n.loadRooms,
                type: 'boolean',
                role: 'button',
                read: false,
                write: true,
                def: false,
                desc: "loads id's from stored rooms",
            },
            native: {},
        });
        this.adapter.setObject('rooms.multiRoomClean', {
            type: 'state',
            common: {
                name: this.i18n.cleanMultiRooms,
                type: 'boolean',
                role: 'button',
                read: false,
                write: true,
                def: false,
                desc: 'clean all rooms, which are connected to this datapoint',
            },
            native: {},
        });
        this.adapter.setObject(
            'rooms.addRoom',
            {
                type: 'state',
                common: {
                    name: this.i18n.addRoom,
                    type: 'string',
                    role: 'value',
                    read: true,
                    write: true,
                    desc: 'add roos manual with map Index or zone coordinates',
                },
                native: {},
            },
            (err, obj) => obj && this.adapter.setForeignState(obj.id, this.i18n.addRoom, true),
        );

        this.adapter.getStates(`${this.adapter.namespace}.rooms.*`, (err, states) => {
            if (states) {
                for (const stateId in states) {
                    if (stateId.endsWith('.mapIndex')) {
                        this.updateRoomStates(stateId.slice(0, -'.mapIndex'.length));
                    }
                }
            }
        });
    }

    /**
     * Parses the answer of get_room_mapping  "result":[[16,"881001046149"],[17,"881001046154"],[18,"881001046142"],[19,"881001046148"]
     *
     * @param response answer
     */
    processRoomMaping(response) {
        const rooms = {};
        let room;
        if (typeof response.result !== 'object') {
            return false;
        }

        for (const r in response.result) {
            room = response.result[r];
            if (room[1]) {
                rooms[room[1]] = room[0];
            } else {
                this.adapter.log.warn(`empty roomid for segment ${room[0]}`);
            }
        }
        this.adapter.getChannelsOf('rooms', (err, roomObjs) => {
            if (roomObjs) {
                for (const r in roomObjs) {
                    const roomObj = roomObjs[r];
                    const extRoomId = roomObj._id.split('.').pop();
                    if (extRoomId.indexOf('manual_') === -1) {
                        room = rooms[extRoomId];
                        if (!room) {
                            this.adapter.setStateChanged(
                                `${roomObj._id}.mapIndex`,
                                this.i18n.notAvailable,
                                true,
                                (err, id, notChanged) => {
                                    if (!notChanged) {
                                        this.adapter.log.info(`room: ${extRoomId} not mapped`);
                                        this.adapter.setState(`${roomObj._id}.state`, this.i18n.notAvailable, true);
                                    }
                                },
                            );
                        } else {
                            const roomNo = parseInt(room, 10);
                            this.adapter.setStateChanged(
                                `${roomObj._id}.mapIndex`,
                                roomNo,
                                true,
                                (err, id, notChanged) => {
                                    if (!notChanged) {
                                        this.adapter.log.info(`room: ${extRoomId} mapped with index ${roomNo}`);
                                        this.updateRoomStates(roomObj._id);
                                    }
                                },
                            );
                            delete rooms[extRoomId];
                        }
                    }
                }
            }
            for (const extRoomId in rooms) {
                this.adapter.getObject(`rooms.${extRoomId}`, (err, roomObj) => {
                    if (roomObj) {
                        this.adapter.setStateChanged(`${roomObj._id}.mapIndex`, rooms[extRoomId], true);
                    } else {
                        this.createRoom(extRoomId, rooms[extRoomId]);
                    }
                });
            }
        });
    }

    cleanRooms(mapIndexStates) {
        this.adapter.getForeignStates(mapIndexStates, (err, states) => {
            const mapIndex = [];
            const zones = [];
            const mapChannels = [];
            const zoneChannels = [];
            if (states) {
                for (const stateId in states) {
                    if (stateId.indexOf('.mapIndex') > 0) {
                        const val = (states[stateId] && states[stateId].val) || 'invalid';
                        if (!isNaN(val)) {
                            mapIndex.indexOf(parseInt(val, 10)) === -1 &&
                                mapIndex.push(val) &&
                                mapChannels.push(stateId.replace(/\.([^.]+)$/, ''));
                        } else if (val[0] === '[') {
                            zones.indexOf(val) === -1 &&
                                zones.push(val) &&
                                zoneChannels.push(stateId.replace(/\.([^.]+)$/, ''));
                        } else {
                            this.adapter.log.error(
                                `could not clean ${stateId}, because mapIndex/zone is invalid: ${val}`,
                            );
                        }
                    } else {
                        this.adapter.log.error(`state must be .mapIndex for roomManager.cleanRooms ${stateId}`);
                    }
                }
                if (mapIndex.length > 0) {
                    this.adapter.sendTo(this.adapter.namespace, 'cleanSegments', {
                        segments: mapIndex,
                        channels: mapChannels,
                    });
                }
                if (zones.length > 0) {
                    this.adapter.sendTo(this.adapter.namespace, 'cleanZone', { zones: zones, channels: zoneChannels });
                }
            }
        });
    }

    // search for assigned roomObjs or id on timer or other state
    cleanRoomsFromState(id) {
        this.adapter.getForeignObjects(id, 'state', 'rooms', (err, states) => {
            if (states && states[id].native) {
                const mapIndex = [];
                if (states[id].native.channels) {
                    for (const i in states[id].native.channels) {
                        mapIndex.push(
                            this.adapter.namespace.concat('.rooms.', states[id].native.channels[i], '.mapIndex'),
                        );
                    }
                }
                let rooms = '';
                for (const r in states[id].enums) {
                    rooms += r;
                }

                if (rooms.length > 0) {
                    this.findMapIndexByRoom(rooms, states => this.cleanRooms(mapIndex.concat(states)));
                } else if (mapIndex.length > 0) {
                    this.cleanRooms(mapIndex);
                } else {
                    this.adapter.log.warn(`no room found for ${id}`);
                }
            }
        });
    }

    findMapIndexByRoom(rooms, callback) {
        // Keep the wildcard at the end so js-controller can use the namespace prefix index.
        // The suffix filter below preserves the former *.mapIndex result exactly.
        this.adapter.getForeignObjects(`${this.adapter.namespace}.rooms.*`, 'state', 'rooms', (err, states) => {
            if (states) {
                const mapIndexStates = [];
                for (const stateId in states) {
                    for (const r in states[stateId].enums) {
                        if (rooms.indexOf(r) >= 0 && stateId.endsWith('.mapIndex')) {
                            // bug in js-controller 1.5, that not only mapIndex in states
                            mapIndexStates.push(stateId);
                        }
                    }
                }
                callback && callback(mapIndexStates);
            }
        });
    }

    findChannelsByMapIndex(mapList, callback) {
        this.adapter.getStates('rooms.*', (err, states) => {
            const channels = [];
            if (states) {
                for (const stateId in states) {
                    if (stateId.endsWith('.mapIndex') && states[stateId] && mapList.indexOf(states[stateId].val) >= 0) {
                        channels.push(stateId.replace(/\.([^.]+)$/, ''));
                    }
                }
            }
            callback && callback(channels);
        });
    }

    async createRoom(roomId, mapIndex) {
        this.adapter.log.info(`create new room: ${roomId}`);
        const roomObjectId = `rooms.${roomId}`;
        try {
            await this.adapter.setObjectNotExistsAsync(roomObjectId, {
                type: 'channel',
                common: { name: roomId },
                native: {},
            });
            const commonZone = {
                name: 'map zone',
                type: 'string',
                role: 'value',
                read: false,
                write: false,
                desc: 'coordinates of map zone',
            };
            const commonMap = {
                name: 'map index',
                type: 'number',
                role: 'value',
                read: false,
                write: false,
                desc: 'index of assigned map',
            };
            await this.adapter.setObjectNotExistsAsync(`${roomObjectId}.mapIndex`, {
                type: 'state',
                common: typeof mapIndex === 'string' && mapIndex.startsWith('[') ? commonZone : commonMap,
                native: {},
            });
            await this.adapter.setStateAsync(`${roomObjectId}.mapIndex`, mapIndex, true);
            this.updateRoomStates(roomObjectId);
        } catch {
            this.adapter.log.warn(`Could not create room objects for ${roomId}`);
        }
    }

    updateRoomStates(roomObj_id) {
        this.adapter.setObjectNotExists(`${roomObj_id}.roomClean`, this.stateRoomClean);
        this.adapter.setObjectNotExists(`${roomObj_id}.state`, this.stateRoomStatus, () =>
            this.adapter.setForeignState(`${roomObj_id}.state`, '', true),
        );
        this.adapter.setObjectNotExists(`${roomObj_id}.repeat`, this.stateRoomRepeat);
        this.adapter.getObject('control.fan_power', (err, obj) => {
            obj &&
                this.adapter.getState(obj._id, () => {
                    this.adapter.setObjectNotExists(
                        `${roomObj_id}.roomFanPower`,
                        {
                            type: 'state',
                            common: obj.common,
                            native: {},
                        },
                        //,err => !err && comonState && adapter.setState(roomObj_id + '.roomFanPower', comonState.val, false)
                    );
                });
        });
        this.adapter.getObject('control.water_box_mode', (err, obj) => {
            obj &&
                this.adapter.getState(obj._id, () => {
                    this.adapter.setObjectNotExists(
                        `${roomObj_id}.roomWaterBoxMode`,
                        {
                            type: 'state',
                            common: obj.common,
                            native: {},
                        },
                        //,err => !err && comonState && adapter.setState(roomObj_id + '.roomWaterBoxMode', comonState.val, false)
                    );
                });
        });
        this.adapter.getObject('control.water_box_level', (err, obj) => {
            obj &&
                this.adapter.getState(obj._id, () => {
                    this.adapter.setObjectNotExists(
                        `${roomObj_id}.roomWaterBoxLevel`,
                        {
                            type: 'state',
                            common: obj.common,
                            native: {},
                        },
                        //,err => !err && comonState && adapter.setState(roomObj_id + '.roomWaterBoxLevel', comonState.val, false)
                    );
                });
        });
        this.adapter.getObject('control.mop_mode', (err, obj) => {
            obj &&
                this.adapter.getState(obj._id, () => {
                    this.adapter.setObjectNotExists(
                        `${roomObj_id}.roomMopMode`,
                        {
                            type: 'state',
                            common: obj.common,
                            native: {},
                        },
                        //,err => !err && comonState && adapter.setState(roomObj_id + '.roomMopMode', comonState.val, false)
                    );
                });
        });
    }
}

module.exports = RoomManager;
