function isValidCloudSession(session) {
    return !!(
        session &&
        typeof session.ssecurity === 'string' &&
        session.ssecurity.length >= 16 &&
        /^[A-Za-z0-9+/]+={0,2}$/.test(session.ssecurity) &&
        typeof session.userId === 'string' &&
        session.userId.length > 0 &&
        typeof session.serviceToken === 'string' &&
        session.serviceToken.length >= 8 &&
        typeof session.sessionCookies === 'string' &&
        session.sessionCookies.length > 0 &&
        typeof session.location === 'string' &&
        session.location.startsWith('https://')
    );
}

function decodeStoredCloudSession(rawSession, decrypt) {
    try {
        let saved = rawSession;
        if (typeof rawSession === 'string') {
            try {
                saved = JSON.parse(rawSession);
            } catch {
                saved = JSON.parse(decrypt ? decrypt(rawSession) : rawSession);
            }
        }
        return isValidCloudSession(saved) ? { status: 'valid', session: saved } : { status: 'invalid_session' };
    } catch {
        return { status: 'invalid_json' };
    }
}

module.exports = { isValidCloudSession, decodeStoredCloudSession };
