'use strict';

/*
 * Created with @iobroker/create-adapter v1.27.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
const XiaomiCloudConnector = require('./lib/XiaomiCloudConnector');
const miio = require('./lib/miio');
const objects = require('./lib/objects');

const ViomiManager = require('./lib/viomi');
const VacuumManager = require('./lib/vacuum');
const DreameManager = require('./lib/dreame');
//const VacuumManager2 = require('./lib/vacuumsaphire');

// @ts-expect-ignore
let Miio;
let vacuum = null;
let XiaomiApi = null;

class MihomeVacuum extends utils.Adapter {
    constructor(options) {
        super({
            ...options,
            name: 'mihome-vacuum',
        });
        this.unsupportedFeatures = '|';
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async main() {
        // @ts-expect-error var not defined
        this.config.port = parseInt(this.config.port, 10) || 54321;
        // @ts-expect-error var not defined
        this.config.ownPort = parseInt(this.config.ownPort, 10) || 53421;
        // @ts-expect-error var not defined
        this.config.pingInterval = parseInt(this.config.pingInterval, 10) || 20000;

        // Abfrageintervall mindestens 10 sec.
        // @ts-expect-error var not defined
        if (this.config.pingInterval < 10000) {
            // @ts-expect-error var not defined
            this.config.pingInterval = 10000;
        }

        // @ts-expect-error var not defined
        if (!this.config.token) {
            this.log.warn('Token not specified!');
            return;
        }
        // create default States
        await Promise.all(
            objects.deviceInfo.map(async o => {
                await this.setObjectNotExistsAsync(`deviceInfo${o._id ? `.${o._id}` : ''}`, o);
                this.log.debug(`Create State for deviceInfo${o._id}`);
            }),
        );

        //create new miio class
        Miio = new miio(this);

        Miio.on('connect', async () => {
            this.log.debug('MAIN: Connected to device, try to get model..');
            this.setState('info.IPAddress', {
                // @ts-expect-error var not defined
                val: this.config.ip,
                ack: true,
            });
            await this.getModel();
            if (!vacuum) {
                return;
            }
            this.subscribeStates('*');
        });

        //check if Self send Commands is enabled
        // @ts-expect-error var not defined
        if (this.config.enableSelfCommands) {
            objects.customCommands.map(
                async o => await this.setObjectNotExistsAsync(`control${o._id ? `.${o._id}` : ''}`, o),
            );
        } else {
            objects.customCommands.map(o => this.delObj(`control${o._id ? `.${o.id}` : ''}`));
        }

        // clean_home is updated by VacuumManager for every supported robot. It must exist
        // independently of the optional Alexa/IOT integration.
        await this.setObjectNotExistsAsync('control.clean_home', objects.iotState[0]);

        // check if additional iot states are enabled
        // @ts-expect-error var not defined
        if (this.config.enableAlexa) {
            this.log.info('IOT enabled, create state');
            objects.iotState.slice(1).map(o => this.setObjectNotExistsAsync(`control${o._id ? `.${o._id}` : ''}`, o));
        } else {
            this.log.info('IOT disabled, delete state');
            objects.iotState.slice(1).map(async o => await this.delObj(`control${o._id ? `.${o._id}` : ''}`));
        }

        this.getStateAsync('deviceInfo.unsupported').then(obj => {
            if (obj && typeof obj.val == 'string') {
                this.unsupportedFeatures = obj.val;
                if (!this.unsupportedFeatures.endsWith('|')) {
                    this.unsupportedFeatures.concat('|');
                }
                if (!this.unsupportedFeatures.startsWith('|')) {
                    this.unsupportedFeatures = `|${this.unsupportedFeatures}`;
                }
            }
        });
    }

    isUnsupportedFeature(key) {
        return this.unsupportedFeatures.indexOf(`|${key}|`) >= 0;
    }

    setUnsupportedFeature(key) {
        if (this.unsupportedFeatures.indexOf(`|${key}|`) == -1) {
            this.unsupportedFeatures += `${key}|`;
            this.setStateAsync('deviceInfo.unsupported', this.unsupportedFeatures, true);
        }
    }

    /**
     * first communication to find out the model
     */
    async getModel() {
        let DeviceModel;
        let DeviceData;
        // try 5 times to get data
        for (let i = 0; i < 5; i++) {
            DeviceData = await this.getModelFromApi();
            this.log.debug(`Get Device data..${i}`);
            if (DeviceData) {
                this.log.debug(
                    `Get Device data from robot.. ${JSON.stringify(DeviceData.result).replace(/"token":"(.{10}).+"/g, '"token":"$1XXXXXX"')}`,
                );
                await this.setModelInfoObject(DeviceData.result);
                DeviceModel = DeviceData.result.model;

                await this.setConnection(true);
                break;
            }
        }
        if (!DeviceData) {
            //try to get from Config
            // @ts-expect-error var not defined
            DeviceModel = this.config.model;
            if (DeviceModel) {
                this.log.warn('Device information did not answer during startup; using the configured model');
            } else {
                const objModel = await this.getStateAsync('deviceInfo.model');
                if (objModel && objModel.val) {
                    DeviceModel = objModel.val;
                    this.log.warn('Device information did not answer during startup; using the stored model');
                }
            }
        }
        if (!DeviceModel) {
            this.log.error('could not find model, please try again later or set manually in config');
            return;
        }
        this.log.debug(`DeviceModel set to: ${DeviceModel}`);
        // @ts-expect-error var not defined
        const manager = this.getManager(DeviceModel, this.config.manager);

        //we get a model so we can select a protocol
        if (manager) {
            this.device = DeviceModel;
            vacuum = new manager(this, Miio);
        }
    }

    getManager(model, configuredManager) {
        const mangerList = {
            viomi: ViomiManager,
            roborock: VacuumManager,
            rockrobo: VacuumManager,
            dreame: DreameManager,
            xiaomi: DreameManager,
        };
        let manager;
        if (configuredManager) {
            manager = mangerList[configuredManager];
            if (!manager) {
                this.log.error(`selected manager ${configuredManager} is not supported`);
            }
        } else if (model) {
            //try to get stock Model maybe it is working
            manager = mangerList[model.split('.')[0]];
            if (!manager) {
                this.log.error(`Model ${model} not supported! You can try to setup manually a library in settings.`);
            }
        }
        return manager;
        /* const deviceList = {
	//'mijia.vacuum.v2' : MiotVacuum, //  Modell: Xiaomi mijia g1
	//'dreame.vacuum.mc1808' : MiotVacuum, //  Modell: Xioami mijia 1c
	'viomi.vacuum.v7': ViomiManager,
	'viomi.vacuum.v8': ViomiManager,
	'viomi.vacuum.v19': ViomiManager, //test
	'viomi.vacuum.v13': ViomiManager, // added for test
	'roborock.vacuum.s4': VacuumManager, // Roborock S4
	'roborock.vacuum.s5': VacuumManager,
	'roborock.vacuum.s5e': VacuumManager, // Roborock S5 Max
	'roborock.vacuum.s6': VacuumManager,
	'roborock.vacuum.a08': VacuumManager, // Roborock S6 Pure
	'roborock.vacuum.m1s': VacuumManager,
	'rockrobo.vacuum.v1': VacuumManager,
	'roborock.vacuum.a10': VacuumManager, // Roborock S6 MaxV
	'roborock.vacuum.a15': VacuumManager, // Roborock S7
	'roborock.vacuum.a27': VacuumManager, // Roborock S7 MaxV
	'roborock.vacuum.a38': VacuumManager, // Roborock Q7 Max
	'roborock.vacuum.a51': VacuumManager, // Roborock S8
	'roborock.vacuum.a62': VacuumManager, // Roborock S7 Pro Ultra
	'roborock.vacuum.a70': VacuumManager, // Roborock S8 Ultra Pro
	'roborock.vacuum.a74': VacuumManager, // Roborock P10
	// 'roborock.sweeper.e2v3': VacuumManager2,
	// 'roborock.sweeper.e2v2': VacuumManager2,
	// 'roborock.vacuum.e2': VacuumManager2,
	// 'roborock.sweeper.c1v3': VacuumManager2,
	// 'roborock.sweeper.c1v2': VacuumManager2,
	// 'roborock.vacuum.c1': VacuumManager2,
	// 'roborock.vacuum.a01': VacuumManager2,
	// 'roborock.vacuum.a01v2': VacuumManager2,
	// 'roborock.vacuum.a01v3': VacuumManager2,
	// 'roborock.vacuum.a04': VacuumManager2,
	// 'roborock.vacuum.a04v2': VacuumManager2,
	// 'roborock.vacuum.a04v3': VacuumManager2
	'dreame.vacuum.r2205': DreameManager, // Dreame D10 Plus
	'dreame.vacuum.r2216o': DreameManager, // Dreame L10S Pro
	'dreame.vacuum.r2228o': DreameManager, // Dreame L10S Ultra
	'dreame.vacuum.p2008': DreameManager, // Dreame F9
	'dreame.vacuum.p2009': DreameManager, // Dreame D9
	'dreame.vacuum.p2027': DreameManager, // Dreame W10
	'dreame.vacuum.p2028': DreameManager, // Dreame Z10 Pro
	'dreame.vacuum.p2029': DreameManager, // Dreame L10 Pro
	'dreame.vacuum.p2036': DreameManager, // Trouver Finder LDS Cleaner
	'dreame.vacuum.p2041o': DreameManager, // Xiaomi Vacuum Mop 2 Pro+
	'dreame.vacuum.p2114a': DreameManager, // Xiaomi Robot Vacuum X10 Plus
	'xiaomi.vacuum.c102gl': DreameManager, // Xiaomi Robot Vacuum X20 Plus
	'dreame.vacuum.p2148o': DreameManager, // Xiaomi Mijia Ultra Slim
	'dreame.vacuum.p2156o': DreameManager, // MOVA Z500
};*/
    }

    /**
     * function to set DeviceInfo
     *
     * @param deviceInfo Model name from Xiaomi eg: viomi.vacuum.v8
     */
    async setModelInfoObject(deviceInfo) {
        await this.setStateAsync('deviceInfo.model', {
            val: deviceInfo.model,
            ack: true,
        });
        await this.setStateAsync('deviceInfo.fw_ver', {
            val: deviceInfo.fw_ver,
            ack: true,
        });
        await this.setStateAsync('deviceInfo.mac', {
            val: deviceInfo.mac,
            ack: true,
        });
        return true;
    }

    /**
     * Function to set the connection indicator
     *
     * @param indicator could be true or false
     */
    async setConnection(indicator) {
        await this.setStateAsync('info.connection', {
            val: indicator,
            ack: true,
        });
    }

    async getModelFromApi() {
        try {
            const DeviceData = await Miio.sendMessage('miIO.info');

            this.log.debug(
                `GETMODELFROMAPI:Data: ${JSON.stringify(DeviceData).replace(
                    /"token":"(.{10}).+"/g,
                    '"token":"$1XXXXXX"',
                )}`,
            );
            return DeviceData.result ? DeviceData : null;
        } catch (error) {
            this.log.debug(`getModelFromApi: ${error}`);
            return null;
        }
    }

    /**
     * delete async function
     *
     * @param id id
     */
    async delObj(id) {
        try {
            await this.delObjectAsync(id);
        } catch (error) {
            this.log.debug(`delObj: ${error}`);
            //... do nothing
        }
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Reset the connection indicator during startup
        this.setConnection(false);
        await this.ensureAuthStates();
        XiaomiApi = new XiaomiCloudConnector(this.log, {}, this);
        this.main();
    }

    async ensureAuthStates() {
        await this.setObjectNotExistsAsync('auth', {
            type: 'channel',
            common: { name: 'Xiaomi Cloud authentication' },
            native: {},
        });
        const states = {
            status: { name: 'Authentication status', type: 'string', role: 'text', def: 'not_authenticated' },
            loginUrl: { name: 'Xiaomi QR login URL', type: 'string', role: 'text.url', def: '' },
            lastError: { name: 'Last authentication error', type: 'string', role: 'text', def: '' },
            expiresAt: { name: 'QR login expiry timestamp', type: 'number', role: 'value.time', def: 0 },
        };
        await Promise.all(
            Object.entries(states).map(([id, common]) =>
                this.setObjectNotExistsAsync(`auth.${id}`, {
                    type: 'state',
                    common: { ...common, read: true, write: false },
                    native: {},
                }),
            ),
        );
        await this.setStateAsync('auth.status', 'not_authenticated', true);
    }

    async getTimersForAdmin() {
        const [objects, states, roomObjects] = await Promise.all([
            this.getAdapterObjectsAsync(),
            this.getStatesAsync('timer.*'),
            this.getForeignObjectsAsync('enum.rooms.*'),
        ]);
        const prefix = `${this.namespace}.timer.`;
        const rooms = Object.values(roomObjects || {}).map(room => ({
            id: room._id,
            name: room.common.name,
            members: room.common.members || [],
        }));
        const channels = Object.values(objects)
            .filter(object => object.type === 'channel' && object._id.startsWith(`${this.namespace}.rooms.`))
            .map(channel => ({ id: channel._id.split('.').pop(), name: channel.common.name }));
        const timers = Object.values(objects)
            .filter(object => object.type === 'state' && object._id.startsWith(prefix))
            .map(object => {
                const name = object._id.slice(prefix.length);
                const [days = '', hour = '0', minute = '0'] = name.split('_');
                return {
                    id: name,
                    enabled: states[object._id]?.val !== -1,
                    day: days.split('').filter(day => /^[0-6]$/.test(day)),
                    hour: Number(hour),
                    minute: Number(minute),
                    channels: object.native.channels || [],
                    rooms: rooms.filter(room => room.members.includes(object._id)).map(room => room.id),
                };
            });
        return { timers, rooms: rooms.map(({ id, name }) => ({ id, name })), channels };
    }

    async saveTimersFromAdmin(timers) {
        if (!Array.isArray(timers)) throw new Error('Timers must be an array');
        const normalized = new Map();
        for (const timer of timers) {
            const days = [...new Set((timer.day || []).map(String).filter(day => /^[0-6]$/.test(day)))].sort().join('');
            const hour = Number(timer.hour);
            const minute = Number(timer.minute);
            if (!days || !Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
                throw new Error('Invalid timer definition');
            }
            const id = `${days}_${String(hour).padStart(2, '0')}_${String(minute).padStart(2, '0')}`;
            if (normalized.has(id)) throw new Error('Two timers cannot have the same start time');
            normalized.set(id, { enabled: !!timer.enabled, channels: Array.isArray(timer.channels) ? timer.channels : [], rooms: Array.isArray(timer.rooms) ? timer.rooms : [] });
        }
        const existing = await this.getAdapterObjectsAsync();
        const prefix = `${this.namespace}.timer.`;
        for (const object of Object.values(existing)) {
            if (object.type === 'state' && object._id.startsWith(prefix) && !normalized.has(object._id.slice(prefix.length))) {
                await this.delObjectAsync(object._id);
            }
        }
        for (const [id, timer] of normalized) {
            const stateId = `timer.${id}`;
            await this.extendObjectAsync(stateId, {
                type: 'state',
                common: { name: id, type: 'number', role: 'value', read: true, write: true, min: -1, max: 2, states: { '1': 'enabled', '-1': 'disabled', '0': 'skip', '2': 'start now' } },
                native: { channels: timer.channels, nextProcessTime: 0 },
            });
            await this.setStateAsync(stateId, timer.enabled ? 1 : -1, false);
        }
        const roomObjects = await this.getForeignObjectsAsync('enum.rooms.*');
        for (const room of Object.values(roomObjects || {})) {
            const members = (room.common.members || []).filter(member => !member.startsWith(prefix));
            for (const [id, timer] of normalized) if (timer.rooms.includes(room._id)) members.push(`${prefix}${id}`);
            room.common.members = [...new Set(members)];
            await this.setForeignObjectAsync(room._id, room);
        }
        return this.getTimersForAdmin();
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param callback function
     */
    async onUnload(callback) {
        try {
            XiaomiApi?.shutdown();
            if (vacuum) {
                await vacuum.close();
            }
            if (Miio) {
                Miio.close(callback);
            } else {
                callback();
            }
        } catch (e) {
            this.log.debug(`onUNload: ${e}`);
            callback();
        }
    }

    // If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
    // You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
    // /**
    //  * Is called if a subscribed object changes
    //  * @param {string} id
    //  * @param {ioBroker.Object | null | undefined} obj
    //  */
    // onObjectChange(id, obj) {
    //     if (obj) {
    //         // The object was changed
    //         this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
    //     } else {
    //         // The object was deleted
    //         this.log.info(`object ${id} deleted`);
    //     }
    // }

    /**
     * Is called if a subscribed state changes
     *
     * @param id id
     * @param state state
     */
    async onStateChange(id, state) {
        if (!state || state.ack) {
            return;
        }

        // output to parser
        const terms = id.split('.');
        const command = terms.pop();

        // Send own commands
        if (command === 'X_send_command') {
            const values = (state.val || '').toString().trim().split(';');
            let params = [''];
            if (values[1]) {
                try {
                    params = JSON.parse(values[1]);
                } catch (e) {
                    this.log.debug(`onStateChange: ${e}`);
                    return this.setState(
                        'control.X_get_response',
                        `Could not send these params because its not in JSON format: ${values[1]}`,
                        true,
                    );
                }
                this.log.info(`send message: Method: ${values[0]} Params: ${values[1]}`);
            } else {
                this.log.info(`send message: Method: ${values[0]}`);
            }
            this.setStateAsync(id, state.val, true);

            try {
                const DeviceData = await Miio.sendMessage(values[0], params);
                this.log.debug(`Get self send data: ${JSON.stringify(DeviceData)}`);
                this.setStateAsync('control.X_get_response', JSON.stringify(DeviceData.result), true);
            } catch (error) {
                this.setStateAsync('control.X_get_response', `[${error}]`, true);
            }
        }
        if (vacuum) {
            vacuum.stateChange(id, state);
        }
    }

    /**
     * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
     * Using this method requires "common.message" property to be set to true in io-package.json
     *
     * @param obj message object
     */
    async onMessage(obj) {
        if (typeof obj === 'object' && obj.message) {
            if (obj.command === 'send') {
                // e.g. send email or pushover or whatever
                this.log.info('send command');

                // Send response in callback if required
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, 'Message received', obj.callback);
                }
            }
        }
        // responds to the adapter that sent the original message
        const respond = response => obj.callback && this.sendTo(obj.from, obj.command, response, obj.callback);

        // handle the message
        if (obj) {
            switch (obj.command) {
                case 'discovery': {
                    if (!XiaomiApi) {
                        XiaomiApi = new XiaomiCloudConnector(this.log, obj.message.authObj, this);
                    } else {
                        XiaomiApi.init(obj.message.authObj);
                    }
                    const result = await XiaomiApi.login();
                    if (result.ok) {
                        try {
                            respond(await XiaomiApi.getDevices(obj.message.server));
                        } catch (error) {
                            respond({
                                err: error instanceof Error ? error.message : 'Could not retrieve Xiaomi devices',
                            });
                        }
                    } else {
                        respond(result);
                    }
                    return;
                }

                case 'startCloudLogin': {
                    if (!XiaomiApi) {
                        XiaomiApi = new XiaomiCloudConnector(this.log, {}, this);
                    }
                    this.log.debug('Cloud auth: QR login start requested by admin');
                    respond(await XiaomiApi.startQrLogin());
                    return;
                }

                case 'getTimers':
                    try {
                        respond(await this.getTimersForAdmin());
                    } catch (error) {
                        respond({ err: error instanceof Error ? error.message : 'Could not load timers' });
                    }
                    return;

                case 'saveTimers':
                    try {
                        respond(await this.saveTimersFromAdmin(obj.message?.timers));
                    } catch (error) {
                        respond({ err: error instanceof Error ? error.message : 'Could not save timers' });
                    }
                    return;

                // ======================================================================
                default:
                    //respond(predefinedResponses.ERROR_UNKNOWN_COMMAND);
                    //await vacuum.onMessage(obj)
                    //this.log.warn('gottosent vacuu '+ JSON.stringify(obj))
                    if (!vacuum) {
                        return respond({
                            error: new Error('Not initialized'),
                        });
                    }
                    respond(await vacuum.onMessage(obj));
                    return;
            }
        }
    }
}

// @ts-expect-error parent is a valid property on module
if (module.parent) {
    // Export the constructor in compact mode
    module.exports = options => new MihomeVacuum(options);
} else {
    // otherwise start the instance directly
    new MihomeVacuum();
}
