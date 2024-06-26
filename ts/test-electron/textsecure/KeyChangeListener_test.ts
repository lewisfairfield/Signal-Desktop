// Copyright 2017 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { getRandomBytes } from '../../Crypto';
import { Address } from '../../types/Address';
import { generateAci } from '../../types/ServiceId';
import { explodePromise } from '../../util/explodePromise';
import { SignalProtocolStore } from '../../SignalProtocolStore';
import type { ConversationModel } from '../../models/conversations';
import * as KeyChangeListener from '../../textsecure/KeyChangeListener';
import * as Bytes from '../../Bytes';

describe('KeyChangeListener', () => {
  let oldNumberId: string | undefined;
  let oldUuidId: string | undefined;

  const ourServiceId = generateAci();
  const ourServiceIdWithKeyChange = generateAci();
  const address = Address.create(ourServiceIdWithKeyChange, 1);
  const oldKey = getRandomBytes(33);
  const newKey = getRandomBytes(33);
  let store: SignalProtocolStore;

  before(async () => {
    window.ConversationController.reset();
    await window.ConversationController.load();

    const { storage } = window.textsecure;

    oldNumberId = storage.get('number_id');
    oldUuidId = storage.get('uuid_id');
    await storage.put('number_id', '+14155555556.2');
    await storage.put('uuid_id', `${ourServiceId}.2`);
  });

  after(async () => {
    await window.Signal.Data.removeAll();

    const { storage } = window.textsecure;
    await storage.fetch();

    if (oldNumberId) {
      await storage.put('number_id', oldNumberId);
    }
    if (oldUuidId) {
      await storage.put('uuid_id', oldUuidId);
    }
  });

  let convo: ConversationModel;

  beforeEach(async () => {
    window.ConversationController.reset();
    await window.ConversationController.load();

    convo = await window.ConversationController.getOrCreateAndWait(
      ourServiceIdWithKeyChange,
      'private'
    );

    store = new SignalProtocolStore();
    await store.hydrateCaches();
    KeyChangeListener.init(store);
    return store.saveIdentity(address, oldKey);
  });

  afterEach(async () => {
    await window.Signal.Data.removeMessagesInConversation(convo.id, {
      logId: ourServiceIdWithKeyChange,
    });
    await window.Signal.Data.removeConversation(convo.id);

    await store.removeIdentityKey(ourServiceIdWithKeyChange);
  });

  describe('When we have a conversation with this contact', () => {
    it('generates a key change notice in the private conversation with this contact', async () => {
      const original = convo.addKeyChange;
      const { resolve, promise } = explodePromise<void>();
      convo.addKeyChange = async () => {
        convo.addKeyChange = original;
        resolve();
      };
      await store.saveIdentity(address, newKey);
      return promise;
    });
  });

  describe('When we have a group with this contact', () => {
    let groupConvo: ConversationModel;

    beforeEach(async () => {
      groupConvo = await window.ConversationController.getOrCreateAndWait(
        Bytes.toBinary(
          new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5])
        ),
        'group',
        {
          members: [ourServiceIdWithKeyChange],
        }
      );
    });

    afterEach(async () => {
      await window.Signal.Data.removeMessagesInConversation(groupConvo.id, {
        logId: ourServiceIdWithKeyChange,
      });
      await window.Signal.Data.removeConversation(groupConvo.id);
    });

    it('generates a key change notice in the group conversation with this contact', async () => {
      const original = groupConvo.addKeyChange;

      const { resolve, promise } = explodePromise<void>();
      groupConvo.addKeyChange = async (_, keyChangedId) => {
        assert.equal(ourServiceIdWithKeyChange, keyChangedId);
        groupConvo.addKeyChange = original;
        resolve();
      };

      await store.saveIdentity(address, newKey);
      return promise;
    });
  });
});
