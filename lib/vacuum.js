/* eslint-disable no-prototype-builtins, jsdoc/check-tag-names */
'use strict';
// const utils = require('@iobroker/adapter-core');
// const {hostname} = require('os');
// const miio = null;
const objects = require('./objects');
const TimerManager = require('./timerManager.js');
const RoomManager = require('./roomManager');
const MapHelper = require('./maphelper');
const commands = require('./stockCommands');

global.systemDictionary = require('../admin/words.js');

// const lastProps = {};

// const userLang = 'en';
// this parts will be translated
const i18n = {
    weekDaysFull: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    notAvailable: 'not available',
    nextTimer: 'next timer',
    loadRooms: 'load rooms from robot',
    cleanRoom: 'clean Room',
    cleanMultiRooms: 'clean assigned rooms',
    addRoom: 'insert map Index or zone coordinates',
    waterBox_installed: 'water box installed',
    waterBox_filter: 'clean water Filter',
    waterBox_filter_reset: 'water filter reset',
    waitingPos: 'waiting position',
};

const errorTexts = {
    0: 'No error',
    1: 'Laser distance sensor error',
    2: 'Collision sensor error',
    3: 'Wheels on top of void, move robot',
    4: 'Clean hovering sensors, move robot',
    5: 'Clean main brush',
    6: 'Clean side brush',
    7: 'Main wheel stuck?',
    8: 'Device stuck, clean area',
    9: 'Dust collector missing',
    10: 'Clean filter',
    11: 'Stuck in magnetic barrier',
    12: 'Low battery',
    13: 'Charging fault',
    14: 'Battery fault',
    15: 'Wall sensors dirty, wipe them',
    16: 'Place me on flat surface',
    17: 'Side brushes problem, reboot me',
    18: 'Suction fan problem',
    19: 'Unpowered charging station',
};

const cleanStates = {
    Unknown: 0,
    Initiating: 1,
    Sleeping: 2,
    Waiting: 3,
    Remote: 4,
    Cleaning: 5,
    Back_toHome: 6,
    ManuellMode: 7,
    Charging: 8,
    Charging_Error: 9,
    Pause: 10,
    SpotCleaning: 11,
    InError: 12,
    ShuttingDown: 13,
    Updating: 14,
    Docking: 15,
    GoingToSpot: 16,
    ZoneCleaning: 17,
    RoomCleaning: 18,
    DustCollecting: 22,
    CleaningMop: 23,
    GoingMopClean: 26,
};

const activeCleanStates = {
    5: {
        name: 'all ',
        resume: 'app_start',
    },
    11: {
        name: 'spot ',
        resume: 'app_spot',
    },
    17: {
        name: 'zone ',
        resume: 'resume_zoned_clean',
    },
    18: {
        name: 'segment ',
        resume: 'resume_segment_clean',
    },
    22: {
        name: 'dust collecting ',
    },
    23: {
        name: 'clean mop ',
    },
    26: {
        name: 'going to mop clean ',
    },
};

const defaultCarpetModeSettings = {
    enabled: 1,
    stall_time: 10,
    low: 400,
    high: 500,
    integral: 450,
};

/**
 * @typedef {object} VacuumDeviceState
 * @property {string} modell Detected vacuum model.
 * @property {{ carpetMode: boolean | null, roomMapping: boolean | null }} features Detected feature flags.
 * @property {unknown[]} lastGoto Last go-to coordinates.
 * @property {unknown[][]} lastZone Last zone-clean coordinates.
 * @property {unknown} [firmware] Detected firmware version.
 * @property {unknown[]} [rooms] Detected room mapping.
 */

class VacuumManager {
    constructor(adapterInstance, Miio) {
        this.Miio = Miio;
        this.Map = new MapHelper(null, adapterInstance);
        this.device = adapterInstance.device;
        /** @type {VacuumDeviceState} */
        this.vacuum = {
            modell: adapterInstance.device,
            features: { carpetMode: null, roomMapping: null },
            lastGoto: [],
            lastZone: [[]],
        };
        this.carpetModeSettings = { ...defaultCarpetModeSettings };
        this.adapter = adapterInstance;
        this.globalTimeouts = {};
        this.closed = false;
        this.logEntries = [];
        this.Error = false;

        // remember last Map State
        this.lastMapState = null;

        // values for Roboter StatusControl
        this.cleandState = cleanStates.Unknown; // current robot Status
        this.cleanActiveState = 0; // if robot is working, than here the status is saved
        // this.checkCleanState = null;
        this.activeChannels = null;
        this.queue = []; // if new job is called, while robot is already cleaning

        // values for Map
        // this.mapRetries = 0;
        this.mapPointer = '';
        this.mapLastSave = Date.now();
        this.mapGet = false;
        this.mapEnable = this.adapter.config.enableMiMap || this.adapter.config.valetudo_enable;
        // MAP initial
        this.cMapPoll = 900000; // 15 Min
        this.cMapLastPoll = 0;
        this.mapSaveIntervall = parseInt(this.adapter.config.valetudo_MapsaveIntervall, 10) || 5000;
        this.mapPollIntervall = parseInt(this.adapter.config.valetudo_requestIntervall, 10) || 2000;
        this.mapReady = {
            login: false,
            mappointer: false,
        };

        this.adapter.getState('info.device_fw', (err, state) => {
            if (state && state.val) {
                this.vacuum.firmware = state.val;
            }
        });

        this.startUp = {
            getMultiMapsList: this.getMultiMapsList,
            setGetCleanSummary: this.setGetCleanSummary,
            setGetConsumable: this.setGetConsumable,
        };

        this.adapter.log.info('Using standard vacuum protocol');
        this.features = new FeatureManager(this.vacuum, this.adapter);
        this.roomManager = new RoomManager(this.adapter, i18n);
        this.timerManager = new TimerManager(this.adapter, i18n);

        this.main();
    }

    async main() {
        await this.initStates();
        await this.init();
        this.getStates();
    }

    async init() {
        //übersetzte Begriffe
        // adapter.log.debug(JSON.stringify(adapter.systemDictionary));
        // adapter.getForeignObjectAsync('system.config').then( systemConfig => {
        //     if (systemConfig && systemConfig.common && systemConfig.common.language && systemDictionary.Sunday[systemConfig.common.language]) {
        //         userLang = systemConfig.common.language;
        //         let obj;
        //         for (const i in i18n) {
        //             obj = i18n[i];
        //             if (typeof obj == 'string') {
        //                 i18n[i] = systemDictionary[obj][userLang];
        //             } else if (typeof obj == 'object') {
        //                 for (const o in obj) {
        //                     obj[o] = systemDictionary[obj[o]][userLang];
        //                 }
        //             }
        //         }
        //     }
        // });

        if (this.adapter.config.enableMiMap) {
            await this.Map.login()
                .then(result => {
                    //reqParams.push('get_map_v1'); todo: is this necessary, or it is enough with mapPoll?
                    this.mapReady.login = result.ok;
                })
                .catch(error => this.adapter.log.warn(error));
        } else if (this.adapter.config.valetudo_enable) {
            //this._MapPoll();
        }

        await Promise.all(
            objects.stockControl.map(async o => {
                const contents = await this.adapter.setObjectNotExistsAsync(`control${o._id ? `.${o._id}` : ''}`, o);
                contents && this.adapter.log.debug(`Create State for control: ${JSON.stringify(contents)}`);
            }),
        );
        await Promise.all(
            objects.stockInfo.map(async o => {
                const contents = await this.adapter.setObjectNotExistsAsync(`info${o._id ? `.${o._id}` : ''}`, o);
                contents && this.adapter.log.debug(`Create State for stockInfo: ${JSON.stringify(contents)}`);
            }),
        );
        await Promise.all(
            objects.stockHistory.map(async o => {
                const contents = await this.adapter.setObjectNotExistsAsync(`history${o._id ? `.${o._id}` : ''}`, o);
                contents && this.adapter.log.debug(`Create State for stockHistory: ${JSON.stringify(contents)}`);
            }),
        );
        await Promise.all(
            objects.roomStates.map(async o => {
                await this.adapter.setObjectNotExistsAsync(`info${o._id ? `.${o._id}` : ''}`, o);
                this.adapter.log.debug(`Create State for Queue: ${o._id}`);
            }),
        );

        // check if resume Zoneclean is enabled
        !this.adapter.config.enableResumeZone &&
            (await Promise.all(
                objects.enableResumeZone.map(async o => {
                    const contents = await this.adapter.setObjectNotExistsAsync(
                        `control${o._id ? `.${o._id}` : ''}`,
                        o,
                    );
                    contents &&
                        this.adapter.log.debug(`Create State for enableResumeZone: ${JSON.stringify(contents)}`);
                }),
            ));

        //chek if map is enabled -> therefore, that this datapoints also need for multifloor, we have to add them always
        //if (adapter.config.enableMiMap || adapter.config.valetudo_enable) {
        //adapter.log.info('create states for map');
        await Promise.all(
            objects.mapObjects.map(async o => {
                await this.adapter.setObjectNotExistsAsync(`cleanmap${o._id ? `.${o._id}` : ''}`, o);
                this.adapter.log.debug(`Create State for map: ${o._id}`);
            }),
        );
        /*} else {
			adapter.log.info('Map not selected delete states...');
			objects.mapObjects.map(async o => await this.delObj('map' + (o._id ? '.' + o.id : '')));
		}*/

        this.adapter.config.enableResumeZone &&
            objects.enableResumeZone.map(async o => await this.delObj(`control${o._id ? `.${o.id}` : ''}`));

        this.adapter.log.debug('Create State done!');
    }

