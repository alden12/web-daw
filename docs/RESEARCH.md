# User Research - do the problems this project solves actually exist?

Status: evidence file, gathered 2026-07-17. This doc tests the premises in `docs/DESIGN.md`
against primary user evidence (forum threads, issue trackers, post-mortems). It is deliberately
biased toward **disconfirming** evidence: the goal was to find out where the design is wrong, not
to build a case for it.

`docs/DESIGN.md` remains the single source of truth for the roadmap. This file holds the evidence
and the reasoning; any ticket it argues for lives there, not here.

---

## TL;DR

A synthesis of everything below. Verdicts are graded by evidence strength (Good / Thin, per section 1).

**The pain is real and the architecture answers it - for one audience.** The design solves a genuine,
evidenced pain for developer-adjacent creators; whether it solves anything for anyone else depends on
positioning and feature decisions that have not been made yet.

Per-bet verdicts:

- **Bet 3 - git-style versioning: MIXED.** The pain is real and universally hand-patched (even the
  doubters hand-roll timestamped save-as plus backups), and the design answers the three stated
  objections directly (stable JSON diffs, standard `.mid`, content-addressed sample dedup). Two
  corrections: branching is over-invested (verified demand is *linear revert and snapshot safety*, not
  branch-and-A/B), and versioning is a retention/trust feature that cannot be the thing that pays (the
  Splice Studio warning).
- **Bet 2 - the AI co-author: UNPROVEN, and the riskiest bet.** Evidence is too thin to settle either
  way, and nobody in the corpus had actually used one. Reduce exposure: ship an off-switch, keep
  provenance local (a 30-year producer was auto-rejected by a label for ticking "used AI"), and lead
  with AI-as-librarian rather than AI-as-composer.
- **Browser viability / no-VST: VALIDATED, more than expected.** Plugins are the third-largest
  objection (9%), not the first; a real "no-VST is a feature" constituency exists; and the scary
  AudioWorklet latency source does not survive inspection. The durable objections are
  latency/reliability and audience clarity, not the plugin catalog.
- **Open source: MIXED.** The licence wins no users on its own, but it names an unoccupied slot (no FOSS
  DAW offers Ableton-style clip-launching *composition*) and the AGPL identity is a live wedge (OpenDAW
  was attacked in-thread for not being open).

Strategic read:

- **Sharpest opportunity: the no-VST constraint is the moat.** No plugins means project state is
  *complete*, so it can be JSON, so it can be diffed, versioned semantically, and fully read and written
  by an agent. Every incumbent is locked out of this by their own plugin ecosystem and cannot follow
  without abandoning it. Position: *the open-source browser DAW whose projects are complete, readable
  files, because it owns its whole device chain.*
- **Biggest risk: audience ambiguity.** Versioning wins developers; the agent wins beginners; the two
  audiences barely overlap. Picking a lead segment is the decision this research most strongly implies,
  and developer-adjacent (segment b) is the only well-evidenced fit and the one the built product
  already serves.

Per-segment: **(b) developer-adjacent tinkerers WILL** be satisfied (strongest fit); **(d) complete
beginners MIGHT** (sharpest opening, via "where do I start"); **(a) hobbyists and (c) working/semi-pro
WON'T** as designed (they would need mixing/finishing help, WAM, and local-only provenance).

Next steps (proposed in section 12; none yet on the roadmap):

- Highest certainty: `DAW-13` audio export/mixdown - there is no way to get a finished track out today,
  which plausibly gates any public launch.
- Cheap risk reducers: `AGENT-8` off-switch, `AGENT-9` local-only provenance, `AGENT-12` auto version
  summaries (the most specific unprompted user request found anywhere in the corpus).
- Answer the reported pains (weak dataset, read section 7 first): `AGENT-10` blank-page/"where do I
  start", `AGENT-11` mixing assist, `DAW-14` finishing/constraint mode.
- Decisions, not tickets: leave branching unbuilt; current lean is *not* to build the WAM host
  (`INST-7`), since it dilutes the complete-file differentiator.
- Biggest open unknown: there is no ranked pain dataset for *working* producers, and every finding here
  reacts to the concept - zero hands-on reports of an agentic DAW exist in the corpus.

---

## 1. Method, and an honest health warning

Two research passes were run.

**The first pass was unreliable and its output was discarded.** It fanned out searches, fetched
secondary sources, and extracted claims. Roughly 85% of those claims failed adversarial
verification. Worse, spot-checking showed the failure was not random: it assembled real quotes
into narratives the source threads do not support, double-counted one commenter as two, deleted
qualifiers that reversed a speaker's meaning, and - in one case - fabricated an entire post-mortem
article, complete with quoted causal reasoning, from a directory listing that contains none of
that text.

**The second pass is what this doc reports.** Ten primary sources were fetched directly (HN via
the Algolia API, others via WebFetch or an r.jina.ai proxy) and every attributed quote was checked
as a substring against the retrieved bytes. Each source was also assessed for **thread shape**:
how many participants, how they split, and whether a quoted view is representative or an outlier.

The lesson generalises beyond this doc: **for questions like these, thread shape matters more than
quotes.** Any quote can be found for any position. The counts are the finding.

### How to read the confidence labels

- **Good** - multiple independent participants, a thread large enough to have a shape, quotes
  verified verbatim in context.
- **Thin** - real evidence, but small n. Directional colour, not proof.
- **Unusable** - cited here only to stop someone citing it later.

---

## 2. The evidence base

Every source below was fetched and verified on 2026-07-17.

