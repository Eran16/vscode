/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as util from 'util';
import * as nls from 'vscode-nls';
import { randomUUID } from 'crypto';

const localize = nls.loadMessageBundle();

const PATTERN = 'listening on.* (https?://\\S+|[0-9]+)'; // matches "listening on port 3000" or "Now listening on: https://localhost:5001"
const URI_PORT_FORMAT = 'http://localhost:%s';
const URI_FORMAT = '%s';
const WEB_ROOT = '${workspaceFolder}';

interface ServerReadyAction {
	pattern: string;
	action?: 'openExternally' | 'debugWithChrome' | 'debugWithEdge' | 'startDebugging';
	uriFormat?: string;
	webRoot?: string;
	name?: string;
	killOnServerStop?: boolean;
}

class Trigger {
	private _fired = false;

	public get hasFired() {
		return this._fired;
	}

	public fire() {
		this._fired = true;
	}
}

class ServerReadyDetector extends vscode.Disposable {

	private static detectors = new Map<vscode.DebugSession, ServerReadyDetector>();
	private static terminalDataListener: vscode.Disposable | undefined;

	private trigger: Trigger;
	private shellPid?: number;
	private regexp: RegExp;
	private disposables: vscode.Disposable[] = [];
	private lateDisposables = new Set<vscode.Disposable>([]);

	static start(session: vscode.DebugSession): ServerReadyDetector | undefined {
		if (session.configuration.serverReadyAction) {
			let detector = ServerReadyDetector.detectors.get(session);
			if (!detector) {
				detector = new ServerReadyDetector(session);
				ServerReadyDetector.detectors.set(session, detector);
			}
			return detector;
		}
		return undefined;
	}

	static stop(session: vscode.DebugSession): void {
		const detector = ServerReadyDetector.detectors.get(session);
		if (detector) {
			ServerReadyDetector.detectors.delete(session);
			detector.dispose();
		}
	}

	static rememberShellPid(session: vscode.DebugSession, pid: number) {
		const detector = ServerReadyDetector.detectors.get(session);
		if (detector) {
			detector.shellPid = pid;
		}
	}

	static async startListeningTerminalData() {
		if (!this.terminalDataListener) {
			this.terminalDataListener = vscode.window.onDidWriteTerminalData(async e => {

				// first find the detector with a matching pid
				const pid = await e.terminal.processId;
				for (const [, detector] of this.detectors) {
					if (detector.shellPid === pid) {
						detector.detectPattern(e.data);
						return;
					}
				}

				// if none found, try all detectors until one matches
				for (const [, detector] of this.detectors) {
					if (detector.detectPattern(e.data)) {
						return;
					}
				}
			});
		}
	}

	private constructor(private session: vscode.DebugSession) {
		super(() => this.internalDispose());

		// Re-used the triggered of the parent session, if one exists
		if (session.parentSession) {
			this.trigger = ServerReadyDetector.start(session.parentSession)?.trigger ?? new Trigger();
		} else {
			this.trigger = new Trigger();
		}

		this.regexp = new RegExp(session.configuration.serverReadyAction.pattern || PATTERN, 'i');
	}

	private internalDispose() {
		this.disposables.forEach(d => d.dispose());
		this.disposables = [];
	}

	override dispose() {
		this.lateDisposables.forEach(d => d.dispose());
		return super.dispose();
	}

	detectPattern(s: string): boolean {
		if (!this.trigger.hasFired) {
			const matches = this.regexp.exec(s);
			if (matches && matches.length >= 1) {
				this.openExternalWithString(this.session, matches.length > 1 ? matches[1] : '');
				this.trigger.fire();
				this.internalDispose();
				return true;
			}
		}
		return false;
	}

	private openExternalWithString(session: vscode.DebugSession, captureString: string) {

		const args: ServerReadyAction = session.configuration.serverReadyAction;

		let uri;
		if (captureString === '') {
			// nothing captured by reg exp -> use the uriFormat as the target uri without substitution
			// verify that format does not contain '%s'
			const format = args.uriFormat || '';
			if (format.indexOf('%s') >= 0) {
				const errMsg = localize('server.ready.nocapture.error', "Format uri ('{0}') uses a substitution placeholder but pattern did not capture anything.", format);
				vscode.window.showErrorMessage(errMsg, { modal: true }).then(_ => undefined);
				return;
			}
			uri = format;
		} else {
			// if no uriFormat is specified guess the appropriate format based on the captureString
			const format = args.uriFormat || (/^[0-9]+$/.test(captureString) ? URI_PORT_FORMAT : URI_FORMAT);
			// verify that format only contains a single '%s'
			const s = format.split('%s');
			if (s.length !== 2) {
				const errMsg = localize('server.ready.placeholder.error', "Format uri ('{0}') must contain exactly one substitution placeholder.", format);
				vscode.window.showErrorMessage(errMsg, { modal: true }).then(_ => undefined);
				return;
			}
			uri = util.format(format, captureString);
		}

		this.openExternalWithUri(session, uri);
	}

	private async openExternalWithUri(session: vscode.DebugSession, uri: string) {

		const args: ServerReadyAction = session.configuration.serverReadyAction;
		switch (args.action || 'openExternally') {

			case 'openExternally':
				await vscode.env.openExternal(vscode.Uri.parse(uri));
				break;

			case 'debugWithChrome':
				await this.debugWithBrowser('pwa-chrome', session, uri);
				break;

			case 'debugWithEdge':
				await this.debugWithBrowser('pwa-msedge', session, uri);
				break;

			case 'startDebugging':
				await this.startNamedDebugSession(session, args.name || 'unspecified');
				break;

			default:
				// not supported
				break;
		}
	}

