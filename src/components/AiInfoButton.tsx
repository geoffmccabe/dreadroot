/**
 * AiInfoButton — a small ⓘ that opens a plain-English explanation of an AI part
 * (a behavior like "chase", or a tree node like "utility"). Drop it next to any
 * AI control so newcomers can learn what each piece does without reading code.
 */
import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getAiInfo, type AiPartInfo } from '@/features/enemies/ai/aiDescriptions';

interface AiInfoButtonProps {
  /** id of an AI part (behavior or node), e.g. 'chase' or 'utility'. */
  id?: string;
  /** or pass an explicit info object instead of an id. */
  info?: AiPartInfo;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

export function AiInfoButton({ id, info, side = 'right' }: AiInfoButtonProps) {
  const data = info ?? (id ? getAiInfo(id) : undefined);
  if (!data) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`What does ${data.title} do?`}
          className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side={side} className="w-72 text-sm">
        <div className="font-medium">{data.title}</div>
        <div className="mt-0.5 text-xs italic text-muted-foreground">{data.summary}</div>
        <p className="mt-2 leading-snug">{data.detail}</p>
      </PopoverContent>
    </Popover>
  );
}