    async delObj(id) {
        try {
            await this.adapter.delObjectAsync(id);
        } catch (error) {
            this.adapter.log.debug(error);
        }
    }

    async getStates() {
        clearTimeout(this.globalTimeouts['getStates']);
        if (this.closed) {
            return;
        }
        // let DeviceData;

        this.adapter.log.debug('get params for stock Vacuum');
        try {
            // DeviceData = await this.Miio.sendMessage('get_map_v1');
            await this.setGetStatus();
            if (this.closed) {
                return;
            }
            await this.getSetNetwork();
            if (this.closed) {
                return;
            }
            await this.setGetSoundVolume();
            if (this.closed) {
                return;
            }
            // await this.setGetConsumable();
            // await this.setGetCleanSummary();
            // await this.getMultiMapsList();
            // NoError = true;
            await this.getOnlyAtStart();
            if (this.closed) {
                return;
            }

            if (Date.now() - this.cMapLastPoll > this.cMapPoll && this.mapGet) {
                await this.getMapPointer();
                if (this.closed) {
                    return;
                }
            }

            this.timerManager && this.timerManager.check();
            // Promise.all([statusObj, soundObj, consumableObj, cleaningObj]).catch(function (err) {
            // 	adapter.log.error(err);
            // });
        } catch (error) {
            if (!this.closed) {
                this.adapter.log.warn(`ERROR${error}`);
            }
        }

        if (this.closed) {
            return;
        }

        //carpetMode first run to create States need no Error to detect if Messages receive before
        if (!this.Error && this.vacuum.features.carpetMode === null) {
            await this.checkFeaturesCarpet();
            if (this.closed) {
                return;
            }
        }
        this.vacuum.features.carpetMode && (await this.setGetCarpetMode());
        if (this.closed) {
            return;
        }

        //Room Mapping first run to create States need no Error to detect if Messages receive before
        if (!this.Error && this.features.roomMapping === null) {
            await this.checkFeaturesRoomMapping();
            if (this.closed) {
                return;
            }
        }

        this.globalTimeouts['getStates'] = setTimeout(this.getStates.bind(this), this.adapter.config.pingInterval);
    }
    async getOnlyAtStart() {
        for (const __fkt in this.startUp) {
            if (this.closed) {
                return;
            }
            const isTrue = await this[__fkt]();
            if (this.closed) {
                return;
            }
            this.adapter.log.debug(`Startup: ${__fkt} Answer: ${isTrue}`);

            if (isTrue) {
                delete this.startUp[__fkt];
                this.adapter.log.debug(`Startup: Delete ${__fkt}`);
            }
        }
    }

    async getSetNetwork() {
        try {
            const answer = await this.Miio.sendMessage('get_network_info');
            if (answer.result && answer.result !== 'unknown_method' && answer.result.rssi) {
                await this.adapter.setStateAsync('deviceInfo.wifi_signal', {
                    val: answer.result.rssi,
                    ack: true,
                });
            }
        } catch (error) {
            this.adapter.log.debug(`Error at getSetNetwork: ${error}`);
        }
    }

    async getMultiMapsList() {
        //get_multi_maps_list
        try {
            const answer = await this.Miio.sendMessage('get_multi_maps_list');
            if (answer.result && answer.result !== 'unknown_method') {
                const maps = answer.result[0].map_info;
                this.adapter.log.debug(`States for ${maps.length} Map: ${JSON.stringify(maps)}`);
                if (maps.length > 0) {
                    const stateArray = {};
                    maps.forEach(__map => {
                        stateArray[__map.mapFlag] = __map.name !== '' ? __map.name : `${__map.mapFlag}`;
                    });
                    this.adapter.log.debug(`States for Map: ${JSON.stringify(stateArray)}`);
                    this.adapter.extendObjectAsync('cleanmap.actualMap', {
                        common: {
                            states: stateArray,
                        },
                    });
                    return true;
                }
                return true;
            }
            return true;
        } catch (error) {
            this.adapter.log.debug(error);
            return false;
        }
    }

    async checkFeaturesRoomMapping() {
        try {
            const answer = await this.Miio.sendMessage('get_room_mapping');
            if (answer.result && answer.result !== 'unknown_method' && answer.result.length) {
                this.features.roomMapping = true;

                this.vacuum.rooms = [answer.result];
                this.vacuum.features.roomMapping = true;

                this.roomManager.processRoomMaping(answer);

                // check again in 15 min
                this.globalTimeouts['getRoomMap'] = setTimeout(this.checkFeaturesRoomMapping.bind(this), 900000);
            } else {
                this.features.roomMapping = false;
                this.vacuum.features.roomMapping = false;
                if (typeof this.vacuum.rooms === 'undefined') {
                    this.vacuum.features.roomMapping = false;
                }
            }
        } catch (error) {
            this.features.roomMapping = false;
            this.globalTimeouts['getRoomMap'] = setTimeout(this.checkFeaturesRoomMapping.bind(this), 900000);
            this.adapter.log.debug(error);
        }
    }

    async getMapPointer() {
        clearTimeout(this.globalTimeouts['getMapData']);
        //if map is not enabled, dont do anything to prevent rate limit
        if (!this.mapEnable) {
            return;
        }

        //valetudo dont need a mappointer so go on
        if (this.adapter.config.valetudo_enable) {
            this.getMapData();
            return;
        }

        try {
            for (let index = 0; index < 5; index++) {
                let answer = await this.Miio.sendMessage('get_map_v1');
                if (answer.result) {
                    answer = answer.result[0];

                    if (answer.split('%').length === 1) {
                        if (answer.startsWith('map_slot')) {
                            return;
                        }
                    } else if (answer.split('%').length === 3) {
                        this.mapPointer = answer;
                        this.adapter.log.debug('Mappointer_updated');
                        this.mapReady.mappointer = true;
                        await this.getMapData();
                        return;
                    }
                }
                // robo need some time to generate mappointer if he wants a "retry"
                await this.delay(300);
            }
            // received no Mappointer, try again in ...
            if (this.mapGet) {
                this.globalTimeouts['getMapData'] = setTimeout(async () => {
                    this.adapter.log.debug('Get Mappointer while cleaning');
                    this.mapEnable && this.getMapPointer(); // get pointer only by mimap
                }, this.mapPollIntervall);
            }
            return;
        } catch (error) {
            this.adapter.log.debug(error);
            if (this.mapGet) {
                this.globalTimeouts['getMapData'] = setTimeout(async () => {
                    this.adapter.log.debug('Get Mappointer while cleaning');
                    this.mapEnable && this.getMapPointer(); // get pointer only by mimap
                }, this.mapPollIntervall);
            }
        }
    }

    async delay(time) {
        return new Promise(resolve => (this.globalTimeouts['delay'] = setTimeout(resolve, time)));
    }

