import { createApiServer } from './server.js';

const port = Number(process.env.PORT ?? 8787);
createApiServer().listen(port, () => {
  console.log(`LogM8 API listening on http://localhost:${port} (vision provider: stub)`);
});
