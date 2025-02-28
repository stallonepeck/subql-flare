// Copyright 2020-2023 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import {readFileSync, existsSync} from 'fs';
import path from 'path';
import {Command, Flags} from '@oclif/core';
import {getMultichainManifestPath, getProjectRootAndManifest} from '@subql/common';
import {createIPFSFile, uploadToIpfs} from '../controller/publish-controller';
import {resolveToAbsolutePath} from '../utils';
import Build from './build';

const ACCESS_TOKEN_PATH = path.resolve(
  process.env[process.platform === 'win32' ? 'USERPROFILE' : 'HOME'],
  '.subql/SUBQL_ACCESS_TOKEN'
);

export default class Publish extends Command {
  static description = 'Upload this SubQuery project to IPFS';

  static flags = {
    location: Flags.string({char: 'f', description: 'from project or manifest path'}),
    ipfs: Flags.string({description: 'IPFS gateway endpoint', required: false}),
    output: Flags.boolean({char: 'o', description: 'Output IPFS CID', required: false}),
  };

  async run(): Promise<void> {
    const {flags} = await this.parse(Publish);
    const location = flags.location ? resolveToAbsolutePath(flags.location) : process.cwd();
    const project = getProjectRootAndManifest(location);

    // Ensure that the project is built
    try {
      await Build.run(['--location', project.root, '-s']);
    } catch (e) {
      this.log(e);
      this.error('Failed to build project');
    }

    let authToken: string;

    if (process.env.SUBQL_ACCESS_TOKEN) {
      authToken = process.env.SUBQL_ACCESS_TOKEN;
    } else if (existsSync(ACCESS_TOKEN_PATH)) {
      try {
        authToken = process.env.SUBQL_ACCESS_TOKEN ?? readFileSync(ACCESS_TOKEN_PATH, 'utf8');
      } catch (e) {
        throw new Error(`Failed to read SUBQL_ACCESS_TOKEN from ${ACCESS_TOKEN_PATH}: ${e}`);
      }
    } else {
      throw new Error('Please provide SUBQL_ACCESS_TOKEN before publish');
    }

    const fullPaths = project.manifests.map((manifest) => path.join(project.root, manifest));

    let multichainManifestPath = getMultichainManifestPath(location);
    if (multichainManifestPath) {
      multichainManifestPath = path.join(project.root, multichainManifestPath);
    }

    const fileToCidMap = await uploadToIpfs(fullPaths, authToken.trim(), multichainManifestPath, flags.ipfs).catch(
      (e) => this.error(e)
    );

    await Promise.all(
      project.manifests.map((manifest) => createIPFSFile(project.root, manifest, fileToCidMap.get(path.join(manifest))))
    );

    fileToCidMap.forEach((cid, file, _) => {
      if (file === '') {
        this.log(`Directory uploaded to IPFS: ${cid}`);
        return;
      }
      if (!flags.output) {
        this.log(`SubQuery Project ${file} uploaded to IPFS: ${cid}`);
      } else {
        this.log(`${file}: ${cid}`);
      }
    });
  }
}
