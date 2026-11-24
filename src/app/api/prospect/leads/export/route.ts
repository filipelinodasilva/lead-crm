import { requireRole } from '@/lib/auth/account';
import { buildLeadsCsv } from '@/lib/prospect/csv';
import { parseLeadFilters } from '@/lib/prospect/filters';
import { prospectErrorResponse } from '@/lib/prospect/http';
import { fetchLeadsForExport } from '@/lib/prospect/service';

/** GET ?<filters> → CSV of every lead matching the filters (max 5,000). */
export async function GET(req: Request) {
  try {
    const ctx = await requireRole('viewer');
    const filters = parseLeadFilters(new URL(req.url).searchParams);
    const csv = buildLeadsCsv(await fetchLeadsForExport(ctx, filters));
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return prospectErrorResponse(err);
  }
}
