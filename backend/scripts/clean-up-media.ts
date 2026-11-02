// Deletes abandoned uploads once and exits: never finished (over an hour old), failed, or finished but
// never put on a post (over a day old). The API server also does this on a timer; this is for running it by hand or from cron.

import { closeDatabase } from "../src/db/index.js";
import { cleanUpAbandonedMedia } from "../src/services/mediaService.js";

const count = await cleanUpAbandonedMedia();
console.log(`Removed ${count} abandoned upload(s)`);
await closeDatabase();