    async getMapData() {
        if ((!this.mapReady.mappointer || !this.mapReady.login) && this.adapter.config.enableMiMap) {
            return;
        }
        this.Map.updateMap(this.mapPointer)
            .then(async data => {
                if (data) {
                    // get rooms from Map only needed for S5
                    const rooms = data[1];
                    if (
                        (this.vacuum.modell === 'roborock.vacuum.s5' || this.vacuum.modell === 'roborock.vacuum.s5e') &&
                        this.vacuum.features.roomMapping === false &&
                        typeof rooms !== 'undefined' &&
                        rooms.length > 0
                    ) {
                        const roomids = [];
                        rooms.forEach(element => roomids.push([element, `room${element}`]));

                        this.adapter.log.info(`Room array empty... generate from mapdata.. ${JSON.stringify(roomids)}`);
                        this.vacuum.features.roomMapping = true;
                        this.vacuum.rooms = roomids;
                        this.roomManager.processRoomMaping({
                            id: 'dummy',
                            result: roomids,
                        });
                    }
                    // get zone cleaning coordinates
                    const zones = data[2];

                    if (
                        typeof zones !== 'undefined' &&
                        zones.length > 0 &&
                        zones[0][0] !== this.vacuum.lastZone[0][0]
                    ) {
                        this.adapter.log.debug(`zone changed${JSON.stringify(zones)}`);
                        this.vacuum.lastZone = zones;

                        //parse to normal format
                        const newArray = [];
                        zones.forEach(zone => {
                            zone.push(1);
                            newArray.push(zone);
                        });
                        let string = JSON.stringify(newArray);
                        string = string.substring(1, string.length - 1);

                        await this.adapter.setForeignStateAsync(`${this.adapter.namespace}.control.zoneClean`, {
                            val: string,
                            ack: true,
                        });
                    }

                    // get Point  coordinates
                    const goto = data[3];
                    if (typeof goto !== 'undefined' && goto.length > 0 && goto[0] !== this.vacuum.lastGoto[0]) {
                        this.adapter.log.debug(`goto changed${JSON.stringify(goto)}`);
                        this.vacuum.lastGoto = goto;
                        await this.adapter.setForeignStateAsync(`${this.adapter.namespace}.control.goTo`, {
                            val: goto.join(),
                            ack: true,
                        });
                    }

                    const dataurl = data[0].toDataURL();
                    await this.adapter.setForeignStateAsync(`${this.adapter.namespace}.cleanmap.map64`, {
                        val: dataurl,
                        ack: true,
                    });

                    if (Date.now() - this.mapLastSave > this.mapSaveIntervall) {
                        const buf = data[0].toBuffer();
                        this.adapter.writeFile(
                            `mihome-vacuum.${this.adapter.instance}.userfiles`,
                            `actualMap.png`,
                            buf,
                            error => {
                                if (error) {
                                    this.adapter.log.error('Error by saving of the map');
                                } else {
                                    this.adapter.setState(
                                        'cleanmap.mapURL',
                                        `/mihome-vacuum.${this.adapter.instance}.userfiles/actualMap.png`,
                                        true,
                                    );
                                }
                                this.mapLastSave = Date.now();
                            },
                        );
                    }
                    this.cMapLastPoll = Date.now();
                }
                if (this.mapGet) {
                    //adapter.log.info(VALETUDO.POLLMAPINTERVALL)
                    this.globalTimeouts['getMapData'] = setTimeout(async () => {
                        this.adapter.log.debug('Get Mappointer while cleaning');
                        this.mapEnable && this.getMapPointer(); // get pointer only by mimap

                        //this.getMapData();
                    }, this.mapPollIntervall);
                }
            })
            .catch(err => {
                this.adapter.log.debug(err);
                if (this.mapGet) {
                    this.globalTimeouts['getMapData'] = setTimeout(async () => {
                        this.mapEnable && this.getMapPointer(); // get pointer only by mimap
                        //	this.getMapData();
                    }, this.mapPollIntervall);
                }
            });
    }

    async checkFeaturesCarpet() {
        try {
            const answer = await this.Miio.sendMessage('get_carpet_mode');
            if (answer.result && answer.result !== 'unknown_method') {
                if (this.vacuum.features.carpetMode === null) {
                    this.vacuum.features.carpetMode = true;
                    this.adapter.log.info('create state for carpet_mode');
                    this.adapter.setObjectNotExists('control.carpet_mode', objects.carpet_mode);
                }
            } else {
                this.vacuum.features.carpetMode = false;
            }
        } catch (error) {
            this.vacuum.features.carpetMode = false;
            this.adapter.log.debug(error);
        }
    }

    async setGetCarpetMode() {
        try {
            const answer = await this.Miio.sendMessage('get_carpet_mode');
            if (answer.result && (answer.result[0].enable === 0 || answer.result[0].enable === 1)) {
                await this.adapter.setStateAsync('control.carpet_mode', {
                    val: answer.result[0].enable === 1,
                    ack: true,
                });
                if (answer.result[0].enable === 1) {
                    this.carpetModeSettings = answer.result[0];
                }
            }
        } catch (error) {
            this.adapter.log.debug(error);
        }
    }

    async setGetCleanSummary() {
        try {
            const answer = await this.Miio.sendMessage('get_clean_summary');
            if (!answer.result) {
                return false;
            }
            const summary = await this.parseCleaningSummary(answer);

            this.adapter.setStateAsync('history.total_time', {
                val: Math.round(summary.clean_time / 60),
                ack: true,
            });
            this.adapter.setStateAsync('history.total_area', {
                val: Math.round(summary.total_area / 1000000),
                ack: true,
            });
            this.adapter.setStateAsync('history.total_cleanups', {
                val: summary.num_cleanups,
                ack: true,
            });

            if (!(await this.isEquivalent(summary.cleaning_record_ids, this.logEntries))) {
                this.logEntries = summary.cleaning_record_ids;

                const cleanlogJson = await this.getLogEntries(this.logEntries);

                this.adapter.setStateAsync('history.allTableJSON', {
                    val: JSON.stringify(cleanlogJson),
                    ack: true,
                });
                this.adapter.setStateAsync('history.allTableHTML', {
                    val: await this.createHtmlTable(cleanlogJson),
                    ack: true,
                });
                return true;
            }
            return true;
        } catch (error) {
            this.adapter.log.debug(`ERROR at setGetCleanSummary: ${error}`);
            return false;
        }
    }

    async parseCleaningSummary(response) {
        response = response.result;

        // {
        // 	"id": 9,
        // 	"result": {
        // 		"clean_time": 25075,
        // 		"clean_area": 376442500,
        // 		"clean_count": 10,
        // 		"dust_collection_count": 0,
        // 		"records": [1617553319, 1617470350, 1617380294, 1617374983, 1617370233, 1617356620, 1617209982, 1617201614, 1617165226, 1617121021]
        // 	},
        // 	"exe_time": 101
        // }
        // check if S7. Use different response
        if (response.clean_time) {
            return {
                clean_time: response.clean_time, // in seconds
                total_area: response.clean_area, // in cm^2
                num_cleanups: response.clean_count,
                cleaning_record_ids: response.records, // number[]
            };
        }
        return {
            clean_time: response[0], // in seconds
            total_area: response[1], // in cm^2
            num_cleanups: response[2],
            cleaning_record_ids: response[3], // number[]
        };
    }

    async isEquivalent(a, b) {
        // Create arrays of property names
        const aProps = Object.getOwnPropertyNames(a);
        const bProps = Object.getOwnPropertyNames(b);

        // If number of properties is different,
        // objects are not equivalent
        if (aProps.length !== bProps.length) {
            return false;
        }

        for (let i = 0; i < aProps.length; i++) {
            const propName = aProps[i];

            // If values of same property are not equal,
            // objects are not equivalent
            if (a[propName] !== b[propName]) {
                return false;
            }
        }

        // If we made it this far, objects
        // are considered equivalent
        return true;
    }

    async getLogEntries(logArray) {
        if (!logArray || logArray.length === 0) {
            return;
        }
        const cleanJSON = [];

        try {
            const start = async () => {
                await this.asyncForEach(logArray, async num => {
                    const response = await this.Miio.sendMessage('get_clean_record', [num]);
                    const records = await this.parseCleaningRecords(response);

                    records &&
                        records.forEach(record => {
                            const dates = new Date();
                            dates.setTime(record.start_time * 1000);

                            cleanJSON.push({
                                Datum: `${dates.getDate()}.${dates.getMonth() + 1}`,
                                Start: `${(dates.getHours() < 10 ? '0' : '') + dates.getHours()}:${
                                    dates.getMinutes() < 10 ? '0' : ''
                                }${dates.getMinutes()}`,
                                Saugzeit: `${Math.round(record.duration / 60)} min`,
                                Fläche: `${Math.round(record.area / 10000) / 100} m²`,
                                Error: record.errors,
                                Ende: record.completed,
                            });
                        });
                });
                if (!this.closed) {
                    this.adapter.log.debug(`Cleaning history processed: ${cleanJSON.length} entries`);
                }
            };

            await start();
            return cleanJSON;
        } catch (error) {
            if (!this.closed) {
                this.adapter.log.warn(`Error at history: ${error}`);
            }
        }
    }

