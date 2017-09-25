/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { TPromise } from 'vs/base/common/winjs.base';
import uri from 'vs/base/common/uri';
import * as paths from 'vs/base/common/paths';
import { DEBUG_SCHEME, IReplElementSource } from 'vs/workbench/parts/debug/common/debug';
import { IRange } from 'vs/editor/common/core/range';
import { IWorkbenchEditorService } from 'vs/workbench/services/editor/common/editorService';

const UNKNOWN_SOURCE_LABEL = nls.localize('unknownSource', "Unknown Source");

export interface ISource {
	readonly uri: uri;
	name: string;

	openInEditor(editorService: IWorkbenchEditorService, selection: IRange, preserveFocus?: boolean, sideBySide?: boolean): TPromise<any>;
}

export class SimpleSource implements IReplElementSource {

	public readonly source: ISource;

	constructor(public readonly uri: uri, public readonly lineNumber: number, public readonly column: number) {
		this.source = {
			name: paths.basename(uri.fsPath),
			uri,
			openInEditor: (editorService: IWorkbenchEditorService, selection: IRange, preserveFocus?: boolean, sideBySide?: boolean) => openInEditor(
				this.uri,
				editorService,
				{ startColumn: this.column, startLineNumber: this.lineNumber } as IRange,
				preserveFocus,
				sideBySide
			)
		};
	}
}

export class Source implements ISource {

	public readonly uri: uri;
	public available: boolean;

	constructor(public readonly raw: DebugProtocol.Source, sessionId: string) {
		if (!raw) {
			this.raw = { name: UNKNOWN_SOURCE_LABEL };
		}
		this.available = this.raw.name !== UNKNOWN_SOURCE_LABEL;
		const path = this.raw.path || this.raw.name;
		if (this.raw.sourceReference > 0) {
			this.uri = uri.parse(`${DEBUG_SCHEME}:${encodeURIComponent(path)}?session=${encodeURIComponent(sessionId)}&ref=${this.raw.sourceReference}`);
		} else {
			if (paths.isAbsolute(path)) {
				this.uri = uri.file(path); // path should better be absolute!
			} else {
				this.uri = uri.parse(path);
			}
		}
	}

	public get name() {
		return this.raw.name;
	}

	public get origin() {
		return this.raw.origin;
	}

	public get presentationHint() {
		return this.raw.presentationHint;
	}

	public get reference() {
		return this.raw.sourceReference;
	}

	public get inMemory() {
		return this.uri.scheme === DEBUG_SCHEME;
	}

	public openInEditor(editorService: IWorkbenchEditorService, selection: IRange, preserveFocus?: boolean, sideBySide?: boolean): TPromise<any> {
		if (!this.available) {
			return TPromise.as(null);
		}

		return openInEditor(this.uri, editorService, selection, preserveFocus, sideBySide, !preserveFocus && !this.inMemory, this.origin);
	}
}

function openInEditor(
	uri: uri,
	editorService: IWorkbenchEditorService,
	selection: IRange,
	preserveFocus?: boolean,
	sideBySide?: boolean,
	pinned?: boolean,
	description?: string
): TPromise<any> {
	return editorService.openEditor({
		resource: uri,
		description,
		options: {
			preserveFocus,
			selection,
			revealIfVisible: true,
			revealInCenterIfOutsideViewport: true,
			pinned: typeof pinned === 'boolean' ? pinned : !preserveFocus
		}
	}, sideBySide);
}