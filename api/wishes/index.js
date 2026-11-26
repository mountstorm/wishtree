// GET /api/wishes: the latest 400 wishes. POST /api/wishes: add one.
import { serviceFromEnv, fromNode, send } from '../../lib/http.js';

export default async function handler(req, res) {
  send(res, await serviceFromEnv().handleWishes(await fromNode(req)), req.method);
}
