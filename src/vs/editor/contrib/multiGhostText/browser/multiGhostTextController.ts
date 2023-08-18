/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { constObservable } from 'vs/base/common/observable';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IPosition } from 'vs/editor/common/core/position';
import { GhostText, GhostTextPart } from 'vs/editor/contrib/inlineCompletions/browser/ghostText';
import { GhostTextWidget } from 'vs/editor/contrib/multiGhostText/browser/ghostTextWidget';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';

export type GhostTextData = {
	readonly position: IPosition;
	readonly text: string;
};

export class MultiGhostTextController extends Disposable {
	static ID = 'editor.contrib.inlineCompletionsController';

	public static get(editor: ICodeEditor): MultiGhostTextController | null {
		return editor.getContribution<MultiGhostTextController>(MultiGhostTextController.ID);
	}

	private _widgets: [GhostTextWidget, GhostTextData][] = [];
	private _selectedWidget: GhostTextWidget | undefined;

	constructor(
		public readonly editor: ICodeEditor,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		// @IContextKeyService private readonly contextKeyService: IContextKeyService,
		// @IConfigurationService private readonly configurationService: IConfigurationService,
		// @ICommandService private readonly commandService: ICommandService,
		// @ILanguageFeatureDebounceService private readonly debounceService: ILanguageFeatureDebounceService,
		// @ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		// @IAudioCueService private readonly audioCueService: IAudioCueService,
	) {
		super();

		this._register(editor.onDidChangeModelContent(() => this.clear()));
	}

	private dataEquals(a: GhostTextData, b: GhostTextData): boolean {
		return a.position.lineNumber === b.position.lineNumber && a.position.column === b.position.column && a.text === b.text;
	}

	public showGhostText(ghostTexts: GhostTextData[]): void {
		//get repeated widgets
		const repeatedWidgets = this._widgets.filter(([widget, data]) => {
			return ghostTexts.some(ghostText => this.dataEquals(ghostText, data));
		});

		//non-repeated widgets
		const nonRepeatedWidgets = this._widgets.filter(([widget, data]) => {
			return !ghostTexts.some(ghostText => this.dataEquals(ghostText, data));
		});

		nonRepeatedWidgets.forEach(([widget, data]) => {
			widget.dispose();
		});
		this._widgets = repeatedWidgets;

		//non-repeated ghost texts
		const newGhostText = ghostTexts.filter(ghostText => {
			return !this._widgets.some(([widget, data]) => {
				return this.dataEquals(ghostText, data);
			});
		});

		for (const gt of newGhostText) {
			const ghostText = new GhostText(gt.position.lineNumber, [new GhostTextPart(gt.position.column, gt.text.split('\n'), false)]);

			const instance = this.instantiationService.createInstance(GhostTextWidget, this.editor, {
				ghostText: constObservable(ghostText),
				minReservedLineCount: constObservable(0),
				targetTextModel: constObservable(this.editor.getModel() ?? undefined),
			});
			this._widgets.push([instance, gt]);

		}
	}

	public selectNext() {
		if (this._widgets.length === 0) {
			return;
		}

		if (this._selectedWidget === undefined) {
			this._selectedWidget = this._widgets[0][0];
			this._selectedWidget.select();
			return;
		}

		const index = this._widgets.findIndex(([widget, data]) => {
			return widget === this._selectedWidget;
		});

		if (index === -1) {
			return;
		}

		const nextIndex = (index + 1) % this._widgets.length;
		const nextWidget = this._widgets[nextIndex][0];
		this._selectedWidget?.deselect();
		nextWidget.select();
		this._selectedWidget = nextWidget;
	}

	public selectPrevious() {
		if (this._widgets.length === 0) {
			return;
		}

		if (this._selectedWidget === undefined) {
			this._selectedWidget = this._widgets[0][0];
			this._selectedWidget.select();
			return;
		}

		const index = this._widgets.findIndex(([widget, data]) => {
			return widget === this._selectedWidget;
		});

		if (index === -1) {
			return;
		}

		const previousIndex = (index - 1 + this._widgets.length) % this._widgets.length;
		const previousWidget = this._widgets[previousIndex][0];
		this._selectedWidget?.deselect();
		previousWidget.select();
		this._selectedWidget = previousWidget;
	}

	public clear(): void {
		this._widgets.forEach(([widget, data]) => {
			widget.dispose();
		});
		this._widgets = [];
		this._selectedWidget = undefined;
	}

	override dispose(): void {
		this.clear();
		super.dispose();
	}

}
