// Entry point on the Botkeep node: RELAY_SECRET (what boards present) and ACCESS_PASSWORD (what people log in with) come from .env.
import { createGateway } from './lib/gateway.js';

const gateway = createGateway({
  relaySecret: process.env.RELAY_SECRET,
  accessPassword: process.env.ACCESS_PASSWORD,
  log: console.log,
});
const port = await gateway.listen(Number(process.env.PORT || process.env.SERVER_PORT || 3000));
console.log(`[relay] listening on ${port}`);
