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

import type {Definition} from '../../nuclide-definition-service/lib/rpc-types';

import dedent from 'dedent';
import {countOccurrences} from 'nuclide-commons/string';
import fs from '../../commons-node/fsPromise';

const MAX_PREVIEW_LINES = 10;

const WHITESPACE_REGEX = /^\s*/;
function getIndentLevel(line: string) {
  return WHITESPACE_REGEX.exec(line)[0].length;
}

export async function getDefinitionPreview(
  definition: Definition,
): Promise<string> {
  const contents = (await fs.readFile(definition.path)).toString();
  const lines = contents.split('\n');

  const start = definition.position.row;
  const initialIndentLevel = getIndentLevel(lines[start]);

  const buffer = [];
  for (
    let i = start, openParenCount = 0, closedParenCount = 0;
    i < start + MAX_PREVIEW_LINES && i < lines.length;
    i++
  ) {
    const line = lines[i];
    const indentLevel = getIndentLevel(line);
    openParenCount += countOccurrences(line, '(');
    closedParenCount += countOccurrences(line, ')');

    buffer.push(line);

    // heuristic for the end of a function signature.
    // we've returned back to the original indentation level
    // and we have balanced pairs of parens
    if (
      indentLevel <= initialIndentLevel &&
      openParenCount === closedParenCount
    ) {
      break;
    }
  }

  return dedent(buffer.join('\n'));
}
