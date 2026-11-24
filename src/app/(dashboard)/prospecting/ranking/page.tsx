import { RankingPage } from '@/components/prospecting/ranking/ranking-page';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string }>;
}) {
  const { lead } = await searchParams;
  return <RankingPage leadId={lead ?? null} />;
}