	private async debugWithBrowser(type: string, session: vscode.DebugSession, uri: string) {
		const args = session.configuration.serverReadyAction as ServerReadyAction;
		if (!args.killOnServerStop) {
			await this.startBrowserDebugSession(type, session, uri);
			return;
		}

		const trackerId = randomUUID();
		const cts = new vscode.CancellationTokenSource();
		const newSessionPromise = this.catchStartedDebugSession(session => session.configuration.trackerId === trackerId, cts.token);

		if (!await this.startBrowserDebugSession(type, session, uri, trackerId)) {
			cts.cancel();
			cts.dispose();
			return;
		}

		const createdSession = await newSessionPromise;
		cts.dispose();

		if (!createdSession) {
			return;
		}

		const stopListener = vscode.debug.onDidTerminateDebugSession(async (terminated) => {
			if (terminated === session) {
				stopListener.dispose();
				this.lateDisposables.delete(stopListener);
				await vscode.debug.stopDebugging(createdSession);
			}
		});
		this.lateDisposables.add(stopListener);
	}

	private startBrowserDebugSession(type: string, session: vscode.DebugSession, uri: string, trackerId?: string) {
		return vscode.debug.startDebugging(session.workspaceFolder, {
			type,
			name: 'Browser Debug',
			request: 'launch',
			url: uri,
			webRoot: session.configuration.serverReadyAction.webRoot || WEB_ROOT,
			trackerId,
		});
	}

	private async startNamedDebugSession(session: vscode.DebugSession, name: string) {
		const args = session.configuration.serverReadyAction as ServerReadyAction;
		if (!args.killOnServerStop) {
			await vscode.debug.startDebugging(session.workspaceFolder, name);
			return;
		}

		const cts = new vscode.CancellationTokenSource();
		const newSessionPromise = this.catchStartedDebugSession(x => x.name === name, cts.token);

		if (!await vscode.debug.startDebugging(session.workspaceFolder, name)) {
			cts.cancel();
			cts.dispose();
			return;
		}

		const createdSession = await newSessionPromise;
		cts.dispose();

		if (!createdSession) {
			return;
		}

		const stopListener = vscode.debug.onDidTerminateDebugSession(async (terminated) => {
			if (terminated === session) {
				stopListener.dispose();
				this.lateDisposables.delete(stopListener);
				await vscode.debug.stopDebugging(createdSession);
			}
		});
		this.lateDisposables.add(stopListener);
	}

	private catchStartedDebugSession(predicate: (session: vscode.DebugSession) => boolean, cancellationToken: vscode.CancellationToken): Promise<vscode.DebugSession | undefined> {
		return new Promise<vscode.DebugSession | undefined>(_resolve => {
			const done = (value?: vscode.DebugSession) => {
				listener.dispose();
				cancellationListener.dispose();
				this.lateDisposables.delete(listener);
				this.lateDisposables.delete(cancellationListener);
				_resolve(value);
			};

			const cancellationListener = cancellationToken.onCancellationRequested(done);
			const listener = vscode.debug.onDidStartDebugSession(session => {
				if (predicate(session)) {
					done(session);
				}
			});

			// In case the debug session of interest was never caught anyhow.
			this.lateDisposables.add(listener);
			this.lateDisposables.add(cancellationListener);
		});
	}
}

export function activate(context: vscode.ExtensionContext) {

	context.subscriptions.push(vscode.debug.onDidChangeActiveDebugSession(session => {
		if (session && session.configuration.serverReadyAction) {
			const detector = ServerReadyDetector.start(session);
			if (detector) {
				ServerReadyDetector.startListeningTerminalData();
			}
		}
	}));

	context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(session => {
		ServerReadyDetector.stop(session);
	}));

	const trackers = new Set<string>();

	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('*', {
		resolveDebugConfigurationWithSubstitutedVariables(_folder: vscode.WorkspaceFolder | undefined, debugConfiguration: vscode.DebugConfiguration) {
			if (debugConfiguration.type && debugConfiguration.serverReadyAction) {
				if (!trackers.has(debugConfiguration.type)) {
					trackers.add(debugConfiguration.type);
					startTrackerForType(context, debugConfiguration.type);
				}
			}
			return debugConfiguration;
		}
	}));
}

function startTrackerForType(context: vscode.ExtensionContext, type: string) {

	// scan debug console output for a PORT message
	context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory(type, {
		createDebugAdapterTracker(session: vscode.DebugSession) {
			const detector = ServerReadyDetector.start(session);
			if (detector) {
				let runInTerminalRequestSeq: number | undefined;
				return {
					onDidSendMessage: m => {
						if (m.type === 'event' && m.event === 'output' && m.body) {
							switch (m.body.category) {
								case 'console':
								case 'stderr':
								case 'stdout':
									if (m.body.output) {
										detector.detectPattern(m.body.output);
									}
									break;
								default:
									break;
							}
						}
						if (m.type === 'request' && m.command === 'runInTerminal' && m.arguments) {
							if (m.arguments.kind === 'integrated') {
								runInTerminalRequestSeq = m.seq; // remember this to find matching response
							}
						}
					},
					onWillReceiveMessage: m => {
						if (runInTerminalRequestSeq && m.type === 'response' && m.command === 'runInTerminal' && m.body && runInTerminalRequestSeq === m.request_seq) {
							runInTerminalRequestSeq = undefined;
							ServerReadyDetector.rememberShellPid(session, m.body.shellProcessId);
						}
					}
				};
			}
			return undefined;
		}
	}));
}