    async parseCleaningRecords(response) {
        // {"id":25,"result":[{"begin":1617121021,"end":1617135716,"duration":4217,"area":57002500,"error":0,"complete":0,"start_type":2,"clean_type":1,"finish_reason":37,"dust_collection_status":0}],"exe_time":100}
        // new Answer from S7
        return response && response.result
            ? response.result.map(entry => {
                  if (entry.begin) {
                      return {
                          start_time: entry.begin, // unix timestamp
                          end_time: entry.end, // unix timestamp
                          duration: entry.duration, // in seconds
                          area: entry.area, // in cm^2
                          errors: entry.error, // ?
                          completed: entry.complete === 1, // boolean
                          start_type: entry.start_type, // ?? 1 = Roboter 2= app
                          clean_type: entry.clean_type, // ?? 1= fullClean 2=Zone 3 = roomclean
                      };
                  }
                  return {
                      start_time: entry[0], // unix timestamp
                      end_time: entry[1], // unix timestamp
                      duration: entry[2], // in seconds
                      area: entry[3], // in cm^2
                      errors: entry[4], // ?
                      completed: entry[5] === 1, // boolean
                      start_type: entry[6], // ?? 1 = Roboter 2= app
                      clean_type: entry[7], // ?? 1= fullClean 2=Zone 3 = roomclean
                  };
              })
            : null;
    }

    async createHtmlTable(cleanJSON) {
        // Tabelleneigenschaften
        // TODO: Translate
        const clean_log_html_attr =
            '<colgroup> <col width="50"> <col width="50"> <col width="80"> <col width="100"> <col width="50"> <col width="50"> </colgroup>';
        const clean_log_html_head =
            '<tr> <th>Datum</th> <th>Start</th> <th>Saugzeit</th> <th>Fläche</th> <th>???</th> <th>Ende</th></tr>';

        let lines = '';
        cleanJSON.forEach(line => {
            lines += `<tr><td>${line.Datum}</td><td>${line.Start}</td><td ALIGN="RIGHT">${line.Saugzeit}</td><td ALIGN="RIGHT">${line['Fläche']}</td><td ALIGN="CENTER">${line.Error}</td><td ALIGN="CENTER">${line.Ende}</td></tr>`;
        });
        return `<table>${clean_log_html_attr}${clean_log_html_head}${lines}</table>`;
    }

    async asyncForEach(array, callback) {
        for (let index = 0; index < array.length; index++) {
            await callback(array[index], index, array);
        }
    }

    async setGetSoundVolume() {
        try {
            const message = await this.Miio.sendMessage('get_sound_volume');
            this.Error = !message.result;
            if (!message.result) {
                return;
            }

            this.adapter.setStateAsync('control.sound_volume', {
                val: message.result[0],
                ack: true,
            });
        } catch (error) {
            this.adapter.log.debug(`ERROR at setGetSoundVolume: ${error}`);
            this.Error = true;
        }
    }

    async setGetConsumable() {
        try {
            const message = await this.Miio.sendMessage('get_consumable');

            if (!message.result) {
                return false;
            }
            const consumable = message.result[0]; //parseConsumable(answer)
            this.Error = false;

            if (!this.features.consumables) {
                this.features.consumables = [];
                await this.adapter.setObjectNotExistsAsync('consumable', objects.stockConsumable.channel);
                for (let id in objects.stockConsumable.list) {
                    const valueParam = commands[`${id}_reset`]?.params;
                    if (valueParam && consumable[valueParam] != undefined) {
                        const o = objects.stockConsumable.list[id];
                        let contents = await this.adapter.setObjectNotExistsAsync(`consumable.${o.state._id}`, o.state);
                        contents && this.adapter.log.debug(`Create State for consumable: ${JSON.stringify(contents)}`);
                        contents = await this.adapter.setObjectNotExistsAsync(`consumable.${o.button._id}`, o.button);
                        contents && this.adapter.log.debug(`Create Button for consumable: ${JSON.stringify(contents)}`);
                        this.features.consumables[id] = { name: valueParam, calc: o.calc };
                    }
                }
            }

            for (let id in this.features.consumables) {
                const val = consumable[this.features.consumables[id].name];
                this.adapter.setStateAsync(`consumable.${id}`, {
                    val: this.features.consumables[id].calc
                        ? 100 - Math.round(val / this.features.consumables[id].calc)
                        : val,
                    ack: true,
                });
            }
            return true;
        } catch (error) {
            this.adapter.log.debug(`ERROR at setGetConsumable: ${error}`);
            this.Error = true;
            return false;
        }
    }

    async setGetStatus() {
        try {
            const answer = await this.Miio.sendMessage('get_status');

            this.Error = !answer.result;
            if (!answer.result) {
                return;
            }
            const status = await this.parseStatus(answer);
            this.adapter.log.debug(
                `Status update: state=${status.state}, battery=${status.battery}, error=${status.error_code}, cleaning=${status.in_cleaning}, fan=${status.fan_power}, map=${status.map_status}`,
            );

            await this.features.setMop(status.mop_forbidden_enable);
            await this.features.setNewSuctionValues(Math.round(status.fan_power));
            await this.features.setWaterBox(status.water_box_status);
            await this.features.setWaterBoxMode(status.water_box_mode, status.distance_off);
            await this.features.setMopMode(status.mop_mode);
            await this.features.setDockStatus(status.dock_error_status);
            await this.features.setDustCollect(status.dust_collection_status);
            await this.features.setWashMop(status.wash_ready);

            this.adapter.setStateAsync('info.battery', {
                val: status.battery,
                ack: true,
            });
            this.adapter.setStateAsync('info.state', {
                val: status.state,
                ack: true,
            });
            this.adapter.setStateAsync('info.cleanedtime', {
                val: Math.round(status.clean_time / 60),
                ack: true,
            });
            this.adapter.setStateAsync('info.cleanedarea', {
                val: Math.round(status.clean_area / 10000) / 100,
                ack: true,
            });
            this.adapter.setStateAsync('control.fan_power', {
                val: Math.round(status.fan_power),
                ack: true,
            });
            this.adapter.setStateAsync('info.error', {
                val: status.error_code,
                ack: true,
            });
            this.adapter.setStateAsync('info.dnd', {
                val: status.dnd_enabled,
                ack: true,
            });

            // map data
            if (status.map_status !== this.lastMapState) {
                //map has changed Set new States and run getmap and rooms

                this.lastMapState = status.map_status;
                await this.adapter.setStateAsync('cleanmap.actualMap', {
                    val: !status.isLocating ? status.map_status >> 2 : -1,
                    ack: true,
                });
                await this.adapter.setStateAsync('cleanmap.mapStatus', {
                    val: status.map_status % 4,
                    ack: true,
                });

                await this.getMapPointer();
                await this.checkFeaturesRoomMapping();
            }

            // features
            this.features.water_box &&
                this.adapter.setStateAsync('info.water_box', {
                    val: status.water_box_status === 1,
                    ack: true,
                });
            this.features.water_box_mode &&
                this.adapter.setStateAsync('control.water_box_mode', {
                    val: Math.round(status.water_box_mode),
                    ack: true,
                });
            this.features.water_box_mode == 2 &&
                status.distance_off > 0 &&
                this.adapter.setStateAsync('control.water_box_level', {
                    val: Math.round((210 - status.distance_off) / 5),
                    ack: true,
                });
            this.features.dock_status &&
                this.adapter.setStateAsync('info.dock_status', {
                    val: Math.round(status.dock_error_status),
                    ack: true,
                });
            this.features.mop_mode &&
                this.adapter.setStateAsync('control.mop_mode', {
                    val: Math.round(status.mop_mode),
                    ack: true,
                });

            if (this.cleandState !== status.state) {
                this.setRemoteState(status.state);
            }
        } catch (error) {
            this.adapter.log.debug(`ERROR at setGetStatus: ${error}`);
            this.Error = true;
        }
    }

    async parseStatus(response) {
        response = response.result[0];
        response.dnd_enabled = response.dnd_enabled === 1;
        response.error_text = errorTexts[response.error_code];
        response.in_cleaning = response.in_cleaning === 1;
        response.map_present = response.map_present === 1;
        //response.state_text= statusTexts[response.state];
        return response;
    }

    /** Parses the answer of get_room_mapping */
    async initStates() {}

    // function to control goto params

