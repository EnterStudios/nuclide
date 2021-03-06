/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 * @format
 */

import type {Level, Message} from '../../nuclide-console/lib/types';
import type {Directory} from '../../nuclide-remote-connection';
import type {TaskMetadata} from '../../nuclide-task-runner/lib/types';
import type {Task} from '../../commons-node/tasks';
import type {
  AppState,
  DeploymentTarget,
  SerializedState,
  Store,
  TaskType,
} from './types';
import {PlatformService} from './PlatformService';

import invariant from 'assert';
import {applyMiddleware, createStore} from 'redux';
import {Observable, Subject} from 'rxjs';
import {taskFromObservable} from '../../commons-node/tasks';
import {BuckBuildSystem} from './BuckBuildSystem';
import UniversalDisposable from 'nuclide-commons/UniversalDisposable';
import {
  combineEpics,
  createEpicMiddleware,
} from '../../commons-node/redux-observable';

import {bindObservableAsProps} from '../../nuclide-ui/bindObservableAsProps';
import {getLogger} from '../../nuclide-logging';
import {Icon} from '../../nuclide-ui/Icon';
import * as Actions from './redux/Actions';
import * as Epics from './redux/Epics';
import Reducers from './redux/Reducers';
import BuckToolbar from './BuckToolbar';
import observeBuildCommands from './observeBuildCommands';
import React from 'react';
import {arrayEqual} from 'nuclide-commons/collection';
import shallowequal from 'shallowequal';

const TASKS = [
  {
    type: 'build',
    label: 'Build',
    description: 'Build the specified Buck target',
    icon: 'tools',
  },
  {
    type: 'run',
    label: 'Run',
    description: 'Run the specfied Buck target',
    icon: 'triangle-right',
  },
  {
    type: 'test',
    label: 'Test',
    description: 'Test the specfied Buck target',
    icon: 'check',
  },
  {
    type: 'debug',
    label: 'Debug',
    description: 'Debug the specfied Buck target',
    icon: 'nuclicon-debugger',
  },
];

function shouldEnableTask(taskType: TaskType, ruleType: string): boolean {
  switch (taskType) {
    case 'run':
      return ruleType.endsWith('binary');
    case 'debug':
      return ruleType.endsWith('binary') || ruleType.endsWith('test');
    default:
      return true;
  }
}

export class BuckTaskRunner {
  _store: Store;
  _disposables: UniversalDisposable;
  _outputMessages: Subject<Message>;
  _extraUi: ?ReactClass<any>;
  id: string;
  name: string;
  _serializedState: ?SerializedState;
  _buildSystem: BuckBuildSystem;
  _platformService: PlatformService;

  constructor(initialState: ?SerializedState) {
    this.id = 'buck';
    this.name = 'Buck';
    this._outputMessages = new Subject();
    this._buildSystem = new BuckBuildSystem(
      this._outputMessages,
      () => this._getStore().getState().buckRoot,
      () => this._getStore().getState().taskSettings,
    );
    this._serializedState = initialState;
    this._disposables = new UniversalDisposable();
    this._platformService = new PlatformService();
  }

  getExtraUi(): ReactClass<any> {
    if (this._extraUi == null) {
      const store = this._getStore();
      const boundActions = {
        setBuildTarget: buildTarget =>
          store.dispatch(Actions.setBuildTarget(buildTarget)),
        setDeploymentTarget: deploymentTarget =>
          store.dispatch(Actions.setDeploymentTarget(deploymentTarget)),
        setTaskSettings: settings =>
          store.dispatch(Actions.setTaskSettings(settings)),
      };
      this._extraUi = bindObservableAsProps(
        // $FlowFixMe: type symbol-observable
        Observable.from(store).map(appState => ({appState, ...boundActions})),
        BuckToolbar,
      );
    }
    return this._extraUi;
  }

  getIcon(): ReactClass<any> {
    return () => (
      <Icon icon="nuclicon-buck" className="nuclide-buck-task-runner-icon" />
    );
  }

  getBuildSystem(): BuckBuildSystem {
    return this._buildSystem;
  }

  getPlatformService(): PlatformService {
    return this._platformService;
  }

  setProjectRoot(
    projectRoot: ?Directory,
    callback: (enabled: boolean, taskList: Array<TaskMetadata>) => mixed,
  ): IDisposable {
    const path = projectRoot == null ? null : projectRoot.getPath();

    // $FlowFixMe: type symbol-observable
    const storeReady: Observable<AppState> = Observable.from(this._getStore())
      .distinctUntilChanged()
      .filter(
        (state: AppState) =>
          !state.isLoadingBuckProject && state.projectRoot === path,
      )
      .share();

    const enabledObservable = storeReady
      .map(state => state.buckRoot != null)
      .distinctUntilChanged();

    const tasksObservable = storeReady
      .map(state => {
        const {buildRuleType, selectedDeploymentTarget} = state;
        const tasksFromPlatform = selectedDeploymentTarget
          ? selectedDeploymentTarget.platform.tasksForDevice(
              selectedDeploymentTarget.device,
            )
          : null;
        return TASKS.map(task => {
          let disabled = state.isLoadingPlatforms || buildRuleType == null;
          if (!disabled) {
            if (tasksFromPlatform) {
              disabled = !tasksFromPlatform.has(task.type);
            } else {
              invariant(buildRuleType);
              // No platform provider selected, fall back to default logic
              disabled = !shouldEnableTask(task.type, buildRuleType.type);
            }
          }
          return {...task, disabled};
        });
      })
      .distinctUntilChanged((a, b) => arrayEqual(a, b, shallowequal));

    const subscription = Observable.combineLatest(
      enabledObservable,
      tasksObservable,
    ).subscribe(([enabled, tasks]) => callback(enabled, tasks));

    this._getStore().dispatch(Actions.setProjectRoot(path));

    return new UniversalDisposable(subscription);
  }

