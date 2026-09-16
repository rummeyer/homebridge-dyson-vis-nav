// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer

import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils';
import NodePersist from 'node-persist';
import Path from 'path';

import { DysonCloudAuth } from '../dist/dyson-cloud.js';
import { PLUGIN_NAME } from '../dist/settings.js';

// Authorising a MyDyson account is a two-step flow: `startAuth` asks Dyson to
// email a one-time code, and `finishAuth` exchanges that code for a long-lived
// bearer token. The token is written to the plugin's node-persist store, which
// is the same store the running plugin reads from, so nothing is written back
// into config.json.
class DysonUiServer extends HomebridgePluginUiServer {

    constructor() {
        super();

        this.onRequest('/start-auth',  request => this.startAuth(request));
        this.onRequest('/finish-auth', request => this.finishAuth(request));

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

    // Validate the account details supplied by the browser
    getAccount(request) {
        const account = request?.account ?? {};
        const { email, password, china } = account;
        if (typeof email !== 'string' || !email.length) {
            throw new RequestError('Enter the email address of your MyDyson account in the configuration form below, then try again.');
        }
        if (typeof password !== 'string' || !password.length) {
            throw new RequestError('Enter the password of your MyDyson account in the configuration form below, then try again.');
        }
        return { email, password, china: china === true };
    }

    // Ask Dyson to email a one-time code
    async startAuth(request) {
        const account = this.getAccount(request);
        const { lines, log } = this.createLogger();
        try {
            const persist = await this.createPersist();
            const api = new DysonCloudAuth(log, { provisioningMethod: 'Remote Account' }, persist, account);
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
            throw new RequestError(`Could not start authorisation: ${err.message}`, { log: lines });
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
            const api = new DysonCloudAuth(log, { provisioningMethod: 'Remote Account' }, persist, account);
            await api.finishAuth(otpCode.trim());
            return {
                log: lines,
                message: 'MyDyson account authorised. Save the configuration and restart Homebridge.'
            };
        } catch (err) {
            throw new RequestError(`Could not complete authorisation: ${err.message}`, { log: lines });
        }
    }
}

// Start the server
(() => new DysonUiServer())();
