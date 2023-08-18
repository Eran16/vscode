/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorAction, ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { IPosition } from 'vs/editor/common/core/position';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { MultiGhostTextController } from 'vs/editor/contrib/multiGhostText/browser/multiGhostTextController';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';

export class ShowMultiGhostText extends EditorAction {
	constructor() {
		super({
			id: '_showMultiGhostText',
			label: 'Show Multi Ghost Text',
			alias: 'Show Multi Ghost Text',
			precondition: EditorContextKeys.writable,
		});
	}

	public async run(accessor: ServicesAccessor | undefined, editor: ICodeEditor, ghostTexts: { position: IPosition; text: string }[]): Promise<void> {
		console.log('Show Multi Ghost Text', JSON.stringify(ghostTexts, null, 2));
		console.log('Editor cursor', JSON.stringify(editor.getPosition()));
		const controller = MultiGhostTextController.get(editor);
		controller?.showGhostText(ghostTexts);
	}
}

export class SelectNextGhostText extends EditorAction {
	constructor() {
		super({
			id: 'editor.action.multiGhostText.selectNext',
			label: 'Select Next Ghost Text',
			alias: 'Select Next Ghost Text',
			precondition: EditorContextKeys.writable,
			kbOpts: {
				weight: KeybindingWeight.EditorContrib + 1,
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyK,
				kbExpr: EditorContextKeys.writable,
			},
		});
	}

	public async run(accessor: ServicesAccessor | undefined, editor: ICodeEditor): Promise<void> {
		const controller = MultiGhostTextController.get(editor);
		controller?.selectNext();
	}
}

export class SelectPreviousGhostText extends EditorAction {
	constructor() {
		super({
			id: 'editor.action.multiGhostText.selectPrevious',
			label: 'Select Previous Ghost Text',
			alias: 'Select Previous Ghost Text',
			precondition: EditorContextKeys.writable,
			kbOpts: {
				weight: KeybindingWeight.EditorContrib + 1,
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyJ,
				kbExpr: EditorContextKeys.writable,
			},
		});
	}

	public async run(accessor: ServicesAccessor | undefined, editor: ICodeEditor): Promise<void> {
		const controller = MultiGhostTextController.get(editor);
		controller?.selectPrevious();
	}
}
