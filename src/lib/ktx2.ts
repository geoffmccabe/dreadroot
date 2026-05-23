// KTX2 conversion client helper.
// Calls the `convert-texture-to-ktx2` edge function and returns the
// resulting public URL (or null on failure — caller decides whether
// to fail the upload or just skip the KTX2 sibling).

import { supabase } from "@/integrations/supabase/client";

export type Ktx2Tier = "standard" | "premium";

export async function convertTextureToKtx2(
  sourceUrl: string,
  tier: Ktx2Tier = "standard",
): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke(
      "convert-texture-to-ktx2",
      { body: { sourceUrl, tier } },
    );
    if (error) {
      console.warn("[ktx2] edge function error", error);
      return null;
    }
    if (!data?.ktx2Url) {
      console.warn("[ktx2] no ktx2Url in response", data);
      return null;
    }
    const ratio = data.bytesIn ? (data.bytesOut / data.bytesIn).toFixed(2) : "?";
    console.log(
      `[ktx2] ${tier} converted ${data.bytesIn ?? "?"} → ${data.bytesOut ?? "?"} (${ratio}×) ${data.ktx2Url}`,
    );
    return data.ktx2Url as string;
  } catch (e) {
    console.warn("[ktx2] convert failed", e);
    return null;
  }
}