    async parseGoTo(params) {
        const coordinates = params.split(',');

        if (coordinates.length === 2) {
            const xVal = coordinates[0];
            const yVal = coordinates[1];

            if (!isNaN(yVal) && !isNaN(xVal)) {
                //send goTo request with coordinates
                await this.Miio.sendMessage('app_goto_target', [parseInt(xVal), parseInt(yVal)]);
            } else {
                this.adapter.log.error('GoTo need two koordinates with type number');
            }

            this.adapter.log.debug('Go-to coordinates validated');
        } else {
            this.adapter.log.error('GoTo only work with two arguments seperated by ', '');
        }
    }

    async stateChange(id, state) {
        if (!state || state.ack) {
            return;
        }
        const terms = id.split('.');
        const command = terms.pop();
        const parent = terms.pop();

        this.adapter.log.debug(`command: ${command} parent: ${parent}`);
        // let data;
        // let actionMode, method, params;

        try {
            switch (command) {
                case 'clean_home':
                case 'start':
                    if (state.val) {
                        this.adapter.sendTo(this.adapter.namespace, 'startVacuuming', null);
                        if (await this.startCleaning(cleanStates.Cleaning, {})) {
                            await this.Miio.sendMessage('app_start');
                        }
                    } else if (command === 'clean_home' && this.cleanActiveState) {
                        this.stopCleaning();
                    }
                    this.adapter.setForeignState(id, !!state.val, true);
                    break;

                case 'pauseResume':
                    if (this.cleanActiveState && activeCleanStates[this.cleanActiveState].resume) {
                        if (state.val == true) {
                            this.globalTimeouts['onMessage'] = setTimeout(() => {
                                this.setGetStatus();
                            }, 1000);
                            if (this.cleandState === cleanStates.Pause) {
                                await this.Miio.sendMessage(activeCleanStates[this.cleanActiveState].resume);
                            } else {
                                await this.Miio.sendMessage('app_pause');
                            }
                            this.adapter.setState(id, false, true);
                        }
                    } else {
                        this.adapter.log.error(`Could not pause or Resume, because no cleaning active`);
                    }
                    break;

                case 'dustCollect':
                    if (this.cleandState == cleanStates.DustCollecting) {
                        await this.Miio.sendMessage(commands.stopDustCollect.method);
                    } else if (this.cleandState == cleanStates.Charging) {
                        await this.Miio.sendMessage(commands.startDustCollect.method);
                    } else {
                        this.adapter.log.error(`Cant start dust collection only if charging`);
                    }
                    this.globalTimeouts['onMessage'] = setTimeout(() => {
                        this.setGetStatus();
                    }, 2000);
                    this.adapter.setState(id, false, true);
                    break;

                case 'washMop':
                    if (this.cleandState == cleanStates.CleaningMop) {
                        await this.Miio.sendMessage(commands.stopWashMop.method);
                    } else if (this.cleandState == cleanStates.Charging) {
                        await this.Miio.sendMessage(commands.startWashMop.method);
                    } else {
                        this.adapter.log.error(`Cant start Mop washing only if charging`);
                    }
                    this.globalTimeouts['onMessage'] = setTimeout(() => {
                        this.setGetStatus();
                    }, 2000);
                    this.adapter.setState(id, false, true);
                    break;
                case 'home':
                    if (!state.val) {
                        return;
                    }
                    await this.stopCleaning();
                    this.adapter.setForeignState(id, true, true);
                    break;

                case 'loadMap':
                    if (!state.val) {
                        return;
                    }
                    await this.getMapPointer();
                    this.adapter.setForeignState(id, true, true);
                    break;

                case 'clearQueue':
                    if (!state.val) {
                        return;
                    }
                    await this.clearQueue();
                    this.adapter.setForeignState(id, true, true);
                    break;

                case 'spotclean':
                    if (!state.val) {
                        return;
                    }
                    if (await this.startCleaning(cleanStates.SpotCleaning, {})) {
                        await this.Miio.sendMessage('app_spot');
                    }
                    this.adapter.setForeignState(id, state.val, true);
                    break;

                case 'carpet_mode':
                    //when carpetmode change
                    if (state.val === true || state.val === 'true') {
                        await this.Miio.sendMessage('set_carpet_mode', [this.carpetModeSettings]);
                        this.adapter.setForeignState(id, state.val, true);
                    } else {
                        await this.Miio.sendMessage('set_carpet_mode', [
                            {
                                enable: 0,
                            },
                        ]);
                        this.adapter.setForeignState(id, false, true);
                    }
                    break;

                case 'water_box_level':
                    await this.Miio.sendMessage('set_water_box_distance_off', {
                        distance_off: 210 - state.val * 5,
                    });
                    this.adapter.setForeignState(id, state.val, true);
                    break;

                case 'water_box_mode':
                    await this.Miio.sendMessage('set_water_box_custom_mode', [state.val]);
                    this.adapter.setForeignState(id, state.val, true);
                    break;

                case 'goTo':
                    await this.parseGoTo(state.val);
                    this.adapter.setForeignState(id, state.val, true);
                    break;

                case 'zoneClean':
                    this.adapter.sendTo(this.adapter.namespace, 'cleanZone', state.val);
                    this.adapter.setForeignState(id, '', true);
                    break;

                case 'addRoom':
                    if (!isNaN(state.val)) {
                        this.roomManager.createRoom(`manual_${state.val}`, parseInt(state.val, 10));
                    } else {
                        const terms = state.val.match(/((?:[0-9]+,){3,3}[0-9]+)(,[0-9]+)?/);
                        if (terms) {
                            this.roomManager.createRoom(
                                `manual_${terms[1].replace(/,/g, '_')}`,
                                `[${terms[1]}${terms[2] || ',1'}]`,
                            );
                        } else {
                            this.adapter.log.warn(
                                'invalid input for addRoom, use index of map or coordinates like 1111,2222,3333,4444',
                            );
                        }
                    }
                    this.adapter.setForeignState(id, '', true);
                    break;

                case 'roomClean':
                    if (!state.val) {
                        return;
                    }
                    this.roomManager.cleanRooms([id.replace('roomClean', 'mapIndex')]);
                    this.adapter.setForeignState(id, true, true);
                    break;
                case 'loadRooms':
                    this.checkFeaturesRoomMapping();
                    this.adapter.setForeignState(id, true, true);
                    break;

                case 'roomFanPower':
                case 'roomWaterBoxMode':
                case 'roomWaterBoxLevel':
                case 'roomMopMode':
                case 'repeat':
                    // do nothing, only confirm value for next roomClean
                    this.adapter.setForeignState(id, state.val, true);
                    break;

                case 'actualMap':
                    await this.Miio.sendMessage('load_multi_map', [state.val]);
                    this.adapter.setForeignState(id, state.val, true);
                    this.getStates();
                    break;

                default:
                    // try to find common command
                    if (commands[command]) {
                        let params = commands[command].params || '';
                        if (state.val !== true && state.val !== 'true') {
                            params = state.val;
                        }
                        if (state.val !== false && state.val !== 'false') {
                            await this.Miio.sendMessage(commands[command].method, [params]);
                            this.adapter.setForeignState(id, state.val, true);

                            // if consumables reset get data again
                            if (commands[command].method === 'reset_consumable') {
                                this.globalTimeouts['onMessage'] = setTimeout(() => {
                                    this.setGetConsumable();
                                }, 500);
                            }
                        }
                    } else if (command === 'multiRoomClean' || parent === 'timer') {
                        if (parent === 'timer') {
                            this.adapter.setForeignState(
                                id,
                                state.val == TimerManager.SKIP || state.val == TimerManager.DISABLED
                                    ? state.val
                                    : TimerManager.ENABLED,
                                true,
                                () => this.timerManager.calcNextProcess(),
                            );

                            if (state.val != TimerManager.START) {
                                return;
                            }
                        } else {
                            if (!state.val) {
                                return;
                            }
                            this.adapter.setForeignState(id, true, true);
                        }
                        this.roomManager.cleanRoomsFromState(id);
                    } else {
                        this.adapter.log.warn(`can not set ${command}`);
                    }
                    break;
            }
        } catch (error) {
            this.adapter.log.warn(`Cant send command please try again "${command}"\n${error}`);
        }
    }

