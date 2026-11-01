/**
 * useCompanyTransport: the board's one subscription to the server.
 *
 * Company, Cloud, ledger and library traffic is routed to their respective client stores;
 * everything else the server still sends has no reader on the board and is dropped.
 * A connect -- first mount or a reconnect -- asks for fresh company, ledger and Cloud
 * snapshots, because changes made while the socket was down were never delivered.
 */

import { useEffect } from 'react';

import { TRANSPORT_STATE_CONNECTED } from '../../../core/src/constants.js';
import type { ServerMessage } from '../../../core/src/messages.js';
import { transport } from '../transport/index.js';
import type { CompanyClient } from './companyClient.js';
import { isCompanyServerMessage } from './companyMessages.js';
import { PROJECT_TREE_REFRESH_MS } from './constants.js';
import { fleetStore } from './fleet/fleetClient.js';
import { ledgerStore } from './ledger/ledgerClient.js';
import { libraryStore } from './library/libraryClient.js';
import { projectStore } from './projects/projectClient.js';
import { shareStore } from './share/shareClient.js';

export function useCompanyTransport(client: CompanyClient): void {
  useEffect(() => {
    const unsubscribe = transport.onMessage((message: ServerMessage) => {
      libraryStore.accept(message);
      fleetStore.accept(message);
      ledgerStore.accept(message);
      projectStore.accept(message);
      shareStore.accept(message);
      if (isCompanyServerMessage(message)) client.accept(message);
    });
    client.connect();
    projectStore.requestTree();
    ledgerStore.connect();
    fleetStore.connect();
    const unsubscribeState = transport.onStateChange((state) => {
      if (state === TRANSPORT_STATE_CONNECTED) {
        client.connect();
        projectStore.requestTree();
        fleetStore.connect();
      }
    });
    // New sessions reach the ledger/herdr a few seconds after the start ack, so the tree is re-asked
    // while the tab is visible instead of waiting for a reload.
    const refresh = setInterval(() => {
      if (document.visibilityState === 'visible' && transport.state === TRANSPORT_STATE_CONNECTED) {
        projectStore.requestTree();
      }
    }, PROJECT_TREE_REFRESH_MS);
    return () => {
      clearInterval(refresh);
      unsubscribe();
      unsubscribeState();
    };
  }, [client]);
}
