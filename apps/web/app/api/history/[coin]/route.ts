import { NextRequest, NextResponse } from 'next/server';
import { backendFetch, ApiError } from '@/lib/api/server';

interface RouteParams {
  params: Promise<{ coin: string }>;
}

/**
 * GET /api/history/[coin]
 * 
 * BFF route for getting analysis history for a specific coin
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { coin } = await params;
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get('limit');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const queryParams = new URLSearchParams();
    if (limit) queryParams.set('limit', limit);
    if (startDate) queryParams.set('startDate', startDate);
    if (endDate) queryParams.set('endDate', endDate);

    const queryString = queryParams.toString();
    const endpoint = `/analysis/history/${coin.toUpperCase()}${queryString ? `?${queryString}` : ''}`;

    const result = await backendFetch(endpoint, {
      method: 'GET',
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message, details: error.data },
        { status: error.status }
      );
    }
    
    console.error('History fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