| Source | What it actually is | Size | Confidence |
| --- | --- | --- | --- |
| [HN: Git for Music](https://news.ycombinator.com/item?id=45092895) (2025-09-01) | Discussion of git+Reaper versioning | 81 pts, 57 comments, 38 participants | Good |
| [HN: OpenDAW](https://news.ycombinator.com/item?id=42988913) (2025-02-09) | Launch thread for a browser DAW, our closest analogue | 209 pts, 131 comments, 70 authors | Good |
| [HN: Bespoke Synth 1.0](https://news.ycombinator.com/item?id=28529672) (2021-09-14) | FOSS modular synth launch; source of the "Ardour is miserable" quote | 745 pts, 242 comments, 140 commenters | Good |
| [KVR: versioning with DAW projects](https://www.kvraudio.com/forum/viewtopic.php?t=429799) (2015) | Producers asked directly if they use VCS | ~18 posts, ~13 users | Good (but 11 years old) |
| [KVR: WavTool](https://www.kvraudio.com/forum/viewtopic.php?t=595134) (2023) | Reaction to a GPT-4-driven browser DAW | 7 posts, 7 participants | Thin |
| [Ableton forum: Version Control](https://forum.ableton.com/viewtopic.php?t=242979) (2021) | Feature-wishlist request | 3 posts, 3,902 views | Thin |
| [gearnews: Ableton and AI?](https://www.gearnews.com/ableton-and-ai-tech/) (2026-01-14) | Speculation from a job posting, plus comments | 5 comments (incl. author) | Thin |
| [W3C WebAudio issue #2632](https://github.com/WebAudio/web-audio-api/issues/2632) (2025-04) | "AudioWorklet is a real world disaster" | 8 comments, 4 participants | Thin |
| [EDMProd: survey of 1000+ producers](https://www.edmprod.com/music-production-struggles/) | A Facebook group signup form, not a survey | n=1097 / n=1228 | Unusable as briefed (see 6) |
| [dang.ai: TuneFlow](https://dang.ai/tool/ai-music-creation-platform-tuneflow) | SEO directory listing, zero editorial content | No thread | Unusable |

Also verified: [Splice Studio shutdown letter](https://splice.com/blog/studio-shutdown/) (primary,
high confidence - an admission against interest).

---

## 3. Bet 3: git-style versioning - MIXED, and branching is the weak limb

### The pain is real, and it shows up as hand-rolled tooling

The [KVR thread](https://www.kvraudio.com/forum/viewtopic.php?t=429799) reads as majority-skeptical
(roughly 6-7 skeptics vs 3-4 interested), and that is the honest headline. But the shape underneath
it is the finding: **nearly every skeptic is simultaneously describing a versioning system they
built by hand.**

- Ranjarresh: Reaper configured to save timestamp-named project files, "Every save = separate
  file", folder mirrored to Dropbox.
- fese: "When I open a project the next day I immediately save it under a new name with the current
  date in it" - and admits he forgets to do it.
- tylenol: quit git for audio, but still keeps "good notes + separate backups of pre-mixdown versions".
- garryknight: Ableton "Collect all and save" plus a weekly backup.
- DJ Warmonger: "I never need to have more than 2 versions of a track" - one working, one experimental.

They all version. They refuse the *tool*. The three blockers are cited independently by multiple
posters and are consistent across the thread:

1. Audio and project files are binary and cannot be meaningfully diffed.
2. DAWs have no merge-conflict resolution.
3. Storage cost of retaining every version.

**This design answers all three** (stable sorted JSON, standard `.mid`, semantic diffs,
content-addressed sample dedup). That is a genuine fit between a stated objection and a designed
answer. Note carefully what it is *not*: evidence that anyone will switch DAWs for it.

Counterweight worth respecting - UltimateOutsider is a professional VCS user, not an opponent:
"I've used all major SCM tools professionally", "Git is my favorite so far". His objection is
scoped and technical: "I'm not sure that ANY traditional SCM tool is suitable for DAW project
versioning, particularly because of all the audio files, which can't be meaningfully diffed."

### The HN thread is strongly pro, with one instructive exception

Of 38 participants in the [Git for Music thread](https://news.ycombinator.com/item?id=45092895),
roughly 15-18 are pro or actively doing it. **Exactly one says he does not need version control** -
Slow_Hand, who is also the thread's **only self-identified record producer**. He posted last (#56
of 57), was immediately challenged by pfannkuchen on how he handles rollback and collaboration, and
never replied.

That one-person exception is not noise. It is the segment split in miniature: the developers want
this; the producer does not.

Working counterexample on the other side - EastLondonCoder: "I've been using git for remote
collaboration music production for 5 years. We sometimes use branches as well when we are working
in let's two ideas for a bass line. We've not really had any issues other than that we need git lfs."

**The strongest demand signal is who showed up.** Five separate builders and founders plugged tools
in exactly this space, unprompted: ericvtheg (MAKID, Ableton versioning), sasham (diversion.dev),
sofasofa (sesh.fm, "like Figma for music"), gschoeni (Oxen VCS), cranberryturkey. Five people are
building this. That is perceived demand, whatever the producers say.

The thread's own consensus, if one must be named: **the DAW should solve this itself, and the
obstacle is binary/proprietary formats and unversionable plugin state.** A format problem, not an
appetite problem.

### Branching is the weakest part of the bet

This is the clearest actionable correction in the research.

- AlecSchueler - quoted elsewhere as an anti-VCS voice, which **inverts him**. Two lines earlier
  in the same comment: "Linear version control makes total sense to me: 'Can we go back to the
  version from 2 weeks ago' 'which one was that?' 'Before we removed the hi hat!'". His actual
  position: "But I struggle to think of a realistic case for branching."
- tlb: "But branches are only really useful if you can merge... But the file formats in music
  production don't generally allow such things." He grants a branching use case first (A/B the
  cowbell), so this is "merging is blocked", not "branching is useless".
- ericvtheg, who *sells* a versioning tool and is therefore pro-versioning: "I feel like it sounds
  nice but in the end ppl are probably just gonna copy and paste their files because it's intuitive
  and easy", plus "I imagine users getting confused by branching causing them to think they've lost
  their progress."

Counter-case, for fairness - nativeit answers the branching doubt with concrete uses: "re-mixes,
snapshots, and live performance configurations", ephemeral branches deleted when done. And he
concedes it "becomes a little messy when most of the contributors are not also fluent... with git."

**Read:** the demand is for **linear revert and snapshot safety**. "Branch and A/B a different drop"
is the part of section 7 with the least evidence behind it. DESIGN.md already concedes merge is not
the pitch, which drains branching further: a branch you cannot merge is a save-as with better
manners.

### Two design details the sources hand us

From the [Ableton wishlist thread](https://forum.ableton.com/viewtopic.php?t=242979) - which is
**thin** (see below) but useful as design colour:

- **Auto-generated commit messages are asked for explicitly.** terracnosaur wants version metadata,
  then immediately says he does not want to write it, proposing auto-summaries like "36 tracks: 12
  audio 24 instruments", tiered so "minor saves could have single lines / first / last save of the
  day might ask for more text." This is a direct, unprompted request for AI version summaries.
- **The request is local-first.** ast*rsk: "this should probably be all 100% local", "largely I see
  this being an offline local storage system built into the project file", with remote hosting
  opt-in and a user-defined repository folder. Stated motivations: "alleviate versioning anxiety and
  detrimental destructive editing".

Note the tension with the `HOST-*` direction, which is server-authoritative. Not a contradiction
(the bundle is local-shaped either way) but the only users we found asking for this asked for it
local, with the server optional.

**Health warning on that thread:** 3 posts total, in a Feature Wishlist subforum where support is
the structurally expected default. The OP and the Time Machine/Git commenter both registered
accounts *minutes before posting* and never posted again. 3,902 views produced 2 replies (~0.05%).
Zero Ableton staff response. Dead since May 2021. **This is design colour, not demand.** Anyone
citing it as evidence of user demand is overclaiming.

### The monetisation warning

Splice Studio is the closest dead analogue: auto-uploaded every DAW save as a revision, commit-style
timeline, branches, integrated with Live/Logic/FL/GarageBand/Studio One. TechCrunch's 2013 launch
headline was literally "Splice Is GitHub For Musicians". Splice raised over $150M.

CEO Kakul Srivastava, [announcing its death](https://splice.com/blog/studio-shutdown/): "Although
the potential of Studio to help music creators collaborate was core to our founding ideology, this
feature hasn't been a focus for us since 2017. Simply put, we haven't been able to provide the
quality of experience of which we can be proud. In fact, keeping it functional has actually slowed
us down from delivering more value, faster."

**Read this precisely.** Studio was free and never monetised, sat beside a sample marketplace that
printed money, and lost the budget fight. joshka, in the HN thread: Splice "pivoted into the more
profitable sample discovery and sales business later and dropped the less profitable studio
product." Three separate attempts to stretch this into "producers do not want versioning" were
each refuted unanimously in verification, and correctly so - Splice published no usage data at all.

**It is a monetisation warning, not a demand warning.** Bet 3 is a retention and trust feature. It
cannot be the thing that pays.

**Verdict: MIXED.** The pain is real and universally hand-patched; the mechanism is right and
answers the stated objections; branching is over-invested; and nobody has ever made money on it.

---

## 4. Bet 2: the AI co-author - UNDER-EVIDENCED, with two concrete hazards

### The evidence is too thin to settle this, in either direction

Be honest about the sample sizes:

- [KVR WavTool thread](https://www.kvraudio.com/forum/viewtopic.php?t=595134): **7 posts.** Split
  1 for / 5 against / 1 irrelevant. The single pro voice is the OP, jules99, who hedges ("might
  make... a bit easier") and pre-concedes his audience ("yeah, I know, not KVR"). He asked "What
  does everybody else think?" and got a 5-0 pile-on with zero defenders.
- [gearnews](https://www.gearnews.com/ableton-and-ai-tech/): **5 comments, one of them the
  author's.** So four readers. Reacting to a feature that does not exist - the entire article is
  extrapolated from a single job posting for an ML engineer.

Neither can carry a conclusion. Two caveats that cut *against* over-reading the negativity:

1. **Selection bias.** KVR is committed hobbyists and professionals - people whose identity is
   bound up in the craft an AI DAW automates. A 5-0 rejection from this audience is close to the
   prior, and says nothing about beginners, who are the population jules99 was actually discussing
   and who are absent from the thread.
2. **Nobody tried it.** Zero hands-on reports in either thread. The hostility is aimed at the
   *concept*, and in kritikon's case at the imagined banality of the users, not at the software.

One quantified signal worth more than the comments: the gearnews article carries a **reader rating
of 1.8 / 5.0**, and Jeremus's anti-AI comment ("A.I slop") is the **only comment on the page with a
positive vote score (+4)**. Both the pro-AI comment and the AI-using commenter were voted to -2.
The silent readership leans anti even though the four people who typed do not.

### Hazard 1: "as long as we can turn it off"

Commenter "-" gives the only conditional-acceptance position found: fine, "as long as we can turn
it off."

`docs/DESIGN.md` section 3 currently specifies the opposite: "The agent is never fully gone, so the
collaboration never disappears even in hands-on editing." Produce mode collapses it to a thin
presence rail.

The one voice we have who is winnable asks for exactly the thing the design refuses. The cost of an
off-switch is one collapsed pane. The cost of refusing is disqualifying yourself with the sceptics
on first run, before the product has argued its case.

### Hazard 2: provenance is a liability, not just a UX choice

Commenter "g." - 30 years making electronic music, used Waves Illugen for "a couple of supplementary
drum patterns", explicitly not Suno - had a demo **auto-rejected by a record label** the moment he
answered "yes" to "Did you use AI?" on the submission form. Verified detail: it was a record label
via a demo form, not a distributor and not a competition. His related Spotify/YouTube claim is
explicitly hearsay in the source ("I've even heard that...") and must not be cited as fact.

This is n=1 and self-reported. It matters anyway, because the *mechanism* is plausible and the
industry is standardising AI disclosure.

The two-voice colour, the AI cursor, and the activity feed are framed in DESIGN.md as trust
features. They are also **an evidence trail against the user.** An edit-level provenance store could
in principle *prove* the surviving industry line ("human as primary creative force") - or indict.
The design should choose deliberately:

- Provenance stays **local by default and is never exported**.
- Export/bounce strips authorship metadata unless explicitly opted in.
- The teal/coral distinction is a *working* aid, not a permanent property of the artifact.

### The one thing the pro-AI voice actually wants: the librarian

Audiophil, the sole pro voice, asks for: a chat bot to build a string-orchestra template using NI
libraries; a template for recording his band with the X32; and a generated guitar jam track on
"Bbmaj7 Am7 Cm7 F in the style of Feist". The last one is qualified: **"I would be ashamed to make
this public."**

That is the shape of the acceptable line, from the only person in the corpus who wants any of this:
**AI-as-librarian is wanted openly; AI-as-composer is wanted privately and concealed.** DESIGN.md
section 4 already has the librarian idea ("Claude is the librarian"). It is the better-evidenced
half of Bet 2 and it is currently the junior partner in the pitch.

### The graveyard: two real deaths, causes unknown

- **WavTool** - browser DAW, GPT-4 "Conductor" assistant that could act anywhere in the DAW, stem
  separation, AI MIDI generation, and (unlike this design) **VST support**. Went dark November 2024;
  [acquired by Suno](https://techcrunch.com/2025/06/26/suno-snaps-up-wavtool-for-its-ai-music-editing-tools-amid-ongoing-dispute-with-music-labels/)
  June 2025, staff folded into Suno. The AI-agentic DAW was not valued as a DAW; it was absorbed as
  an editing layer for a generative platform.
- **TuneFlow** - shutdown corroborated independently and precisely: Wayback shows HTTP 200 through
  2024-08-29, then 403 on 2024-09-13; dang.ai's link checker marked it inactive 2024-09-29; the
  domain is now parked behind a resale registrar. **The GitHub org went silent in June 2023, about
  15 months before the site died** - the open-source effort was abandoned long before the product.

**Do not claim to know why either died.** The widely-circulated TuneFlow post-mortem (targeted all
skill levels, no revenue model, high AI costs) is **fabricated**. The dang.ai page contains none of
that text; it is a promotional stub whose only statement about TuneFlow's fate is an automated
status banner asserting no cause. Its own listing shows **$14.99/$32.99 pricing**, directly
contradicting the "no revenue model" claim. There was never even an HN thread about TuneFlow
(Algolia returns zero hits). Both deaths are facts. Both causes are unknown.

**Verdict: UNPROVEN, and the riskiest bet by a distance.** Not disconfirmed - the evidence to
disconfirm it does not exist either. Reduce exposure: ship the off-switch, keep provenance local,
lead with the librarian.

---

## 5. Browser viability - the plugin wall is LOWER than assumed

This is the biggest correction to conventional wisdom in the whole exercise.

### Reception of the closest analogue was warm

The [OpenDAW thread](https://news.ycombinator.com/item?id=42988913) - a browser DAW, launched
2025-02-09, by the developer of Audiotool - drew 209 points and broadly positive engagement.
Roughly 18-20 commenters are net-positive on execution ("remarkably complete", "most crazy thing I
have ever seen done in the browser", "deeply impressive"). Two commercial parties turned up wanting
to integrate. **Exactly one commenter is flatly hostile to the concept.** The dominant criticism
pattern is "this is impressive, BUT [caveat]" - admiration with a reservation.

### Plugins are the third-largest objection, not the first

Subtree sizes, computed from the comment tree:

| Objection | Comments | Share of thread |
| --- | --- | --- |
| Latency ("There is no such thing as a DAW inside a browser") | 48 | 37% |
| DAW UX/complexity (aimed at **all** DAWs, not OpenDAW) | 20 | 15% |
| **Plugins** | 12 | 9% |
| "Who is the audience?" | 10 | 8% |

The punchiest anti-plugin line - 6stringmerc's "A DAW that doesn't run VSTs out of the box is like
buying a car with no wheels on it" - is a top-level comment with **zero replies**. Nobody engaged.

### "No VSTs" has a real constituency

The plugin question is closer to a tie than a pile-on. Against:

- PaulDavisThe1st (Ardour lead): "90% of the plugins in the world are not available" in the browser,
  and the lack "would be viewed as completely crippling." **But he hedges himself twice**, concedes
  "people do exaggerate the extent to which a specific plugin is needed", and predicts JUCE may
  target "wasm/webaudiomodule" within 2-5 years.

For, and more concrete:

- rdelpret: "I would be down for a browser ableton suite that had all the stock devices and didn't
  have vst support... **you can do 90% of what you need to do with just stock devices**."
- MDGeist: pre-VST Reason was "Creatively... very freeing"; praises knowing stock effects inside out.
- peepee1982: wrote, recorded and published a song in Bandlab in about three hours on a work laptop;
  found it "liberating to be shielded from the many choices."
- duped: "something interesting about building out an audio platform with 'no VSTs' as a constraint."
  Also: "about 6 years ago I was convinced that the web was a deadend for even middling complexity
  audio projects when I saw Bandlab at NAMM, and I was very wrong."

This dovetails with the [KVR GAS threads](https://www.kvraudio.com/forum/viewtopic.php?p=9158323),
where producers report *deleting* plugins to finish work ("less stuff more creativity" worked "like
magic"; "I thrive in simplicity").

### The escape hatch nobody in this project has costed

gravitronic: **Web Audio Modules** (webaudiomodules.com) is "an audio/video/midi plugin standard for
the web and it is rather mature"; supporting it would "instantly get ~50 plugins supported in the
DAW." He built a collaborative browser DAW (sequencer.party) and packaged wam-community.

This is the only third-party plugin path that does not require abandoning the browser. There is
currently no roadmap ticket for it.

### Latency: contested, and the scary source does not hold up

Latency is the objection with real mass, and even it is disputed in-thread (beAbU, Aldipower,
jampekka, IsTom, adriand all argue it is overstated: "there's just a lot of voodoo floating around
regarding audio"). Thresholds stated by different practitioners:

| Commenter | Stated tolerance |
| --- | --- |
| TehCorwiz | "you can get away with 2 or 3 ms... anything over 5 ms is super frustrating" |
| tigeba | wants "overall latency < 5ms" when recording |
| jcelerier | "Past ~8ms I feel it when I play, past 15ms I can hear the less accurate playing" |
| adriand | "At 128 samples... round trip latency is 13 ms, and even that is not a frustrating amount" |
| TonyTrapp | "Even WASAPI shared mode latency is really usable (below 30ms)" |

**The AudioWorklet horror story does not survive contact.**
[Issue #2632](https://github.com/WebAudio/web-audio-api/issues/2632) ("AudioWorklet is a real world
disaster") is **one developer**, 8 comments, 4 participants: the author (3 comments), one bystander
offering a workaround without corroborating, and **two spec maintainers pushing back**. One total
heart reaction. Closed as redundant, with a Code of Conduct rebuke.

He undercuts himself twice, and both concessions were omitted by the first pass:

- "even the original ScriptProcessorNode code is poisoned by crackling distortions" - if the
  deprecated non-worklet path degrades identically, the render quantum is not the mechanism.
- "Perhaps all the web browsers have flawed implementations" - i.e. he allows it is an
  implementation bug, which is exactly what the maintainers said.

**Status of the fix:** `renderSizeHint` on `AudioContextOptions`. Issue #2450 (opened 2019, so it
predates the complaint by six years) was closed 2025-05-23 with "This spec work is complete." It is
a *hint*, settable at construction only. **Browser shipping status is unverified - do not claim it
ships anywhere without checking.**

**Verdict: VALIDATED, more than expected.** The audio-competent audience accepts a no-VST browser
DAW more readily than the folklore suggests. The durable objections are latency/reliability and
audience clarity, not the plugin catalog.

---

## 6. Open source - buys zero adoption, but names an unoccupied slot

The "open-source DAWs are unusable" folklore rests on one quote, and it does not hold.

In the [Bespoke Synth thread](https://news.ycombinator.com/item?id=28529672) (242 comments, 140
commenters), **exactly one commenter** (_qbjt) criticises Ardour's UX: "I want to like Ardour but
it's a miserable piece of software to try to make music in. Feels like a chore to perform any
action, kills my vibe." Zero others endorse it. The replies run 2-0 against. And **_qbjt retracted
it 54 minutes later** ("apologies if that comment came across as inflammatory. I really respect the
work you and the Ardour team have done"), then reported three days later that he was "actually
warming up to Ardour."

Ambient sentiment toward FOSS audio in that thread is warmly positive. Paul Davis is its most
prolific and best-received commenter.

Two findings that do survive:

1. **The license does not win users, and Ardour's own author says so.** Davis links his article
   titled ["Is open source a diversion from what users really want?"](https://discourse.ardour.org/t/is-open-source-a-diversion-from-what-users-really-want/102665).
   _qbjt: "I'm not going to hold myself back because it has a free software license." Two people,
   one of them the leading FOSS DAW developer alive, independently doubting the license is the draw.
2. **The unoccupied slot, unrefuted in-thread.** _qbjt's substantive claim - that no FOSS DAW offers
   an Ableton-style clip-launching *composition* workflow - is nowhere contradicted, and is partly
   conceded by the one person who answered it (thefr0g recommends Zrythm/LMMS, then admits "I still
   use Bitwig though..."). FOSS DAWs are competent at recording and mixing and absent in
   electronic-music composition.

**Bonus signal the design can exploit:** four separate commenters on the OpenDAW thread attacked it
for not being open source despite the name - "Why name it openDAW if it is not open source?", and
"a pretty weak response to 'why isn't your product with Open in the name open-source yet'". This
project *is* AGPL. That is a live sore point in the exact audience, and a small, free wedge.

**Verdict: MIXED.** Open source is not an acquisition pitch. The composition-workflow gap is real
and this design points straight at it.

---

## 7. What people actually complain about - and why we still don't really know

### The one dataset everyone cites is not what it claims

The ["Survey of 1000+ Producers"](https://www.edmprod.com/music-production-struggles/) is **not a
survey.** It is the **Facebook group membership-approval form** for the closed "EDMProd Artist
Community", a beginner-oriented group run by a course vendor. The screenshot reads: "Your membership
is pending approval. Answer these questions from the group admins to help them review your
membership."

Consequences:

- **Selection bias is the instrument, not a flaw.** The population is people at the exact moment
  they decide they need to join a beginner EDM learning community. 36.3% have been producing 0-1
  months. Of course the top answer is "where to start".
- Free-text answers, post-hoc coded by staff, no reliability check.
- Answers written *for moderators who gate admission*, so social-desirability pressure applies.
- Data is 2019-vintage (image paths, screenshot timestamps) republished under a 2023 byline.
- **Categories with 3 or fewer responses were binned into "Other".** Any concern held by under 4 of
  1097 people is invisible by construction.

**Its headline conclusion is contradicted by its own data.** The article concludes "most problems
that producers have to overcome are mental rather than technical", then routes straight into a
course sale ("It's why we created EDM Foundations"). But by its own tallies: technical/craft
categories (Mixing & Mastering 90, Arrangement 70, Music Theory 46, Learning my DAW 46, Melody
Writing 43, Sound Design 38) = **333 responses, 30.4%**. Unambiguously mindset categories
(Motivation 18, Inspiration 20, Creativity 15, Consistency 9, Writer's Block 6) = **68, 6.2%**. The
prose publishes nine categories and stops; the pie labels 17 of ~38 slices. Every layer of
presentation truncates in the direction that flatters the thesis.

**Its churn stat is arithmetically wrong.** The article's "61.4% of producers are within their first
year" does not match its own spreadsheet. Sub-12-month buckets sum to 53.4%; including the "1 year"
bucket gives 65.7%. 61.4% implies 754 responses = the sub-12-month buckets **plus the 2-year bucket**,
which the article separately reports as "a tiny 8% in the 2nd year". It is a wrong-row sum, and it
propagated into the article's bar chart. **Cite 53.4% (under 12 months) or 65.7% (one year or less).
Never 61.4%.**

### What it can honestly support

Used strictly as evidence about *beginners*, the full ranked list (n=1097):

| Rank | Struggle | Count | % |
| --- | --- | --- | --- |
| 1 | Where to start | 208 | 19.0% |
| 2 | Mixing & Mastering | 90 | 8.2% |
| 3 | Everything | 82 | 7.5% |
| 4 | Finishing | 77 | 7.0% |
| 5 | Arrangement/Composition | 70 | 6.4% |
| 6 | Marketing/Promotion | 66 | 6.0% |
| 8 | Music Theory | 46 | 4.2% |
| 9 | Learning my DAW | 46 | 4.2% |
| 10 | Melody Writing | 43 | 3.9% |
| 11 | Sound Design | 38 | 3.5% |
| ... | ... | ... | ... |
| ~32 | **Collaboration** | **5** | **0.46%** |

Version control, project-file management, backup, and data ownership appear **nowhere** among the 32
enumerable categories covering 98.1% of responses. The nearest adjacent categories are Workflow (17,
1.5%) and Planning/Productivity (7, 0.6%).

**But this cannot disconfirm Bet 3**, for two reasons: the sub-3-response binning makes small
categories invisible by construction, and a beginner who has never finished a track cannot have a
version-control problem. It is evidence about what people joining a beginner EDM Facebook group say
they struggle with. Nothing more.

### The honest gap

**We do not have a good ranked pain-point dataset for working producers.** That is a real hole in
this research, and it is the single most valuable thing a follow-up could fix. Everything above
about segment (a) and (d) rests on a course vendor's signup form from 2019.

### The risk this surfaces anyway

The [KVR GAS thread](https://www.kvraudio.com/forum/viewtopic.php?p=9158323) and its
[2024 corroboration](https://www.kvraudio.com/forum/viewtopic.php?t=617044) are consistent and
independent:

- worldfever: "I'm struggling a lot with the amount of choice I have for every task... that it often
  detracts me from just... making music."
- BackInCheck: "I think having too many plugins can definitely interfere with creativity."
- martiu: removed most plugins to beat writer's block; "less stuff more creativity" worked "like
  magic", avoiding "paralysis from endless options".
- sandandpaint: "Trying out new plugins is a fun, immediate reward activity with no outcome."

**Producers are actively deleting optionality in order to finish.** The axis principle (vertical =
alternatives), clip variants, and "three variations: busier, sparser, syncopated" all *manufacture*
optionality. This cuts both ways - it supports the no-VST stance and the librarian framing - but it
is a live risk to section 6's fearless-iteration thesis, aimed at exactly the people who report
that more choices are why they do not finish.

---

## 8. Per-segment verdicts

**Reasoning from thin evidence. These are arguments, not findings.**

### (b) Developer-adjacent tinkerers - WILL be satisfied. Strongest fit.

The only segment where the evidence is good, and it is good: the HN thread *is* this segment asking
for this product, with five founders already building pieces of it. Local-first, git-shaped history,
MCP, IDE editing, and a diffable folder are precisely their stated asks. rectang even asks the
question this project answers: "What options do I have for text-based DAW?"

**Risks:** small and non-commercial. The live-coding subset (Strudel, TidalCycles, Sonic Pi) rejects
the DAW frame outright - their value is real-time pattern morphing, and "a live coder's set is 90
percent improvisation", not "finish a track". Strudel already owns the browser slot for them.
Complementarity is possible (be the arrangement and mix layer they lack) but they are not the same
people.

### (a) Bedroom/hobbyist producers - WON'T, as designed.

The design answers none of their top four reported pains (where to start, mixing/mastering,
"everything", finishing). No-VST is genuinely fine here - this is the segment the OpenDAW
counter-constituency is drawn from, and the GAS threads say fewer choices help. But the fearless-
iteration/variants machinery pushes against their stated blocker.

**To win them:** mixing and mastering assistance; a finishing/constraint mode; the agent pointed at
"where do I start" rather than at authorship.

### (c) Working/semi-pro producers - WON'T, and two independent blockers.

1. **Plugins.** 90% unavailable in the browser (Davis). WAM is the only path that keeps the browser.
2. **AI provenance is a commercial liability** - and it lands hardest here, because they are the ones
   submitting to labels. "g." is exactly this segment, and he got auto-rejected.

Note also that the substitutes are entrenched: on Avid's own forum, cloud collaboration is described
as a joke, and people who genuinely need to collaborate have already paid for something else.
(*This last point is from the first, unreliable pass and was NOT verified. Treat as a lead, not a
finding.*)

**To win them:** WAM support, plus provenance that stays local and never exports.

### (d) Complete beginners - MIGHT, and it is the sharpest opening.

Their #1 reported problem is "where do I start" at 19%, roughly 2.3x the next item. That is the one
thing a competent agent genuinely answers, and the only pro-WavTool voice in the corpus was
beginner-focused: "the potential for beginners... is huge! Not only being able to ask it questions
on music theory or signal flow, but also to create beats, melodies, bass lines or effects chains by
simple text commands."

**Risk:** they may want a toy, and the browser-DAW graveyard keeps landing in education/beginner
niches rather than converting upward.

### The cross-cutting risk: audience ambiguity

Courting all four segments at once is the failure mode the sources name directly, on the thread
about our closest analogue:

- psytrancefan: "I am not sure who the audience is"
- wdfx: "There's a huge divide between people who might play with this at home as a toy and those
  who would be able to work with professional musicians with it."
- dmje, a competent producer, bouncing off: "it isn't aimed at me"

"Who is the audience?" was the fourth-largest subthread (10 comments, 8%).

---

next## 9. Strategic read

### Biggest risk

**Audience ambiguity**, and it is not a hypothetical - it is a top-4 objection on our closest
analogue's launch thread. Bets 2 and 3 point at *different segments*: versioning wins developers,
the agent wins beginners, and the two audiences do not overlap or even like each other. Picking one
to lead with is the decision this research most strongly implies.

### Sharpest opportunity

**The no-VST limitation is what makes the format bet possible.** Paul Davis names the two things
that break project portability: external file references, and plugins unavailable on the target
system. He adds: "In my experience, #2 is a vastly bigger issue than #1."

No plugins means project state is *complete* - so it can be JSON, so it can be diffed, so it can be
versioned semantically, so an agent can read and write all of it. The constraint that costs the
semi-pro segment is the same constraint that enables every differentiator. **Every incumbent is
locked out of this by their own plugin ecosystem, and none of them can follow without abandoning it.**

Stack that with the unoccupied slot (no FOSS DAW does Ableton-style clip-launching composition) and
the AGPL wedge (a live grievance against OpenDAW), and there is a coherent position:

> The open-source browser DAW whose projects are *complete, readable files* - because it owns its
> whole device chain. Your project is data you can diff, git, script, and hand to an agent.

That is defensible, honest about the trade, and true today.

### What to do about Bet 2

Do not lead with "AI co-author". The evidence for the co-author framing is one hedged forum post;
the evidence for **AI-as-librarian** is the same audience's only concrete ask. Same engine, same
tool catalog, different pitch. Lead with the librarian and the blank page; let authorship be
something users discover the agent can do, not the thing that greets them.

---

## 10. What we still do not know

Ranked by how much it would change decisions.

1. **What working producers actually complain about.** The only ranked dataset is a beginner
   community's signup form. This is the biggest hole in the research.
2. **Whether anyone has ever *paid* for DAW version control.** Splice Studio was free its whole
   life, so its death cannot answer this. Check Avid Cloud Collaboration, Audiomovers, Syncspace,
   and studio Git LFS use. This is the question that actually decides Bet 3's business case.
3. **Why WavTool and TuneFlow died.** Both deaths are verified facts; both causes are unknown, and
   the circulating explanation is fabricated. A founder statement would be worth more than all the
   sentiment threads combined.
4. **Whether `renderSizeHint` ships anywhere.** Spec work is complete; implementation status
   unverified.
5. **Real reception of an agentic DAW by people who used one.** Every source here reacts to the
   concept. Zero hands-on reports exist in the corpus.

---

## 11. Sources not used, and why

Kept here so they are not cited later in good faith.

- **dang.ai TuneFlow post-mortem** - contains no post-mortem. A promotional stub whose only claim
  about TuneFlow's fate is an automated dead-link banner asserting no cause. The widely-quoted
  causal story is fabricated. Its own page lists $14.99/$32.99 pricing, contradicting "no revenue
  model".
- **Point Blank Music School "top 10 challenges"** - SEO content marketing whose ten items map onto
  courses the school sells. Its omissions are structurally predicted by what the publisher sells,
  regardless of what producers feel.
- **Sonarworks "AI or Die"** - vendor content marketing with a pro-AI axe to grind. Its cited
  numbers (82% of non-users name artistic integrity; "never use AI" falling 29% -> 18%) trace to a
  Tracklib study that was never verified against the primary source. Do not cite second-hand.
- **iZotope "amateur to professional mix"** - vendor education content, not user evidence. Useful
  only as a demand-signal observation: iZotope monetised the mixing skill gap with assistive AI and
  producers bought it, which hints the sharpest AI opportunity points at the *mix*, not authorship.

---

## 12. Proposed tickets (NOT yet on the roadmap)

The "so what" of everything above. **These are proposals pending review; none is on the roadmap.**

`scripts/roadmap.ts` reads **only** `docs/DESIGN.md`, so the markers below are inert while they live
in this file. **To promote one:** move the marker line into `docs/DESIGN.md` beside the prose that
describes it, and delete it here. Ids are reserved against the current areas (next free were DAW-13,
INST-7, AGENT-8, AGENT-12) but are not binding until promoted.

### A. A gap that stands regardless of the research

`DAW-13` `to-do` Audio export and mixdown

Not research-driven; found while mapping the roadmap. There is currently **no way to get a finished
track out of the DAW as audio**. The `.daw.zip` export (slice 15) is the *project* bundle;
`OfflineAudioContext` appears only under `AGENT-4.1` for agent ears. Every segment needs this and it
plausibly gates any public launch. Engine work partly overlaps `AGENT-4.1`.

### B. Cheap risk reduction

`AGENT-8` `to-do` Agent off-switch (deps: AGENT-2)

DESIGN.md section 3 specifies "The agent is never fully gone", with Produce mode collapsing it to a
thin presence rail. The only conditional-acceptance voice in the entire corpus asks for exactly the
opposite: *"as long as we can turn it off."* Cost is a collapsed pane and a setting; refusing it
disqualifies the sceptics before the product has argued its case. Low cost, direct evidence,
contradicts a current design decision - so decide it deliberately rather than by default.

`AGENT-9` `to-do` Local-only provenance, strip authorship on export (deps: AGENT-3)

`AGENT-3` shipped, so the authored-edit trail already exists; this is about not weaponising it. A
producer of 30 years had a demo **auto-rejected by a record label** for ticking "Did you use AI?" on a
submission form, having used AI only for supplementary drum patterns. The two-voice colour, AI cursor
and activity feed are framed in DESIGN.md as trust features; they are also a durable evidence trail
against the user, and industry AI labelling is standardising. Proposed stance: **provenance is local by
default and never exported**; export/bounce strips authorship metadata unless explicitly opted in;
teal/coral is a *working* aid, not a permanent property of the artifact. (Evidence is n=1 and
self-reported - but the mechanism is plausible and the fix is nearly free.)

`AGENT-12` `to-do` Auto-generated version summaries (deps: AGENT-2)

DESIGN.md section 7 already describes plain-language version summaries as an "AI superpower", but there
is no ticket. This is the most specific unprompted user request found anywhere in the research: an
Ableton user asks for commit-message metadata, then immediately says he will not write it, proposing
auto-summaries ("36 tracks: 12 audio 24 instruments") tiered by importance - minor saves get one line,
the last save of the day asks for more.

### C. Answers the pains people actually report

Ranked from the only ranked dataset available, which is **weak** - a beginner community's signup form.
Read section 7 before leaning on these numbers.

`AGENT-10` `to-do` Blank page, where do I start (deps: AGENT-2)

The #1 reported struggle at 19%, roughly 2.3x the next item. The agent's strongest evidenced use case -
and note it is the *librarian* framing (DESIGN.md section 4), not the co-author framing (section 1, bet
2). The clearest strategic recommendation in this research is to lead with the librarian and let
authorship be something users discover.

`AGENT-11` `to-do` Mixing assist (deps: AGENT-4.1)

The #2 reported struggle at 8.2%. AI pointed at the mix rather than at authorship is the one place
assistive AI demonstrably sells; iZotope built a business on this exact gap. `AGENT-4.1` (objective DSP
analysis) is the natural dependency - agent ears feed mix advice.

`DAW-14` `to-do` Finishing and constraint mode

The #4 reported struggle at 7.0%, and the direct hedge against the sharpest risk surfaced here:
producers report *deleting* plugins and options in order to finish ("less stuff more creativity" worked
"like magic"), while the axis principle (section 3), clip variants (section 6) and AI-generated takes
all *manufacture* optionality. Something that deliberately narrows choices would hedge section 6's
fearless-iteration thesis against the people it most targets.

### D. A decision, not a ticket

**Leave branching unbuilt.** Revert shipped (`HOST-6.2`, revert-as-marker); branches are deferred to
15C+. The evidence says keep them there. Demand is for **linear revert and snapshot safety**, not
branch-and-A/B: even sympathetic developers struggle to name a branching use case, and branches are
half-useless without merge, which DESIGN.md already concedes is not the pitch. A branch you cannot merge
is a save-as with better manners. Section 7's "branch to try a different drop" is the least-evidenced
claim in that document. Costs nothing to honour - it is a decision not to build.

### E. The fork that needs deciding first

`INST-7` `planning` Web Audio Modules (WAM) host (deps: INST-5)

The obvious "unblock the working/semi-pro segment" ticket: WAM is a mature browser plugin standard, and
supporting it would reportedly bring ~50 plugins immediately. It is the only third-party plugin path
that does not mean abandoning the browser.

**But it cuts against the strategic position this research hands us.** The strongest available pitch is:
*no third-party plugins means project state is complete, so it can be JSON, so it can be diffed,
versioned semantically, and read and written by an agent.* Ardour's lead dev names the two things that
break project portability - external file references, and plugins unavailable on the target system - and
adds "In my experience, #2 is a vastly bigger issue than #1." **The constraint that costs us the
semi-pro segment is the same constraint that enables every differentiator, and every incumbent is locked
out of it by their own plugin ecosystem.** WAM state is opaque binary state; adding it partially reopens
that hole.

So this is a strategic fork, not a backlog item: chase segment (c) and dilute the differentiator, or
stay pure and accept that working producers will not come. **Current lean: do not build it.** The
research found the plugin objection materially weaker than folklore claims - third-largest objection on
our closest analogue's launch thread at 9% of comments, and the punchiest anti-VST quote drew zero
replies - and "no VSTs as a constraint" has a real constituency. Revisit only on direct evidence that
plugin absence is what is actually blocking adoption.

### The cross-cutting risk no ticket fixes

**Audience ambiguity.** Bets 2 and 3 point at *different segments*: versioning wins developers, the
agent wins beginners, and those audiences barely overlap. "Who is the audience?" was the 4th-largest
subthread on our closest analogue's launch. Picking which segment leads is a positioning decision, and
it is the one this research most strongly implies is overdue.
</content>
