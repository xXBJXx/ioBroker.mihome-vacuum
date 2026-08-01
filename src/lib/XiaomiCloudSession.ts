import type { XiaomiCloudSession } from '../types/xiaomiCloud';

export function isValidCloudSession(session: unknown): session is XiaomiCloudSession {
    if (!session || (typeof session !== 'object' && typeof session !== 'function')) {
        return false;
    }
    const candidate = session as Partial<XiaomiCloudSession>;
    return !!(
        typeof candidate.ssecurity === 'string' &&
        candidate.ssecurity.length >= 16 &&
        /^[A-Za-z0-9+/]+={0,2}$/.test(candidate.ssecurity) &&
        typeof candidate.userId === 'string' &&
        candidate.userId.length > 0 &&
        typeof candidate.serviceToken === 'string' &&
        candidate.serviceToken.length >= 8 &&
        typeof candidate.sessionCookies === 'string' &&
        candidate.sessionCookies.length > 0 &&
        typeof candidate.location === 'string' &&
        candidate.location.startsWith('https://')
    );
}
