import React from 'react';

import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Checkbox,
    Chip,
    CircularProgress,
    CssBaseline,
    FormControl,
    FormControlLabel,
    Grid2 as Grid,
    IconButton,
    InputAdornment,
    InputLabel,
    Link,
    MenuItem,
    Select,
    Stack,
    Tab,
    Tabs,
    TextField,
    ThemeProvider,
    Typography,
} from '@mui/material';
import {
    CheckCircleRounded,
    Cloud as CloudIcon,
    HomeRounded,
    Map as MapIcon,
    LinkRounded as LoginLinkIcon,
    ScheduleRounded,
    Settings as SettingsIcon,
    VisibilityOffRounded,
    VisibilityRounded,
} from '@mui/icons-material';
import { GenericApp } from '@iobroker/gui-components/build/GenericApp';
import { InfoBox } from '@iobroker/gui-components/build/Components/InfoBox';
import { Loader } from '@iobroker/gui-components/build/Components/Loader';
import { I18n } from '@iobroker/gui-components/build/i18n';
import type { GenericAppProps } from '@iobroker/gui-components/build/types';

import { translations } from './translations';
import { TimerTab } from './TimerTab';
import type {
    AdminTimer,
    CloudAuthStatus,
    CloudAuthState,
    DiscoveredDevice,
    DiscoveryHome,
    DiscoveryResult,
    TimerAdminResult,
    VacuumAdminState,
    VacuumNative,
} from './types';

const emptyAuth: CloudAuthState = {
    status: 'not_authenticated',
    loginUrl: '',
    lastError: '',
    expiresAt: 0,
};

const cardSx = {
    borderRadius: 3,
    borderColor: 'divider',
    backgroundImage: 'linear-gradient(145deg, rgba(77, 171, 245, 0.045), transparent 42%)',
    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.08)',
} as const;

const authStatusLabels: Record<CloudAuthStatus, string> = {
    not_authenticated: 'Not authenticated',
    waiting_for_scan: 'Waiting for login',
    waiting_for_confirmation: 'Waiting for confirmation',
    authenticated: 'Authenticated',
    expired: 'Login link expired',
    error: 'Authentication error',
};

const officialEncryptionPrefix = '$/aes-192-cbc:';
const tokenPattern = /^(?:[a-f\d]{31}|[a-f\d]{32}|[a-f\d]{96})$/i;
type SecretField = 'password' | 'token';

function hexToBytes(value: string): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(value.length / 2);
    for (let index = 0; index < value.length; index += 2) {
        bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
    }
    return bytes;
}

