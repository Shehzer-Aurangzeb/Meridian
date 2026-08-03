import { NextResponse } from 'next/server';
import { backendFetch, ApiError } from '@/lib/api/server';

/**
 * GET /api/health
 * 
 * BFF route for health check - also validates backend connectivity
 */
export async function GET() {
  try {
    const result = await backendFetch('/health', {
      method: 'GET',
    });

    return NextResponse.json({
      bff: 'healthy',
      backend: result,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { 
          bff: 'healthy',
          backend: 'unhealthy',
          error: error.message 
        },
        { status: 200 } // BFF is healthy, just backend is down
      );
    }
    
    return NextResponse.json(
      { 
        bff: 'healthy',
        backend: 'unreachable',
        error: 'Could not connect to backend'
      },
      { status: 200 }
    );
  }
}
