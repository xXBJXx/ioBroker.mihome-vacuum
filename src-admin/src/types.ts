import type { GenericAppState } from '@iobroker/gui-components/build/types';

export type CloudAuthStatus =
    'not_authenticated' | 'waiting_for_scan' | 'waiting_for_confirmation' | 'authenticated' | 'expired' | 'error';

export interface CloudAuthState {
    status: CloudAuthStatus;
    loginUrl: string;
    lastError: string;
    expiresAt: number;
}

export interface DiscoveredDevice {
    token: string;
    localip: string;
    model: string;
}

export interface VacuumNative extends Record<string, unknown> {
    email: string;
    password: string;
    server: string;
    token: string;
    ip: string;
    model: string;
    manager: string;
    enableMiMap: boolean;
    enableSelfCommands: boolean;
    sendPauseBeforeHome: boolean;
    enableResumeZone: boolean;
    port: number;
    ownPort: number;
    pingInterval: number;
    wifiInterval: number;
    valetudo_enable: boolean;
    valetudo_color_floor: string;
    valetudo_color_wall: string;
    valetudo_color_path: string;
    robot_select: string;
    valetudo_requestIntervall: number;
    valetudo_MapsaveIntervall: number;
    newmap: boolean;
}

export interface VacuumAdminState extends GenericAppState {
    native: VacuumNative;
    auth: CloudAuthState;
    discoveredDevices: DiscoveredDevice[];
    selectedDevice: number | '';
    authBusy: boolean;
    discoveryBusy: boolean;
}

export interface DiscoveryHome {
    result?: {
        device_info?: unknown;
    };
}

export interface DiscoveryResult extends Record<string, unknown> {
    err?: string;
}