  _getStore(): Store {
    if (this._store == null) {
      invariant(this._serializedState != null);
      const initialState: AppState = {
        platformGroups: [],
        platformService: this._platformService,
        projectRoot: null,
        buckRoot: null,
        isLoadingBuckProject: false,
        isLoadingRule: false,
        isLoadingPlatforms: false,
        buildTarget: this._serializedState.buildTarget || '',
        buildRuleType: null,
        selectedDeploymentTarget: null,
        taskSettings: this._serializedState.taskSettings || {},
        platformProviderUi: null,
        lastSessionPlatformName: this._serializedState.selectedPlatformName,
        lastSessionDeviceName: this._serializedState.selectedDeviceName,
      };
      const epics = Object.keys(Epics)
        .map(k => Epics[k])
        .filter(epic => typeof epic === 'function');
      const rootEpic = (actions, store) =>
        combineEpics(...epics)(actions, store)
          // Log errors and continue.
          .catch((err, stream) => {
            getLogger().error(err);
            return stream;
          });
      this._store = createStore(
        Reducers,
        initialState,
        applyMiddleware(createEpicMiddleware(rootEpic)),
      );
      this._disposables.add(observeBuildCommands(this._store));
    }
    return this._store;
  }

  runTask(taskType: string): Task {
    invariant(
      taskType === 'build' ||
        taskType === 'test' ||
        taskType === 'run' ||
        taskType === 'debug',
      'Invalid task type',
    );

    atom.commands.dispatch(
      atom.views.getView(atom.workspace),
      'nuclide-console:toggle',
      {visible: true},
    );

    const state = this._getStore().getState();
    const {
      buckRoot,
      buildRuleType,
      buildTarget,
      selectedDeploymentTarget,
    } = state;
    invariant(buckRoot);
    invariant(buildRuleType);

    const deploymentString = formatDeploymentTarget(selectedDeploymentTarget);
    this._logOutput(
      `Resolving ${taskType} command for "${buildTarget}"${deploymentString}`,
      'log',
    );

    const capitalizedTaskType =
      taskType.slice(0, 1).toUpperCase() + taskType.slice(1);
    const task = taskFromObservable(
      Observable.concat(
        Observable.defer(() => {
          if (selectedDeploymentTarget) {
            const {platform, device} = selectedDeploymentTarget;
            return platform.runTask(
              this._buildSystem,
              taskType,
              buildRuleType.buildTarget,
              device,
            );
          } else {
            const subcommand = taskType === 'debug' ? 'build' : taskType;
            return this._buildSystem.runSubcommand(
              subcommand,
              buildRuleType.buildTarget,
              {buildArguments: []},
              taskType === 'debug',
              null,
            );
          }
        }),
        Observable.defer(() => {
          this._logOutput(`${capitalizedTaskType} succeeded.`, 'success');
          return Observable.empty();
        }),
      ),
    );

    return {
      ...task,
      cancel: () => {
        this._logOutput(`${capitalizedTaskType} stopped.`, 'warning');
        task.cancel();
      },
      getTrackingData: () => ({
        buckRoot,
        buildTarget,
        taskSettings: state.taskSettings,
      }),
    };
  }

  _logOutput(text: string, level: Level) {
    this._outputMessages.next({text, level});
  }

  dispose(): void {
    this._disposables.dispose();
  }

  serialize(): ?SerializedState {
    // If we haven't had to load and create the Flux stuff yet, don't do it now.
    if (this._store == null) {
      return;
    }
    const state = this._store.getState();
    const {buildTarget, taskSettings, selectedDeploymentTarget} = state;
    let selectedPlatformName;
    let selectedDeviceName;
    if (selectedDeploymentTarget) {
      selectedPlatformName = selectedDeploymentTarget.platform.name;
      selectedDeviceName = selectedDeploymentTarget.device
        ? selectedDeploymentTarget.device.name
        : null;
    } else {
      // In case the user quits before the session is restored, forward the session restoration.
      selectedPlatformName = state.lastSessionPlatformName;
      selectedDeviceName = state.lastSessionDeviceName;
    }

    return {
      buildTarget,
      taskSettings,
      selectedPlatformName,
      selectedDeviceName,
    };
  }
}

function formatDeploymentTarget(deploymentTarget: ?DeploymentTarget): string {
  if (!deploymentTarget) {
    return '';
  }
  const {device, platform} = deploymentTarget;
  const deviceString = device ? `: ${device.name}` : '';
  return ` on "${platform.name}${deviceString}"`;
}
