import { proxy, backendFetch } from '@/lib/api/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/calibration
 *
 * How every calibrated output has actually performed, failures included. This
 * is the page that makes the numbers on the map worth believing, so it is a
 * first-class route rather than something buried in a settings screen.
 */
export async function GET() {
  return proxy(() => backendFetch('/calibration'));
}
