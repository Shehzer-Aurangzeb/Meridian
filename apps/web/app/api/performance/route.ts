import { NextRequest, NextResponse } from 'next/server';
import { backendFetch, ApiError } from '@/lib/api/server';

/**
 * @deprecated Uses legacy TradeAnalysis backend endpoint.
 * TODO: Migrate to /analysis/performance/coordinator-runs/:symbol when frontend is integrated.
 * 
 * GET /api/performance
 * 
 * BFF route for getting overall performance stats
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get('limit');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const queryParams = new URLSearchParams();
    if (limit) queryParams.set('limit', limit);
    if (startDate) queryParams.set('startDate', startDate);
    if (endDate) queryParams.set('endDate', endDate);

    const queryString = queryParams.toString();
    const endpoint = `/analysis/performance${queryString ? `?${queryString}` : ''}`;

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
    
    console.error('Performance fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