    async onMessage(obj) {
        this.adapter.log.debug(`Received adapter message command: ${obj && obj.command ? obj.command : 'unknown'}`);
        //return {test: 'true'}
        clearTimeout(this.globalTimeouts['onMessage']);

        const requireParams = (params) /*: string | string[] */ => {
            if (!(params && params.length)) {
                return true;
            }
            if (!obj.message) {
                this.adapter.log.warn('command needs parameter');
                return false;
            }
            const paramArray = [];
            if (typeof params == 'string') {
                // only one parameter needed, than it could be the message self
                if (!obj.message.hasOwnProperty(params)) {
                    // it is not a member of message
                    if (typeof obj.message != 'string') {
                        this.adapter.log.warn(`command needs parameter "${params}" or a string`);
                        return false;
                    }
                    const messageObj = {};
                    messageObj[params] = obj.message;
                    obj.message = messageObj; // transform message to object with messagecontent to params
                }
                paramArray.push(obj.message[params]);
            } else {
                for (let i = 0; i < params.length; i++) {
                    const param = params[i];
                    if (!obj.message.hasOwnProperty(param)) {
                        //respond(predefinedResponses.MISSING_PARAMETER(param));
                        this.adapter.log.warn(`command needs parameter "${param}"`);
                        return false;
                    }
                    paramArray.push(obj.message[param]);
                }
            }
            return paramArray;
        };

        if (obj) {
            let params;

            switch (obj.command) {
                case 'sendCustomCommand':
                    // require the method to be given
                    if (!requireParams(['method'])) {
                        return;
                    }
                    // params is optional

                    params = obj.message;
                    return await this.Miio.sendMessage(params.method, params.params);

                // ======================================================================
                // support for the commands mentioned here:
                // https://github.com/MeisterTR/XiaomiRobotVacuumProtocol#vaccum-commands

                // cleaning commands
                case 'startVacuuming': {
                    const answer = await this.Miio.sendMessage('app_start');
                    this.globalTimeouts['onMessage'] = setTimeout(this.setGetStatus, 2000);
                    return answer;
                }
                case 'stopVacuuming':
                    return await this.Miio.sendMessage('app_stop');

                case 'clearQueue':
                    return this.clearQueue();

                case 'cleanSpot':
                    if (await this.startCleaning(cleanStates.SpotCleaning, {})) {
                        return await this.Miio.sendMessage('app_spot');
                    }
                    return;

                case 'cleanZone':
                    if (!obj.message) {
                        return this.adapter.log.warn('cleanZone needs parameter coordinates');
                    }
                    if (!obj.zones) {
                        // this data called first time!
                        const message = obj.message;
                        if (message.zones) {
                            // called from roomManager with correct Array
                            obj.zones = message.zones;
                            obj.channels = message.channels;
                            obj.message = obj.zones.join(); // we use String for message
                        } else {
                            if (message.hasOwnProperty('coordinates')) {
                                if (message.hasOwnProperty('waterBoxMode')) {
                                    obj.waterBoxMode = message.waterBoxMode;
                                }
                                if (message.hasOwnProperty('waterBoxLevel')) {
                                    obj.waterBoxLevel = message.waterBoxLevel;
                                }
                                if (message.hasOwnProperty('mopMode')) {
                                    obj.mopMode = message.mopMode;
                                }
                                if (message.hasOwnProperty('fanSpeed')) {
                                    obj.fanSpeed = message.fanSpeed;
                                }
                                obj.zones = [message.coordinates];
                            } else {
                                obj.zones = [obj.message];
                            }
                        }
                    }

                    if (typeof obj.channels == 'undefined') {
                        return this.roomManager.findChannelsByMapIndex(obj.zones, channels => {
                            this.adapter.log.debug(`search channels for ${obj.message} ->${channels.join()}`);
                            obj.channels = channels && channels.length ? channels : null;
                            this.adapter.emit('message', obj); // call function again
                        });
                    }

                    if (await this.startCleaning(cleanStates.ZoneCleaning, obj)) {
                        if (obj.repeat) {
                            // would be set, if we only have one zone
                            obj.zones[0] = obj.zones[0].replace(/,[0-9]+\]/, `,${obj.repeat}]`);
                        }
                        return await this.Miio.sendMessage('app_zoned_clean', obj.zones);
                    }

                    return;

                case 'cleanSegments':
                    if (!obj.message) {
                        return this.adapter.log.warn('cleanSegments needs paramter mapIndex');
                    }
                    if (!obj.segments) {
                        // this data called first time!
                        let message = obj.message;
                        if (message.segments) {
                            // called from roomManager with correct Array
                            obj.segments = message.segments;
                            obj.channels = message.channels;
                            obj.message = obj.segments.join(); // we use String for message
                        } else {
                            // build correct Array
                            if (typeof message == 'object' && message.hasOwnProperty('rooms')) {
                                if (message.hasOwnProperty('waterBoxMode')) {
                                    obj.waterBoxMode = message.waterBoxMode;
                                }
                                if (message.hasOwnProperty('waterBoxLevel')) {
                                    obj.waterBoxLevel = message.waterBoxLevel;
                                }
                                if (message.hasOwnProperty('mopMode')) {
                                    obj.mopMode = message.mopMode;
                                }
                                if (message.hasOwnProperty('fanSpeed')) {
                                    obj.fanSpeed = message.fanSpeed;
                                }
                                if (message.hasOwnProperty('repeat')) {
                                    obj.repeat = message.repeat;
                                }
                                message = message.rooms;
                            }
                            if (!isNaN(message)) {
                                // only one number
                                message = [parseInt(message, 10)];
                            } else {
                                if (typeof message == 'string') {
                                    // we expect String with comma seperate Numbers, like "11,12,13"
                                    message = obj.message.split(',');
                                }
                                for (const i in message) {
                                    message[i] = parseInt(message[i], 10);
                                    if (isNaN(message[i])) {
                                        delete message[i];
                                    }
                                }
                            }
                            obj.segments = message;
                        }
                    }

                    if (typeof obj.channels === 'undefined') {
                        return this.roomManager.findChannelsByMapIndex(obj.segments, channels => {
                            this.adapter.log.debug(`search channels for ${obj.message} ->${channels.join()}`);
                            obj.channels = channels && channels.length ? channels : null;
                            this.adapter.emit('message', obj); // call function again
                        });
                    }

                    if (await this.startCleaning(cleanStates.RoomCleaning, obj)) {
                        //setTimeout(()=> {cleaning.setRemoteState(cleanStates.RoomCleaning)},2500) //simulate:
                        params = obj.segments;
                        let repeat = obj.repeat;
                        if (repeat) {
                            obj.repeat = false; // only process once
                            if (Number(repeat) < 2) {
                                repeat = null; // no repeat neccessary
                            } else if (!this.adapter.isUnsupportedFeature('segemntCleanRepeat')) {
                                params = [
                                    {
                                        segments: obj.segments,
                                        repeat: repeat,
                                    },
                                ];
                                // clean_order_mode': 0,
                                // clean_mop: 0
                                repeat = null; // handled by complex Param
                            }
                        }
                        let answer = await this.Miio.sendMessage('app_segment_clean', params);
                        if (answer.error) {
                            // {"error":{"code":-10000,"message":"data for segment is not a number"}}
                            if (params[0].repeat) {
                                // some devices doesent support complex Object for app_segment_clean, so we have to use fallback mode
                                repeat = params[0].repeat;
                                answer = await this.Miio.sendMessage('app_segment_clean', params[0].segments);
                                this.adapter.setUnsupportedFeature('segemntCleanRepeat'); // we will store this for future
                                this.adapter.log.info(
                                    'repeat will not supported native, so we use Queue as Fallback in future!',
                                );
                            }
                        }
                        if (repeat) {
                            // Falback mode
                            obj.info = 'repeat segment';
                            for (let i = 1; i < repeat; i++) {
                                this.push(JSON.parse(JSON.stringify(obj)));
                            }
                        }
                        return answer;
                    }

                    return;

                case 'cleanRooms':
                    if (!requireParams('rooms')) {
                        return;
                    }
                    this.roomManager.findMapIndexByRoom(obj.message.rooms, this.roomManager.cleanRooms);
                    return;

                case 'pause':
                    this.globalTimeouts['onMessage'] = setTimeout(() => {
                        this.setGetStatus();
                    }, 2000);
                    return this.Miio.sendMessage('app_pause');

                case 'charge':
                    this.globalTimeouts['onMessage'] = setTimeout(() => {
                        this.setGetStatus();
                    }, 2000);
                    return this.Miio.sendMessage('app_charge');

                case 'findMe':
                    return await this.Miio.sendMessage('find_me');

                case 'getConsumableStatus':
                    return await this.Miio.sendMessage('get_consumable');

                case 'resetConsumables':
                    if (!requireParams('consumable')) {
                        return;
                    }
                    this.globalTimeouts['onMessage'] = setTimeout(() => {
                        this.setGetStatus();
                    }, 2000);
                    return await this.Miio.sendMessage('reset_consumable', obj.message.consumable);

                // get info about cleanups
                case 'getCleaningSummary':
                    return await this.Miio.sendMessage('reset_consumable', obj.message.consumable);

                case 'getCleaningRecord':
                    // require the record id to be given
                    if (!requireParams('recordId')) {
                        return;
                    }
                    // TODO: can we do multiple at once?
                    return await this.Miio.sendMessage('get_clean_record', [obj.message.recordId]);

                // TODO: find out how this works
                // case 'getCleaningRecordMap':
                //     sendCustomCommand('get_clean_record_map');
                case 'getMap':
                    return await this.Miio.sendMessage('get_map_v1');

                // Basic information
                case 'getStatus':
                    return await this.Miio.sendMessage('get_status');

                case 'getSerialNumber':
                    return await this.Miio.sendMessage('get_serial_number');

                case 'getDeviceDetails':
                    return await this.Miio.sendMessage('miIO.info');

                // Do not disturb
                case 'getDNDTimer':
                    return await this.Miio.sendMessage('get_dnd_timer');

                case 'setDNDTimer':
                    // require start and end time to be given
                    params = requireParams(['startHour', 'startMinute', 'endHour', 'endMinute']);
                    if (!params) {
                        return;
                    }
                    return await this.Miio.sendMessage('set_dnd_timer', params);

                case 'deleteDNDTimer':
                    return await this.Miio.sendMessage('close_dnd_timer');

                // Fan speed
                case 'getFanSpeed':
                    return await this.Miio.sendMessage('get_custom_mode');
                //break;
                case 'setFanSpeed':
                    if (!requireParams('fanSpeed')) {
                        return;
                    }
                    //sendCustomCommand('set_custom_mode', [obj.message.fanSpeed]);
                    return await this.Miio.sendMessage('set_custom_mode', [obj.message.fanSpeed]);

                //Water Flow Mode
                case 'getWaterBoxMode':
                    return await this.Miio.sendMessage('get_water_box_custom_mode');

                case 'setWaterBoxMode':
                    //require start and end time to be given
                    if (!requireParams('waterBoxMode')) {
                        return;
                    }
                    if (obj.message.waterBoxMode == 207) {
                        if (requireParams('waterBoxLevel')) {
                            this.Miio.sendMessage('set_water_box_distance_off', {
                                distance_off: obj.message.waterBoxLevel,
                            });
                        }
                        return this.Miio.sendMessage('set_water_box_custom_mode', [207]);
                    }
                    return await this.Miio.sendMessage('set_water_box_custom_mode', [obj.message.waterBoxMode]);

                //Mop Mode
                case 'getMopMode':
                    return await this.Miio.sendMessage('get_mop_mode');

                case 'setMopMode':
                    if (!requireParams('mopMode')) {
                        return;
                    }
                    return await this.Miio.sendMessage('set_mop_mode', [obj.message.mopMode]);

                // Remote controls
                case 'startRemoteControl':
                    return await this.Miio.sendMessage('app_rc_start');

                case 'get_prop':
                    return await this.Miio.sendMessage('get_prop', obj.message);

                case 'stopRemoteControl':
                    return await this.Miio.sendMessage('app_rc_end');

                case 'move': {
                    // require all params to be given
                    if (!requireParams(['velocity', 'angularVelocity', 'duration', 'sequenceNumber'])) {
                        return;
                    }
                    // TODO: Constrain the params
                    params = obj.message;
                    // TODO: can we issue multiple commands at once?
                    const args = [
                        {
                            omega: params.angularVelocity,
                            velocity: params.velocity,
                            seqnum: params.sequenceNumber, // <- TODO: make this automatic
                            duration: params.duration,
                        },
                    ];
                    return await this.Miio.sendMessage('app_rc_move', [args]);
                }
                // ======================================================================
                default:
                    if (commands[obj.command]) {
                        params = commands[obj.command].params || '';
                        if (params) {
                            params = requireParams(params);
                            if (!params) {
                                return;
                            }
                        }
                        return await this.Miio.sendMessage(commands[obj.command].method, params);
                    }
                    this.adapter.log.error(`command "${obj.command}" unkown!`);
                    return;
            }
        }
    }

    //_________________________________
    // vacuum State control
    //__________________________________

    /**
     * is called, if robot send status
     *
     * @param newVal new status
     */
    async setRemoteState(newVal) {
        this.cleandState = newVal;
        //adapter.setState('control.pauseResume', this.cleandState === cleanStates.Pause, true);

        if (activeCleanStates[this.cleandState]) {
            if (newVal === this.cleanActiveState) {
                // cleanActiveState was set in startCleaning and now confirmed
                if (this.activeChannels) {
                    for (const i in this.activeChannels) {
                        this.adapter.setState(`${this.activeChannels[i]}.state`, i18n.cleanRoom, true);
                    }
                }
            } else {
                this.cleanActiveState = this.cleandState;
            }
        } else if (cleanStates.Pause === this.cleandState) {
            // cleanActiveState should be the initial State, so do nothing
            return;
        } else {
            this.cleanActiveState = 0;
            if (this.activeChannels) {
                for (const i in this.activeChannels) {
                    this.adapter.setState(`${this.activeChannels[i]}.state`, '', true);
                }
                this.activeChannels = null;
            }
            if (
                [
                    cleanStates.Sleeping,
                    cleanStates.Waiting,
                    cleanStates.Back_toHome,
                    cleanStates.Charging,
                    cleanStates.GoingToSpot,
                ].includes(this.cleandState)
            ) {
                if (this.queue.length > 0) {
                    this.adapter.log.debug('use clean trigger from Queue');
                    this.adapter.emit('message', this.queue.shift());
                    this.updateQueue();
                }
            }
            if (cleanStates.Charging === newVal) {
                // update values
                await this.setGetConsumable();
                await this.setGetCleanSummary();
                //MAP.ENABLED && setTimeout(sendMsg, 2000, 'get_map_v1');
            }
        }
        // if (this.checkCleanState)
        // 	this.checkCleanState = !!clearTimeout(this.checkCleanState);

        /*if (adapter.config.enableAlexa) */
        this.adapter.setState('control.clean_home', !!this.cleanActiveState, true);

        if (this.mapEnable) {
            // set map getter to true if..
            if (
                [
                    cleanStates.Cleaning,
                    cleanStates.Back_toHome,
                    cleanStates.SpotCleaning,
                    cleanStates.GoingToSpot,
                    cleanStates.ZoneCleaning,
                    cleanStates.RoomCleaning,
                ].indexOf(this.cleandState) > -1
            ) {
                this.mapGet = true;
                this.getMapPointer();
            } else {
                this.mapGet = false;
            }
        }
    }

    async startCleaning(cleanStatus, messageObj) {
        this.adapter.log.debug(`Preparing cleaning action: status=${cleanStatus}`);
        const activeCleanState = activeCleanStates[cleanStatus];
        if (!activeCleanState) {
            this.adapter.log.warn(`Invalid cleanStatus(${cleanStatus}) for startCleaning`);
            return false;
        }

        // why??? setTimeout(sendPing, 2000);
        if (this.cleanActiveState) {
            if (cleanStatus === cleanStates.Cleaning && this.adapter.config.enableResumeZone) {
                this.adapter.log.debug(`Resuming paused ${activeCleanStates[this.cleanActiveState].name}`);
                await this.Miio.sendMessage(activeCleanStates[this.cleanActiveState].resume);
            } else {
                this.adapter.log.info(
                    `should trigger cleaning ${activeCleanState.name}${
                        messageObj.message || ''
                    }, but is currently active(${this.cleanActiveState}). Add to queue`,
                );
                messageObj.info = activeCleanState.name;
                this.push(messageObj);
            }
            return false;
        }
        this.cleanActiveState = cleanStatus;
        this.activeChannels = messageObj.channels;
        if (this.activeChannels && this.activeChannels.length === 1) {
            if (!messageObj.fanSpeed) {
                this.adapter.getState(
                    `${this.activeChannels[0]}.roomFanPower`,
                    (err, fanPower) => fanPower && this.adapter.setStateChanged('control.fan_power', fanPower.val),
                );
            }
            if (this.features.water_box_mode != null && !messageObj.waterBoxMode) {
                this.adapter.getState(`${this.activeChannels[0]}.roomWaterBoxMode`, (err, waterBoxMode) => {
                    if (waterBoxMode) {
                        this.adapter.log.debug(`Set water box mode from Room to ${waterBoxMode.val}`);
                        this.adapter.setStateChanged('control.water_box_mode', waterBoxMode.val);
                        if (waterBoxMode.val == 207 && this.features.water_box_mode == 2 && !messageObj.waterBoxLevel) {
                            this.adapter.getState(
                                `${this.activeChannels[0]}.roomWaterBoxLevel`,
                                (err, waterBoxLevel) => {
                                    if (waterBoxLevel) {
                                        this.adapter.log.debug(`Set water box level from Room to ${waterBoxLevel.val}`);
                                        this.adapter.setStateChanged(
                                            'control.water_box_level',
                                            waterBoxLevel.val,
                                            true,
                                        );
                                    }
                                },
                            );
                        }
                    }
                });
            }
            if (this.features.mop_mode != null && !messageObj.mopMode) {
                this.adapter.getState(
                    `${this.activeChannels[0]}.roomMopMode`,
                    (err, mopMode) => mopMode && this.adapter.setStateChanged('control.mop_mode', mopMode.val),
                );
            }
            if (typeof messageObj.repeat === 'undefined') {
                const repeatObj = await this.adapter.getStateAsync(`${this.activeChannels[0]}.repeat`);
                if (repeatObj && Number(repeatObj.val) > 1) {
                    messageObj.repeat = repeatObj.val;
                }
            }
        }
        if (messageObj.fanSpeed) {
            this.adapter.setState('control.fan_power', messageObj.fanSpeed);
        }
        if (this.features.water_box_mode != null) {
            if (messageObj.waterBoxMode) {
                this.adapter.setStateChanged('control.water_box_mode', messageObj.waterBoxMode);
            }
            if (messageObj.waterBoxLevel && this.features.water_box_mode == 2) {
                this.adapter.setStateChanged('control.water_box_level', messageObj.waterBoxLevel);
            }
        }
        if (messageObj.mopMode && this.features.mop_mode != null) {
            this.adapter.setStateChanged('control.mop_mode', messageObj.mopMode);
        }
        this.adapter.log.info(`trigger cleaning ${activeCleanState.name}${messageObj.message || ''}`);
        /// need to verify?? this.checkStartCleaning(2);
        return true;
    }

    async stopCleaning() {
        try {
            if (this.adapter.config.sendPauseBeforeHome) {
                await this.Miio.sendMessage('app_pause');
            }
            this.clearQueue();
            this.cleandState = cleanStates.Unknown; // Force calling setRemoteState on next get_status answer
            await this.Miio.sendMessage('app_charge');
            this.setGetStatus();
        } catch (error) {
            this.adapter.log.warn(`Error at stop Cleaning: ${error}`);
        }
    }

    clearQueue() {
        for (const i in this.queue) {
            const channels = this.queue[i].channels;
            if (channels) {
                for (const c in channels) {
                    this.adapter.setState(`${channels[c]}.state`, '', true);
                }
            }
        }
        this.queue = [];
        this.updateQueue();
    }

    push(messageObj) {
        this.queue.push(messageObj);
        if (messageObj.channels) {
            const getObjs = [];
            for (const i in messageObj.channels) {
                getObjs.push(
                    this.adapter.getObjectAsync(messageObj.channels[i]).then(obj => {
                        if (obj && obj.common) {
                            messageObj.info += ` ${obj.common.name}`;
                        }
                    }),
                );
            }

            Promise.all(getObjs).then(() => this.updateQueue());
        } else {
            this.updateQueue();
        }
    }

    updateQueue() {
        // pingInterval = this.queue.length > 0 ? 10000 : adapter.config.pingInterval;
        const json = [];
        for (let i = this.queue.length - 1; i >= 0; i--) {
            json.push(this.queue[i].info);
            const channels = this.queue[i].channels;
            if (channels) {
                for (const c in channels) {
                    this.adapter.setState(`${channels[c]}.state`, `${i18n.waitingPos}: ${i}`, true);
                }
            }
        }
        this.adapter.setStateChanged('info.queue', JSON.stringify(json), true);
    }

    async close() {
        if (!this.closePromise) {
            this.closed = true;
            this.closePromise = (async () => {
                this.timerManager?.close();
                Object.keys(this.globalTimeouts).forEach(
                    id => this.globalTimeouts[id] && clearTimeout(this.globalTimeouts[id]),
                );
                this.globalTimeouts = {};
                await this.Map.shutdown();
            })();
        }
        return this.closePromise;
    }
}

