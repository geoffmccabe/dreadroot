// One-click admin tool: convert every existing definition texture
// (blocks, seed_definitions, shombie/shwarm/shnake/shtickman) to KTX2
// and store the result in the new texture_url_ktx2 sibling columns.
//
// Runs serially in the browser. Each row is updated as soon as its
// conversion completes, so partial progress sticks even if the admin
// closes the tab.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { convertTextureToKtx2 } from "@/lib/ktx2";
import { useToast } from "@/hooks/use-toast";
import { Zap } from "lucide-react";

type TargetSpec = {
  table: string;
  columns: { src: string; dst: string }[];
};

const TARGETS: TargetSpec[] = [
  {
    table: "blocks",
    columns: [{ src: "texture_url", dst: "texture_url_ktx2" }],
  },
  {
    table: "seed_definitions",
    columns: [
      { src: "trunk_texture_url", dst: "trunk_texture_url_ktx2" },
      { src: "branch_texture_url", dst: "branch_texture_url_ktx2" },
      { src: "fruit_texture_url", dst: "fruit_texture_url_ktx2" },
      { src: "fungal_stem_texture_url", dst: "fungal_stem_texture_url_ktx2" },
      { src: "fungal_cap_top_texture_url", dst: "fungal_cap_top_texture_url_ktx2" },
      { src: "fungal_cap_underside_texture_url", dst: "fungal_cap_underside_texture_url_ktx2" },
    ],
  },
  {
    table: "shombie_definitions",
    columns: [{ src: "texture_url", dst: "texture_url_ktx2" }],
  },
  {
    table: "shwarm_definitions",
    columns: [{ src: "texture_url", dst: "texture_url_ktx2" }],
  },
  {
    table: "shnake_definitions",
    columns: [
      { src: "head_texture_url", dst: "head_texture_url_ktx2" },
      { src: "body_texture_url", dst: "body_texture_url_ktx2" },
      { src: "face_texture_url", dst: "face_texture_url_ktx2" },
    ],
  },
  {
    table: "shtickman_definitions",
    columns: [
      { src: "head_texture_url", dst: "head_texture_url_ktx2" },
      { src: "body_texture_url", dst: "body_texture_url_ktx2" },
      { src: "face_texture_url", dst: "face_texture_url_ktx2" },
    ],
  },
];

export function KtxBackfillButton() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; ok: number; fail: number }>({
    done: 0,
    total: 0,
    ok: 0,
    fail: 0,
  });
  const { toast } = useToast();

  const run = async () => {
    setRunning(true);
    setProgress({ done: 0, total: 0, ok: 0, fail: 0 });

    type Job = { table: string; id: string; srcCol: string; dstCol: string; sourceUrl: string };
    const jobs: Job[] = [];

    for (const target of TARGETS) {
      const selectCols = ["id", ...target.columns.flatMap((c) => [c.src, c.dst])].join(",");
      const { data, error } = await (supabase
        .from(target.table as any)
        .select(selectCols) as any);
      if (error) {
        console.warn(`[ktx2-backfill] skip ${target.table}:`, error.message);
        continue;
      }
      for (const row of (data ?? []) as Record<string, any>[]) {
        for (const { src, dst } of target.columns) {
          if (row[src] && !row[dst]) {
            jobs.push({ table: target.table, id: row.id, srcCol: src, dstCol: dst, sourceUrl: row[src] });
          }
        }
      }
    }

    setProgress({ done: 0, total: jobs.length, ok: 0, fail: 0 });

    if (jobs.length === 0) {
      toast({ title: "Nothing to backfill", description: "All textures already have KTX2 siblings." });
      setRunning(false);
      return;
    }

    let ok = 0;
    let fail = 0;
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const ktx2Url = await convertTextureToKtx2(job.sourceUrl, "standard");
      if (ktx2Url) {
        const { error } = await (supabase
          .from(job.table as any)
          .update({ [job.dstCol]: ktx2Url })
          .eq("id", job.id) as any);
        if (error) {
          fail++;
          console.warn(`[ktx2-backfill] update failed ${job.table}/${job.id}:`, error.message);
        } else {
          ok++;
        }
      } else {
        fail++;
      }
      setProgress({ done: i + 1, total: jobs.length, ok, fail });
    }

    toast({
      title: "KTX2 backfill complete",
      description: `${ok} converted, ${fail} failed.`,
    });
    setRunning(false);
  };

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={run} disabled={running} className="gap-2">
        <Zap className="h-4 w-4" />
        {running
          ? `Backfilling KTX2… ${progress.done}/${progress.total}`
          : "Backfill KTX2 textures"}
      </Button>
      {running && progress.fail > 0 && (
        <span className="text-xs text-destructive">{progress.fail} failed</span>
      )}
    </div>
  );
}
