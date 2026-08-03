import React from 'react';

import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Checkbox,
    CircularProgress,
    CssBaseline,
    FormControl,
    FormControlLabel,
    Grid2 as Grid,
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
    Cloud as CloudIcon,
    Map as MapIcon,
    QrCode2 as QrCodeIcon,
    Settings as SettingsIcon,
} from '@mui/icons-material';
import { GenericApp } from '@iobroker/gui-components/build/GenericApp';
import { InfoBox } from '@iobroker/gui-components/build/Components/InfoBox';
import { Loader } from '@iobroker/gui-components/build/Components/Loader';
import { I18n } from '@iobroker/gui-components/build/i18n';
import type { GenericAppProps } from '@iobroker/gui-components/build/types';

import { translations } from './translations';
import type {
    CloudAuthState,
    DiscoveredDevice,
    DiscoveryHome,
    DiscoveryResult,
    VacuumAdminState,
    VacuumNative,
} from './types';

const emptyAuth: CloudAuthState = {
    status: 'not_authenticated',
    loginUrl: '',
    lastError: '',
    expiresAt: 0,
};

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

    constructor(props: GenericAppProps) {
        super(props, {
            adapterName: 'mihome-vacuum',
            encryptedFields: ['password', 'token'],
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
        };
    }

    override onLoadConfig(native: Record<string, unknown>): void {
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

    override onConnectionReady(): void {
        void this.updateCloudAuth();
        this.authPollTimer = setInterval(() => void this.updateCloudAuth(), 3_000);
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
            this.showAlert(I18n.t('Could not start Xiaomi QR login'), 'error');
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
                    devices.push({
                        token: typeof device.token === 'string' ? device.token : '',
                        localip: typeof device.localip === 'string' ? device.localip : '',
                        model: typeof device.model === 'string' ? device.model : '',
                    });
                }
            }
            this.setState({ discoveredDevices: devices, selectedDevice: '' });
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
        this.updateNative('token', device.token);
        this.updateNative('ip', device.localip);
        this.updateNative('model', device.model);
    };

    private renderConnection(): React.JSX.Element {
        const waiting =
            this.state.auth.status === 'waiting_for_scan' || this.state.auth.status === 'waiting_for_confirmation';
        return (
            <Stack spacing={2}>
                <Card variant="outlined">
                    <CardContent>
                        <Stack spacing={2}>
                            <Stack
                                direction="row"
                                spacing={1}
                                alignItems="center"
                            >
                                <CloudIcon color="primary" />
                                <Typography variant="h6">{I18n.t('Xiaomi cloud login')}</Typography>
                            </Stack>
                            <InfoBox type="info">{I18n.t('QR login help')}</InfoBox>
                            <Stack
                                direction={{ xs: 'column', sm: 'row' }}
                                spacing={2}
                                alignItems={{ sm: 'center' }}
                            >
                                <Button
                                    variant="contained"
                                    startIcon={this.state.authBusy ? <CircularProgress size={18} /> : <QrCodeIcon />}
                                    disabled={this.state.authBusy || waiting}
                                    onClick={() => void this.startCloudLogin()}
                                >
                                    {I18n.t('Start Xiaomi QR login')}
                                </Button>
                                <Alert
                                    severity={
                                        this.state.auth.status === 'authenticated'
                                            ? 'success'
                                            : this.state.auth.status === 'error'
                                              ? 'error'
                                              : 'info'
                                    }
                                    sx={{ flex: 1 }}
                                >
                                    {I18n.t('Cloud status')}: {this.state.auth.status}
                                    {this.state.auth.lastError ? ` – ${this.state.auth.lastError}` : ''}
                                </Alert>
                            </Stack>
                            {this.state.auth.loginUrl ? (
                                <Link
                                    href={this.state.auth.loginUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {I18n.t('Open Xiaomi login')}
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

                <Card variant="outlined">
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
                                    type="password"
                                    label={I18n.t('Token')}
                                    value={this.state.native.token}
                                    onChange={event => this.updateNative('token', event.target.value.trim())}
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
                <Card variant="outlined">
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
                        <Stack mt={2}>
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
                        </Stack>
                    </CardContent>
                </Card>
            </Stack>
        );
    }

    private renderMapSettings(): React.JSX.Element {
        const mapEnabled = this.state.native.enableMiMap || this.state.native.valetudo_enable;
        return (
            <Card variant="outlined">
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
                    <Box sx={{ px: 2, pt: 2, borderBottom: 1, borderColor: 'divider' }}>
                        <Stack
                            direction="row"
                            alignItems="center"
                            spacing={2}
                        >
                            <Box
                                component="img"
                                src="./mihome-vacuum.png"
                                alt="Mi Home Vacuum"
                                sx={{ width: 48 }}
                            />
                            <Box sx={{ minWidth: 0 }}>
                                <Typography variant="h5">Mi Home Vacuum</Typography>
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
                        >
                            <Tab
                                value="connection"
                                label={I18n.t('Main')}
                            />
                            <Tab
                                value="settings"
                                label={I18n.t('Settings')}
                            />
                            <Tab
                                value="map"
                                label={I18n.t('Map settings')}
                            />
                        </Tabs>
                    </Box>
                    <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
                        {selectedTab === 'connection' ? this.renderConnection() : null}
                        {selectedTab === 'settings' ? this.renderSettings() : null}
                        {selectedTab === 'map' ? this.renderMapSettings() : null}
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