class FeatureManager {
    /**
     * @param {VacuumDeviceState} deviceState State belonging to the manager instance.
     * @param {object} adapterInstance ioBroker adapter instance.
     */
    constructor(deviceState, adapterInstance) {
        this.deviceState = deviceState;
        this.adapter = adapterInstance;
        this.model = null;
        //this.goto = false;
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
        //adapter.states
        //roomManager = new RoomManager(adapter, i18n);
        //timerManager = new TimerManager(adapter, i18n);

        this.adapter.getState('info.device_model', (err, state) => state && state.val && this.setModel(state.val));

        // we get miIO.info only, if the robot is connected to the internet, so we init with unavailable
        this.adapter.setState('info.wifi_signal', null, true);
    }

    detect() {
        //sendMsg(commands.get_carpet_mode.method); // test, if supported
        //sendMsg('get_room_mapping'); // test, if supported
    }

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
        // First Viomi detection
        if (this.model !== model) {
            this.adapter.setStateChanged('info.device_model', model, true);
            this.model = model;
        }
    }
    async setWaterBox(water_box_status) {
        if (this.water_box === null) {
            this.water_box = !isNaN(water_box_status);
            if (this.water_box) {
                this.adapter.log.info('create states for water box');
                await this.adapter.setObjectNotExistsAsync('info.water_box', objects.water_box);
            }
        }
    }
    async setDustCollect(dust_collection_status) {
        if (this.dustCollect === null) {
            this.dustCollect = !isNaN(dust_collection_status);
            if (this.dustCollect) {
                this.adapter.log.info('create states for dust collecting');
                await this.adapter.setObjectNotExistsAsync('control.dustCollect', objects.dustCollect);
            }
        }
    }
    async setWashMop(wash_mop_status) {
        if (this.washMop === null) {
            this.washMop = !isNaN(wash_mop_status);
            if (this.washMop) {
                this.adapter.log.info('create states for Mop washing');
                await this.adapter.setObjectNotExistsAsync('control.washMop', objects.washMop);
            }
        }
    }
    async setMop(mop_status) {
        if (typeof mop_status === 'undefined') {
            return;
        }

        if (this.mop === null) {
            this.mop = !isNaN(mop_status);
            if (this.mop) {
                this.adapter.log.info('create states for mop');
                await this.adapter.setObjectNotExistsAsync('info.mop', objects.mop);
                objects.newfan_power.common.states['105'] = 'OFF'; // if mop mode than fan is off
            }
        }

        this.adapter.setStateAsync('info.mop', {
            val: !!mop_status,
            ack: true,
        });
    }
    async setWaterBoxMode(water_box_mode, distance_off) {
        if (this.water_box_mode === null && water_box_mode) {
            this.water_box_mode = !isNaN(water_box_mode);
            if (this.water_box_mode) {
                this.adapter.log.info('create states for water box mode');
                if (!isNaN(distance_off)) {
                    this.water_box_mode = 2;
                    objects.water_box_mode.common.max = 207;
                    objects.water_box_mode.common.states[207] = 'LEVEL';
                    await this.adapter.setObjectNotExistsAsync('control.water_box_level', objects.water_box_level);
                }
                await this.adapter.setObjectAsync('control.water_box_mode', objects.water_box_mode);
            }
        }
    }

    async setMopMode(mop_mode) {
        if (this.mop_mode === null && mop_mode) {
            this.mop_mode = !isNaN(mop_mode);
            if (this.mop_mode) {
                this.adapter.log.info('create states for mop mode');
                await this.adapter.setObjectNotExistsAsync('control.mop_mode', objects.mop_mode);
            }
        }
    }

    async setDockStatus(dock_status) {
        if (this.dock_status === null && typeof dock_status != 'undefined') {
            this.dock_status = !isNaN(dock_status);
            if (this.dock_status) {
                this.adapter.log.info('create states for dock status');
                await this.adapter.setObjectNotExistsAsync('info.dock_status', objects.dock_status);
            }
        }
    }
}

module.exports = VacuumManager;
