// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer

import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils';
import NodePersist from 'node-persist';
import Path from 'path';

import { DysonCloudAuth } from '../dist/dyson-cloud.js';
import { PLUGIN_NAME } from '../dist/settings.js';
import { makeAuthConfig } from './auth-config.mjs';

// Authorising a MyDyson account is a two-step flow: `startAuth` asks Dyson to
// email a one-time code, and `finishAuth` exchanges that code for a long-lived
// bearer token. The token is written to the plugin's node-persist store, which
// is the same store the running plugin reads from, so nothing is written back
// into config.json.
class DysonUiServer extends HomebridgePluginUiServer {

    constructor() {
        super();

        this.onRequest('/auth-status', request => this.authStatus(request));
        this.onRequest('/start-auth',   request => this.startAuth(request));
        this.onRequest('/finish-auth',  request => this.finishAuth(request));

        this.ready();
    }

    // Collect log lines so they can be shown in the browser rather than only
    // in the Homebridge log, which the config UI does not display.
    createLogger() {
        const lines = [];
        const record = level => (message, ...parameters) => {
            const extra = parameters.length ? ` ${parameters.map(String).join(' ')}` : '';
            lines.push(`${level}: ${message}${extra}`);
        };
        return {
            lines,
            log: {
                info:    record('info'),
                success: record('success'),
                warn:    record('warn'),
                error:   record('error'),
                debug:   () => { /* suppressed: may contain tokens */ },
                log:     (level, message, ...parameters) => { record(level)(message, ...parameters); }
            }
        };
    }

    // Open the plugin's persistent storage, shared with the running plugin
    async createPersist() {
        const persist = NodePersist.create({
            dir: Path.join(this.homebridgeStoragePath, PLUGIN_NAME, 'persist')
        });
        await persist.init();
        return persist;
    }

    // Report whether this account is authorised.
    //
    // A stored token is not the same as a working one: tokens expire and can be
    // revoked, and the plugin then fails at startup. So this actually exercises
    // the token against the API rather than merely noting its presence, which
    // lets the UI re-offer the code request exactly when it is needed.
    async authStatus(request) {
        const email = request?.account?.email;
        if (typeof email !== 'string' || !email.length) {
            return { authorised: false, reason: 'no-email' };
        }

        const persist = await this.createPersist();
        const stored = await persist.getItem(`${email}:token`);
        if (!stored?.token) return { authorised: false, reason: 'no-token' };

        const { log } = this.createLogger();
        try {
            const account = { email, password: '', country: request.account.country ?? 'GB' };
            const api = new DysonCloudAuth(log, makeAuthConfig(), persist, account);
            const devices = await (await api.api).getManifest();
            return {
                authorised: true,
                created:    stored.created ?? null,
                devices:    Array.isArray(devices) ? devices.length : null
            };
        } catch (err) {
            return {
                authorised: false,
                reason:     'rejected',
                created:    stored.created ?? null,
                message:    `The stored authorisation is no longer accepted by Dyson (${describeError(err)}).`
                          + ' Request a new code.'
            };
        }
    }

    // Validate the account details supplied by the browser
    getAccount(request) {
        const account = request?.account ?? {};
        const { email, password, country } = account;
        if (typeof email !== 'string' || !email.length) {
            throw new RequestError('Enter the email address of your MyDyson account in the configuration form below, then try again.');
        }
        if (typeof password !== 'string' || !password.length) {
            throw new RequestError('Enter the password of your MyDyson account in the configuration form below, then try again.');
        }
        return { email, password, country: (country ?? 'GB').toUpperCase() };
    }

    // Ask Dyson to email a one-time code
    async startAuth(request) {
        const account = this.getAccount(request);
        const { lines, log } = this.createLogger();
        try {
            const persist = await this.createPersist();
            const api = new DysonCloudAuth(log, makeAuthConfig(), persist, account);
            const started = await api.startAuth();
            return {
                started,
                log: lines,
                message: started
                    ? 'Check your email (and spam folder) for a MyDyson message containing a code.'
                    : 'Too many requests, so a previous authorisation attempt is being continued.'
                      + ' Use the code from the most recent MyDyson email.'
            };
        } catch (err) {
            throw new RequestError(`Could not start authorisation: ${describeError(err)}`, { log: lines });
        }
    }

    // Exchange the emailed code for a bearer token
    async finishAuth(request) {
        const account = this.getAccount(request);
        const otpCode = request?.otpCode;
        if (typeof otpCode !== 'string' || !otpCode.trim().length) {
            throw new RequestError('Enter the code from the MyDyson email');
        }
        const { lines, log } = this.createLogger();
        try {
            const persist = await this.createPersist();
            const api = new DysonCloudAuth(log, makeAuthConfig(), persist, account);
            await api.finishAuth(otpCode.trim());
            return {
                log: lines,
                message: 'MyDyson account authorised. Save the configuration and restart Homebridge.'
            };
        } catch (err) {
            throw new RequestError(`Could not complete authorisation: ${describeError(err)}`, { log: lines });
        }
    }
}

// Describe an error usefully.
//
// A bare `err.message` hides the two things that matter most when this flow
// fails: a TypeError means the plugin broke before reaching Dyson, and the
// cause chain carries the HTTP status when Dyson refused.
function describeError(err) {
    if (!(err instanceof Error)) return String(err);
    const parts = [`${err.name}: ${err.message}`];
    let cause = err.cause;
    while (cause instanceof Error && parts.length < 4) {
        parts.push(`caused by ${cause.name}: ${cause.message}`);
        cause = cause.cause;
    }
    if (err instanceof TypeError) {
        parts.push('(this is a bug in the plugin, not a problem with your account'
                 + ' — the request never reached Dyson)');
    }
    return parts.join(' — ');
}

// Start the server
(() => new DysonUiServer())();
