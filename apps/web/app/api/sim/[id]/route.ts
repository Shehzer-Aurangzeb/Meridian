import { proxy, backendFetch } from '@/lib/api/server';

export const dynamic = 'force-dynamic';

const ID = /^[a-z0-9]{20,32}$/;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID.test(id)) {
    return Response.json({ error: `Invalid id "${id}"` }, { status: 400 });
  }
  return proxy(() => backendFetch(`/sim/${id}`));
}
