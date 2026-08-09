import { NextRequest, NextResponse } from 'next/server';
import { backendFetch, ApiError } from '@/lib/api/server';

/**
 * POST /api/analysis/coordinate
 * 
 * BFF route for running coordinated analysis on a coin
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const { coin, timeframe } = body;
    
    if (!coin || !timeframe) {
      return NextResponse.json(
        { error: 'coin and timeframe are required' },
        { status: 400 }
      );
    }

    const result = await backendFetch('/analysis-coordinator/coordinate', {
      method: 'POST',
      body: { coin: coin.toUpperCase(), timeframe },
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message, details: error.data },
        { status: error.status }
      );
    }
    
    console.error('Analysis coordinate error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
