import GraphView from "@/components/GraphView";

export default async function GraphPage({ searchParams }: { searchParams: Promise<{ node?: string; zitat?: string }> }) {
  const { node, zitat } = await searchParams;
  return <GraphView node={node ?? null} zitat={zitat ?? null} />;
}
