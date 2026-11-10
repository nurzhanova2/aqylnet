import app from './app';
import { env } from './config/env';

app.listen(env.port, () => {
  console.log(`[AqylNet Backend] running on http://localhost:${env.port}`);
  console.log(`[AqylNet Backend] env: ${env.nodeEnv}`);
  console.log(`[AqylNet Backend] CORS origin: ${env.corsOrigin}`);
});
