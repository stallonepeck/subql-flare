// Copyright 2020-2023 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import {delay} from '@subql/common';
import {Sequelize} from '@subql/x-sequelize';
import {NodeConfig} from '../../configure';
import {CachedModel} from './cacheModel';

jest.mock('@subql/x-sequelize', () => {
  let data: Record<string, any> = {};

  let pendingData: typeof data = {};
  let afterCommitHooks: Array<() => void> = [];

  const mSequelize = {
    authenticate: jest.fn(),
    Op: {
      in: jest.fn(),
      notIn: jest.fn(),
    },
    define: () => ({
      findOne: jest.fn(),
      create: (input: any) => input,
    }),
    query: () => [{nextval: 1}],
    showAllSchemas: () => ['subquery_1'],
    model: (entity: string) => ({
      getTableName: () => 'table1',
      sequelize: {
        escape: (key: any) => key,
        query: (sql: string, option?: any) => jest.fn(),
        fn: jest.fn().mockImplementation(() => {
          return {fn: 'int8range', args: [41204769, null]};
        }),
      },
      upsert: jest.fn(),
      associations: [{}, {}],
      count: 5,
      findAll: [
        {
          id: 'apple-05-sequelize',
          field1: 'set apple at block 5 with sequelize',
        },
      ],
      findOne: jest.fn(({transaction, where: {id}}) => ({
        toJSON: () => (transaction ? pendingData[id] ?? data[id] : data[id]),
      })),
      bulkCreate: jest.fn((records: {id: string}[]) => {
        records.map((r) => (pendingData[r.id] = r));
      }),
      destroy: jest.fn(),
    }),
    sync: jest.fn(),
    transaction: () => ({
      commit: jest.fn(async () => {
        await delay(1);
        data = {...data, ...pendingData};
        pendingData = {};
        afterCommitHooks.map((fn) => fn());
        afterCommitHooks = [];
      }), // Delay of 1s is used to test whether we wait for cache to flush
      rollback: jest.fn(),
      afterCommit: jest.fn((fn) => afterCommitHooks.push(fn)),
    }),
    // createSchema: jest.fn(),
  };
  const actualSequelize = jest.requireActual('@subql/x-sequelize');
  return {
    Sequelize: jest.fn(() => mSequelize),
    DataTypes: actualSequelize.DataTypes,
    QueryTypes: actualSequelize.QueryTypes,
    Deferrable: actualSequelize.Deferrable,
  };
});

describe('cacheModel', () => {
  describe('without historical', () => {
    let testModel: CachedModel<{id: string; field1: number}>;
    let sequelize: Sequelize;

    const flush = async () => {
      const tx = await sequelize.transaction();

      await testModel.flush(tx);

      return tx.commit();
    };

    beforeEach(() => {
      let i = 0;
      sequelize = new Sequelize();
      testModel = new CachedModel(sequelize.model('entity1'), false, {} as NodeConfig);
      testModel.init(() => i++);
    });

    it('can avoid race conditions', async () => {
      // Set the initial model, so we have data in the DB
      testModel.set(
        'entity1_id_0x01',
        {
          id: 'entity1_id_0x01',
          field1: 1,
        },
        1
      );
      await flush();

      // Get the entity and update again so we can have a difference between db and cache
      const entity1 = await testModel.get('entity1_id_0x01');
      if (!entity1) {
        throw new Error('Entity should exist');
      }

      testModel.set(
        'entity1_id_0x01',
        {
          ...entity1,
          field1: entity1.field1 + 1,
        },
        2
      );

      // Clear the get cache to simulate many other operations happening
      (testModel as any).getCache.clear();

      // Flush and update the entity at the same time
      const pendingFlush = flush();

      await delay(0.2);
      const entity2 = await testModel.get('entity1_id_0x01');

      testModel.set(
        'entity1_id_0x01',
        {
          id: 'entity1_id_0x01',
          field1: (entity2?.field1 ?? 0) + 1,
        },
        3
      );

      await pendingFlush;

      const finalEntity = await testModel.get('entity1_id_0x01');
      expect(finalEntity?.field1).toEqual(3);
    });
  });

  describe('historical', () => {
    let testModel: CachedModel<{id: string; field1: number}>;
    let sequelize: Sequelize;

    const flush = async () => {
      const tx = await sequelize.transaction();

      await testModel.flush(tx);

      return tx.commit();
    };

    beforeEach(() => {
      let i = 0;
      sequelize = new Sequelize();
      testModel = new CachedModel(sequelize.model('entity1'), true, {} as NodeConfig);
      testModel.init(() => i++);
    });

    // it should keep same behavior as hook we used
    it('when get data after flushed, it should exclude block range', async () => {
      const spyDbGet = jest.spyOn(testModel.model, 'findOne');
      const sypOnApplyBlockRange = jest.spyOn(testModel as any, 'applyBlockRange');
      testModel.set(
        'entity1_id_0x01',
        {
          id: 'entity1_id_0x01',
          field1: 1,
        },
        1
      );
      await flush();
      // the block range has been set
      expect(sypOnApplyBlockRange).toBeCalledTimes(1);

      const entity = await testModel.get('entity1_id_0x01');
      if (!entity) {
        throw new Error('Entity should exist');
      }
      // should read from get cache, and entity should exclude __block_range
      expect(spyDbGet).not.toBeCalled();
      expect(JSON.stringify(entity)).not.toContain('__block_range');
    }, 500000);
  });
});
