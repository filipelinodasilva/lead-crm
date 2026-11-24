import { RankingDetail } from '@/components/prospecting/ranking/ranking-detail';

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RankingDetail id={id} />;
}
