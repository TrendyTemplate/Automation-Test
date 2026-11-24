// Job handlers. Imported once at startup (server.js) so every job type has a handler.
import { registerJob, every } from './jobs.js';
import { getStore, ingestEmail, syncCatalog, afterIngest } from './pipeline.js';
import { sendReviewAlert, sendBuyerConfirmation } from './notify.js';
import { pollMailbox, schedulePolls } from './mailbox.js';
import { config } from '../config.js';

const storeOrSkip = (job) => {
  const store = getStore(job.store_id);
  if (!store) throw Object.assign(new Error('Store no longer exists'), { permanent: true });
  return store;
};

registerJob('ingest_email', async ({ raw }, job) => {
  const store = storeOrSkip(job);
  const ids = await ingestEmail(store, Buffer.from(raw, 'base64'));
  for (const id of ids) await afterIngest(store, id);
});

registerJob('sync_catalog', async (_p, job) => { await syncCatalog(storeOrSkip(job)); });
registerJob('notify_review', async ({ poId }, job) => { await sendReviewAlert(storeOrSkip(job).id, poId); });
registerJob('confirm_buyer', async ({ poId }, job) => { await sendBuyerConfirmation(storeOrSkip(job).id, poId); });
registerJob('poll_mailbox', async ({ mailboxId }) => { await pollMailbox(mailboxId); });

every(config.mailboxPollSec, schedulePolls);
