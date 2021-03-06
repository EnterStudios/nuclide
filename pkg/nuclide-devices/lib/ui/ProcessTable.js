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

import type {Process, KillProcessCallback} from '../types';
import React from 'react';

import {Table} from '../../../nuclide-ui/Table';
import {AtomInput} from '../../../nuclide-ui/AtomInput';
import {Button} from '../../../nuclide-ui/Button';
import addTooltip from '../../../nuclide-ui/add-tooltip';

type Props = {
  killProcess: ?KillProcessCallback,
  processes: Process[],
};

type State = {
  filterText: string,
};

export class ProcessTable extends React.Component {
  props: Props;
  state: State;

  constructor(props: Props) {
    super(props);
    (this: any)._handleFilterTextChange = this._handleFilterTextChange.bind(
      this,
    );
    (this: any)._getKillButton = this._getKillButton.bind(this);
    this.state = {
      filterText: '',
    };
  }

  render(): React.Element<any> {
    const filterRegex = new RegExp(this.state.filterText, 'i');
    const rows = this.props.processes
      .filter(
        item =>
          filterRegex.test(item.user) ||
          filterRegex.test(`${item.pid}`) ||
          filterRegex.test(item.name),
      )
      .map(item => ({
        data: {
          kill: this._getKillButton(item.name),
          pid: item.pid,
          user: item.user,
          name: item.name,
          cpuUsage: item.cpuUsage,
          memUsage: item.memUsage,
        },
      }));
    const columns = [
      {
        key: 'kill',
        title: '',
        width: 0.05,
      },
      {
        key: 'pid',
        title: 'PID',
        width: 0.15,
      },
      {
        key: 'user',
        title: 'User',
        width: 0.15,
      },
      {
        key: 'name',
        title: 'Name',
        width: 0.5,
      },
      {
        key: 'cpuUsage',
        title: 'CPU',
        width: 0.1,
      },
      {
        key: 'memUsage',
        title: 'Mem',
        width: 0.15,
      },
    ];
    const emptyComponent = () => <div className="padded">No information</div>;

    return (
      <div>
        <AtomInput
          placeholderText="Filter process..."
          initialValue={this.state.filterText}
          onDidChange={this._handleFilterTextChange}
          size="sm"
        />
        <Table
          collapsable={false}
          columns={columns}
          maxBodyHeight="99999px"
          emptyComponent={emptyComponent}
          rows={rows}
        />
      </div>
    );
  }

  _handleFilterTextChange(text: string): void {
    this.setState({
      filterText: text,
    });
  }

  _getKillButton(packageName: string): ?React.Element<any> {
    if (this.props.killProcess == null || packageName == null) {
      return null;
    }
    return (
      <Button
        size="EXTRA_SMALL"
        onClick={() => {
          return this.props.killProcess != null && packageName != null
            ? this.props.killProcess(packageName)
            : null;
        }}
        icon="x"
        ref={addTooltip({
          title: 'force-stop process',
          delay: 300,
          placement: 'left',
        })}
      />
    );
  }
}
