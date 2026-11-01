import { transport } from '../../transport/index.js';
import { createShareStore } from './shareStore.js';

export const shareStore = createShareStore({ send: (message) => transport.send(message) });
