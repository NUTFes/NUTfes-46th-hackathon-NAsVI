import { Hono } from 'hono';
import type { AppEnv } from './env';
import { bodyLimit } from './middleware/bodylimit';
import { register as places } from './routes/places';
import { register as labels } from './routes/labels';
import { register as stamps } from './routes/stamps';
import { register as landmarks } from './routes/landmarks';
import { register as changes } from './routes/changes';
import { register as dev } from './routes/dev';

const app = new Hono<AppEnv>();
const api = app.basePath('/api');
api.use('*', bodyLimit);
places(api);
labels(api);
stamps(api);
landmarks(api);
changes(api);
dev(api);

// Compatibility for the prototype tests and tools/loadtest/sse.mjs.
changes(app);
dev(app);

export default app;
