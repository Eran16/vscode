/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event } from 'vs/base/common/event';
import { TextFileEditorTracker } from 'vs/workbench/contrib/files/browser/editors/textFileEditorTracker';
import { ensureNoDisposablesAreLeakedInTestSuite, toResource } from 'vs/base/test/common/utils';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { workbenchInstantiationService, TestServiceAccessor, TestFilesConfigurationService, registerTestFileEditor, registerTestResourceEditor, createEditorPart, TestEnvironmentService, TestFileService, workbenchTeardown, TestTextResourceConfigurationService } from 'vs/workbench/test/browser/workbenchTestServices';
import { IResolvedTextFileEditorModel, snapshotToString, ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { FileChangesEvent, FileChangeType, FileOperationError, FileOperationResult } from 'vs/platform/files/common/files';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { timeout } from 'vs/base/common/async';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { TextFileEditorModelManager } from 'vs/workbench/services/textfile/common/textFileEditorModelManager';
import { EditorService } from 'vs/workbench/services/editor/browser/editorService';
import { UntitledTextEditorInput } from 'vs/workbench/services/untitled/common/untitledTextEditorInput';
import { isEqual } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { MockContextKeyService } from 'vs/platform/keybinding/test/common/mockKeybindingService';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { FILE_EDITOR_INPUT_ID } from 'vs/workbench/contrib/files/common/files';
import { DEFAULT_EDITOR_ASSOCIATION } from 'vs/workbench/common/editor';
import { TestWorkspace } from 'vs/platform/workspace/test/common/testWorkspace';
import { TestContextService, TestMarkerService, TestStorageService } from 'vs/workbench/test/common/workbenchTestServices';
import { UriIdentityService } from 'vs/platform/uriIdentity/common/uriIdentityService';

suite('Files - TextFileEditorTracker', () => {

	const disposables = new DisposableStore();

	class TestTextFileEditorTracker extends TextFileEditorTracker {

		protected override getDirtyTextFileTrackerDelay(): number {
			return 5; // encapsulated in a method for tests to override
		}
	}

	setup(() => {
		disposables.add(registerTestFileEditor());
		disposables.add(registerTestResourceEditor());
	});

	teardown(() => {
		disposables.clear();
	});

	async function createTracker(autoSaveEnabled = false): Promise<{ accessor: TestServiceAccessor; cleanup: () => Promise<void> }> {
		const instantiationService = workbenchInstantiationService(undefined, disposables);

		const configurationService = new TestConfigurationService();
		if (autoSaveEnabled) {
			configurationService.setUserConfiguration('files', { autoSave: 'afterDelay', autoSaveDelay: 1 });
		} else {
			configurationService.setUserConfiguration('files', { autoSave: 'off', autoSaveDelay: 1 });
		}

		instantiationService.stub(IConfigurationService, configurationService);

		const fileService = disposables.add(new TestFileService());

		instantiationService.stub(IFilesConfigurationService, disposables.add(new TestFilesConfigurationService(
			<IContextKeyService>instantiationService.createInstance(MockContextKeyService),
			configurationService,
			new TestContextService(TestWorkspace),
			TestEnvironmentService,
			disposables.add(new UriIdentityService(fileService)),
			fileService,
			new TestMarkerService(),
			new TestTextResourceConfigurationService(configurationService),
			disposables.add(new TestStorageService())
		)));

		const part = await createEditorPart(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, part);

		const editorService: EditorService = disposables.add(instantiationService.createInstance(EditorService, undefined));
		disposables.add(editorService);
		instantiationService.stub(IEditorService, editorService);

		const accessor = instantiationService.createInstance(TestServiceAccessor);
		disposables.add((<TextFileEditorModelManager>accessor.textFileService.files));

		disposables.add(instantiationService.createInstance(TestTextFileEditorTracker));

		const cleanup = async () => {
			await workbenchTeardown(instantiationService);
			part.dispose();
		};

		return { accessor, cleanup };
	}

	test('file change event updates model', async function () {
		const { accessor, cleanup } = await createTracker();

		const resource = toResource.call(this, '/path/index.txt');

		const model = await accessor.textFileService.files.resolve(resource) as IResolvedTextFileEditorModel;
		disposables.add(model);

		model.textEditorModel.setValue('Super Good');
		assert.strictEqual(snapshotToString(model.createSnapshot()!), 'Super Good');

		await model.save();

		// change event (watcher)
		accessor.fileService.fireFileChanges(new FileChangesEvent([{ resource, type: FileChangeType.UPDATED }], false));

		await timeout(0); // due to event updating model async

		assert.strictEqual(snapshotToString(model.createSnapshot()!), 'Hello Html');

		await cleanup();
	});

	test('dirty text file model opens as editor', async function () {
		const resource = toResource.call(this, '/path/index.txt');

		await testDirtyTextFileModelOpensEditorDependingOnAutoSaveSetting(resource, false, false);
	});

	test('dirty text file model does not open as editor if autosave is ON', async function () {
		const resource = toResource.call(this, '/path/index.txt');

		await testDirtyTextFileModelOpensEditorDependingOnAutoSaveSetting(resource, true, false);
	});

	test('dirty text file model opens as editor when save fails', async function () {
		const resource = toResource.call(this, '/path/index.txt');

		await testDirtyTextFileModelOpensEditorDependingOnAutoSaveSetting(resource, false, true);
	});

	test('dirty text file model opens as editor when save fails if autosave is ON', async function () {
		const resource = toResource.call(this, '/path/index.txt');

		await testDirtyTextFileModelOpensEditorDependingOnAutoSaveSetting(resource, true, true);
	});

	async function testDirtyTextFileModelOpensEditorDependingOnAutoSaveSetting(resource: URI, autoSave: boolean, error: boolean): Promise<void> {
		const { accessor, cleanup } = await createTracker(autoSave);

		assert.ok(!accessor.editorService.isOpened({ resource, typeId: FILE_EDITOR_INPUT_ID, editorId: DEFAULT_EDITOR_ASSOCIATION.id }));

		if (error) {
			accessor.textFileService.setWriteErrorOnce(new FileOperationError('fail to write', FileOperationResult.FILE_OTHER_ERROR));
		}

		const model = await accessor.textFileService.files.resolve(resource) as IResolvedTextFileEditorModel;
		disposables.add(model);

		model.textEditorModel.setValue('Super Good');

		if (autoSave) {
			await model.save();
			await timeout(10);
			if (error) {
				assert.ok(accessor.editorService.isOpened({ resource, typeId: FILE_EDITOR_INPUT_ID, editorId: DEFAULT_EDITOR_ASSOCIATION.id }));
			} else {
				assert.ok(!accessor.editorService.isOpened({ resource, typeId: FILE_EDITOR_INPUT_ID, editorId: DEFAULT_EDITOR_ASSOCIATION.id }));
			}
		} else {
			await awaitEditorOpening(accessor.editorService);
			assert.ok(accessor.editorService.isOpened({ resource, typeId: FILE_EDITOR_INPUT_ID, editorId: DEFAULT_EDITOR_ASSOCIATION.id }));
		}

		await cleanup();
	}

	test('dirty untitled text file model opens as editor', function () {
		return testUntitledEditor(false);
	});

	test('dirty untitled text file model opens as editor - autosave ON', function () {
		return testUntitledEditor(true);
	});

	async function testUntitledEditor(autoSaveEnabled: boolean): Promise<void> {
		const { accessor, cleanup } = await createTracker(autoSaveEnabled);

		const untitledTextEditor = await accessor.textEditorService.resolveTextEditor({ resource: undefined, forceUntitled: true }) as UntitledTextEditorInput;
		const model = disposables.add(await untitledTextEditor.resolve());

		assert.ok(!accessor.editorService.isOpened(untitledTextEditor));

		model.textEditorModel?.setValue('Super Good');

		await awaitEditorOpening(accessor.editorService);
		assert.ok(accessor.editorService.isOpened(untitledTextEditor));

		await cleanup();
	}

	function awaitEditorOpening(editorService: IEditorService): Promise<void> {
		return Event.toPromise(Event.once(editorService.onDidActiveEditorChange));
	}

	test('non-dirty files reload on window focus', async function () {
		const { accessor, cleanup } = await createTracker();

		const resource = toResource.call(this, '/path/index.txt');

		await accessor.editorService.openEditor(await accessor.textEditorService.resolveTextEditor({ resource, options: { override: DEFAULT_EDITOR_ASSOCIATION.id } }));

		accessor.hostService.setFocus(false);
		accessor.hostService.setFocus(true);

		await awaitModelResolveEvent(accessor.textFileService, resource);

		await cleanup();
	});

	function awaitModelResolveEvent(textFileService: ITextFileService, resource: URI): Promise<void> {
		return new Promise(resolve => {
			const listener = textFileService.files.onDidResolve(e => {
				if (isEqual(e.model.resource, resource)) {
					listener.dispose();
					resolve();
				}
			});
		});
	}

	ensureNoDisposablesAreLeakedInTestSuite();
});
