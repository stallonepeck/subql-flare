// Copyright 2020-2023 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import * as fs from 'fs';
import os from 'os';
import path from 'path';
import git from 'simple-git';
import {cloneProjectGit, validateEthereumProjectManifest} from './init-controller';

jest.mock('simple-git', () => {
  const mGit = {
    clone: jest.fn(),
  };
  return jest.fn(() => mGit);
});

jest.setTimeout(30000);

async function makeTempDir() {
  const sep = path.sep;
  const tmpDir = os.tmpdir();
  const tempPath = await fs.promises.mkdtemp(`${tmpDir}${sep}`);
  return tempPath;
}
const projectSpec = {
  name: 'mocked_starter',
  repository: '',
  endpoint: 'wss://rpc.polkadot.io/public-ws',
  author: 'jay',
  description: 'this is test for init controller',
  version: '',
  license: '',
};

describe('Cli can create project (mocked)', () => {
  it('throw error when git clone failed', async () => {
    const tempPath = await makeTempDir();
    (git().clone as jest.Mock).mockImplementationOnce((cb) => {
      cb(new Error());
    });
    await expect(cloneProjectGit(tempPath, projectSpec.name, 'invalid_url', 'invalid_branch')).rejects.toThrow(
      /Failed to clone starter template from git/
    );
  });
  it('validate ethereum project manifest', () => {
    const projectPath = path.join(__dirname, '../../test/abiTest1');
    expect(validateEthereumProjectManifest(projectPath)).toBe(true);
  });
});