function bytesToHex(value: ArrayBuffer | Uint8Array): string {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

const defaultNative: VacuumNative = {
    email: '',
    password: '',
    server: '-',
    token: '',
    ip: '',
    model: '',
    manager: '',
    enableMiMap: false,
    enableSelfCommands: false,
    enableAdvancedDebug: false,
    sendPauseBeforeHome: false,
    enableResumeZone: false,
    port: 54321,
    ownPort: 53421,
    pingInterval: 20_000,
    wifiInterval: 60_000,
    valetudo_enable: false,
    valetudo_color_floor: '#56affc',
    valetudo_color_wall: '#b3edff',
    valetudo_color_path: '#FFFFFF',
    robot_select: 'robot',
    valetudo_requestIntervall: 2_000,
    valetudo_MapsaveIntervall: 5_000,
    newmap: false,
};

class App extends GenericApp<GenericAppProps, VacuumAdminState> {
    private authPollTimer: ReturnType<typeof setInterval> | null = null;
    private loadedToken = '';
    private recoveredLegacySecret = false;
    private secretsLoadFailed = false;
    private saveInProgress = false;
    private systemSecret = '';
    private encryptedSecretsToLoad: Partial<Record<SecretField, string>> = {};
    private encryptedSecretsToSave: Record<SecretField, string> | null = null;

    constructor(props: GenericAppProps) {
        super(props, {
            adapterName: 'mihome-vacuum',
            doNotLoadAllObjects: true,
        });
        this.state = {
            ...this.state,
            native: { ...defaultNative },
            auth: emptyAuth,
            discoveredDevices: [],
            selectedDevice: '',
            authBusy: false,
            discoveryBusy: false,
            timers: [],
            timerRooms: [],
            timerChannels: [],
            timersLoading: false,
            timersSaving: false,
            timersDirty: false,
            tokenVisible: false,
        };
    }

    override onLoadConfig(native: Record<string, unknown>): void {
        this.loadedToken = typeof native.token === 'string' ? native.token.trim() : '';
        this.setState({
            native: {
                ...defaultNative,
                ...native,
                email: typeof native.email === 'string' ? native.email : '',
                password: typeof native.password === 'string' ? native.password : '',
                token: typeof native.token === 'string' ? native.token : '',
                ip: typeof native.ip === 'string' ? native.ip : '',
                model: typeof native.model === 'string' ? native.model : '',
            },
        });
    }

    override async getSystemConfig(): Promise<ioBroker.SystemConfigObject> {
        const config = await super.getSystemConfig();
        this.systemSecret = typeof config.native?.secret === 'string' ? config.native.secret : '';
        return config;
    }

    override onPrepareLoad(settings: Record<string, unknown>): void {
        for (const field of ['password', 'token'] as const) {
            const storedValue = typeof settings[field] === 'string' ? settings[field] : '';
            if (!storedValue) {
                continue;
            }
            if (storedValue.startsWith(officialEncryptionPrefix)) {
                this.encryptedSecretsToLoad[field] = storedValue;
                settings[field] = '';
                continue;
            }
            const normalizedValue = storedValue.trim();
            if (field === 'token' && tokenPattern.test(normalizedValue)) {
                settings.token = normalizedValue;
                this.loadedToken = normalizedValue;
                this.recoveredLegacySecret = true;
                continue;
            }

            const legacyValue = this.decrypt(storedValue);
            if (field === 'password' || tokenPattern.test(legacyValue)) {
                settings[field] = legacyValue;
                this.recoveredLegacySecret = true;
                if (field === 'token') {
                    this.loadedToken = legacyValue;
                }
            } else {
                settings[field] = '';
                this.secretsLoadFailed = true;
            }
        }
    }

    override onConnectionReady(): void {
        void this.initializeConnection();
    }

    private async initializeConnection(): Promise<void> {
        await this.loadOfficialSecrets();
        if (this.recoveredLegacySecret) {
            globalThis.changed = true;
            try {
                window.parent.postMessage('change', '*');
            } catch {
                // The embedded admin window may not expose its parent during tests.
            }
            this.setState({ changed: true });
        }
        void this.updateCloudAuth();
        void this.loadTimers(false);
        this.authPollTimer = setInterval(() => void this.updateCloudAuth(), 3_000);
    }

    private async loadOfficialSecrets(): Promise<void> {
        const entries = Object.entries(this.encryptedSecretsToLoad) as [SecretField, string][];
        if (!entries.length) {
            return;
        }
        try {
            const decryptedEntries = await Promise.all(
                entries.map(async ([field, value]) => [field, await this.decryptProtectedValue(value)] as const),
            );
            const native = { ...this.state.native };
            for (const [field, value] of decryptedEntries) {
                native[field] = value;
                if (field === 'token') {
                    this.loadedToken = value;
                }
            }
            this.setState({ native });
        } catch {
            this.secretsLoadFailed = true;
            this.showAlert(I18n.t('Could not decrypt protected configuration'), 'error');
        } finally {
            this.encryptedSecretsToLoad = {};
        }
    }

    private canUseOfficialBrowserCrypto(): boolean {
        return /^[0-9a-f]{48}$/.test(this.systemSecret) && !!globalThis.crypto?.subtle;
    }

    private async encryptProtectedValue(value: string): Promise<string> {
        if (!this.canUseOfficialBrowserCrypto()) {
            return this.socket.encrypt(value);
        }
        const key = await globalThis.crypto.subtle.importKey(
            'raw',
            hexToBytes(this.systemSecret),
            { name: 'AES-CBC' },
            false,
            ['encrypt'],
        );
        const iv = globalThis.crypto.getRandomValues(new Uint8Array(16));
        const encrypted = await globalThis.crypto.subtle.encrypt(
            { name: 'AES-CBC', iv },
            key,
            new TextEncoder().encode(value),
        );
        return `${officialEncryptionPrefix}${bytesToHex(iv)}:${bytesToHex(encrypted)}`;
    }

    private async decryptProtectedValue(value: string): Promise<string> {
        if (!this.canUseOfficialBrowserCrypto() || !value.startsWith(officialEncryptionPrefix)) {
            return this.socket.decrypt(value);
        }
        const [ivHex, encryptedHex] = value.slice(officialEncryptionPrefix.length).split(':', 2);
        if (!/^[0-9a-f]{32}$/.test(ivHex) || !/^[0-9a-f]+$/.test(encryptedHex)) {
            throw new Error('Invalid protected configuration format');
        }
        const key = await globalThis.crypto.subtle.importKey(
            'raw',
            hexToBytes(this.systemSecret),
            { name: 'AES-CBC' },
            false,
            ['decrypt'],
        );
        const decrypted = await globalThis.crypto.subtle.decrypt(
            { name: 'AES-CBC', iv: hexToBytes(ivHex) },
            key,
            hexToBytes(encryptedHex),
        );
        return new TextDecoder().decode(decrypted);
    }

    override onPrepareSave(settings: Record<string, unknown>): boolean {
        const token = typeof settings.token === 'string' ? settings.token.replace(/\s/g, '') : '';
        if (![31, 32, 96].includes(token.length)) {
            this.encryptedSecretsToSave = null;
            this.saveInProgress = false;
            this.showAlert(I18n.t('Invalid token length. Expected 32 or 96 HEX chars.'), 'error');
            return false;
        }
        settings.token = token;
        settings.ip = typeof settings.ip === 'string' ? settings.ip.trim() : '';
        settings.email = typeof settings.email === 'string' ? settings.email.trim() : '';
        delete settings.devices;
        delete settings.MiDevice;
        if (token !== this.loadedToken) {
            void this.socket.setState(`${this.adapterName}.${this.instance}.deviceInfo.unsupported`, '', true);
        }
        if (!this.encryptedSecretsToSave) {
            this.saveInProgress = false;
            this.showAlert(I18n.t('Could not encrypt protected configuration'), 'error');
            return false;
        }
        settings.token = this.encryptedSecretsToSave.token;
        settings.password = this.encryptedSecretsToSave.password;
        this.encryptedSecretsToSave = null;
        this.saveInProgress = false;
        return true;
    }

    override onSave(isClose?: boolean): void {
        void this.saveWithOfficialEncryption(isClose);
    }

    private async saveWithOfficialEncryption(isClose?: boolean): Promise<void> {
        if (this.saveInProgress) {
            return;
        }
        if (this.secretsLoadFailed) {
            this.showAlert(I18n.t('Could not decrypt protected configuration'), 'error');
            return;
        }
        const token = typeof this.state.native.token === 'string' ? this.state.native.token.replace(/\s/g, '') : '';
        if (![31, 32, 96].includes(token.length)) {
            this.showAlert(I18n.t('Invalid token length. Expected 32 or 96 HEX chars.'), 'error');
            return;
        }

        this.saveInProgress = true;
        try {
            if (this.state.timersDirty && !(await this.saveTimers())) {
                return;
            }
            const password = typeof this.state.native.password === 'string' ? this.state.native.password : '';
            const [encryptedToken, encryptedPassword] = await Promise.all([
                this.encryptProtectedValue(token),
                password ? this.encryptProtectedValue(password) : Promise.resolve(''),
            ]);
            if (
                !encryptedToken.startsWith(officialEncryptionPrefix) ||
                (password && !encryptedPassword.startsWith(officialEncryptionPrefix))
            ) {
                throw new Error('Unexpected protected configuration format');
            }
            this.encryptedSecretsToSave = { token: encryptedToken, password: encryptedPassword };
            super.onSave(isClose);
        } catch {
            this.encryptedSecretsToSave = null;
            this.showAlert(I18n.t('Could not encrypt protected configuration'), 'error');
        } finally {
            if (!this.encryptedSecretsToSave) {
                this.saveInProgress = false;
            }
        }
    }

    override componentWillUnmount(): void {
        if (this.authPollTimer) {
            clearInterval(this.authPollTimer);
            this.authPollTimer = null;
        }
        super.componentWillUnmount();
    }

    private updateNative = <K extends keyof VacuumNative>(key: K, value: VacuumNative[K]): void => {
        this.updateNativeValue(String(key), value);
    };

    private async updateCloudAuth(): Promise<void> {
        try {
            const prefix = `${this.adapterName}.${this.instance}.auth.`;
            const states = await this.socket.getStates(`${prefix}*`);
            const value = (id: string): ioBroker.StateValue => states[`${prefix}${id}`]?.val;
            const status = value('status');
            this.setState({
                auth: {
                    status: typeof status === 'string' ? (status as CloudAuthState['status']) : 'not_authenticated',
                    loginUrl: typeof value('loginUrl') === 'string' ? String(value('loginUrl')) : '',
                    lastError: typeof value('lastError') === 'string' ? String(value('lastError')) : '',
                    expiresAt: typeof value('expiresAt') === 'number' ? Number(value('expiresAt')) : 0,
                },
            });
        } catch {
            // The adapter may still be starting. The next poll retries without exposing connection details.
        }
    }

    private startCloudLogin = async (): Promise<void> => {
        this.setState({ authBusy: true });
        try {
            const result = await this.socket.sendTo<{ err?: string }>(
                `${this.adapterName}.${this.instance}`,
                'startCloudLogin',
                {},
            );
            if (result?.err) {
                this.showAlert(result.err, 'error');
            }
            await this.updateCloudAuth();
        } catch {
            this.showAlert(I18n.t('Could not create Xiaomi login link'), 'error');
        } finally {
            this.setState({ authBusy: false });
        }
    };

    private discoverDevices = async (): Promise<void> => {
        this.setState({ discoveryBusy: true });
        try {
            const alive = await this.socket.getState(`system.adapter.${this.adapterName}.${this.instance}.alive`);
            if (!alive?.val) {
                this.showAlert(I18n.t('Please activate instance'), 'warning');
                return;
            }
            const result = await this.socket.sendTo<DiscoveryResult>(
                `${this.adapterName}.${this.instance}`,
                'discovery',
                { authObj: {}, server: this.state.native.server },
            );
            if (result?.err) {
                this.showAlert(result.err, 'error');
                return;
            }
            const devices: DiscoveredDevice[] = [];
            for (const home of Object.values(result || {})) {
                const entries = (home as DiscoveryHome)?.result?.device_info;
                if (!Array.isArray(entries)) {
                    continue;
                }
                for (const entry of entries) {
                    if (!entry || typeof entry !== 'object') {
                        continue;
                    }
                    const device = entry as Record<string, unknown>;
                    const model = typeof device.model === 'string' ? device.model : '';
                    const specType = typeof device.spec_type === 'string' ? device.spec_type : '';
                    if (
                        !model.toLowerCase().includes('.vacuum.') &&
                        !specType.toLowerCase().includes(':device:vacuum:')
                    ) {
                        continue;
                    }
                    devices.push({
                        token: typeof device.token === 'string' ? device.token : '',
                        localip: typeof device.localip === 'string' ? device.localip : '',
                        model,
                    });
                }
            }
            const selectedDevice = devices.length === 1 ? 0 : '';
            this.setState({ discoveredDevices: devices, selectedDevice }, () => {
                if (devices.length === 1) {
                    this.fillMissingDeviceSettings(devices[0]);
                }
            });
            this.showAlert(I18n.t('%s devices found', devices.length), devices.length ? 'success' : 'info');
        } catch {
            this.showAlert(I18n.t('Could not retrieve Xiaomi devices'), 'error');
        } finally {
            this.setState({ discoveryBusy: false });
        }
    };

    private selectDevice = (index: number | ''): void => {
        this.setState({ selectedDevice: index });
        if (index === '') {
            return;
        }
        const device = this.state.discoveredDevices[index];
        if (!device) {
            return;
        }
        this.fillMissingDeviceSettings(device);
    };

    private fillMissingDeviceSettings(device: DiscoveredDevice): void {
        const native = { ...this.state.native };
        let changed = false;
        for (const [key, value] of [
            ['token', device.token],
            ['ip', device.localip],
            ['model', device.model],
        ] as const) {
            if (!native[key].trim() && value.trim()) {
                native[key] = value.trim();
                changed = true;
            }
        }
        if (changed) {
            this.setState({ native, changed: true });
        }
    }

    private loadTimers = async (showErrors = true): Promise<void> => {
        this.setState({ timersLoading: true });
        try {
            const result = await this.socket.sendTo<TimerAdminResult>(
                `${this.adapterName}.${this.instance}`,
                'getTimers',
                {},
            );
            if (result?.err) {
                if (showErrors) {
                    this.showAlert(result.err, 'error');
                }
                return;
            }
            this.setState({
                timers: Array.isArray(result?.timers) ? result.timers : [],
                timerRooms: Array.isArray(result?.rooms) ? result.rooms : [],
                timerChannels: Array.isArray(result?.channels) ? result.channels : [],
                timersDirty: false,
            });
        } catch {
            if (showErrors) {
                this.showAlert(I18n.t('Could not load timers'), 'error');
            }
        } finally {
            this.setState({ timersLoading: false });
        }
    };

    private saveTimers = async (): Promise<boolean> => {
        const ids = new Set<string>();
        for (const timer of this.state.timers) {
            const id = `${[...new Set(timer.day)].sort().join('')}_${String(timer.hour).padStart(2, '0')}_${String(timer.minute).padStart(2, '0')}`;
            if (!timer.day.length || ids.has(id)) {
                this.showAlert(
                    I18n.t(ids.has(id) ? 'same start time of 2 timer not possible' : 'Invalid timer definition'),
                    'error',
                );
                return false;
            }
            ids.add(id);
        }
        this.setState({ timersSaving: true });
        try {
            const result = await this.socket.sendTo<TimerAdminResult>(
                `${this.adapterName}.${this.instance}`,
                'saveTimers',
                { timers: this.state.timers },
            );
            if (result?.err) {
                this.showAlert(result.err, 'error');
                return false;
            }
            this.setState({
                timers: Array.isArray(result?.timers) ? result.timers : this.state.timers,
                timerRooms: Array.isArray(result?.rooms) ? result.rooms : this.state.timerRooms,
                timerChannels: Array.isArray(result?.channels) ? result.channels : this.state.timerChannels,
                timersDirty: false,
                changed: this.getIsChanged(this.state.native),
            });
            this.showAlert(I18n.t('Timers saved'), 'success');
            return true;
        } catch {
            this.showAlert(I18n.t('Could not save timers'), 'error');
            return false;
        } finally {
            this.setState({ timersSaving: false });
        }
    };

    private updateTimers = (timers: AdminTimer[]): void => {
        this.setState({ timers, timersDirty: true, changed: true });
    };

    private renderConnection(): React.JSX.Element {
        const waiting =
            this.state.auth.status === 'waiting_for_scan' || this.state.auth.status === 'waiting_for_confirmation';
        return (
            <Stack spacing={2}>
                <Card
                    variant="outlined"
                    sx={cardSx}
                >
                    <CardContent>
                        <Stack spacing={2}>
                            <Stack
                                direction="row"
                                spacing={1}
                                alignItems="center"
                            >
                                <CloudIcon color="primary" />
                                <Typography variant="h6">{I18n.t('Xiaomi cloud authentication')}</Typography>
                            </Stack>
                            <InfoBox type="info">{I18n.t('Xiaomi login link help')}</InfoBox>
                            <Stack
                                direction={{ xs: 'column', sm: 'row' }}
                                spacing={2}
                                alignItems={{ sm: 'center' }}
                            >
                                <Button
                                    variant="contained"
                                    startIcon={this.state.authBusy ? <CircularProgress size={18} /> : <LoginLinkIcon />}
                                    disabled={this.state.authBusy || waiting}
                                    onClick={() => void this.startCloudLogin()}
                                >
                                    {I18n.t('Create Xiaomi login link')}
                                </Button>
                                <Chip
                                    icon={
                                        this.state.auth.status === 'authenticated' ? <CheckCircleRounded /> : undefined
                                    }
                                    color={
                                        this.state.auth.status === 'authenticated'
                                            ? 'success'
                                            : this.state.auth.status === 'error'
                                              ? 'error'
                                              : 'info'
                                    }
                                    variant="outlined"
                                    sx={{ alignSelf: { xs: 'flex-start', sm: 'center' }, px: 0.5 }}
                                    label={`${I18n.t('Cloud status')}: ${I18n.t(authStatusLabels[this.state.auth.status])}`}
                                />
                            </Stack>
                            {this.state.auth.lastError ? (
                                <Alert severity="error">{this.state.auth.lastError}</Alert>
                            ) : null}
                            {waiting && this.state.auth.loginUrl ? (
                                <Link
                                    href={this.state.auth.loginUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {I18n.t('Open Xiaomi login link')}
                                </Link>
                            ) : null}
                            <Grid
                                container
                                spacing={2}
                            >
                                <Grid size={{ xs: 12, md: 4 }}>
                                    <FormControl fullWidth>
                                        <InputLabel>{I18n.t('Server')}</InputLabel>
                                        <Select
                                            label={I18n.t('Server')}
                                            value={this.state.native.server}
                                            onChange={event => this.updateNative('server', String(event.target.value))}
                                        >
                                            <MenuItem value="-">China</MenuItem>
                                            <MenuItem value="sg">Singapore</MenuItem>
                                            <MenuItem value="de">Germany</MenuItem>
                                            <MenuItem value="us">USA</MenuItem>
                                            <MenuItem value="ru">Russia</MenuItem>
                                        </Select>
                                    </FormControl>
                                </Grid>
                                <Grid size={{ xs: 12, md: 4 }}>
                                    <Button
                                        fullWidth
                                        sx={{ height: '56px' }}
                                        variant="outlined"
                                        disabled={
                                            this.state.discoveryBusy || this.state.auth.status !== 'authenticated'
                                        }
                                        onClick={() => void this.discoverDevices()}
                                    >
                                        {this.state.discoveryBusy ? (
                                            <CircularProgress size={22} />
                                        ) : (
                                            I18n.t('get devices')
                                        )}
                                    </Button>
                                </Grid>
                                <Grid size={{ xs: 12, md: 4 }}>
                                    <FormControl
                                        fullWidth
                                        disabled={!this.state.discoveredDevices.length}
                                    >
                                        <InputLabel>{I18n.t('devices')}</InputLabel>
                                        <Select
                                            label={I18n.t('devices')}
                                            value={this.state.selectedDevice}
                                            onChange={event =>
                                                this.selectDevice(
                                                    event.target.value === '' ? '' : Number(event.target.value),
                                                )
                                            }
                                        >
                                            <MenuItem value="">{I18n.t('choose Device')}</MenuItem>
                                            {this.state.discoveredDevices.map((device, index) => (
                                                <MenuItem
                                                    key={`${device.model}-${device.localip}-${index}`}
                                                    value={index}
                                                >
                                                    {device.model || I18n.t('Unknown device')}
                                                    {device.localip ? ` – ${device.localip}` : ''}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                </Grid>
                            </Grid>
                        </Stack>
                    </CardContent>
                </Card>

                <Card
                    variant="outlined"
                    sx={cardSx}
                >
                    <CardContent>
                        <Typography
                            variant="h6"
                            gutterBottom
                        >
                            {I18n.t('manuell settings')}
                        </Typography>
                        <Grid
                            container
                            spacing={2}
                        >
                            <Grid size={{ xs: 12, md: 6 }}>
                                <TextField
                                    fullWidth
                                    type={this.state.tokenVisible ? 'text' : 'password'}
                                    label={I18n.t('Token')}
                                    value={this.state.native.token}
                                    onChange={event => this.updateNative('token', event.target.value.trim())}
                                    slotProps={{
                                        input: {
                                            endAdornment: (
                                                <InputAdornment position="end">
                                                    <IconButton
                                                        aria-label={I18n.t(
                                                            this.state.tokenVisible ? 'Hide token' : 'Show token',
                                                        )}
                                                        title={I18n.t(
                                                            this.state.tokenVisible ? 'Hide token' : 'Show token',
                                                        )}
                                                        edge="end"
                                                        onClick={() =>
                                                            this.setState(state => ({
                                                                tokenVisible: !state.tokenVisible,
                                                            }))
                                                        }
                                                        onMouseDown={event => event.preventDefault()}
                                                    >
                                                        {this.state.tokenVisible ? (
                                                            <VisibilityOffRounded />
                                                        ) : (
                                                            <VisibilityRounded />
                                                        )}
                                                    </IconButton>
                                                </InputAdornment>
                                            ),
                                        },
                                    }}
                                />
                            </Grid>
                            <Grid size={{ xs: 12, md: 3 }}>
                                <TextField
                                    fullWidth
                                    label={I18n.t('IP address:')}
                                    value={this.state.native.ip}
                                    onChange={event => this.updateNative('ip', event.target.value)}
                                />
                            </Grid>
                            <Grid size={{ xs: 12, md: 3 }}>
                                <TextField
                                    fullWidth
                                    label={I18n.t('model')}
                                    value={this.state.native.model}
                                    onChange={event => this.updateNative('model', event.target.value)}
                                />
                            </Grid>
                            <Grid size={{ xs: 12, md: 4 }}>
                                <FormControl fullWidth>
                                    <InputLabel>{I18n.t('manager')}</InputLabel>
                                    <Select
                                        label={I18n.t('manager')}
                                        value={this.state.native.manager}
                                        onChange={event => this.updateNative('manager', String(event.target.value))}
                                    >
                                        <MenuItem value="">Auto</MenuItem>
                                        <MenuItem value="roborock">Roborock</MenuItem>
                                        <MenuItem value="dreame">Dreame</MenuItem>
                                        <MenuItem value="viomi">Viomi</MenuItem>
                                        <MenuItem value="xiaomi">Xiaomi</MenuItem>
                                    </Select>
                                </FormControl>
                            </Grid>
                            <Grid size={{ xs: 6, md: 2 }}>
                                <TextField
                                    fullWidth
                                    type="number"
                                    label={I18n.t('Vacuum port:')}
                                    value={this.state.native.port}
                                    onChange={event => this.updateNative('port', Number(event.target.value))}
                                />
                            </Grid>
                            <Grid size={{ xs: 6, md: 2 }}>
                                <TextField
                                    fullWidth
                                    type="number"
                                    label={I18n.t('Own port:')}
                                    value={this.state.native.ownPort}
                                    onChange={event => this.updateNative('ownPort', Number(event.target.value))}
                                />
                            </Grid>
                        </Grid>
                    </CardContent>
                </Card>
            </Stack>
        );
    }

    private renderSettings(): React.JSX.Element {
        return (
            <Stack spacing={2}>
                <Card
                    variant="outlined"
                    sx={cardSx}
                >
                    <CardContent>
                        <Stack
                            direction="row"
                            spacing={1}
                            alignItems="center"
                            mb={2}
                        >
                            <SettingsIcon color="primary" />
                            <Typography variant="h6">{I18n.t('Settings')}</Typography>
                        </Stack>
                        <Grid
                            container
                            spacing={2}
                        >
                            <Grid size={{ xs: 12, md: 3 }}>
                                <TextField
                                    fullWidth
                                    type="number"
                                    label={I18n.t('get Status Intervall')}
                                    helperText={I18n.t('Seconds')}
                                    value={Math.round(this.state.native.pingInterval / 1_000)}
                                    onChange={event =>
                                        this.updateNative('pingInterval', Number(event.target.value) * 1_000)
                                    }
                                    slotProps={{ htmlInput: { min: 10 } }}
                                />
                            </Grid>
                            <Grid size={{ xs: 12, md: 3 }}>
                                <TextField
                                    fullWidth
                                    type="number"
                                    label={I18n.t('get WiFi Intervall')}
                                    helperText={I18n.t('Seconds')}
                                    value={Math.round(this.state.native.wifiInterval / 1_000)}
                                    onChange={event =>
                                        this.updateNative('wifiInterval', Number(event.target.value) * 1_000)
                                    }
                                    slotProps={{ htmlInput: { min: 20 } }}
                                />
                            </Grid>
                        </Grid>
                        <Stack
                            className="settings-toggle-grid"
                            mt={2}
                        >
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={this.state.native.enableMiMap}
                                        onChange={event => this.updateNative('enableMiMap', event.target.checked)}
                                    />
                                }
                                label={I18n.t('enable Map from xiaomi cloud')}
                            />
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={this.state.native.valetudo_enable}
                                        onChange={event => this.updateNative('valetudo_enable', event.target.checked)}
                                    />
                                }
                                label={I18n.t('Enable Valetudo')}
                            />
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={this.state.native.enableSelfCommands}
                                        onChange={event =>
                                            this.updateNative('enableSelfCommands', event.target.checked)
                                        }
                                    />
                                }
                                label={I18n.t('Send own commands')}
                            />
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={this.state.native.sendPauseBeforeHome}
                                        onChange={event =>
                                            this.updateNative('sendPauseBeforeHome', event.target.checked)
                                        }
                                    />
                                }
                                label={I18n.t('send Pause Before Home')}
                            />
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={this.state.native.enableResumeZone}
                                        onChange={event => this.updateNative('enableResumeZone', event.target.checked)}
                                    />
                                }
                                label={I18n.t('Resume paused zone cleaning with start button')}
                            />
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={this.state.native.enableAdvancedDebug}
                                        onChange={event =>
                                            this.updateNative('enableAdvancedDebug', event.target.checked)
                                        }
                                    />
                                }
                                label={I18n.t('Enable advanced diagnostic logging')}
                            />
                        </Stack>
                        {this.state.native.enableAdvancedDebug ? (
                            <Alert
                                severity="warning"
                                sx={{ mt: 2 }}
                            >
                                {I18n.t('Diagnostic logs stay redacted and never include credentials')}
                            </Alert>
                        ) : null}
                    </CardContent>
                </Card>
            </Stack>
        );
    }

    private renderMapSettings(): React.JSX.Element {
        const mapEnabled = this.state.native.enableMiMap || this.state.native.valetudo_enable;
        return (
            <Card
                variant="outlined"
                sx={cardSx}
            >
                <CardContent>
                    <Stack
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        mb={2}
                    >
                        <MapIcon color="primary" />
                        <Typography variant="h6">{I18n.t('Map settings')}</Typography>
                    </Stack>
                    {!mapEnabled ? <InfoBox type="warning">{I18n.t('Enable a map source first')}</InfoBox> : null}
                    <Grid
                        container
                        spacing={2}
                        mt={0}
                    >
                        <Grid size={{ xs: 12, md: 3 }}>
                            <TextField
                                fullWidth
                                disabled={!mapEnabled}
                                type="number"
                                label={I18n.t('Request Intervall')}
                                value={this.state.native.valetudo_requestIntervall}
                                onChange={event =>
                                    this.updateNative('valetudo_requestIntervall', Number(event.target.value))
                                }
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 3 }}>
                            <TextField
                                fullWidth
                                disabled={!mapEnabled}
                                type="number"
                                label={I18n.t('Map save intervall')}
                                value={this.state.native.valetudo_MapsaveIntervall}
                                onChange={event =>
                                    this.updateNative('valetudo_MapsaveIntervall', Number(event.target.value))
                                }
                            />
                        </Grid>
                        <Grid size={{ xs: 12 }}>
                            <FormControlLabel
                                disabled={!mapEnabled}
                                control={
                                    <Checkbox
                                        checked={this.state.native.newmap}
                                        onChange={event => this.updateNative('newmap', event.target.checked)}
                                    />
                                }
                                label={I18n.t('Use new Map format with room colors')}
                            />
                        </Grid>
                        {(
                            [
                                ['valetudo_color_floor', 'Floor color'],
                                ['valetudo_color_wall', 'Wall color'],
                                ['valetudo_color_path', 'Path color'],
                            ] as const
                        ).map(([key, label]) => (
                            <Grid
                                key={key}
                                size={{ xs: 12, md: 3 }}
                            >
                                <TextField
                                    className="color-field"
                                    fullWidth
                                    disabled={!mapEnabled}
                                    type="color"
                                    label={I18n.t(label)}
                                    value={this.state.native[key]}
                                    onChange={event => this.updateNative(key, event.target.value)}
                                    slotProps={{ inputLabel: { shrink: true } }}
                                />
                            </Grid>
                        ))}
                        <Grid size={{ xs: 12, md: 3 }}>
                            <FormControl
                                fullWidth
                                disabled={!mapEnabled}
                            >
                                <InputLabel>{I18n.t('Robot icon')}</InputLabel>
                                <Select
                                    label={I18n.t('Robot icon')}
                                    value={this.state.native.robot_select}
                                    onChange={event => this.updateNative('robot_select', String(event.target.value))}
                                >
                                    <MenuItem value="robot">Robot</MenuItem>
                                    <MenuItem value="robot1">Robot 1</MenuItem>
                                    <MenuItem value="S5">S5</MenuItem>
                                    <MenuItem value="spaceship">Spaceship</MenuItem>
                                    <MenuItem value="tank">Tank</MenuItem>
                                </Select>
                            </FormControl>
                        </Grid>
                    </Grid>
                </CardContent>
            </Card>
        );
    }

    override render(): React.JSX.Element {
        if (!this.state.loaded) {
            return <Loader themeType={this.state.themeType} />;
        }
        const selectedTab = this.state.selectedTab || 'connection';
        return (
            <ThemeProvider theme={this.state.theme}>
                <CssBaseline />
                <Box
                    className="App"
                    sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
                >
                    <Box className="app-header">
                        <Box className="content-shell">
                            <Stack
                                direction="row"
                                alignItems="center"
                                spacing={2}
                                className="brand-row"
                            >
                                <Box
                                    className="brand-logo"
                                    component="img"
                                    src="./mihome-vacuum.png"
                                    alt="Mi Home Vacuum"
                                />
                                <Box sx={{ minWidth: 0 }}>
                                    <Typography
                                        variant="h5"
                                        fontWeight={700}
                                    >
                                        Mi Home Vacuum
                                    </Typography>
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                    >
                                        {I18n.t('Control of Xiaomi/Roborock vacuum cleaner')}
                                    </Typography>
                                </Box>
                            </Stack>
                            <Tabs
                                value={selectedTab}
                                onChange={(_event, value: string) => this.selectTab(value)}
                                variant="scrollable"
                                scrollButtons="auto"
                                className="main-tabs"
                            >
                                <Tab
                                    icon={<HomeRounded />}
                                    iconPosition="start"
                                    value="connection"
                                    label={I18n.t('Main')}
                                />
                                <Tab
                                    icon={<SettingsIcon />}
                                    iconPosition="start"
                                    value="settings"
                                    label={I18n.t('Settings')}
                                />
                                <Tab
                                    icon={<MapIcon />}
                                    iconPosition="start"
                                    value="map"
                                    label={I18n.t('Map settings')}
                                />
                                <Tab
                                    icon={<ScheduleRounded />}
                                    iconPosition="start"
                                    value="timer"
                                    label={I18n.t('Timer')}
                                />
                            </Tabs>
                        </Box>
                    </Box>
                    <Box sx={{ flex: 1, overflow: 'auto' }}>
                        <Box className="content-shell page-content">
                            {selectedTab === 'connection' ? this.renderConnection() : null}
                            {selectedTab === 'settings' ? this.renderSettings() : null}
                            {selectedTab === 'map' ? this.renderMapSettings() : null}
                            {selectedTab === 'timer' ? (
                                <TimerTab
                                    timers={this.state.timers}
                                    rooms={this.state.timerRooms}
                                    channels={this.state.timerChannels}
                                    loading={this.state.timersLoading}
                                    saving={this.state.timersSaving}
                                    dirty={this.state.timersDirty}
                                    onChange={this.updateTimers}
                                    onReload={() => void this.loadTimers()}
                                    onSave={() => void this.saveTimers()}
                                />
                            ) : null}
                        </Box>
                    </Box>
                    {this.renderSaveCloseButtons()}
                    {this.renderToast()}
                    {this.renderError()}
                    {this.renderHelperDialogs()}
                    {this.renderAlertSnackbar()}
                </Box>
            </ThemeProvider>
        );
    }
}

export default function VacuumAdminApp(props: GenericAppProps): React.JSX.Element {
    return (
        <App
            {...props}
            translations={translations}
        />
    );
}
