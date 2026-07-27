# Voice control for the Kaiju: which recogniser, and why the choice matters less than it looks

Research answer to Geoff's question (2026-Jul-27): find the fastest-responding multilingual AI so
voice commands feel immediate. Also records what AI plumbing this project actually has, which is
not what we assumed.

---

## First, a correction worth having

**This repo has no AI provider connections at all.** I checked — no OpenAI, Anthropic, Gemini or
xAI keys, calls or edge functions anywhere in DreadRoot.

**But you already own the right piece, in a different project.** The DD69 AI Gateway is live at
**https://ai.divi.love** — a provider-pluggable LLM proxy on the FastHosts box, with Grok and
Claude both proven end-to-end. Adding a provider is one JSON entry. That is exactly the shape the
Kaiju language layer needs, and it means the LLM half of this needs no new infrastructure.

One caveat carried over from that project: it currently uses a single shared token, which is fine
for us testing and cannot ship to every player as-is. That is a Phase 2 problem there and the same
Phase 2 problem here.

---

## The thing to understand before picking anything

The recogniser is **not** where this feels fast or slow.

The pipeline is: **speech → text → an order → the Kaiju's decision.** Recognition is one stage of
four, and the two that actually determine how responsive it feels are the ones after it:

- The **local grammar** in `src/components/siege/globe/kaijuOrders.ts` turns "attack it", "back
  off", "take cover", "hold", "follow me" into orders in **microseconds**, with no network at all.
  It currently handles 22 of the phrasings people actually use under pressure, and it is what most
  commands in a real fight will hit.
- Only unrecognised phrasing escalates to a language model, which is rare and therefore affordable.

So the design already avoids paying the latency on the common path. That reframes the recogniser
question from "which is fastest" to "which is accurate, multilingual, and cheap to swap".

And there is a second reason not to over-optimise: **Kaiju are 300 metres tall and slow by
construction.** A fight where two seconds of thinking does not lose it is a fight that suits spoken
orders. The physical scale we chose and the control scheme we want happen to agree, and we should
lean into that rather than chase milliseconds.

---

## The options, measured

| Option | First-word latency | Languages | Key needed | Notes |
|---|---|---|---|---|
| **Browser Web Speech API** | ~0.3–1 s | many | **none** | Free. Chrome/Edge/Opera full support; Safari 14.1+ with a prefix; Firefox off by default. Not offline — Chrome and Safari send audio to their own servers. |
| **ElevenLabs Scribe v2 Realtime** | **~150 ms** | 90+ | yes | The fastest first-partial measured anywhere right now. |
| **Deepgram Nova-3 / Flux** | ~280–300 ms | multilingual streaming (Flux Multilingual, May 2026) | yes | Built for voice agents; tops English accuracy benchmarks alongside Speechmatics. |
| **AssemblyAI Universal-3.5 Pro Realtime** | ~300 ms | 99+ | yes | Lowest word error rate on the Pipecat open benchmark, and much better on proper nouns than Deepgram Flux (15% vs 50% entity error). |
| **Groq-hosted Whisper** | batch, not streaming | 99 | yes | Very fast per-clip, but it is transcription-after-the-fact, not live streaming. |

A note on names, because they are one letter apart and constantly confused: **Grok** is xAI's
language model, which your gateway already talks to. **Groq** is a different company that runs
other people's models very fast. Neither is a streaming speech recogniser.

---

## Recommendation

**Ship the browser's built-in recogniser first. It is already built.**

- Zero keys, zero cost, zero server, works today, covers a long list of languages.
- Its ~0.3–1 s is comfortably inside what this game needs.
- Every stage downstream takes plain text, so replacing it later changes **one file** and nothing
  else.

Getting the order layer right matters far more than shaving 500 ms off recognition, and the browser
API lets us prove the whole loop before spending anything.

**Then, if it is not good enough, go to Deepgram.** It is the best balance of low latency, genuine
multilingual streaming, and being designed for exactly this — live voice driving an agent. Pick
**AssemblyAI** instead if it turns out we need reliable recognition of *names* (Kaiju names, place
names), where it is dramatically stronger. Pick **ElevenLabs Scribe v2 Realtime** only if raw
latency turns out to be the thing players complain about, which I doubt at this scale.

The honest triggers for upgrading, so it is a decision and not a vibe:

1. Players report it mishears common commands.
2. We need it to work in a browser where the built-in API does not (Firefox, or any offline case).
3. The 22-phrase grammar stops being enough and the LLM path becomes the common case.

Until one of those happens, spending on a recogniser buys nothing a player would notice.

---

## For the language-model half

When the grammar draws a blank, `orderPrompt()` in `kaijuOrders.ts` asks the model for **exactly
one word** from a closed list, and `orderFromModel()` validates it and rejects anything else —
including a chatty reply, which is tested. The model never picks behaviour; it picks one of our
order types, and we can inspect, version and refuse its answer.

Route that through **ai.divi.love**, using **Grok** — it is already proven on that gateway, this
is a trivially easy task for any modern model, and it is a single-word answer so speed dominates
quality. No new key needed.

Keep the model off the per-frame loop entirely. It translates a sentence into an order; it never
decides what the Kaiju does. That decision belongs to the utility scores, which is what makes the
Kaiju able to refuse.

## Sources

- Web Speech API SpeechRecognition - https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
- Browser support and the server-side caveat - https://blog.addpipe.com/a-deep-dive-into-the-web-speech-api/
- Real-time STT model comparison 2026 - https://www.assemblyai.com/blog/best-api-models-for-real-time-speech-recognition-and-transcription
- STT benchmarks and pricing 2026 - https://futureagi.com/blog/speech-to-text-apis-in-2026-benchmarks-pricing-developer-s-decision-guide/
- Deepgram real-time latency - https://www.buildfastwithai.com/ai-tools/deepgram
