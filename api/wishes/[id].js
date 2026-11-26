// DELETE /api/wishes/:id with "Authorization: Bearer <ADMIN_TOKEN>" removes a wish.
import { serviceFromEnv, fromNode, send } from '../../lib/http.js';

export default async function handler(req, res) {
  const id = req.query?.id ?? decodeURIComponent(new URL(req.url, 'http://x').pathname.split('/').pop());
  send(res, await serviceFromEnv().handleWish(await fromNode(req), id), req.method);
}
